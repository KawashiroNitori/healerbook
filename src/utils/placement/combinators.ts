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

/**
 * 指定（绝对）时间区间算子。返回与上下文无关的常量区间 `[from, to)`，单位秒。
 *
 * 两端均可省略以表达半开窗口：`from` 默认 `-∞`（含 prepull 段，与 `complement`
 * 的下界语义一致），`to` 默认 `+∞`。也可显式传入 `Number.NEGATIVE_INFINITY` /
 * `Number.POSITIVE_INFINITY`。
 *
 * 典型用法是配合 `allOf` 把其他规则限制在某个绝对时间窗内：
 *   `allOf(whileStatus(123), timeRange(60))`  // 仅 60s 之后的 buff 窗口
 *
 * 退化区间（`from >= to`）返回空数组（永不可放）。
 */
export function timeRange(
  from: number = Number.NEGATIVE_INFINITY,
  to: number = Number.POSITIVE_INFINITY
): Placement {
  return {
    validIntervals: () => (from < to ? [{ from, to }] : []),
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
        return [{ from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY }]
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
