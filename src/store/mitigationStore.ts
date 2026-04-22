/**
 * 减伤技能状态管理
 */

import { create } from 'zustand'
import type { MitigationAction } from '@/types/mitigation'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import type { Job } from '@/types/timeline'

interface MitigationState {
  /** 所有减伤技能 */
  actions: MitigationAction[]
  /** 选中的技能 ID */
  selectedActionId: string | null
  /** 技能过滤器 */
  filters: {
    jobs: Job[]
  }

  // Actions
  /** 初始化技能数据 */
  loadActions: () => void
  /** 选择技能 */
  selectAction: (actionId: string | null) => void
  /** 设置职业过滤器 */
  setJobFilter: (jobs: Job[]) => void
  /** 获取过滤后的技能 */
  getFilteredActions: () => MitigationAction[]
  /** 重置过滤器 */
  resetFilters: () => void
}

const initialFilters = {
  jobs: [] as Job[],
}

export const useMitigationStore = create<MitigationState>((set, get) => ({
  actions: [],
  selectedActionId: null,
  filters: initialFilters,

  loadActions: () => {
    const actions = MITIGATION_DATA.actions
    set({ actions })
  },

  selectAction: actionId =>
    set({
      selectedActionId: actionId,
    }),

  setJobFilter: jobs =>
    set(state => ({
      filters: {
        ...state.filters,
        jobs,
      },
    })),

  getFilteredActions: () => {
    const { actions, filters } = get()
    const visible = actions.filter(action => !action.trackGroup || action.trackGroup === action.id)
    if (filters.jobs.length === 0) return visible
    return visible.filter(action => filters.jobs.some(job => action.jobs.includes(job)))
  },

  resetFilters: () =>
    set({
      filters: initialFilters,
    }),
}))
