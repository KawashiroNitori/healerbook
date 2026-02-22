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
 * @param isPartyWide 是否为团队技能（默认 true）
 * @param shieldMultiplier 盾值倍率（相对于目标最大 HP，默认 0.1）
 * @returns 技能执行器
 */
export function createShieldExecutor(
  statusId: number,
  duration: number,
  isPartyWide: boolean = true,
  shieldMultiplier: number = 0.1
): ActionExecutor {
  return (ctx) => {
    const targets = isPartyWide
      ? ctx.partyState.players
      : ctx.partyState.players.filter((p) => p.id === ctx.targetPlayerId)

    const newStatuses: MitigationStatus[] = targets.map((player) => ({
      instanceId: generateId(),
      statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      sourceActionId: ctx.actionId,
      sourcePlayerId: player.id,
      remainingBarrier: (player.maxHP * shieldMultiplier) || 10000,
    }))

    return {
      ...ctx.partyState,
      players: ctx.partyState.players.map((p) => {
        const playerStatuses = newStatuses.filter((s) => s.sourcePlayerId === p.id)
        return playerStatuses.length > 0
          ? { ...p, statuses: [...p.statuses, ...playerStatuses] }
          : p
      }),
    }
  }
}
