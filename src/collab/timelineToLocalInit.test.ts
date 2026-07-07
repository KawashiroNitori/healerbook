import { describe, it, expect } from 'vitest'
import { timelineToLocalInit } from './timelineToLocalInit'
import type { Timeline } from '@/types/timeline'

const base = {
  name: 'T1',
  description: 'd',
  encounter: { id: 1, name: 'E', displayName: 'E', zone: 'Z', damageEvents: [] },
  fflogsSource: undefined,
  gameZoneId: undefined,
  syncEvents: undefined,
  isReplayMode: false,
  composition: { players: [] },
  damageEvents: [],
  castEvents: [],
  annotations: undefined,
  statData: undefined,
  createdAt: 100,
} as unknown as Timeline

describe('timelineToLocalInit', () => {
  it('13 字段透传，annotations 兜底空数组', () => {
    const r = timelineToLocalInit(base)
    expect(r.name).toBe('T1')
    expect(r.annotations).toEqual([])
    expect(r.createdAt).toBe(100)
    expect(Object.keys(r).sort()).toEqual(
      [
        'name',
        'description',
        'encounter',
        'fflogsSource',
        'gameZoneId',
        'syncEvents',
        'isReplayMode',
        'composition',
        'damageEvents',
        'castEvents',
        'annotations',
        'statData',
        'createdAt',
      ].sort()
    )
  })
  it('overrides 覆盖个别字段', () => {
    const r = timelineToLocalInit(base, { name: 'T1(副本)', createdAt: 200 })
    expect(r.name).toBe('T1(副本)')
    expect(r.createdAt).toBe(200)
  })
})
