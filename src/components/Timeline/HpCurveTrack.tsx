/**
 * HP 曲线轨道
 *
 * 在 fixedStage 内、伤害事件轨道下方渲染一条 HP 演化折线。
 * 数据源：useDamageCalculation 透传的 hpTimeline（time 升序）。
 * Y 轴：hp / hpMax → [0, 1] → 反向映射到 [yOffset+height-2, yOffset+2]
 * 视口裁剪：仅保留 X 落在可见区 ± 1 viewport 的点。
 */

import { memo } from 'react'
import { Line, Rect } from 'react-konva'
import type { HpTimelinePoint } from '@/types/hpTimeline'
import { useCanvasColors } from './constants'

interface HpCurveTrackProps {
  hpTimeline: HpTimelinePoint[]
  zoomLevel: number
  /** 轨道顶部 Y 坐标 */
  yOffset: number
  /** 轨道宽度（= timelineWidth） */
  width: number
  /** 轨道高度（= HP_CURVE_HEIGHT） */
  height: number
  viewportWidth: number
  scrollLeft: number
}

const HpCurveTrack = memo(function HpCurveTrack({
  hpTimeline,
  zoomLevel,
  yOffset,
  width,
  height,
  viewportWidth,
  scrollLeft,
}: HpCurveTrackProps) {
  const colors = useCanvasColors()

  if (hpTimeline.length < 2) return null

  // Y 映射：hp/hpMax = 1 → top；= 0 → bottom（留 2px 边距）
  const PADDING = 2
  const plotHeight = height - PADDING * 2
  const yFor = (hp: number, hpMax: number) =>
    yOffset + PADDING + (1 - hp / Math.max(1, hpMax)) * plotHeight

  // 视口裁剪：保留可见区 ± 1 viewport
  const buffer = viewportWidth
  const minX = scrollLeft - buffer
  const maxX = scrollLeft + viewportWidth + buffer

  // 找到第一个 X >= minX 的点的前一条（保证曲线左端连接到视口外）
  const xs = hpTimeline.map(p => p.time * zoomLevel)
  let startIdx = xs.findIndex(x => x >= minX)
  if (startIdx === -1) startIdx = hpTimeline.length - 1
  if (startIdx > 0) startIdx -= 1

  let endIdx = xs.reduce((last, x, i) => (x <= maxX ? i : last), -1)
  if (endIdx === -1) endIdx = 0
  if (endIdx < hpTimeline.length - 1) endIdx += 1

  if (endIdx <= startIdx) return null

  // 折线点序列（每相邻两个点之间用阶梯：先水平延伸到下个 time，再垂直跳到下个 hp）
  // 但本期为简单起见用直接连线（与 mockup 一致）。如果未来要"瞬时下落"效果，改成
  // 在每个 damage point 前插一个 (time, prev.hp) 点。
  const points: number[] = []
  for (let i = startIdx; i <= endIdx; i++) {
    const p = hpTimeline[i]
    points.push(p.time * zoomLevel, yFor(p.hp, p.hpMax))
  }

  // 面积填充：闭合到 [first.x, bottom] 与 [last.x, bottom]
  const firstX = hpTimeline[startIdx].time * zoomLevel
  const lastX = hpTimeline[endIdx].time * zoomLevel
  const bottomY = yOffset + height
  const fillPoints = [firstX, bottomY, ...points, lastX, bottomY]

  // maxHP 基线（视口内）
  const baselineY = yFor(1, 1)
  const baselineLeft = Math.max(0, minX)
  const baselineRight = Math.min(width, maxX)

  return (
    <>
      {/* 轨道背景（使用伤害轨道同色，让 HP 曲线视觉上紧贴） */}
      <Rect
        x={0}
        y={yOffset}
        width={width}
        height={height}
        fill={colors.damageTrackBg}
        listening={false}
        perfectDrawEnabled={false}
      />

      {/* maxHP 基线 */}
      <Line
        points={[baselineLeft, baselineY, baselineRight, baselineY]}
        stroke={colors.hpCurveBaseline}
        strokeWidth={1}
        dash={[4, 3]}
        listening={false}
        perfectDrawEnabled={false}
      />

      {/* 面积填充 */}
      <Line
        points={fillPoints}
        fill={colors.hpCurveFill}
        closed={true}
        listening={false}
        perfectDrawEnabled={false}
      />

      {/* 折线 */}
      <Line
        points={points}
        stroke={colors.hpCurveStroke}
        strokeWidth={2}
        listening={false}
        perfectDrawEnabled={false}
      />
    </>
  )
})

export default HpCurveTrack
