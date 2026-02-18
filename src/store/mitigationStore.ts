/**
 * 减伤技能状态管理
 */

import { create } from 'zustand'
import type { MitigationSkill } from '@/types/mitigation'
import { getAllMitigationSkills, getSkillsByJob } from '@/api/mitigationData'
import type { Job } from '@/types/timeline'

interface MitigationState {
  /** 所有减伤技能 */
  skills: MitigationSkill[]
  /** 选中的技能 ID */
  selectedSkillId: string | null
  /** 技能过滤器 */
  filters: {
    jobs: Job[]
    isPartyWide: boolean | null
  }

  // Actions
  /** 初始化技能数据 */
  loadSkills: () => void
  /** 选择技能 */
  selectSkill: (skillId: string | null) => void
  /** 设置职业过滤器 */
  setJobFilter: (jobs: Job[]) => void
  /** 设置团队减伤过滤器 */
  setPartyWideFilter: (isPartyWide: boolean | null) => void
  /** 获取过滤后的技能 */
  getFilteredSkills: () => MitigationSkill[]
  /** 重置过滤器 */
  resetFilters: () => void
}

const initialFilters = {
  jobs: [] as Job[],
  isPartyWide: null,
}

export const useMitigationStore = create<MitigationState>((set, get) => ({
  skills: [],
  selectedSkillId: null,
  filters: initialFilters,

  loadSkills: () => {
    const skills = getAllMitigationSkills()
    set({ skills })
  },

  selectSkill: (skillId) =>
    set({
      selectedSkillId: skillId,
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

  getFilteredSkills: () => {
    const { skills, filters } = get()
    let filtered = skills

    // 职业过滤
    if (filters.jobs.length > 0) {
      filtered = filtered.filter((skill) => filters.jobs.includes(skill.job))
    }

    // 团队减伤过滤
    if (filters.isPartyWide !== null) {
      filtered = filtered.filter((skill) => skill.isPartyWide === filters.isPartyWide)
    }

    return filtered
  },

  resetFilters: () =>
    set({
      filters: initialFilters,
    }),
}))
