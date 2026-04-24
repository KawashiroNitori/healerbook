/**
 * 资源池合法区间计算（shadow 来源）
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 */

import type { MitigationAction } from '@/types/mitigation'
import type { ResourceDefinition, ResourceEffect, ResourceEvent } from '@/types/resource'
import type { Interval } from '@/utils/placement/types'
import { complement, intersect, mergeOverlapping, sortIntervals } from '@/utils/placement/intervals'
import { computeResourceTrace, syntheticCdDef } from './compute'

const INF = Number.POSITIVE_INFINITY
const NEG_INF = Number.NEGATIVE_INFINITY

function resolveDef(
  resourceId: string,
  registry: Record<string, ResourceDefinition>,
  actionForSynthCd: MitigationAction
): ResourceDefinition | null {
  const explicit = registry[resourceId]
  if (explicit) return explicit
  if (resourceId.startsWith('__cd__:')) {
    return syntheticCdDef(resourceId, actionForSynthCd.cooldown)
  }
  return null
}

/**
 * 单个 ResourceEffect 对应的 forbid 区间集合（自耗尽 ∪ 下游透支）。
 * events 是该 (playerId, resourceId) 对的全部事件（含这个 action 与其他 consumer 的）。
 */
function forbidForEffect(
  effect: ResourceEffect,
  events: ResourceEvent[],
  def: ResourceDefinition
): Interval[] {
  if (effect.delta >= 0 || effect.required === false) return []
  // 产出不贡献 forbid；required=false 的软消费者也不贡献（与 validator 语义对齐）
  const threshold = -effect.delta

  const trace = computeResourceTrace(def, events)

  // 自耗尽段：枚举"amount 跌到 <threshold"的持续时段
  // amount 函数是分段常量，分段点是 events[i].timestamp 和 pendingAfter 中的 refill 时刻
  const selfForbid: Interval[] = []
  // 构建分段：(t, amount_at_t_after_all_events_and_refills_applied)
  // 方法：按时间合并事件点 + 所有 pending refill 时刻，线性扫描记录 amount
  const transitions: Array<{ t: number; amount: number }> = []
  // 初始段 [−∞, events[0].timestamp)：amount = def.initial
  transitions.push({ t: NEG_INF, amount: def.initial })
  for (let i = 0; i < events.length; i++) {
    const snap = trace[i]
    const ev = events[i]
    // 事件发生瞬间 amount 变为 amountAfter（边界：[ev.timestamp, next) 段 = amountAfter）
    transitions.push({ t: ev.timestamp, amount: snap.amountAfter })
    // 此事件后到下一事件前可能有 refill 触发
    const nextEventTs = i + 1 < events.length ? events[i + 1].timestamp : INF
    // 计算在 [ev.timestamp, nextEventTs) 区间内 pending 到点的瞬间
    // pendingAfter 是应用此事件后的 refill 队列；升序；只关心 < nextEventTs 的部分
    let currentAmount = snap.amountAfter
    for (const refillTime of snap.pendingAfter) {
      if (refillTime >= nextEventTs) break
      if (!def.regen) break
      currentAmount = Math.min(currentAmount + def.regen.amount, def.max)
      transitions.push({ t: refillTime, amount: currentAmount })
    }
  }

  // 把 transitions 合成 [from, to) 区段，amount < threshold 的加入 selfForbid
  for (let i = 0; i < transitions.length; i++) {
    const { t, amount } = transitions[i]
    if (amount < threshold) {
      const next = i + 1 < transitions.length ? transitions[i + 1].t : INF
      selfForbid.push({ from: t, to: next })
    }
  }

  // 下游透支段：对每条 delta<0 事件 C，M_C = amountBefore(C) - |delta_C|
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
  const hasConsumer = !!action.resourceEffects?.some(e => e.delta < 0)
  const effects: ResourceEffect[] = hasConsumer
    ? (action.resourceEffects ?? [])
    : [
        { resourceId: `__cd__:${action.id}`, delta: -1, required: true },
        ...(action.resourceEffects ?? []),
      ]

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
