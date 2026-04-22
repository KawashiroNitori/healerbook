import { describe, it, expect } from 'vitest'
import { whileStatus, anyOf, allOf, not, difference } from './combinators'
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

describe('anyOf / allOf / not / difference', () => {
  const a = { validIntervals: () => [{ from: 0, to: 10 }] }
  const b = { validIntervals: () => [{ from: 5, to: 15 }] }

  it('anyOf: union', () => {
    expect(anyOf(a, b).validIntervals(buildCtx())).toEqual([{ from: 0, to: 15 }])
  })

  it('allOf: intersection', () => {
    expect(allOf(a, b).validIntervals(buildCtx())).toEqual([{ from: 5, to: 10 }])
  })

  it('not: complement', () => {
    const INF = Number.POSITIVE_INFINITY
    expect(not(a).validIntervals(buildCtx())).toEqual([{ from: 10, to: INF }])
  })

  it('difference: A - B', () => {
    expect(difference(a, b).validIntervals(buildCtx())).toEqual([{ from: 0, to: 5 }])
  })
})
