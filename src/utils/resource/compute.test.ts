import { describe, it, expect } from 'vitest'
import { deriveResourceEvents, computeResourceTrace, computeResourceAmount } from './compute'
import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { ResourceDefinition } from '@/types/resource'

function makeAction(partial: Partial<MitigationAction> & { id: number }): MitigationAction {
  return {
    name: 'A',
    icon: '',
    jobs: [] as unknown as MitigationAction['jobs'],
    category: ['partywide'],
    duration: 0,
    cooldown: 60,
    ...partial,
  } as MitigationAction
}

function makeCast(partial: Partial<CastEvent> & { id: string; actionId: number }): CastEvent {
  return {
    playerId: 10,
    timestamp: 0,
    ...partial,
  } as CastEvent
}

describe('deriveResourceEvents', () => {
  it('无 resourceEffects 的 action 合成 __cd__:${id} 消耗事件', () => {
    const action = makeAction({ id: 101, cooldown: 60 })
    const events = deriveResourceEvents(
      [makeCast({ id: 'c1', actionId: 101, timestamp: 10 })],
      new Map([[101, action]])
    )
    const key = '10:__cd__:101'
    expect(events.get(key)).toEqual([
      {
        resourceKey: key,
        timestamp: 10,
        delta: -1,
        castEventId: 'c1',
        actionId: 101,
        playerId: 10,
        resourceId: '__cd__:101',
        required: true,
        orderIndex: 0,
      },
    ])
  })

  it('声明了消费者的 action → 不合成 __cd__，直接用 resourceEffects', () => {
    const action = makeAction({
      id: 16546,
      cooldown: 30,
      resourceEffects: [{ resourceId: 'sch:consolation', delta: -1 }],
    })
    const events = deriveResourceEvents(
      [makeCast({ id: 'c1', actionId: 16546, timestamp: 125 })],
      new Map([[16546, action]])
    )
    expect(events.has('10:__cd__:16546')).toBe(false)
    expect(events.get('10:sch:consolation')).toEqual([
      expect.objectContaining({
        resourceId: 'sch:consolation',
        delta: -1,
        castEventId: 'c1',
        timestamp: 125,
      }),
    ])
  })

  it('同 timestamp 多事件按 castEvents 原顺序稳定排序', () => {
    const a = makeAction({ id: 1, cooldown: 10 })
    const events = deriveResourceEvents(
      [
        makeCast({ id: 'first', actionId: 1, timestamp: 5 }),
        makeCast({ id: 'second', actionId: 1, timestamp: 5 }),
      ],
      new Map([[1, a]])
    )
    const arr = events.get('10:__cd__:1')!
    expect(arr.map(e => e.castEventId)).toEqual(['first', 'second'])
    expect(arr.map(e => e.orderIndex)).toEqual([0, 1])
  })

  it('未知 actionId 被忽略（no-op，不抛异常）', () => {
    const events = deriveResourceEvents(
      [makeCast({ id: 'x', actionId: 9999, timestamp: 0 })],
      new Map()
    )
    expect(events.size).toBe(0)
  })

  it('纯产出类（delta>0 only）仍合成 __cd__ 消耗（future-proof）', () => {
    const action = makeAction({
      id: 42,
      cooldown: 25,
      resourceEffects: [{ resourceId: 'wm:blood-lily', delta: +1 }],
    })
    const events = deriveResourceEvents(
      [makeCast({ id: 'c', actionId: 42, timestamp: 0 })],
      new Map([[42, action]])
    )
    // 既有 __cd__:42 消耗，也有 wm:blood-lily 产出
    expect(events.get('10:__cd__:42')?.[0].delta).toBe(-1)
    expect(events.get('10:wm:blood-lily')?.[0].delta).toBe(+1)
  })
})

function makeRe(partial: {
  timestamp: number
  delta: number
  index: number
}): import('@/types/resource').ResourceEvent {
  return {
    resourceKey: '10:test',
    playerId: 10,
    resourceId: 'test',
    castEventId: `c${partial.index}`,
    actionId: 1,
    required: true,
    orderIndex: partial.index,
    ...partial,
  }
}

describe('computeResourceTrace — 充能计时语义', () => {
  function makeDef(partial: Partial<ResourceDefinition>): ResourceDefinition {
    return {
      id: 'test',
      name: 'Test',
      job: 'SCH',
      initial: 2,
      max: 2,
      regen: { interval: 60, amount: 1 },
      ...partial,
    } as ResourceDefinition
  }

  it('单事件消耗调度单 refill，其 interval 秒后恢复', () => {
    const def = makeDef({ initial: 2, max: 2, regen: { interval: 60, amount: 1 } })
    const events = [makeRe({ timestamp: 45, delta: -1, index: 0 })]
    const trace = computeResourceTrace(def, events)
    expect(trace).toEqual([
      {
        index: 0,
        amountBefore: 2,
        amountAfter: 1,
        pendingAfter: [105], // 45 + 60
      },
    ])
  })

  it('充能计时核心回归：t=45 消耗 → refill 在 t=105 而非 t=60', () => {
    // D4 反例：草案固定钟会在 t=60 tick 补满，真实 FF14 是 t=105
    const def = makeDef({ initial: 2, max: 2, regen: { interval: 60, amount: 1 } })
    const events = [
      makeRe({ timestamp: 45, delta: -1, index: 0 }),
      // 模拟 t=60 查询时：refill@105 未触发 → amount=1（非 2）
    ]
    const trace = computeResourceTrace(def, events)
    // t=60 无事件，trace 只有一条 @ t=45；在 atTime=60 的 amount 由 computeResourceAmount 测；
    // 这里验证 pendingAfter[0] = 105 而不是 60
    expect(trace[0].pendingAfter).toEqual([105])
  })

  it('献奉双 cast @ t=0/30 连环消耗：pendingAfter 各独立调度', () => {
    const def = makeDef({ initial: 2, max: 2, regen: { interval: 60, amount: 1 } })
    const events = [
      makeRe({ timestamp: 0, delta: -1, index: 0 }),
      makeRe({ timestamp: 30, delta: -1, index: 1 }),
    ]
    const trace = computeResourceTrace(def, events)
    expect(trace).toEqual([
      { index: 0, amountBefore: 2, amountAfter: 1, pendingAfter: [60] },
      { index: 1, amountBefore: 1, amountAfter: 0, pendingAfter: [60, 90] },
    ])
  })

  it('产出溢出 clamp 到 max（上限）', () => {
    const def = makeDef({ initial: 2, max: 2, regen: undefined })
    const events = [makeRe({ timestamp: 0, delta: +2, index: 0 })]
    const trace = computeResourceTrace(def, events)
    expect(trace[0].amountAfter).toBe(2) // 2 + 2 clamp to 2
  })

  it('消耗不 clamp 下限（amount 可为负）', () => {
    const def = makeDef({ initial: 0, max: 2, regen: undefined })
    const events = [makeRe({ timestamp: 0, delta: -1, index: 0 })]
    const trace = computeResourceTrace(def, events)
    expect(trace[0].amountAfter).toBe(-1)
  })

  it('refill 触发穿插在事件之间', () => {
    const def = makeDef({ initial: 2, max: 2, regen: { interval: 30, amount: 1 } })
    const events = [
      makeRe({ timestamp: 0, delta: -1, index: 0 }), // schedule refill@30
      makeRe({ timestamp: 35, delta: -1, index: 1 }), // refill@30 先触发 → amount=2；然后消耗到 1
    ]
    const trace = computeResourceTrace(def, events)
    expect(trace[1].amountBefore).toBe(2)
    expect(trace[1].amountAfter).toBe(1)
  })

  it('无 regen 时消耗不调度 refill', () => {
    const def = makeDef({ initial: 2, max: 2, regen: undefined })
    const events = [makeRe({ timestamp: 0, delta: -1, index: 0 })]
    const trace = computeResourceTrace(def, events)
    expect(trace[0].pendingAfter).toEqual([])
  })

  it('|delta|=N 的消耗调度 N 个独立 refill（同 timestamp+interval）', () => {
    const def = makeDef({ initial: 2, max: 2, regen: { interval: 60, amount: 1 } })
    const events = [makeRe({ timestamp: 0, delta: -2, index: 0 })]
    const trace = computeResourceTrace(def, events)
    expect(trace[0].pendingAfter).toEqual([60, 60])
  })
})

describe('computeResourceAmount', () => {
  function makeDef(partial: Partial<ResourceDefinition>): ResourceDefinition {
    return {
      id: 'test',
      name: 'Test',
      job: 'SCH',
      initial: 2,
      max: 2,
      regen: { interval: 60, amount: 1 },
      ...partial,
    } as ResourceDefinition
  }

  it('无事件：返回 initial', () => {
    const def = makeDef({ initial: 2 })
    expect(computeResourceAmount(def, [], 100)).toBe(2)
  })

  it('atTime 早于任何事件：返回 initial', () => {
    const def = makeDef({ initial: 2 })
    const events = [makeRe({ timestamp: 45, delta: -1, index: 0 })]
    expect(computeResourceAmount(def, events, 40)).toBe(2)
  })

  it('献奉 t=45 消耗 → atTime=60 仍是 1（refill@105 未触发）', () => {
    const def = makeDef({ initial: 2, max: 2, regen: { interval: 60, amount: 1 } })
    const events = [makeRe({ timestamp: 45, delta: -1, index: 0 })]
    expect(computeResourceAmount(def, events, 60)).toBe(1)
    expect(computeResourceAmount(def, events, 104)).toBe(1)
    expect(computeResourceAmount(def, events, 105)).toBe(2)
    expect(computeResourceAmount(def, events, 200)).toBe(2)
  })

  it('献奉双 cast 连环：t=30 降 0、t=60 升 1、t=90 升 2', () => {
    const def = makeDef({ initial: 2, max: 2, regen: { interval: 60, amount: 1 } })
    const events = [
      makeRe({ timestamp: 0, delta: -1, index: 0 }),
      makeRe({ timestamp: 30, delta: -1, index: 1 }),
    ]
    expect(computeResourceAmount(def, events, 0)).toBe(1)
    expect(computeResourceAmount(def, events, 29)).toBe(1)
    expect(computeResourceAmount(def, events, 30)).toBe(0)
    expect(computeResourceAmount(def, events, 59)).toBe(0)
    expect(computeResourceAmount(def, events, 60)).toBe(1)
    expect(computeResourceAmount(def, events, 89)).toBe(1)
    expect(computeResourceAmount(def, events, 90)).toBe(2)
    expect(computeResourceAmount(def, events, 200)).toBe(2)
  })
})

describe('合成 __cd__: 资源与 cooldown 语义等价', () => {
  // 当 action 无 resourceEffects 时，compute 层合成 { max:1, initial:1, regen:{ interval:cd, amount:1 } }
  // 行为应与原 cooldownAvailable 对单充能 action 的判定等价
  function makeCdDef(interval: number): ResourceDefinition {
    return {
      id: `__cd__:test`,
      name: `Synthetic CD`,
      job: 'SCH',
      initial: 1,
      max: 1,
      regen: { interval, amount: 1 },
    }
  }

  it('单 cast @ t=0 (cd=60)：t<60 amount=0（冷却中），t>=60 amount=1（可用）', () => {
    const def = makeCdDef(60)
    const events = [makeRe({ timestamp: 0, delta: -1, index: 0 })]
    expect(computeResourceAmount(def, events, -1)).toBe(1) // cast 前
    expect(computeResourceAmount(def, events, 0)).toBe(0) // cast 时
    expect(computeResourceAmount(def, events, 59)).toBe(0) // cd 内
    expect(computeResourceAmount(def, events, 60)).toBe(1) // 紧贴 cd 结束
    expect(computeResourceAmount(def, events, 200)).toBe(1)
  })

  it('两 cast 紧贴 cd 边界 (t=0, t=60, cd=60)：都合法（amount 在 cast 前皆 ≥1）', () => {
    const def = makeCdDef(60)
    const events = [
      makeRe({ timestamp: 0, delta: -1, index: 0 }),
      makeRe({ timestamp: 60, delta: -1, index: 1 }),
    ]
    expect(computeResourceAmount(def, events, 60)).toBe(0) // 第二次 cast 之后
    expect(computeResourceAmount(def, events, 120)).toBe(1) // 第二次 cast 的 refill
  })

  it('两 cast 距离 < cd (t=0, t=30, cd=60)：第二次 cast 会把 amount 打到 -1（不 clamp 下限）', () => {
    const def = makeCdDef(60)
    const events = [
      makeRe({ timestamp: 0, delta: -1, index: 0 }),
      makeRe({ timestamp: 30, delta: -1, index: 1 }),
    ]
    // t=30 时 amount 已被打到 -1（cd 内 refill 未到、再减 1）——validator 用这个 <0 判非法
    expect(computeResourceAmount(def, events, 30)).toBe(-1)
    expect(computeResourceAmount(def, events, 60)).toBe(0) // refill@60 来了，-1+1=0
    expect(computeResourceAmount(def, events, 90)).toBe(1) // refill@90 来了，满
  })
})
