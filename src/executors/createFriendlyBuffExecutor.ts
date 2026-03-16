/**
 * 友方 Buff 执行器工厂
 */

import type { ActionExecutor } from '@/types/mitigation'
import type { MitigationStatus } from '@/types/status'
import { generateId } from './utils'

/**
 * 创建友方 Buff 执行器
 * @param statusId 状态 ID
 * @param duration 持续时间（秒）
 * @returns 技能执行器
 */
export function createFriendlyBuffExecutor(statusId: number, duration: number): ActionExecutor {
  return ctx => {
    const newStatus: MitigationStatus = {
      instanceId: generateId(),
      statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      sourceActionId: ctx.actionId,
      sourcePlayerId: ctx.partyState.player.id,
    }

    return {
      ...ctx.partyState,
      player: {
        ...ctx.partyState.player,
        statuses: [...ctx.partyState.player.statuses, newStatus],
      },
    }
  }
}
