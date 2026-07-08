/**
 * 一次性治疗执行器工厂
 *
 * 在 cast.timestamp 时刻立即对 partyState.hp.current 加上 finalHeal，
 * clamp 到 [0, hp.max]，并通过 ctx.recordHeal 记录 HealSnapshot。
 *
 * 不挂状态；不参与 partial 段累积器；HP 已归 0 时仍可治疗（"复活"语义）。
 */

import type { ActionExecutor } from '@/types/mitigation'
import { applyDirectHeal } from './applyDirectHeal'

export interface HealExecutorOptions {
  /** 固定治疗量；指定时跳过 statistics 读取 */
  fixedAmount?: number
  /**
   * 治疗量来源 ID，缺省 = ctx.actionId。指定时同时改 recordHeal 的 actionId 归属——
   * 让"主 cast 触发但治疗量来自其他技能"（如全大赦给医治追加的附属治疗）能在日志/统计里
   * 与主治疗区分。来源 ID 形如 1001219（=1e6+statusId）时日志会反查 statusRegistry。
   */
  amountSourceId?: number
}

export function createHealExecutor(options?: HealExecutorOptions): ActionExecutor {
  const fixedAmount = options?.fixedAmount
  const amountSourceId = options?.amountSourceId

  return ctx => {
    const sourceId = amountSourceId ?? ctx.actionId
    const baseAmount = fixedAmount ?? ctx.statistics?.healByAbility?.[sourceId] ?? 0

    return applyDirectHeal(
      ctx.partyState,
      baseAmount,
      {
        castEventId: ctx.castEventId ?? '',
        actionId: sourceId,
        sourcePlayerId: ctx.sourcePlayerId,
        time: ctx.useTime,
      },
      ctx.recordHeal
    )
  }
}
