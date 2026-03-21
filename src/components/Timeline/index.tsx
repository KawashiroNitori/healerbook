/**
 * 时间轴 Canvas 主组件（重构版）
 */

import { useRef, useEffect, useState } from 'react'
import { Stage, Layer } from 'react-konva'
import type Konva from 'konva'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useTooltipStore } from '@/store/tooltipStore'
import { useUIStore } from '@/store/uiStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { sortJobsByOrder } from '@/data/jobs'
import { toast } from 'sonner'
import ConfirmDialog from '../ConfirmDialog'
import TimeRuler from './TimeRuler'
import DamageEventTrack from './DamageEventTrack'
import SkillTrackLabels from './SkillTrackLabels'
import SkillTracksCanvas from './SkillTracksCanvas'
import TimelineMinimap from './TimelineMinimap'
import type { SkillTrack } from './SkillTrackLabels'
import type { CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { KonvaMouseEvent, KonvaNode } from '@/types/konva'
import type { KonvaEventObject } from 'konva/lib/Node'

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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [castEventToDelete, setCastEventToDelete] = useState<string | null>(null)
  const [draggingEventPosition, setDraggingEventPosition] = useState<{
    eventId: string
    x: number
  } | null>(null)
  // 虚拟滚动状态
  const [scrollLeft, setScrollLeft] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  // 拖动状态
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 })
  const maxScrollLeftRef = useRef(0)
  const clampedScrollRef = useRef({ scrollLeft: 0, scrollTop: 0 })
  // 记录是否点击了背景（用于区分点击和拖动）
  const clickedBackgroundRef = useRef(false)
  const hasMovedRef = useRef(false)
  // 平移刚结束标记：mouseup 时设 true，同帧 click 可见；requestAnimationFrame 自动清除
  const panJustEndedRef = useRef(false)
  const lastPanEndTimeRef = useRef(0) // 记录最后一次平移结束的时间戳，用于阻止 dblclick
  // 双指缩放状态
  const isPinchingRef = useRef(false)
  const lastPinchDistanceRef = useRef<number | null>(null)
  const pinchStartZoomRef = useRef<number>(50)
  const pinchCenterXRef = useRef<number>(0) // 双指中心点的屏幕坐标

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
    zoomWithScrollPreservation,
  } = useTimelineStore()
  const { actions, loadActions } = useMitigationStore()
  const { hiddenPlayerIds } = useUIStore()

  useEffect(() => {
    if (actions.length === 0) {
      loadActions()
    }
  }, [actions.length, loadActions])
  const { showTooltip, toggleTooltip, hideTooltip } = useTooltipStore()
  const isReadOnly = useEditorReadOnly()

  // 布局常量
  const timeRulerHeight = 30
  const skillTrackHeight = 40
  const labelColumnWidth = 70
  const minimapHeight = 80 + 16 + 1 // canvas(80) + p-2 padding(16) + border-t(1)

  // 计算布局数据
  const layoutData = timeline
    ? (() => {
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
        const timelineWidth = maxTime * zoomLevel
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
      })()
    : null

  // 视口宽度（Stage 实际宽度）
  const viewportWidth = Math.max(width - labelColumnWidth, 1)
  // 限制 scrollLeft 不超出范围
  const maxScrollLeft = layoutData ? Math.max(0, layoutData.timelineWidth - viewportWidth) : 0
  const clampedScrollLeft = Math.min(scrollLeft, maxScrollLeft)
  const maxScrollTop = layoutData
    ? Math.max(
        0,
        layoutData.skillTracksHeight - (height - layoutData.fixedAreaHeight - minimapHeight)
      )
    : 0
  const clampedScrollTop = Math.min(scrollTop, maxScrollTop)

  // 当 zoomLevel 变化时，根据保存的滚动进度还原位置
  useEffect(() => {
    if (pendingScrollProgress !== null && layoutData) {
      const newMaxScroll = Math.max(0, layoutData.timelineWidth - viewportWidth)
      const newScrollLeft = pendingScrollProgress * newMaxScroll

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
    clampedScrollRef.current = { scrollLeft: clampedScrollLeft, scrollTop: clampedScrollTop }
    scrollLeftRef.current = scrollLeft
    scrollTopRef.current = scrollTop
  }, [maxScrollLeft, clampedScrollLeft, clampedScrollTop, scrollLeft, scrollTop])

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

  // 处理键盘删除
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isReadOnly) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEventId) {
          removeDamageEvent(selectedEventId)
        } else if (selectedCastEventId) {
          removeCastEvent(selectedCastEventId)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEventId, selectedCastEventId, removeDamageEvent, removeCastEvent, isReadOnly])

  // 处理顶部固定区域的 Stage 事件
  useEffect(() => {
    const stage = fixedStageRef.current
    if (!stage) return

    const getClientPosition = (evt: MouseEvent | TouchEvent) => {
      if ('touches' in evt && evt.touches.length > 0) {
        return { clientX: evt.touches[0].clientX, clientY: evt.touches[0].clientY }
      }
      return { clientX: (evt as MouseEvent).clientX, clientY: (evt as MouseEvent).clientY }
    }

    const getTouchDistance = (evt: TouchEvent) => {
      if (evt.touches.length < 2) return null
      const touch1 = evt.touches[0]
      const touch2 = evt.touches[1]
      const dx = Math.abs(touch2.clientX - touch1.clientX)
      return dx
    }

    const getTouchCenter = (evt: TouchEvent) => {
      if (evt.touches.length < 2) return null
      const touch1 = evt.touches[0]
      const touch2 = evt.touches[1]
      return (touch1.clientX + touch2.clientX) / 2
    }

    const handleStagePointerDown = (e: KonvaMouseEvent) => {
      const evt = e.evt

      // 检测双指触摸
      if ('touches' in evt && (evt as unknown as TouchEvent).touches.length === 2) {
        e.evt.preventDefault()
        isPinchingRef.current = true
        isDraggingRef.current = false
        lastPinchDistanceRef.current = getTouchDistance(evt as unknown as TouchEvent)
        pinchStartZoomRef.current = zoomLevel
        const centerX = getTouchCenter(evt as unknown as TouchEvent)
        if (centerX !== null) {
          pinchCenterXRef.current = centerX
        }
        return
      }

      // 鼠标按下时立即隐藏悬浮窗
      useTooltipStore.getState().clearTooltip()

      const target = e.target as KonvaNode
      if (!isReadOnly) {
        let node = target
        while (node && node !== stage) {
          if (node.attrs?.draggable) return
          node = node.parent as KonvaNode
        }
      }
      const clickedOnBackground = target === stage || target.attrs?.draggableBackground === true
      // 走到这里说明没有找到可拖动节点（或只读模式），统一触发时间轴平移
      clickedBackgroundRef.current = clickedOnBackground
      hasMovedRef.current = false
      isDraggingRef.current = true
      const { clientX, clientY } = getClientPosition(evt)
      dragStartRef.current = {
        x: clientX,
        y: clientY,
        scrollLeft: clampedScrollRef.current.scrollLeft,
        scrollTop: clampedScrollRef.current.scrollTop,
      }
    }

    const handleStagePointerMove = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      const evt = e.evt

      // 处理双指缩放
      if (
        isPinchingRef.current &&
        'touches' in evt &&
        (evt as unknown as TouchEvent).touches.length === 2
      ) {
        e.evt.preventDefault()
        const currentDistance = getTouchDistance(evt as unknown as TouchEvent)
        if (currentDistance && lastPinchDistanceRef.current) {
          const scale = currentDistance / lastPinchDistanceRef.current
          const newZoomLevel = Math.max(10, Math.min(200, pinchStartZoomRef.current * scale))

          // 计算缩放中心点在时间轴上的时间位置
          const oldZoom = zoomLevel
          const centerX = pinchCenterXRef.current
          const timeAtCenter = (clampedScrollRef.current.scrollLeft + centerX) / oldZoom

          // 更新缩放级别
          setZoomLevel(newZoomLevel)

          // 调整���动位置，使缩放中心点保持在相同的屏幕位置
          const newScrollLeft = timeAtCenter * newZoomLevel - centerX
          setScrollLeft(Math.max(0, newScrollLeft))
        }
        return
      }

      if (!isDraggingRef.current) return
      hasMovedRef.current = true
      panJustEndedRef.current = true
      const { clientX } = getClientPosition(evt)
      const deltaX = dragStartRef.current.x - clientX
      setScrollLeft(Math.max(0, dragStartRef.current.scrollLeft + deltaX))
    }

    const handleStagePointerUp = () => {
      // 只有在点击背景且没有拖动时才取消选中
      if (clickedBackgroundRef.current && !hasMovedRef.current) {
        selectEvent(null)
        selectCastEvent(null)
      }
      isDraggingRef.current = false
      clickedBackgroundRef.current = false
      if (hasMovedRef.current) {
        lastPanEndTimeRef.current = Date.now()
        requestAnimationFrame(() => {
          panJustEndedRef.current = false
        })
      }
      hasMovedRef.current = false
      isPinchingRef.current = false
      lastPinchDistanceRef.current = null
    }

    const handleNativeWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()

        const delta = e.deltaY > 0 ? -5 : 5
        zoomWithScrollPreservation(delta)
      } else {
        e.preventDefault()
        // 支持触摸板横向滚动（deltaX）和纵向滚轮转横向（deltaY）
        const scrollDelta = e.deltaX !== 0 ? e.deltaX : e.deltaY
        setScrollLeft(prev => Math.min(maxScrollLeftRef.current, Math.max(0, prev + scrollDelta)))
      }
    }

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      handleStagePointerMove({ evt: e } as unknown as KonvaEventObject<MouseEvent | TouchEvent>)
    }
    const handleWindowMouseUp = () => {
      if (isDraggingRef.current) handleStagePointerUp()
    }

    stage.on('mousedown touchstart', handleStagePointerDown)
    stage.on('touchmove', handleStagePointerMove)
    stage.on('touchend', handleStagePointerUp)
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)
    stage.container().addEventListener('wheel', handleNativeWheel, { passive: false })

    return () => {
      stage.off('mousedown touchstart', handleStagePointerDown)
      stage.off('touchmove', handleStagePointerMove)
      stage.off('touchend', handleStagePointerUp)
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
      stage.container().removeEventListener('wheel', handleNativeWheel)
    }
    // zoomWithScrollPreservation 来自 Zustand store，引用稳定，不需要作为依赖
    // 添加它会导致事件监听器频繁重新绑定，影响性能
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, isReadOnly, scrollLeft, scrollTop])

  // 处理技能轨道 Stage 事件
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const getClientPosition = (evt: MouseEvent | TouchEvent) => {
      if ('touches' in evt && evt.touches.length > 0) {
        return { clientX: evt.touches[0].clientX, clientY: evt.touches[0].clientY }
      }
      return { clientX: (evt as MouseEvent).clientX, clientY: (evt as MouseEvent).clientY }
    }

    const getTouchDistance = (evt: TouchEvent) => {
      if (evt.touches.length < 2) return null
      const touch1 = evt.touches[0]
      const touch2 = evt.touches[1]
      const dx = Math.abs(touch2.clientX - touch1.clientX)
      return dx
    }

    const getTouchCenter = (evt: TouchEvent) => {
      if (evt.touches.length < 2) return null
      const touch1 = evt.touches[0]
      const touch2 = evt.touches[1]
      return (touch1.clientX + touch2.clientX) / 2
    }

    const handleStagePointerDown = (e: KonvaMouseEvent) => {
      const evt = e.evt

      // 检测双指触摸
      if ('touches' in evt && (evt as unknown as TouchEvent).touches.length === 2) {
        e.evt.preventDefault()
        isPinchingRef.current = true
        isDraggingRef.current = false
        lastPinchDistanceRef.current = getTouchDistance(evt as unknown as TouchEvent)
        pinchStartZoomRef.current = zoomLevel
        const centerX = getTouchCenter(evt as unknown as TouchEvent)
        if (centerX !== null) {
          pinchCenterXRef.current = centerX
        }
        return
      }

      // 鼠标按下时立即隐藏悬浮窗
      useTooltipStore.getState().clearTooltip()

      const target = e.target as KonvaNode
      if (!isReadOnly) {
        let node = target
        while (node && node !== stage) {
          if (node.attrs?.draggable) return
          node = node.parent as KonvaNode
        }
      }
      // 走到这里说明没有找到可拖动节点（或只读模式），统一触发时间轴平移
      const clickedOnBackground = target === stage || target.attrs?.draggableBackground === true
      clickedBackgroundRef.current = clickedOnBackground
      hasMovedRef.current = false
      isDraggingRef.current = true
      const { clientX, clientY } = getClientPosition(evt)
      dragStartRef.current = {
        x: clientX,
        y: clientY,
        scrollLeft: clampedScrollRef.current.scrollLeft,
        scrollTop: clampedScrollRef.current.scrollTop,
      }
    }

    const handleStagePointerMove = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      const evt = e.evt

      // 处理双指缩放
      if (
        isPinchingRef.current &&
        'touches' in evt &&
        (evt as unknown as TouchEvent).touches.length === 2
      ) {
        e.evt.preventDefault()
        const currentDistance = getTouchDistance(evt as unknown as TouchEvent)
        if (currentDistance && lastPinchDistanceRef.current) {
          const scale = currentDistance / lastPinchDistanceRef.current
          const newZoomLevel = Math.max(10, Math.min(200, pinchStartZoomRef.current * scale))

          // 计算缩放中心点在时间轴上的时间位置
          const oldZoom = zoomLevel
          const centerX = pinchCenterXRef.current
          const timeAtCenter = (clampedScrollRef.current.scrollLeft + centerX) / oldZoom

          // 更新缩放级别
          setZoomLevel(newZoomLevel)

          // 调整滚动位置，使缩放中心点保持在相同的屏幕位置
          const newScrollLeft = timeAtCenter * newZoomLevel - centerX
          setScrollLeft(Math.max(0, newScrollLeft))
        }
        return
      }

      if (!isDraggingRef.current) return
      hasMovedRef.current = true
      panJustEndedRef.current = true
      const { clientX, clientY } = getClientPosition(evt)
      const deltaX = dragStartRef.current.x - clientX
      const deltaY = dragStartRef.current.y - clientY
      setScrollLeft(Math.max(0, dragStartRef.current.scrollLeft + deltaX))
      setScrollTop(Math.max(0, dragStartRef.current.scrollTop + deltaY))
    }

    const handleStagePointerUp = () => {
      // 只有在点击背景且没有拖动时才取消选中
      if (clickedBackgroundRef.current && !hasMovedRef.current) {
        selectEvent(null)
        selectCastEvent(null)
      }
      isDraggingRef.current = false
      clickedBackgroundRef.current = false
      if (hasMovedRef.current) {
        lastPanEndTimeRef.current = Date.now()
        requestAnimationFrame(() => {
          panJustEndedRef.current = false
        })
      }
      hasMovedRef.current = false
      isPinchingRef.current = false
      lastPinchDistanceRef.current = null
    }

    const handleNativeWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()

        const delta = e.deltaY > 0 ? -5 : 5
        zoomWithScrollPreservation(delta)
      } else {
        e.preventDefault()
        // 支持触摸板横向滚动（deltaX）和纵向滚轮转横向（deltaY）
        const scrollDelta = e.deltaX !== 0 ? e.deltaX : e.deltaY
        setScrollLeft(prev => Math.min(maxScrollLeftRef.current, Math.max(0, prev + scrollDelta)))
      }
    }

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      handleStagePointerMove({ evt: e } as unknown as KonvaEventObject<MouseEvent | TouchEvent>)
    }
    const handleWindowMouseUp = () => {
      if (isDraggingRef.current) handleStagePointerUp()
    }

    stage.on('mousedown touchstart', handleStagePointerDown)
    stage.on('touchmove', handleStagePointerMove)
    stage.on('touchend', handleStagePointerUp)
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)
    stage.container().addEventListener('wheel', handleNativeWheel, { passive: false })

    return () => {
      stage.off('mousedown touchstart', handleStagePointerDown)
      stage.off('touchmove', handleStagePointerMove)
      stage.off('touchend', handleStagePointerUp)
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
      stage.container().removeEventListener('wheel', handleNativeWheel)
    }
    // zoomWithScrollPreservation 来自 Zustand store，引用稳定，不需要作为依赖
    // 添加它会导致事件监听器频繁重新绑定，影响性能
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, isReadOnly, scrollLeft, scrollTop])

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
    const newTime = Math.max(0, Math.round((x / zoomLevel) * 10) / 10)
    const { updateDamageEvent } = useTimelineStore.getState()
    updateDamageEvent(eventId, { time: newTime })
    setDraggingEventPosition(null)
  }

  // 处理技能使用事件拖动
  const handleCastEventDragEnd = (castEventId: string, x: number) => {
    if (isReadOnly) return
    const newTime = Math.max(0, Math.round((x / zoomLevel) * 10) / 10)
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
            <Layer x={-clampedScrollLeft}>
              <TimeRuler
                maxTime={maxTime}
                zoomLevel={zoomLevel}
                timelineWidth={timelineWidth}
                height={timeRulerHeight}
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
                isReadOnly={isReadOnly}
              />
            </Layer>
          </Stage>
        </div>
      </div>

      {/* 可滚动区域：技能轨道 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧技能标签 */}
        <div
          className="flex-shrink-0 border-r bg-background overflow-hidden"
          style={{ width: labelColumnWidth }}
          onWheel={e => {
            e.preventDefault()
            setScrollTop(prev => Math.max(0, Math.min(prev + e.deltaY, maxScrollTop)))
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
              onSelectCastEvent={handleSelectCastEvent}
              onUpdateCastEvent={handleCastEventDragEnd}
              onContextMenu={castEventId => {
                setCastEventToDelete(castEventId)
                setDeleteConfirmOpen(true)
              }}
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

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        onConfirm={() => {
          if (castEventToDelete) {
            removeCastEvent(castEventToDelete)
            setCastEventToDelete(null)
          }
        }}
        title="删除技能使用"
        description="确定要删除这个技能使用吗?"
      />
    </div>
  )
}
