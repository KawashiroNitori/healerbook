/**
 * 盾值执行器工厂
 */

import type { ActionExecutor } from '@/types/mitigation'
import type { MitigationStatus } from '@/types/status'
import { generateId } from './utils'

/**
 * 盾值执行器配置选项
 */
export interface ShieldExecutorOptions {
  /** 互斥组：添加新盾前会删除这些 statusId 的旧盾，默认为 [statusId] */
  uniqueGroup?: number[]
  /** 层数：盾值耗尽后会减少层数并重置盾值，默认为 1 */
  stack?: number
  /** 倍率：用于调整盾值的强度，默认为 1 */
  multiplier?: number
}

/**
 * 创建盾值执行器
 * @param statusId 状态 ID
 * @param duration 持续时间（秒）
 * @param options 可选配置
 * @returns 技能执行器
 */
export function createShieldExecutor(
  statusId: number,
  duration: number,
  options?: ShieldExecutorOptions
): ActionExecutor {
  const uniqueGroup = options?.uniqueGroup ?? [statusId]
  const stack = options?.stack ?? 1
  const multiplier = options?.multiplier ?? 1

  return ctx => {
    // 优先使用统计数据里的盾值，其次用兜底值 10000
    const barrier = Math.round((ctx.statistics?.shieldByAbility[statusId] ?? 10000) * multiplier)

    // 检查互斥组中是否有更强的盾
    // 比较规则：优先比较层数，层数相等再比较剩余盾量
    const hasStrongerShield = ctx.partyState.statuses.some(s => {
      if (!uniqueGroup.includes(s.statusId) || s.remainingBarrier === undefined) {
        return false
      }
      const existingStack = s.stack ?? 1

      // 优先比较层数
      if (existingStack > stack) {
        return true
      }

      // 层数相等，比较剩余盾量
      if (existingStack === stack && s.remainingBarrier > barrier) {
        return true
      }

      return false
    })

    // 如果存在更强的盾，放弃添加
    if (hasStrongerShield) {
      return ctx.partyState
    }

    // 删除互斥组中的旧状态
    const filteredStatuses = ctx.partyState.statuses.filter(s => !uniqueGroup.includes(s.statusId))

    const newStatus: MitigationStatus = {
      instanceId: generateId(),
      statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      sourceActionId: ctx.actionId,
      sourcePlayerId: ctx.sourcePlayerId,
      remainingBarrier: barrier,
      initialBarrier: barrier, // 保存初始盾值用于重置
      stack,
    }

    return {
      ...ctx.partyState,
      statuses: [...filteredStatuses, newStatus],
    }
  }
}
