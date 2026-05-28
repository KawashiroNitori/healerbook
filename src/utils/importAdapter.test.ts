import { describe, it, expect } from 'vitest'
import type { Timeline, Composition } from '@/types/timeline'
import type { CastEvent } from '@/types/timeline'
import {
  extractImportableFromTimeline,
  filterByRange,
  buildPlayerIdMap,
  validateCastsForImport,
} from './importAdapter'
import { createPlacementEngine } from '@/utils/placement/engine'
import { MITIGATION_DATA } from '@/data/mitigationActions'

const baseTimeline = (overrides: Partial<Timeline> = {}): Timeline => ({
  id: 't1',
  name: 'fake',
  encounter: { id: 1077, name: 'M3S', displayName: 'M3S', zone: '', damageEvents: [] },
  composition: { players: [] },
  damageEvents: [],
  castEvents: [],
  statusEvents: [],
  annotations: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

describe('extractImportableFromTimeline', () => {
  it('提取三个事件数组 + encounter + 拼接 sourceLabel', () => {
    const t = baseTimeline({
      damageEvents: [
        { id: 'd1', name: 'X', time: 1, damage: 100, type: 'aoe', damageType: 'magical' },
      ],
      castEvents: [{ id: 'c1', actionId: 7382, timestamp: 2, playerId: 1 }],
      syncEvents: [
        { time: 1, type: 'cast', actionId: 100, actionName: 'A', window: [2, 2], syncOnce: false },
      ],
      fflogsSource: { reportCode: 'ABC123', fightId: 5 },
    })

    const out = extractImportableFromTimeline(t)

    expect(out.damageEvents).toHaveLength(1)
    expect(out.castEvents).toHaveLength(1)
    expect(out.syncEvents).toHaveLength(1)
    expect(out.encounter?.id).toBe(1077)
    expect(out.sourceLabel).toContain('ABC123')
    expect(out.sourceLabel).toContain('#5')
    expect(out.sourceLabel).toContain('M3S')
  })

  it('syncEvents 缺失时返回空数组', () => {
    const t = baseTimeline()
    expect(extractImportableFromTimeline(t).syncEvents).toEqual([])
  })

  it('fflogsSource 缺失时 sourceLabel 仅含 encounter 名', () => {
    const t = baseTimeline()
    expect(extractImportableFromTimeline(t).sourceLabel).toBe('M3S')
  })
})

describe('filterByRange', () => {
  const events = [
    { id: 'a', t: 10 },
    { id: 'b', t: 20 },
    { id: 'c', t: 30 },
    { id: 'd', t: 40 },
  ]
  const getT = (e: { t: number }) => e.t

  it('mode=all 返回原数组（不复制顺序变化）', () => {
    expect(filterByRange(events, { mode: 'all' }, getT)).toEqual(events)
  })

  it('mode=range 起点包含、终点排除', () => {
    const out = filterByRange(events, { mode: 'range', start: 20, end: 40 }, getT)
    expect(out.map(e => e.id)).toEqual(['b', 'c'])
  })

  it('end=null 表示 +∞，只受 start 约束', () => {
    const out = filterByRange(events, { mode: 'range', start: 25, end: null }, getT)
    expect(out.map(e => e.id)).toEqual(['c', 'd'])
  })

  it('start === end 返回空', () => {
    expect(filterByRange(events, { mode: 'range', start: 20, end: 20 }, getT)).toEqual([])
  })
})

const comp = (entries: Array<[number, string]>): Composition => ({
  players: entries.map(([id, job]) => ({ id, job: job as Composition['players'][number]['job'] })),
})

describe('buildPlayerIdMap', () => {
  it('1:1 全匹配', () => {
    const incoming = comp([
      [100, 'WHM'],
      [101, 'SCH'],
    ])
    const current = comp([
      [1, 'WHM'],
      [2, 'SCH'],
    ])
    const map = buildPlayerIdMap(incoming, current)
    expect(map.get(100)).toBe(1)
    expect(map.get(101)).toBe(2)
  })

  it('多对多按出现顺序匹配', () => {
    const incoming = comp([
      [100, 'WHM'],
      [101, 'WHM'],
      [102, 'SCH'],
    ])
    const current = comp([
      [1, 'WHM'],
      [2, 'SCH'],
      [3, 'WHM'],
    ])
    const map = buildPlayerIdMap(incoming, current)
    expect(map.get(100)).toBe(1) // 双方第 1 个 WHM
    expect(map.get(101)).toBe(3) // 双方第 2 个 WHM
    expect(map.get(102)).toBe(2) // 双方第 1 个 SCH
  })

  it('incoming 多余职业 → 不入 map', () => {
    const incoming = comp([
      [100, 'WHM'],
      [101, 'AST'],
    ])
    const current = comp([[1, 'WHM']])
    const map = buildPlayerIdMap(incoming, current)
    expect(map.get(100)).toBe(1)
    expect(map.has(101)).toBe(false)
  })

  it('incoming 同职业人数 > current → 多出的不入 map', () => {
    const incoming = comp([
      [100, 'WHM'],
      [101, 'WHM'],
    ])
    const current = comp([[1, 'WHM']])
    const map = buildPlayerIdMap(incoming, current)
    expect(map.get(100)).toBe(1)
    expect(map.has(101)).toBe(false)
  })

  it('current 多余职业 → incoming 不分配对应 player', () => {
    const incoming = comp([[100, 'WHM']])
    const current = comp([
      [1, 'WHM'],
      [2, 'SCH'],
    ])
    const map = buildPlayerIdMap(incoming, current)
    expect(map.get(100)).toBe(1)
  })

  it('完全无交集 → 空 map', () => {
    const incoming = comp([[100, 'AST']])
    const current = comp([[1, 'WHM']])
    expect(buildPlayerIdMap(incoming, current).size).toBe(0)
  })
})

describe('validateCastsForImport', () => {
  const fakeAction = MITIGATION_DATA.actions.find(a => a.cooldown && a.cooldown >= 60)
  if (!fakeAction) {
    throw new Error('Test setup: no action with cooldown >= 60 found in MITIGATION_DATA')
  }
  const actionId = fakeAction.id
  const job = fakeAction.jobs[0]
  const currentComp: Composition = { players: [{ id: 1, job }] }
  const incomingComp: Composition = { players: [{ id: 100, job }] }
  const makeBaseTimeline = (): Timeline => ({
    id: 't',
    name: '',
    encounter: { id: 0, name: '', displayName: '', zone: '', damageEvents: [] },
    composition: currentComp,
    damageEvents: [],
    castEvents: [],
    statusEvents: [],
    annotations: [],
    createdAt: 0,
    updatedAt: 0,
  })

  it('playerId 不在 map → 跳过', () => {
    const map = buildPlayerIdMap({ players: [] }, currentComp) // 空 map
    const incoming: CastEvent[] = [{ id: 'i1', actionId, timestamp: 10, playerId: 100 }]
    const result = validateCastsForImport({
      incoming,
      playerIdMap: map,
      baseTimeline: makeBaseTimeline(),
      mitigationActions: MITIGATION_DATA.actions,
      statusTimelineByPlayer: new Map(),
      createEngine: createPlacementEngine,
    })
    expect(result.kept).toHaveLength(0)
    expect(result.skipped).toBe(1)
  })

  it('actionId 不在 registry → 跳过', () => {
    const map = buildPlayerIdMap(incomingComp, currentComp)
    const incoming: CastEvent[] = [{ id: 'i1', actionId: 99999999, timestamp: 10, playerId: 100 }]
    const result = validateCastsForImport({
      incoming,
      playerIdMap: map,
      baseTimeline: makeBaseTimeline(),
      mitigationActions: MITIGATION_DATA.actions,
      statusTimelineByPlayer: new Map(),
      createEngine: createPlacementEngine,
    })
    expect(result.kept).toHaveLength(0)
    expect(result.skipped).toBe(1)
  })

  it('同 player 同 action 间隔 < CD → 第 2 个进 skipped', () => {
    const map = buildPlayerIdMap(incomingComp, currentComp)
    const incoming: CastEvent[] = [
      { id: 'i1', actionId, timestamp: 10, playerId: 100 },
      { id: 'i2', actionId, timestamp: 11, playerId: 100 }, // 1 秒内重复
    ]
    const result = validateCastsForImport({
      incoming,
      playerIdMap: map,
      baseTimeline: makeBaseTimeline(),
      mitigationActions: MITIGATION_DATA.actions,
      statusTimelineByPlayer: new Map(),
      createEngine: createPlacementEngine,
    })
    expect(result.kept).toHaveLength(1)
    expect(result.kept[0].playerId).toBe(1) // 映射后
    expect(result.skipped).toBe(1)
  })

  it('全合法 → kept = incoming（playerId 已映射）', () => {
    const map = buildPlayerIdMap(incomingComp, currentComp)
    const incoming: CastEvent[] = [{ id: 'i1', actionId, timestamp: 10, playerId: 100 }]
    const result = validateCastsForImport({
      incoming,
      playerIdMap: map,
      baseTimeline: makeBaseTimeline(),
      mitigationActions: MITIGATION_DATA.actions,
      statusTimelineByPlayer: new Map(),
      createEngine: createPlacementEngine,
    })
    expect(result.kept).toHaveLength(1)
    expect(result.kept[0].playerId).toBe(1)
    expect(result.kept[0].actionId).toBe(actionId)
    expect(result.skipped).toBe(0)
  })
})
