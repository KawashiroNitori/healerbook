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
 * @param isPartyWide 是否为团队技能（默认 true）
 * @returns 技能执行器
 */
export function createFriendlyBuffExecutor(
  statusId: number,
  duration: number,
  isPartyWide: boolean = true
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
