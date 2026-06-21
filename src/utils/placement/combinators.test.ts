import { describe, it, expect } from 'vitest'
import { whileStatus, timeRange, anyOf, allOf, not, difference } from './combinators'
import type { PlacementContext, StatusTimelineByPlayer } from './types'

function buildCtx(overrides: Partial<PlacementContext> = {}): PlacementContext {
  const timeline: StatusTimelineByPlayer = overrides.statusTimelineByPlayer ?? new Map()
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    action: { id: 0 } as any,
    playerId: 1,
    castEvents: [],
    actions: new Map(),
    statusTimelineByPlayer: timeline,
    ...overrides,
  }
}

describe('whileStatus', () => {
  it('只保留 target = source = ctx.playerId 的 interval', () => {
    const timeline: StatusTimelineByPlayer = new Map([
      [
        1,
        new Map([
          [
            3885,
            [
              { from: 0, to: 30, stacks: 1, sourcePlayerId: 1, sourceCastEventId: 'a' },
              { from: 50, to: 60, stacks: 1, sourcePlayerId: 2, sourceCastEventId: 'b' },
            ],
          ],
        ]),
      ],
    ])
    const ctx = buildCtx({ statusTimelineByPlayer: timeline, playerId: 1 })
    expect(whileStatus(3885).validIntervals(ctx)).toEqual([{ from: 0, to: 30 }])
  })

  it('无匹配条目返回空数组', () => {
    expect(whileStatus(9999).validIntervals(buildCtx())).toEqual([])
  })
})

describe('timeRange', () => {
  const INF = Number.POSITIVE_INFINITY
  const NEG_INF = Number.NEGATIVE_INFINITY

  it('两端均指定：返回单个常量区间', () => {
    expect(timeRange(0, 60).validIntervals(buildCtx())).toEqual([{ from: 0, to: 60 }])
  })

  it('省略 to：默认 +∞', () => {
    expect(timeRange(30).validIntervals(buildCtx())).toEqual([{ from: 30, to: INF }])
  })

  it('省略 from：默认 -∞（含 prepull 段）', () => {
    expect(timeRange(undefined, 60).validIntervals(buildCtx())).toEqual([{ from: NEG_INF, to: 60 }])
  })

  it('两端均省略：全时间轴', () => {
    expect(timeRange().validIntervals(buildCtx())).toEqual([{ from: NEG_INF, to: INF }])
  })

  it('可显式传入 ±∞', () => {
    expect(timeRange(NEG_INF, INF).validIntervals(buildCtx())).toEqual([{ from: NEG_INF, to: INF }])
  })

  it('退化区间（from >= to）返回空数组', () => {
    expect(timeRange(60, 60).validIntervals(buildCtx())).toEqual([])
    expect(timeRange(60, 30).validIntervals(buildCtx())).toEqual([])
  })

  it('配合 allOf 把规则限制在绝对时间窗内', () => {
    const status = { validIntervals: () => [{ from: 0, to: 100 }] }
    expect(allOf(status, timeRange(30, 60)).validIntervals(buildCtx())).toEqual([
      { from: 30, to: 60 },
    ])
  })
})

describe('anyOf / allOf / not / difference', () => {
  const a = { validIntervals: () => [{ from: 0, to: 10 }] }
  const b = { validIntervals: () => [{ from: 5, to: 15 }] }

  it('anyOf: union', () => {
    expect(anyOf(a, b).validIntervals(buildCtx())).toEqual([{ from: 0, to: 15 }])
  })

  it('allOf: intersection', () => {
    expect(allOf(a, b).validIntervals(buildCtx())).toEqual([{ from: 5, to: 10 }])
  })

  it('not: complement（覆盖负时间，包含 prepull 区段）', () => {
    const INF = Number.POSITIVE_INFINITY
    const NEG_INF = Number.NEGATIVE_INFINITY
    expect(not(a).validIntervals(buildCtx())).toEqual([
      { from: NEG_INF, to: 0 },
      { from: 10, to: INF },
    ])
  })

  it('difference: A - B', () => {
    expect(difference(a, b).validIntervals(buildCtx())).toEqual([{ from: 0, to: 5 }])
  })
})
