/**
 * 时间轴状态管理
 *
 * 真相源是 `SyncEngine` 持有的 `Y.Doc`;本 store 的 `timeline` 字段是它的
 * **只读投影**。内容类 mutation(增删改伤害事件 / cast / 注释 / 阵容 / 数值设置)
 * 不再做不可变 `set`,而是调用 `docSchema` 的 granular mutator 改 `Y.Doc`,改动
 * 经 `Y.Doc` 的 `update` 事件 → `reproject` → `set({ timeline })` 流回。
 *
 * UI 态字段(选中 / 当前时间 / 缩放 / 滚动)与运行时派生态(`partyState` /
 * `statistics`)仍是普通 Zustand 状态,沿用 `set` 写法。
 *
 * 撤销 / 重做走 `SyncEngine` 的 `Y.UndoManager`。
 */

import { create } from 'zustand'
import { TIMELINE_START_TIME } from '@/components/Timeline/constants'
import { toast } from 'sonner'
import { useUIStore } from '@/store/uiStore'
import type {
  Timeline,
  DamageEvent,
  CastEvent,
  Composition,
  Annotation,
  SyncEvent,
} from '@/types/timeline'
import type { PartyState } from '@/types/partyState'
import type { ActionExecutionContext, EncounterStatistics } from '@/types/mitigation'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { createEmptyStatData, cleanupStatData } from '@/utils/statDataUtils'
import type { TimelineStatData } from '@/types/statData'
import { SyncEngine } from '@/collab/SyncEngine'
import type { ConnectionStatus } from '@/collab/RemoteConnection'
import type { LocalDocMeta } from '@/collab/types'
import { useAuthStore } from '@/store/authStore'
import type { PeerState, AwarenessState } from '@/collab/awarenessTypes'
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
import { LOCAL_ORIGIN, HOUSEKEEPING_ORIGIN } from '@/collab/constants'
import { generateId } from '@/utils/id'

/** `yReplaceStatData` 接受宽泛 `Record`,此处收敛到 `TimelineStatData` 入参 */
function replaceStatData(doc: YDoc, statData: TimelineStatData): void {
  yReplaceStatData(doc, statData as unknown as Record<string, unknown>)
}

export type SelectionKind = 'damage' | 'cast' | 'annotation'
export interface SelectionPatch {
  eventIds?: string[]
  castEventIds?: string[]
  annotationIds?: string[]
}

interface TimelineState {
  /** 同步引擎(持有 Y.Doc 真相源);未打开时间轴时为 null */
  engine: SyncEngine | null
  /** Y.Doc 投影;viewer 永远 null,editor/author 缓存命中或 LOAD_REPLY 后写入 */
  yDocProjection: Timeline | null
  /** REST KV 快照;三角色通用,editor/author 在 yDocReady 后清空 */
  snapshot: Timeline | null
  /** editor/author:Y.Doc 内容是否已就绪(本地缓存命中或 LOAD_REPLY 应用完毕);viewer 永远 false */
  yDocReady: boolean
  /** 派生:yDocProjection ?? snapshot;消费方继续读这里 */
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
  /** 选中的伤害事件 ID 列表（多选真相源） */
  selectedEventIds: string[]
  /** 选中的技能使用事件 ID 列表 */
  selectedCastEventIds: string[]
  /** 选中的注释 ID 列表 */
  selectedAnnotationIds: string[]
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
  /** 远端连接状态 */
  connectionStatus: ConnectionStatus
  /** 待处理的编辑权限申请数(仅作者有意义):GET /:id 播种 + WS 实时刷新 */
  pendingRequestCount: number
  /** 是否已发布到云端 */
  isPublished: boolean
  /** 当前会话角色（设计文档 §3.2） */
  sessionRole: 'local' | 'author' | 'editor' | 'viewer'
  /** 其他协作者的 awareness(已排除自身);非 editor 模式恒为空 */
  peers: PeerState[]

  // Actions
  /** 打开一条时间轴:创建 SyncEngine,首帧投影 */
  openTimeline: (
    docId: string,
    opts: {
      role: 'local' | 'author' | 'editor'
      seedContent?: TimelineContent
      /** REST KV 首屏兜底快照;editor/author 适用,缓存命中后立即清 */
      snapshot?: Timeline
    }
  ) => Promise<void>
  /** viewer 模式:直接用服务端 snapshot 只读渲染,不建引擎 */
  setViewerSnapshot: (timeline: Timeline) => void
  /** 原地发布升级:给当前引擎挂 remote(同 id 发布用) */
  attachRemote: () => void
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
  /** 整组替换选择 */
  setSelection: (sel: SelectionPatch) => void
  /** 与现有选择求并集（Shift 框选） */
  addToSelection: (sel: SelectionPatch) => void
  /** 切换单个对象选中态（Ctrl/Cmd 点击） */
  toggleSelection: (kind: SelectionKind, id: string) => void
  /** 清空全部选择 */
  clearSelection: () => void
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
  /** 批量平移选中对象的时间（同一事务，单步 undo） */
  bulkMoveSelection: (delta: number) => void
  /** 批量删除选中对象（同一事务，单步 undo），随后清空选择 */
  bulkDeleteSelection: () => void
  /** 批量导入：单个 Y.Doc 事务包裹所有写入，UndoManager 视为一步 */
  bulkImport: (data: {
    damageEvents?: DamageEvent[]
    castEvents?: CastEvent[]
    syncEvents?: SyncEvent[]
  }) => void
  /** 解除回放模式（不可撤销） */
  exitReplayMode: () => void
  /** 更新时间轴统计数据 */
  updateStatData: (statData: TimelineStatData) => void
  /** 撤销 */
  undo: () => void
  /** 重做 */
  redo: () => void
  /** 将本地时间轴首次发布到服务器，更新 ID 和共享状态 */
  applyPublishResult: (newId: string) => Promise<void>
  /** 重置状态 */
  reset: () => void
  /** 设本地悬停光标时间(秒);离开画布传 null */
  setLocalCursor: (time: number | null) => void
  /** 设本地拖动 ghost;拖动结束传 null */
  setLocalDragging: (dragging: AwarenessState['dragging']) => void
}

/** UI 态 / 运行时态初值(不含 engine / timeline) */
const initialUiState = {
  partyState: null,
  statistics: null,
  selectedEventId: null,
  selectedCastEventId: null,
  selectedEventIds: [],
  selectedCastEventIds: [],
  selectedAnnotationIds: [],
  currentTime: 0,
  zoomLevel: 30, // xx 像素 / 秒
  pendingScrollProgress: null,
  currentScrollLeft: 0,
  currentTimelineWidth: 0,
  currentViewportWidth: 0,
  connectionStatus: 'disconnected' as ConnectionStatus,
  pendingRequestCount: 0,
  isPublished: false,
  sessionRole: 'local' as const,
  peers: [] as PeerState[],
}

/** 由多选数组派生旧的单选字段：仅当总选中数==1 且为该类型时给出 id */
function deriveSingle(sel: {
  eventIds: string[]
  castEventIds: string[]
  annotationIds: string[]
}) {
  const total = sel.eventIds.length + sel.castEventIds.length + sel.annotationIds.length
  return {
    selectedEventId: total === 1 && sel.eventIds.length === 1 ? sel.eventIds[0] : null,
    selectedCastEventId: total === 1 && sel.castEventIds.length === 1 ? sel.castEventIds[0] : null,
  }
}

export const useTimelineStore = create<TimelineState>()((set, get) => {
  /** 每次 openTimeline 调用时递增;用于检测并发调用下的过期引擎 */
  let openGeneration = 0

  /** debounced meta 写入句柄 */
  let metaTimer: ReturnType<typeof setTimeout> | null = null

  /** awareness 'change' 订阅的取消句柄 */
  let peersUnsub: (() => void) | null = null

  /** 把当前投影写入 IndexedDB meta 表(debounced 1s) */
  const scheduleMetaWrite = () => {
    if (metaTimer) clearTimeout(metaTimer)
    metaTimer = setTimeout(() => {
      metaTimer = null
      const { engine, timeline, sessionRole } = get()
      if (!engine || !timeline) return
      const kind: LocalDocMeta['kind'] =
        sessionRole === 'local' ? 'local' : sessionRole === 'author' ? 'published' : 'visited'
      const meta: LocalDocMeta = {
        docId: engine.docId,
        name: timeline.name,
        encounterId: timeline.encounter?.id ?? 0,
        createdAt: timeline.createdAt,
        updatedAt: timeline.updatedAt,
        composition: timeline.composition ?? null,
        kind,
        lastViewedAt: Math.floor(Date.now() / 1000),
      }
      if (timeline.fflogsSource) meta.fflogsSource = timeline.fflogsSource
      void engine.saveMeta(meta)
    }, 1000)
  }

  /** 把 yDocProjection ?? snapshot 写回派生 timeline 字段 */
  const recomputeTimeline = () => {
    const { yDocProjection, snapshot } = get()
    set({ timeline: yDocProjection ?? snapshot })
  }

  /** observer:Y.Doc 变更 → 重投影(引用保持) */
  const reproject = () => {
    const engine = get().engine
    if (!engine) return
    const prev = get().yDocProjection ?? undefined
    const next = projectTimeline(engine.doc, prev)
    next.id = engine.docId
    next.updatedAt = Math.floor(Date.now() / 1000)
    set({ yDocProjection: next })
    recomputeTimeline()
    scheduleMetaWrite()
  }

  /** UndoManager 栈变化 → 同步 canUndo / canRedo */
  const syncUndoState = () => {
    const um = get().engine?.undoManager
    set({ canUndo: !!um?.canUndo(), canRedo: !!um?.canRedo() })
  }

  /** 把 awareness.getStates() 投影成 peers(排除自身) */
  const reprojectPeers = (engine: SyncEngine) => {
    const { awareness } = engine
    const self = awareness.clientID
    const peers: PeerState[] = []
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === self) continue
      const s = state as Partial<AwarenessState>
      if (!s.user) continue // 尚未设 user 的连接跳过
      peers.push({
        clientId,
        user: s.user,
        selection: s.selection ?? { eventId: null, castEventId: null },
        cursorTime: s.cursorTime ?? null,
        dragging: s.dragging ?? null,
      })
    }
    set({ peers })
  }

  /** 远端 doc 加载完成回调:缓存命中和 LOAD_REPLY 两条路径共用,幂等 */
  const onLoadedHandler = () => {
    if (get().yDocReady) return
    set({ yDocReady: true, snapshot: null })
    recomputeTimeline()
    // LOAD_REPLY 的 missing 可能为空,Y.applyUpdate 不触发 'update' 事件,
    // 自动 reproject 不会跑;手动调用一次保证 yDocProjection 一定写入。
    reproject()
  }

  /** 给指定引擎挂 remote;连接状态回流到 store */
  const wireRemote = (engine: SyncEngine) => {
    peersUnsub?.()
    peersUnsub = null
    engine.connectRemote(
      () => useAuthStore.getState().getValidToken(),
      status => set({ connectionStatus: status }),
      count => set({ pendingRequestCount: count }),
      () => {
        // 编辑权限被撤销：降级为 viewer，由 viewer cause 接管只读
        peersUnsub?.()
        peersUnsub = null
        set({ sessionRole: 'viewer' })
        toast.error('你的编辑权限已被移除')
      },
      onLoadedHandler
    )
    // 本地 awareness 不设 user —— 由服务端按 JWT 身份在广播帧注入(省上行 + 防伪)。
    // 仅初始化动态字段,并订阅 peers 变化。
    engine.awareness.setLocalStateField('selection', { eventId: null, castEventId: null })
    engine.awareness.setLocalStateField('cursorTime', null)
    engine.awareness.setLocalStateField('dragging', null)
    const onPeersChange = () => reprojectPeers(engine)
    engine.awareness.on('change', onPeersChange)
    peersUnsub = () => engine.awareness.off('change', onPeersChange)
    reprojectPeers(engine)
  }

  return {
    engine: null,
    yDocProjection: null,
    snapshot: null,
    yDocReady: false,
    timeline: null,
    canUndo: false,
    canRedo: false,
    ...initialUiState,

    openTimeline: async (docId, opts) => {
      const myGeneration = ++openGeneration

      const prevEngine = get().engine
      if (prevEngine) {
        prevEngine.doc.off('update', reproject)
        peersUnsub?.()
        peersUnsub = null
        prevEngine.destroy()
      }

      // 重置三源:snapshot 来自 opts(可为 undefined),yDocProjection / yDocReady 清空
      // timeline 由紧随其后的 recomputeTimeline() 派生写入(yDocProjection ?? snapshot)
      set({
        engine: null,
        yDocProjection: null,
        snapshot: opts.snapshot ?? null,
        yDocReady: false,
        selectedEventId: null,
        selectedCastEventId: null,
        selectedEventIds: [],
        selectedCastEventIds: [],
        selectedAnnotationIds: [],
        canUndo: false,
        canRedo: false,
        connectionStatus: 'disconnected',
        pendingRequestCount: 0,
        isPublished: opts.role !== 'local',
        sessionRole: opts.role,
        peers: [],
      })
      recomputeTimeline()
      useUIStore.setState({ manualLock: false })

      const seedContent = opts.seedContent
      const seedDoc =
        seedContent !== undefined
          ? buildYDoc(
              seedContent.statData
                ? seedContent
                : { ...seedContent, statData: createEmptyStatData() }
            )
          : undefined

      const engine = await SyncEngine.create(docId, seedDoc)

      if (myGeneration !== openGeneration) {
        engine.destroy()
        return
      }

      engine.doc.on('update', reproject)
      engine.undoManager.on('stack-item-added', syncUndoState)
      engine.undoManager.on('stack-item-popped', syncUndoState)
      engine.undoManager.on('stack-cleared', syncUndoState)
      set({ engine, currentTime: 0 })

      // 决定是否立即视为已加载:
      // - local:seed 即真相源,直接视为已加载;
      // - editor/author + 本地缓存命中:IndexedDB 内容即真相源(可能比 KV 更新),
      //   onLoadedHandler 立即清 snapshot、写 yDocReady=true、跑一次 reproject;
      // 否则 yDocReady=false,等 LOAD_REPLY 触发 onLoadedHandler;
      // timeline 派生此期间取 snapshot(若有)。
      if (opts.role === 'local' || engine.hadPersistedData) {
        onLoadedHandler()
      }

      // 持久化数据中可能缺 statData(存量迁移产物)→ 补空结构。
      // 仅在 Y.Doc 真相已就绪(yDocReady)时执行;缓存 miss 路径下 LOAD_REPLY
      // 后无独立检测点,历史存量缺失 statData 不在此修复(已知限制)。
      if (get().yDocReady) {
        const projected = get().yDocProjection
        if (projected && !projected.statData) {
          engine.doc.transact(() => {
            replaceStatData(engine.doc, createEmptyStatData())
          }, HOUSEKEEPING_ORIGIN)
        }
      }

      // 首帧投影后初始化小队状态
      const composition = get().timeline?.composition
      if (composition) {
        get().initializePartyState(composition)
      }

      // editor / author 模式:挂 remote(WS 连接 → load-doc → 双向同步)
      if (opts.role !== 'local') {
        wireRemote(engine)
      }
    },

    setViewerSnapshot: timeline => {
      if (metaTimer) {
        clearTimeout(metaTimer)
        metaTimer = null
      }
      const engine = get().engine
      if (engine) {
        engine.doc.off('update', reproject)
        peersUnsub?.()
        peersUnsub = null
        engine.destroy()
      }
      // timeline 由紧随其后的 recomputeTimeline() 派生写入(yDocProjection ?? snapshot)
      set({
        engine: null,
        yDocProjection: null,
        snapshot: timeline,
        yDocReady: false,
        isPublished: true,
        sessionRole: 'viewer',
        connectionStatus: 'disconnected',
        pendingRequestCount: 0,
        canUndo: false,
        canRedo: false,
        selectedEventId: null,
        selectedCastEventId: null,
        selectedEventIds: [],
        selectedCastEventIds: [],
        selectedAnnotationIds: [],
        peers: [],
      })
      recomputeTimeline()
      useUIStore.setState({ manualLock: false })
      if (timeline.composition) get().initializePartyState(timeline.composition)
    },

    attachRemote: () => {
      const engine = get().engine
      if (!engine || engine.hasRemote) return
      set({ isPublished: true, sessionRole: 'author' })
      wireRemote(engine)
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

    setSelection: sel => {
      const next = {
        eventIds: sel.eventIds ?? [],
        castEventIds: sel.castEventIds ?? [],
        annotationIds: sel.annotationIds ?? [],
      }
      set({
        selectedEventIds: next.eventIds,
        selectedCastEventIds: next.castEventIds,
        selectedAnnotationIds: next.annotationIds,
        ...deriveSingle(next),
      })
      // TODO(Task 8): awareness selection type becomes arrays
      get().engine?.awareness.setLocalStateField('selection', next as never)
    },

    addToSelection: sel => {
      const s = get()
      get().setSelection({
        eventIds: [...new Set([...s.selectedEventIds, ...(sel.eventIds ?? [])])],
        castEventIds: [...new Set([...s.selectedCastEventIds, ...(sel.castEventIds ?? [])])],
        annotationIds: [...new Set([...s.selectedAnnotationIds, ...(sel.annotationIds ?? [])])],
      })
    },

    toggleSelection: (kind, id) => {
      const s = get()
      const key =
        kind === 'damage'
          ? 'selectedEventIds'
          : kind === 'cast'
            ? 'selectedCastEventIds'
            : 'selectedAnnotationIds'
      const cur = s[key]
      const nextArr = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
      get().setSelection({
        eventIds: s.selectedEventIds,
        castEventIds: s.selectedCastEventIds,
        annotationIds: s.selectedAnnotationIds,
        [key === 'selectedEventIds'
          ? 'eventIds'
          : key === 'selectedCastEventIds'
            ? 'castEventIds'
            : 'annotationIds']: nextArr,
      })
    },

    clearSelection: () => get().setSelection({}),

    selectEvent: eventId => {
      if (eventId == null) get().clearSelection()
      else get().setSelection({ eventIds: [eventId] })
    },

    selectCastEvent: castEventId => {
      if (castEventId == null) get().clearSelection()
      else get().setSelection({ castEventIds: [castEventId] })
    },

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
      // Fix 3: 将两次 doc.transact 包进同一个外层事务,只触发一次 update 事件
      const statData = get().timeline?.statData
      engine.doc.transact(() => {
        yReplaceComposition(engine.doc, composition.players)
        // yReplaceComposition 已级联清理 castEvent / skillTrack 注释;
        // statData 的阵容内清理在此补充(mutator 不碰 statData)
        if (statData) {
          replaceStatData(engine.doc, cleanupStatData(statData, composition))
        }
      }, LOCAL_ORIGIN)
      // 重新初始化小队状态(需要 reproject 后的 timeline,保持在事务外)
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
      if (get().selectedEventIds.includes(eventId)) {
        get().setSelection({
          eventIds: get().selectedEventIds.filter(x => x !== eventId),
          castEventIds: get().selectedCastEventIds,
          annotationIds: get().selectedAnnotationIds,
        })
      }
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
      if (get().selectedCastEventIds.includes(castEventId)) {
        get().setSelection({
          eventIds: get().selectedEventIds,
          castEventIds: get().selectedCastEventIds.filter(x => x !== castEventId),
          annotationIds: get().selectedAnnotationIds,
        })
      }
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
      if (get().selectedAnnotationIds.includes(id)) {
        get().setSelection({
          eventIds: get().selectedEventIds,
          castEventIds: get().selectedCastEventIds,
          annotationIds: get().selectedAnnotationIds.filter(x => x !== id),
        })
      }
    },

    bulkMoveSelection: delta => {
      const engine = get().engine
      const tl = get().timeline
      if (!engine || !tl || delta === 0) return
      const { selectedEventIds, selectedCastEventIds, selectedAnnotationIds } = get()
      if (
        selectedEventIds.length === 0 &&
        selectedCastEventIds.length === 0 &&
        selectedAnnotationIds.length === 0
      )
        return
      const dmg = new Map(tl.damageEvents.map(e => [e.id, e]))
      const cast = new Map(tl.castEvents.map(c => [c.id, c]))
      const ann = new Map((tl.annotations ?? []).map(a => [a.id, a]))
      engine.doc.transact(() => {
        for (const id of selectedEventIds) {
          const e = dmg.get(id)
          if (e) yUpdateDamageEvent(engine.doc, id, { time: Math.max(0, e.time + delta) })
        }
        for (const id of selectedCastEventIds) {
          const c = cast.get(id)
          if (c)
            yUpdateCastEvent(engine.doc, id, {
              timestamp: Math.max(TIMELINE_START_TIME, c.timestamp + delta),
            })
        }
        for (const id of selectedAnnotationIds) {
          const a = ann.get(id)
          if (a)
            yUpdateAnnotation(engine.doc, id, {
              time: Math.max(TIMELINE_START_TIME, a.time + delta),
            })
        }
      }, LOCAL_ORIGIN)
    },

    bulkDeleteSelection: () => {
      const engine = get().engine
      if (!engine) return
      const { selectedEventIds, selectedCastEventIds, selectedAnnotationIds } = get()
      if (
        selectedEventIds.length === 0 &&
        selectedCastEventIds.length === 0 &&
        selectedAnnotationIds.length === 0
      )
        return
      engine.doc.transact(() => {
        for (const id of selectedEventIds) yRemoveDamageEvent(engine.doc, id)
        for (const id of selectedCastEventIds) yRemoveCastEvent(engine.doc, id)
        for (const id of selectedAnnotationIds) yRemoveAnnotation(engine.doc, id)
      }, LOCAL_ORIGIN)
      get().clearSelection()
    },

    bulkImport: data => {
      const engine = get().engine
      if (!engine) return
      const damageEvents = data.damageEvents ?? []
      const castEvents = data.castEvents ?? []
      const syncEvents = data.syncEvents ?? []
      if (damageEvents.length === 0 && castEvents.length === 0 && syncEvents.length === 0) return

      engine.doc.transact(() => {
        for (const e of damageEvents) {
          yAddDamageEvent(engine.doc, {
            ...e,
            id: generateId(),
            time: Math.max(0, e.time),
            snapshotTime: e.snapshotTime != null ? Math.max(0, e.snapshotTime) : e.snapshotTime,
          })
        }
        for (const c of castEvents) {
          yAddCastEvent(engine.doc, { ...c, id: generateId() })
        }
        if (syncEvents.length > 0) {
          // get().timeline reflects pre-transact state; Yjs fires 'update' only after
          // the outer transact completes, so reading here gives the existing baseline.
          const existing = get().timeline?.syncEvents ?? []
          const merged = [...existing, ...syncEvents].sort((a, b) => a.time - b.time)
          ySetMeta(engine.doc, { syncEvents: merged })
        }
      }, LOCAL_ORIGIN)
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

    applyPublishResult: async newId => {
      // 同 id 发布:原地给当前引擎挂 remote(Y.Doc 全程连续,不重建)。
      // id 被服务端清洗变更:由调用方 rekey IndexedDB 后 navigate 触发 EditorPage
      // 以 editor 模式重新 openTimeline,此处不处理。
      const engine = get().engine
      if (engine && engine.docId === newId) {
        get().attachRemote()
      }
    },

    setLocalCursor: time => {
      const engine = get().engine
      if (!engine) return
      engine.awareness.setLocalStateField('cursorTime', time)
    },

    setLocalDragging: dragging => {
      const engine = get().engine
      if (!engine) return
      engine.awareness.setLocalStateField('dragging', dragging)
    },

    reset: () => {
      if (metaTimer) {
        clearTimeout(metaTimer)
        metaTimer = null
      }
      const engine = get().engine
      if (engine) {
        engine.doc.off('update', reproject)
        peersUnsub?.()
        peersUnsub = null
        engine.destroy()
      }
      set({
        engine: null,
        yDocProjection: null,
        snapshot: null,
        yDocReady: false,
        timeline: null,
        canUndo: false,
        canRedo: false,
        ...initialUiState,
      })
    },
  }
})
