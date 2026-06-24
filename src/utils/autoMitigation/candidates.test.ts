import { describe, it, expect } from 'vitest'
import { generateCandidates } from './candidates'
import type { OptimizeInput } from './types'
import type { MitigationAction } from '@/types/mitigation'
import type { DamageEvent } from '@/types/timeline'
import type { PlacementEngine, Interval } from '@/utils/placement/types'

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
    const a = action({ id: 100, duration: 15 })
    const cands = generateCandidates(
      input([a], [dmg('x', 10), dmg('y', 40)]),
      fakeEngine([{ from: 0, to: 100 }])
    )
    // 存在覆盖 x 的候选 & 覆盖 y 的候选
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
})
