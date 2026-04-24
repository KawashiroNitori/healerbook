import { describe, it, expect } from 'vitest'
import { resourceLegalIntervals } from './legalIntervals'
import { deriveResourceEvents } from './compute'
import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { ResourceDefinition } from '@/types/resource'

const INF = Number.POSITIVE_INFINITY
const NEG_INF = Number.NEGATIVE_INFINITY

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

describe('resourceLegalIntervals — 单充能 __cd__ 场景', () => {
  it('无 cast：legal = (-∞, +∞)', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const events = deriveResourceEvents([], new Map([[1, action]]))
    const intervals = resourceLegalIntervals(action, 10, events, {})
    expect(intervals).toEqual([{ from: NEG_INF, to: INF }])
  })

  it('已有 cast @ t=90 (cd=60) → forbid = (30, 150)，legal = (-∞, 30] ∪ [150, +∞)', () => {
    // 等价于原 cooldownAvailable 对单充能的行为（由 TIME_EPS 吸收端点差异）
    const action = makeAction({ id: 1, cooldown: 60 })
    const events = deriveResourceEvents(
      [makeCast({ id: 'c1', actionId: 1, timestamp: 90 })],
      new Map([[1, action]])
    )
    const intervals = resourceLegalIntervals(action, 10, events, {})
    // forbid = self-forbid [90, 150) ∪ downstream-forbid (30, 90) = (30, 150)
    // legal = (-∞, 30] ∪ [150, +∞)
    expect(intervals).toEqual([
      { from: NEG_INF, to: 30 },
      { from: 150, to: INF },
    ])
  })
})

describe('resourceLegalIntervals — 多充能 drk:oblation 场景', () => {
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

  it('单 cast @ t=0（amount_after=1）：下游 M=1 不透支，自耗尽 t∈∅ → legal 全时间', () => {
    const events = deriveResourceEvents(
      [makeCast({ id: '1', actionId: 25754, timestamp: 0 })],
      new Map([[25754, xianfeng]])
    )
    const intervals = resourceLegalIntervals(xianfeng, 10, events, registry)
    // 自耗尽 forbid: amount(t) < 1 的时段。amount 轨迹 [−∞,0)=2, [0,∞)=1 → 永不 <1
    // 下游 t=0 cast M = amountBefore(0) - 1 = 2-1 = 1 ≥ threshold(1) → 不透支
    expect(intervals).toEqual([{ from: NEG_INF, to: INF }])
  })

  it('双 cast @ t=0, t=30（amount 轨迹 2/1/0/1/2）：shadow = (−30, 60)', () => {
    const events = deriveResourceEvents(
      [
        makeCast({ id: '1', actionId: 25754, timestamp: 0 }),
        makeCast({ id: '2', actionId: 25754, timestamp: 30 }),
      ],
      new Map([[25754, xianfeng]])
    )
    const intervals = resourceLegalIntervals(xianfeng, 10, events, registry)
    // 自耗尽 forbid: amount<1 的 [30, 60)
    // 下游 t=0 M=1 → 不透支；下游 t=30 M=0 → forbid (30-60, 30) = (-30, 30)
    // union = (-30, 60)；legal = (-∞, -30] ∪ [60, +∞)
    expect(intervals).toEqual([
      { from: NEG_INF, to: -30 },
      { from: 60, to: INF },
    ])
  })
})

describe('resourceLegalIntervals — 无 regen 场景', () => {
  const customPool: ResourceDefinition = {
    id: 'x:no-regen',
    name: 'X',
    job: 'SCH',
    initial: 2,
    max: 2,
    // 无 regen
  }
  const registry = { 'x:no-regen': customPool }
  const consumer = makeAction({
    id: 1,
    cooldown: 0,
    resourceEffects: [{ resourceId: 'x:no-regen', delta: -1 }],
  })

  it('下游 M=0 → forbid (−∞, t_C)（无 regen 窗口延到 −∞）', () => {
    const events = deriveResourceEvents(
      [
        makeCast({ id: '1', actionId: 1, timestamp: 0 }),
        makeCast({ id: '2', actionId: 1, timestamp: 10 }),
      ],
      new Map([[1, consumer]])
    )
    const intervals = resourceLegalIntervals(consumer, 10, events, registry)
    // 轨迹：[−∞,0)=2, [0,10)=1, [10,∞)=0（无 regen）
    // 自耗尽 forbid: [10, ∞)
    // 下游 t=0 M=1 → 不透支；下游 t=10 M=0 → forbid (−∞, 10)
    // union = (−∞, ∞)；legal = ∅
    expect(intervals).toEqual([])
  })
})

describe('resourceLegalIntervals — 产出型 action', () => {
  it('只产出无消耗：无自耗尽 + 无下游透支 → legal 全时间', () => {
    const action = makeAction({
      id: 1,
      cooldown: 120,
      resourceEffects: [{ resourceId: 'pool', delta: +2 }],
    })
    const pool: ResourceDefinition = {
      id: 'pool',
      name: 'p',
      job: 'SCH',
      initial: 0,
      max: 4,
    }
    const events = deriveResourceEvents(
      [makeCast({ id: '1', actionId: 1, timestamp: 10 })],
      new Map([[1, action]])
    )
    // 纯产出 → 合成 __cd__:1 消耗（每 120s 一次），受 __cd__ forbid
    // pool:+2 不贡献 forbid
    const intervals = resourceLegalIntervals(action, 10, events, { pool })
    // forbid by __cd__:1 = (10-120, 10+120) = (-110, 130)
    expect(intervals).toEqual([
      { from: NEG_INF, to: -110 },
      { from: 130, to: INF },
    ])
  })
})
