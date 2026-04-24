import { describe, it, expect } from 'vitest'
import { findResourceExhaustedCasts } from './validator'
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

const syntheticRegistry: Record<string, ResourceDefinition> = {}

describe('findResourceExhaustedCasts', () => {
  it('单充能 action 两 cast 距离 < cd → 第二个非法', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const cs = [
      makeCast({ id: 'a', actionId: 1, timestamp: 0 }),
      makeCast({ id: 'b', actionId: 1, timestamp: 30 }),
    ]
    const result = findResourceExhaustedCasts(cs, new Map([[1, action]]), syntheticRegistry)
    expect(result).toEqual([
      expect.objectContaining({
        castEventId: 'b',
        resourceKey: '10:__cd__:1',
        resourceId: '__cd__:1',
        playerId: 10,
      }),
    ])
  })

  it('两 cast 恰好紧贴 cd 边界（t1 = t0 + cd）→ 都合法', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const cs = [
      makeCast({ id: 'a', actionId: 1, timestamp: 0 }),
      makeCast({ id: 'b', actionId: 1, timestamp: 60 }),
    ]
    const result = findResourceExhaustedCasts(cs, new Map([[1, action]]), syntheticRegistry)
    expect(result).toEqual([])
  })

  it('显式消费者 sch:consolation：第 3 次慰藉 exhaust', () => {
    const consolation = {
      id: 'sch:consolation',
      name: '慰藉充能',
      job: 'SCH',
      initial: 2,
      max: 2,
      regen: { interval: 30, amount: 1 },
    } as ResourceDefinition
    const huishi = makeAction({
      id: 16546,
      cooldown: 30,
      resourceEffects: [{ resourceId: 'sch:consolation', delta: -1 }],
    })
    const cs = [
      makeCast({ id: '1', actionId: 16546, timestamp: 125 }),
      makeCast({ id: '2', actionId: 16546, timestamp: 130 }),
      makeCast({ id: '3', actionId: 16546, timestamp: 135 }),
    ]
    const registry = { 'sch:consolation': consolation }
    const result = findResourceExhaustedCasts(cs, new Map([[16546, huishi]]), registry)
    expect(result.map(r => r.castEventId)).toEqual(['3'])
  })

  it('excludeId 排除某 cast 后其他 cast 合法性重算', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const cs = [
      makeCast({ id: 'a', actionId: 1, timestamp: 0 }),
      makeCast({ id: 'b', actionId: 1, timestamp: 30 }),
    ]
    // 排除 a → b 不再有前序冲突
    const result = findResourceExhaustedCasts(cs, new Map([[1, action]]), syntheticRegistry, 'a')
    expect(result).toEqual([])
  })

  it('required=false 的 effect 即使资源不足也不算非法', () => {
    const action = makeAction({
      id: 1,
      cooldown: 0,
      resourceEffects: [{ resourceId: 'x:optional', delta: -1, required: false }],
    })
    const registry = {
      'x:optional': {
        id: 'x:optional',
        name: 'X',
        job: 'SCH',
        initial: 0,
        max: 1,
      } as ResourceDefinition,
    }
    const cs = [makeCast({ id: 'a', actionId: 1, timestamp: 0 })]
    const result = findResourceExhaustedCasts(cs, new Map([[1, action]]), registry)
    expect(result).toEqual([])
  })

  it('不同 playerId 的 cast 各有独立池', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const cs = [
      makeCast({ id: 'a', actionId: 1, timestamp: 0, playerId: 10 }),
      makeCast({ id: 'b', actionId: 1, timestamp: 10, playerId: 20 }),
    ]
    const result = findResourceExhaustedCasts(cs, new Map([[1, action]]), syntheticRegistry)
    expect(result).toEqual([])
  })
})
