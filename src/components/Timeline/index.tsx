/**
 * 时间轴 Canvas 主组件（重构版）
 */

import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
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
  useDamageCalculationSimulate,
} from '@/contexts/DamageCalculationContext'
import { createPlacementEngine } from '@/utils/placement/engine'
import type { InvalidReason, PlacementEngine } from '@/utils/placement/types'
import { getStatusById } from '@/utils/statusRegistry'
import { getStatusName } from '@/utils/statusIconUtils'
import { getSyncScrollProgress, setSyncScrollProgress } from '@/utils/syncScrollProgress'
import AddEventDialog from '../AddEventDialog'
import AnnotationPopover from './AnnotationPopover'
import TimelineContextMenu from './TimelineContextMenu'
import type { ContextMenuState, DamageEventClipboard } from './TimelineContextMenu'
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
import { TIMELINE_START_TIME, useCanvasColors } from './constants'
import { formatTimeWithDecimal } from '@/utils/formatters'
import { useSkillTracks } from '@/hooks/useSkillTracks'
import { useFilteredTimelineView } from '@/hooks/useFilteredTimelineView'

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
  const [clipboard, setClipboard] = useState<DamageEventClipboard>(null)
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
  const minimapRef = useRef<TimelineMinimapHandle | null>(null)
  const scrollbarRef = useRef<VerticalScrollbarHandle | null>(null)

  const {
    timeline,
    zoomLevel,
    selectedEventId,
    selectedCastEventId,
    pendingScrollProgress,
    selectEvent,
    selectCastEvent,
    addCastEvent,
    removeDamageEvent,
    removeCastEvent,
    setZoomLevel,
    setPendingScrollProgress,
    updateScrollState,
    triggerAutoSave,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
  } = useTimelineStore()
  const { actions } = useMitigationStore()
  const { isDamageTrackCollapsed, toggleDamageTrackCollapsed } = useUIStore()
  const calculationResults = useDamageCalculationResults()
  const simulate = useDamageCalculationSimulate()

  const actionMap = useMemo(() => new Map(actions.map(a => [a.id, a])), [actions])

  const engine: PlacementEngine | null = useMemo(() => {
    if (!timeline || !simulate) return null
    return createPlacementEngine({
      castEvents: timeline.castEvents,
      actions: actionMap,
      simulate,
    })
  }, [timeline, simulate, actionMap])

  const [draggingId, setDraggingId] = useState<string | null>(null)

  const invalidCastEventMap = useMemo(() => {
    if (!engine) return new Map<string, InvalidReason>()
    const invalid = engine.findInvalidCastEvents(draggingId ?? undefined)
    return new Map(invalid.map(r => [r.castEvent.id, r.reason]))
  }, [engine, draggingId])

  const { showTooltip, toggleTooltip, hideTooltip } = useTooltipStore()
  const isReadOnly = useEditorReadOnly()
  const skillTracks = useSkillTracks()
  const { filteredDamageEvents } = useFilteredTimelineView()

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

  useTimelinePanZoom(fixedStageRef, panZoomRefs, {
    enableVerticalScroll: false,
    isReadOnly,
    setScrollLeft,
    setScrollTop,
    onDirectScroll: handleDirectScroll,
  })
  useTimelinePanZoom(stageRef, panZoomRefs, {
    enableVerticalScroll: true,
    isReadOnly,
    setScrollLeft,
    setScrollTop,
    onDirectScroll: handleDirectScroll,
  })

  // 布局常量
  const timeRulerHeight = 30
  const skillTrackHeight = 40
  const labelColumnWidth = 70
  const minimapHeight = 80 + 16 + 1 // canvas(80) + p-2 padding(16) + border-t(1)

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
    const fixedAreaHeight = timeRulerHeight + eventTrackHeight
    const skillTracksHeight = skillTracks.length * skillTrackHeight

    return {
      damageEventRowMap,
      eventTrackHeight,
      timelineWidth,
      fixedAreaHeight,
      skillTracksHeight,
      laneCount,
      LANE_ROW_HEIGHT,
      // Task 14/15 会移除 displayActionOverrides prop 管道；trackGroup + 原始 actionId
      // 已经让渲染层自然挂载，此 Map 暂留为空占位以保持编译。
      displayActionOverrides: new Map<string, MitigationAction>(),
      maxTime,
    }
  }, [timeline, zoomLevel, skillTracks, isDamageTrackCollapsed, filteredDamageEvents])

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
    (stageRefParam: React.RefObject<Konva.Stage | null>, withTrackHighlight: boolean) =>
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
    },
    [hideCrosshair]
  )

  // 绑定十字准线鼠标事件
  useEffect(() => {
    const mainStage = stageRef.current
    const fixedStage = fixedStageRef.current
    if (!mainStage || !fixedStage) return

    const mainContainer = mainStage.container()
    const fixedContainer = fixedStage.container()

    const handleMainMove = createCrosshairMoveHandler(stageRef, true)
    const handleFixedMove = createCrosshairMoveHandler(fixedStageRef, false)

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

  // 检查技能是否与同轨道的其他技能重叠
  const checkOverlap = (
    newTime: number,
    playerId: number,
    actionId: number,
    excludeCastEventId?: string
  ): boolean => {
    if (!timeline) return false

    const currentAction = actions.find(a => a.id === actionId)
    if (!currentAction) return false

    const currentEndTime = newTime + currentAction.cooldown

    return timeline.castEvents.some(other => {
      if (excludeCastEventId && other.id === excludeCastEventId) return false
      if (other.playerId !== playerId || other.actionId !== actionId) return false

      const otherAction = actions.find(a => a.id === other.actionId)
      if (!otherAction) return false

      const otherTimeSeconds = other.timestamp
      const otherEndTime = otherTimeSeconds + otherAction.cooldown

      return newTime < otherEndTime && otherTimeSeconds < currentEndTime
    })
  }

  // 同步左侧标签列的垂直滚动（用 clampedScrollTop，在渲染阶段计算后通过 ref 同步）

  // 初始化缩放级别
  useEffect(() => {
    if (width > 0 && !hasInitializedZoom.current && zoomLevel === 50) {
      const defaultZoomLevel = width / 60
      setZoomLevel(defaultZoomLevel)
      hasInitializedZoom.current = true
    }
  }, [width, zoomLevel, setZoomLevel])

  // 复制 / 粘贴伤害事件（热键与右键菜单共用）
  const handleContextMenuCopyDamageEvent = useCallback(
    (eventId: string) => {
      if (!timeline) return
      const event = timeline.damageEvents.find(e => e.id === eventId)
      if (!event) return
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, time: _time, ...rest } = event
      setClipboard(rest)
      toast.success('已复制伤害事件')
    },
    [timeline]
  )

  const handleContextMenuPasteDamageEvent = useCallback(
    (time: number) => {
      if (!clipboard) return
      const { addDamageEvent } = useTimelineStore.getState()
      addDamageEvent({
        ...clipboard,
        id: `event-${Date.now()}`,
        time,
      })
      toast.success('已粘贴伤害事件')
    },
    [clipboard]
  )

  // 撤销 / 重做
  const runUndoRedo = (op: 'undo' | 'redo') => {
    useTimelineStore.temporal.getState()[op]()
    selectEvent(null)
    selectCastEvent(null)
    triggerAutoSave()
  }
  useHotkeys('mod+z', () => runUndoRedo('undo'), {
    enabled: !isReadOnly,
    preventDefault: true,
  })
  useHotkeys('mod+shift+z', () => runUndoRedo('redo'), {
    enabled: !isReadOnly,
    preventDefault: true,
  })

  // 删除选中的事件或注释
  useHotkeys(
    'delete, backspace',
    () => {
      if (pinnedAnnotationId) {
        removeAnnotation(pinnedAnnotationId)
        setPinnedAnnotationId(null)
      } else if (selectedEventId) {
        removeDamageEvent(selectedEventId)
      } else if (selectedCastEventId) {
        removeCastEvent(selectedCastEventId)
      }
    },
    { enabled: !isReadOnly },
    [pinnedAnnotationId, selectedEventId, selectedCastEventId]
  )

  // 复制选中的伤害事件
  useHotkeys(
    'mod+c',
    () => {
      if (!selectedEventId) return
      handleContextMenuCopyDamageEvent(selectedEventId)
    },
    { enabled: !isReadOnly },
    [selectedEventId, handleContextMenuCopyDamageEvent]
  )

  // 粘贴伤害事件（在鼠标悬浮位置，若无则在视口中央）
  useHotkeys(
    'mod+v',
    () => {
      if (!clipboard) return
      const pasteTime =
        hoverTimeRef.current ??
        (clampedScrollRef.current.scrollLeft + viewportWidth / 2) / zoomLevel
      handleContextMenuPasteDamageEvent(Math.round(pasteTime * 10) / 10)
    },
    { enabled: !isReadOnly, preventDefault: true },
    [clipboard, viewportWidth, zoomLevel, handleContextMenuPasteDamageEvent]
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

    let resolvedActionId = actionId
    const parent = actionMap.get(actionId)
    if (engine && parent) {
      const groupId = parent.trackGroup ?? parent.id
      const member = engine.pickUniqueMember(groupId, playerId, time)
      if (!member) {
        toast.error('当前无可用技能', { description: '此时刻没有合法成员' })
        return
      }
      resolvedActionId = member.id
    }

    if (checkOverlap(time, playerId, resolvedActionId)) {
      toast.error('无法添加技能', { description: '该技能与已有技能重叠' })
      return
    }

    addCastEvent({
      id: `cast-${Date.now()}`,
      actionId: resolvedActionId,
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

  // 处理伤害事件拖动
  const handleEventDragEnd = (eventId: string, x: number) => {
    if (isReadOnly) return
    const newTime = Math.max(TIMELINE_START_TIME, Math.round((x / zoomLevel) * 10) / 10)
    const { updateDamageEvent } = useTimelineStore.getState()
    updateDamageEvent(eventId, { time: newTime })
    setDraggingEventPosition(null)
  }

  // 处理技能使用事件拖动
  const handleCastEventDragEnd = (castEventId: string, x: number) => {
    if (isReadOnly) return
    const newTime = Math.max(TIMELINE_START_TIME, Math.round((x / zoomLevel) * 10) / 10)
    const { updateCastEvent } = useTimelineStore.getState()
    const existing = timeline?.castEvents.find(ce => ce.id === castEventId)
    if (!existing) return
    // 拖到新位置后：若当前 actionId 在新时刻不合法，engine 给出同轨道 t 时刻的
    // 唯一合法成员（变体自动切换：37013 ⇄ 37016）。engine 未就绪或成员选不出时
    // 保留原 actionId（由红边框回溯提示非法）。
    const currentAction = actionMap.get(existing.actionId)
    let nextActionId = existing.actionId
    if (engine && currentAction) {
      const groupId = currentAction.trackGroup ?? currentAction.id
      const canKeepCurrent = engine.canPlaceCastEvent(
        currentAction,
        existing.playerId,
        newTime,
        castEventId
      ).ok
      if (!canKeepCurrent) {
        const member = engine.pickUniqueMember(groupId, existing.playerId, newTime, castEventId)
        if (member) nextActionId = member.id
      }
    }
    updateCastEvent(castEventId, { timestamp: newTime, actionId: nextActionId })
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
      if (payload.type === 'castEvent') {
        selectCastEvent(payload.castEventId)
      } else if (payload.type === 'damageEvent') {
        selectEvent(payload.eventId)
      }

      setContextMenu({ ...payload, x: clientX, y: clientY, time })
    },
    [selectCastEvent, selectEvent]
  )

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null)
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

  const handleAnnotationDragStart = useCallback(() => {
    setIsDraggingAnnotation(true)
  }, [])

  const handleAnnotationDragEnd = useCallback(
    (annotationId: string, newX: number) => {
      setIsDraggingAnnotation(false)
      annotationClickedRef.current = true
      const newTime = Math.max(TIMELINE_START_TIME, Math.round((newX / zoomLevel) * 10) / 10)
      updateAnnotation(annotationId, { time: newTime })
    },
    [zoomLevel, updateAnnotation]
  )

  const handleAnnotationConfirm = useCallback(
    (text: string) => {
      if (!editingAnnotation) return
      if (editingAnnotation.annotation) {
        updateAnnotation(editingAnnotation.annotation.id, { text })
      } else {
        addAnnotation({
          id: crypto.randomUUID(),
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
      onClick={() => {
        if (annotationClickedRef.current) {
          annotationClickedRef.current = false
          return
        }
        if (panJustEndedRef.current) return
        setPinnedAnnotationId(null)
      }}
    >
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

              <DamageEventTrack
                events={filteredDamageEvents}
                selectedEventId={selectedEventId}
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
                onSelectEvent={handleSelectEvent}
                onDragStart={(eventId, x) => setDraggingEventPosition({ eventId, x })}
                onDragMove={(eventId, x) => {
                  setDraggingEventPosition({ eventId, x })
                }}
                onDragEnd={handleEventDragEnd}
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
                points={[0, 0, 0, fixedAreaHeight]}
                stroke={canvasColors.crosshairStroke}
                strokeWidth={1}
                listening={false}
                perfectDrawEnabled={false}
                visible={false}
              />
              {/* 时间标尺悬浮指示器 */}
              <Line
                ref={timeIndicatorLineRef}
                points={[0, 0, 0, timeRulerHeight]}
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
                draggingId={draggingId}
                setDraggingId={setDraggingId}
                zoomLevel={zoomLevel}
                timelineWidth={timelineWidth}
                trackHeight={skillTrackHeight}
                maxTime={maxTime}
                selectedCastEventId={selectedCastEventId}
                draggingEventPosition={draggingEventPosition}
                scrollLeft={clampedScrollLeft}
                scrollTop={clampedScrollTop}
                viewportWidth={viewportWidth}
                bgLayerRef={mainBgLayerRef}
                eventLayerRef={mainEventLayerRef}
                overlayLayerRef={mainOverlayLayerRef}
                crosshairLineRef={crosshairMainLineRef}
                trackHighlightRef={trackHighlightRef}
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
        clipboard={clipboard}
        isReadOnly={isReadOnly}
        onClose={handleContextMenuClose}
        onDeleteCast={removeCastEvent}
        onAddCast={handleContextMenuAddCast}
        onCopyDamageEventText={handleCopyDamageEventText}
        onCopyDamageEvent={handleContextMenuCopyDamageEvent}
        onDeleteDamageEvent={removeDamageEvent}
        onAddDamageEvent={handleContextMenuAddDamageEvent}
        onPasteDamageEvent={handleContextMenuPasteDamageEvent}
        onAddAnnotation={handleAddAnnotation}
        onEditAnnotation={handleEditAnnotation}
        onDeleteAnnotation={handleDeleteAnnotation}
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
