/**
 * 框选交互 Hook
 *
 * 管理框选矩形状态（容器屏幕坐标）与释放时的选区提交。
 * 命中判定委托给纯函数 computeMarqueeSelection；本 Hook 只负责坐标状态与
 * shift 累加 / 替换语义。对象 box 由调用方在提交时通过 buildObjects 即时构建，
 * 保证用的是当前滚动/缩放下的屏幕坐标。
 */

import { useCallback, useRef, useState } from 'react'
import { computeMarqueeSelection, type MarqueeObject } from './marqueeHitTest'
import { useTimelineStore } from '@/store/timelineStore'

export interface MarqueeRect {
  x0: number
  y0: number
  x1: number
  y1: number
  /** 标尺区拖动：忽略 y，按时间范围全高选择 */
  infinite: boolean
}

interface Args {
  rulerHeight: number
  /** 提交时构建当前对象的屏幕坐标 box（容器坐标系） */
  buildObjects: () => MarqueeObject[]
}

export function useMarqueeSelection({ rulerHeight, buildObjects }: Args) {
  const [rect, setRect] = useState<MarqueeRect | null>(null)
  const startRef = useRef<{ additive: boolean } | null>(null)

  const onPointerDown = useCallback(
    (x: number, y: number, shiftKey: boolean) => {
      startRef.current = { additive: shiftKey }
      setRect({ x0: x, y0: y, x1: x, y1: y, infinite: y <= rulerHeight })
    },
    [rulerHeight]
  )

  const onPointerMove = useCallback((x: number, y: number) => {
    setRect(r => (r ? { ...r, x1: x, y1: y } : null))
  }, [])

  /**
   * 边缘自动滚动时平移选框起点，使其锚定在世界坐标。
   * scrollLeft 增加 Δ → 固定世界点的屏幕 x 减少 Δ，故起点 x0 同步 -Δ。
   */
  const shiftStart = useCallback((dx: number, dy: number) => {
    setRect(r => (r ? { ...r, x0: r.x0 + dx, y0: r.y0 + dy } : null))
  }, [])

  const onPointerUp = useCallback(() => {
    const start = startRef.current
    startRef.current = null
    setRect(cur => {
      if (start && cur) {
        const sel = computeMarqueeSelection(buildObjects(), cur, cur.infinite)
        const store = useTimelineStore.getState()
        if (start.additive) store.addToSelection(sel)
        else store.setSelection(sel)
      }
      return null
    })
  }, [buildObjects])

  return { rect, onPointerDown, onPointerMove, onPointerUp, shiftStart }
}
