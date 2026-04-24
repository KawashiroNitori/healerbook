/**
 * 蓝色 CD 条右端计算
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 */

import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { ResourceDefinition, ResourceEvent } from '@/types/resource'
import { computeResourceTrace, effectsForAction, resolveDef } from './compute'

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

  const trace = computeResourceTrace(def, events)
  const snap = trace[idx]
  const threshold = -consume.delta
  if (snap.amountAfter >= threshold) return null

  // 继续扫：合并 pending refills 和后续 ResourceEvents，时间升序，找 amount 恢复到 ≥threshold
  let amount = snap.amountAfter
  const pending = [...snap.pendingAfter]
  let nextEventIdx = idx + 1

  while (amount < threshold) {
    const nextPending = pending.length > 0 ? pending[0] : Infinity
    const nextEvent = nextEventIdx < events.length ? events[nextEventIdx].timestamp : Infinity
    if (nextPending === Infinity && nextEvent === Infinity) return Infinity

    if (nextPending <= nextEvent) {
      pending.shift()
      if (def.regen) amount = Math.min(amount + def.regen.amount, def.max)
      if (amount >= threshold) return nextPending
    } else {
      const ev = events[nextEventIdx]
      amount = Math.min(amount + ev.delta, def.max)
      if (ev.delta < 0 && def.regen) {
        const count = -ev.delta
        for (let k = 0; k < count; k++) pending.push(ev.timestamp + def.regen.interval)
        pending.sort((a, b) => a - b)
      }
      nextEventIdx++
      if (amount >= threshold) return ev.timestamp
    }
  }
  return null // 上面循环里必然 return，理论不可达
}
