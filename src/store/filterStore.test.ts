// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useFilterStore, BUILTIN_PRESETS } from './filterStore'
import type { DamageEvent, DamageEventType } from '@/types/timeline'

function damageEvent(type: DamageEventType): DamageEvent {
  return { id: 'e', name: '', time: 0, damage: 0, type, damageType: 'magical' }
}

describe('filterStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useFilterStore.setState({
      customPresets: [],
      activeFilterId: 'builtin:all',
    })
  })

  describe('BUILTIN_PRESETS', () => {
    it('包含 5 个固定 id 的预置', () => {
      const ids = BUILTIN_PRESETS.map(p => p.id)
      expect(ids).toEqual([
        'builtin:all',
        'builtin:raidwide',
        'builtin:dps',
        'builtin:tank',
        'builtin:healer',
      ])
    })

    it('内置预设 raidwide 命中 aoe / partial_aoe / partial_final_aoe', () => {
      const p = BUILTIN_PRESETS.find(x => x.id === 'builtin:raidwide')!
      if (p.kind !== 'builtin') throw new Error('not builtin')
      for (const t of ['aoe', 'partial_aoe', 'partial_final_aoe'] as const) {
        expect(p.rule.damage(damageEvent(t))).toBe(true)
      }
    })

    it('内置预设 tank 命中全部 5 个攻击类型', () => {
      const p = BUILTIN_PRESETS.find(x => x.id === 'builtin:tank')!
      if (p.kind !== 'builtin') throw new Error('not builtin')
      for (const t of ['aoe', 'partial_aoe', 'partial_final_aoe', 'tankbuster', 'auto'] as const) {
        expect(p.rule.damage(damageEvent(t))).toBe(true)
      }
    })
  })

  describe('getAllPresets', () => {
    it('builtin 在前，custom 在后', () => {
      const id = useFilterStore.getState().addPreset('我的', {
        damageTypes: ['aoe'],
        selectedActionsByJob: {},
      })
      const all = useFilterStore.getState().getAllPresets()
      expect(all.slice(0, 5).map(p => p.id)).toEqual(BUILTIN_PRESETS.map(p => p.id))
      expect(all[5].id).toBe(id)
    })
  })

  describe('getActivePreset', () => {
    it('默认返回 builtin:all', () => {
      expect(useFilterStore.getState().getActivePreset().id).toBe('builtin:all')
    })

    it('activeFilterId 不存在时回退到 builtin:all', () => {
      useFilterStore.setState({ activeFilterId: 'custom:nonexistent' })
      expect(useFilterStore.getState().getActivePreset().id).toBe('builtin:all')
    })
  })

  describe('addPreset', () => {
    it('返回唯一 id 并追加到末尾', () => {
      const a = useFilterStore
        .getState()
        .addPreset('A', { damageTypes: [], selectedActionsByJob: {} })
      const b = useFilterStore
        .getState()
        .addPreset('B', { damageTypes: [], selectedActionsByJob: {} })
      expect(a).not.toBe(b)
      const custom = useFilterStore.getState().customPresets
      expect(custom.map(p => p.id)).toEqual([a, b])
    })
  })

  describe('updatePreset', () => {
    it('修改 name', () => {
      const id = useFilterStore
        .getState()
        .addPreset('old', { damageTypes: [], selectedActionsByJob: {} })
      useFilterStore.getState().updatePreset(id, { name: 'new' })
      expect(useFilterStore.getState().customPresets[0].name).toBe('new')
    })

    it('不存在的 id 静默忽略', () => {
      expect(() => useFilterStore.getState().updatePreset('nope', { name: 'x' })).not.toThrow()
    })
  })

  describe('deletePreset', () => {
    it('删除时若当前选中，activeFilterId 回退到 builtin:all', () => {
      const id = useFilterStore
        .getState()
        .addPreset('X', { damageTypes: [], selectedActionsByJob: {} })
      useFilterStore.getState().setActiveFilter(id)
      useFilterStore.getState().deletePreset(id)
      expect(useFilterStore.getState().activeFilterId).toBe('builtin:all')
    })

    it('删除非当前选中时不影响 activeFilterId', () => {
      const a = useFilterStore
        .getState()
        .addPreset('A', { damageTypes: [], selectedActionsByJob: {} })
      const b = useFilterStore
        .getState()
        .addPreset('B', { damageTypes: [], selectedActionsByJob: {} })
      useFilterStore.getState().setActiveFilter(a)
      useFilterStore.getState().deletePreset(b)
      expect(useFilterStore.getState().activeFilterId).toBe(a)
    })
  })

  describe('reorderPresets', () => {
    it('交换两项', () => {
      const a = useFilterStore
        .getState()
        .addPreset('A', { damageTypes: [], selectedActionsByJob: {} })
      const b = useFilterStore
        .getState()
        .addPreset('B', { damageTypes: [], selectedActionsByJob: {} })
      const c = useFilterStore
        .getState()
        .addPreset('C', { damageTypes: [], selectedActionsByJob: {} })
      useFilterStore.getState().reorderPresets(0, 2)
      expect(useFilterStore.getState().customPresets.map(p => p.id)).toEqual([b, c, a])
    })

    it('越界时无变化', () => {
      const a = useFilterStore
        .getState()
        .addPreset('A', { damageTypes: [], selectedActionsByJob: {} })
      useFilterStore.getState().reorderPresets(0, 5)
      expect(useFilterStore.getState().customPresets.map(p => p.id)).toEqual([a])
    })
  })
})
