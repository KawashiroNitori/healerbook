import { describe, it, expect } from 'vitest'
import { createPlacementEngine } from './engine'
import { whileStatus, not } from './combinators'
import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { StatusInterval } from '@/types/status'

const INF = Number.POSITIVE_INFINITY
const NEG_INF = Number.NEGATIVE_INFINITY

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
  it('无 placement，无 cast → getValidIntervals = [(-∞, +∞)]', () => {
    const action = makeAction({ id: 1 })
    const engine = createPlacementEngine({
      castEvents: [],
      actions: new Map([[1, action]]),
      simulate: () => ({ statusTimelineByPlayer: new Map() }),
    })
    expect(engine.getValidIntervals(action, 10)).toEqual([{ from: NEG_INF, to: INF }])
  })

  it('负时间区（prepull）可放置：canPlaceCastEvent 在 t=-10 处合法', () => {
    // 回归：复盘时间轴从 TIMELINE_START_TIME = -30 开始，允许在 prepull 区段放技能；
    // 早期 complement 硬编码 [0, +∞) 导致负时间被禁。
    const action = makeAction({ id: 1 })
    const engine = createPlacementEngine({
      castEvents: [],
      actions: new Map([[1, action]]),
      simulate: () => ({ statusTimelineByPlayer: new Map() }),
    })
    expect(engine.canPlaceCastEvent(action, 10, -10).ok).toBe(true)
    expect(engine.canPlaceCastEvent(action, 10, -25).ok).toBe(true)
  })

  it('一次 cast 两侧都形成 CD 禁区（前向与已有 CD 条重叠、后向自己 CD 未到）', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const castEvents: CastEvent[] = [
      { id: 'c1', actionId: 1, playerId: 10, timestamp: 90 } as unknown as CastEvent,
    ]
    const engine = createPlacementEngine({
      castEvents,
      actions: new Map([[1, action]]),
      simulate: () => ({ statusTimelineByPlayer: new Map() }),
    })
    // forbidden = [90-60, 90+60) = [30, 150)，valid = (-∞, 30) ∪ [150, INF)
    expect(engine.getValidIntervals(action, 10)).toEqual([
      { from: NEG_INF, to: 30 },
      { from: 150, to: INF },
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
      castEvents: [{ id: 'c1', actionId: 1, playerId: 10, timestamp: 100 } as unknown as CastEvent],
      actions: new Map([[1, action]]),
      simulate: () => ({ statusTimelineByPlayer: timeline }),
    })
    // placement = [20, 50)；CD forbidden = [100-60, 100+60) = [40, 160)，CD valid = [0, 40) ∪ [160, ∞)
    // 交集 = [20, 40)
    expect(engine.getValidIntervals(action, 10)).toEqual([{ from: 20, to: 40 }])
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

  it('findInvalidCastEvents: 两个 CD 条紧贴（t_B = t_A + cd_A）不算冲突，任意一个都不被标红', () => {
    // 回归：半开区间表示下 forbidden = [t_A - cd_B, t_A + cd_A) 左闭会把 t_B = t_A + cd_A 判进禁区，
    // 但实际两条 CD 刚好首尾相接 [t_A, t_A + cd_A) 与 [t_B, t_B + cd_B) 不相交。
    // findInvalidCastEvents 改用严格重叠 (<) 后该假阳性消失。
    const A = {
      id: 'A',
      actionId: 2,
      playerId: 10,
      timestamp: 60,
    } as unknown as CastEvent
    const B = {
      id: 'B',
      actionId: 2,
      playerId: 10,
      timestamp: 70,
    } as unknown as CastEvent
    const e = createPlacementEngine({
      castEvents: [A, B],
      actions: new Map([
        [1, primary],
        [2, variant],
      ]),
      simulate: () => ({ statusTimelineByPlayer: timeline }),
    })
    // variant cd=10；A 在 60、B 在 70 —— A 的 CD [60,70) 与 B 的 CD [70,80) 恰好紧贴。
    // 但 A 和 B 都位于 BUFF [20,50) 之外 → placement_lost。所以要单独排除 cooldown_conflict：
    const invalid = e.findInvalidCastEvents()
    for (const r of invalid) {
      expect(r.reason).not.toBe('cooldown_conflict')
      expect(r.reason).not.toBe('both')
    }
  })

  it('findInvalidCastEvents: 紧贴边界带浮点误差时不应误判 cooldown_conflict（回归）', () => {
    // 真实场景：FFLogs 导入 (ms/1000)、拖拽 snap (x/zoom)、shadow 端点 (ts + cd) 等路径
    // 都可能让 timestamp 带 1~2 ULP 级（~1e-15）的偏差。engine.ts 裸 `<` 比较在
    // B.ts 和 A.ts + cdA 的浮点近似差 1 ULP 时会把"紧贴"误报为重叠。
    // 症状：两个相邻 cast 都亮红框；拖到右边界时 shadow.from vs timestamp 同样翻转
    // 导致 dragBounds.rightBoundary = Infinity，可以被自由拖出合法区。
    const cd = 10
    const action = makeAction({ id: 99, cooldown: cd, duration: 0 })
    // 20 附近的 ULP ≈ 3.55e-15；+5e-15 跨过半 ULP 上舍入到下一个 double，
    // 保证 A_ts + cd 严格大于 B_ts = 30（数学上紧贴）。
    const A_ts = 20 + 5e-15
    const B_ts = 30
    const A = { id: 'A', actionId: 99, playerId: 10, timestamp: A_ts } as unknown as CastEvent
    const B = { id: 'B', actionId: 99, playerId: 10, timestamp: B_ts } as unknown as CastEvent
    const e = createPlacementEngine({
      castEvents: [A, B],
      actions: new Map([[99, action]]),
      simulate: () => ({ statusTimelineByPlayer: new Map() }),
    })
    // 自检：构造的浮点误差真实存在（IEEE 754 环境下恒成立）
    expect(A_ts + cd).toBeGreaterThan(B_ts)
    // 即便 A + cd > B（浮点），两者语义上紧贴首尾相接，都不应被标红
    expect(e.findInvalidCastEvents()).toEqual([])
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

describe('createPlacementEngine — excludeCastEventId 重放', () => {
  it('排除 consume 型 cast 后，状态 interval 应恢复到原时长', () => {
    // 模拟：节制 16536 在 t=10 附加 status 1873（duration 25）→ [10, 35)
    //       神爱抚 37011 在 t=20 consume 1873 → [10, 20)
    // 排除神爱抚 cast 后应看到 [10, 35)
    const simulate = (events: CastEvent[]) => {
      const has16536 = events.some(e => e.actionId === 16536)
      const has37011 = events.some(e => e.actionId === 37011)
      if (has16536 && has37011) {
        return {
          statusTimelineByPlayer: new Map([
            [
              10,
              new Map([
                [
                  1873,
                  [
                    {
                      from: 10,
                      to: 20,
                      stacks: 1,
                      sourcePlayerId: 10,
                      sourceCastEventId: 'c16536',
                    } as StatusInterval,
                  ],
                ],
              ]),
            ],
          ]),
        }
      }
      if (has16536) {
        return {
          statusTimelineByPlayer: new Map([
            [
              10,
              new Map([
                [
                  1873,
                  [
                    {
                      from: 10,
                      to: 35,
                      stacks: 1,
                      sourcePlayerId: 10,
                      sourceCastEventId: 'c16536',
                    } as StatusInterval,
                  ],
                ],
              ]),
            ],
          ]),
        }
      }
      return { statusTimelineByPlayer: new Map() }
    }

    const temperance = makeAction({ id: 16536, cooldown: 120 })
    const grace = makeAction({
      id: 37011,
      cooldown: 1,
      placement: whileStatus(1873),
    })
    const castEvents: CastEvent[] = [
      { id: 'c16536', actionId: 16536, playerId: 10, timestamp: 10 } as unknown as CastEvent,
      { id: 'c37011', actionId: 37011, playerId: 10, timestamp: 20 } as unknown as CastEvent,
    ]
    const engine = createPlacementEngine({
      castEvents,
      actions: new Map([
        [16536, temperance],
        [37011, grace],
      ]),
      simulate,
    })

    // 默认：grace 合法 = placement [10, 20) ∩ CD 可用。同 effectiveTrackGroup 只有 c37011 自己；
    // 放置 grace (cd=1) 与已有 grace (cd=1 at 20) 冲突区间 = [20-1, 20+1) = [19, 21)
    // CD valid = [0, 19) ∪ [21, INF)；∩ [10, 20) = [10, 19)
    expect(engine.getValidIntervals(grace, 10)).toEqual([{ from: 10, to: 19 }])

    // 排除 c37011 自身后，CD 无约束；placement 恢复为重放后的 [10, 35)
    const withExclude = engine.getValidIntervals(grace, 10, 'c37011')
    expect(withExclude).toEqual([{ from: 10, to: 35 }])
  })

  it('同一 excludeId 多次查询只触发 1 次 simulate（缓存命中）', () => {
    let calls = 0
    const simulate = () => {
      calls++
      return { statusTimelineByPlayer: new Map() }
    }
    const action = makeAction({ id: 1 })
    const engine = createPlacementEngine({
      castEvents: [{ id: 'c1', actionId: 1, playerId: 10, timestamp: 0 } as unknown as CastEvent],
      actions: new Map([[1, action]]),
      simulate,
    })
    // 构造时 1 次
    expect(calls).toBe(1)
    engine.getValidIntervals(action, 10, 'c1')
    engine.getValidIntervals(action, 10, 'c1')
    engine.findInvalidCastEvents('c1')
    // excludeId 命中缓存，应只再增加 1
    expect(calls).toBe(2)
  })
})
