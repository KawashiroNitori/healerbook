/**
 * 友方 Buff 执行器工厂
 */

import type { ActionExecutor } from '@/types/mitigation'
import type { PerformanceType } from '@/types/status'
import { addStatus } from './statusHelpers'

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

  /** 层数 */
  stack?: number
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

  return ctx =>
    addStatus(ctx.partyState, {
      statusId,
      eventTime: ctx.useTime,
      duration,
      stack: options?.stack ?? 1,
      sourceActionId: ctx.actionId,
      sourcePlayerId: ctx.sourcePlayerId,
      ...(performance !== undefined ? { performance } : {}),
      // 互斥替换：uniqueGroup 非空时移除同组旧 buff（新实例带新 instanceId 是正确语义）；
      // 空数组关闭互斥，多实例共存
      replaces: uniqueGroup.length > 0 ? s => uniqueGroup.includes(s.statusId) : undefined,
    })
}
