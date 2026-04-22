import { describe, it, expect } from 'vitest'
import { createPlacementEngine } from './engine'
import { whileStatus, not } from './combinators'
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

describe('createPlacementEngine — shadow / unique / findInvalid', () => {
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

  const primary = makeAction({
    id: 1,
    cooldown: 10,
    placement: {
      validIntervals: ctx =>
        whileStatus(BUFF).validIntervals(ctx).length === 0
          ? [{ from: 0, to: Number.POSITIVE_INFINITY }]
          : not(whileStatus(BUFF)).validIntervals(ctx),
    },
  })
  const variant = makeAction({
    id: 2,
    trackGroup: 1,
    cooldown: 10,
    placement: whileStatus(BUFF),
  })

  const engine = createPlacementEngine({
    castEvents: [],
    actions: new Map([
      [1, primary],
      [2, variant],
    ]),
    simulate: () => ({ statusTimelineByPlayer: timeline }),
  })

  it('computeTrackShadow: 两成员 union 的补集', () => {
    // primary 合法 = !whileStatus = [0,20) ∪ [50,∞)，variant 合法 = [20,50)
    // union 覆盖全时间轴 → shadow 为空
    expect(engine.computeTrackShadow(1, 10)).toEqual([])
  })

  it('pickUniqueMember: buff 期间唯一解 = variant', () => {
    expect(engine.pickUniqueMember(1, 10, 30)?.id).toBe(2)
    expect(engine.pickUniqueMember(1, 10, 10)?.id).toBe(1)
  })

  it('canPlaceCastEvent: buff 期间 primary 非法', () => {
    const r = engine.canPlaceCastEvent(primary, 10, 30)
    expect(r.ok).toBe(false)
  })

  it('findInvalidCastEvents: 区分 placement_lost / cooldown_conflict / both', () => {
    const castEvents: CastEvent[] = [
      // buff 期间放了 primary（t=45，避开下面 variant 的 CD 窗口 [25,35)/[28,38)）→ placement_lost
      { id: 'bad1', actionId: 1, playerId: 10, timestamp: 45 } as unknown as CastEvent,
      // variant 两次互相 CD 冲突：bad2 CD=[25,35)，bad3 t=28 落在 bad2 CD 内
      { id: 'bad2', actionId: 2, playerId: 10, timestamp: 25 } as unknown as CastEvent,
      { id: 'bad3', actionId: 2, playerId: 10, timestamp: 28 } as unknown as CastEvent,
    ]
    const e = createPlacementEngine({
      castEvents,
      actions: new Map([
        [1, primary],
        [2, variant],
      ]),
      simulate: () => ({ statusTimelineByPlayer: timeline }),
    })
    const invalid = e.findInvalidCastEvents()
    const byId = new Map(invalid.map(r => [r.castEvent.id, r.reason]))
    expect(byId.get('bad1')).toBe('placement_lost')
    // bad3 距 bad2 只差 3s，variant CD=10 → 互斥。bad3 在 buff 期间 placement 合法 → 仅 cooldown_conflict
    expect(byId.get('bad3')).toBe('cooldown_conflict')
  })

  it('findInvalidCastEvents: 单个合法 cast 不会因自身 CD 把自己挡掉（自冲突防御）', () => {
    // 回归测试：cooldownAvailable 遍历同轨 castEvents 时必须排除"正在回溯的 cast"自己，
    // 否则 cast 自身的 [timestamp, timestamp + cooldown) 会包含其 timestamp，
    // 导致 cooldownOk=false 产生假阳性。
    const SOLO: CastEvent = {
      id: 'solo',
      actionId: 2,
      playerId: 10,
      timestamp: 30,
    } as unknown as CastEvent
    const e = createPlacementEngine({
      castEvents: [SOLO],
      actions: new Map([
        [1, primary],
        [2, variant],
      ]),
      simulate: () => ({ statusTimelineByPlayer: timeline }),
    })
    expect(e.findInvalidCastEvents()).toEqual([])
  })
})
