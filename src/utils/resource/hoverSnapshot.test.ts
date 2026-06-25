import { describe, it, expect } from 'vitest'
import { computeResourceSnapshots, type SnapshotInput } from './hoverSnapshot'
import { deriveResourceEvents } from './compute'
import { makeAction, makeCast } from './__tests__/helpers'
import type { SkillTrack } from '@/utils/skillTracks'
import type { ResourceDefinition } from '@/types/resource'

// 慰藉：仅消耗 sch:consolation（cooldown 池，单技能）
const consolation = makeAction({
  id: 16547,
  name: '慰藉',
  icon: '/i/c.png',
  jobs: ['SCH'],
  cooldown: 30,
  resourceEffects: [{ resourceId: 'sch:consolation', delta: -1 }],
})
// 野战治疗阵：自身 __cd__ + 共享 aetherflow（lights 池）
const recitation = makeAction({
  id: 188,
  name: '野战治疗阵',
  icon: '/i/r.png',
  jobs: ['SCH'],
  cooldown: 30,
  resourceEffects: [
    { resourceId: '__cd__:188', delta: -1, required: true },
    { resourceId: 'sch:aetherflow', delta: -1 },
  ],
})
// 纯产出（无消费）→ 合成 __cd__:99
const transpose = makeAction({
  id: 99,
  name: '转化',
  icon: '/i/t.png',
  jobs: ['SCH'],
  cooldown: 60,
})

const registry: Record<string, ResourceDefinition> = {
  'sch:consolation': {
    id: 'sch:consolation',
    name: '慰藉充能',
    job: 'SCH',
    initial: 2,
    max: 2,
    regen: { interval: 30, amount: 1 },
    style: 'cooldown',
  },
  'sch:aetherflow': {
    id: 'sch:aetherflow',
    name: '以太超流',
    job: 'SCH',
    initial: 3,
    max: 3,
    regen: { interval: 60, amount: 3 },
    style: 'lights',
  },
}
const actionsById = new Map([consolation, recitation, transpose].map(a => [a.id, a]))
const tracks: SkillTrack[] = [
  { job: 'SCH', playerId: 10, actionId: 16547, actionName: '慰藉', actionIcon: '/i/c.png' },
  { job: 'SCH', playerId: 10, actionId: 188, actionName: '野战治疗阵', actionIcon: '/i/r.png' },
  { job: 'SCH', playerId: 10, actionId: 99, actionName: '转化', actionIcon: '/i/t.png' },
]

function input(casts = []): SnapshotInput {
  return {
    tracks,
    actionsById,
    registry,
    resourceEventsByKey: deriveResourceEvents(casts, actionsById),
  }
}

describe('computeResourcesnapshots', () => {
  it('成员只含有可见轨道的玩家；pools 为非 cooldown 池、cooldowns 每轨一个', () => {
    const [m] = computeResourceSnapshots(input(), 0)
    expect(m.playerId).toBe(10)
    // pools：aetherflow（lights），满档
    expect(m.pools.map(p => p.resourceId)).toEqual(['sch:aetherflow'])
    expect(m.pools[0]).toMatchObject({ style: 'lights', amount: 3, max: 3 })
    // cooldowns：慰藉(sch:consolation) / 野战(__cd__:188) / 转化(__cd__:99)，按 tracks 顺序
    expect(m.cooldowns.map(c => c.resourceId)).toEqual([
      'sch:consolation',
      '__cd__:188',
      '__cd__:99',
    ])
    expect(m.cooldowns.map(c => c.icon)).toEqual(['/i/c.png', '/i/r.png', '/i/t.png'])
  })

  it('未释放技能的 CD 池满档/就绪，无倒计时', () => {
    const [m] = computeResourceSnapshots(input(), 0)
    const cd = m.cooldowns.find(c => c.resourceId === '__cd__:188')!
    expect(cd.amount).toBe(1)
    expect(cd.countdownSec).toBeUndefined()
  })

  it('消耗后 cooldown 倒计时 = 下一回充剩余秒；进度 [0,1]', () => {
    const casts = [makeCast({ id: 'x', actionId: 188, timestamp: 10 })]
    const [m] = computeResourceSnapshots(input(casts), 25)
    const cd = m.cooldowns.find(c => c.resourceId === '__cd__:188')!
    expect(cd.amount).toBe(0)
    expect(cd.countdownSec).toBeCloseTo(15) // (10+30) - 25
    expect(cd.nextChargeProgress).toBeCloseTo(0.5) // (25 - 10) / 30
  })

  it('多档共享池消耗后 lights amount 递减', () => {
    const casts = [makeCast({ id: 'x', actionId: 188, timestamp: 10 })]
    const [m] = computeResourceSnapshots(input(casts), 12)
    expect(m.pools[0].amount).toBe(2) // aetherflow 3 → 2
  })
})
