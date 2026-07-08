/**
 * 盾值执行器工厂
 */

import type { ActionExecutor } from '@/types/mitigation'
import { addStatus } from './statusHelpers'
import { computeFinalHeal } from './healMath'

/**
 * 盾值执行器配置选项
 */
export interface ShieldExecutorOptions {
  /** 互斥组：添加新盾前会删除这些 statusId 的旧盾，默认为 [statusId] */
  uniqueGroup?: number[]
  /** 层数：盾值耗尽后会减少层数并重置盾值，默认为 1 */
  stack?: number
  /** 固定盾值：指定时跳过从 statistics 读取，直接使用此值 */
  fixedBarrier?: number
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
  const fixedBarrier = options?.fixedBarrier

  return ctx => {
    const baseBarrier = fixedBarrier ?? ctx.statistics?.shieldByAbility?.[statusId] ?? 10000
    const barrier = computeFinalHeal(baseBarrier, ctx.partyState, ctx.sourcePlayerId, ctx.useTime)

    return addStatus(ctx.partyState, {
      statusId,
      eventTime: ctx.useTime,
      duration,
      sourceActionId: ctx.actionId,
      sourcePlayerId: ctx.sourcePlayerId,
      remainingBarrier: barrier,
      initialBarrier: barrier, // 保存初始盾值用于重置
      stack,
      // 原生盾：barrier 就是它全部意义，归 0 即由 calculator 自动清扫
      removeOnBarrierBreak: true,
      // 互斥替换：uniqueGroup 非空时移除同组旧盾（新实例带新 instanceId 是正确语义）；
      // 空数组关闭互斥，多盾共存
      replaces: uniqueGroup.length > 0 ? s => uniqueGroup.includes(s.statusId) : undefined,
    })
  }
}
