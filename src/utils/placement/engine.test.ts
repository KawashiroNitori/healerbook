import { describe, it, expect } from 'vitest'
import { createPlacementEngine } from './engine'
import { whileStatus } from './combinators'
import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { StatusInterval } from '@/types/status'

const INF = Number.POSITIVE_INFINITY

function makeAction(partial: Partial<MitigationAction> & { id: number }): MitigationAction {
  return {
    name: 'A',
    icon: '',
    jobs: [] as unknown as MitigationAction['jobs'],
    category: ['partywide'],
    duration: 30,
    cooldown: 60,
    ...partial,
  } as MitigationAction
}

describe('createPlacementEngine — 基础查询', () => {
  it('无 placement，无 cast → getValidIntervals = [[0, +∞)]', () => {
    const action = makeAction({ id: 1 })
    const engine = createPlacementEngine({
      castEvents: [],
      actions: new Map([[1, action]]),
      simulate: () => ({ statusTimelineByPlayer: new Map() }),
    })
    expect(engine.getValidIntervals(action, 10)).toEqual([{ from: 0, to: INF }])
  })

  it('一次 cast 产生 CD 禁区', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const castEvents: CastEvent[] = [
      { id: 'c1', actionId: 1, playerId: 10, timestamp: 30 } as unknown as CastEvent,
    ]
    const engine = createPlacementEngine({
      castEvents,
      actions: new Map([[1, action]]),
      simulate: () => ({ statusTimelineByPlayer: new Map() }),
    })
    expect(engine.getValidIntervals(action, 10)).toEqual([
      { from: 0, to: 30 },
      { from: 90, to: INF },
    ])
  })

  it('placement ∩ CD', () => {
    const BUFF = 3885
    const timeline = new Map([
      [
        10,
        new Map([
          [
            BUFF,
            [
              {
                from: 20,
                to: 50,
                stacks: 1,
                sourcePlayerId: 10,
                sourceCastEventId: 'a',
              } as StatusInterval,
            ],
          ],
        ]),
      ],
    ])
    const action = makeAction({
      id: 1,
      cooldown: 60,
      placement: { validIntervals: ctx => whileStatus(BUFF).validIntervals(ctx) },
    })
    const engine = createPlacementEngine({
      castEvents: [{ id: 'c1', actionId: 1, playerId: 10, timestamp: 25 } as unknown as CastEvent],
      actions: new Map([[1, action]]),
      simulate: () => ({ statusTimelineByPlayer: timeline }),
    })
    // placement = [20, 50)，CD = [0, 25) ∪ [85, ∞)；交集 = [20, 25)
    expect(engine.getValidIntervals(action, 10)).toEqual([{ from: 20, to: 25 }])
  })
})
