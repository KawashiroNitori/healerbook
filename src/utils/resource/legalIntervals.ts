/**
 * 资源池合法区间计算（shadow 来源）
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 */

import type { MitigationAction } from '@/types/mitigation'
import type { ResourceDefinition, ResourceEffect, ResourceEvent } from '@/types/resource'
import type { Interval } from '@/types/placement'
import { complement, intersect, mergeOverlapping, sortIntervals } from '@/utils/placement/intervals'
import {
  computeAmountTransitions,
  computeResourceTrace,
  effectsForAction,
  resolveDef,
} from './compute'

const INF = Number.POSITIVE_INFINITY
const NEG_INF = Number.NEGATIVE_INFINITY

/**
 * 单个 ResourceEffect 对应的 forbid 区间集合（自耗尽 ∪ 下游透支）。
 * events 是该 (playerId, resourceId) 对的全部事件（含这个 action 与其他 consumer 的）。
 */
function forbidForEffect(
  effect: ResourceEffect,
  events: ResourceEvent[],
  def: ResourceDefinition
): Interval[] {
  if (effect.delta >= 0 || effect.required === false || def.allowForcePlacement) return []
  // 产出不贡献 forbid；required=false 的软消费者也不贡献（与 validator 语义对齐）；
  // allowForcePlacement 的池不挖洞——放开 placement 拦截，标红仍由 validator 负责（可放置但仍标红）。
  const threshold = -effect.delta

  // 自耗尽段：枚举"amount 跌到 <threshold"的持续时段。
  // amount 是分段常量函数，由 computeAmountTransitions 单源产出（事件点 + 顺序回充断点）。
  const selfForbid: Interval[] = []
  const transitions = computeAmountTransitions(def, events)
  // 把断点合成 [from, to) 区段，amount < threshold 的加入 selfForbid
  for (let i = 0; i < transitions.length; i++) {
    const { t, amount } = transitions[i]
    if (amount < threshold) {
      const next = i + 1 < transitions.length ? transitions[i + 1].t : INF
      selfForbid.push({ from: t, to: next })
    }
  }

  // 下游透支段：对每条 delta<0 事件 C，M_C = amountBefore(C) - |delta_C|
  // （保留 computeResourceTrace——需要 amountBefore 快照，与自耗尽段分段函数不同视角）
  const trace = computeResourceTrace(def, events)
  // 若 M_C < threshold → 新 cast 窗口 (C.timestamp - interval, C.timestamp) 进 forbid
  // 无 regen 时窗口延到 −∞
  const downstreamForbid: Interval[] = []
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (ev.delta >= 0) continue
    const M = trace[i].amountBefore - -ev.delta
    if (M < threshold) {
      const from = def.regen ? ev.timestamp - def.regen.interval : NEG_INF
      downstreamForbid.push({ from, to: ev.timestamp })
    }
  }

  return mergeOverlapping(sortIntervals([...selfForbid, ...downstreamForbid]))
}

/**
 * 返回 action 对某 player 的 resource-legal 区间集合。
 *
 * 对每个 resourceEffect（含合成 `__cd__`）单独算 forbid，最后取 complement 的交集。
 */
export function resourceLegalIntervals(
  action: MitigationAction,
  playerId: number,
  resourceEventsByKey: Map<string, ResourceEvent[]>,
  registry: Record<string, ResourceDefinition>
): Interval[] {
  // 合成 effect 列表（与 deriveResourceEvents 对齐）
  const effects = effectsForAction(action)

  let legal: Interval[] = [{ from: NEG_INF, to: INF }]
  for (const eff of effects) {
    const def = resolveDef(eff.resourceId, registry, action)
    if (!def) continue
    const events = resourceEventsByKey.get(`${playerId}:${eff.resourceId}`) ?? []
    const forbid = forbidForEffect(eff, events, def)
    const thisLegal = complement(forbid)
    legal = intersect(legal, thisLegal)
  }
  return legal
}
