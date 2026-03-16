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
  /** 更新后的小队状态（盾值消耗后，回放模式下为 undefined） */
  updatedPartyState?: PartyState
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
   * @param damageType 伤害类��（物理/魔法/特殊）
   * @returns 计算结果
   */
  calculate(
    originalDamage: number,
    partyState: PartyState,
    time: number,
    damageType: DamageType = 'physical'
  ): CalculationResult {
    // 1. 获取生效的玩家状态（包含友方 Buff 和敌方 Debuff）
    const activeStatuses = this.getActiveStatuses([{ statuses: partyState.player.statuses }], time)

    // 2. 计算百分比减伤
    let multiplier = 1.0
    const appliedStatuses: MitigationStatus[] = []

    for (const status of activeStatuses) {
      const meta = getStatusById(status.statusId)
      if (!meta) continue

      if (meta.type === 'multiplier') {
        const damageMultiplier = this.getDamageMultiplier(meta.performance, damageType)
        multiplier *= damageMultiplier
        appliedStatuses.push(status)
      }
    }

    let damage = originalDamage * multiplier

    // 3. 计算盾值减伤
    const statusUpdates = new Map<string, number>()
    let playerDamage = damage

    for (const status of partyState.player.statuses) {
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

    damage = playerDamage

    // 4. 更新盾值状态
    const updatedPartyState: PartyState = {
      ...partyState,
      player: {
        ...partyState.player,
        statuses: partyState.player.statuses
          .map(s =>
            statusUpdates.has(s.instanceId)
              ? { ...s, remainingBarrier: statusUpdates.get(s.instanceId) }
              : s
          )
          .filter(s => s.remainingBarrier === undefined || s.remainingBarrier > 0),
      },
    }

    const mitigationPercentage = ((originalDamage - damage) / originalDamage) * 100

    return {
      originalDamage,
      finalDamage: Math.max(0, Math.round(damage)),
      mitigationPercentage: Math.round(mitigationPercentage * 10) / 10,
      appliedStatuses,
      updatedPartyState,
    }
  }

  /**
   * 获取指定时间点生效的状态
   * @param entities 实体列表
   * @param time 当前时间（秒）
   * @returns 生效的状态列表
   */
  private getActiveStatuses(
    entities: Array<{ statuses: MitigationStatus[] }>,
    time: number
  ): MitigationStatus[] {
    const activeStatuses: MitigationStatus[] = []

    for (const entity of entities) {
      for (const status of entity.statuses) {
        if (time >= status.startTime && time <= status.endTime) {
          activeStatuses.push(status)
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
    return this.getActiveStatuses([{ statuses: partyState.player.statuses }], time)
  }
}

/**
 * 创建减伤计算器实例
 */
export function createMitigationCalculator(): MitigationCalculator {
  return new MitigationCalculator()
}
