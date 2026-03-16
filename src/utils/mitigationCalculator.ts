/**
 * 减伤计算引擎（基于状态）
 * 实现核心减伤计算逻辑
 */

import type { PartyState } from '@/types/partyState'
import type { MitigationStatus } from '@/types/status'
import { getStatusById } from '@/utils/statusRegistry'

/**
 * 伤害类型
 */
export type DamageType = 'physical' | 'magical' | 'special'

/**
 * 计算结果
 */
export interface CalculationResult {
  /** 原始伤害 */
  originalDamage: number
  /** 最终伤害 */
  finalDamage: number
  /** 减伤百分比 */
  mitigationPercentage: number
  /** 应用的状态列表 */
  appliedStatuses: MitigationStatus[]
  /** 更新后的小队状态（盾值消耗后） */
  updatedPartyState: PartyState
}

/**
 * 减伤计算器
 */
export class MitigationCalculator {
  /**
   * 计算减伤后的最终伤害
   * 公式: 最终伤害 = 原始伤害 × (1-减伤1%) × (1-减伤2%) × ... - 盾值
   *
   * @param originalDamage 原始伤害
   * @param partyState 小队状态
   * @param time 当前时间（秒）
   * @param damageType 伤害类型（物理/魔法/特殊）
   * @param targetPlayerId 目标玩家 ID（可选，用于单体伤害）
   * @returns 计算结果
   */
  calculate(
    originalDamage: number,
    partyState: PartyState,
    time: number,
    damageType: DamageType = 'physical',
    targetPlayerId?: number
  ): CalculationResult {
    // 获取生效的状态
    const friendlyStatuses = this.getActiveStatuses(partyState.players, time, targetPlayerId)
    const enemyStatuses = this.getActiveStatuses([{ statuses: partyState.enemy.statuses }], time)

    // 1. 计算百分比减伤
    let multiplier = 1.0
    const appliedStatuses: MitigationStatus[] = []

    for (const status of [...friendlyStatuses, ...enemyStatuses]) {
      const meta = getStatusById(status.statusId)
      if (!meta) continue

      if (meta.type === 'multiplier') {
        // 根据伤害类型获取减伤倍率
        const damageMultiplier = this.getDamageMultiplier(meta.performance, damageType)
        multiplier *= damageMultiplier
        appliedStatuses.push(status)
      }
    }

    let damage = originalDamage * multiplier

    // 2. 计算盾值减伤
    // 按玩家独立计算：AOE 时每个玩家的盾各自吸收自己承受的伤害
    // 单体时只处理目标玩家
    const statusUpdates = new Map<string, number>() // instanceId -> remainingBarrier

    const playersToProcess =
      targetPlayerId !== undefined
        ? partyState.players.filter(p => p.id === targetPlayerId)
        : partyState.players

    const perPlayerDamages: number[] = []

    for (const player of playersToProcess) {
      let playerDamage = damage // 每个玩家独立承受相同的减伤后伤害

      for (const status of player.statuses) {
        const meta = getStatusById(status.statusId)
        if (!meta || meta.type !== 'absorbed') continue
        if (!status.remainingBarrier || status.remainingBarrier <= 0) continue
        if (time < status.startTime || time > status.endTime) continue

        const absorbed = Math.min(playerDamage, status.remainingBarrier)
        playerDamage -= absorbed

        appliedStatuses.push(status)
        statusUpdates.set(status.instanceId, status.remainingBarrier - absorbed)

        if (playerDamage <= 0) break
      }

      perPlayerDamages.push(playerDamage)
    }

    // 最终伤害取各玩家平均值（若无玩家可处理则保留减伤倍率后的值）
    if (perPlayerDamages.length > 0) {
      damage = perPlayerDamages.reduce((a, b) => a + b, 0) / perPlayerDamages.length
    }

    // 应用盾值更新到玩家状态
    const updatedPlayers = partyState.players.map(player => {
      const updatedStatuses = player.statuses.map(status => {
        const newBarrier = statusUpdates.get(status.instanceId)
        if (newBarrier !== undefined) {
          return {
            ...status,
            remainingBarrier: newBarrier,
          }
        }
        return status
      })

      return {
        ...player,
        statuses: updatedStatuses.filter(s => s.remainingBarrier === undefined || s.remainingBarrier > 0), // 移除盾值为0的状态
      }
    })

    const mitigationPercentage = ((originalDamage - damage) / originalDamage) * 100

    return {
      originalDamage,
      finalDamage: Math.max(0, Math.round(damage)),
      mitigationPercentage: Math.round(mitigationPercentage * 10) / 10,
      appliedStatuses,
      updatedPartyState: {
        ...partyState,
        players: updatedPlayers,
      },
    }
  }

  /**
   * 获取指定时间点生效的状态
   * @param entities 实体列表（玩家或敌方）
   * @param time 当前时间（秒）
   * @param targetPlayerId 目标玩家 ID（可选）
   * @returns 生效的状态列表
   */
  private getActiveStatuses(
    entities: Array<{ statuses: MitigationStatus[] }>,
    time: number,
    targetPlayerId?: number
  ): MitigationStatus[] {
    const activeStatuses: MitigationStatus[] = []
    const seenStatusIds = new Set<number>() // 用于 AOE 伤害时去重

    for (const entity of entities) {
      // 如果指定了目标玩家，只处理该玩家的状态
      if (targetPlayerId !== undefined && 'id' in entity && entity.id !== targetPlayerId) {
        continue
      }

      for (const status of entity.statuses) {
        // 检查状态是否在生效时间内
        if (time >= status.startTime && time <= status.endTime) {
          // 对于 AOE 伤害（没有指定目标玩家），同一个状态 ID 只收集一次
          if (targetPlayerId === undefined && seenStatusIds.has(status.statusId)) {
            continue
          }

          activeStatuses.push(status)
          seenStatusIds.add(status.statusId)
        }
      }
    }

    return activeStatuses
  }

  /**
   * 根据伤害类型获取减伤倍率
   * @param performance 状态性能数据
   * @param damageType 伤害类型
   * @returns 减伤倍率（0-1）
   */
  private getDamageMultiplier(
    performance: { physics: number; magic: number; darkness: number },
    damageType: DamageType
  ): number {
    switch (damageType) {
      case 'physical':
        return performance.physics
      case 'magical':
        return performance.magic
      case 'special':
        return performance.darkness
      default:
        return 1.0
    }
  }

  /**
   * 获取指定时间点所有生效的状态（用于 UI 显示）
   * @param partyState 小队状态
   * @param time 当前时间（秒）
   * @returns 生效的状态列表（包含友方和敌方）
   */
  getActiveStatusesAtTime(partyState: PartyState, time: number): MitigationStatus[] {
    const friendlyStatuses = this.getActiveStatuses(partyState.players, time)
    const enemyStatuses = this.getActiveStatuses([{ statuses: partyState.enemy.statuses }], time)
    return [...friendlyStatuses, ...enemyStatuses]
  }
}

/**
 * 创建减伤计算器实例
 */
export function createMitigationCalculator(): MitigationCalculator {
  return new MitigationCalculator()
}
