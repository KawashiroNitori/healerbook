/**
 * 垂直滚动条组件 — 用于技能轨道区域的垂直滚动
 * 支持命令式 updateScrollTop() 以在拖动/惯性动画期间绕过 React 渲染
 */

import { useRef, useCallback, forwardRef, useImperativeHandle } from 'react'

interface VerticalScrollbarProps {
  /** 滚动条轨道的可见高度 */
  viewportHeight: number
  /** 内容总高度 */
  contentHeight: number
  /** 当前滚动位置 */
  scrollTop: number
  /** 最大滚动值 */
  maxScrollTop: number
  /** 滚动回调 */
  onScroll: (scrollTop: number) => void
  /** 滚动条宽度 */
  width?: number
}

export interface VerticalScrollbarHandle {
  /** 直接更新 thumb 位置（绕过 React 渲染） */
  updateScrollTop: (scrollTop: number) => void
}

export const SCROLLBAR_WIDTH = 10

export default forwardRef<VerticalScrollbarHandle, VerticalScrollbarProps>(
  function VerticalScrollbar(
    { viewportHeight, contentHeight, scrollTop, maxScrollTop, onScroll, width = SCROLLBAR_WIDTH },
    ref
  ) {
    const trackRef = useRef<HTMLDivElement>(null)
    const thumbRef = useRef<HTMLDivElement>(null)
    const isDraggingRef = useRef(false)
    const dragStartYRef = useRef(0)
    const dragStartScrollTopRef = useRef(0)

    // thumb 高度：视口占内容的比例，最小 20px
    const thumbRatio = contentHeight > 0 ? viewportHeight / contentHeight : 1
    const thumbHeight = Math.max(20, viewportHeight * thumbRatio)

    // thumb 可移动的轨道范围
    const trackRange = viewportHeight - thumbHeight

    // thumb 位置
    const thumbTop = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * trackRange : 0

    // 命令式更新：直接操作 DOM，不触发 React 渲染
    useImperativeHandle(
      ref,
      () => ({
        updateScrollTop: (newScrollTop: number) => {
          if (!thumbRef.current) return
          const newThumbTop = maxScrollTop > 0 ? (newScrollTop / maxScrollTop) * trackRange : 0
          thumbRef.current.style.top = `${newThumbTop}px`
        },
      }),
      [maxScrollTop, trackRange]
    )

    const handlePointerDown = useCallback(
      (e: React.PointerEvent) => {
        e.preventDefault()
        e.stopPropagation()
        isDraggingRef.current = true
        dragStartYRef.current = e.clientY
        dragStartScrollTopRef.current = scrollTop
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      },
      [scrollTop]
    )

    const handlePointerMove = useCallback(
      (e: React.PointerEvent) => {
        if (!isDraggingRef.current) return
        e.preventDefault()
        const deltaY = e.clientY - dragStartYRef.current
        const scrollDelta = trackRange > 0 ? (deltaY / trackRange) * maxScrollTop : 0
        const newScrollTop = Math.max(
          0,
          Math.min(dragStartScrollTopRef.current + scrollDelta, maxScrollTop)
        )
        onScroll(newScrollTop)
      },
      [maxScrollTop, trackRange, onScroll]
    )

    const handlePointerUp = useCallback((e: React.PointerEvent) => {
      isDraggingRef.current = false
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    }, [])

    const handleTrackClick = useCallback(
      (e: React.MouseEvent) => {
        if (!trackRef.current) return
        const rect = trackRef.current.getBoundingClientRect()
        const clickY = e.clientY - rect.top
        const targetThumbTop = clickY - thumbHeight / 2
        const ratio = trackRange > 0 ? Math.max(0, Math.min(targetThumbTop / trackRange, 1)) : 0
        onScroll(ratio * maxScrollTop)
      },
      [thumbHeight, trackRange, maxScrollTop, onScroll]
    )

    // 不需要滚动条时不渲染
    if (maxScrollTop <= 0 || contentHeight <= viewportHeight) {
      return null
    }

    return (
      <div
        ref={trackRef}
        className="absolute left-0 top-0 z-10"
        style={{ width, height: viewportHeight }}
        onClick={handleTrackClick}
      >
        <div
          ref={thumbRef}
          className="absolute left-0.5 right-0.5 rounded-full bg-muted-foreground/30 hover:bg-muted-foreground/50 transition-colors cursor-pointer"
          style={{
            top: thumbTop,
            height: thumbHeight,
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onClick={e => e.stopPropagation()}
        />
      </div>
    )
  }
)
