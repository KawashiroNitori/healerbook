/**
 * 时间轴过滤器 store
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import type { FilterPreset, CustomFilterRule } from '@/types/filter'

export const BUILTIN_PRESETS: FilterPreset[] = [
  {
    kind: 'builtin',
    id: 'builtin:all',
    name: '全部',
    rule: {},
  },
  {
    kind: 'builtin',
    id: 'builtin:raidwide',
    name: '仅团减',
    rule: {
      damageTypes: ['aoe'],
      categories: ['partywide'],
    },
  },
  {
    kind: 'builtin',
    id: 'builtin:dps',
    name: '仅 DPS',
    rule: {
      damageTypes: ['aoe'],
      jobRoles: ['melee', 'ranged', 'caster'],
    },
  },
  {
    kind: 'builtin',
    id: 'builtin:tank',
    name: '仅坦克',
    rule: {
      damageTypes: ['aoe', 'tankbuster', 'auto'],
      jobRoles: ['tank'],
    },
  },
  {
    kind: 'builtin',
    id: 'builtin:healer',
    name: '仅治疗',
    rule: {
      damageTypes: ['aoe'],
      jobRoles: ['healer'],
    },
  },
]

interface FilterStore {
  customPresets: FilterPreset[]
  activeFilterId: string

  getAllPresets: () => FilterPreset[]
  getActivePreset: () => FilterPreset

  addPreset: (name: string, rule: CustomFilterRule) => string
  updatePreset: (id: string, patch: { name?: string; rule?: CustomFilterRule }) => void
  deletePreset: (id: string) => void
  reorderPresets: (fromIndex: number, toIndex: number) => void

  setActiveFilter: (id: string) => void
}

export const useFilterStore = create<FilterStore>()(
  persist(
    (set, get) => ({
      customPresets: [],
      activeFilterId: 'builtin:all',

      getAllPresets: () => [...BUILTIN_PRESETS, ...get().customPresets],

      getActivePreset: () => {
        const all = get().getAllPresets()
        return all.find(p => p.id === get().activeFilterId) ?? BUILTIN_PRESETS[0]
      },

      addPreset: (name, rule) => {
        const id = `custom:${nanoid()}`
        set(state => ({
          customPresets: [...state.customPresets, { kind: 'custom', id, name, rule }],
        }))
        return id
      },

      updatePreset: (id, patch) => {
        set(state => ({
          customPresets: state.customPresets.map(p =>
            p.id === id && p.kind === 'custom'
              ? { ...p, name: patch.name ?? p.name, rule: patch.rule ?? p.rule }
              : p
          ),
        }))
      },

      deletePreset: id => {
        set(state => ({
          customPresets: state.customPresets.filter(p => p.id !== id),
          activeFilterId: state.activeFilterId === id ? 'builtin:all' : state.activeFilterId,
        }))
      },

      reorderPresets: (fromIndex, toIndex) => {
        set(state => {
          const { customPresets } = state
          if (
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= customPresets.length ||
            toIndex >= customPresets.length
          ) {
            return state
          }
          const next = [...customPresets]
          const [moved] = next.splice(fromIndex, 1)
          next.splice(toIndex, 0, moved)
          return { customPresets: next }
        })
      },

      setActiveFilter: id => set({ activeFilterId: id }),
    }),
    {
      name: 'healerbook-filter-store',
      version: 1,
      partialize: state => ({
        customPresets: state.customPresets,
        activeFilterId: state.activeFilterId,
      }),
    }
  )
)
