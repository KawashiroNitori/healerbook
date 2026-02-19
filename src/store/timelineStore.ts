/**
 * 时间轴状态管理
 */

import { create } from 'zustand'
import type { Timeline, DamageEvent, MitigationAssignment, Composition } from '@/types/timeline'
import { saveTimeline } from '@/utils/timelineStorage'

// 自动保存延迟时间 (毫秒)
const AUTO_SAVE_DELAY = 2000

interface TimelineState {
  /** 当前时间轴 */
  timeline: Timeline | null
  /** 选中的伤害事件 ID */
  selectedEventId: string | null
  /** 选中的减伤分配 ID */
  selectedAssignmentId: string | null
  /** 当前播放时间 (秒) */
  currentTime: number
  /** 是否正在播放 */
  isPlaying: boolean
  /** 缩放级别 (像素/秒) */
  zoomLevel: number
  /** 自动保存定时器 */
  autoSaveTimer: number | null

  // Actions
  /** 设置时间轴 */
  setTimeline: (timeline: Timeline | null) => void
  /** 选择伤害事件 */
  selectEvent: (eventId: string | null) => void
  /** 选择减伤分配 */
  selectAssignment: (assignmentId: string | null) => void
  /** 设置当前时间 */
  setCurrentTime: (time: number) => void
  /** 播放/暂停 */
  togglePlay: () => void
  /** 设置缩放级别 */
  setZoomLevel: (level: number) => void
  /** 更新阵容 */
  updateComposition: (composition: Composition) => void
  /** 添加伤害事件 */
  addDamageEvent: (event: DamageEvent) => void
  /** 更新伤害事件 */
  updateDamageEvent: (eventId: string, updates: Partial<DamageEvent>) => void
  /** 删除伤害事件 */
  removeDamageEvent: (eventId: string) => void
  /** 添加减伤分配 */
  addAssignment: (assignment: MitigationAssignment) => void
  /** 更新减伤分配 */
  updateAssignment: (assignmentId: string, updates: Partial<MitigationAssignment>) => void
  /** 删除减伤分配 */
  removeAssignment: (assignmentId: string) => void
  /** 触发自动保存 */
  triggerAutoSave: () => void
  /** 重置状态 */
  reset: () => void
}

const initialState = {
  timeline: null,
  selectedEventId: null,
  selectedAssignmentId: null,
  currentTime: 0,
  isPlaying: false,
  zoomLevel: 50, // 50 像素/秒
  autoSaveTimer: null,
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  ...initialState,

  setTimeline: (timeline) =>
    set({
      timeline,
      selectedEventId: null,
      selectedAssignmentId: null,
      currentTime: 0,
      isPlaying: false,
    }),

  selectEvent: (eventId) =>
    set({
      selectedEventId: eventId,
      selectedAssignmentId: null,
    }),

  selectAssignment: (assignmentId) =>
    set({
      selectedAssignmentId: assignmentId,
      selectedEventId: null,
    }),

  setCurrentTime: (time) =>
    set({
      currentTime: Math.max(0, time),
    }),

  togglePlay: () =>
    set((state) => ({
      isPlaying: !state.isPlaying,
    })),

  setZoomLevel: (level) =>
    set({
      zoomLevel: Math.max(10, Math.min(200, level)),
    }),

  updateComposition: (composition) => {
    set((state) => {
      if (!state.timeline) return state

      // 获取新阵容中的所有职业
      const newJobs = [
        ...(composition.tanks || []),
        ...(composition.healers || []),
        ...(composition.dps || []),
      ]

      // 过滤掉不在新阵容中的职业的技能分配
      const filteredAssignments = state.timeline.mitigationAssignments.filter((assignment) =>
        newJobs.includes(assignment.job)
      )

      return {
        timeline: {
          ...state.timeline,
          composition,
          mitigationAssignments: filteredAssignments,
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().triggerAutoSave()
  },

  addDamageEvent: (event) => {
    set((state) => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          damageEvents: [...state.timeline.damageEvents, event],
        },
      }
    })
    get().triggerAutoSave()
  },

  updateDamageEvent: (eventId, updates) => {
    set((state) => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          damageEvents: state.timeline.damageEvents.map((event) =>
            event.id === eventId ? { ...event, ...updates } : event
          ),
        },
      }
    })
    get().triggerAutoSave()
  },

  removeDamageEvent: (eventId) => {
    set((state) => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          damageEvents: state.timeline.damageEvents.filter((event) => event.id !== eventId),
          mitigationAssignments: state.timeline.mitigationAssignments.filter(
            (assignment) => assignment.damageEventId !== eventId
          ),
        },
        selectedEventId: state.selectedEventId === eventId ? null : state.selectedEventId,
      }
    })
    get().triggerAutoSave()
  },

  addAssignment: (assignment) => {
    set((state) => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          mitigationAssignments: [...state.timeline.mitigationAssignments, assignment],
        },
      }
    })
    get().triggerAutoSave()
  },

  updateAssignment: (assignmentId, updates) => {
    set((state) => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          mitigationAssignments: state.timeline.mitigationAssignments.map((assignment) =>
            assignment.id === assignmentId ? { ...assignment, ...updates } : assignment
          ),
        },
      }
    })
    get().triggerAutoSave()
  },

  removeAssignment: (assignmentId) => {
    set((state) => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          mitigationAssignments: state.timeline.mitigationAssignments.filter(
            (assignment) => assignment.id !== assignmentId
          ),
        },
        selectedAssignmentId:
          state.selectedAssignmentId === assignmentId ? null : state.selectedAssignmentId,
      }
    })
    get().triggerAutoSave()
  },

  triggerAutoSave: () => {
    const state = get()

    // 清除之前的定时器
    if (state.autoSaveTimer) {
      clearTimeout(state.autoSaveTimer)
    }

    // 设置新的定时器
    const timer = setTimeout(() => {
      const currentState = get()
      if (currentState.timeline) {
        saveTimeline(currentState.timeline)
        console.log('自动保存完成')
      }
    }, AUTO_SAVE_DELAY)

    set({ autoSaveTimer: timer })
  },

  reset: () => {
    const state = get()
    if (state.autoSaveTimer) {
      clearTimeout(state.autoSaveTimer)
    }
    set(initialState)
  },
}))
