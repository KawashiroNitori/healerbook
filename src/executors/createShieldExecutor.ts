/**
 * 盾值执行器工厂
 */

import type { ActionExecutor } from '@/types/mitigation'
import type { MitigationStatus } from '@/types/status'
import { generateId } from './utils'

/**
 * 创建盾值执行器
 * @param statusId 状态 ID
 * @param duration 持续时间（秒）
 * @param shieldMultiplier 盾值倍率（相对于目标最大 HP，默认 0.1）
 * @returns 技能执行器
 */
export function createShieldExecutor(
  statusId: number,
  duration: number,
  shieldMultiplier: number = 0.1
): ActionExecutor {
  return ctx => {
    // 优先使用统计数据里的盾值，其次用最大 HP 倍率
    const barrier =
      ctx.statistics?.shieldByAbility[statusId] ?? ctx.partyState.player.maxHP * shieldMultiplier

    const newStatus: MitigationStatus = {
      instanceId: generateId(),
      statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      sourceActionId: ctx.actionId,
      sourcePlayerId: ctx.sourcePlayerId,
      remainingBarrier: barrier,
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
