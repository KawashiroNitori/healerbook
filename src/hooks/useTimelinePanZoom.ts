/**
 * 时间轴平移/缩放交互 Hook
 * 统一使用 PointerEvent 处理鼠标和触摸的平移操作
 *
 * 性能优化：拖动和惯性动画期间通过 onDirectScroll 直接更新 Konva Layer 位置，
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
  inertiaRafIdRef: RefObject<number | null>
}

interface PanZoomOptions {
  enableVerticalScroll: boolean
  isReadOnly: boolean
  setScrollLeft: Dispatch<SetStateAction<number>>
  setScrollTop: Dispatch<SetStateAction<number>>
  /** 直接更新 Konva 图层位置的回调，绕过 React 渲染 */
  onDirectScroll?: (scrollLeft: number, scrollTop: number) => void
}

/** 惯性参数 */
const FRICTION = 0.92 // 每帧速度衰减系数
const MIN_VELOCITY = 0.5 // 低于此速度停止动画（px/frame）

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
      inertiaRafIdRef,
    } = refs

    // --- 惯性状态 ---
    let velocityX = 0
    let velocityY = 0
    let lastMoveTime = 0
    let lastClientX = 0
    let lastClientY = 0
    // 直接滚动模式下的本地滚动位置追踪
    let localScrollLeft = 0
    let localScrollTop = 0

    const clampScrollLeft = (value: number) =>
      Math.min(maxScrollLeftRef.current, Math.max(minScrollLeftRef.current, value))

    const clampScrollTop = (value: number) => Math.min(maxScrollTopRef.current, Math.max(0, value))

    const stopInertia = () => {
      if (inertiaRafIdRef.current !== null) {
        cancelAnimationFrame(inertiaRafIdRef.current)
        inertiaRafIdRef.current = null
      }
    }

    /** 将本地滚动位置同步到 React state */
    const syncToReactState = () => {
      setScrollLeft(localScrollLeft)
      if (enableVerticalScroll) {
        setScrollTop(localScrollTop)
      }
    }

    const startInertia = () => {
      stopInertia()
      const tick = () => {
        velocityX *= FRICTION
        velocityY *= FRICTION
        if (Math.abs(velocityX) < MIN_VELOCITY && Math.abs(velocityY) < MIN_VELOCITY) {
          inertiaRafIdRef.current = null
          // 惯性结束，同步到 React state
          if (onDirectScroll) {
            syncToReactState()
          }
          return
        }

        if (onDirectScroll) {
          localScrollLeft = clampScrollLeft(localScrollLeft + velocityX)
          if (enableVerticalScroll) {
            localScrollTop = clampScrollTop(localScrollTop + velocityY)
          }
          const effectiveScrollTop = enableVerticalScroll
            ? localScrollTop
            : clampedScrollRef.current.scrollTop
          clampedScrollRef.current = { scrollLeft: localScrollLeft, scrollTop: effectiveScrollTop }
          onDirectScroll(localScrollLeft, effectiveScrollTop)
        } else {
          setScrollLeft(prev =>
            Math.min(maxScrollLeftRef.current, Math.max(minScrollLeftRef.current, prev + velocityX))
          )
          if (enableVerticalScroll) {
            setScrollTop(prev => clampScrollTop(prev + velocityY))
          }
        }
        inertiaRafIdRef.current = requestAnimationFrame(tick)
      }
      inertiaRafIdRef.current = requestAnimationFrame(tick)
    }

    // --- Konva pointerdown: 单点按下开始平移 ---
    const handlePointerDown = (e: KonvaMouseEvent) => {
      const evt = e.evt as PointerEvent

      // 已有活跃指针时忽略额外的触摸点
      if (activePointerIdRef.current !== null) return

      // 停止正在进行的惯性动画
      stopInertia()

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
      // 初始化速度跟踪和本地滚动位置
      velocityX = 0
      velocityY = 0
      lastMoveTime = performance.now()
      lastClientX = evt.clientX
      lastClientY = evt.clientY
      localScrollLeft = clampedScrollRef.current.scrollLeft
      localScrollTop = visualScrollTopRef.current
    }

    // --- Window pointermove: 单点拖动平移 ---
    const handlePointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current || e.pointerId !== activePointerIdRef.current) return
      hasMovedRef.current = true
      panJustEndedRef.current = true

      // 计算瞬时速度（px/frame，约 16ms）
      const now = performance.now()
      const dt = now - lastMoveTime
      if (dt > 0) {
        const rawVx = ((lastClientX - e.clientX) / dt) * 16
        const rawVy = ((lastClientY - e.clientY) / dt) * 16
        // 用指数移动平均平滑速度，避免最后一帧突变
        velocityX = velocityX * 0.3 + rawVx * 0.7
        velocityY = velocityY * 0.3 + rawVy * 0.7
      }
      lastMoveTime = now
      lastClientX = e.clientX
      lastClientY = e.clientY

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

      // 如果最后一次 move 距离太久（手指停住再松开），不启动惯性
      const shouldStartInertia = didMove && performance.now() - lastMoveTime < 100
      if (shouldStartInertia) {
        startInertia()
      } else if (onDirectScroll && didMove) {
        // 没有惯性，同步最终位置到 React state
        syncToReactState()
      }
    }

    // --- Wheel: Ctrl+滚轮缩放 / 普通滚轮平移 ---
    const handleWheel = (e: WheelEvent) => {
      stopInertia()
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
          // 以 clampedScrollRef 为基准（惯性期间与视觉位置同步），避免跳回旧 React state
          localScrollLeft = clampScrollLeft(clampedScrollRef.current.scrollLeft + scrollDelta)
          const effectiveScrollTop = clampedScrollRef.current.scrollTop
          clampedScrollRef.current = { scrollLeft: localScrollLeft, scrollTop: effectiveScrollTop }
          onDirectScroll(localScrollLeft, effectiveScrollTop)
          setScrollLeft(localScrollLeft)
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
      stopInertia()
      stage.off('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      stage.container().removeEventListener('wheel', handleWheel)
    }
    // refs 和 store 方法引用稳定，不需要作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageRef, isReadOnly, enableVerticalScroll])
}
