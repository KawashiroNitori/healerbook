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
import { TIME_EPS } from '@/utils/placement/types'
import type { StatusTimelineByPlayer } from '@/types/placement'
import { synthCdResourceId, isSynthCdResource } from './synthCd'

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
    resourceId: synthCdResourceId(action.id),
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

/**
 * 顺序回充时钟状态（FF14 充能语义）。
 *
 * 不再为每个消耗调度独立 refill（平行模型），而是维护单一回充时钟：
 * - `nextRefill` = 下一档回充时刻；`null` = 已满（时钟停摆）。
 * - 时钟在「amount 从满跌破」的那次消耗启动；未满时每回一档就把下一档计时 +interval 重置。
 * - 后续消耗不重置时钟（只是加深亏空）；产出事件只 clamp，不启动时钟。
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md（顺序回充修订）。
 */
export interface ClockState {
  amount: number
  nextRefill: number | null
}

/** 触发 ≤ t 的所有回充（顺序：每回一档若仍未满则把下一档 +interval）。原地修改 st。 */
export function advanceRefills(def: ResourceDefinition, st: ClockState, t: number): void {
  if (!def.regen) return
  while (st.nextRefill !== null && st.nextRefill <= t) {
    st.amount = Math.min(st.amount + def.regen.amount, def.max)
    st.nextRefill = st.amount < def.max ? st.nextRefill + def.regen.interval : null
  }
}

/** 在事件时刻应用一个 ResourceEvent（调用方须先 advanceRefills 到 ev.timestamp）。原地修改 st。 */
export function applyResourceEvent(
  def: ResourceDefinition,
  st: ClockState,
  ev: ResourceEvent
): void {
  st.amount = Math.min(st.amount + ev.delta, def.max)
  if (!def.regen) return
  if (st.amount >= def.max) {
    st.nextRefill = null
  } else if (ev.delta < 0 && st.nextRefill === null) {
    // 仅「消耗把池跌破满且时钟未运行」时启动时钟；时钟已运行则保持原节拍。
    st.nextRefill = ev.timestamp + def.regen.interval
  }
}

/** 从当前时钟状态推导未来全部回充时刻（升序，直到回满）。 */
export function futureRefills(def: ResourceDefinition, st: ClockState): number[] {
  if (!def.regen || st.nextRefill === null) return []
  const out: number[] = []
  let amount = st.amount
  let nr: number | null = st.nextRefill
  while (nr !== null) {
    out.push(nr)
    amount = Math.min(amount + def.regen.amount, def.max)
    nr = amount < def.max ? nr + def.regen.interval : null
  }
  return out
}

export function computeResourceTrace(
  def: ResourceDefinition,
  events: ResourceEvent[]
): ResourceSnapshot[] {
  const result: ResourceSnapshot[] = []
  const st: ClockState = { amount: def.initial, nextRefill: null }
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    advanceRefills(def, st, ev.timestamp)
    const amountBefore = st.amount
    applyResourceEvent(def, st, ev)
    result.push({
      index: i,
      amountBefore,
      amountAfter: st.amount,
      // pendingAfter：此事件后未来将发生的回充时刻（升序，直到回满）。
      pendingAfter: futureRefills(def, st),
    })
  }
  return result
}

export interface ResourceStateAt {
  amount: number
  /** atTime 之后未来全部回充时刻（升序）；pending[0] = 最早一次回充 */
  pending: number[]
}

export function computeResourceStateAt(
  def: ResourceDefinition,
  events: ResourceEvent[],
  atTime: number
): ResourceStateAt {
  const st: ClockState = { amount: def.initial, nextRefill: null }
  for (const ev of events) {
    if (ev.timestamp > atTime) break
    advanceRefills(def, st, ev.timestamp)
    applyResourceEvent(def, st, ev)
  }
  advanceRefills(def, st, atTime)
  return { amount: st.amount, pending: futureRefills(def, st) }
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
  if (isSynthCdResource(resourceId)) {
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
