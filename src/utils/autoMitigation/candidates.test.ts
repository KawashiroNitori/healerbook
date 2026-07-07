import { describe, it, expect } from 'vitest'
import { generateCandidates, isGcdMit } from './candidates'
import type { OptimizeInput } from './types'
import type { MitigationAction } from '@/types/mitigation'
import type { DamageEvent } from '@/types/timeline'
import type { PlacementEngine, Interval } from '@/types/placement'

const action = (over: Partial<MitigationAction>): MitigationAction =>
  ({
    id: 100,
    name: 'A',
    icon: '',
    jobs: ['WHM'],
    duration: 15,
    cooldown: 60,
    category: ['partywide', 'percentage'],
    ...over,
  }) as MitigationAction

const dmg = (id: string, time: number): DamageEvent =>
  ({ id, name: id, time, damage: 80000, type: 'aoe', damageType: 'magical' }) as DamageEvent

// 假 engine：整条时间轴合法
const fakeEngine = (legal: Interval[]): PlacementEngine =>
  ({ getValidIntervals: () => legal }) as unknown as PlacementEngine

const input = (actions: MitigationAction[], events: DamageEvent[]): OptimizeInput => ({
  damageEvents: events,
  lockedCastEvents: [],
  composition: { players: [{ id: 1, job: 'WHM' }] },
  actions: new Map(actions.map(a => [a.id, a])),
  initialState: { statuses: [], timestamp: 0 } as never,
})

describe('generateCandidates', () => {
  it('为每个 in-scope 事件在合法窗口内生成覆盖该事件的候选', () => {
    // duration=15：start 必须严格早于事件才算覆盖；事件在 t=10/t=40，
    // 从 iv.from=0 出发均可覆盖（0 < 10 且 10 <= 15；0 < 40 但 40 > 15，需晚放断点覆盖 y）
    const a = action({ id: 100, duration: 15 })
    const cands = generateCandidates(
      input([a], [dmg('x', 10), dmg('y', 40)]),
      fakeEngine([{ from: 0, to: 100 }])
    )
    // 存在覆盖 x 的候选（start < 10 且 10 <= start+15）& 覆盖 y 的候选（start < 40 且 40 <= start+15）
    expect(cands.some(c => c.covers.has('x'))).toBe(true)
    expect(cands.some(c => c.covers.has('y'))).toBe(true)
  })

  it('零贡献候选（覆盖窗口内无事件）被剪掉', () => {
    const a = action({ id: 100, duration: 5 })
    const cands = generateCandidates(input([a], [dmg('x', 10)]), fakeEngine([{ from: 50, to: 60 }]))
    expect(cands.length).toBe(0) // 窗口 [50,60) 罩不到 t=10 的事件
  })

  it('支配剪枝：同 (action,player) 覆盖集被包含者被丢弃', () => {
    const a = action({ id: 100, duration: 100 }) // 一发覆盖全部
    const cands = generateCandidates(
      input([a], [dmg('x', 10), dmg('y', 20)]),
      fakeEngine([{ from: 0, to: 5 }])
    )
    // 仅保留覆盖 {x,y} 的极大候选，不保留只覆盖子集者
    const maximal = cands.filter(c => c.covers.has('x') && c.covers.has('y'))
    expect(maximal.length).toBeGreaterThanOrEqual(1)
    expect(cands.every(c => !(c.covers.size === 1))).toBe(true)
  })

  it('玩家职业不匹配的 action 不产候选', () => {
    const a = action({ id: 100, jobs: ['SCH'] }) // 玩家是 WHM
    const cands = generateCandidates(input([a], [dmg('x', 10)]), fakeEngine([{ from: 0, to: 100 }]))
    expect(cands.length).toBe(0)
  })

  it('非 partywide 的 action（单体/自减）不产候选', () => {
    const selfMit = action({ id: 100, category: ['self', 'target', 'percentage'] })
    const cands = generateCandidates(
      input([selfMit], [dmg('x', 10)]),
      fakeEngine([{ from: 0, to: 100 }])
    )
    expect(cands.length).toBe(0)
  })

  it('partywide 但纯治疗（无 percentage/shield）不产候选', () => {
    const healOnly = action({ id: 100, category: ['partywide', 'heal'] })
    const cands = generateCandidates(
      input([healOnly], [dmg('x', 10)]),
      fakeEngine([{ from: 0, to: 100 }])
    )
    expect(cands.length).toBe(0)
  })

  it('isGcdMit：由 category 含 gcd 显式标记，与 cooldown 无关', () => {
    expect(isGcdMit(action({ category: ['partywide', 'shield', 'gcd'] }))).toBe(true)
    expect(isGcdMit(action({ category: ['partywide', 'percentage', 'gcd'] }))).toBe(true)
    // 免费赠送技（cd 短但无 gcd 标签）不算 → 主池贪心放置
    expect(isGcdMit(action({ cooldown: 1, category: ['partywide', 'shield'] }))).toBe(false)
    expect(isGcdMit(action({ cooldown: 60, category: ['partywide', 'percentage'] }))).toBe(false)
  })

  it('partywide 的 action 正常产候选', () => {
    const partyMit = action({ id: 100, category: ['partywide', 'shield'] })
    const cands = generateCandidates(
      input([partyMit], [dmg('x', 10)]),
      fakeEngine([{ from: 0, to: 100 }])
    )
    expect(cands.some(c => c.covers.has('x'))).toBe(true)
  })

  it('同刻语义锁定：start === e.time 的候选不覆盖 e；严格早于 e.time 的起点才覆盖', () => {
    // duration=15，合法窗口 [0, 100)
    // 断点集中会出现 start = e.time（左沿对齐事件），
    // 修正后 covers 谓词要求 e.time - start > TIME_EPS，即同刻不覆盖。
    const a = action({ id: 100, duration: 15 })
    const e = dmg('evt', 30)

    // 构造 engine：合法区间 [0, 100) 和紧贴 [30, 100)（覆盖同刻起点）
    const cands = generateCandidates(input([a], [e]), fakeEngine([{ from: 0, to: 100 }]))

    // 不应存在 start === 30 的候选覆盖了 'evt'
    const sameInstantCandidate = cands.find(c => Math.abs(c.start - 30) < 1e-9)
    if (sameInstantCandidate) {
      expect(sameInstantCandidate.covers.has('evt')).toBe(false)
    }

    // 但 start < 30（如 start = 30 - 15 = 15）的晚放断点候选应该覆盖 'evt'
    // 晚放断点 = e.time - d = 30 - 15 = 15，且 15 in [0, 100)
    const lateStart = cands.find(c => Math.abs(c.start - 15) < 1e-9)
    expect(lateStart).toBeDefined()
    expect(lateStart!.covers.has('evt')).toBe(true)
  })
})
