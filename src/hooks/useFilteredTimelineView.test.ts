// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  matchSingleAction,
  matchDamageEvent,
  matchCastEvent,
  matchTrack,
  useFilteredTimelineView,
} from './useFilteredTimelineView'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useFilterStore } from '@/store/filterStore'
import type { MitigationAction } from '@/types/mitigation'
import type { FilterPreset } from '@/types/filter'
import type { DamageEvent, CastEvent, Timeline } from '@/types/timeline'
import type { SkillTrack } from '@/utils/skillTracks'

function makeAction(overrides: Partial<MitigationAction> = {}): MitigationAction {
  return {
    id: 1,
    name: 'test',
    icon: '',
    jobs: ['PLD'],
    duration: 10,
    cooldown: 60,
    category: ['percentage'],
    ...overrides,
  }
}

function builtin(
  ruleOverrides: Partial<(FilterPreset & { kind: 'builtin' })['rule']> = {}
): FilterPreset {
  return {
    kind: 'builtin',
    id: 'builtin:test',
    name: 'test',
    rule: {
      damageTypes: ['aoe', 'tankbuster'],
      categories: ['shield', 'percentage'],
      ...ruleOverrides,
    },
  }
}

function custom(
  selectedActionsByJob: Partial<Record<string, number[]>> = {},
  damageTypes: ('aoe' | 'tankbuster')[] = ['aoe', 'tankbuster']
): FilterPreset {
  return {
    kind: 'custom',
    id: 'custom:test',
    name: 'test',
    rule: { damageTypes, selectedActionsByJob },
  }
}

// ========================= Pure predicate tests =========================

describe('matchSingleAction', () => {
  describe('builtin preset', () => {
    it('category 不匹配时返回 false', () => {
      const a = makeAction({ category: ['shield'] })
      const p = builtin({ categories: ['percentage'] })
      expect(matchSingleAction(a, 'PLD', p)).toBe(false)
    })

    it('category 匹配且 jobRoles 省略时返回 true', () => {
      const a = makeAction({ category: ['percentage'] })
      const p = builtin({ categories: ['percentage'] })
      expect(matchSingleAction(a, 'PLD', p)).toBe(true)
    })

    it('jobRoles 命中玩家 role 时返回 true', () => {
      const a = makeAction({ category: ['percentage'] })
      const p = builtin({ jobRoles: ['tank'], categories: ['percentage'] })
      expect(matchSingleAction(a, 'PLD', p)).toBe(true)
    })

    it('jobRoles 不命中玩家 role 时返回 false', () => {
      const a = makeAction({ category: ['percentage'] })
      const p = builtin({ jobRoles: ['tank'], categories: ['percentage'] })
      expect(matchSingleAction(a, 'WHM', p)).toBe(false)
    })

    it('跨角色 action：只有目标 role 玩家通过', () => {
      const a = makeAction({ category: ['percentage'], jobs: ['PLD', 'WHM'] })
      const p = builtin({ jobRoles: ['tank'], categories: ['percentage'] })
      expect(matchSingleAction(a, 'PLD', p)).toBe(true)
      expect(matchSingleAction(a, 'WHM', p)).toBe(false)
    })

    it('action 有多 category，只要任一命中就通过', () => {
      const a = makeAction({ category: ['shield', 'percentage'] })
      const p = builtin({ categories: ['shield'] })
      expect(matchSingleAction(a, 'PLD', p)).toBe(true)
    })
  })

  describe('custom preset', () => {
    it('(job, actionId) 在白名单时返回 true', () => {
      const a = makeAction({ id: 42 })
      const p = custom({ PLD: [42] })
      expect(matchSingleAction(a, 'PLD', p)).toBe(true)
    })

    it('actionId 不在该 job 的白名单时返回 false', () => {
      const a = makeAction({ id: 42 })
      const p = custom({ PLD: [99] })
      expect(matchSingleAction(a, 'PLD', p)).toBe(false)
    })

    it('job 缺席白名单时返回 false', () => {
      const a = makeAction({ id: 42 })
      const p = custom({ WHM: [42] })
      expect(matchSingleAction(a, 'PLD', p)).toBe(false)
    })

    it('跨角色 action：仅勾选某 job 下能通过', () => {
      const a = makeAction({ id: 42, jobs: ['PLD', 'WHM'] })
      const p = custom({ PLD: [42] })
      expect(matchSingleAction(a, 'PLD', p)).toBe(true)
      expect(matchSingleAction(a, 'WHM', p)).toBe(false)
    })

    it('勾父时变体（trackGroup 指向父）一并通过', () => {
      const variant = makeAction({ id: 37016, trackGroup: 37013 })
      const p = custom({ PLD: [37013] })
      expect(matchSingleAction(variant, 'PLD', p)).toBe(true)
    })

    it('父自己也能匹配父 ID', () => {
      const parent = makeAction({ id: 37013 })
      const p = custom({ PLD: [37013] })
      expect(matchSingleAction(parent, 'PLD', p)).toBe(true)
    })

    it('未勾父时变体不通过', () => {
      const variant = makeAction({ id: 37016, trackGroup: 37013 })
      const p = custom({ PLD: [99999] })
      expect(matchSingleAction(variant, 'PLD', p)).toBe(false)
    })
  })
})

describe('matchDamageEvent', () => {
  it('事件 type 在 rule.damageTypes 中返回 true', () => {
    const e: DamageEvent = {
      id: 'd',
      name: '',
      time: 0,
      damage: 0,
      type: 'aoe',
      damageType: 'magical',
    }
    const p = builtin({ damageTypes: ['aoe'] })
    expect(matchDamageEvent(e, p)).toBe(true)
  })

  it('事件 type 不在 rule.damageTypes 中返回 false', () => {
    const e: DamageEvent = {
      id: 'd',
      name: '',
      time: 0,
      damage: 0,
      type: 'tankbuster',
      damageType: 'physical',
    }
    const p = builtin({ damageTypes: ['aoe'] })
    expect(matchDamageEvent(e, p)).toBe(false)
  })

  it('内置 raidwide 预设命中 partial_aoe', () => {
    const e: DamageEvent = {
      id: 'e',
      name: 'p',
      time: 0,
      damage: 0,
      type: 'partial_aoe',
      damageType: 'magical',
    }
    const p = builtin({ damageTypes: ['aoe', 'partial_aoe', 'partial_final_aoe'] })
    expect(matchDamageEvent(e, p)).toBe(true)
  })

  it('内置 raidwide 预设命中 partial_final_aoe', () => {
    const e: DamageEvent = {
      id: 'e',
      name: 'p',
      time: 0,
      damage: 0,
      type: 'partial_final_aoe',
      damageType: 'magical',
    }
    const p = builtin({ damageTypes: ['aoe', 'partial_aoe', 'partial_final_aoe'] })
    expect(matchDamageEvent(e, p)).toBe(true)
  })

  it('自定义预设老数据 damageTypes:["aoe"] 不被迁移，partial 事件不命中', () => {
    const e: DamageEvent = {
      id: 'e',
      name: 'p',
      time: 0,
      damage: 0,
      type: 'partial_aoe',
      damageType: 'magical',
    }
    const p = custom({}, ['aoe'])
    expect(matchDamageEvent(e, p)).toBe(false)
  })
})

describe('matchCastEvent', () => {
  it('action 未找到时返回 false', () => {
    const e: CastEvent = { id: 'c', actionId: 999, timestamp: 0, playerId: 1 }
    expect(matchCastEvent(e, 'PLD', builtin(), new Map())).toBe(false)
  })

  it('action 找到并通过 matchSingleAction 时返回 true', () => {
    const a = makeAction({ id: 42, category: ['percentage'] })
    const e: CastEvent = { id: 'c', actionId: 42, timestamp: 0, playerId: 1 }
    const p = builtin({ categories: ['percentage'] })
    expect(matchCastEvent(e, 'PLD', p, new Map([[42, a]]))).toBe(true)
  })
})

describe('matchTrack', () => {
  it('action 未找到时返回 false', () => {
    const t: SkillTrack = { job: 'PLD', playerId: 1, actionId: 999, actionName: '', actionIcon: '' }
    expect(matchTrack(t, builtin(), new Map())).toBe(false)
  })

  it('跨角色 action：track 的 job 决定命中', () => {
    const a = makeAction({ id: 42, category: ['percentage'], jobs: ['PLD', 'WHM'] })
    const tank: SkillTrack = {
      job: 'PLD',
      playerId: 1,
      actionId: 42,
      actionName: '',
      actionIcon: '',
    }
    const healer: SkillTrack = {
      job: 'WHM',
      playerId: 2,
      actionId: 42,
      actionName: '',
      actionIcon: '',
    }
    const p = builtin({ jobRoles: ['tank'], categories: ['percentage'] })
    expect(matchTrack(tank, p, new Map([[42, a]]))).toBe(true)
    expect(matchTrack(healer, p, new Map([[42, a]]))).toBe(false)
  })
})

// ========================= Hook integration tests =========================

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
    damageEvents: [
      { id: 'd1', name: 'aoe1', time: 10, damage: 100, type: 'aoe', damageType: 'magical' },
      { id: 'd2', name: 'tb1', time: 20, damage: 200, type: 'tankbuster', damageType: 'physical' },
    ],
    castEvents: [
      { id: 'c1', actionId: 3540, timestamp: 5, playerId: 1 }, // PLD 圣光幕帘（shield）
      { id: 'c2', actionId: 16536, timestamp: 6, playerId: 2 }, // WHM 节制（percentage）
      { id: 'c3', actionId: 7560, timestamp: 7, playerId: 3 }, // BLM 昏乱（percentage）
    ],
    statusEvents: [],
    annotations: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('useFilteredTimelineView', () => {
  beforeEach(() => {
    localStorage.clear()
    useFilterStore.setState({ customPresets: [], activeFilterId: 'builtin:all' })
    useMitigationStore.getState().loadActions()
    useTimelineStore.setState({ timeline: makeTimeline() })
  })

  it('builtin:all：两数组等于原数组', () => {
    const { result } = renderHook(() => useFilteredTimelineView())
    expect(result.current.filteredDamageEvents).toHaveLength(2)
    expect(result.current.filteredCastEvents).toHaveLength(3)
  })

  it('builtin:tank：保留所有 damage 与坦克玩家的 cast', () => {
    useFilterStore.setState({ activeFilterId: 'builtin:tank' })
    const { result } = renderHook(() => useFilteredTimelineView())
    expect(result.current.filteredDamageEvents.map(e => e.id)).toEqual(['d1', 'd2'])
    expect(result.current.filteredCastEvents.map(e => e.id)).toEqual(['c1'])
  })

  it('builtin:dps：只保留 aoe 与 DPS 玩家的 cast', () => {
    useFilterStore.setState({ activeFilterId: 'builtin:dps' })
    const { result } = renderHook(() => useFilteredTimelineView())
    expect(result.current.filteredDamageEvents.map(e => e.id)).toEqual(['d1'])
    expect(result.current.filteredCastEvents.map(e => e.id)).toEqual(['c3'])
  })

  it('custom 预设按 (job, actionId) 白名单过滤', () => {
    const id = useFilterStore.getState().addPreset('仅 WHM 节制', {
      damageTypes: ['aoe', 'tankbuster'],
      selectedActionsByJob: { WHM: [16536] },
    })
    useFilterStore.getState().setActiveFilter(id)
    const { result } = renderHook(() => useFilteredTimelineView())
    expect(result.current.filteredCastEvents.map(e => e.id)).toEqual(['c2'])
  })

  it('timeline 为 null 时返回空数组', () => {
    useTimelineStore.setState({ timeline: null })
    const { result } = renderHook(() => useFilteredTimelineView())
    expect(result.current.filteredDamageEvents).toEqual([])
    expect(result.current.filteredCastEvents).toEqual([])
  })
})
