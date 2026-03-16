/**
 * 减伤计算引擎（基于状态）
 * 实现核心减伤计算逻辑
 */

import type { PartyState } from '@/types/partyState'
import type { MitigationStatus } from '@/types/status'
import type { StatusEvent } from '@/types/timeline'
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
    const activeStatuses = this.getActiveStatuses([{ statuses: partyState.statuses }], time)

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

    let damage = Math.round(originalDamage * multiplier)

    // 3. 计算盾值减伤
    const statusUpdates = new Map<string, Partial<MitigationStatus>>()
    let playerDamage = damage

    // 从 activeStatuses 中筛选盾值状态，并按开始时间排序
    const shieldStatuses = activeStatuses
      .filter(s => {
        const meta = getStatusById(s.statusId)
        return meta?.type === 'absorbed' && s.remainingBarrier && s.remainingBarrier > 0
      })
      .sort((a, b) => a.startTime - b.startTime)

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
    return this.getActiveStatuses([{ statuses: partyState.statuses }], time)
  }

  /**
   * 从状态快照计算减伤（回放模式专用）
   * 直接使用 FFLogs 记录的状态快照，不需要 PartyState
   */
  calculateFromSnapshot(
    originalDamage: number,
    statusEvents: StatusEvent[],
    packetId: number,
    damageType: DamageType,
    targetPlayerId: number
  ): CalculationResult {
    // 1. 过滤该 packetId、属于目标玩家或无目标的状态事件
    const activeStatusEvents = statusEvents.filter(
      event =>
        event.packetId === packetId &&
        (event.targetPlayerId === targetPlayerId || !event.targetPlayerId)
    )

    // 2. 转换为 MitigationStatus
    const statuses: MitigationStatus[] = []
    for (const event of activeStatusEvents) {
      const statusMeta = getStatusById(event.statusId)
      if (!statusMeta) continue

      statuses.push({
        instanceId: `${event.targetPlayerId}-${event.statusId}-${event.targetInstance || 0}`,
        statusId: event.statusId,
        startTime: event.startTime,
        endTime: event.endTime,
        sourcePlayerId: event.sourcePlayerId,
        remainingBarrier: statusMeta.type === 'absorbed' && event.absorb ? event.absorb : undefined,
      })
    }

    // 3. 计算百分比减伤
    let multiplier = 1.0
    const appliedStatuses: MitigationStatus[] = []

    for (const status of statuses) {
      const meta = getStatusById(status.statusId)
      if (!meta || meta.type !== 'multiplier') continue

      const damageMultiplier = this.getDamageMultiplier(meta.performance, damageType)
      multiplier *= damageMultiplier
      appliedStatuses.push(status)
    }

    let damage = originalDamage * multiplier

    // 4. 计算盾值减伤
    // 从 statuses 中筛选盾值状态，并按开始时间排序
    const shieldStatuses = statuses
      .filter(s => {
        const meta = getStatusById(s.statusId)
        return meta?.type === 'absorbed' && s.remainingBarrier && s.remainingBarrier > 0
      })
      .sort((a, b) => a.startTime - b.startTime)

    for (const status of shieldStatuses) {
      const absorbed = Math.min(damage, status.remainingBarrier!)
      damage -= absorbed
      appliedStatuses.push(status)

      if (damage <= 0) break
    }

    // 回放模式不需要 updatedPartyState
    return {
      originalDamage,
      finalDamage: Math.max(0, Math.round(damage)),
      mitigationPercentage:
        Math.round(((originalDamage - damage) / originalDamage) * 100 * 10) / 10,
      appliedStatuses,
    }
  }
}

/**
 * 创建减伤计算器实例
 */
export function createMitigationCalculator(): MitigationCalculator {
  return new MitigationCalculator()
}
