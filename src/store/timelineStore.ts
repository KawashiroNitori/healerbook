/**
 * 时间轴状态管理
 *
 * 真相源是 `LocalSyncEngine` 持有的 `Y.Doc`;本 store 的 `timeline` 字段是它的
 * **只读投影**。内容类 mutation(增删改伤害事件 / cast / 注释 / 阵容 / 数值设置)
 * 不再做不可变 `set`,而是调用 `docSchema` 的 granular mutator 改 `Y.Doc`,改动
 * 经 `Y.Doc` 的 `update` 事件 → `reproject` → `set({ timeline })` 流回。
 *
 * UI 态字段(选中 / 当前时间 / 缩放 / 滚动)与运行时派生态(`partyState` /
 * `statistics`)仍是普通 Zustand 状态,沿用 `set` 写法。
 *
 * 撤销 / 重做走 `LocalSyncEngine` 的 `Y.UndoManager`。
 */

import { create } from 'zustand'
import type { Timeline, DamageEvent, CastEvent, Composition, Annotation } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'
import type { ActionExecutionContext, EncounterStatistics } from '@/types/mitigation'
import type { SharedTimelineResponse } from '@/api/timelineShareApi'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { createEmptyStatData, cleanupStatData } from '@/utils/statDataUtils'
import type { TimelineStatData } from '@/types/statData'
import { LocalSyncEngine } from '@/collab/LocalSyncEngine'
import type { Doc as YDoc } from 'yjs'
import {
  buildYDoc,
  projectTimeline,
  yAddDamageEvent,
  yUpdateDamageEvent,
  yRemoveDamageEvent,
  yAddCastEvent,
  yUpdateCastEvent,
  yRemoveCastEvent,
  yAddAnnotation,
  yUpdateAnnotation,
  yRemoveAnnotation,
  ySetMeta,
  yReplaceComposition,
  yReplaceStatData,
  yExitReplayMode,
} from '@/collab/docSchema'
import type { TimelineContent } from '@/collab/types'

/** `yReplaceStatData` 接受宽泛 `Record`,此处收敛到 `TimelineStatData` 入参 */
function replaceStatData(doc: YDoc, statData: TimelineStatData): void {
  yReplaceStatData(doc, statData as unknown as Record<string, unknown>)
}

/** `Timeline` → `TimelineContent`(去掉外部寻址 / 本地元数据 / 派生字段) */
function toContent(t: Timeline): TimelineContent {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const {
    id,
    isShared,
    everPublished,
    hasLocalChanges,
    serverVersion,
    statusEvents,
    updatedAt,
    ...content
  } = t
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return { ...content, annotations: content.annotations ?? [] }
}

interface TimelineState {
  /** 本地同步引擎(持有 Y.Doc 真相源);未打开时间轴时为 null */
  engine: LocalSyncEngine | null
  /** 当前时间轴 —— Y.Doc 的只读投影 */
  timeline: Timeline | null
  /** 撤销栈是否非空(响应式,供工具栏按钮禁用判定) */
  canUndo: boolean
  /** 重做栈是否非空(响应式) */
  canRedo: boolean
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

  // Actions
  /** 打开一条时间轴:创建 LocalSyncEngine,首帧投影 */
  openTimeline: (docId: string, seedContent?: TimelineContent) => Promise<void>
  /**
   * 设置时间轴(兼容旧消费方的同步接口)。
   * 内部委派给 `openTimeline`;传 null 时仅 `reset()`。
   * 注:实际打开是异步的,投影会在 IndexedDB 就绪后流入。
   */
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
  /** 添加注释 */
  addAnnotation: (annotation: Annotation) => void
  /** 更新注释 */
  updateAnnotation: (id: string, updates: Partial<Pick<Annotation, 'text' | 'time'>>) => void
  /** 删除注释 */
  removeAnnotation: (id: string) => void
  /** 解除回放模式（不可撤销） */
  exitReplayMode: () => void
  /** 更新时间轴统计数据 */
  updateStatData: (statData: TimelineStatData) => void
  /** 撤销 */
  undo: () => void
  /** 重做 */
  redo: () => void
  /** 将本地时间轴首次发布到服务器，更新 ID 和共享状态 */
  applyPublishResult: (newId: string, publishedAt: number, version: number) => void
  /** 将保存更新结果写入本地状态 */
  applyUpdateResult: (updatedAt: number, version: number) => void
  /** 从服务器版本覆盖本地（冲突解决 - 使用服务器版本） */
  applyServerTimeline: (response: SharedTimelineResponse) => void
  /** 重置状态 */
  reset: () => void
}

/** UI 态 / 运行时态初值(不含 engine / timeline) */
const initialUiState = {
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
}

export const useTimelineStore = create<TimelineState>()((set, get) => {
  /** observer:Y.Doc 变更 → 重投影(引用保持) */
  const reproject = () => {
    const engine = get().engine
    if (!engine) return
    const prev = get().timeline ?? undefined
    const next = projectTimeline(engine.doc, prev)
    next.id = engine.docId
    next.updatedAt = Math.floor(Date.now() / 1000)
    set({ timeline: next })
  }

  /** UndoManager 栈变化 → 同步 canUndo / canRedo */
  const syncUndoState = () => {
    const um = get().engine?.undoManager
    set({ canUndo: !!um?.canUndo(), canRedo: !!um?.canRedo() })
  }

  return {
    engine: null,
    timeline: null,
    canUndo: false,
    canRedo: false,
    ...initialUiState,

    openTimeline: async (docId, seedContent) => {
      get().engine?.destroy()
      // 切换时间轴:先清空旧投影与选择态,避免渲染到旧数据
      set({
        engine: null,
        timeline: null,
        selectedEventId: null,
        selectedCastEventId: null,
        canUndo: false,
        canRedo: false,
      })

      // seed:若内容缺 statData,补空结构(只存用户覆盖值)
      const seedDoc =
        seedContent !== undefined
          ? buildYDoc(
              seedContent.statData
                ? seedContent
                : { ...seedContent, statData: createEmptyStatData() }
            )
          : undefined

      const engine = await LocalSyncEngine.create(docId, seedDoc)
      engine.doc.on('update', reproject)
      engine.undoManager.on('stack-item-added', syncUndoState)
      engine.undoManager.on('stack-item-popped', syncUndoState)
      engine.undoManager.on('stack-cleared', syncUndoState)
      set({ engine, currentTime: 0 })
      reproject()

      // 持久化数据中可能缺 statData(存量迁移产物)→ 补空结构
      const projected = get().timeline
      if (projected && !projected.statData) {
        replaceStatData(engine.doc, createEmptyStatData())
      }

      // 首帧投影后初始化小队状态
      const composition = get().timeline?.composition
      if (composition) {
        get().initializePartyState(composition)
      }
    },

    setTimeline: timeline => {
      if (!timeline) {
        get().reset()
        return
      }
      // 委派给 openTimeline(异步;投影在 IndexedDB 就绪后流入)
      void get().openTimeline(timeline.id, toContent(timeline))
    },

    initializePartyState: composition => {
      if (!composition.players || composition.players.length === 0) {
        set({ partyState: null })
        return
      }

      const partyState: PartyState = {
        statuses: [],
        timestamp: 0,
      }

      set({ partyState })
    },

    setStatistics: newStatistics => {
      set({ statistics: newStatistics })
      // 统计数据到位后用真实 HP 重新初始化小队状态
      const { timeline } = get()
      if (newStatistics && timeline?.composition) {
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
        statistics: state.timeline?.statData ?? undefined,
      }

      // 执行技能并更新状态
      if (!action.executor) return
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
      const engine = get().engine
      if (!engine) return
      ySetMeta(engine.doc, { name })
    },

    updateTimelineDescription: description => {
      const engine = get().engine
      if (!engine) return
      // 空字符串归一为 undefined,与旧实现一致
      ySetMeta(engine.doc, { description: description || undefined })
    },

    updateComposition: composition => {
      const engine = get().engine
      if (!engine) return
      yReplaceComposition(engine.doc, composition.players)
      // yReplaceComposition 已级联清理 castEvent / skillTrack 注释;
      // statData 的阵容内清理在此补充(mutator 不碰 statData)
      const statData = get().timeline?.statData
      if (statData) {
        replaceStatData(engine.doc, cleanupStatData(statData, composition))
      }
      // 重新初始化小队状态
      get().initializePartyState(composition)
    },

    addDamageEvent: event => {
      const engine = get().engine
      if (!engine) return
      const clamped: DamageEvent = {
        ...event,
        time: Math.max(0, event.time),
        snapshotTime:
          event.snapshotTime != null ? Math.max(0, event.snapshotTime) : event.snapshotTime,
      }
      yAddDamageEvent(engine.doc, clamped)
    },

    updateDamageEvent: (eventId, updates) => {
      const engine = get().engine
      if (!engine) return
      const clamped: Partial<DamageEvent> = { ...updates }
      if (clamped.time != null) clamped.time = Math.max(0, clamped.time)
      if (clamped.snapshotTime != null) clamped.snapshotTime = Math.max(0, clamped.snapshotTime)
      yUpdateDamageEvent(engine.doc, eventId, clamped)
    },

    removeDamageEvent: eventId => {
      const engine = get().engine
      if (!engine) return
      yRemoveDamageEvent(engine.doc, eventId)
      if (get().selectedEventId === eventId) set({ selectedEventId: null })
    },

    addCastEvent: castEvent => {
      const engine = get().engine
      if (!engine) return
      yAddCastEvent(engine.doc, castEvent)
    },

    updateCastEvent: (castEventId, updates) => {
      const engine = get().engine
      if (!engine) return
      yUpdateCastEvent(engine.doc, castEventId, updates)
    },

    removeCastEvent: castEventId => {
      const engine = get().engine
      if (!engine) return
      yRemoveCastEvent(engine.doc, castEventId)
      if (get().selectedCastEventId === castEventId) set({ selectedCastEventId: null })
    },

    addAnnotation: annotation => {
      const engine = get().engine
      if (!engine) return
      yAddAnnotation(engine.doc, annotation)
    },

    updateAnnotation: (id, updates) => {
      const engine = get().engine
      if (!engine) return
      yUpdateAnnotation(engine.doc, id, updates)
    },

    removeAnnotation: id => {
      const engine = get().engine
      if (!engine) return
      yRemoveAnnotation(engine.doc, id)
    },

    updateStatData: statData => {
      const engine = get().engine
      if (!engine) return
      replaceStatData(engine.doc, statData)
    },

    exitReplayMode: () => {
      const engine = get().engine
      if (!engine || !get().timeline?.isReplayMode) return
      // 解除回放不可撤销:yExitReplayMode 用专用 origin,UndoManager 不跟踪
      yExitReplayMode(engine.doc)
      // 退出回放后之前的历史无意义,清空撤销栈
      engine.undoManager.clear()
      syncUndoState()
      // 重新初始化小队状态
      const composition = get().timeline?.composition
      if (composition) {
        get().initializePartyState(composition)
      }
    },

    undo: () => {
      get().engine?.undoManager.undo()
    },

    redo: () => {
      get().engine?.undoManager.redo()
    },

    applyPublishResult: () => {
      // 阶段 1:发布/版本锁模型尚未与 Y.Doc 投影模型对接(属阶段 2)。
      // 发布的网络调用仍在 SharePopover 内完成;此处不再写本地发布元数据。
    },

    applyUpdateResult: () => {
      // 阶段 1:同上,版本锁元数据写回属阶段 2。
    },

    applyServerTimeline: response => {
      // 阶段 1:用服务器版本覆盖本地——重开一条 Y.Doc 投影。
      get().setTimeline({
        ...response.timeline,
        statusEvents: [],
        annotations: response.timeline.annotations ?? [],
      })
    },

    reset: () => {
      get().engine?.destroy()
      set({ engine: null, timeline: null, canUndo: false, canRedo: false, ...initialUiState })
    },
  }
})
