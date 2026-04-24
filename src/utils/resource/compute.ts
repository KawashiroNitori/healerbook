/**
 * 资源 compute 层
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 */

import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type {
  ResourceDefinition,
  ResourceEffect,
  ResourceEvent,
  ResourceSnapshot,
} from '@/types/resource'

/**
 * 判断 action 是否声明了消费者（delta<0）。没有消费者 → 合成 __cd__:${id}。
 */
function hasExplicitConsumer(action: MitigationAction): boolean {
  return !!action.resourceEffects?.some(e => e.delta < 0)
}

/**
 * 单条 cast 生成其应派生的 ResourceEffect 列表。
 * 有显式消费者 → 直接用 action.resourceEffects；
 * 无显式消费者 → 合成一个 [{ resourceId: '__cd__:${id}', delta: -1, required: true }]，
 *             同时带上可能存在的产出 effect（如未来纯产出类）。
 */
function effectsForAction(action: MitigationAction): ResourceEffect[] {
  if (hasExplicitConsumer(action)) {
    return action.resourceEffects ?? []
  }
  const synthetic: ResourceEffect = {
    resourceId: `__cd__:${action.id}`,
    delta: -1,
    required: true,
  }
  return [synthetic, ...(action.resourceEffects ?? [])]
}

/**
 * 从 castEvents 派生出按 resourceKey 分组、按 (timestamp ASC, orderIndex ASC) 稳定排序的事件。
 *
 * - 对 resourceEffects 中无 `delta < 0` 的 action（无声明 / 只产出）：合成 `__cd__:${id}` 消耗事件
 * - ResourceEffect.required 未声明默认 true；派生到 ResourceEvent.required
 */
export function deriveResourceEvents(
  castEvents: CastEvent[],
  actions: Map<number, MitigationAction>
): Map<string, ResourceEvent[]> {
  const grouped = new Map<string, ResourceEvent[]>()
  castEvents.forEach((ce, orderIndex) => {
    const action = actions.get(ce.actionId)
    if (!action) return
    for (const eff of effectsForAction(action)) {
      const resourceKey = `${ce.playerId}:${eff.resourceId}`
      const ev: ResourceEvent = {
        resourceKey,
        timestamp: ce.timestamp,
        delta: eff.delta,
        castEventId: ce.id,
        actionId: ce.actionId,
        playerId: ce.playerId,
        resourceId: eff.resourceId,
        required: eff.required ?? true,
        orderIndex,
      }
      const arr = grouped.get(resourceKey) ?? []
      arr.push(ev)
      grouped.set(resourceKey, arr)
    }
  })
  // 稳定排序：主序 timestamp，次序 orderIndex
  for (const arr of grouped.values()) {
    arr.sort((a, b) => a.timestamp - b.timestamp || a.orderIndex - b.orderIndex)
  }
  return grouped
}

export function computeResourceTrace(
  def: ResourceDefinition,
  events: ResourceEvent[]
): ResourceSnapshot[] {
  const result: ResourceSnapshot[] = []
  let amount = def.initial
  // pending refills 用升序数组（事件数通常 <20，插入成本可忽略）
  const pending: number[] = []

  const firePendingUpTo = (t: number) => {
    // 不变量：pending 非空 ⇒ def.regen 存在（由 push 条件保证）
    while (pending.length > 0 && pending[0] <= t) {
      pending.shift()
      amount = Math.min(amount + def.regen!.amount, def.max)
    }
  }

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    firePendingUpTo(ev.timestamp)
    const amountBefore = amount
    // 应用 delta；上限 clamp，下限不 clamp
    amount = Math.min(amount + ev.delta, def.max)
    // 消耗事件调度 |delta| 个 refill
    if (ev.delta < 0 && def.regen) {
      const count = -ev.delta
      for (let k = 0; k < count; k++) {
        const refillTime = ev.timestamp + def.regen.interval
        // 保持 pending 升序（所有新 refill 时刻相同，push 到末尾即可）
        pending.push(refillTime)
      }
    }
    result.push({
      index: i,
      amountBefore,
      amountAfter: amount,
      pendingAfter: [...pending],
    })
  }
  return result
}

export function computeResourceAmount(
  def: ResourceDefinition,
  events: ResourceEvent[],
  atTime: number
): number {
  let amount = def.initial
  const pending: number[] = []

  const firePendingUpTo = (t: number) => {
    // 不变量：pending 非空 ⇒ def.regen 存在（由 push 条件保证）
    while (pending.length > 0 && pending[0] <= t) {
      pending.shift()
      amount = Math.min(amount + def.regen!.amount, def.max)
    }
  }

  for (const ev of events) {
    if (ev.timestamp > atTime) break
    firePendingUpTo(ev.timestamp)
    amount = Math.min(amount + ev.delta, def.max)
    if (ev.delta < 0 && def.regen) {
      const count = -ev.delta
      for (let k = 0; k < count; k++) {
        pending.push(ev.timestamp + def.regen.interval)
      }
    }
  }
  // 触发 atTime 及以前剩余的 pending
  firePendingUpTo(atTime)
  return amount
}
