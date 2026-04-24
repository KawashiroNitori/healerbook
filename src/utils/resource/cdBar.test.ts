import { describe, it, expect } from 'vitest'
import { computeCdBarEnd } from './cdBar'
import { deriveResourceEvents } from './compute'
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
  return { playerId: 10, timestamp: 0, ...partial } as CastEvent
}

describe('computeCdBarEnd — 单充能（合成 __cd__）', () => {
  it('每次 cast 都画蓝条，rawEnd = t + cd', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const cast = makeCast({ id: 'c', actionId: 1, timestamp: 100 })
    const events = deriveResourceEvents([cast], new Map([[1, action]]))
    expect(computeCdBarEnd(action, cast, events, {})).toBe(160)
  })
})

describe('computeCdBarEnd — 多充能有 regen（献奉）', () => {
  const oblation: ResourceDefinition = {
    id: 'drk:oblation',
    name: '献奉充能',
    job: 'DRK',
    initial: 2,
    max: 2,
    regen: { interval: 60, amount: 1 },
  }
  const registry = { 'drk:oblation': oblation }
  const xianfeng = makeAction({
    id: 25754,
    cooldown: 60,
    resourceEffects: [{ resourceId: 'drk:oblation', delta: -1 }],
  })

  it('#1 cast 后仍有库存 → null（不画）', () => {
    const cs = [makeCast({ id: '1', actionId: 25754, timestamp: 0 })]
    const events = deriveResourceEvents(cs, new Map([[25754, xianfeng]]))
    expect(computeCdBarEnd(xianfeng, cs[0], events, registry)).toBeNull()
  })

  it('#2 cast 后打空 → rawEnd 是第一个恢复到 ≥1 的 refill 时刻', () => {
    // 献奉 t=0, t=30 连消 → t=30 后 amount=0，pending=[60, 90]
    // refill@60 把 amount 提回 1，rawEnd=60
    const cs = [
      makeCast({ id: '1', actionId: 25754, timestamp: 0 }),
      makeCast({ id: '2', actionId: 25754, timestamp: 30 }),
    ]
    const events = deriveResourceEvents(cs, new Map([[25754, xianfeng]]))
    expect(computeCdBarEnd(xianfeng, cs[1], events, registry)).toBe(60)
  })

  it('#3 cast 在 refill@60 fire 后打空 → rawEnd 是 refill@90', () => {
    // 献奉 t=0, t=30, t=70 → 第 3 条 cast 前 refill@60 已 fire (amount 0→1)
    // #3 消耗 1→0，pending=[90, 130]；rawEnd=90
    const cs = [
      makeCast({ id: '1', actionId: 25754, timestamp: 0 }),
      makeCast({ id: '2', actionId: 25754, timestamp: 30 }),
      makeCast({ id: '3', actionId: 25754, timestamp: 70 }),
    ]
    const events = deriveResourceEvents(cs, new Map([[25754, xianfeng]]))
    expect(computeCdBarEnd(xianfeng, cs[2], events, registry)).toBe(90)
  })
})

describe('computeCdBarEnd — 无 regen 后续产出恢复', () => {
  const pool: ResourceDefinition = {
    id: 'x:event-driven',
    name: 'X',
    job: 'SCH',
    initial: 0,
    max: 2,
    // 无 regen
  }
  const registry = { 'x:event-driven': pool }
  const producer = makeAction({
    id: 1,
    cooldown: 120,
    resourceEffects: [{ resourceId: 'x:event-driven', delta: +2 }],
  })
  const consumer = makeAction({
    id: 2,
    cooldown: 30,
    resourceEffects: [{ resourceId: 'x:event-driven', delta: -1 }],
  })

  it('打空 + 有下一个产出事件 → rawEnd = 产出时刻', () => {
    const cs = [
      makeCast({ id: 'p1', actionId: 1, timestamp: 120 }), // +2 → amount 2
      makeCast({ id: 'c1', actionId: 2, timestamp: 125 }), // -1 → amount 1
      makeCast({ id: 'c2', actionId: 2, timestamp: 130 }), // -1 → amount 0
      makeCast({ id: 'p2', actionId: 1, timestamp: 240 }), // +2
    ]
    const events = deriveResourceEvents(
      cs,
      new Map<number, MitigationAction>([
        [1, producer],
        [2, consumer],
      ])
    )
    // c2 amount_after=0，扫到 t=240 +2 → rawEnd=240
    expect(computeCdBarEnd(consumer, cs[2], events, registry)).toBe(240)
  })

  it('打空 + 无任何后续产出 → rawEnd = Infinity', () => {
    const cs = [
      makeCast({ id: 'p1', actionId: 1, timestamp: 120 }),
      makeCast({ id: 'c1', actionId: 2, timestamp: 125 }),
      makeCast({ id: 'c2', actionId: 2, timestamp: 130 }),
    ]
    const events = deriveResourceEvents(
      cs,
      new Map<number, MitigationAction>([
        [1, producer],
        [2, consumer],
      ])
    )
    expect(computeCdBarEnd(consumer, cs[2], events, registry)).toBe(Infinity)
  })
})
