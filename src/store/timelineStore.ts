/**
 * 时间轴状态管理
 */

import { create } from 'zustand'
import type { Timeline, DamageEvent, CastEvent, StatusEvent, Composition } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'
import type { MitigationStatus } from '@/types/status'
import type { ActionExecutionContext } from '@/types/mitigation'
import { saveTimeline } from '@/utils/timelineStorage'
import { MITIGATION_DATA } from '@/data/mitigationActions.new'
import { getStatusById } from '@/utils/statusRegistry'

// 自动保存延迟时间 (毫秒)
const AUTO_SAVE_DELAY = 2000

/**
 * 从状态事件构建小队状态（回放模式）
 */
function buildPartyStateFromStatusEvents(
  initialState: PartyState,
  statusEvents: StatusEvent[],
  time: number
): PartyState {
  // time 和 statusEvents 都是秒

  // 初始化状态
  const currentState: PartyState = {
    players: initialState.players.map((p) => ({
      ...p,
      statuses: [],
    })),
    enemy: {
      statuses: [],
    },
    timestamp: time,
  }

  // 过滤出在当前时间有效的状态事件
  const activeStatusEvents = statusEvents.filter(
    (event) => event.startTime <= time && event.endTime > time
  )

  // 将状态事件转换为 MitigationStatus 并分配到玩家/敌人
  for (const event of activeStatusEvents) {
    const statusMeta = getStatusById(event.statusId)
    if (!statusMeta) continue

    const status: MitigationStatus = {
      instanceId: `${event.targetPlayerId}-${event.statusId}-${event.targetInstance || 0}`,
      statusId: event.statusId,
      startTime: event.startTime,
      endTime: event.endTime,
      sourcePlayerId: event.sourcePlayerId,
      // 如果是盾值类型状态且有 absorb 字段，则初始化 remainingBarrier
      remainingBarrier: statusMeta.type === 'absorbed' && event.absorb ? event.absorb : undefined,
    }

    // 判断是友方还是敌方状态
    if (event.targetPlayerId) {
      const player = currentState.players.find((p) => p.id === event.targetPlayerId)
      if (player) {
        player.statuses.push(status)
      }
    } else {
      // 敌方状态
      currentState.enemy.statuses.push(status)
    }
  }

  return currentState
}


interface TimelineState {
  /** 当前时间轴 */
  timeline: Timeline | null
  /** 小队状态 */
  partyState: PartyState | null
  /** 选中的伤害事件 ID */
  selectedEventId: string | null
  /** 选中的技能使用事件 ID */
  selectedCastEventId: string | null
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
  /** 初始化小队状态 */
  initializePartyState: (composition: Composition) => void
  /** 执行技能并更新状态 */
  executeAction: (actionId: number, time: number, targetPlayerId?: number) => void
  /** 更新小队状态 */
  updatePartyState: (partyState: PartyState) => void
  /** 获取指定时间的小队状态 */
  getPartyStateAtTime: (time: number) => PartyState | null
  /** 清理过期状态 */
  cleanupExpiredStatuses: (currentTime: number) => void
  /** 选择伤害事件 */
  selectEvent: (eventId: string | null) => void
  /** 选择技能使用事件 */
  selectCastEvent: (castEventId: string | null) => void
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
  /** 添加技能使用事件 */
  addCastEvent: (castEvent: CastEvent) => void
  /** 更新技能使用事件 */
  updateCastEvent: (castEventId: string, updates: Partial<CastEvent>) => void
  /** 删除技能使用事件 */
  removeCastEvent: (castEventId: string) => void
  /** 解除回放模式 */
  exitReplayMode: () => void
  /** 触发自动保存 */
  triggerAutoSave: () => void
  /** 重置状态 */
  reset: () => void
}

const initialState = {
  timeline: null,
  partyState: null,
  selectedEventId: null,
  selectedCastEventId: null,
  currentTime: 0,
  isPlaying: false,
  zoomLevel: 50, // 50 像素/秒
  autoSaveTimer: null,
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  ...initialState,

  setTimeline: (timeline) => {
    set({
      timeline,
      selectedEventId: null,
      selectedCastEventId: null,
      currentTime: 0,
      isPlaying: false,
    })
    // 初始化小队状态
    if (timeline?.composition) {
      get().initializePartyState(timeline.composition)
    }
  },

  initializePartyState: (composition) => {
    const partyState: PartyState = {
      players: composition.players.map((player) => ({
        id: player.id,
        job: player.job,
        currentHP: 100000, // 默认 HP
        maxHP: 100000,
        statuses: [],
      })),
      enemy: {
        statuses: [],
      },
      timestamp: 0,
    }
    set({ partyState })
  },

  executeAction: (actionId, time, targetPlayerId) => {
    const state = get()
    if (!state.partyState) return

    // 查找技能
    const action = MITIGATION_DATA.actions.find((a) => a.id === actionId)
    if (!action) {
      console.error(`技能 ${actionId} 不存在`)
      return
    }

    // 创建执行上下文
    const context: ActionExecutionContext = {
      actionId,
      useTime: time,
      partyState: state.partyState,
      targetPlayerId,
    }

    // 执行技能并更新状态
    const newPartyState = action.executor(context)
    set({ partyState: newPartyState })
  },

  updatePartyState: (partyState) => {
    set({ partyState })
  },

  getPartyStateAtTime: (time) => {
    const state = get()
    if (!state.timeline || !state.partyState) return null

    // 回放模式：使用状态事件
    if (state.timeline.isReplayMode && state.timeline.statusEvents) {
      return buildPartyStateFromStatusEvents(
        state.partyState,
        state.timeline.statusEvents,
        time
      )
    }

    // 编辑模式：使用 executor 从 castEvents 生成状态
    // 从初始状态开始重放所有技能
    let currentState: PartyState = {
      players: state.partyState.players.map((p) => ({
        ...p,
        statuses: [],
      })),
      enemy: {
        statuses: [],
      },
      timestamp: time,
    }

    // 获取所有在指定时间之前使用的技能
    const castEvents = (state.timeline.castEvents || [])
      .filter((ce) => ce.timestamp <= time)
      .sort((a, b) => a.timestamp - b.timestamp)

    // 依次执行技能
    for (const castEvent of castEvents) {
      const action = MITIGATION_DATA.actions.find((a) => a.id === castEvent.actionId)
      if (!action) continue

      const context: ActionExecutionContext = {
        actionId: castEvent.actionId,
        useTime: castEvent.timestamp,
        partyState: currentState,
        targetPlayerId: castEvent.targetPlayerId,
      }

      currentState = action.executor(context)
    }

    // 过滤掉已过期的状态
    currentState = {
      ...currentState,
      players: currentState.players.map((p) => ({
        ...p,
        statuses: p.statuses.filter((s) => s.endTime >= time),
      })),
      enemy: {
        statuses: currentState.enemy.statuses.filter((s) => s.endTime >= time),
      },
      timestamp: time,
    }

    return currentState
  },

  cleanupExpiredStatuses: (currentTime) => {
    const state = get()
    if (!state.partyState) return

    const newPartyState: PartyState = {
      ...state.partyState,
      players: state.partyState.players.map((p) => ({
        ...p,
        statuses: p.statuses.filter((s) => s.endTime >= currentTime),
      })),
      enemy: {
        statuses: state.partyState.enemy.statuses.filter((s) => s.endTime >= currentTime),
      },
      timestamp: currentTime,
    }

    set({ partyState: newPartyState })
  },

  selectEvent: (eventId) =>
    set({
      selectedEventId: eventId,
      selectedCastEventId: null,
    }),

  selectCastEvent: (castEventId) =>
    set({
      selectedCastEventId: castEventId,
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

      // 获取新阵容中的所有玩家 ID
      const newPlayerIds = composition.players.map((p) => p.id)

      // 过滤掉不在新阵容中的玩家的技能使用事件
      const filteredCastEvents = state.timeline.castEvents.filter((castEvent) =>
        newPlayerIds.includes(castEvent.playerId)
      )

      return {
        timeline: {
          ...state.timeline,
          composition,
          castEvents: filteredCastEvents,
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().triggerAutoSave()
    // 重新初始化小队状态
    get().initializePartyState(composition)
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
        },
        selectedEventId: state.selectedEventId === eventId ? null : state.selectedEventId,
      }
    })
    get().triggerAutoSave()
  },

  addCastEvent: (castEvent) => {
    set((state) => {
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
    set((state) => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          castEvents: state.timeline.castEvents.map((castEvent) =>
            castEvent.id === castEventId ? { ...castEvent, ...updates } : castEvent
          ),
        },
      }
    })
    get().triggerAutoSave()
  },

  removeCastEvent: (castEventId) => {
    set((state) => {
      if (!state.timeline) return state

      return {
        timeline: {
          ...state.timeline,
          castEvents: state.timeline.castEvents.filter(
            (castEvent) => castEvent.id !== castEventId
          ),
        },
        selectedCastEventId:
          state.selectedCastEventId === castEventId ? null : state.selectedCastEventId,
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

  exitReplayMode: () => {
    set((state) => {
      if (!state.timeline || !state.timeline.isReplayMode) return state

      return {
        timeline: {
          ...state.timeline,
          isReplayMode: false,
          // 保留 statusEvents，因为编辑模式也可能有 statusEvents
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

  reset: () => {
    const state = get()
    if (state.autoSaveTimer) {
      clearTimeout(state.autoSaveTimer)
    }
    set(initialState)
  },
}))
