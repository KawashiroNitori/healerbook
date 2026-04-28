/**
 * HoT 状态自带的 onTick：每 3s 网格 +tickAmount 到 hp.current，clamp 到 hp.max。
 *
 * 抽出独立文件以避免 statusExtras → executors → healMath → statusRegistry →
 * statusExtras 的循环依赖（regenStatusExecutor 不依赖 healMath）。
 *
 * 在 STATUS_EXTRAS 中给所有 HoT statusId 注册此 executor 即可。
 */

import type { StatusExecutor } from '@/types/status'

export const regenStatusExecutor: StatusExecutor = {
  onTick: ctx => {
    if (!ctx.partyState.hp) return
    const tickAmount = (ctx.status.data?.tickAmount as number | undefined) ?? 0
    if (tickAmount <= 0) return

    const before = ctx.partyState.hp.current
    const next = Math.min(before + tickAmount, ctx.partyState.hp.max)
    const applied = next - before
    const overheal = tickAmount - applied

    ctx.recordHeal?.({
      castEventId: (ctx.status.data?.castEventId as string | undefined) ?? '',
      actionId: ctx.status.sourceActionId ?? 0,
      sourcePlayerId: ctx.status.sourcePlayerId ?? 0,
      time: ctx.tickTime,
      baseAmount: tickAmount,
      finalHeal: tickAmount,
      applied,
      overheal,
      isHotTick: true,
    })

    return { ...ctx.partyState, hp: { ...ctx.partyState.hp, current: next } }
  },
}
