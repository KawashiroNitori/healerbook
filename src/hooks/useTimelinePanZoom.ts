/**
 * 时间轴平移/缩放交互 Hook
 * 统一处理鼠标、触摸、滚轮的平移和缩放操作
 */

import type { RefObject, Dispatch, SetStateAction } from 'react'
import { useEffect } from 'react'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useTimelineStore } from '@/store/timelineStore'
import { useTooltipStore } from '@/store/tooltipStore'
import type { KonvaMouseEvent, KonvaNode } from '@/types/konva'

export interface PanZoomRefs {
  isDraggingRef: RefObject<boolean>
  dragStartRef: RefObject<{ x: number; y: number; scrollLeft: number; scrollTop: number }>
  maxScrollLeftRef: RefObject<number>
  minScrollLeftRef: RefObject<number>
  clampedScrollRef: RefObject<{ scrollLeft: number; scrollTop: number }>
  clickedBackgroundRef: RefObject<boolean>
  hasMovedRef: RefObject<boolean>
  panJustEndedRef: RefObject<boolean>
  lastPanEndTimeRef: RefObject<number>
  isPinchingRef: RefObject<boolean>
  lastPinchDistanceRef: RefObject<number | null>
  pinchStartZoomRef: RefObject<number>
  pinchCenterXRef: RefObject<number>
}

interface PanZoomOptions {
  enableVerticalScroll: boolean
  isReadOnly: boolean
  setScrollLeft: Dispatch<SetStateAction<number>>
  setScrollTop: Dispatch<SetStateAction<number>>
}

// --- Touch helpers (多点触摸必须保留 TouchEvent) ---

function getTouchDistance(evt: TouchEvent): number | null {
  if (evt.touches.length < 2) return null
  const touch1 = evt.touches[0]
  const touch2 = evt.touches[1]
  return Math.abs(touch2.clientX - touch1.clientX)
}

function getTouchCenter(evt: TouchEvent): number | null {
  if (evt.touches.length < 2) return null
  const touch1 = evt.touches[0]
  const touch2 = evt.touches[1]
  return (touch1.clientX + touch2.clientX) / 2
}

export function useTimelinePanZoom(
  stageRef: RefObject<Konva.Stage | null>,
  refs: PanZoomRefs,
  options: PanZoomOptions
) {
  const { enableVerticalScroll, isReadOnly, setScrollLeft, setScrollTop } = options

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const {
      isDraggingRef,
      dragStartRef,
      maxScrollLeftRef,
      minScrollLeftRef,
      clampedScrollRef,
      clickedBackgroundRef,
      hasMovedRef,
      panJustEndedRef,
      lastPanEndTimeRef,
      isPinchingRef,
      lastPinchDistanceRef,
      pinchStartZoomRef,
      pinchCenterXRef,
    } = refs

    // --- Konva pointerdown: 单点按下开始平移 ---
    const handlePointerDown = (e: KonvaMouseEvent) => {
      const evt = e.evt as PointerEvent

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
      clickedBackgroundRef.current = clickedOnBackground
      hasMovedRef.current = false
      isDraggingRef.current = true
      dragStartRef.current = {
        x: evt.clientX,
        y: evt.clientY,
        scrollLeft: clampedScrollRef.current.scrollLeft,
        scrollTop: clampedScrollRef.current.scrollTop,
      }
    }

    // --- Window pointermove: 单点拖动平移 ---
    const handlePointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return
      hasMovedRef.current = true
      panJustEndedRef.current = true
      const deltaX = dragStartRef.current.x - e.clientX
      setScrollLeft(Math.max(minScrollLeftRef.current, dragStartRef.current.scrollLeft + deltaX))
      if (enableVerticalScroll) {
        const deltaY = dragStartRef.current.y - e.clientY
        setScrollTop(Math.max(0, dragStartRef.current.scrollTop + deltaY))
      }
    }

    // --- Window pointerup: 单点抬起结束平移 ---
    const handlePointerUp = () => {
      if (!isDraggingRef.current) return
      // 只有在点击背景且没有拖动时才取消选中
      if (clickedBackgroundRef.current && !hasMovedRef.current) {
        const { selectEvent, selectCastEvent } = useTimelineStore.getState()
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

    // --- Touch: 双指缩放（必须保留 TouchEvent 以访问多点坐标） ---
    const handleTouchStart = (e: KonvaEventObject<TouchEvent>) => {
      const evt = e.evt
      if (evt.touches.length !== 2) return
      evt.preventDefault()
      isPinchingRef.current = true
      isDraggingRef.current = false
      lastPinchDistanceRef.current = getTouchDistance(evt)
      pinchStartZoomRef.current = useTimelineStore.getState().zoomLevel
      const centerX = getTouchCenter(evt)
      if (centerX !== null) {
        pinchCenterXRef.current = centerX
      }
    }

    const handleTouchMove = (e: KonvaEventObject<TouchEvent>) => {
      const evt = e.evt
      if (!isPinchingRef.current || evt.touches.length !== 2) return
      evt.preventDefault()
      const currentDistance = getTouchDistance(evt)
      if (!currentDistance || !lastPinchDistanceRef.current) return

      const scale = currentDistance / lastPinchDistanceRef.current
      const newZoomLevel = Math.max(10, Math.min(200, pinchStartZoomRef.current * scale))

      const oldZoom = useTimelineStore.getState().zoomLevel
      const centerX = pinchCenterXRef.current
      const timeAtCenter = (clampedScrollRef.current.scrollLeft + centerX) / oldZoom

      const { setZoomLevel } = useTimelineStore.getState()
      setZoomLevel(newZoomLevel)
      const newScrollLeft = timeAtCenter * newZoomLevel - centerX
      setScrollLeft(Math.max(minScrollLeftRef.current, newScrollLeft))
    }

    const handleTouchEnd = () => {
      if (!isPinchingRef.current) return
      isPinchingRef.current = false
      lastPinchDistanceRef.current = null
    }

    // --- Wheel: Ctrl+滚轮缩放 / 普通滚轮平移 ---
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()

        const delta = e.deltaY > 0 ? -5 : 5
        const oldZoom = useTimelineStore.getState().zoomLevel
        const newZoom = Math.max(10, Math.min(200, oldZoom + delta))
        if (newZoom === oldZoom) return

        const mouseX = e.offsetX
        const timeAtMouse = (clampedScrollRef.current.scrollLeft + mouseX) / oldZoom
        const { setZoomLevel } = useTimelineStore.getState()
        setZoomLevel(newZoom)
        setScrollLeft(timeAtMouse * newZoom - mouseX)
      } else {
        e.preventDefault()
        const scrollDelta = e.deltaX !== 0 ? e.deltaX : e.deltaY
        setScrollLeft(prev =>
          Math.min(maxScrollLeftRef.current, Math.max(minScrollLeftRef.current, prev + scrollDelta))
        )
      }
    }

    // --- 绑定事件 ---
    stage.on('pointerdown', handlePointerDown)
    stage.on('touchstart', handleTouchStart)
    stage.on('touchmove', handleTouchMove)
    stage.on('touchend', handleTouchEnd)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    stage.container().addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      stage.off('pointerdown', handlePointerDown)
      stage.off('touchstart', handleTouchStart)
      stage.off('touchmove', handleTouchMove)
      stage.off('touchend', handleTouchEnd)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      stage.container().removeEventListener('wheel', handleWheel)
    }
    // refs 和 store 方法引用稳定，不需要作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageRef, isReadOnly, enableVerticalScroll])
}
