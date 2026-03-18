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
  /** 是否使用暴击盾值（使用 critShieldByAbility），默认为 false */
  crit?: boolean
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
  const crit = options?.crit ?? false

  return ctx => {
    // 优先使用统计数据里的盾值，其次用兜底值 10000
    const shieldData = crit ? ctx.statistics?.critShieldByAbility : ctx.statistics?.shieldByAbility
    const barrier = Math.round((shieldData?.[statusId] ?? 10000) * multiplier)

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
