/**
 * 时间轴 Canvas 主组件（重构版）
 */

import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { Stage, Layer, Line } from 'react-konva'
import type Konva from 'konva'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useTooltipStore } from '@/store/tooltipStore'
import { useUIStore } from '@/store/uiStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { useTimelinePanZoom } from '@/hooks/useTimelinePanZoom'
import type { PanZoomRefs } from '@/hooks/useTimelinePanZoom'
import { sortJobsByOrder, getJobName } from '@/data/jobs'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'
import { useDamageCalculationResults } from '@/contexts/DamageCalculationContext'
import { getStatusById } from '@/utils/statusRegistry'
import { getStatusName } from '@/utils/statusIconUtils'
import AddEventDialog from '../AddEventDialog'
import TimelineContextMenu from './TimelineContextMenu'
import type { ContextMenuState, DamageEventClipboard } from './TimelineContextMenu'
import TimeRuler from './TimeRuler'
import DamageEventTrack from './DamageEventTrack'
import SkillTrackLabels from './SkillTrackLabels'
import SkillTracksCanvas from './SkillTracksCanvas'
import TimelineMinimap from './TimelineMinimap'
import type { TimelineMinimapHandle } from './TimelineMinimap'
import type { SkillTrack } from './SkillTrackLabels'
import type { CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { KonvaEventObject } from 'konva/lib/Node'
import { TIMELINE_START_TIME } from './constants'

interface TimelineCanvasProps {
  width: number
  height: number
}

export default function TimelineCanvas({ width, height }: TimelineCanvasProps) {
  const stageRef = useRef<Konva.Stage | null>(null)
  const fixedStageRef = useRef<Konva.Stage | null>(null)
  const labelColumnContainerRef = useRef<HTMLDivElement>(null)
  const hasInitializedZoom = useRef(false)
  const scrollLeftRef = useRef(0)
  const scrollTopRef = useRef(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [clipboard, setClipboard] = useState<DamageEventClipboard>(null)
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
  const inertiaRafIdRef = useRef<number | null>(null)
  // Konva Layer refs（用于直接操作 Layer 位置，绕过 React 渲染）
  const fixedLayerRef = useRef<Konva.Layer | null>(null)
  const mainBgLayerRef = useRef<Konva.Layer | null>(null)
  const mainEventLayerRef = useRef<Konva.Layer | null>(null)
  // 十字准线状态
  const hoverTimeRef = useRef<number | null>(null)
  const hoverTrackIndexRef = useRef<number | null>(null)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverTrackIndex, setHoverTrackIndex] = useState<number | null>(null)
  // overlay Layer refs
  const mainOverlayLayerRef = useRef<Konva.Layer | null>(null)
  const fixedOverlayLayerRef = useRef<Konva.Layer | null>(null)
  const minimapRef = useRef<TimelineMinimapHandle | null>(null)

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
  } = useTimelineStore()
  const { actions, loadActions } = useMitigationStore()
  const { hiddenPlayerIds } = useUIStore()
  const calculationResults = useDamageCalculationResults()

  useEffect(() => {
    if (actions.length === 0) {
      loadActions()
    }
  }, [actions.length, loadActions])
  const { showTooltip, toggleTooltip, hideTooltip } = useTooltipStore()
  const isReadOnly = useEditorReadOnly()

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
    inertiaRafIdRef,
  }

  // 直接操作 Konva Layer 位置的回调（拖动/惯性动画期间绕过 React 渲染）
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

  // 计算布局数据（仅在 timeline/zoomLevel/actions/hiddenPlayerIds 变化时重新计算）
  const layoutData = useMemo(() => {
    if (!timeline) return null

    // 获取阵容和技能轨道信息
    const composition = timeline.composition || { players: [] }

    // 按职业顺序排序玩家
    const sortedPlayers = sortJobsByOrder(composition.players, p => p.job)

    const skillTracks: SkillTrack[] = []
    sortedPlayers.forEach(player => {
      if (hiddenPlayerIds.has(player.id)) return
      const jobActions = actions.filter(action => action.jobs.includes(player.job))
      jobActions.forEach(action => {
        skillTracks.push({
          job: player.job,
          playerId: player.id,
          actionId: action.id,
          actionName: action.name,
          actionIcon: action.icon,
        })
      })
    })

    // 泳道算法：为每个伤害事件分配行
    const CARD_WIDTH_SECONDS = 150 / zoomLevel // 卡片固定 150px 转换为秒
    const LANE_ROW_HEIGHT = 36 // 每行高度（px）
    const damageEventRowMap = new Map<string, number>()
    const laneEndTimes: number[] = [] // 每个泳道当前最右端的时间（秒）

    const sortedDamageEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)
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
    const laneCount = Math.max(1, laneEndTimes.length)
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
      skillTracks,
      damageEventRowMap,
      eventTrackHeight,
      timelineWidth,
      fixedAreaHeight,
      skillTracksHeight,
      laneCount,
      LANE_ROW_HEIGHT,
    }
  }, [timeline, zoomLevel, actions, hiddenPlayerIds])

  // 十字准线：鼠标移动事件（技能轨道区域计算轨道高亮，固定区域只更新时间）
  const createCrosshairMoveHandler = useCallback(
    (stageRef: React.RefObject<Konva.Stage | null>, withTrackHighlight: boolean) =>
      (e: MouseEvent) => {
        if (isDraggingRef.current) {
          if (hoverTimeRef.current !== null) {
            hoverTimeRef.current = null
            hoverTrackIndexRef.current = null
            setHoverTime(null)
            setHoverTrackIndex(null)
          }
          return
        }

        const stage = stageRef.current
        if (!stage) return

        const rect = stage.container().getBoundingClientRect()
        const pointerX = e.clientX - rect.left
        const time = (pointerX + clampedScrollRef.current.scrollLeft) / zoomLevel

        hoverTimeRef.current = time

        if (withTrackHighlight) {
          const pointerY = e.clientY - rect.top
          const trackIndex = Math.floor((pointerY + visualScrollTopRef.current) / skillTrackHeight)
          hoverTrackIndexRef.current =
            trackIndex >= 0 && trackIndex < (layoutData?.skillTracks.length ?? 0)
              ? trackIndex
              : null
        } else {
          hoverTrackIndexRef.current = null
        }

        setHoverTime(time)
        setHoverTrackIndex(hoverTrackIndexRef.current)
      },
    [zoomLevel, layoutData?.skillTracks.length]
  )

  // 十字准线：鼠标离开事件
  const handleCrosshairLeave = useCallback((e: MouseEvent) => {
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
    setHoverTime(null)
    setHoverTrackIndex(null)
  }, [])

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

  // 视口宽度（Stage 实际宽度）
  const viewportWidth = Math.max(width - labelColumnWidth, 1)
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

  // 同步滚动状态到 store（用于工具栏缩放）
  useEffect(() => {
    if (layoutData) {
      updateScrollState(scrollLeft, layoutData.timelineWidth, viewportWidth)
    }
    // updateScrollState 来自 Zustand store，引用稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollLeft, layoutData?.timelineWidth, viewportWidth])

  // 同步 ref（用于事件处理器闭包）
  useEffect(() => {
    maxScrollLeftRef.current = maxScrollLeft
    minScrollLeftRef.current = minScrollLeft
    maxScrollTopRef.current = maxScrollTop
    // 只同步 scrollLeft；scrollTop 由 direct scroll 路径管理（inertia/drag/wheel），
    // 避免惯性动画期间用 stale 的 React state 覆盖正确的 ref 值
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

  // 撤销
  useHotkeys(
    'mod+z',
    () => {
      useTimelineStore.temporal.getState().undo()
      selectEvent(null)
      selectCastEvent(null)
      triggerAutoSave()
    },
    { enabled: !isReadOnly, preventDefault: true }
  )

  // 重做
  useHotkeys(
    'mod+shift+z',
    () => {
      useTimelineStore.temporal.getState().redo()
      selectEvent(null)
      selectCastEvent(null)
      triggerAutoSave()
    },
    { enabled: !isReadOnly, preventDefault: true }
  )

  // 删除选中的事件
  useHotkeys(
    'delete, backspace',
    () => {
      if (selectedEventId) {
        removeDamageEvent(selectedEventId)
      } else if (selectedCastEventId) {
        removeCastEvent(selectedCastEventId)
      }
    },
    { enabled: !isReadOnly },
    [selectedEventId, selectedCastEventId]
  )

  // 复制选中的伤害事件
  useHotkeys(
    'mod+c',
    () => {
      if (!selectedEventId || !timeline) return
      const event = timeline.damageEvents.find(e => e.id === selectedEventId)
      if (!event) return
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, time: _time, ...rest } = event
      setClipboard(rest)
      toast.success('已复制伤害事件')
    },
    { enabled: !isReadOnly },
    [selectedEventId, timeline]
  )

  // 粘贴伤害事件（在鼠标悬浮位置，若无则在视口中央）
  useHotkeys(
    'mod+v',
    () => {
      if (!clipboard) return
      const pasteTime =
        hoverTimeRef.current ??
        (clampedScrollRef.current.scrollLeft + viewportWidth / 2) / zoomLevel
      const { addDamageEvent } = useTimelineStore.getState()
      addDamageEvent({
        ...clipboard,
        id: `event-${Date.now()}`,
        time: Math.round(pasteTime * 10) / 10,
      })
      toast.success('已粘贴伤害事件')
    },
    { enabled: !isReadOnly, preventDefault: true },
    [clipboard, viewportWidth, zoomLevel]
  )

  // 处理技能悬浮提示
  const handleHoverAction = (action: MitigationAction, e: KonvaEventObject<MouseEvent>) => {
    if (isDraggingRef.current) return
    const stage = e.target.getStage()
    if (!stage) return
    const stageBounds = stage.container().getBoundingClientRect()
    let node: Konva.Node = e.target
    while (node.getClassName() !== 'Group' && node.getParent()) {
      node = node.getParent()!
    }
    const absPos = node.getAbsolutePosition()
    const screenX = stageBounds.left + absPos.x
    const screenY = stageBounds.top + absPos.y
    const anchorRect = new DOMRect(screenX, screenY - 15, 30, 30)
    showTooltip(action, anchorRect, ['b', 't', 'l', 'r'])
  }

  const handleClickAction = (
    action: MitigationAction,
    e: KonvaEventObject<MouseEvent | TouchEvent>
  ) => {
    const stage = e.target.getStage()
    if (!stage) return
    const stageBounds = stage.container().getBoundingClientRect()
    let node: Konva.Node = e.target
    while (node.getClassName() !== 'Group' && node.getParent()) {
      node = node.getParent()!
    }
    const absPos = node.getAbsolutePosition()
    const screenX = stageBounds.left + absPos.x
    const screenY = stageBounds.top + absPos.y
    const anchorRect = new DOMRect(screenX, screenY - 15, 30, 30)
    toggleTooltip(action, anchorRect, ['b', 't', 'l', 'r'])
  }

  const handleHoverActionFromDom = (action: MitigationAction, anchorRect: DOMRect) => {
    if (isDraggingRef.current) return
    showTooltip(action, anchorRect)
  }

  const handleClickActionFromDom = (action: MitigationAction, anchorRect: DOMRect) => {
    toggleTooltip(action, anchorRect)
  }

  // 处理双击轨道添加技能
  const handleDoubleClickTrack = (track: SkillTrack, time: number) => {
    if (!timeline || isReadOnly) return

    // 如果刚刚完成了平移操作，阻止误触发
    if (panJustEndedRef.current || Date.now() - lastPanEndTimeRef.current < 300) return

    if (checkOverlap(time, track.playerId, track.actionId)) {
      toast.error('无法添加技能', {
        description: `该技能与已有技能重叠`,
      })
      return
    }

    const castEvent: CastEvent = {
      id: `cast-${Date.now()}`,
      actionId: track.actionId,
      timestamp: time,
      playerId: track.playerId,
      job: track.job,
    }
    addCastEvent(castEvent)
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
    updateCastEvent(castEventId, { timestamp: newTime })
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
        | { type: 'skillTrackEmpty'; actionId: number }
        | { type: 'damageEvent'; eventId: string }
        | { type: 'damageTrackEmpty' },
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

  const handleContextMenuAddCast = useCallback(
    (actionId: number, time: number) => {
      if (!timeline) return
      const track = layoutData?.skillTracks.find(t => t.actionId === actionId)
      if (!track) return

      if (checkOverlap(time, track.playerId, actionId)) {
        toast.error('无法添加技能', { description: '该技能与已有技能重叠' })
        return
      }

      addCastEvent({
        id: `cast-${Date.now()}`,
        actionId,
        timestamp: time,
        playerId: track.playerId,
        job: track.job,
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeline, layoutData?.skillTracks, addCastEvent]
  )

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
          const dead = (detail.overkill ?? 0) > 0
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

  const handleContextMenuAddDamageEvent = useCallback((time: number) => {
    setAddEventAt(time)
  }, [])

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

  if (!timeline || !layoutData) {
    return (
      <div className="flex items-center justify-center bg-muted/20" style={{ width, height }}>
        <p className="text-muted-foreground">未加载时间轴</p>
      </div>
    )
  }

  const {
    skillTracks,
    damageEventRowMap,
    eventTrackHeight,
    timelineWidth,
    fixedAreaHeight,
    skillTracksHeight,
    LANE_ROW_HEIGHT,
  } = layoutData

  // 计算时间轴总长度
  const lastEventTime = Math.max(
    0,
    ...timeline.damageEvents.map(e => e.time),
    ...timeline.castEvents.map(ce => ce.timestamp)
  )

  const maxTime = Math.max(300, lastEventTime + 60)

  return (
    <div className="relative flex flex-col" style={{ width, height }}>
      {/* 固定顶部区域：时间标尺 + 伤害事件轨道 */}
      <div className="flex flex-shrink-0" style={{ height: fixedAreaHeight }}>
        {/* 左侧固定标签 */}
        <div
          className="flex-shrink-0 border-r bg-background flex flex-col"
          style={{ width: labelColumnWidth }}
        >
          <div
            style={{ height: timeRulerHeight }}
            className="border-b bg-muted/30 flex items-center justify-end px-2"
          >
            <span className="text-xs text-muted-foreground">时间</span>
          </div>

          <div
            style={{ height: eventTrackHeight }}
            className="border-b bg-muted/50 flex items-center justify-end px-2"
          >
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
                hoverTime={hoverTime}
              />

              <DamageEventTrack
                events={timeline.damageEvents}
                selectedEventId={selectedEventId}
                zoomLevel={zoomLevel}
                timelineWidth={timelineWidth}
                trackHeight={eventTrackHeight}
                rowMap={damageEventRowMap}
                rowHeight={LANE_ROW_HEIGHT}
                yOffset={timeRulerHeight}
                maxTime={maxTime}
                draggingEventPosition={draggingEventPosition}
                onSelectEvent={handleSelectEvent}
                onDragStart={(eventId, x) => setDraggingEventPosition({ eventId, x })}
                onDragMove={(eventId, x) => {
                  setDraggingEventPosition({ eventId, x })
                }}
                onDragEnd={handleEventDragEnd}
                onDblClick={time => setAddEventAt(time)}
                onContextMenu={handleContextMenu}
                isReadOnly={isReadOnly}
              />
            </Layer>
            {/* 固定区域十字准线纵线 */}
            <Layer ref={fixedOverlayLayerRef} x={-clampedScrollLeft} listening={false}>
              {hoverTime != null && (
                <Line
                  points={[hoverTime * zoomLevel, 0, hoverTime * zoomLevel, fixedAreaHeight]}
                  stroke="#9ca3af"
                  strokeWidth={1}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              )}
            </Layer>
          </Stage>
        </div>
      </div>

      {/* 可滚动区域：技能轨道 */}
      <div className="flex flex-1 overflow-hidden select-none">
        {/* 左侧技能标签 */}
        <div
          className="flex-shrink-0 border-r bg-background overflow-hidden"
          style={{ width: labelColumnWidth }}
          onWheel={e => {
            e.preventDefault()
            const newScrollTop = Math.max(
              0,
              Math.min(scrollTopRef.current + e.deltaY, maxScrollTop)
            )
            setScrollTop(newScrollTop)
            // 同步 useTimelinePanZoom 读取的 refs，避免下次垂直拖动从错误位置起跳
            visualScrollTopRef.current = newScrollTop
            clampedScrollRef.current = {
              scrollLeft: clampedScrollRef.current.scrollLeft,
              scrollTop: newScrollTop,
            }
          }}
        >
          <div
            ref={labelColumnContainerRef}
            style={{ height: skillTracksHeight, transform: `translateY(-${clampedScrollTop}px)` }}
          >
            <SkillTrackLabels
              skillTracks={skillTracks}
              trackHeight={skillTrackHeight}
              actions={actions}
              onHoverAction={handleHoverActionFromDom}
              onClickAction={handleClickActionFromDom}
              onUnhoverAction={hideTooltip}
            />
          </div>
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
              zoomLevel={zoomLevel}
              timelineWidth={timelineWidth}
              trackHeight={skillTrackHeight}
              maxTime={maxTime}
              selectedCastEventId={selectedCastEventId}
              draggingEventPosition={draggingEventPosition}
              scrollLeft={clampedScrollLeft}
              scrollTop={clampedScrollTop}
              bgLayerRef={mainBgLayerRef}
              eventLayerRef={mainEventLayerRef}
              overlayLayerRef={mainOverlayLayerRef}
              hoverTrackIndex={hoverTrackIndex}
              hoverTimeX={hoverTime != null ? hoverTime * zoomLevel : null}
              onSelectCastEvent={handleSelectCastEvent}
              onUpdateCastEvent={handleCastEventDragEnd}
              onContextMenu={handleContextMenu}
              onDoubleClickTrack={handleDoubleClickTrack}
              onHoverAction={handleHoverAction}
              onClickAction={handleClickAction}
              isReadOnly={isReadOnly}
            />
          </Stage>
        </div>
      </div>

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
          // 停止正在进行的惯性动画（修复 3：minimap 点击不停惯性）
          if (inertiaRafIdRef.current !== null) {
            cancelAnimationFrame(inertiaRafIdRef.current)
            inertiaRafIdRef.current = null
          }
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
        onClose={handleContextMenuClose}
        onDeleteCast={removeCastEvent}
        onAddCast={handleContextMenuAddCast}
        onCopyDamageEventText={handleCopyDamageEventText}
        onCopyDamageEvent={handleContextMenuCopyDamageEvent}
        onDeleteDamageEvent={removeDamageEvent}
        onAddDamageEvent={handleContextMenuAddDamageEvent}
        onPasteDamageEvent={handleContextMenuPasteDamageEvent}
      />
    </div>
  )
}
