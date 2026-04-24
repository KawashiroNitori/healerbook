/**
 * 友方 Buff 执行器工厂
 */

import type { ActionExecutor } from '@/types/mitigation'
import type { MitigationStatus, PerformanceType } from '@/types/status'
import { generateId } from './utils'

/**
 * Buff 执行器配置选项
 */
export interface BuffExecutorOptions {
  /** 互斥组：添加新 buff 前会删除这些 statusId 的旧 buff，默认为 [statusId] */
  uniqueGroup?: number[]
  /**
   * 覆写 metadata.performance 的固定快照值。需要基于 partyState 做条件判断的话，
   * 直接在 call site 包一层 executor 即可，不必绕回 option。
   */
  performance?: PerformanceType
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
  const performance = options?.performance

  return ctx => {
    // 删除互斥组中的旧状态
    const filteredStatuses = ctx.partyState.statuses.filter(s => !uniqueGroup.includes(s.statusId))

    const newStatus: MitigationStatus = {
      instanceId: generateId(),
      statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      stack: 1,
      sourceActionId: ctx.actionId,
      sourcePlayerId: ctx.sourcePlayerId,
    }

    if (performance !== undefined) {
      newStatus.performance = performance
    }

    return {
      ...ctx.partyState,
      statuses: [...filteredStatuses, newStatus],
    }
  }
}
