import { describe, it, expect } from 'vitest'
import { createPlacementEngine } from './engine'
import { whileStatus, not } from './combinators'
import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { StatusInterval } from '@/types/status'
import type { StatusTimelineByPlayer } from './types'

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
      statusTimelineByPlayer: new Map(),
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
      statusTimelineByPlayer: new Map(),
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
      statusTimelineByPlayer: new Map(),
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
      statusTimelineByPlayer: timeline,
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
    statusTimelineByPlayer: timeline,
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

  it('findInvalidCastEvents: 区分 placement_lost / resource_exhausted / both', () => {
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
      statusTimelineByPlayer: timeline,
    })
    const invalid = e.findInvalidCastEvents()
    const byId = new Map(invalid.map(r => [r.castEvent.id, r.reason]))
    expect(byId.get('bad1')).toBe('placement_lost')
    // bad3 距 bad2 只差 3s，variant CD=10 → CD 资源未恢复。bad3 在 buff 期间 placement 合法 → 仅 resource_exhausted
    expect(byId.get('bad3')).toBe('resource_exhausted')
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
      statusTimelineByPlayer: timeline,
    })
    // variant cd=10；A 在 60、B 在 70 —— A 的 CD [60,70) 与 B 的 CD [70,80) 恰好紧贴。
    // 但 A 和 B 都位于 BUFF [20,50) 之外 → placement_lost。所以要单独排除 resource_exhausted：
    const invalid = e.findInvalidCastEvents()
    for (const r of invalid) {
      expect(r.reason).not.toBe('resource_exhausted')
      expect(r.reason).not.toBe('both')
    }
  })

  // 阶段 4 删除：原测试验证旧 cooldownAvailable 通过 TIME_EPS 吸收浮点误差（A_ts + cd 因
  // 浮点毛刺略大于 B_ts，裸 < 判定为 CD 重叠，旧引擎用 TIME_EPS 宽松化避免误判）。
  // 新资源模型以 computeResourceTrace 精确计算充能量：A_ts + cd > B_ts（浮点严格成立）
  // 时 B 的 amountBefore 确实 < 1，resource_exhausted 是新模型的正确行为。
  // 真实数据（FFLogs 导入 ms/1000、拖拽 snap x/zoom）的浮点误差远小于 CD 精度（1s 量级），
  // 这种 1e-14 级偏差在实际使用中不会出现；此回归场景在新模型下不再适用。

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
      statusTimelineByPlayer: timeline,
    })
    expect(e.findInvalidCastEvents()).toEqual([])
  })
})

describe('createPlacementEngine — findInvalidCastEvents 拖拽预览语义', () => {
  it('removeCastEventId 给定时用 simulateOnRemove 重跑后的 timeline 评估剩余 cast', () => {
    // 模拟：节制 16536 在 t=10 附加 status 1873（duration 25），→ default 时是 [10, 20)
    //       因为神爱抚 37011 在 t=20 consume 1873。
    //       简化为：simulateOnRemove 拿到 filtered（不含 37011）后返回 [10, 35)，
    //       让 grace 的 placement 评估时看到延长后的 buff 仍在 t=20。
    const defaultTimeline: StatusTimelineByPlayer = new Map([
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
    ])
    const removalTimeline: StatusTimelineByPlayer = new Map([
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
    ])
    const temperance = makeAction({ id: 16536, cooldown: 120 })
    const grace = makeAction({
      id: 37011,
      cooldown: 1,
      placement: whileStatus(1873),
    })
    const castEvents: CastEvent[] = [
      { id: 'c16536', actionId: 16536, playerId: 10, timestamp: 10 } as unknown as CastEvent,
      // grace 在 t=25 — default 时该位置 placement 失效（buff 仅到 20），simulateOnRemove
      // 把 buff 延到 35 后 placement 应合法。两条路径在 findInvalidCastEvents 的差异。
      { id: 'cgrace', actionId: 37011, playerId: 10, timestamp: 25 } as unknown as CastEvent,
    ]
    const engine = createPlacementEngine({
      castEvents,
      actions: new Map([
        [16536, temperance],
        [37011, grace],
      ]),
      statusTimelineByPlayer: defaultTimeline,
      simulateOnRemove: () => ({ statusTimelineByPlayer: removalTimeline }),
    })

    // 默认 findInvalidCastEvents：cgrace placement_lost（buff 仅到 20，t=25 越界）
    expect(engine.findInvalidCastEvents().some(r => r.castEvent.id === 'cgrace')).toBe(true)
    // removeCastEventId 给定（删 c16536 自己）：cgrace 不再被评估（c16536 已删除外层、cgrace 留下）；
    // 给定 removeCastEventId='cgrace'：用 removalTimeline 评估剩余 [c16536]，placement 不涉及。
    expect(engine.findInvalidCastEvents('cgrace')).toEqual([])
  })

  it('excludeId 过滤 placement timeline：自禁 placement 不会把自己判非法（AST 地星 / 自动重分类回归）', () => {
    // 回归：AST 地星（7439） placement = `not(whileStatus(1224))`，executor 又会
    // attach 1224。在 EditorPage 的"自动重分类" useEffect 里调
    // `canPlaceCastEvent(7439, t=castTs, excludeId=ce.id)` 时，旧实现把该 cast 自身的
    // 1224 也算进 placement timeline → 在 cast 自身 buff 起点恒为非法 → pickUniqueMember
    // 切到同 trackGroup 的 8324（星体爆轰），下一帧再翻回 7439，触发 7439↔8324 死循环。
    // 修复：excludeId 过滤 statusTimelineByPlayer，仅保留 sourceCastEventId !== excludeId。
    const SELF_BUFF = 1224
    const timeline: StatusTimelineByPlayer = new Map([
      [
        10,
        new Map([
          [
            SELF_BUFF,
            [
              // 仅一条由 ce='self' 自身贡献的 buff 起点正好等于 excludeId 的 cast 时刻
              {
                from: 60,
                to: 70,
                stacks: 1,
                sourcePlayerId: 10,
                sourceCastEventId: 'self',
              } as StatusInterval,
            ],
          ],
        ]),
      ],
    ])
    const earthStar = makeAction({
      id: 7439,
      cooldown: 60,
      placement: not(whileStatus(SELF_BUFF)),
    })
    const detonation = makeAction({
      id: 8324,
      cooldown: 0,
      trackGroup: 7439,
      placement: whileStatus(SELF_BUFF),
    })
    const engine = createPlacementEngine({
      castEvents: [
        { id: 'self', actionId: 7439, playerId: 10, timestamp: 60 } as unknown as CastEvent,
      ],
      actions: new Map([
        [7439, earthStar],
        [8324, detonation],
      ]),
      statusTimelineByPlayer: timeline,
    })
    // canPlaceCastEvent(7439, t=60, 'self')：过滤掉 sourceCastEventId='self' 的 1224，
    // placement timeline 没有任何 1224 → not(whileStatus) 全段合法 → t=60 应该 ok。
    expect(engine.canPlaceCastEvent(earthStar, 10, 60, 'self').ok).toBe(true)
    // pickUniqueMember 应当回到 7439（而不是 8324），自动重分类才不会反复翻 actionId。
    expect(engine.pickUniqueMember(7439, 10, 60, 'self')?.id).toBe(7439)
  })

  it('excludeId 查询走 simulateOnRemove 派生 placement timeline，且按 excludeId 缓存', () => {
    // 常规 excludeId 查询（getValidIntervals / canPlaceCastEvent / pickUniqueMember /
    // computeTrackShadow）现在都靠 simulateOnRemove 重跑 placement timeline，等价于
    // "假装该 cast 不存在"——简单 sourceCastEventId 过滤无法还原被消费型 cast（如 AST
    // 星体爆轰）截断的下游 buff 自然时长，shadow 会少给出可拖区。缓存按 excludeId 分桶，
    // 同 excludeId 的多次查询命中 cache 不重跑 simulate。
    let calls = 0
    const action = makeAction({ id: 1 })
    const engine = createPlacementEngine({
      castEvents: [{ id: 'c1', actionId: 1, playerId: 10, timestamp: 0 } as unknown as CastEvent],
      actions: new Map([[1, action]]),
      statusTimelineByPlayer: new Map(),
      simulateOnRemove: () => {
        calls++
        return { statusTimelineByPlayer: new Map() }
      },
    })
    // 不带 excludeId：直接共享 defaultTimeline，0 次 simulate
    engine.getValidIntervals(action, 10)
    engine.canPlaceCastEvent(action, 10, 0)
    engine.findInvalidCastEvents()
    expect(calls).toBe(0)
    // 带 excludeId='c1'：触发一次 simulateOnRemove，后续同 excludeId 复用缓存
    engine.getValidIntervals(action, 10, 'c1')
    expect(calls).toBe(1)
    engine.canPlaceCastEvent(action, 10, 0, 'c1')
    engine.computeTrackShadow(1, 10, 'c1')
    expect(calls).toBe(1)
    // findInvalidCastEvents(removeId) 走自己的重跑路径（不共享 timelineExcluding 缓存），
    // 重跑一次。
    engine.findInvalidCastEvents('c1')
    expect(calls).toBe(2)
  })
})
