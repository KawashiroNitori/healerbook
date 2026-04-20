/**
 * 减伤计算引擎（基于状态）
 * 实现核心减伤计算逻辑
 */

import type { PartyState } from '@/types/partyState'
import type { MitigationStatus } from '@/types/status'
import type { DamageEvent, DamageType } from '@/types/timeline'
import { getStatusById } from '@/utils/statusRegistry'

/**
 * 计算结果
 */
export interface CalculationResult {
  /** 原始伤害 */
  originalDamage: number
  /** 最终伤害（中位数） */
  finalDamage: number
  /** 最大伤害 */
  maxDamage: number
  /** 减伤百分比 */
  mitigationPercentage: number
  /** 应用的状态列表 */
  appliedStatuses: MitigationStatus[]
  /** 更新后的小队状态（盾值消耗后，回放模式下为 undefined） */
  updatedPartyState?: PartyState
  /** 非坦中位血量参考值（编辑模式填充） */
  referenceMaxHP?: number
}

/**
 * 减伤计算器
 */
export class MitigationCalculator {
  /**
   * 计算减伤后的最终伤害
   * 公式: 最终伤害 = 原始伤害 × (1-减伤1%) × (1-减伤2%) × ... - 盾值
   *
   * @param event 伤害事件（提供原始伤害、时间、攻击类型与伤害类型等）
   * @param partyState 小队状态
   * @returns 计算结果
   */
  calculate(event: DamageEvent, partyState: PartyState): CalculationResult {
    const originalDamage = event.damage
    const time = event.time
    const damageType: DamageType = event.damageType || 'physical'
    const snapshotTime = event.snapshotTime
    const attackType = event.type

    // 百分比减伤使用快照时间（DOT）或实际时间（普通伤害）
    const mitigationTime = snapshotTime ?? time

    // 死刑 / 普通攻击由坦克承担，坦克专属减伤才会生效；其他伤害只看非坦克专属状态
    const includeTankOnly = attackType === 'tankbuster' || attackType === 'auto'

    // 1 & 2. 遍历状态，计算百分比减伤 + 收集盾值状态
    let multiplier = 1.0
    const appliedStatuses: MitigationStatus[] = []
    const shieldStatuses: MitigationStatus[] = []

    for (const status of partyState.statuses) {
      const meta = getStatusById(status.statusId)
      if (!meta) continue
      if (meta.isTankOnly && !includeTankOnly) continue

      if (meta.type === 'multiplier') {
        // 百分比减伤：以快照时间为准
        if (mitigationTime >= status.startTime && mitigationTime <= status.endTime) {
          const damageMultiplier = this.getDamageMultiplier(meta.performance, damageType)
          multiplier *= damageMultiplier
          appliedStatuses.push(status)
        }
      } else if (meta.type === 'absorbed') {
        // 盾值：以实际时间为准
        if (
          time >= status.startTime &&
          time <= status.endTime &&
          status.remainingBarrier &&
          status.remainingBarrier > 0
        ) {
          shieldStatuses.push(status)
        }
      }
    }

    let damage = Math.round(originalDamage * multiplier)

    // 3. 计算盾值减伤
    shieldStatuses.sort((a, b) => a.startTime - b.startTime)

    const statusUpdates = new Map<string, Partial<MitigationStatus>>()
    let playerDamage = damage

    for (const status of shieldStatuses) {
      const absorbed = Math.min(playerDamage, status.remainingBarrier!)
      playerDamage -= absorbed

      // 如果状态还没在 appliedStatuses 中（百分比减伤阶段没添加），则添加
      if (!appliedStatuses.find(s => s.instanceId === status.instanceId)) {
        appliedStatuses.push(status)
      }

      const newRemainingBarrier = status.remainingBarrier! - absorbed

      // 处理多层盾逻辑
      if (newRemainingBarrier <= 0 && status.stack && status.stack > 1 && status.initialBarrier) {
        // 盾值耗尽但还有层数，减少层数并重置盾值
        statusUpdates.set(status.instanceId, {
          remainingBarrier: status.initialBarrier,
          stack: status.stack - 1,
        })
      } else {
        // 普通情况：更新剩余盾值
        statusUpdates.set(status.instanceId, {
          remainingBarrier: newRemainingBarrier,
        })
      }

      if (playerDamage <= 0) break
    }

    damage = playerDamage

    // 4. 更新盾值状态
    const updatedPartyState: PartyState = {
      ...partyState,
      statuses: partyState.statuses
        .map(s => {
          if (statusUpdates.has(s.instanceId)) {
            const updates = statusUpdates.get(s.instanceId)!
            return { ...s, ...updates }
          }
          return s
        })
        .filter(s => s.remainingBarrier === undefined || s.remainingBarrier > 0),
    }

    const mitigationPercentage = ((originalDamage - damage) / originalDamage) * 100

    return {
      originalDamage,
      finalDamage: Math.max(0, Math.round(damage)),
      maxDamage: Math.max(0, Math.round(damage)),
      mitigationPercentage: Math.round(mitigationPercentage * 10) / 10,
      appliedStatuses,
      updatedPartyState,
    }
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
      case 'darkness':
        return performance.darkness
      default:
        return 1.0
    }
  }
}

/**
 * 创建减伤计算器实例
 */
export function createMitigationCalculator(): MitigationCalculator {
  return new MitigationCalculator()
}
