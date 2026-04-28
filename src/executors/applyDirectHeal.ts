/**
 * "直接治疗"应用助手：cast 时刻或 status 钩子触发的一次性治疗。
 *
 * 内置 computeFinalHeal（按当前 active heal/selfHeal buff 累乘），
 * 然后应用到 hp.current（clamp 到 hp.max），并记录 HealSnapshot。
 *
 * 不适用于 HoT tick——后者走 snapshot-on-apply 不需要再算 buff 倍率。
 */

import type { PartyState } from '@/types/partyState'
import type { HealSnapshot } from '@/types/healSnapshot'
import { computeFinalHeal } from './healMath'

export interface DirectHealMeta {
  castEventId: string
  actionId: number
  sourcePlayerId: number
  time: number
}

/**
 * 应用一次直接治疗，返回新的 PartyState；hp 未初始化或 baseAmount<=0 时原样返回。
 */
export function applyDirectHeal(
  partyState: PartyState,
  baseAmount: number,
  meta: DirectHealMeta,
  recordHeal?: (snap: HealSnapshot) => void
): PartyState {
  if (!partyState.hp) return partyState
  if (baseAmount <= 0) return partyState

  const finalHeal = computeFinalHeal(baseAmount, partyState, meta.sourcePlayerId, meta.time)
  const before = partyState.hp.current
  const next = Math.min(before + finalHeal, partyState.hp.max)
  const applied = next - before
  const overheal = finalHeal - applied

  recordHeal?.({
    castEventId: meta.castEventId,
    actionId: meta.actionId,
    sourcePlayerId: meta.sourcePlayerId,
    time: meta.time,
    baseAmount,
    finalHeal,
    applied,
    overheal,
    isHotTick: false,
  })

  return { ...partyState, hp: { ...partyState.hp, current: next } }
}
