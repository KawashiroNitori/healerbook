/**
 * 蓝色 CD 条右端计算
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 */

import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { ResourceDefinition, ResourceEvent } from '@/types/resource'
import { computeAmountTransitions, effectsForAction, resolveDef } from './compute'

/**
 * 返回 cast 的蓝条 rawEnd（秒）。null = 不画；Infinity = 时间轴内无恢复。
 *
 * 选取"第一条 delta<0 的 effect"作为代表（action 主消费者）。若 action 无消费者走合成 __cd__。
 */
export function computeCdBarEnd(
  action: MitigationAction,
  castEvent: CastEvent,
  resourceEventsByKey: Map<string, ResourceEvent[]>,
  registry: Record<string, ResourceDefinition>
): number | null {
  // 选代表 consume effect（同 deriveResourceEvents 的合成逻辑）
  const effects = effectsForAction(action)
  const consume = effects.find(e => e.delta < 0)
  if (!consume) return null

  const def = resolveDef(consume.resourceId, registry, action)
  if (!def) return null

  const events = resourceEventsByKey.get(`${castEvent.playerId}:${consume.resourceId}`) ?? []
  const idx = events.findIndex(e => e.castEventId === castEvent.id)
  if (idx < 0) return null
  const threshold = -consume.delta

  // 单源分段函数：把顺序回充时钟展开为 (t, amount) 断点，线性扫描。
  const transitions = computeAmountTransitions(def, events)
  // 定位本 cast 事件对应的 event 断点
  const castBpIdx = transitions.findIndex(bp => bp.kind === 'event' && bp.eventIndex === idx)
  if (castBpIdx < 0) return null
  if (transitions[castBpIdx].amount >= threshold) return null // 还有库存，不画

  // 向后扫第一个 amount 恢复到 ≥threshold 的断点时刻；扫到底仍不足 → 时间轴内无恢复
  for (let i = castBpIdx + 1; i < transitions.length; i++) {
    if (transitions[i].amount >= threshold) return transitions[i].t
  }
  return Infinity
}
