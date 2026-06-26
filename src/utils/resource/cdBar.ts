/**
 * 蓝色 CD 条右端计算
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 */

import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { ResourceDefinition, ResourceEvent } from '@/types/resource'
import {
  advanceRefills,
  applyResourceEvent,
  effectsForAction,
  resolveDef,
  type ClockState,
} from './compute'

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

  // 顺序回充时钟：模拟到（含）本 cast 事件
  const st: ClockState = { amount: def.initial, nextRefill: null }
  for (let i = 0; i <= idx; i++) {
    advanceRefills(def, st, events[i].timestamp)
    applyResourceEvent(def, st, events[i])
  }
  if (st.amount >= threshold) return null // 还有库存，不画

  // 继续扫：把后续 ResourceEvents 与回充按时间升序交错推进，找 amount 恢复到 ≥threshold
  let nextEventIdx = idx + 1
  while (st.amount < threshold) {
    const nextRefill = st.nextRefill ?? Infinity
    const nextEvent = nextEventIdx < events.length ? events[nextEventIdx].timestamp : Infinity
    if (nextRefill === Infinity && nextEvent === Infinity) return Infinity

    if (nextRefill <= nextEvent) {
      advanceRefills(def, st, nextRefill) // 触发这一档回充（时钟自动 +interval 或停摆）
      if (st.amount >= threshold) return nextRefill
    } else {
      const ev = events[nextEventIdx]
      advanceRefills(def, st, ev.timestamp)
      applyResourceEvent(def, st, ev)
      nextEventIdx++
      if (st.amount >= threshold) return ev.timestamp
    }
  }
  return null // 上面循环里必然 return，理论不可达
}
