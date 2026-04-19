// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useFilterStore } from '@/store/filterStore'
import { useSkillTracks } from './useSkillTracks'
import type { Timeline } from '@/types/timeline'

function makeTimeline(): Timeline {
  return {
    id: 't1',
    name: 'test',
    encounter: { id: 0, name: '', displayName: '', zone: '', damageEvents: [] },
    composition: {
      players: [
        { id: 1, job: 'PLD' },
        { id: 2, job: 'WHM' },
        { id: 3, job: 'BLM' },
      ],
    },
    damageEvents: [],
    castEvents: [],
    statusEvents: [],
    annotations: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('useSkillTracks with filter', () => {
  beforeEach(() => {
    localStorage.clear()
    useFilterStore.setState({ customPresets: [], activeFilterId: 'builtin:all' })
    useMitigationStore.getState().loadActions()
    useTimelineStore.setState({ timeline: makeTimeline() })
  })

  it('builtin:all：每位玩家的所有非 hidden 技能都派生出轨道', () => {
    const { result } = renderHook(() => useSkillTracks())
    const jobs = new Set(result.current.map(t => t.job))
    expect(jobs.has('PLD')).toBe(true)
    expect(jobs.has('WHM')).toBe(true)
    expect(jobs.has('BLM')).toBe(true)
  })

  it('builtin:tank：非坦克玩家不再产生任何轨道', () => {
    useFilterStore.setState({ activeFilterId: 'builtin:tank' })
    const { result } = renderHook(() => useSkillTracks())
    const jobs = new Set(result.current.map(t => t.job))
    expect(jobs.has('PLD')).toBe(true)
    expect(jobs.has('WHM')).toBe(false)
    expect(jobs.has('BLM')).toBe(false)
  })

  it('builtin:healer：只有治疗玩家的轨道保留', () => {
    useFilterStore.setState({ activeFilterId: 'builtin:healer' })
    const { result } = renderHook(() => useSkillTracks())
    const jobs = new Set(result.current.map(t => t.job))
    expect(jobs.has('WHM')).toBe(true)
    expect(jobs.has('PLD')).toBe(false)
    expect(jobs.has('BLM')).toBe(false)
  })

  it('custom 预设按 (job, actionId) 精确过滤', () => {
    const id = useFilterStore.getState().addPreset('only-pld-7535', {
      damageTypes: [],
      selectedActionsByJob: { PLD: [7535] }, // 雪仇（多 job action，PLD 可用）
    })
    useFilterStore.getState().setActiveFilter(id)
    const { result } = renderHook(() => useSkillTracks())
    expect(result.current).toHaveLength(1)
    expect(result.current[0].job).toBe('PLD')
    expect(result.current[0].actionId).toBe(7535)
  })

  it('无 composition 时返回空数组', () => {
    useTimelineStore.setState({ timeline: null })
    const { result } = renderHook(() => useSkillTracks())
    expect(result.current).toEqual([])
  })
})
