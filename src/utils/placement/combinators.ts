import type { Placement, PlacementContext } from './types'
import { complement, intersect, mergeOverlapping, subtractIntervals } from './intervals'

/**
 * 玩家自己身上、自己施放的某个 status 的区间集。
 * 同时按 target playerId（statusTimelineByPlayer 的外层 key）与 sourcePlayerId
 * 过滤为 ctx.playerId——MVP 只覆盖“个人 buff”语义，raidwide 放到后续扩展。
 */
export function whileStatus(statusId: number): Placement {
  return {
    validIntervals: (ctx: PlacementContext) => {
      const byStatus = ctx.statusTimelineByPlayer.get(ctx.playerId)
      const raw = byStatus?.get(statusId) ?? []
      const filtered = raw.filter(si => si.sourcePlayerId === ctx.playerId)
      return mergeOverlapping(filtered.map(si => ({ from: si.from, to: si.to })))
    },
  }
}

export function anyOf(...rules: Placement[]): Placement {
  return {
    validIntervals: ctx => mergeOverlapping(rules.flatMap(r => r.validIntervals(ctx))),
  }
}

export function allOf(...rules: Placement[]): Placement {
  return {
    validIntervals: ctx => {
      if (rules.length === 0) {
        return [{ from: 0, to: Number.POSITIVE_INFINITY }]
      }
      return rules.map(r => r.validIntervals(ctx)).reduce((acc, next) => intersect(acc, next))
    },
  }
}

export function not(rule: Placement): Placement {
  return {
    validIntervals: ctx => complement(rule.validIntervals(ctx)),
  }
}

export function difference(a: Placement, b: Placement): Placement {
  return {
    validIntervals: ctx => subtractIntervals(a.validIntervals(ctx), b.validIntervals(ctx)),
  }
}
