import { describe, it, expect } from 'vitest'
import type { Timeline } from '@/types/timeline'
import { extractImportableFromTimeline, filterByRange } from './importAdapter'

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
