/**
 * 时间轴平移/缩放交互 Hook
 * 统一使用 PointerEvent 处理鼠标和触摸的平移操作
 *
 * 性能优化：拖动期间通过 onDirectScroll 直接更新 Konva Layer 位置，
 * 绕过 React 渲染循环，仅在操作结束时同步 React state。
 */

import type { RefObject, Dispatch, SetStateAction } from 'react'
import { useEffect } from 'react'
import type Konva from 'konva'
import { useTimelineStore } from '@/store/timelineStore'
import { useTooltipStore } from '@/store/tooltipStore'
import type { KonvaMouseEvent, KonvaNode } from '@/types/konva'

export interface PanZoomRefs {
  isDraggingRef: RefObject<boolean>
  activePointerIdRef: RefObject<number | null>
  dragStartRef: RefObject<{ x: number; y: number; scrollLeft: number; scrollTop: number }>
  maxScrollLeftRef: RefObject<number>
  minScrollLeftRef: RefObject<number>
  maxScrollTopRef: RefObject<number>
  clampedScrollRef: RefObject<{ scrollLeft: number; scrollTop: number }>
  /** 实际视觉滚动位置（仅由 handleDirectScroll 更新，不受 React state 影响） */
  visualScrollTopRef: RefObject<number>
  clickedBackgroundRef: RefObject<boolean>
  hasMovedRef: RefObject<boolean>
  panJustEndedRef: RefObject<boolean>
  lastPanEndTimeRef: RefObject<number>
}

interface PanZoomOptions {
  enableVerticalScroll: boolean
  isReadOnly: boolean
  setScrollLeft: Dispatch<SetStateAction<number>>
  setScrollTop: Dispatch<SetStateAction<number>>
  /** 直接更新 Konva 图层位置的回调，绕过 React 渲染 */
  onDirectScroll?: (scrollLeft: number, scrollTop: number) => void
}

export function useTimelinePanZoom(
  stageRef: RefObject<Konva.Stage | null>,
  refs: PanZoomRefs,
  options: PanZoomOptions
) {
  const { enableVerticalScroll, isReadOnly, setScrollLeft, setScrollTop, onDirectScroll } = options

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const {
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
    } = refs

    // 直接滚动模式下的本地滚动位置追踪
    let localScrollLeft = 0
    let localScrollTop = 0

    const clampScrollLeft = (value: number) =>
      Math.min(maxScrollLeftRef.current, Math.max(minScrollLeftRef.current, value))

    const clampScrollTop = (value: number) => Math.min(maxScrollTopRef.current, Math.max(0, value))

    /** 将本地滚动位置同步到 React state */
    const syncToReactState = () => {
      setScrollLeft(localScrollLeft)
      if (enableVerticalScroll) {
        setScrollTop(localScrollTop)
      }
    }

    // --- Konva pointerdown: 单点按下开始平移 ---
    const handlePointerDown = (e: KonvaMouseEvent) => {
      const evt = e.evt as PointerEvent

      // 已有活跃指针时忽略额外的触摸点
      if (activePointerIdRef.current !== null) return

      // 右键不触发拖动
      if (evt.button === 2) return

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
      activePointerIdRef.current = evt.pointerId
      dragStartRef.current = {
        x: evt.clientX,
        y: evt.clientY,
        scrollLeft: clampedScrollRef.current.scrollLeft,
        scrollTop: visualScrollTopRef.current,
      }
      localScrollLeft = clampedScrollRef.current.scrollLeft
      localScrollTop = visualScrollTopRef.current
    }

    // --- Window pointermove: 单点拖动平移 ---
    const handlePointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current || e.pointerId !== activePointerIdRef.current) return
      hasMovedRef.current = true
      panJustEndedRef.current = true

      const deltaX = dragStartRef.current.x - e.clientX
      const newScrollLeft = clampScrollLeft(dragStartRef.current.scrollLeft + deltaX)

      if (onDirectScroll) {
        localScrollLeft = newScrollLeft
        if (enableVerticalScroll) {
          const deltaY = dragStartRef.current.y - e.clientY
          localScrollTop = clampScrollTop(dragStartRef.current.scrollTop + deltaY)
        }
        // 不启用垂直滚动时，使用 clampedScrollRef 中的当前值，避免覆盖另一个 hook 实例写入的值
        const effectiveScrollTop = enableVerticalScroll
          ? localScrollTop
          : clampedScrollRef.current.scrollTop
        clampedScrollRef.current = { scrollLeft: localScrollLeft, scrollTop: effectiveScrollTop }
        onDirectScroll(localScrollLeft, effectiveScrollTop)
      } else {
        setScrollLeft(Math.max(minScrollLeftRef.current, dragStartRef.current.scrollLeft + deltaX))
        if (enableVerticalScroll) {
          setScrollTop(
            clampScrollTop(dragStartRef.current.scrollTop + (dragStartRef.current.y - e.clientY))
          )
        }
      }
    }

    // --- Window pointerup: 单点抬起结束平移 ---
    const handlePointerUp = (e: PointerEvent) => {
      if (!isDraggingRef.current || e.pointerId !== activePointerIdRef.current) return
      activePointerIdRef.current = null
      // 只有在点击背景且没有拖动时才取消选中
      if (clickedBackgroundRef.current && !hasMovedRef.current) {
        const { selectEvent, selectCastEvent } = useTimelineStore.getState()
        selectEvent(null)
        selectCastEvent(null)
      }
      isDraggingRef.current = false
      clickedBackgroundRef.current = false

      const didMove = hasMovedRef.current
      if (didMove) {
        lastPanEndTimeRef.current = Date.now()
        requestAnimationFrame(() => {
          panJustEndedRef.current = false
        })
      }
      hasMovedRef.current = false

      // 同步最终位置到 React state
      if (onDirectScroll && didMove) {
        syncToReactState()
      }
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
        if (onDirectScroll) {
          // 以 clampedScrollRef 为基准，避免跳回旧 React state
          localScrollLeft = clampScrollLeft(clampedScrollRef.current.scrollLeft + scrollDelta)
          // 用 visualScrollTopRef（由 handleDirectScroll 维护，始终正确），
          // 而非 clampedScrollRef.scrollTop（可能被 sync effect 用 stale React state 覆盖）
          const effectiveScrollTop = visualScrollTopRef.current
          clampedScrollRef.current = { scrollLeft: localScrollLeft, scrollTop: effectiveScrollTop }
          onDirectScroll(localScrollLeft, effectiveScrollTop)
          setScrollLeft(localScrollLeft)
          // 同步 scrollTop React state，防止后续 re-render 时 clampedScrollTop 用过时值
          setScrollTop(effectiveScrollTop)
        } else {
          setScrollLeft(prev =>
            Math.min(
              maxScrollLeftRef.current,
              Math.max(minScrollLeftRef.current, prev + scrollDelta)
            )
          )
        }
      }
    }

    // --- 绑定事件 ---
    stage.on('pointerdown', handlePointerDown)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    stage.container().addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      stage.off('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      stage.container().removeEventListener('wheel', handleWheel)
    }
    // refs 和 store 方法引用稳定，不需要作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageRef, isReadOnly, enableVerticalScroll])
}
