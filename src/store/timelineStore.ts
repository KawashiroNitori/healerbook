/**
 * 时间轴状态管理
 */

import { create } from 'zustand'
import type { Timeline, DamageEvent, CastEvent, Composition } from '@/types/timeline'
import type { PartyState, PlayerState } from '@/types/partyState'
import type { ActionExecutionContext, EncounterStatistics } from '@/types/mitigation'
import { saveTimeline, deleteTimeline } from '@/utils/timelineStorage'
import { MITIGATION_DATA } from '@/data/mitigationActions'

// 自动保存延迟时间 (毫秒)
const AUTO_SAVE_DELAY = 2000

interface TimelineState {
  /** 当前时间轴 */
  timeline: Timeline | null
  /** 小队状态 */
  partyState: PartyState | null
  /** 副本统计数据 */
  statistics: EncounterStatistics | null
  /** 选中的伤害事件 ID */
  selectedEventId: string | null
  /** 选中的技能使用事件 ID */
  selectedCastEventId: string | null
  /** 当前播放时间 (秒) */
  currentTime: number
  /** 缩放级别 (像素/秒) */
  zoomLevel: number
  /** 待恢复的滚动进度 (0-1) */
  pendingScrollProgress: number | null
  /** 当前滚动位置（用于缩放时计算进度） */
  currentScrollLeft: number
  /** 当前时间轴宽度（用于缩放时计算进度） */
  currentTimelineWidth: number
  /** 当前视口宽度（用于缩放时计算进度） */
  currentViewportWidth: number
  /** 自动保存定时器 */
  autoSaveTimer: number | null

  // Actions
  /** 设置时间轴 */
  setTimeline: (timeline: Timeline | null) => void
  /** 初始化小队状态 */
  initializePartyState: (composition: Composition) => void
  /** 设置副本统计数据 */
  setStatistics: (statistics: EncounterStatistics | null) => void
  /** 执行技能并更新状态 */
  executeAction: (actionId: number, time: number, sourcePlayerId: number) => void
  /** 更新小队状态 */
  updatePartyState: (partyState: PartyState) => void
  /** 清理过期状态 */
  cleanupExpiredStatuses: (currentTime: number) => void
  /** 选择伤害事件 */
  selectEvent: (eventId: string | null) => void
  /** 选择技能使用事件 */
  selectCastEvent: (castEventId: string | null) => void
  /** 设置当前时间 */
  setCurrentTime: (time: number) => void
  /** 设置缩放级别 */
  setZoomLevel: (level: number) => void
  /** 设置待恢复的滚动进度 */
  setPendingScrollProgress: (progress: number | null) => void
  /** 更新滚动状态（用于缩放计算） */
  updateScrollState: (scrollLeft: number, timelineWidth: number, viewportWidth: number) => void
  /** 带滚动进度保持的缩放 */
  zoomWithScrollPreservation: (delta: number) => void
  /** 更新时间轴名称 */
  updateTimelineName: (name: string) => void
  /** 更新时间轴说明 */
  updateTimelineDescription: (description: string) => void
  /** 更新阵容 */
  updateComposition: (composition: Composition) => void
  /** 添加伤害事件 */
  addDamageEvent: (event: DamageEvent) => void
  /** 更新伤害事件 */
  updateDamageEvent: (eventId: string, updates: Partial<DamageEvent>) => void
  /** 删除伤害事件 */
  removeDamageEvent: (eventId: string) => void
  /** 添加技能使用事件 */
  addCastEvent: (castEvent: CastEvent) => void
  /** 更新技能使用事件 */
  updateCastEvent: (castEventId: string, updates: Partial<CastEvent>) => void
  /** 删除技能使用事件 */
  removeCastEvent: (castEventId: string) => void
  /** 解除回放模式 */
  exitReplayMode: () => void
  /** 触发自动保存 */
  triggerAutoSave: (delay?: number) => void
  /** 将本地时间轴首次发布到服务器，更新 ID 和分享状态 */
  applyPublishResult: (newId: string, publishedAt: number, version: number) => void
  /** 将保存更新结果写入本地状态 */
  applyUpdateResult: (updatedAt: number, version: number) => void
  /** 从服务器版本覆盖本地（冲突解决 - 使用服务器版本） */
  applyServerTimeline: (
    serverTimeline: import('@/api/timelineShareApi').PublicSharedTimeline
  ) => void
  /** 重置状态 */
  reset: () => void
}

const initialState = {
  timeline: null,
  partyState: null,
  statistics: null,
  selectedEventId: null,
  selectedCastEventId: null,
  currentTime: 0,
  zoomLevel: 30, // xx 像素 / 秒
  pendingScrollProgress: null,
  currentScrollLeft: 0,
  currentTimelineWidth: 0,
  currentViewportWidth: 0,
  autoSaveTimer: null,
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  ...initialState,

  setTimeline: timeline => {
    set({
      timeline,
      selectedEventId: null,
      selectedCastEventId: null,
      currentTime: 0,
    })
    // 初始化小队状态
    if (timeline?.composition) {
      get().initializePartyState(timeline.composition)
    }
  },

  initializePartyState: composition => {
    const { statistics } = get()
    if (!composition.players || composition.players.length === 0) {
      set({ partyState: null })
      return
    }

    // 将所有玩家转换为 PlayerState
    const players: PlayerState[] = composition.players.map(p => ({
      id: p.id,
      job: p.job,
      maxHP: statistics?.maxHPByJob[p.job] ?? 100000,
    }))

    const partyState: PartyState = {
      players,
      statuses: [],
      timestamp: 0,
    }

    set({ partyState })
  },

  setStatistics: statistics => {
    set({ statistics })
    // 统计数据到位后用真实 HP 重新初始化小队状态
    const { timeline } = get()
    if (statistics && timeline?.composition) {
      get().initializePartyState(timeline.composition)
    }
  },

  executeAction: (actionId, time, sourcePlayerId) => {
    const state = get()
    if (!state.partyState) return

    // 查找技能
    const action = MITIGATION_DATA.actions.find(a => a.id === actionId)
    if (!action) {
      console.error(`技能 ${actionId} 不存在`)
      return
    }

    // 创建执行上下文
    const context: ActionExecutionContext = {
      actionId,
      useTime: time,
      partyState: state.partyState,
      sourcePlayerId,
      statistics: state.statistics ?? undefined,
    }

    // 执行技能并更新状态
    const newPartyState = action.executor(context)
    set({ partyState: newPartyState })
  },

  updatePartyState: partyState => {
    set({ partyState })
  },

  cleanupExpiredStatuses: currentTime => {
    const state = get()
    if (!state.partyState) return

    const newPartyState: PartyState = {
      ...state.partyState,
      statuses: state.partyState.statuses.filter(s => s.endTime >= currentTime),
      timestamp: currentTime,
    }

    set({ partyState: newPartyState })
  },

  selectEvent: eventId =>
    set({
      selectedEventId: eventId,
      selectedCastEventId: null,
    }),

  selectCastEvent: castEventId =>
    set({
      selectedCastEventId: castEventId,
      selectedEventId: null,
    }),

  setCurrentTime: time =>
    set({
      currentTime: Math.max(0, time),
    }),

  setZoomLevel: level =>
    set({
      zoomLevel: Math.max(10, Math.min(200, level)),
    }),

  setPendingScrollProgress: progress =>
    set({
      pendingScrollProgress: progress,
    }),

  updateScrollState: (scrollLeft, timelineWidth, viewportWidth) =>
    set({
      currentScrollLeft: scrollLeft,
      currentTimelineWidth: timelineWidth,
      currentViewportWidth: viewportWidth,
    }),

  zoomWithScrollPreservation: delta => {
    const state = get()
    const currentZoom = state.zoomLevel
    const newZoomLevel = Math.max(10, Math.min(200, currentZoom + delta))

    // 保存视口中央对应的时间（秒），缩放后据此还原位置
    const timeAtCenter = (state.currentScrollLeft + state.currentViewportWidth / 2) / currentZoom

    set({ pendingScrollProgress: timeAtCenter })

    // 更新缩放级别
    set({ zoomLevel: newZoomLevel })
  },

  updateTimelineName: name => {
    set(state => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          name,
          updatedAt: Math.floor(Date.now() / 1000),
        },
      }
    })
    get().triggerAutoSave(0)
  },

  updateTimelineDescription: description => {
    set(state => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          description: description || undefined,
          updatedAt: Math.floor(Date.now() / 1000),
        },
      }
    })
    get().triggerAutoSave(0)
  },

  updateComposition: composition => {
    set(state => {
      if (!state.timeline) return state

      // 获取新阵容中的所有玩家 ID
      const newPlayerIds = composition.players.map(p => p.id)

      // 过滤掉不在新阵容中的玩家的技能使用事件
      const filteredCastEvents = state.timeline.castEvents.filter(castEvent =>
        newPlayerIds.includes(castEvent.playerId)
      )

      return {
        timeline: {
          ...state.timeline,
          composition,
          castEvents: filteredCastEvents,
          updatedAt: Math.floor(Date.now() / 1000),
        },
      }
    })
    get().triggerAutoSave()
    // 重新初始化小队状态
    get().initializePartyState(composition)
  },

  addDamageEvent: event => {
    set(state => {
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
    set(state => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          damageEvents: state.timeline.damageEvents.map(event =>
            event.id === eventId ? { ...event, ...updates } : event
          ),
        },
      }
    })
    get().triggerAutoSave()
  },

  removeDamageEvent: eventId => {
    set(state => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          damageEvents: state.timeline.damageEvents.filter(event => event.id !== eventId),
        },
        selectedEventId: state.selectedEventId === eventId ? null : state.selectedEventId,
      }
    })
    get().triggerAutoSave()
  },

  addCastEvent: castEvent => {
    set(state => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          castEvents: [...state.timeline.castEvents, castEvent],
        },
      }
    })
    get().triggerAutoSave()
  },

  updateCastEvent: (castEventId, updates) => {
    set(state => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          castEvents: state.timeline.castEvents.map(castEvent =>
            castEvent.id === castEventId ? { ...castEvent, ...updates } : castEvent
          ),
        },
      }
    })
    get().triggerAutoSave()
  },

  removeCastEvent: castEventId => {
    set(state => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          castEvents: state.timeline.castEvents.filter(castEvent => castEvent.id !== castEventId),
        },
        selectedCastEventId:
          state.selectedCastEventId === castEventId ? null : state.selectedCastEventId,
      }
    })
    get().triggerAutoSave()
  },

  triggerAutoSave: (delay = AUTO_SAVE_DELAY) => {
    // 如果已发布，标记有本地未发布的修改
    const { timeline } = get()
    if (timeline?.isShared) {
      set(state => ({
        timeline: state.timeline ? { ...state.timeline, hasLocalChanges: true } : null,
      }))
    }

    const state = get()

    // 清除之前的定时器
    if (state.autoSaveTimer) {
      clearTimeout(state.autoSaveTimer)
    }

    // 如果 delay 为 0，立即保存
    if (delay === 0) {
      const currentState = get()
      if (currentState.timeline) {
        saveTimeline(currentState.timeline)
        console.log('立即保存完成')
      }
      set({ autoSaveTimer: null })
      return
    }

    // 设置新的定时器
    const timer = setTimeout(() => {
      const currentState = get()
      if (currentState.timeline) {
        saveTimeline(currentState.timeline)
        console.log('自动保存完成')
      }
    }, delay)

    set({ autoSaveTimer: timer })
  },

  exitReplayMode: () => {
    set(state => {
      if (!state.timeline || !state.timeline.isReplayMode) return state

      return {
        timeline: {
          ...state.timeline,
          isReplayMode: false,
          // 保留 statusEvents，因为编辑模式也可能有 statusEvents
          // 清除原始 FFLogs 伤害明细，编辑模式不再需要这些数据
          damageEvents: state.timeline.damageEvents.map(e => {
            const copy = { ...e }
            delete copy.playerDamageDetails
            return copy
          }),
        },
      }
    })
    get().triggerAutoSave()
    // 重新初始化小队状态（使用 executor）
    const timeline = get().timeline
    if (timeline?.composition) {
      get().initializePartyState(timeline.composition)
    }
  },

  applyPublishResult: (newId, _publishedAt, version) => {
    // 先捕获 oldId，再调用 set（set 之后 timeline.id 已变为 newId）
    const oldId = get().timeline?.id
    if (!oldId) return
    const now = Math.floor(Date.now() / 1000)
    const newTimeline = {
      ...get().timeline!,
      id: newId,
      isShared: true,
      hasLocalChanges: false,
      serverVersion: version,
      updatedAt: now,
    }
    set({ timeline: newTimeline })
    // 先写新 key，再删旧 key，避免数据丢失
    saveTimeline(newTimeline)
    deleteTimeline(oldId)
  },

  applyUpdateResult: (updatedAt, version) => {
    set(state => {
      if (!state.timeline) return state
      return {
        timeline: {
          ...state.timeline,
          hasLocalChanges: false,
          serverVersion: version,
          updatedAt,
        },
      }
    })
    const { timeline } = get()
    if (timeline) {
      saveTimeline(timeline)
    }
  },

  applyServerTimeline: serverTimeline => {
    const now = Math.floor(Date.now() / 1000)
    set(state => {
      if (!state.timeline) return state
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { isAuthor: _isAuthor, ...rest } = serverTimeline
      return {
        timeline: {
          ...state.timeline,
          ...rest,
          statusEvents: state.timeline.statusEvents,
          isShared: true,
          hasLocalChanges: false,
          serverVersion: rest.version,
          updatedAt: now,
        },
      }
    })
    const { timeline } = get()
    if (timeline) {
      saveTimeline(timeline)
    }
  },

  reset: () => {
    const state = get()
    if (state.autoSaveTimer) {
      clearTimeout(state.autoSaveTimer)
    }
    set(initialState)
  },
}))
