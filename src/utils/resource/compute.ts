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
import { TIME_EPS, type StatusTimelineByPlayer } from '@/utils/placement/types'

/**
 * 判断 (playerId, statusId) 在时刻 t 是否激活。
 *
 * 闭上界：消耗掉该 status 的那一发 cast 自身（其状态区间 `to` 恰好截断在 t）也判为激活，
 * 这样 ResourceEffect.suppressedByStatus 能豁免「消耗该 status 的本 cast」；区间已收束后的
 * 后续 cast（t > to）则判未激活、正常扣量。两端各放 TIME_EPS 吸收浮点误差。
 */
function isStatusActiveAt(
  timeline: StatusTimelineByPlayer,
  playerId: number,
  statusId: number,
  t: number
): boolean {
  const intervals = timeline.get(playerId)?.get(statusId)
  if (!intervals) return false
  return intervals.some(iv => iv.from - TIME_EPS <= t && t <= iv.to + TIME_EPS)
}

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
export function effectsForAction(action: MitigationAction): ResourceEffect[] {
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
 * - 传入 statusTimelineByPlayer 时，带 `suppressedByStatus` 的消费者在该 status 激活的 cast 上被豁免
 *   （不派生该消耗事件）；不传则永不豁免
 * - cast 只存 trackGroup 父 id；传入 resolvedVariantByCastId 时用 simulate 因果推导好的
 *   具体变体（如「收回」型 8324 星体爆轰 cd0、不占地星 7439 的 60s CD），用变体自身的
 *   resourceEffects / cd。不传或某 cast 未命中则退回父 id（向后兼容）。
 *   注：不在此重新按 timeline 解析——cast 自身产生的 buff 会进时间线、且在区间边界处
 *   `not(whileStatus)` 与 `whileStatus` 会同时判合法（歧义 fallback 回父），破坏因果。
 *   simulate 的 resolvedVariantByCastId 用 cast 执行前的状态推导，无此问题。
 */
export function deriveResourceEvents(
  castEvents: CastEvent[],
  actions: Map<number, MitigationAction>,
  statusTimelineByPlayer?: StatusTimelineByPlayer,
  resolvedVariantByCastId?: Map<string, number>
): Map<string, ResourceEvent[]> {
  const grouped = new Map<string, ResourceEvent[]>()
  castEvents.forEach((ce, orderIndex) => {
    const resolvedId = resolvedVariantByCastId?.get(ce.id) ?? ce.actionId
    const action = actions.get(resolvedId)
    if (!action) return
    for (const eff of effectsForAction(action)) {
      // 条件消耗：声明了 suppressedByStatus 的消费者，若该 cast 时刻该 status 激活则跳过本次消耗。
      // 仅在传入 statusTimelineByPlayer 时生效；未传入则永不豁免（向后兼容）。
      if (
        eff.delta < 0 &&
        eff.suppressedByStatus != null &&
        statusTimelineByPlayer &&
        isStatusActiveAt(statusTimelineByPlayer, ce.playerId, eff.suppressedByStatus, ce.timestamp)
      ) {
        continue
      }
      const resourceKey = `${ce.playerId}:${eff.resourceId}`
      const ev: ResourceEvent = {
        resourceKey,
        timestamp: ce.timestamp,
        delta: eff.delta,
        castEventId: ce.id,
        actionId: action.id,
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

export interface ResourceStateAt {
  amount: number
  /** atTime 之后仍挂着的 refill 时刻（升序）；pending[0] = 最早一次回充 */
  pending: number[]
}

export function computeResourceStateAt(
  def: ResourceDefinition,
  events: ResourceEvent[],
  atTime: number
): ResourceStateAt {
  let amount = def.initial
  const pending: number[] = []
  const firePendingUpTo = (t: number) => {
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
      for (let k = 0; k < count; k++) pending.push(ev.timestamp + def.regen.interval)
    }
  }
  firePendingUpTo(atTime)
  return { amount, pending }
}

export function computeResourceAmount(
  def: ResourceDefinition,
  events: ResourceEvent[],
  atTime: number
): number {
  return computeResourceStateAt(def, events, atTime).amount
}

/**
 * 解析 resourceId 对应的 ResourceDefinition。
 * - 优先查 registry；
 * - resourceId 以 `__cd__:` 开头时，用 actionForSynthCd.cooldown 合成单充能池 def；
 * - 其他情况返回 null。
 */
export function resolveDef(
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
 * 合成 `__cd__:${actionId}` 单充能池的 def。
 *
 * 供 validator / legalIntervals / cdBar 共用——action 无显式消费者（`resourceEffects` 不含 delta<0）时，
 * deriveResourceEvents 会生成 `__cd__:${id}` 合成消耗事件，下游查 registry 查不到这个 id，
 * 就用此函数从 action.cooldown 构造一个 max=1 initial=1 的单层池 def。
 */
export function syntheticCdDef(resourceId: string, actionCooldown: number): ResourceDefinition {
  return {
    id: resourceId,
    name: `Synthetic CD ${resourceId}`,
    job: 'SCH', // 合成池的 job 无实际意义，仅占位
    initial: 1,
    max: 1,
    style: 'cooldown',
    regen: { interval: actionCooldown, amount: 1 },
  }
}
