/**
 * 时间轴 Canvas 主组件（重构版）
 */

import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Stage, Layer, Line, Text } from 'react-konva'
import type Konva from 'konva'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useTooltipStore } from '@/store/tooltipStore'
import { useUIStore } from '@/store/uiStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { useTimelinePanZoom } from '@/hooks/useTimelinePanZoom'
import type { PanZoomRefs } from '@/hooks/useTimelinePanZoom'
import { sortJobsByOrder, getJobName } from '@/data/jobs'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'
import {
  useDamageCalculationResults,
  useRemovalTimelinesByExcludeId,
  useResolvedVariantByCastId,
  useHpTimeline,
  useStatusTimelineByPlayer,
} from '@/contexts/DamageCalculationContext'
import { createPlacementEngine } from '@/utils/placement/engine'
import type { InvalidCastEventSummary, PlacementEngine } from '@/utils/placement/types'
import { getStatusById } from '@/utils/statusRegistry'
import { getStatusName } from '@/utils/statusIconUtils'
import { getSyncScrollProgress, setSyncScrollProgress } from '@/utils/syncScrollProgress'
import { generateObjectId } from '@/utils/shortId'
import {
  CLIPBOARD_MIME,
  buildClipboardPayload,
  parseClipboardPayload,
  remapClipboardForPaste,
  type PasteResult,
} from '@/utils/timelineClipboard'
import AddEventDialog from '../AddEventDialog'
import AnnotationPopover from './AnnotationPopover'
import TimelineContextMenu from './TimelineContextMenu'
import PasteConfirmDialog from './PasteConfirmDialog'
import type { ContextMenuState } from './TimelineContextMenu'
import TimeRuler from './TimeRuler'
import DamageEventTrack from './DamageEventTrack'
import SkillTrackLabels from './SkillTrackLabels'
import SkillTracksCanvas from './SkillTracksCanvas'
import TimelineMinimap from './TimelineMinimap'
import VerticalScrollbar, {
  SCROLLBAR_WIDTH,
  type VerticalScrollbarHandle,
} from './VerticalScrollbar'
import type { TimelineMinimapHandle } from './TimelineMinimap'
import type { SkillTrack } from '@/utils/skillTracks'
import type { AnnotationAnchor } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  TIMELINE_START_TIME,
  useCanvasColors,
  HP_CURVE_HEIGHT,
  CROSSHAIR_LINE_POINTS,
} from './constants'
import HpCurveTrack from './HpCurveTrack'
import { useMarqueeSelection } from './useMarqueeSelection'
import type { MarqueeObject } from './marqueeHitTest'
import { PeerOverlayFixed, PeerOverlayMain } from './PeerOverlay'
import { formatTimeWithDecimal } from '@/utils/formatters'
import { useSkillTracks } from '@/hooks/useSkillTracks'
import { useFilteredTimelineView } from '@/hooks/useFilteredTimelineView'
import { useFilterStore } from '@/store/filterStore'

interface TimelineCanvasProps {
  width: number
  height: number
}

// 注释文字气泡（悬浮/固定两种场景共用）
function AnnotationBubble({
  text,
  basePos,
}: {
  text: string
  basePos: { x: number; y: number; scrollY: boolean }
}) {
  return (
    <div
      className="fixed z-50 bg-popover text-popover-foreground border rounded-md shadow-md"
      style={
        {
          left: `calc(${basePos.x}px - var(--tl-scroll-x, 0px))`,
          top: basePos.scrollY
            ? `calc(${basePos.y}px - var(--tl-scroll-y, 0px))`
            : `${basePos.y}px`,
          pointerEvents: 'none',
        } as React.CSSProperties
      }
    >
      <div className="px-3 py-2 text-xs max-w-[240px] whitespace-pre-wrap break-words">{text}</div>
    </div>
  )
}

export default function TimelineCanvas({ width, height }: TimelineCanvasProps) {
  const canvasColors = useCanvasColors()
  const stageRef = useRef<Konva.Stage | null>(null)
  const fixedStageRef = useRef<Konva.Stage | null>(null)
  const labelColumnRef = useRef<HTMLDivElement>(null)
  const labelColumnContainerRef = useRef<HTMLDivElement>(null)
  const timelineContainerRef = useRef<HTMLDivElement>(null)
  const hasInitializedZoom = useRef(false)
  const scrollLeftRef = useRef(0)
  const scrollTopRef = useRef(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [pasteAvailable, setPasteAvailable] = useState<'checking' | boolean>(false)
  // 粘贴时有对象无法映射 → 暂存结果，等用户在确认框里决定是否继续
  const [pendingPaste, setPendingPaste] = useState<PasteResult | null>(null)
  const [editingAnnotation, setEditingAnnotation] = useState<{
    annotation: { id: string; text: string; time: number; anchor: AnnotationAnchor } | null
    time: number
    anchor: AnnotationAnchor
    screenX: number
    screenY: number
  } | null>(null)
  const [hoverAnnotationId, setHoverAnnotationId] = useState<string | null>(null)
  // 点击固定显示的注释 ID（位置在渲染时动态计算）
  const [pinnedAnnotationId, setPinnedAnnotationId] = useState<string | null>(null)
  // 用于区分注释 icon 点击和空白点击
  const annotationClickedRef = useRef(false)
  const [isDraggingAnnotation, setIsDraggingAnnotation] = useState(false)
  const [draggingEventPosition, setDraggingEventPosition] = useState<{
    eventId: string
    x: number
  } | null>(null)
  // 多选群组拖动：拖动一个选中对象时，其余选中对象实时同步偏移。
  // groupDrag（state）驱动渲染期偏移；groupDragAnchorRef（ref）存抓手起点 x，
  // 供 onDragMove 计算 delta，避免闭包读到过期 state。
  const [groupDrag, setGroupDrag] = useState<{
    delta: number
    draggedDamageId: string | null
    draggedCastId: string | null
  } | null>(null)
  const groupDragAnchorRef = useRef<{
    anchorX: number
    draggedDamageId: string | null
    draggedCastId: string | null
  } | null>(null)
  const [addEventAt, setAddEventAt] = useState<number | null>(null)
  // 虚拟滚动状态
  const [scrollLeft, setScrollLeft] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  // 拖动状态
  const isDraggingRef = useRef(false)
  const activePointerIdRef = useRef<number | null>(null)
  const dragStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 })
  const maxScrollLeftRef = useRef(0)
  const minScrollLeftRef = useRef(0)
  const maxScrollTopRef = useRef(0)
  const clampedScrollRef = useRef({ scrollLeft: 0, scrollTop: 0 })
  /** 实际视觉垂直滚动位置，仅由 handleDirectScroll 更新，不受 React state 影响 */
  const visualScrollTopRef = useRef(0)
  // 框选边缘自动滚动：最近指针的容器局部 x/y、rAF 句柄、循环内追踪的当前水平/垂直滚动
  const marqueePointerXRef = useRef(0)
  const marqueePointerYRef = useRef(0)
  const autoScrollRafRef = useRef<number | null>(null)
  const autoScrollScrollLeftRef = useRef(0)
  const autoScrollScrollTopRef = useRef(0)
  // 记录是否点击了背景（用于区分点击和拖动）
  const clickedBackgroundRef = useRef(false)
  const hasMovedRef = useRef(false)
  // 平移刚结束标记：mouseup 时设 true，同帧 click 可见；requestAnimationFrame 自动清除
  const panJustEndedRef = useRef(false)
  const lastPanEndTimeRef = useRef(0) // 记录最后一次平移结束的时间戳，用于阻止 dblclick
  // Konva Layer refs（用于直接操作 Layer 位置，绕过 React 渲染）
  const fixedLayerRef = useRef<Konva.Layer | null>(null)
  const mainBgLayerRef = useRef<Konva.Layer | null>(null)
  const mainEventLayerRef = useRef<Konva.Layer | null>(null)
  // 十字准线状态（仅 ref，不触发 React 重渲染）
  const hoverTimeRef = useRef<number | null>(null)
  const hoverTrackIndexRef = useRef<number | null>(null)
  // 十字准线 Konva 节点 refs（直接操控，绕过 React 渲染）
  const crosshairFixedLineRef = useRef<Konva.Line>(null)
  const crosshairMainLineRef = useRef<Konva.Line>(null)
  const trackHighlightRef = useRef<Konva.Rect>(null)
  const timeIndicatorLineRef = useRef<Konva.Line>(null)
  const timeIndicatorTextRef = useRef<Konva.Text>(null)
  // overlay Layer refs
  const mainOverlayLayerRef = useRef<Konva.Layer | null>(null)
  const fixedOverlayLayerRef = useRef<Konva.Layer | null>(null)
  // 本地悬停光标节流（~50ms，避免每帧都写 awareness）
  const lastCursorSendRef = useRef(0)
  // 本地拖动 ghost 节流（~50ms，与光标节流独立）
  const lastDragSendRef = useRef(0)
  const minimapRef = useRef<TimelineMinimapHandle | null>(null)
  const scrollbarRef = useRef<VerticalScrollbarHandle | null>(null)
  // 框选：渲染期写入最新的对象 box 构建函数，pointerup 时读取（避免 stale 闭包）
  const buildMarqueeObjectsRef = useRef<() => MarqueeObject[]>(() => [])

  const {
    timeline,
    zoomLevel,
    pendingScrollProgress,
    selectEvent,
    selectCastEvent,
    addCastEvent,
    removeDamageEvent,
    removeCastEvent,
    setZoomLevel,
    setPendingScrollProgress,
    updateScrollState,
    undo,
    redo,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
  } = useTimelineStore()
  // 多选 ID 列表——渲染期需响应式订阅，保证高亮随选区变化更新
  const selectedEventIds = useTimelineStore(s => s.selectedEventIds)
  const selectedCastEventIds = useTimelineStore(s => s.selectedCastEventIds)
  const selectedAnnotationIds = useTimelineStore(s => s.selectedAnnotationIds)
  const { actions } = useMitigationStore()
  const { isDamageTrackCollapsed, toggleDamageTrackCollapsed } = useUIStore()
  const enableHpSimulation = useUIStore(s => s.enableHpSimulation)
  const canvasTool = useUIStore(s => s.canvasTool)
  const calculationResults = useDamageCalculationResults()
  const removalTimelinesByExcludeId = useRemovalTimelinesByExcludeId()
  const statusTimelineByPlayer = useStatusTimelineByPlayer()
  const resolvedVariantByCastId = useResolvedVariantByCastId()
  const hpTimeline = useHpTimeline()

  const actionMap = useMemo(() => new Map(actions.map(a => [a.id, a])), [actions])

  const engine: PlacementEngine | null = useMemo(() => {
    if (!timeline) return null
    return createPlacementEngine({
      castEvents: timeline.castEvents,
      actions: actionMap,
      statusTimelineByPlayer,
      removalTimelinesByExcludeId,
      resolvedVariantByCastId,
    })
  }, [
    timeline,
    actionMap,
    statusTimelineByPlayer,
    removalTimelinesByExcludeId,
    resolvedVariantByCastId,
  ])

  const draggingId = useUIStore(s => s.draggingId)
  const setDraggingId = useUIStore(s => s.setDraggingId)

  // 他人正在拖动的对象 id 集合（只在 drag start/end 时变化，不受 cursor move 影响）
  const peerDraggingIdList = useTimelineStore(
    useShallow(s => s.peers.filter(p => p.dragging).map(p => p.dragging!.id))
  )
  const peerDraggingIds = useMemo(() => new Set(peerDraggingIdList), [peerDraggingIdList])

  // drop 落点提交后 castEvents 变新引用 → 自动清空 draggingId。
  // 放在 useEffect 而不是 onDragEnd 里，是为了避开 Konva 释放瞬间的状态收束：
  // 同步 setState 会让 Group 在 dragend 过程中 re-render，丢失 drag 结束信号导致
  // "松手后图标继续跟随鼠标、直到下次点击才落点"的 bug。
  useEffect(() => {
    if (draggingId) setDraggingId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline?.castEvents])

  const invalidCastEventMap = useMemo(() => {
    // 回放模式下数据来自 FFLogs 实战记录，placement/CD 校验对用户不可操作，
    // 红框只是视觉噪声 → 直接返回空 Map 抑制标记
    if (!engine || timeline?.isReplayMode) return new Map<string, InvalidCastEventSummary>()
    const invalid = engine.findInvalidCastEvents(draggingId ?? undefined)
    return new Map(
      invalid.map(r => [r.castEvent.id, { reason: r.reason, resourceId: r.resourceId }])
    )
  }, [engine, draggingId, timeline?.isReplayMode])

  const { showTooltip, toggleTooltip, hideTooltip } = useTooltipStore()
  const isReadOnly = useEditorReadOnly()
  const skillTracks = useSkillTracks()
  const { filteredDamageEvents, filteredCastEvents } = useFilteredTimelineView()

  // 平移/缩放交互 Hook 的共享 refs
  const panZoomRefs: PanZoomRefs = {
    isDraggingRef,
    activePointerIdRef,
    dragStartRef,
    maxScrollLeftRef,
    minScrollLeftRef,
    maxScrollTopRef,
    clampedScrollRef,
    visualScrollTopRef,
    clickedBackgroundRef,
    hasMovedRef,
    panJustEndedRef,
    lastPanEndTimeRef,
  }

  // 直接操作 Konva Layer 位置的回调（拖动期间绕过 React 渲染）
  const handleDirectScroll = useCallback((newScrollLeft: number, newScrollTop: number) => {
    // 记录真实视觉滚动位置（供 handlePointerDown 读取，不受过时 React state 影响）
    visualScrollTopRef.current = newScrollTop
    // 固定区域 Layer（仅水平滚动）
    if (fixedLayerRef.current) {
      fixedLayerRef.current.x(-newScrollLeft)
      fixedLayerRef.current.getStage()?.batchDraw()
    }
    // 技能轨道 Layers（水平 + 垂直滚动）
    if (mainBgLayerRef.current) {
      mainBgLayerRef.current.x(-newScrollLeft)
      mainBgLayerRef.current.y(-newScrollTop)
    }
    if (mainEventLayerRef.current) {
      mainEventLayerRef.current.x(-newScrollLeft)
      mainEventLayerRef.current.y(-newScrollTop)
      mainEventLayerRef.current.getStage()?.batchDraw()
    }
    // 十字准线 overlay Layer 同步
    if (mainOverlayLayerRef.current) {
      mainOverlayLayerRef.current.x(-newScrollLeft)
      mainOverlayLayerRef.current.y(-newScrollTop)
    }
    // 固定区域十字准线 overlay
    if (fixedOverlayLayerRef.current) {
      fixedOverlayLayerRef.current.x(-newScrollLeft)
      fixedOverlayLayerRef.current.getStage()?.batchDraw()
    }
    // 标签列垂直滚动
    if (labelColumnContainerRef.current) {
      labelColumnContainerRef.current.style.transform = `translateY(-${newScrollTop}px)`
    }
    // 滚动条 thumb 同步
    scrollbarRef.current?.updateScrollTop(newScrollTop)
    // 固定展示的注释 popover 实时跟随滚动（通过 CSS 自定义属性驱动 calc()）
    if (timelineContainerRef.current) {
      timelineContainerRef.current.style.setProperty('--tl-scroll-x', `${newScrollLeft}px`)
      timelineContainerRef.current.style.setProperty('--tl-scroll-y', `${newScrollTop}px`)
    }
    // 同步 minimap 视口指示器
    minimapRef.current?.updateViewport(newScrollLeft)
  }, [])

  // 卸载兜底：若拖框中途组件卸载，停掉边缘自动滚动 rAF，避免无限重排
  useEffect(() => {
    return () => {
      if (autoScrollRafRef.current !== null) cancelAnimationFrame(autoScrollRafRef.current)
    }
  }, [])

  // 布局常量
  const timeRulerHeight = 30
  const skillTrackHeight = 40
  const labelColumnWidth = 70
  const minimapHeight = 80 + 16 + 1 // canvas(80) + p-2 padding(16) + border-t(1)

  // 固定区域 Stage：标尺带内拖动让位给框选（infinite-height）；select 模式全局让位。
  useTimelinePanZoom(fixedStageRef, panZoomRefs, {
    enableVerticalScroll: false,
    isReadOnly,
    setScrollLeft,
    setScrollTop,
    onDirectScroll: handleDirectScroll,
    canvasTool,
    rulerHeight: timeRulerHeight,
  })
  // 技能轨道 Stage：容器顶部即轨道区，不含标尺带 → rulerHeight 传 0，仅 select 模式让位。
  useTimelinePanZoom(stageRef, panZoomRefs, {
    enableVerticalScroll: true,
    isReadOnly,
    setScrollLeft,
    setScrollTop,
    onDirectScroll: handleDirectScroll,
    canvasTool,
    rulerHeight: 0,
  })

  // 框选：buildObjects 委托给渲染期写入的 ref，保证用当前滚动/缩放下的屏幕坐标
  const buildMarqueeObjects = useCallback(() => buildMarqueeObjectsRef.current(), [])
  const marquee = useMarqueeSelection({
    rulerHeight: timeRulerHeight,
    buildObjects: buildMarqueeObjects,
  })

  // 计算布局数据（仅在 timeline/zoomLevel/actions 变化时重新计算）
  const layoutData = useMemo(() => {
    if (!timeline) return null

    // 泳道算法：为每个伤害事件分配行
    const CARD_WIDTH_SECONDS = 150 / zoomLevel // 卡片固定 150px 转换为秒
    const LANE_ROW_HEIGHT = 36 // 每行高度（px）
    const damageEventRowMap = new Map<string, number>()

    let laneCount: number
    if (isDamageTrackCollapsed) {
      // 折叠模式：所有事件重叠在同一行
      for (const event of filteredDamageEvents) {
        damageEventRowMap.set(event.id, 0)
      }
      laneCount = 1
    } else {
      const laneEndTimes: number[] = [] // 每个泳道当前最右端的时间（秒）
      const sortedDamageEvents = [...filteredDamageEvents].sort((a, b) => a.time - b.time)
      for (const event of sortedDamageEvents) {
        const laneIndex = laneEndTimes.findIndex(endTime => endTime <= event.time)
        if (laneIndex !== -1) {
          damageEventRowMap.set(event.id, laneIndex)
          laneEndTimes[laneIndex] = event.time + CARD_WIDTH_SECONDS
        } else {
          damageEventRowMap.set(event.id, laneEndTimes.length)
          laneEndTimes.push(event.time + CARD_WIDTH_SECONDS)
        }
      }
      laneCount = Math.max(1, laneEndTimes.length)
    }
    const eventTrackHeight = laneCount * LANE_ROW_HEIGHT

    // 计算时间轴总长度
    const lastEventTime = Math.max(
      0,
      ...timeline.damageEvents.map(e => e.time),
      ...timeline.castEvents.map(ce => ce.timestamp)
    )

    const maxTime = Math.max(300, lastEventTime + 60)
    const timelineWidth = (maxTime - TIMELINE_START_TIME) * zoomLevel
    const hasHpData = hpTimeline.length >= 2
    const hpTrackHeight = enableHpSimulation && hasHpData ? HP_CURVE_HEIGHT : 0
    const fixedAreaHeight = timeRulerHeight + eventTrackHeight + hpTrackHeight
    const skillTracksHeight = skillTracks.length * skillTrackHeight

    return {
      damageEventRowMap,
      eventTrackHeight,
      timelineWidth,
      fixedAreaHeight,
      skillTracksHeight,
      laneCount,
      LANE_ROW_HEIGHT,
      hpTrackHeight,
      // Task 14/15 会移除 displayActionOverrides prop 管道；trackGroup + 原始 actionId
      // 已经让渲染层自然挂载，此 Map 暂留为空占位以保持编译。
      displayActionOverrides: new Map<string, MitigationAction>(),
      maxTime,
    }
  }, [
    timeline,
    zoomLevel,
    skillTracks,
    isDamageTrackCollapsed,
    filteredDamageEvents,
    enableHpSimulation,
    hpTimeline.length,
  ])

  // 隐藏十字准线所有元素（含轨道高亮与时间指示器）
  const hideCrosshair = useCallback(() => {
    crosshairFixedLineRef.current?.visible(false)
    crosshairMainLineRef.current?.visible(false)
    trackHighlightRef.current?.visible(false)
    timeIndicatorLineRef.current?.visible(false)
    timeIndicatorTextRef.current?.visible(false)
    fixedStageRef.current?.batchDraw()
    stageRef.current?.batchDraw()
  }, [])

  // 十字准线：鼠标移动事件（直接操作 Konva 节点，不触发 React 重渲染）
  const createCrosshairMoveHandler = useCallback(
    (
      stageRefParam: React.RefObject<Konva.Stage | null>,
      withTrackHighlight: boolean,
      hasRuler: boolean
    ) =>
      (e: MouseEvent) => {
        if (isDraggingRef.current) {
          if (hoverTimeRef.current !== null) {
            hoverTimeRef.current = null
            hoverTrackIndexRef.current = null
            hideCrosshair()
          }
          return
        }

        const stage = stageRefParam.current
        if (!stage) return

        const rect = stage.container().getBoundingClientRect()
        const pointerX = e.clientX - rect.left
        const time = (pointerX + clampedScrollRef.current.scrollLeft) / zoomLevel
        const xPx = time * zoomLevel

        hoverTimeRef.current = time

        // 光标提示：当一次拖拽会触发框选时给 crosshair（框选模式整片画布，或鼠标在时间标尺带内）
        const overRuler = hasRuler && e.clientY - rect.top <= timeRulerHeight
        stage.container().style.cursor =
          useUIStore.getState().canvasTool === 'select' || overRuler ? 'crosshair' : 'default'

        // 节流上报本地光标位置（~50ms），避免高频 awareness 写入
        const now = Date.now()
        if (now - lastCursorSendRef.current >= 50) {
          lastCursorSendRef.current = now
          useTimelineStore.getState().setLocalCursor(time)
        }

        // 更新固定区域十字准线纵线
        const fixedLine = crosshairFixedLineRef.current
        if (fixedLine) {
          fixedLine.points([xPx, 0, xPx, layoutData?.fixedAreaHeight ?? 0])
          fixedLine.visible(true)
        }

        // 更新技能轨道区域十字准线纵线
        const mainLine = crosshairMainLineRef.current
        if (mainLine) {
          mainLine.points([xPx, 0, xPx, layoutData?.skillTracksHeight ?? 0])
          mainLine.visible(true)
        }

        // 更新时间标尺悬浮指示器（线 + 文字）
        const tiLine = timeIndicatorLineRef.current
        if (tiLine) {
          tiLine.points([xPx, 0, xPx, timeRulerHeight])
          tiLine.visible(true)
        }
        const tiText = timeIndicatorTextRef.current
        if (tiText) {
          tiText.x(xPx + 4)
          tiText.text(formatTimeWithDecimal(time))
          tiText.visible(true)
        }

        // 更新轨道高亮
        if (withTrackHighlight) {
          const pointerY = e.clientY - rect.top
          const trackIndex = Math.floor((pointerY + visualScrollTopRef.current) / skillTrackHeight)
          const validTrack = trackIndex >= 0 && trackIndex < skillTracks.length
          hoverTrackIndexRef.current = validTrack ? trackIndex : null

          const highlight = trackHighlightRef.current
          if (highlight) {
            if (validTrack) {
              highlight.y(trackIndex * skillTrackHeight)
              highlight.visible(true)
            } else {
              highlight.visible(false)
            }
          }
        } else {
          hoverTrackIndexRef.current = null
        }

        // 批量重绘受影响的 Stage
        fixedStageRef.current?.batchDraw()
        stageRef.current?.batchDraw()
      },
    [
      zoomLevel,
      skillTracks.length,
      layoutData?.fixedAreaHeight,
      layoutData?.skillTracksHeight,
      hideCrosshair,
    ]
  )

  // 十字准线：鼠标离开事件
  const handleCrosshairLeave = useCallback(
    (e: MouseEvent) => {
      // 检查鼠标是否移到了另一个 Stage 容器，如果是则不清除
      const relatedTarget = e.relatedTarget as Element | null
      const fixedContainer = fixedStageRef.current?.container()
      const mainContainer = stageRef.current?.container()
      if (
        relatedTarget &&
        (fixedContainer?.contains(relatedTarget) || mainContainer?.contains(relatedTarget))
      ) {
        return
      }
      hoverTimeRef.current = null
      hoverTrackIndexRef.current = null
      hideCrosshair()
      // 立即清除本地光标（抑制节流，防止后续 stale mousemove 重发）
      lastCursorSendRef.current = Date.now()
      useTimelineStore.getState().setLocalCursor(null)
    },
    [hideCrosshair]
  )

  // window blur：清除本地光标（切换标签页 / 失焦时）
  useEffect(() => {
    const onBlur = () => {
      lastCursorSendRef.current = Date.now()
      useTimelineStore.getState().setLocalCursor(null)
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  // 绑定十字准线鼠标事件
  useEffect(() => {
    const mainStage = stageRef.current
    const fixedStage = fixedStageRef.current
    if (!mainStage || !fixedStage) return

    const mainContainer = mainStage.container()
    const fixedContainer = fixedStage.container()

    const handleMainMove = createCrosshairMoveHandler(stageRef, true, false)
    const handleFixedMove = createCrosshairMoveHandler(fixedStageRef, false, true)

    mainContainer.addEventListener('mousemove', handleMainMove)
    mainContainer.addEventListener('mouseleave', handleCrosshairLeave)
    fixedContainer.addEventListener('mousemove', handleFixedMove)
    fixedContainer.addEventListener('mouseleave', handleCrosshairLeave)

    return () => {
      mainContainer.removeEventListener('mousemove', handleMainMove)
      mainContainer.removeEventListener('mouseleave', handleCrosshairLeave)
      fixedContainer.removeEventListener('mousemove', handleFixedMove)
      fixedContainer.removeEventListener('mouseleave', handleCrosshairLeave)
    }
  }, [createCrosshairMoveHandler, handleCrosshairLeave])

  // 视口宽度（Stage 实际宽度，减去标签列和滚动条宽度）
  const viewportWidth = Math.max(width - labelColumnWidth - SCROLLBAR_WIDTH, 1)
  // 限制 scrollLeft 不超出范围
  const minScrollLeft = TIMELINE_START_TIME * zoomLevel
  const maxScrollLeft = layoutData
    ? Math.max(minScrollLeft, layoutData.timelineWidth + minScrollLeft - viewportWidth)
    : 0
  const clampedScrollLeft = Math.max(minScrollLeft, Math.min(scrollLeft, maxScrollLeft))
  const maxScrollTop = layoutData
    ? Math.max(
        0,
        layoutData.skillTracksHeight - (height - layoutData.fixedAreaHeight - minimapHeight)
      )
    : 0
  const clampedScrollTop = Math.min(scrollTop, maxScrollTop)

  // 当 zoomLevel 变化时，根据保存的时间位置还原滚动（以视口中央为锚点）
  useEffect(() => {
    if (pendingScrollProgress !== null && layoutData) {
      // pendingScrollProgress 存储的是视口中央的时间（秒）
      const newScrollLeft = pendingScrollProgress * zoomLevel - viewportWidth / 2

      queueMicrotask(() => {
        setScrollLeft(newScrollLeft)
        setPendingScrollProgress(null)
      })
    }
  }, [zoomLevel, layoutData, viewportWidth, pendingScrollProgress, setPendingScrollProgress])

  // 挂载时按共享滚动进度（由上次活动的视图写入）还原横向滚动位置
  const hasInitializedSyncRef = useRef(false)
  useEffect(() => {
    if (hasInitializedSyncRef.current || !layoutData || viewportWidth === 0) return
    hasInitializedSyncRef.current = true
    const progress = getSyncScrollProgress()
    const maxScroll = Math.max(0, layoutData.timelineWidth - viewportWidth)
    if (progress > 0 && maxScroll > 0) {
      setScrollLeft(progress * maxScroll)
    }
  }, [layoutData, viewportWidth])

  // 切换过滤器时把垂直滚动复位到最上：过滤后轨道顺序与高度可能变化，
  // 保持原 scrollTop 容易让用户落在不可解释的位置
  const activeFilterId = useFilterStore(s => s.activeFilterId)
  const initialFilterRef = useRef(true)
  useEffect(() => {
    if (initialFilterRef.current) {
      initialFilterRef.current = false
      return
    }
    visualScrollTopRef.current = 0
    clampedScrollRef.current.scrollTop = 0
    setScrollTop(0)
    handleDirectScroll(clampedScrollRef.current.scrollLeft, 0)
  }, [activeFilterId, handleDirectScroll])

  // 同步滚动状态到 store（用于工具栏缩放）
  useEffect(() => {
    if (layoutData) {
      updateScrollState(scrollLeft, layoutData.timelineWidth, viewportWidth)
      // 同步滚动进度（0-1），供视图切换时表格视图读取
      const maxScroll = Math.max(0, layoutData.timelineWidth - viewportWidth)
      const progress = maxScroll > 0 ? Math.min(1, Math.max(0, scrollLeft / maxScroll)) : 0
      setSyncScrollProgress(progress)
    }
    // updateScrollState 来自 Zustand store，引用稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollLeft, layoutData?.timelineWidth, viewportWidth])

  // 同步 ref（用于事件处理器闭包）
  useEffect(() => {
    maxScrollLeftRef.current = maxScrollLeft
    minScrollLeftRef.current = minScrollLeft
    maxScrollTopRef.current = maxScrollTop
    // 只同步 scrollLeft；scrollTop 由 direct scroll 路径管理（drag/wheel），
    // 避免拖动期间用 stale 的 React state 覆盖正确的 ref 值
    clampedScrollRef.current.scrollLeft = clampedScrollLeft
    scrollLeftRef.current = scrollLeft
    scrollTopRef.current = scrollTop
  }, [
    maxScrollLeft,
    minScrollLeft,
    maxScrollTop,
    clampedScrollLeft,
    clampedScrollTop,
    scrollLeft,
    scrollTop,
  ])

  // 标签列 wheel 事件：注册为 non-passive 以支持 preventDefault
  useEffect(() => {
    const el = labelColumnRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      // 用 visualScrollTopRef 作为累加基准（不会被 sync effect 覆盖）
      const newScrollTop = Math.max(
        0,
        Math.min(visualScrollTopRef.current + e.deltaY, maxScrollTopRef.current)
      )
      visualScrollTopRef.current = newScrollTop
      clampedScrollRef.current = {
        scrollLeft: clampedScrollRef.current.scrollLeft,
        scrollTop: newScrollTop,
      }
      handleDirectScroll(clampedScrollRef.current.scrollLeft, newScrollTop)
      setScrollTop(newScrollTop)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [handleDirectScroll])

  // 同步左侧标签列的垂直滚动（用 clampedScrollTop，在渲染阶段计算后通过 ref 同步）

  // 初始化缩放级别
  useEffect(() => {
    if (width > 0 && !hasInitializedZoom.current && zoomLevel === 50) {
      const defaultZoomLevel = width / 60
      setZoomLevel(defaultZoomLevel)
      hasInitializedZoom.current = true
    }
  }, [width, zoomLevel, setZoomLevel])

  // 批量复制选中对象到系统剪贴板（自定义 web MIME，外部应用不可见）
  const copySelection = useCallback(async () => {
    const s = useTimelineStore.getState()
    if (!s.timeline) return
    const total =
      s.selectedEventIds.length + s.selectedCastEventIds.length + s.selectedAnnotationIds.length
    if (total === 0) return
    const payload = buildClipboardPayload(
      s.timeline,
      {
        eventIds: s.selectedEventIds,
        castEventIds: s.selectedCastEventIds,
        annotationIds: s.selectedAnnotationIds,
      },
      // 全选类操作产生的选择：粘贴时用绝对时间
      s.selectionFromSelectAll
    )
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: CLIPBOARD_MIME })
      await navigator.clipboard.write([new ClipboardItem({ [CLIPBOARD_MIME]: blob })])
      toast.success(`已复制 ${total} 个对象`)
    } catch {
      toast.error('复制失败：当前浏览器不支持写入剪贴板')
    }
  }, [])

  // 从系统剪贴板粘贴时间轴对象，锚定到目标时间
  // 把 remap 结果写入时间轴并选中
  const commitPaste = useCallback((result: PasteResult) => {
    useTimelineStore.getState().pasteObjects({
      damageEvents: result.damageEvents,
      castEvents: result.castEvents,
      annotations: result.annotations,
    })
    if (result.skipped > 0) toast.warning(`已粘贴，跳过 ${result.skipped} 个无法落位的对象`)
    else toast.success('已粘贴')
  }, [])

  const pasteAtTime = useCallback(
    async (targetTime: number) => {
      let text: string | null = null
      try {
        const items = await navigator.clipboard.read()
        const item = items.find(it => it.types.includes(CLIPBOARD_MIME))
        if (item) text = await (await item.getType(CLIPBOARD_MIME)).text()
      } catch {
        // 读取剪贴板失败（不支持 / 无权限）：静默不粘贴
      }
      const payload = text ? parseClipboardPayload(text) : null
      if (!payload) return
      const tl = useTimelineStore.getState().timeline
      if (!tl) return
      const validActionIds = new Set(useMitigationStore.getState().actions.map(a => a.id))
      const result = remapClipboardForPaste(payload, {
        currentComposition: tl.composition,
        targetTime,
        validActionIds,
      })
      const kept = result.damageEvents.length + result.castEvents.length + result.annotations.length
      // 有对象无法映射：全被跳过则直接报错；否则弹确认框让用户决定是否粘贴其余
      if (result.skipped > 0) {
        if (kept === 0) {
          toast.error(`无法粘贴：${result.skipped} 个对象都无法映射到当前时间轴轨道`)
          return
        }
        setPendingPaste(result)
        return
      }
      commitPaste(result)
    },
    [commitPaste]
  )

  // 探测系统剪贴板是否含有时间轴数据（用于右键空白菜单显示粘贴项）
  const probePaste = useCallback(async () => {
    setPasteAvailable('checking')
    try {
      const items = await navigator.clipboard.read()
      setPasteAvailable(items.some(it => it.types.includes(CLIPBOARD_MIME)))
    } catch {
      setPasteAvailable(false)
    }
  }, [])

  // 撤销 / 重做
  const runUndoRedo = (op: 'undo' | 'redo') => {
    if (op === 'undo') undo()
    else redo()
    selectEvent(null)
    selectCastEvent(null)
  }
  useHotkeys('mod+z', () => runUndoRedo('undo'), {
    enabled: !isReadOnly,
    preventDefault: true,
  })
  useHotkeys('mod+shift+z', () => runUndoRedo('redo'), {
    enabled: !isReadOnly,
    preventDefault: true,
  })

  // 全选：选中时间轴所有伤害事件 / 技能 cast / 注释（mod+a 快捷键与空白处右键菜单共用）
  const selectAll = useCallback(() => {
    const s = useTimelineStore.getState()
    const tl = s.timeline
    if (!tl) return
    s.setSelection(
      {
        eventIds: tl.damageEvents.map(e => e.id),
        castEventIds: tl.castEvents.map(c => c.id),
        annotationIds: (tl.annotations ?? []).map(a => a.id),
      },
      { fromSelectAll: true }
    )
  }, [])
  // 全选只读取选择状态，只读/回放模式也允许
  useHotkeys('mod+a', selectAll, { enabled: true, preventDefault: true }, [selectAll])

  // 全选伤害事件 / 技能：仅选中当前过滤器下可见（未被过滤）的对象（区域右键菜单项，无快捷键）
  const selectAllDamageEvents = useCallback(() => {
    useTimelineStore
      .getState()
      .setSelection({ eventIds: filteredDamageEvents.map(e => e.id) }, { fromSelectAll: true })
  }, [filteredDamageEvents])
  const selectAllCasts = useCallback(() => {
    useTimelineStore
      .getState()
      .setSelection({ castEventIds: filteredCastEvents.map(c => c.id) }, { fromSelectAll: true })
  }, [filteredCastEvents])

  // 删除：多选时批量删除，否则删单个选中项或固定注释
  useHotkeys(
    'delete, backspace',
    () => {
      const s = useTimelineStore.getState()
      const total =
        s.selectedEventIds.length + s.selectedCastEventIds.length + s.selectedAnnotationIds.length
      if (total > 0) {
        s.bulkDeleteSelection()
        return
      }
      if (pinnedAnnotationId) {
        removeAnnotation(pinnedAnnotationId)
        setPinnedAnnotationId(null)
      }
    },
    { enabled: !isReadOnly },
    [pinnedAnnotationId]
  )

  // 复制选中对象到系统剪贴板（只读/回放模式也允许：复制不改时间轴）
  useHotkeys(
    'mod+c',
    () => {
      void copySelection()
    },
    { enabled: true },
    [copySelection]
  )

  // 粘贴（在鼠标悬浮位置，若无则在视口中央）
  useHotkeys(
    'mod+v',
    () => {
      const t =
        hoverTimeRef.current ??
        (clampedScrollRef.current.scrollLeft + viewportWidth / 2) / zoomLevel
      void pasteAtTime(Math.round(t * 10) / 10)
    },
    { enabled: !isReadOnly, preventDefault: true },
    [pasteAtTime, viewportWidth, zoomLevel]
  )

  // 计算技能图标的 tooltip 锚点矩形
  const getActionAnchorRect = (e: KonvaEventObject<MouseEvent | TouchEvent>): DOMRect | null => {
    const stage = e.target.getStage()
    if (!stage) return null
    const stageBounds = stage.container().getBoundingClientRect()
    let node: Konva.Node = e.target
    while (node.getClassName() !== 'Group' && node.getParent()) {
      node = node.getParent()!
    }
    const absPos = node.getAbsolutePosition()
    return new DOMRect(stageBounds.left + absPos.x, stageBounds.top + absPos.y - 15, 30, 30)
  }

  const handleHoverAction = (action: MitigationAction, e: KonvaEventObject<MouseEvent>) => {
    if (isDraggingRef.current) return
    const rect = getActionAnchorRect(e)
    if (rect) showTooltip(action, rect, ['b', 't', 'l', 'r'])
  }

  const handleClickAction = (
    action: MitigationAction,
    e: KonvaEventObject<MouseEvent | TouchEvent>
  ) => {
    const rect = getActionAnchorRect(e)
    if (rect) toggleTooltip(action, rect, ['b', 't', 'l', 'r'])
  }

  const handleHoverActionFromDom = (action: MitigationAction, anchorRect: DOMRect) => {
    if (isDraggingRef.current) return
    showTooltip(action, anchorRect)
  }

  const handleClickActionFromDom = (action: MitigationAction, anchorRect: DOMRect) => {
    toggleTooltip(action, anchorRect)
  }

  // 向指定轨道添加技能（含变体选择、重叠检查、失败提示）。
  // `actionId` 传入 track 的主成员 id；同轨道若声明了 trackGroup + placement，engine
  // 会在 t 时刻选出唯一合法成员（如 buff 期内 37013 自动变 37016）。未接入 engine /
  // 单成员组时退化为直接用传入的 actionId。
  const addCastAt = (actionId: number, playerId: number, time: number) => {
    if (!timeline) return

    const parent = actionMap.get(actionId)
    const groupId = parent ? (parent.trackGroup ?? parent.id) : actionId
    if (engine && parent) {
      // 仅做「该时刻是否存在合法变体」的存在性校验；具体变体交给 simulate 运行时推导。
      const member = engine.pickUniqueMember(groupId, playerId, time)
      if (!member) {
        const unmetMsg = engine.getResourceUnmetMessageAt(parent, playerId, time)
        toast.error('无法添加技能', { description: unmetMsg ?? '此时刻不满足发动条件' })
        return
      }
    }

    // CD 冲突 / 资源耗尽 已由 pickUniqueMember 内部 canPlaceCastEvent 闭环过滤
    // （legal = placement ∩ resourceLegalIntervals）；此处不再重复 overlap 窗口检查——
    // 旧 checkOverlap 按 action.cooldown 硬窗口互斥，与多充能（慰藉/献奉）语义冲突。
    // 写入父 id（groupId），变体不持久化。

    addCastEvent({
      id: generateObjectId(),
      actionId: groupId,
      timestamp: time,
      playerId,
    })
  }

  // 处理双击轨道添加技能
  const handleDoubleClickTrack = (track: SkillTrack, time: number) => {
    if (isReadOnly) return
    // 如果刚刚完成了平移操作，阻止误触发
    if (panJustEndedRef.current || Date.now() - lastPanEndTimeRef.current < 300) return
    addCastAt(track.actionId, track.playerId, time)
  }

  // 群组拖动：若被拖动对象（damage/cast 抓手）属于一个总数 >1 的多选，则记录抓手起点
  // 并进入群组拖动态。total 计入 annotation —— 注释只能作为随动对象，不能作抓手。
  // 返回是否进入群组拖动（供调用方决定是否走单体逻辑）。
  const tryBeginGroupDrag = useCallback(
    (kind: 'damage' | 'cast', id: string, anchorX: number): boolean => {
      const s = useTimelineStore.getState()
      const total =
        s.selectedEventIds.length + s.selectedCastEventIds.length + s.selectedAnnotationIds.length
      const inSel =
        kind === 'damage' ? s.selectedEventIds.includes(id) : s.selectedCastEventIds.includes(id)
      if (total <= 1 || !inSel) {
        groupDragAnchorRef.current = null
        return false
      }
      const draggedDamageId = kind === 'damage' ? id : null
      const draggedCastId = kind === 'cast' ? id : null
      groupDragAnchorRef.current = { anchorX, draggedDamageId, draggedCastId }
      setGroupDrag({ delta: 0, draggedDamageId, draggedCastId })
      // 广播随动对象 id（排除被抓住的那个，仅从其同类数组剔除）供协作者画 ghost。
      // 成员在整段拖动内固定，begin 时设一次即可；逐帧的 dragging 已携带抓手 ghost，
      // peer 据此派生 delta 套用到各随动对象的原始时间。
      s.setLocalDragGroup({
        eventIds: kind === 'damage' ? s.selectedEventIds.filter(x => x !== id) : s.selectedEventIds,
        castEventIds:
          kind === 'cast' ? s.selectedCastEventIds.filter(x => x !== id) : s.selectedCastEventIds,
        annotationIds: s.selectedAnnotationIds,
      })
      return true
    },
    []
  )

  // 群组拖动中：用抓手当前 x 与起点的差驱动其余选中对象的实时偏移。
  const updateGroupDrag = useCallback((currentX: number) => {
    const anchor = groupDragAnchorRef.current
    if (!anchor) return
    setGroupDrag({
      delta: currentX - anchor.anchorX,
      draggedDamageId: anchor.draggedDamageId,
      draggedCastId: anchor.draggedCastId,
    })
  }, [])

  const endGroupDrag = useCallback(() => {
    groupDragAnchorRef.current = null
    setGroupDrag(null)
    // 清除广播的群组随动 id（每条 drag-end 路径都会调用本函数兜底）
    useTimelineStore.getState().setLocalDragGroup({
      eventIds: [],
      castEventIds: [],
      annotationIds: [],
    })
  }, [])

  // 处理伤害事件拖动
  const handleEventDragEnd = (eventId: string, x: number) => {
    if (isReadOnly) return
    const newTime = Math.max(TIMELINE_START_TIME, Math.round((x / zoomLevel) * 10) / 10)
    const s = useTimelineStore.getState()
    const totalSelected =
      s.selectedEventIds.length + s.selectedCastEventIds.length + s.selectedAnnotationIds.length
    if (totalSelected > 1 && s.selectedEventIds.includes(eventId)) {
      // 多选：整体等距平移，以被拖动事件的原始时间为基准
      const orig = timeline?.damageEvents.find(e => e.id === eventId)?.time ?? newTime
      s.bulkMoveSelection(newTime - orig)
    } else {
      s.updateDamageEvent(eventId, { time: newTime })
    }
    s.setLocalDragging(null)
    setDraggingEventPosition(null)
    endGroupDrag()
  }

  // 上报伤害事件拖动 ghost（start 立即, move 节流 ~50ms）
  const reportDamageDrag = useCallback(
    (eventId: string, x: number, immediate = false) => {
      const now = Date.now()
      if (!immediate && now - lastDragSendRef.current < 50) return
      lastDragSendRef.current = now
      useTimelineStore.getState().setLocalDragging({
        id: eventId,
        kind: 'damage',
        time: x / zoomLevel,
        playerId: null,
      })
    },
    [zoomLevel]
  )

  // 立即上报 cast 拖动开始（不节流）
  const reportCastDragStart = useCallback(
    (castEventId: string) => {
      const ce = timeline?.castEvents.find(c => c.id === castEventId)
      lastDragSendRef.current = Date.now()
      useTimelineStore.getState().setLocalDragging({
        id: castEventId,
        kind: 'cast',
        time: ce?.timestamp ?? 0,
        playerId: ce?.playerId ?? null,
      })
    },
    [timeline?.castEvents]
  )

  // 节流上报 cast 拖动 ghost（供协作者感知）
  const reportCastDrag = useCallback(
    (castEventId: string, x: number) => {
      const now = Date.now()
      if (now - lastDragSendRef.current < 50) return
      lastDragSendRef.current = now
      const ce = timeline?.castEvents.find(c => c.id === castEventId)
      useTimelineStore.getState().setLocalDragging({
        id: castEventId,
        kind: 'cast',
        time: x / zoomLevel,
        playerId: ce?.playerId ?? null,
      })
    },
    [zoomLevel, timeline?.castEvents]
  )

  // 节流上报 annotation 拖动 ghost（供协作者感知）
  const reportAnnotationDrag = useCallback(
    (annotationId: string, newX: number) => {
      const now = Date.now()
      if (now - lastDragSendRef.current < 50) return
      lastDragSendRef.current = now
      useTimelineStore.getState().setLocalDragging({
        id: annotationId,
        kind: 'annotation',
        time: newX / zoomLevel,
        playerId: null,
      })
    },
    [zoomLevel]
  )

  // 处理技能使用事件拖动
  const handleCastEventDragEnd = (castEventId: string, x: number) => {
    if (isReadOnly) return
    // 不 snap：dragBoundFunc 已把 x 钳到合法区边界（精确到像素），保留连续值避免
    // round 越界。合法区右边界经常不在 0.1 秒网格上（如 629.58），0.1 snap 会把
    // 合法 629.58 吸成非法 629.6，导致 cast 落入 shadow → 红框 + 下次 dragBounds
    // 放开可自由拖动。精度损失（px 级 ~0.033s）相较越界（0.02~0.05s）可接受。
    const newTime = Math.max(TIMELINE_START_TIME, x / zoomLevel)
    const { updateCastEvent } = useTimelineStore.getState()
    const existing = timeline?.castEvents.find(ce => ce.id === castEventId)
    if (!existing) return
    // 变体由 simulate 运行时推导，拖拽只改时间、不重写 actionId；
    // 新位置若无合法变体由红框提示。
    const s = useTimelineStore.getState()
    const totalSelected =
      s.selectedEventIds.length + s.selectedCastEventIds.length + s.selectedAnnotationIds.length
    if (totalSelected > 1 && s.selectedCastEventIds.includes(castEventId)) {
      // 多选：整体等距平移，以被拖动 cast 的原始时间戳为基准
      const orig = timeline?.castEvents.find(c => c.id === castEventId)?.timestamp ?? newTime
      s.bulkMoveSelection(newTime - orig)
    } else {
      updateCastEvent(castEventId, { timestamp: newTime })
    }
    useTimelineStore.getState().setLocalDragging(null)
    endGroupDrag()
  }

  // 平移刚结束的同帧内阻止意外选中（panJustEndedRef 由 rAF 自动清除）
  const handleSelectEvent = (id: string) => {
    if (panJustEndedRef.current) return
    selectEvent(id)
  }

  // 平移刚结束的同帧内阻止意外选中
  const handleSelectCastEvent = (id: string) => {
    if (panJustEndedRef.current) return
    selectCastEvent(id)
  }

  const handleContextMenu = useCallback(
    (
      payload:
        | { type: 'castEvent'; castEventId: string; actionId: number }
        | { type: 'skillTrackEmpty'; actionId: number; playerId: number }
        | { type: 'damageEvent'; eventId: string }
        | { type: 'damageTrackEmpty' }
        | { type: 'annotation'; annotationId: string },
      clientX: number,
      clientY: number,
      time: number
    ) => {
      // 右键命中多选集合内对象时：显示批量菜单，不把多选塌缩为单选
      const sel = useTimelineStore.getState()
      const total =
        sel.selectedEventIds.length +
        sel.selectedCastEventIds.length +
        sel.selectedAnnotationIds.length
      const inMulti =
        (payload.type === 'damageEvent' && sel.selectedEventIds.includes(payload.eventId)) ||
        (payload.type === 'castEvent' && sel.selectedCastEventIds.includes(payload.castEventId)) ||
        (payload.type === 'annotation' && sel.selectedAnnotationIds.includes(payload.annotationId))
      if (total > 1 && inMulti) {
        // 批量菜单：只读/回放模式只显示「复制」（删除在菜单内按只读隐藏），仍 return 避免塌缩多选
        setContextMenu({ type: 'multiSelection', count: total, x: clientX, y: clientY, time })
        return
      }

      // 右键空白轨道时探测系统剪贴板，为粘贴项提供可用性状态
      if (payload.type === 'damageTrackEmpty' || payload.type === 'skillTrackEmpty') {
        void probePaste()
      }

      if (payload.type === 'castEvent') {
        selectCastEvent(payload.castEventId)
      } else if (payload.type === 'damageEvent') {
        selectEvent(payload.eventId)
      }

      setContextMenu({ ...payload, x: clientX, y: clientY, time })
    },
    [selectCastEvent, selectEvent, probePaste]
  )

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null)
    setPasteAvailable(false)
  }, [])

  const handleContextMenuAddCast = (actionId: number, playerId: number, time: number) => {
    addCastAt(actionId, playerId, time)
  }

  const handleCopyDamageEventText = useCallback(
    (eventId: string) => {
      if (!timeline) return
      const event = timeline.damageEvents.find(e => e.id === eventId)
      if (!event) return
      const calc = calculationResults.get(eventId)

      const lines: string[] = []
      const header = `${event.name} (${event.time.toFixed(1)}s)`

      if (timeline.isReplayMode && event.playerDamageDetails?.length) {
        // 回放模式：每个玩家的实际伤害
        lines.push(header)
        const sorted = sortJobsByOrder(event.playerDamageDetails, d => d.job)
        for (const detail of sorted) {
          if (detail.unmitigatedDamage === 0) continue
          const dead = (detail.overkill ?? 0) > 0 && !detail.statuses.some(s => s.statusId === 810)
          const hpText =
            detail.maxHitPoints != null
              ? `HP: ${detail.maxHitPoints.toLocaleString()} → ${dead ? `${(detail.hitPoints ?? 0).toLocaleString()} (死亡)` : (detail.hitPoints ?? 0).toLocaleString()}`
              : ''
          lines.push(
            `  ${getJobName(detail.job)}: ${detail.unmitigatedDamage.toLocaleString()} → ${detail.finalDamage.toLocaleString()}${hpText ? `  ${hpText}` : ''}`
          )

          // 减伤状态
          const statuses = detail.statuses || []
          const multipliers = statuses.filter(s => getStatusById(s.statusId)?.type === 'multiplier')
          const shields = statuses.filter(
            s => getStatusById(s.statusId)?.type === 'absorbed' && (s.absorb || 0) > 0
          )

          if (multipliers.length > 0) {
            const damageType = event.damageType || 'physical'
            const parts = multipliers.map(s => {
              const meta = getStatusById(s.statusId)!
              const perf =
                damageType === 'physical'
                  ? meta.performance.physics
                  : damageType === 'magical'
                    ? meta.performance.magic
                    : meta.performance.darkness
              return `${getStatusName(s.statusId) || meta.name}(${((1 - perf) * 100).toFixed(0)}%)`
            })
            const totalMult = multipliers.reduce((acc, s) => {
              const meta = getStatusById(s.statusId)!
              const perf =
                damageType === 'physical'
                  ? meta.performance.physics
                  : damageType === 'magical'
                    ? meta.performance.magic
                    : meta.performance.darkness
              return acc * perf
            }, 1)
            lines.push(`    减伤: ${parts.join(' + ')} = ${((1 - totalMult) * 100).toFixed(1)}%`)
          }
          if (shields.length > 0) {
            const shieldParts = shields.map(
              s =>
                `${getStatusName(s.statusId) || getStatusById(s.statusId)?.name || ''}(${(s.absorb || 0).toLocaleString()})`
            )
            lines.push(`    盾值: ${shieldParts.join(' + ')}`)
          }
        }
      } else if (calc) {
        // 编辑模式
        lines.push(
          `${header} 原始伤害: ${calc.originalDamage.toLocaleString()} → 最终伤害: ${calc.finalDamage.toLocaleString()}`
        )

        const damageType = event.damageType || 'physical'
        const multipliers = calc.appliedStatuses.filter(
          s => getStatusById(s.statusId)?.type === 'multiplier'
        )
        if (multipliers.length > 0) {
          const parts = multipliers.map(s => {
            const meta = getStatusById(s.statusId)!
            const perf =
              damageType === 'physical'
                ? meta.performance.physics
                : damageType === 'magical'
                  ? meta.performance.magic
                  : meta.performance.darkness
            return `${getStatusName(s.statusId) || meta.name}(${((1 - perf) * 100).toFixed(0)}%)`
          })
          lines.push(`  减伤: ${parts.join(' + ')} = ${calc.mitigationPercentage.toFixed(1)}%`)
        }

        // 盾值：从 appliedStatuses 中找 absorbed 类型
        const shieldStatuses = calc.appliedStatuses.filter(
          s => getStatusById(s.statusId)?.type === 'absorbed'
        )
        if (shieldStatuses.length > 0) {
          const shieldParts = shieldStatuses.map(s => {
            const name = getStatusName(s.statusId) || getStatusById(s.statusId)?.name || ''
            return `${name}(${(s.initialBarrier ?? 0).toLocaleString()})`
          })
          lines.push(`  盾值: ${shieldParts.join(' + ')}`)
        }

        if (calc.referenceMaxHP != null) {
          const afterHP = calc.referenceMaxHP - calc.finalDamage
          const dead = afterHP <= 0
          lines.push(
            `  HP: ${calc.referenceMaxHP.toLocaleString()} → ${dead ? `${afterHP.toLocaleString()} (会死)` : afterHP.toLocaleString()}`
          )
        }
      } else {
        lines.push(`${header} 伤害: ${event.damage.toLocaleString()}`)
      }

      const text = lines.join('\n')
      navigator.clipboard.writeText(text)
      toast.success('已复制伤害事件文本')
    },
    [timeline, calculationResults]
  )

  const handleContextMenuAddDamageEvent = useCallback((time: number) => {
    setAddEventAt(time)
  }, [])

  const handleAddAnnotation = useCallback(
    (time: number, anchor: AnnotationAnchor) => {
      const menuX = contextMenu?.x ?? 0
      const menuY = contextMenu?.y ?? 0
      setEditingAnnotation({
        annotation: null,
        time,
        anchor,
        screenX: menuX,
        screenY: menuY,
      })
    },
    [contextMenu, setEditingAnnotation]
  )

  const handleDeleteAnnotation = useCallback(
    (annotationId: string) => {
      removeAnnotation(annotationId)
    },
    [removeAnnotation]
  )

  const handleAnnotationHover = useCallback(
    (annotation: { id: string }) => {
      if (editingAnnotation) return
      if (pinnedAnnotationId === annotation.id) return
      setHoverAnnotationId(annotation.id)
    },
    [editingAnnotation, pinnedAnnotationId]
  )

  const handleAnnotationHoverEnd = useCallback(() => {
    setHoverAnnotationId(null)
  }, [])

  const handleAnnotationClick = useCallback((annotation: { id: string }) => {
    if (panJustEndedRef.current) return
    annotationClickedRef.current = true
    setHoverAnnotationId(null)
    setPinnedAnnotationId(prev => (prev === annotation.id ? null : annotation.id))
  }, [])

  const handleAnnotationContextMenu = useCallback(
    (annotationId: string, clientX: number, clientY: number, time: number) => {
      const sel = useTimelineStore.getState()
      const total =
        sel.selectedEventIds.length +
        sel.selectedCastEventIds.length +
        sel.selectedAnnotationIds.length
      if (total > 1 && sel.selectedAnnotationIds.includes(annotationId)) {
        // 右键命中多选集合内注释：弹批量菜单（只读也弹，仅显示复制），return 避免塌缩多选
        setContextMenu({ type: 'multiSelection', count: total, x: clientX, y: clientY, time })
        return
      }
      setPinnedAnnotationId(null)
      setContextMenu({ type: 'annotation', annotationId, x: clientX, y: clientY, time })
    },
    []
  )

  const handleEditAnnotation = useCallback(
    (annotationId: string) => {
      if (!timeline) return
      const annotation = timeline.annotations?.find(a => a.id === annotationId)
      if (!annotation) return
      const menuX = contextMenu?.x ?? 0
      const menuY = contextMenu?.y ?? 0
      setPinnedAnnotationId(null)
      setEditingAnnotation({
        annotation,
        time: annotation.time,
        anchor: annotation.anchor,
        screenX: menuX,
        screenY: menuY,
      })
    },
    [timeline, contextMenu]
  )

  const handleAnnotationDragStart = useCallback(
    (annotationId: string) => {
      setIsDraggingAnnotation(true)
      const annotation = timeline?.annotations?.find(a => a.id === annotationId)
      lastDragSendRef.current = Date.now()
      useTimelineStore.getState().setLocalDragging({
        id: annotationId,
        kind: 'annotation',
        time: annotation?.time ?? 0,
        playerId: null,
      })
    },
    [timeline?.annotations]
  )

  const handleAnnotationDragEnd = useCallback(
    (annotationId: string, newX: number) => {
      setIsDraggingAnnotation(false)
      annotationClickedRef.current = true
      const newTime = Math.max(TIMELINE_START_TIME, Math.round((newX / zoomLevel) * 10) / 10)
      updateAnnotation(annotationId, { time: newTime })
      useTimelineStore.getState().setLocalDragging(null)
      // 与 handleEventDragEnd / handleCastEventDragEnd 一致地兜底清除群组拖动态
      endGroupDrag()
    },
    [zoomLevel, updateAnnotation, endGroupDrag]
  )

  const handleAnnotationConfirm = useCallback(
    (text: string) => {
      if (!editingAnnotation) return
      if (editingAnnotation.annotation) {
        updateAnnotation(editingAnnotation.annotation.id, { text })
      } else {
        addAnnotation({
          id: generateObjectId(),
          text,
          time: editingAnnotation.time,
          anchor: editingAnnotation.anchor,
        })
      }
      setEditingAnnotation(null)
    },
    [editingAnnotation, addAnnotation, updateAnnotation]
  )

  if (!timeline || !layoutData) {
    return (
      <div className="flex items-center justify-center bg-muted/20" style={{ width, height }}>
        <p className="text-muted-foreground">未加载时间轴</p>
      </div>
    )
  }

  const {
    damageEventRowMap,
    eventTrackHeight,
    timelineWidth,
    fixedAreaHeight,
    skillTracksHeight,
    LANE_ROW_HEIGHT,
    hpTrackHeight,
    displayActionOverrides,
    maxTime,
  } = layoutData

  const damageTrackAnnotations = (timeline.annotations ?? []).filter(
    a => a.anchor.type === 'damageTrack'
  )
  const skillTrackAnnotations = (timeline.annotations ?? []).filter(
    a => a.anchor.type === 'skillTrack'
  )

  // 计算注释 popover 的基准位置（不含滚动偏移，供 CSS calc() 使用）
  const getAnnotationBasePos = (annotation: { time: number; anchor: AnnotationAnchor }) => {
    const timePixels = annotation.time * zoomLevel
    if (annotation.anchor.type === 'damageTrack') {
      const container = fixedStageRef.current?.container()
      if (!container) return null
      const rect = container.getBoundingClientRect()
      return {
        x: rect.left + timePixels,
        y: rect.top + timeRulerHeight + eventTrackHeight - 20,
        scrollY: false, // 伤害轨道不随垂直滚动
      }
    } else {
      const anchor = annotation.anchor as { type: 'skillTrack'; playerId: number; actionId: number }
      const trackIndex = skillTracks.findIndex(
        t => t.playerId === anchor.playerId && t.actionId === anchor.actionId
      )
      if (trackIndex === -1) return null
      const container = stageRef.current?.container()
      if (!container) return null
      const rect = container.getBoundingClientRect()
      return {
        x: rect.left + timePixels,
        y: rect.top + trackIndex * skillTrackHeight + skillTrackHeight / 2,
        scrollY: true, // 技能轨道随垂直滚动
      }
    }
  }

  const allAnnotations = timeline.annotations ?? []
  const hoverAnnotation = hoverAnnotationId
    ? allAnnotations.find(a => a.id === hoverAnnotationId)
    : null
  const pinnedAnnotation = pinnedAnnotationId
    ? allAnnotations.find(a => a.id === pinnedAnnotationId)
    : null
  const hoverBasePos = hoverAnnotation ? getAnnotationBasePos(hoverAnnotation) : null
  const pinnedBasePos = pinnedAnnotation ? getAnnotationBasePos(pinnedAnnotation) : null

  // 框选对象 box 构建（容器屏幕坐标系，origin = timelineContainerRef 左上角）。
  // 坐标公式与渲染层一致：
  //   canvasLeft = labelColumnWidth + SCROLLBAR_WIDTH（标签列宽，画布内容从此处开始）
  //   x = canvasLeft + time*zoomLevel - scrollLeft
  //   伤害轨/伤害注释 y：固定区，不随垂直滚动（timeRulerHeight 起）
  //   技能轨/技能注释 y：fixedAreaHeight + trackIndex*skillTrackHeight + ... - scrollTop
  const canvasLeft = labelColumnWidth + SCROLLBAR_WIDTH
  const DAMAGE_CARD_WIDTH = 150
  // DamageEventCard: Group y = yOffset + row*LANE_ROW_HEIGHT + LANE_ROW_HEIGHT/2 (=18)
  // Rect local y=-15, height=30 → real span [base+3, base+33] where base = timeRulerHeight + row*LANE_ROW_HEIGHT
  const DAMAGE_CARD_RECT_HEIGHT = 30
  const DAMAGE_CARD_Y_OFFSET = 3 // LANE_ROW_HEIGHT/2 - 15 = 18 - 15 = 3
  const CAST_ICON_SIZE = 30
  // AnnotationIcon: ICON_SIZE=22, Group placed at x-ICON_SIZE/2, y-ICON_SIZE/2 → center-anchored
  const ANNOTATION_ICON_SIZE = 22
  const ANNOTATION_ICON_HALF = ANNOTATION_ICON_SIZE / 2
  buildMarqueeObjectsRef.current = () => {
    const objs: MarqueeObject[] = []
    // 伤害事件（固定区，y 不随垂直滚动）；只框选过滤后可见的事件，与渲染一致
    for (const event of filteredDamageEvents) {
      const x0 = canvasLeft + event.time * zoomLevel - clampedScrollLeft
      const row = damageEventRowMap.get(event.id) ?? 0
      const y0 = timeRulerHeight + row * LANE_ROW_HEIGHT + DAMAGE_CARD_Y_OFFSET
      objs.push({
        id: event.id,
        kind: 'damage',
        x0,
        x1: x0 + DAMAGE_CARD_WIDTH,
        y0,
        y1: y0 + DAMAGE_CARD_RECT_HEIGHT,
      })
    }
    // cast 事件（技能区，y 随垂直滚动；trackIndex 按 trackGroup 归到父轨道）
    for (const ce of timeline.castEvents) {
      const castAction = actionMap.get(ce.actionId)
      const castGroupId = castAction?.trackGroup ?? ce.actionId
      const trackIndex = skillTracks.findIndex(
        t => t.playerId === ce.playerId && t.actionId === castGroupId
      )
      if (trackIndex === -1) continue
      const x0 = canvasLeft + ce.timestamp * zoomLevel - clampedScrollLeft
      const trackY = trackIndex * skillTrackHeight + skillTrackHeight / 2
      const y0 = fixedAreaHeight + trackY - CAST_ICON_SIZE / 2 - clampedScrollTop
      objs.push({
        id: ce.id,
        kind: 'cast',
        x0,
        x1: x0 + CAST_ICON_SIZE,
        y0,
        y1: y0 + CAST_ICON_SIZE,
      })
    }
    // 注释（按 anchor 区分固定区 / 技能区）
    // AnnotationIcon 是 center-anchored：Group 放在 (x - ICON_SIZE/2, y - ICON_SIZE/2)，
    // 因此传入的 (x, y) 即图标中心，hit-box 对称展开 ±ANNOTATION_ICON_HALF。
    for (const annotation of timeline.annotations ?? []) {
      const center = canvasLeft + annotation.time * zoomLevel - clampedScrollLeft
      if (annotation.anchor.type === 'damageTrack') {
        const cy = timeRulerHeight + eventTrackHeight - 20
        objs.push({
          id: annotation.id,
          kind: 'annotation',
          x0: center - ANNOTATION_ICON_HALF,
          x1: center + ANNOTATION_ICON_HALF,
          y0: cy - ANNOTATION_ICON_HALF,
          y1: cy + ANNOTATION_ICON_HALF,
        })
      } else {
        const anchor = annotation.anchor
        const trackIndex = skillTracks.findIndex(
          t => t.playerId === anchor.playerId && t.actionId === anchor.actionId
        )
        if (trackIndex === -1) continue
        const cy =
          fixedAreaHeight + trackIndex * skillTrackHeight + skillTrackHeight / 2 - clampedScrollTop
        objs.push({
          id: annotation.id,
          kind: 'annotation',
          x0: center - ANNOTATION_ICON_HALF,
          x1: center + ANNOTATION_ICON_HALF,
          y0: cy - ANNOTATION_ICON_HALF,
          y1: cy + ANNOTATION_ICON_HALF,
        })
      }
    }
    return objs
  }

  // 框选指针处理：在 select 模式或落在标尺带内时接管拖动，注册 window move/up。
  // 坐标换算到容器局部坐标（与 buildObjects / overlay 同一 origin）。
  const handleMarqueePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const container = timelineContainerRef.current
    if (!container) return
    // 右键菜单等被 portal 到 body 的浮层，其指针事件仍会经 React 树冒泡到这里，
    // 但真实 DOM target 不在时间轴容器内。若不拦截，点击「删除全部」会先触发一个
    // 零尺寸框选，pointerup 提交空选区清掉多选，导致菜单项 onClick 读到空选区而无反应。
    if (e.target instanceof Node && !container.contains(e.target)) return
    const rect = container.getBoundingClientRect()
    const localY = e.clientY - rect.top
    // 落在底部 minimap 区：交给 minimap 自身交互，不启动框选
    if (localY >= height - minimapHeight) return
    const inRuler = localY <= timeRulerHeight
    if (canvasTool !== 'select' && !inRuler) return
    const localX = e.clientX - rect.left
    // 按下点落在某个对象（根 Group 标 name="tlObject"）上时交给 Konva 处理（拖动 / 单击选中），
    // 不启动框选；仅空白处按下才框选（按对象=操作对象，按空白=框选）。
    // 用 Konva 命中图判定，而非重算各对象像素盒——cast 整条 Group（图标 + 绿色持续条 +
    // 蓝色 CD 条 + 全宽响应层）都可拖动，盒子法会漏掉条上的按压；命中图天然知道真实几何。
    // 标尺带内无对象，inRuler 时跳过此判断，保持全高度框选。
    if (!inRuler) {
      const onObject = [fixedStageRef.current, stageRef.current].some(stage => {
        if (!stage) return false
        const sbox = stage.container().getBoundingClientRect()
        const px = e.clientX - sbox.left
        const py = e.clientY - sbox.top
        if (px < 0 || py < 0 || px > sbox.width || py > sbox.height) return false
        return !!stage.getIntersection({ x: px, y: py })?.findAncestor('.tlObject', true)
      })
      if (onObject) return
    }
    marquee.onPointerDown(localX, localY, e.shiftKey)

    // 边缘自动滚动：拖框/拖标尺时光标靠近边缘，自动滚动以选取超出一屏的内容。
    // 水平作用于整片画布；垂直仅作用于主舞台（技能轨区：fixedAreaHeight ~ canvasBottom）。
    const canvasLeftEdge = labelColumnWidth + SCROLLBAR_WIDTH
    const canvasBottom = height - minimapHeight
    const EDGE = 80 // 触发带宽度（px）
    const MAX_STEP = 16 // 每帧最大滚动量（px）
    marqueePointerXRef.current = localX
    marqueePointerYRef.current = localY
    autoScrollScrollLeftRef.current = clampedScrollRef.current.scrollLeft
    autoScrollScrollTopRef.current = clampedScrollRef.current.scrollTop
    // 返回某轴的滚动增量（已夹在边界内），并更新追踪 ref
    const axisStep = (
      pos: number,
      lowEdge: number,
      highEdge: number,
      curRef: React.MutableRefObject<number>,
      min: number,
      max: number
    ): number => {
      let dir = 0
      let intensity = 0
      if (pos < lowEdge + EDGE) {
        dir = -1
        intensity = Math.min(1, (lowEdge + EDGE - pos) / EDGE)
      } else if (pos > highEdge - EDGE) {
        dir = 1
        intensity = Math.min(1, (pos - (highEdge - EDGE)) / EDGE)
      }
      if (dir === 0) return 0
      const next = Math.max(min, Math.min(max, curRef.current + dir * MAX_STEP * intensity))
      const delta = next - curRef.current
      curRef.current = next
      return delta
    }
    const tick = () => {
      const dx = axisStep(
        marqueePointerXRef.current,
        canvasLeftEdge,
        width,
        autoScrollScrollLeftRef,
        minScrollLeftRef.current,
        maxScrollLeftRef.current
      )
      // 垂直：仅当指针在主区内（>= fixedAreaHeight）才滚动；触发带为主区顶/底
      const py = marqueePointerYRef.current
      const dy =
        py >= fixedAreaHeight
          ? axisStep(
              py,
              fixedAreaHeight,
              canvasBottom,
              autoScrollScrollTopRef,
              0,
              maxScrollTopRef.current
            )
          : 0
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        const nextLeft = autoScrollScrollLeftRef.current
        const nextTop = autoScrollScrollTopRef.current
        clampedScrollRef.current.scrollTop = nextTop
        if (Math.abs(dx) > 0.01) setScrollLeft(nextLeft)
        if (Math.abs(dy) > 0.01) setScrollTop(nextTop)
        handleDirectScroll(nextLeft, nextTop)
        marquee.shiftStart(-dx, -dy) // 起点锚定世界坐标（垂直锚定主区）
      }
      autoScrollRafRef.current = requestAnimationFrame(tick)
    }
    autoScrollRafRef.current = requestAnimationFrame(tick)

    const stopAutoScroll = () => {
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current)
        autoScrollRafRef.current = null
      }
    }

    const onMove = (ev: PointerEvent) => {
      const r = container.getBoundingClientRect()
      marqueePointerXRef.current = ev.clientX - r.left
      marqueePointerYRef.current = ev.clientY - r.top
      marquee.onPointerMove(ev.clientX - r.left, ev.clientY - r.top)
    }
    const onUp = () => {
      stopAutoScroll()
      marquee.onPointerUp()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      ref={timelineContainerRef}
      className="relative flex flex-col"
      style={
        {
          width,
          height,
          '--tl-scroll-x': `${clampedScrollLeft}px`,
          '--tl-scroll-y': `${clampedScrollTop}px`,
        } as React.CSSProperties
      }
      onPointerDown={handleMarqueePointerDown}
      onClick={() => {
        if (annotationClickedRef.current) {
          annotationClickedRef.current = false
          return
        }
        if (panJustEndedRef.current) return
        setPinnedAnnotationId(null)
      }}
    >
      {/* 框选高亮覆盖层（DOM div，非 Konva）；底边夹到画布区，不覆盖底部 minimap */}
      {marquee.rect &&
        (() => {
          const r = marquee.rect
          const canvasBottom = height - minimapHeight
          const top = r.infinite ? 0 : Math.max(0, Math.min(r.y0, r.y1))
          const bottom = r.infinite ? canvasBottom : Math.min(canvasBottom, Math.max(r.y0, r.y1))
          return (
            <div
              className="pointer-events-none absolute z-20 border border-dashed border-primary bg-primary/10"
              style={{
                left: Math.min(r.x0, r.x1),
                top,
                width: Math.abs(r.x1 - r.x0),
                height: Math.max(0, bottom - top),
              }}
            />
          )
        })()}

      {/* 固定顶部区域：时间标尺 + 伤害事件轨道 */}
      <div className="flex flex-shrink-0" style={{ height: fixedAreaHeight }}>
        {/* 左侧固定标签（宽度包含滚动条区域） */}
        <div
          className="flex-shrink-0 border-r bg-background flex flex-col"
          style={{ width: labelColumnWidth + SCROLLBAR_WIDTH }}
        >
          <div
            style={{ height: timeRulerHeight }}
            className="border-b bg-muted/30 flex items-center justify-end px-2"
          >
            <span className="text-xs text-muted-foreground">时间</span>
          </div>

          <div
            style={{ height: eventTrackHeight }}
            className="border-b bg-muted/50 flex items-center justify-end px-2 gap-1"
          >
            <button
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted"
              onClick={toggleDamageTrackCollapsed}
              title={isDamageTrackCollapsed ? '展开伤害轨道' : '折叠伤害轨道'}
            >
              {isDamageTrackCollapsed ? (
                <ChevronsUpDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronsDownUp className="w-3.5 h-3.5" />
              )}
            </button>
            <span className="text-xs text-muted-foreground">伤害</span>
          </div>

          {hpTrackHeight > 0 && (
            <div
              className="border-b bg-muted/30 flex items-center justify-end px-2"
              style={{ height: HP_CURVE_HEIGHT }}
            >
              <span className="text-xs text-muted-foreground">HP</span>
            </div>
          )}
        </div>

        {/* 右侧固定 Stage 区域 */}
        <div className="flex-1 overflow-hidden" style={{ cursor: 'default' }}>
          <Stage width={viewportWidth} height={fixedAreaHeight} ref={fixedStageRef}>
            <Layer ref={fixedLayerRef} x={-clampedScrollLeft}>
              <TimeRuler
                maxTime={maxTime}
                zoomLevel={zoomLevel}
                timelineWidth={timelineWidth}
                height={timeRulerHeight}
              />

              {/* HP 轨道在 DamageEventTrack 之前渲染，让伤害轨的网格线 / 事件竖线（由
                  bottomExtension 延伸到 HP 轨）画在 HP 曲线之上。 */}
              {hpTrackHeight > 0 && (
                <HpCurveTrack
                  hpTimeline={hpTimeline}
                  zoomLevel={zoomLevel}
                  yOffset={timeRulerHeight + eventTrackHeight}
                  width={timelineWidth}
                  height={HP_CURVE_HEIGHT}
                  viewportWidth={viewportWidth}
                  scrollLeft={clampedScrollLeft}
                />
              )}

              <DamageEventTrack
                events={filteredDamageEvents}
                selectedEventIds={selectedEventIds}
                groupDragDelta={groupDrag?.delta ?? 0}
                groupDraggedId={groupDrag?.draggedDamageId ?? null}
                selectedAnnotationIds={selectedAnnotationIds}
                zoomLevel={zoomLevel}
                timelineWidth={timelineWidth}
                trackHeight={eventTrackHeight}
                rowMap={damageEventRowMap}
                rowHeight={LANE_ROW_HEIGHT}
                yOffset={timeRulerHeight}
                maxTime={maxTime}
                draggingEventPosition={draggingEventPosition}
                viewportWidth={viewportWidth}
                scrollLeft={clampedScrollLeft}
                bottomExtension={hpTrackHeight}
                onSelectEvent={handleSelectEvent}
                onDragStart={(eventId, x) => {
                  setDraggingEventPosition({ eventId, x })
                  reportDamageDrag(eventId, x, true)
                  tryBeginGroupDrag('damage', eventId, x)
                }}
                onDragMove={(eventId, x) => {
                  setDraggingEventPosition({ eventId, x })
                  reportDamageDrag(eventId, x)
                  updateGroupDrag(x)
                }}
                onDragEnd={handleEventDragEnd}
                onAnnotationDragMove={reportAnnotationDrag}
                peerDraggingIds={peerDraggingIds}
                onDblClick={time => setAddEventAt(time)}
                onContextMenu={handleContextMenu}
                isReadOnly={isReadOnly}
                annotations={damageTrackAnnotations}
                pinnedAnnotationId={pinnedAnnotationId}
                onAnnotationHover={handleAnnotationHover}
                onAnnotationHoverEnd={handleAnnotationHoverEnd}
                onAnnotationClick={handleAnnotationClick}
                onAnnotationContextMenu={handleAnnotationContextMenu}
                onAnnotationDragStart={handleAnnotationDragStart}
                onAnnotationDragEnd={handleAnnotationDragEnd}
              />
            </Layer>
            {/* 固定区域十字准线纵线（由 ref 直接控制，绕过 React 渲染） */}
            <Layer ref={fixedOverlayLayerRef} x={-clampedScrollLeft} listening={false}>
              <Line
                ref={crosshairFixedLineRef}
                points={CROSSHAIR_LINE_POINTS}
                stroke={canvasColors.crosshairStroke}
                strokeWidth={1}
                listening={false}
                perfectDrawEnabled={false}
                visible={false}
              />
              {/* 时间标尺悬浮指示器 */}
              <Line
                ref={timeIndicatorLineRef}
                points={CROSSHAIR_LINE_POINTS}
                stroke={canvasColors.zeroLine}
                strokeWidth={1}
                listening={false}
                perfectDrawEnabled={false}
                visible={false}
              />
              <Text
                ref={timeIndicatorTextRef}
                x={0}
                y={8}
                text=""
                fontSize={12}
                fill={canvasColors.textPrimary}
                fontFamily="Arial, sans-serif"
                perfectDrawEnabled={false}
                listening={false}
                visible={false}
              />
              {/* 协作者感知：伤害事件选中高亮 + 悬停光标线 */}
              <PeerOverlayFixed
                zoomLevel={zoomLevel}
                damageEvents={filteredDamageEvents}
                damageEventRowMap={damageEventRowMap}
                yOffset={timeRulerHeight}
                rowHeight={LANE_ROW_HEIGHT}
                fixedAreaHeight={fixedAreaHeight}
                damageTrackHeight={eventTrackHeight}
                annotations={damageTrackAnnotations}
                castEvents={timeline?.castEvents ?? []}
              />
            </Layer>
          </Stage>
        </div>
      </div>

      {/* 可滚动区域：技能轨道（空阵容时显示提示） */}
      {skillTracks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center select-none bg-background">
          <div className="text-center text-sm text-muted-foreground">
            <p>尚未设置小队阵容</p>
            <p className="mt-1 text-xs">
              点击顶部工具栏「小队阵容」添加玩家，即可在此处规划减伤技能
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden select-none">
          {/* 左侧技能标签（含滚动条） */}
          <div
            ref={labelColumnRef}
            className="flex-shrink-0 border-r bg-background overflow-hidden relative"
            style={{ width: labelColumnWidth + SCROLLBAR_WIDTH }}
          >
            <div
              ref={labelColumnContainerRef}
              style={{ height: skillTracksHeight, transform: `translateY(-${clampedScrollTop}px)` }}
            >
              <SkillTrackLabels
                skillTracks={skillTracks}
                trackHeight={skillTrackHeight}
                actions={actions}
                scrollbarWidth={SCROLLBAR_WIDTH}
                onHoverAction={handleHoverActionFromDom}
                onClickAction={handleClickActionFromDom}
                onUnhoverAction={hideTooltip}
              />
            </div>
            {/* 垂直滚动条，绝对定位在左侧，不随内容滚动 */}
            <VerticalScrollbar
              ref={scrollbarRef}
              viewportHeight={Math.max(height - fixedAreaHeight - minimapHeight, 1)}
              contentHeight={skillTracksHeight}
              scrollTop={clampedScrollTop}
              maxScrollTop={maxScrollTop}
              onScroll={newScrollTop => {
                setScrollTop(newScrollTop)
                visualScrollTopRef.current = newScrollTop
                clampedScrollRef.current = {
                  scrollLeft: clampedScrollRef.current.scrollLeft,
                  scrollTop: newScrollTop,
                }
                handleDirectScroll(clampedScrollRef.current.scrollLeft, newScrollTop)
              }}
            />
          </div>

          {/* 右侧技能轨道 Stage */}
          <div className="flex-1 overflow-hidden" style={{ cursor: 'default' }}>
            <Stage
              width={viewportWidth}
              height={Math.max(height - fixedAreaHeight - minimapHeight, 1)}
              ref={stageRef}
            >
              <SkillTracksCanvas
                timeline={timeline}
                skillTracks={skillTracks}
                actions={actions}
                actionMap={actionMap}
                displayActionOverrides={displayActionOverrides}
                engine={engine}
                invalidCastEventMap={invalidCastEventMap}
                zoomLevel={zoomLevel}
                timelineWidth={timelineWidth}
                trackHeight={skillTrackHeight}
                maxTime={maxTime}
                selectedCastEventIds={selectedCastEventIds}
                groupDragDelta={groupDrag?.delta ?? 0}
                groupDraggedCastId={groupDrag?.draggedCastId ?? null}
                selectedEventIds={selectedEventIds}
                selectedAnnotationIds={selectedAnnotationIds}
                draggingEventPosition={draggingEventPosition}
                scrollLeft={clampedScrollLeft}
                scrollTop={clampedScrollTop}
                viewportWidth={viewportWidth}
                bgLayerRef={mainBgLayerRef}
                eventLayerRef={mainEventLayerRef}
                overlayLayerRef={mainOverlayLayerRef}
                crosshairLineRef={crosshairMainLineRef}
                trackHighlightRef={trackHighlightRef}
                overlayChildren={
                  <PeerOverlayMain
                    zoomLevel={zoomLevel}
                    castEvents={timeline.castEvents}
                    skillTracks={skillTracks}
                    actionMap={actionMap}
                    trackHeight={skillTrackHeight}
                    skillTracksHeight={skillTracksHeight}
                    annotations={skillTrackAnnotations}
                    damageEvents={filteredDamageEvents}
                  />
                }
                onSelectCastEvent={handleSelectCastEvent}
                onUpdateCastEvent={handleCastEventDragEnd}
                onContextMenu={handleContextMenu}
                onDoubleClickTrack={handleDoubleClickTrack}
                onHoverAction={handleHoverAction}
                onHoverActionEnd={hideTooltip}
                onClickAction={handleClickAction}
                isReadOnly={isReadOnly}
                annotations={skillTrackAnnotations}
                pinnedAnnotationId={pinnedAnnotationId}
                onAnnotationHover={handleAnnotationHover}
                onAnnotationHoverEnd={handleAnnotationHoverEnd}
                onAnnotationClick={handleAnnotationClick}
                onAnnotationContextMenu={handleAnnotationContextMenu}
                onAnnotationDragStart={handleAnnotationDragStart}
                onAnnotationDragEnd={handleAnnotationDragEnd}
                peerDraggingIds={peerDraggingIds}
                onCastDragStart={castEventId => {
                  reportCastDragStart(castEventId)
                  const ce = useTimelineStore
                    .getState()
                    .timeline?.castEvents.find(c => c.id === castEventId)
                  if (ce) tryBeginGroupDrag('cast', castEventId, ce.timestamp * zoomLevel)
                }}
                onCastDragMove={(castEventId, x) => {
                  reportCastDrag(castEventId, x)
                  updateGroupDrag(x)
                }}
                onAnnotationDragMove={reportAnnotationDrag}
              />
            </Stage>
          </div>
        </div>
      )}

      {/* 缩略图导航 */}
      <TimelineMinimap
        ref={minimapRef}
        width={width}
        height={80}
        scrollLeft={clampedScrollLeft}
        viewportWidth={viewportWidth}
        totalWidth={timelineWidth}
        zoomLevel={zoomLevel}
        onScroll={newScrollLeft => {
          setScrollLeft(newScrollLeft)
        }}
      />

      {/* 添加伤害事件对话框 */}
      {addEventAt !== null && (
        <AddEventDialog open={true} onClose={() => setAddEventAt(null)} defaultTime={addEventAt} />
      )}

      {/* 右键上下文菜单 */}
      <TimelineContextMenu
        menu={contextMenu}
        isReadOnly={isReadOnly}
        onClose={handleContextMenuClose}
        onDeleteCast={removeCastEvent}
        onAddCast={handleContextMenuAddCast}
        onCopyDamageEventText={handleCopyDamageEventText}
        onCopyDamageEvent={() => void copySelection()}
        onDeleteDamageEvent={removeDamageEvent}
        onAddDamageEvent={handleContextMenuAddDamageEvent}
        onAddAnnotation={handleAddAnnotation}
        onEditAnnotation={handleEditAnnotation}
        onDeleteAnnotation={handleDeleteAnnotation}
        onCopySelection={() => void copySelection()}
        onDeleteSelection={() => useTimelineStore.getState().bulkDeleteSelection()}
        pasteAvailable={pasteAvailable}
        onPasteSelection={t => void pasteAtTime(t)}
        onSelectAll={selectAll}
        onSelectAllDamageEvents={selectAllDamageEvents}
        onSelectAllCasts={selectAllCasts}
      />

      <PasteConfirmDialog
        pending={pendingPaste}
        onConfirm={() => {
          if (pendingPaste) commitPaste(pendingPaste)
          setPendingPaste(null)
        }}
        onCancel={() => setPendingPaste(null)}
      />

      {/* 注释悬浮查看（pointer-events: none，通过 CSS 变量实时跟随滚动） */}
      {hoverAnnotation && hoverBasePos && !editingAnnotation && !pinnedAnnotation && (
        <AnnotationBubble text={hoverAnnotation.text} basePos={hoverBasePos} />
      )}

      {/* 注释固定显示（点击切换，通过 CSS 变量实时跟随滚动） */}
      {pinnedAnnotation && pinnedBasePos && !editingAnnotation && !isDraggingAnnotation && (
        <AnnotationBubble text={pinnedAnnotation.text} basePos={pinnedBasePos} />
      )}

      {/* 注释编辑 */}
      {editingAnnotation && (
        <AnnotationPopover
          key={editingAnnotation.annotation?.id ?? 'new'}
          mode="edit"
          text={editingAnnotation.annotation?.text ?? ''}
          screenX={editingAnnotation.screenX}
          screenY={editingAnnotation.screenY}
          onConfirm={handleAnnotationConfirm}
          onClose={() => setEditingAnnotation(null)}
        />
      )}
    </div>
  )
}
