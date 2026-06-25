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

  it('变身组父轨道排除在 cooldowns 之外', () => {
    // parent (id 200) 被 variant (id 201, trackGroup: 200) 指向 → 是变身组父
    const parent = makeAction({ id: 200, name: '父技能', jobs: ['SCH'], cooldown: 60 })
    const variant = makeAction({
      id: 201,
      name: '变体技能',
      jobs: ['SCH'],
      cooldown: 30,
      trackGroup: 200,
    })
    const localActionsById = new Map([parent, variant].map(a => [a.id, a]))
    const localTracks: SkillTrack[] = [
      { job: 'SCH', playerId: 20, actionId: 200, actionName: '父技能', actionIcon: '' },
    ]
    const snap = computeResourceSnapshots(
      {
        tracks: localTracks,
        actionsById: localActionsById,
        registry: {},
        resourceEventsByKey: new Map(),
      },
      0
    )
    expect(snap[0].cooldowns.map(c => c.actionId)).not.toContain(200)
  })

  it('cooldown < 30s 的技能排除在 cooldowns 之外；cooldown >= 30s 的保留', () => {
    const shortCd = makeAction({ id: 300, name: '短CD', jobs: ['SCH'], cooldown: 20 })
    const longCd = makeAction({ id: 301, name: '长CD', jobs: ['SCH'], cooldown: 30 })
    const localActionsById = new Map([shortCd, longCd].map(a => [a.id, a]))
    const localTracks: SkillTrack[] = [
      { job: 'SCH', playerId: 30, actionId: 300, actionName: '短CD', actionIcon: '' },
      { job: 'SCH', playerId: 30, actionId: 301, actionName: '长CD', actionIcon: '' },
    ]
    const snap = computeResourceSnapshots(
      {
        tracks: localTracks,
        actionsById: localActionsById,
        registry: {},
        resourceEventsByKey: new Map(),
      },
      0
    )
    const cdActionIds = snap[0].cooldowns.map(c => c.actionId)
    expect(cdActionIds).not.toContain(300) // 20s < 30 → 排除
    expect(cdActionIds).toContain(301) // 30s ≥ 30 → 保留
  })

  it('多成员排序与 tracks 顺序一致', () => {
    const a1 = makeAction({ id: 400, name: 'A', jobs: ['SCH'], cooldown: 60 })
    const a2 = makeAction({ id: 401, name: 'B', jobs: ['SCH'], cooldown: 60 })
    const localActionsById = new Map([a1, a2].map(a => [a.id, a]))
    const localTracks: SkillTrack[] = [
      { job: 'SCH', playerId: 40, actionId: 400, actionName: 'A', actionIcon: '' },
      { job: 'SCH', playerId: 41, actionId: 401, actionName: 'B', actionIcon: '' },
    ]
    const snap = computeResourceSnapshots(
      {
        tracks: localTracks,
        actionsById: localActionsById,
        registry: {},
        resourceEventsByKey: new Map(),
      },
      0
    )
    expect(snap.map(m => m.playerId)).toEqual([40, 41])
  })

  it('cooldown 部件携带 actionId', () => {
    const [m] = computeResourceSnapshots(input(), 0)
    // 所有 cooldown 部件均有 actionId
    for (const c of m.cooldowns) {
      expect(c.actionId).toBeDefined()
      expect(typeof c.actionId).toBe('number')
    }
    // 具体映射：慰藉→16547 / 野战→188 / 转化→99
    expect(m.cooldowns.find(c => c.resourceId === 'sch:consolation')?.actionId).toBe(16547)
    expect(m.cooldowns.find(c => c.resourceId === '__cd__:188')?.actionId).toBe(188)
    expect(m.cooldowns.find(c => c.resourceId === '__cd__:99')?.actionId).toBe(99)
  })
})
