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
   * 治疗量来源 actionId，缺省 = ctx.actionId。
   * 罕见场景下（一个 cast 的"治疗效果"绑在另一个 statId 上）使用。
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
        actionId: ctx.actionId,
        sourcePlayerId: ctx.sourcePlayerId,
        time: ctx.useTime,
      },
      ctx.recordHeal
    )
  }
}
