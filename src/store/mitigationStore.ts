/**
 * 减伤技能状态管理
 */

import { create } from 'zustand'
import type { MitigationAction } from '@/types/mitigation'
import { MITIGATION_DATA } from '@/data/mitigationActions.new'
import type { Job } from '@/types/timeline'

interface MitigationState {
  /** 所有减伤技能 */
  actions: MitigationAction[]
  /** 选中的技能 ID */
  selectedActionId: string | null
  /** 技能过滤器 */
  filters: {
    jobs: Job[]
    isPartyWide: boolean | null
  }

  // Actions
  /** 初始化技能数据 */
  loadActions: () => void
  /** 选择技能 */
  selectAction: (actionId: string | null) => void
  /** 设置职业过滤器 */
  setJobFilter: (jobs: Job[]) => void
  /** 设置团队减伤过滤器 */
  setPartyWideFilter: (isPartyWide: boolean | null) => void
  /** 获取过滤后的技能 */
  getFilteredActions: () => MitigationAction[]
  /** 重置过滤器 */
  resetFilters: () => void
}

const initialFilters = {
  jobs: [] as Job[],
  isPartyWide: null,
}

export const useMitigationStore = create<MitigationState>((set, get) => ({
  actions: [],
  selectedActionId: null,
  filters: initialFilters,

  loadActions: () => {
    const actions = MITIGATION_DATA.actions
    set({ actions })
  },

  selectAction: (actionId) =>
    set({
      selectedActionId: actionId,
    }),

  setJobFilter: (jobs) =>
    set((state) => ({
      filters: {
        ...state.filters,
        jobs,
      },
    })),

  setPartyWideFilter: (isPartyWide) =>
    set((state) => ({
      filters: {
        ...state.filters,
        isPartyWide,
      },
    })),

  getFilteredActions: () => {
    const { actions, filters } = get()
    let filtered = actions

    // 职业过滤
    if (filters.jobs.length > 0) {
      filtered = filtered.filter((action) =>
        filters.jobs.some(job => action.jobs.includes(job))
      )
    }

    // 注意：isPartyWide 字段已被删除，此过滤器暂时禁用
    // 如果需要团队减伤过滤，需要根据新的数据结构重新实现

    return filtered
  },

  resetFilters: () =>
    set({
      filters: initialFilters,
    }),
}))
