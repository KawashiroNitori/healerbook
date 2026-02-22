/**
 * 敌方 Debuff 执行器工厂
 */

import type { ActionExecutor } from '@/types/mitigation'
import type { MitigationStatus } from '@/types/status'
import { generateId } from './utils'

/**
 * 创建敌方 Debuff 执行器
 * @param statusId 状态 ID
 * @param duration 持续时间（秒）
 * @returns 技能执行器
 */
export function createEnemyDebuffExecutor(
  statusId: number,
  duration: number
): ActionExecutor {
  return (ctx) => {
    const newStatus: MitigationStatus = {
      instanceId: generateId(),
      statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      sourceActionId: ctx.actionId,
    }

    return {
      ...ctx.partyState,
      enemy: {
        ...ctx.partyState.enemy,
        statuses: [...ctx.partyState.enemy.statuses, newStatus],
      },
    }
  }
}
