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
import type { MitigationStatus } from '@/types/status'
import { computeFinalHeal } from './healMath'
import { generateId } from './utils'

export interface RegenExecutorOptions {
  /**
   * 每个 tick 的固定治疗量。
   * 不指定 → tickAmount = healByAbility[1e6 + statusId]
   *         （buff 类治疗在 statistics 中以 1e6 + statusId 为 key，值已是每 tick 量）
   */
  tickAmount?: number
}

export function createRegenExecutor(
  statusId: number,
  duration: number,
  options?: RegenExecutorOptions
): ActionExecutor {
  return ctx => {
    const baseTickAmount =
      options?.tickAmount ?? ctx.statistics?.healByAbility?.[1e6 + statusId] ?? 0
    const snapshotTickAmount = computeFinalHeal(
      baseTickAmount,
      ctx.partyState,
      ctx.sourcePlayerId,
      ctx.useTime
    )

    // 同一玩家的同名 HoT 不共存：新 cast 替换旧实例（不同玩家可共存）
    const filteredStatuses = ctx.partyState.statuses.filter(
      s => !(s.statusId === statusId && s.sourcePlayerId === ctx.sourcePlayerId)
    )

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
