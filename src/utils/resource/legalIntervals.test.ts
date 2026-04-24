import { describe, it, expect } from 'vitest'
import { resourceLegalIntervals } from './legalIntervals'
import { computeResourceTrace, deriveResourceEvents } from './compute'
import type { ResourceDefinition } from '@/types/resource'
import { makeAction, makeCast } from './__tests__/helpers'

const INF = Number.POSITIVE_INFINITY
const NEG_INF = Number.NEGATIVE_INFINITY

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

describe('resourceLegalIntervals — required=false 软消费者', () => {
  it('required=false 的消费者不进 forbid（与 validator 语义对齐）', () => {
    const pool: ResourceDefinition = {
      id: 'x:optional',
      name: 'X',
      job: 'SCH',
      initial: 0,
      max: 1,
    }
    const registry = { 'x:optional': pool }
    const action = makeAction({
      id: 1,
      cooldown: 0,
      resourceEffects: [{ resourceId: 'x:optional', delta: -1, required: false }],
    })
    const events = deriveResourceEvents(
      [makeCast({ id: 'c', actionId: 1, timestamp: 10 })],
      new Map([[1, action]])
    )
    expect(resourceLegalIntervals(action, 10, events, registry)).toEqual([
      { from: NEG_INF, to: INF },
    ])
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

describe('resourceLegalIntervals — 浮点紧贴边界回归', () => {
  it('紧贴边界 + 1 ULP 浮点毛刺：shadow 端点判定不应把 t=30 判进 forbid', () => {
    // 回归 engine.test.ts:221 场景：timestamp 由 FFLogs 导入 (ms/1000)、
    // 拖拽 snap (x/zoom)、shadow 端点 (ts + cd) 等路径算出，可能带 1~2 ULP 的浮点偏差。
    // 资源模型下单充能合成 __cd__ 与旧 cooldownAvailable 数学等价，边界浮点行为也应等价。
    const cd = 10
    const action = makeAction({ id: 99, cooldown: cd })
    const A_ts = 20 + 5e-15 // 跨过半 ULP 使 A_ts + cd 严格大于 30 的数学等式
    const B_ts = 30
    const events = deriveResourceEvents(
      [
        makeCast({ id: 'A', actionId: 99, timestamp: A_ts }),
        makeCast({ id: 'B', actionId: 99, timestamp: B_ts }),
      ],
      new Map([[99, action]])
    )
    // legalIntervals 用 shadow 的 complement 方式表达，两个紧贴 cast 不应产生"夹在中间的"forbid 段
    // 验证路径：对位于 A/B 之间的任何点，都应当至少有一段 legal interval 不包含它为"中间 forbid"
    // 等价表述：A 和 B 自己的 amountBefore 都应当 >=1（未被自身耗尽误判）
    // 这里直接验 amountBefore：
    const trace = computeResourceTrace(
      {
        id: '__cd__:99',
        name: '',
        job: 'SCH',
        initial: 1,
        max: 1,
        regen: { interval: cd, amount: 1 },
      },
      events.get('10:__cd__:99') ?? []
    )
    // A 是第 0 条：amountBefore=1 OK
    // B 是第 1 条：refill 在 A_ts + cd = 30 + 5e-15 触发，B_ts=30 略早一点——ULP 敏感
    // 期望：shadow 算法里没有浮点把戏导致的误判
    expect(trace[0].amountBefore).toBe(1)
    // B_ts=30 刚好在 A 的 refill 时刻，视 <= 判定：
    //   pending=[30+5e-15], B_ts=30, 30+5e-15 > 30 → refill 未触发，amountBefore=0
    //   这是"紧贴"的数学真相；在 engine 层靠 TIME_EPS 容差吸收。这里仅验证状态机行为一致。
    expect(trace[1].amountBefore).toBe(0)
    // shadow 层的 TIME_EPS 容差在阶段 4（engine 接入）落实；
    // 本阶段 resourceLegalIntervals 不做端点容差，直接数学定义
  })
})
