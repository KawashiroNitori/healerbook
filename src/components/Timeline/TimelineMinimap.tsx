/**
 * 时间轴缩略图导航组件
 * 提供快速浏览和跳转功能
 */

import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useDamageCalculationResults } from '@/contexts/DamageCalculationContext'
import { TIMELINE_START_TIME } from './constants'

interface TimelineMinimapProps {
  /** 缩略图宽度 */
  width: number
  /** 缩略图高度 */
  height?: number
  /** 当前可视区域的滚动位置 (像素) */
  scrollLeft: number
  /** 可视区域宽度 (像素) */
  viewportWidth: number
  /** 时间轴总宽度 (像素) */
  totalWidth: number
  /** 缩放级别 (像素/秒) */
  zoomLevel: number
  /** 滚动回调 */
  onScroll: (scrollLeft: number) => void
}

export interface TimelineMinimapHandle {
  /** 直接更新视口指示器位置（不触发 React 渲染） */
  updateViewport: (scrollLeft: number) => void
}

const TimelineMinimap = forwardRef<TimelineMinimapHandle, TimelineMinimapProps>(
  function TimelineMinimap(
    { width, height = 60, scrollLeft, viewportWidth, totalWidth, zoomLevel, onScroll },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isDragging, setIsDragging] = useState(false)
    // 存储不含视口指示器的背景内容
    const bgImageDataRef = useRef<ImageData | null>(null)
    // 缓存当前绘制参数供 updateViewport 使用
    const drawParamsRef = useRef({
      minimapScale: 1,
      timelineOffset: 0,
      contentY: 24,
      contentHeight: 36,
    })

    const { timeline } = useTimelineStore()
    const eventResults = useDamageCalculationResults()

    // 计算缩略图的缩放比例（减去内边距）
    const padding = 16 // p-2 = 8px * 2
    const canvasWidth = width - padding
    const minimapScale = canvasWidth / totalWidth

    // 计算可视区域在缩略图中的位置和宽度
    const timelineOffset = -TIMELINE_START_TIME * zoomLevel

    /** 在已绘制好的背景上绘制视口指示器 */
    const drawViewportRect = useCallback(
      (sl: number) => {
        const canvas = canvasRef.current
        if (!canvas || !bgImageDataRef.current) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const {
          minimapScale: ms,
          timelineOffset: to,
          contentY,
          contentHeight,
        } = drawParamsRef.current
        const dpr = window.devicePixelRatio || 1

        // 恢复背景
        ctx.putImageData(bgImageDataRef.current, 0, 0)

        // 计算视口位置（注意 DPR：putImageData 已经是设备像素，绘制时 ctx 有 scale 所以用逻辑像素）
        // putImageData 绕过 transform，所以需要在 DPR 缩放后的坐标系里算
        const vl = (sl + to) * ms * dpr
        const vw = viewportWidth * ms * dpr

        // 临时在设备像素坐标系绘制（putImageData 不受 transform 影响，所以需要手动缩放）
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0) // 重置 transform

        ctx.strokeStyle = '#2563eb'
        ctx.lineWidth = 2 * dpr
        ctx.strokeRect(vl, contentY * dpr, vw, contentHeight * dpr)

        ctx.fillStyle = 'rgba(37, 99, 235, 0.08)'
        ctx.fillRect(vl, contentY * dpr, vw, contentHeight * dpr)

        ctx.restore()
      },
      [viewportWidth]
    )

    useImperativeHandle(
      ref,
      () => ({
        updateViewport: drawViewportRect,
      }),
      [drawViewportRect]
    )

    // 绘制缩略图（不含视口指示器，存入 bgImageDataRef）
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas || !timeline) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // 设置 canvas 实际分辨率
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvasWidth * dpr
      canvas.height = height * dpr
      canvas.style.width = `${canvasWidth}px`
      canvas.style.height = `${height}px`
      ctx.scale(dpr, dpr)

      // 清空画布
      ctx.clearRect(0, 0, canvasWidth, height)

      // 绘制背景
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvasWidth, height)

      // 计算最大时间
      const damageEventTimes = timeline.damageEvents.map(e => e.time).filter(t => !isNaN(t))
      const castEventTimes = timeline.castEvents.map(e => e.timestamp).filter(t => !isNaN(t))
      const allTimes = [...damageEventTimes, ...castEventTimes]
      const maxTime = allTimes.length > 0 ? Math.max(...allTimes) : 60

      // 绘制时间刻度和标签
      const tickInterval = 60 // 每 60 秒（1 分钟）一个刻度
      const tickHeight = 24 // 刻度区域高度

      // 先绘制所有网格线
      ctx.strokeStyle = '#e4e4e7'
      ctx.lineWidth = 1
      for (let t = 0; t <= maxTime; t += tickInterval) {
        const x = (t - TIMELINE_START_TIME) * zoomLevel * minimapScale
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }

      // 0 秒标记线（加粗）
      const zeroX = -TIMELINE_START_TIME * zoomLevel * minimapScale
      ctx.strokeStyle = '#9ca3af'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(zeroX, 0)
      ctx.lineTo(zeroX, height)
      ctx.stroke()

      // 再绘制时间标签（确保在最上层）
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'

      for (let t = 0; t <= maxTime; t += tickInterval) {
        const x = (t - TIMELINE_START_TIME) * zoomLevel * minimapScale

        const timeText = t === 0 ? '0s' : `${Math.floor(t / 60)}m`

        // 文字背景
        const textMetrics = ctx.measureText(timeText)
        const textWidth = textMetrics.width
        const textPadding = 4

        ctx.fillStyle = '#ffffff'
        ctx.fillRect(x - textWidth / 2 - textPadding, 4, textWidth + textPadding * 2, 16)

        // 绘制文字
        ctx.fillStyle = '#18181b'
        ctx.fillText(timeText, x, 7)
      }

      // 绘制分隔线
      ctx.strokeStyle = '#d4d4d8'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, tickHeight)
      ctx.lineTo(canvasWidth, tickHeight)
      ctx.stroke()

      // 绘制伤害事件（柱状图）
      const contentY = 24 // 内容区域从刻度下方开始
      const contentHeight = height - contentY

      // 计算最大伤害值用于归一化（优先使用最终伤害）
      const maxDamage = Math.max(
        ...timeline.damageEvents.map(e => eventResults.get(e.id)?.finalDamage ?? e.damage),
        1
      )

      timeline.damageEvents.forEach(event => {
        const x = (event.time - TIMELINE_START_TIME) * zoomLevel * minimapScale
        const eventWidth = Math.max(3, 5 * minimapScale)

        // 根据伤害结果着色
        const result = eventResults.get(event.id)
        const hasOverkill = event.playerDamageDetails?.some(d => (d.overkill ?? 0) > 0)
        let color = '#94a3b8' // 默认灰色

        if (hasOverkill) {
          color = '#373737' // 有死亡 - 深灰黑
        } else if (result?.referenceMaxHP && result.finalDamage >= result.referenceMaxHP) {
          color = '#dc2626' // 致死 - 深红
        } else if (result?.referenceMaxHP && result.finalDamage >= result.referenceMaxHP * 0.9) {
          color = '#f59e0b' // 危险 - 琥珀
        } else if (result) {
          const damageReduction = 1 - result.finalDamage / result.originalDamage
          if (damageReduction >= 0.5) {
            color = '#22c55e' // 高减伤 - 绿色
          } else if (damageReduction >= 0.3) {
            color = '#eab308' // 中减伤 - 黄色
          } else if (damageReduction > 0) {
            color = '#f97316' // 低减伤 - 橙色
          } else {
            color = '#ef4444' // 无减伤 - 红色
          }
        }

        // 计算柱子高度（基于最终伤害）
        const finalDamage = result?.finalDamage ?? event.damage
        const normalizedHeight = (finalDamage / maxDamage) * contentHeight
        const barHeight = Math.max(3, normalizedHeight) // 最小高度 3px

        ctx.fillStyle = color
        ctx.fillRect(
          Math.round(x - eventWidth / 2),
          contentY + contentHeight - barHeight,
          Math.ceil(eventWidth),
          Math.ceil(barHeight)
        )
      })

      // 存储背景内容（不含视口指示器）供后续快速更新使用
      const bgImageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      bgImageDataRef.current = bgImageData
      drawParamsRef.current = { minimapScale, timelineOffset, contentY, contentHeight }

      // 画视口指示器
      drawViewportRect(scrollLeft)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeline, eventResults, canvasWidth, height, zoomLevel, minimapScale])

    // React 驱动的视口更新（drag 结束 / zoom 后同步）
    useEffect(() => {
      drawViewportRect(scrollLeft)
    }, [scrollLeft, drawViewportRect])

    // 处理点击和拖动
    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      ;(e.target as HTMLDivElement).setPointerCapture(e.pointerId)
      setIsDragging(true)
      handlePointerMove(e)
    }

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement> | PointerEvent) => {
      if (!isDragging && e.type !== 'pointerdown') return

      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left

      // 将缩略图坐标转换为实际滚动位置
      // 让点击位置居中
      const minScroll = TIMELINE_START_TIME * zoomLevel
      const maxScroll = totalWidth + minScroll - viewportWidth
      const targetScrollLeft = x / minimapScale - timelineOffset - viewportWidth / 2
      const clampedScrollLeft = Math.max(minScroll, Math.min(targetScrollLeft, maxScroll))

      onScroll(clampedScrollLeft)
    }

    const handlePointerUp = () => {
      setIsDragging(false)
    }

    // 全局指针事件监听
    useEffect(() => {
      if (isDragging) {
        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', handlePointerUp)
        return () => {
          window.removeEventListener('pointermove', handlePointerMove)
          window.removeEventListener('pointerup', handlePointerUp)
        }
      }
      // handlePointerMove 在每次渲染时重新创建，但添加为依赖会导致监听器频繁重新绑定
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDragging])

    if (!timeline) return null

    return (
      <div className="border-t border-border bg-background p-2">
        <div
          ref={containerRef}
          className="relative cursor-pointer select-none touch-none"
          onPointerDown={handlePointerDown}
          style={{ height }}
        >
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height }}
            className="rounded border border-border"
          />
        </div>
      </div>
    )
  }
)

export default TimelineMinimap
