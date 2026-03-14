/**
 * 时间轴缩略图导航组件
 * 提供快速浏览和跳转功能
 */

import { useRef, useEffect, useState } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useDamageCalculationV2 } from '@/hooks/useDamageCalculationV2'

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

export default function TimelineMinimap({
  width,
  height = 60,
  scrollLeft,
  viewportWidth,
  totalWidth,
  zoomLevel,
  onScroll,
}: TimelineMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const { timeline } = useTimelineStore()
  const eventResults = useDamageCalculationV2(timeline)

  // 计算缩略图的缩放比例（减去内边距）
  const padding = 16 // p-2 = 8px * 2
  const canvasWidth = width - padding
  const minimapScale = canvasWidth / totalWidth

  // 计算可视区域在缩略图中的位置和宽度
  const viewportLeft = scrollLeft * minimapScale
  const viewportWidthInMinimap = viewportWidth * minimapScale

  // 绘制缩略图
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
    const damageEventTimes = timeline.damageEvents.map((e) => e.time).filter((t) => !isNaN(t))
    const castEventTimes = timeline.castEvents.map((e) => e.timestamp).filter((t) => !isNaN(t))
    const allTimes = [...damageEventTimes, ...castEventTimes]
    const maxTime = allTimes.length > 0 ? Math.max(...allTimes) : 60

    // 绘制时间刻度和标签
    const tickInterval = 60 // 每 60 秒（1 分钟）一个刻度
    const tickHeight = 24 // 刻度区域高度

    // 先绘制所有网格线
    ctx.strokeStyle = '#e4e4e7'
    ctx.lineWidth = 1
    for (let t = 0; t <= maxTime; t += tickInterval) {
      const x = (t * zoomLevel) * minimapScale
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }

    // 再绘制时间标签（确保在最上层）
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    for (let t = 0; t <= maxTime; t += tickInterval) {
      // 跳过 0 分钟的标签
      if (t === 0) continue

      const x = (t * zoomLevel) * minimapScale

      const minutes = Math.floor(t / 60)
      const timeText = `${minutes}m`

      // 绘���文字背景
      const textMetrics = ctx.measureText(timeText)
      const textWidth = textMetrics.width
      const padding = 4

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(x - textWidth / 2 - padding, 2, textWidth + padding * 2, 16)

      // 绘制文字
      ctx.fillStyle = '#18181b'
      ctx.fillText(timeText, x, 5)
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

    // 计算最大伤害值用于归一化
    const maxDamage = Math.max(
      ...timeline.damageEvents.map((e) => e.damage),
      1
    )

    timeline.damageEvents.forEach((event) => {
      const x = (event.time * zoomLevel) * minimapScale
      const eventWidth = Math.max(3, 5 * minimapScale)

      // 根据伤害结果着色
      const result = eventResults.get(event.id)
      let color = '#94a3b8' // 默认灰色

      if (result) {
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

      // 计算柱子高度（基于伤害量）
      const normalizedHeight = (event.damage / maxDamage) * contentHeight
      const barHeight = Math.max(3, normalizedHeight) // 最小高度 3px

      ctx.fillStyle = color
      ctx.fillRect(
        Math.round(x - eventWidth / 2),
        contentY + contentHeight - barHeight,
        Math.ceil(eventWidth),
        Math.ceil(barHeight)
      )
    })

    // 绘制可视区域指示器
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 2
    ctx.strokeRect(viewportLeft, contentY, viewportWidthInMinimap, contentHeight)

    // 绘制可视区域半透明遮罩
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)'
    ctx.fillRect(viewportLeft, contentY, viewportWidthInMinimap, contentHeight)
  }, [
    timeline,
    eventResults,
    canvasWidth,
    height,
    zoomLevel,
    minimapScale,
    viewportLeft,
    viewportWidthInMinimap,
  ])

  // 处理点击和拖动
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
    handleMouseMove(e)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
    if (!isDragging && e.type !== 'mousedown') return

    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left

    // 将缩略图坐标转换为实际滚动位置
    // 让点击位置居中
    const targetScrollLeft = (x / minimapScale) - (viewportWidth / 2)
    const clampedScrollLeft = Math.max(0, Math.min(targetScrollLeft, totalWidth - viewportWidth))

    onScroll(clampedScrollLeft)
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  // 全局鼠标事件监听
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging])

  if (!timeline) return null

  return (
    <div className="border-t border-border bg-background p-2">
      <div
        ref={containerRef}
        className="relative cursor-pointer select-none"
        onMouseDown={handleMouseDown}
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
