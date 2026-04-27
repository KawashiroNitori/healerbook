/**
 * HoT 治疗执行器工厂
 *
 * - cast 时挂状态（带 snapshot 的 tickAmount 与 castEventId 写进 status.data）
 * - HoT 通过 regenStatusExecutor.onTick 在每个 3s 网格触发治疗
 *
 * tickAmount 走 snapshot-on-apply：cast 时刻按当时 active 的 heal/selfHeal buff 算一次，
 * 之后的 tick 直接读 snapshot，不再随后挂 buff 变化。
 */

import type { ActionExecutor } from '@/types/mitigation'
import type { MitigationStatus, StatusExecutor } from '@/types/status'
import { computeFinalHeal } from './healMath'
import { generateId } from './utils'

export interface RegenExecutorOptions {
  /** 互斥组：默认 [statusId] */
  uniqueGroup?: number[]
  /**
   * 每个 tick 的固定治疗量。
   * 不指定 → tickAmount = healByAbility[statusId] / floor(duration / 3)
   *         （"全 duration 收满 healByAbility 总量"为锚）
   */
  tickAmount?: number
}

export function createRegenExecutor(
  statusId: number,
  duration: number,
  options?: RegenExecutorOptions
): ActionExecutor {
  const uniqueGroup = options?.uniqueGroup ?? [statusId]

  return ctx => {
    const totalTicks = Math.floor(duration / 3)
    const baseTickAmount =
      options?.tickAmount ??
      (totalTicks > 0 ? (ctx.statistics?.healByAbility?.[statusId] ?? 0) / totalTicks : 0)
    const snapshotTickAmount = computeFinalHeal(
      baseTickAmount,
      ctx.partyState,
      ctx.sourcePlayerId,
      ctx.useTime
    )

    const filteredStatuses = ctx.partyState.statuses.filter(s => !uniqueGroup.includes(s.statusId))

    const newStatus: MitigationStatus = {
      instanceId: generateId(),
      statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      sourceActionId: ctx.actionId,
      sourcePlayerId: ctx.sourcePlayerId,
      data: { tickAmount: snapshotTickAmount, castEventId: ctx.castEventId ?? '' },
    }

    return {
      ...ctx.partyState,
      statuses: [...filteredStatuses, newStatus],
    }
  }
}

/**
 * HoT 状态自带的 onTick：每 3s 网格 +tickAmount 到 hp.current，clamp 到 hp.max。
 *
 * 在 STATUS_EXTRAS 中给所有 HoT statusId 注册此 executor 即可。
 */
export const regenStatusExecutor: StatusExecutor = {
  onTick: ctx => {
    if (!ctx.partyState.hp) return
    const tickAmount = (ctx.status.data?.tickAmount as number | undefined) ?? 0
    if (tickAmount <= 0) return

    const before = ctx.partyState.hp.current
    const next = Math.min(before + tickAmount, ctx.partyState.hp.max)
    const applied = next - before
    const overheal = tickAmount - applied

    ctx.recordHeal?.({
      castEventId: (ctx.status.data?.castEventId as string | undefined) ?? '',
      actionId: ctx.status.sourceActionId ?? 0,
      sourcePlayerId: ctx.status.sourcePlayerId ?? 0,
      time: ctx.tickTime,
      baseAmount: tickAmount,
      finalHeal: tickAmount,
      applied,
      overheal,
      isHotTick: true,
    })

    return { ...ctx.partyState, hp: { ...ctx.partyState.hp, current: next } }
  },
}
