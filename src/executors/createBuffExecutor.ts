/**
 * 友方 Buff 执行器工厂
 */

import type { ActionExecutionContext, ActionExecutor } from '@/types/mitigation'
import type { MitigationStatus, PerformanceType } from '@/types/status'
import { generateId } from './utils'

/**
 * Buff 执行器配置选项
 */
export interface BuffExecutorOptions {
  /** 互斥组：添加新 buff 前会删除这些 statusId 的旧 buff，默认为 [statusId] */
  uniqueGroup?: number[]
  /**
   * 条件性 performance 计算器；cast 时调用，返回 undefined 则走 metadata 默认值
   * （snapshot-on-apply：值在 cast 时固化，之后不再随 state 变化）
   */
  performance?: (ctx: ActionExecutionContext) => PerformanceType | undefined
}

/**
 * 创建 Buff 执行器
 * @param statusId 状态 ID
 * @param duration 持续时间（秒）
 * @param options 可选配置
 * @returns 技能执行器
 */
export function createBuffExecutor(
  statusId: number,
  duration: number,
  options?: BuffExecutorOptions
): ActionExecutor {
  const uniqueGroup = options?.uniqueGroup ?? [statusId]
  const performanceCalc = options?.performance

  return ctx => {
    // 删除互斥组中的旧状态
    const filteredStatuses = ctx.partyState.statuses.filter(s => !uniqueGroup.includes(s.statusId))

    const newStatus: MitigationStatus = {
      instanceId: generateId(),
      statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      sourceActionId: ctx.actionId,
      sourcePlayerId: ctx.sourcePlayerId,
    }

    const computedPerformance = performanceCalc?.(ctx)
    if (computedPerformance !== undefined) {
      newStatus.performance = computedPerformance
    }

    return {
      ...ctx.partyState,
      statuses: [...filteredStatuses, newStatus],
    }
  }
}
