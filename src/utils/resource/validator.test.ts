import { describe, it, expect } from 'vitest'
import { findResourceExhaustedCasts, probeResourceUnmetMessage } from './validator'
import type { ResourceDefinition } from '@/types/resource'
import { makeAction, makeCast } from './__tests__/helpers'

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

describe('probeResourceUnmetMessage', () => {
  const consolationDef = (unmetMessage?: string): ResourceDefinition => ({
    id: 'sch:consolation',
    name: '慰藉充能',
    job: 'SCH',
    initial: 2,
    max: 2,
    regen: { interval: 30, amount: 1 },
    ...(unmetMessage ? { unmetMessage } : {}),
  })

  const huishi = makeAction({
    id: 16546,
    cooldown: 30,
    resourceEffects: [{ resourceId: 'sch:consolation', delta: -1 }],
  })

  it('action 没声明 resourceEffects → null（不走资源校验）', () => {
    const plain = makeAction({ id: 99, cooldown: 60 })
    const msg = probeResourceUnmetMessage(plain, 10, 0, [], new Map(), {
      'sch:consolation': consolationDef('文案'),
    })
    expect(msg).toBeNull()
  })

  it('资源耗尽且 def 配置了 unmetMessage → 返回该文案', () => {
    const cs = [
      makeCast({ id: '1', actionId: 16546, timestamp: 0 }),
      makeCast({ id: '2', actionId: 16546, timestamp: 5 }),
    ]
    const msg = probeResourceUnmetMessage(huishi, 10, 10, cs, new Map([[16546, huishi]]), {
      'sch:consolation': consolationDef('慰藉充能不足'),
    })
    expect(msg).toBe('慰藉充能不足')
  })

  it('资源耗尽但 def 未配置 unmetMessage → null（caller fallback 通用文案）', () => {
    const cs = [
      makeCast({ id: '1', actionId: 16546, timestamp: 0 }),
      makeCast({ id: '2', actionId: 16546, timestamp: 5 }),
    ]
    const msg = probeResourceUnmetMessage(huishi, 10, 10, cs, new Map([[16546, huishi]]), {
      'sch:consolation': consolationDef(),
    })
    expect(msg).toBeNull()
  })

  it('资源充足 → null', () => {
    const msg = probeResourceUnmetMessage(huishi, 10, 0, [], new Map([[16546, huishi]]), {
      'sch:consolation': consolationDef('慰藉充能不足'),
    })
    expect(msg).toBeNull()
  })

  it('合成 __cd__ 资源耗尽（普通 CD 没满）→ null', () => {
    // action 仅消费合成 __cd__:1（无显式 resourceEffects），此处用一个有显式 effects 但
    // 显式资源够用的 action 模拟"探测因合成 cd 耗尽"——但本探测函数关注的是"显式资源 +
    // unmetMessage"，所以即便走到合成耗尽路径也应返回 null。这里通过一个未配置文案的
    // 显式资源 + 紧凑 timestamp 触发显式资源耗尽，验证 fallback 行为。
    const action = makeAction({
      id: 1,
      cooldown: 60,
      resourceEffects: [{ resourceId: 'x:explicit', delta: -1 }],
    })
    const cs = [makeCast({ id: 'a', actionId: 1, timestamp: 0 })]
    const msg = probeResourceUnmetMessage(action, 10, 0, cs, new Map([[1, action]]), {
      'x:explicit': {
        id: 'x:explicit',
        name: 'X',
        job: 'SCH',
        initial: 1,
        max: 1,
      } as ResourceDefinition,
    })
    expect(msg).toBeNull()
  })
})
