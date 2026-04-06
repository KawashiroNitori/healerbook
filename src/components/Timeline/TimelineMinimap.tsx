/**
 * 时间轴缩略图导航组件
 * 提供快速浏览和跳转功能
 */

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { useState } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useDamageCalculationResults } from '@/contexts/DamageCalculationContext'
import { getNonTankMinHP } from '@/utils/stats'
import { TIMELINE_START_TIME, getCanvasColors } from './constants'
import { useUIStore } from '@/store/uiStore'

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
    const bgCanvasRef = useRef<HTMLCanvasElement>(null)
    const viewportCanvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isDragging, setIsDragging] = useState(false)
    // 缓存当前绘制参数供 updateViewport 使用
    const drawParamsRef = useRef({
      minimapScale: 1,
      timelineOffset: 0,
      contentY: 24,
      contentHeight: 36,
    })

    const { timeline, statistics } = useTimelineStore()
    const eventResults = useDamageCalculationResults()
    const theme = useUIStore(s => s.theme)

    // 计算缩略图的缩放比例（减去内边距）
    const padding = 16 // p-2 = 8px * 2
    const canvasWidth = width - padding
    const minimapScale = canvasWidth / totalWidth

    // 计算可视区域在缩略图中的位置和宽度
    const timelineOffset = -TIMELINE_START_TIME * zoomLevel

    /** 在视口层绘制视口指示器 */
    const drawViewportRect = useCallback(
      (sl: number) => {
        const canvas = viewportCanvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const {
          minimapScale: ms,
          timelineOffset: to,
          contentY,
          contentHeight,
        } = drawParamsRef.current
        const dpr = window.devicePixelRatio || 1

        ctx.clearRect(0, 0, canvas.width, canvas.height)

        const vl = (sl + to) * ms * dpr
        const vw = viewportWidth * ms * dpr

        const c = getCanvasColors()
        ctx.strokeStyle = c.viewportStroke
        ctx.lineWidth = 2 * dpr
        ctx.strokeRect(vl, contentY * dpr, vw, contentHeight * dpr)

        ctx.fillStyle = c.viewportFill
        ctx.fillRect(vl, contentY * dpr, vw, contentHeight * dpr)
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

    // 绘制背景层（timeline/zoom 变化时重绘）
    useEffect(() => {
      const bgCanvas = bgCanvasRef.current
      const viewportCanvas = viewportCanvasRef.current
      if (!bgCanvas || !viewportCanvas || !timeline) return

      const ctx = bgCanvas.getContext('2d')
      if (!ctx) return

      // 设置两层 canvas 实际分辨率
      const dpr = window.devicePixelRatio || 1
      bgCanvas.width = canvasWidth * dpr
      bgCanvas.height = height * dpr
      bgCanvas.style.width = `${canvasWidth}px`
      bgCanvas.style.height = `${height}px`
      viewportCanvas.width = canvasWidth * dpr
      viewportCanvas.height = height * dpr
      viewportCanvas.style.width = `${canvasWidth}px`
      viewportCanvas.style.height = `${height}px`
      ctx.scale(dpr, dpr)

      const colors = getCanvasColors()

      // 清空画布
      ctx.clearRect(0, 0, canvasWidth, height)

      // 绘制背景
      ctx.fillStyle = colors.minimapBg
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
      ctx.strokeStyle = colors.minimapGrid
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
      ctx.strokeStyle = colors.zeroLine
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

        ctx.fillStyle = colors.timeLabelBg
        ctx.fillRect(x - textWidth / 2 - textPadding, 4, textWidth + textPadding * 2, 16)

        // 绘制文字
        ctx.fillStyle = colors.textDark
        ctx.fillText(timeText, x, 7)
      }

      // 绘制分隔线
      ctx.strokeStyle = colors.minimapSeparator
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

      // 致死线：非T职业最低HP / 最大伤害，限制在 60%–100%
      const referenceMaxHP = getNonTankMinHP(statistics)
      const rawLineRatio = referenceMaxHP / maxDamage
      const shouldDrawFatalLine = rawLineRatio < 1
      const lineDisplayRatio = Math.max(rawLineRatio, 0.75)
      const lineHeightFromBottom = lineDisplayRatio * contentHeight

      // 创建红黄斜条纹 pattern（用于致死伤害柱）
      const stripeSize = 6
      const stripeCanvas = document.createElement('canvas')
      stripeCanvas.width = stripeSize
      stripeCanvas.height = stripeSize
      const stripeCtx = stripeCanvas.getContext('2d')!
      stripeCtx.fillStyle = '#dc2626'
      stripeCtx.fillRect(0, 0, stripeSize, stripeSize)
      stripeCtx.strokeStyle = '#eab308'
      stripeCtx.lineWidth = 1
      stripeCtx.beginPath()
      stripeCtx.moveTo(-1, stripeSize + 1)
      stripeCtx.lineTo(stripeSize + 1, -1)
      stripeCtx.moveTo(-1, 1)
      stripeCtx.lineTo(1, -1)
      stripeCtx.moveTo(stripeSize - 1, stripeSize + 1)
      stripeCtx.lineTo(stripeSize + 1, stripeSize - 1)
      stripeCtx.stroke()
      const fatalPattern = ctx.createPattern(stripeCanvas, 'repeat')!

      timeline.damageEvents.forEach(event => {
        const x = (event.time - TIMELINE_START_TIME) * zoomLevel * minimapScale
        const eventWidth = Math.max(3, 5 * minimapScale)

        // 根据距致死线的距离着色（死刑使用固定灰色，不参与距离计算）
        const result = eventResults.get(event.id)
        const hasOverkill = event.playerDamageDetails?.some(
          d => (d.overkill ?? 0) > 0 && !d.statuses.some(s => s.statusId === 810)
        )
        const finalDamageForColor = result?.finalDamage ?? event.damage
        const ratio = finalDamageForColor / referenceMaxHP
        let color: string | CanvasPattern
        let isFatal = false

        if (event.type === 'tankbuster') {
          color = '#94a3b8' // 死刑 - 灰色
        } else if (timeline.isReplayMode ? hasOverkill : ratio >= 1) {
          color = fatalPattern // 回放：有死亡 / 预估：致死 - 红黄斜条纹
          isFatal = true
        } else if (ratio >= 0.9) {
          color = '#f59e0b' // 90–100% HP - 琥珀
        } else if (ratio >= 0.7) {
          color = '#f97316' // 70–90% HP - 橙色
        } else if (ratio >= 0.5) {
          color = '#eab308' // 50–70% HP - 黄色
        } else {
          color = '#22c55e' // < 50% HP - 绿色
        }

        // 计算柱子高度：有致死线时以 referenceMaxHP 为基准（使线正好对应该值）
        // 无致死线时以 maxDamage 为基准填满内容区域
        const normalizedHeight = shouldDrawFatalLine
          ? (finalDamageForColor / referenceMaxHP) * lineHeightFromBottom
          : (finalDamageForColor / maxDamage) * contentHeight
        const barHeight = Math.max(3, Math.min(normalizedHeight, contentHeight))

        const barX = Math.round(x - eventWidth / 2)
        const barY = contentY + contentHeight - barHeight
        const barW = Math.ceil(eventWidth)
        const barH = Math.ceil(barHeight)

        if (isFatal) {
          ctx.save()
          ctx.fillStyle = fatalPattern
          ctx.translate(barX, barY)
          ctx.fillRect(0, 0, barW, barH)
          ctx.restore()
        } else {
          ctx.fillStyle = color
          ctx.fillRect(barX, barY, barW, barH)
        }
      })

      // 绘制注释标记（minimap 顶部）
      const annotations = timeline.annotations ?? []
      if (annotations.length > 0) {
        const iconSize = 10
        annotations.forEach(annotation => {
          const ax = (annotation.time - TIMELINE_START_TIME) * zoomLevel * minimapScale
          const ay = contentY + 2

          // 气泡背景
          ctx.fillStyle = 'rgba(59, 130, 246, 0.7)'
          ctx.beginPath()
          ctx.roundRect(ax - iconSize / 2, ay, iconSize, iconSize, 2)
          ctx.fill()

          // 文字线
          ctx.strokeStyle = 'white'
          ctx.lineWidth = 1.2
          ctx.lineCap = 'round'
          const lineY1 = ay + iconSize * 0.33
          const lineY2 = ay + iconSize * 0.6
          ctx.beginPath()
          ctx.moveTo(ax - iconSize / 2 + 2, lineY1)
          ctx.lineTo(ax + iconSize / 2 - 3, lineY1)
          ctx.moveTo(ax - iconSize / 2 + 2, lineY2)
          ctx.lineTo(ax + iconSize / 2 - 2, lineY2)
          ctx.stroke()
        })
      }

      // 绘制致死线（有事件超过非T生命值时才画）
      if (shouldDrawFatalLine) {
        const lineY = contentY + contentHeight - lineHeightFromBottom
        ctx.strokeStyle = 'rgba(220, 38, 38, 0.6)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(0, lineY)
        ctx.lineTo(canvasWidth, lineY)
        ctx.stroke()
        ctx.setLineDash([])

        // 致死线标签
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillStyle = 'rgba(220, 38, 38, 0.8)'
        ctx.fillText('致死', 2, lineY + 3)
      }

      drawParamsRef.current = { minimapScale, timelineOffset, contentY, contentHeight }

      // 画视口指示器
      drawViewportRect(scrollLeft)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeline, eventResults, statistics, canvasWidth, height, zoomLevel, minimapScale, theme])

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
            ref={bgCanvasRef}
            style={{ width: '100%', height }}
            className="rounded border border-border"
          />
          <canvas
            ref={viewportCanvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height }}
            className="rounded"
          />
        </div>
      </div>
    )
  }
)

export default TimelineMinimap
