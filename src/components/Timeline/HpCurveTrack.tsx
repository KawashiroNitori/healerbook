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
import { TIMELINE_START_TIME, useCanvasColors } from './constants'

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

  if (hpTimeline.length === 0) return null

  // Y 映射：hp/hpMax = 1 → top；= 0 → bottom（留 2px 边距）
  const PADDING = 2
  const plotHeight = height - PADDING * 2
  const yFor = (hp: number, hpMax: number) =>
    yOffset + PADDING + (1 - hp / Math.max(1, hpMax)) * plotHeight

  // 视口裁剪：保留可见区 ± 1 viewport
  const buffer = viewportWidth
  const minX = scrollLeft - buffer
  const maxX = scrollLeft + viewportWidth + buffer

  const xs = hpTimeline.map(p => p.time * zoomLevel)

  // startIdx：第一个 X >= minX 的点的前一个（保证左端连接到视口外）；
  // 全部点都在视口右侧时退化为 0——下面用第一个点的 hp 水平延伸到 minX。
  let startIdx: number
  const firstAtOrAfterMin = xs.findIndex(x => x >= minX)
  if (firstAtOrAfterMin === -1) startIdx = hpTimeline.length - 1
  else if (firstAtOrAfterMin > 0) startIdx = firstAtOrAfterMin - 1
  else startIdx = 0

  // endIdx：最后一个 X <= maxX 的点的后一个；
  // 全部点都在视口左侧时退化为 0——下面用最后一个点的 hp 水平延伸到 maxX。
  let endIdx = xs.reduce((last, x, i) => (x <= maxX ? i : last), -1)
  if (endIdx === -1) endIdx = 0
  else if (endIdx < hpTimeline.length - 1) endIdx += 1

  // 折线点序列：阶梯状（每相邻两点先水平延伸到下个 time，再垂直跳到下个 hp）。
  // 反映"hp 在事件之间保持不变，事件瞬间改变 hp"的真实语义——伤害陡降、治疗 tick
  // 阶梯爬升、maxHP buff 切换瞬时缩放。
  // 实现：在写第 i 个点前先插一个 connector (currentTime, prevHp) 形成水平延伸。
  const points: number[] = []

  // 第一个数据点之前的水平延伸——保持 hpTimeline[startIdx] 的 hp/hpMax 不变。
  // 覆盖 t<0、cast 之前的"满血保持"区。
  const firstHpX = xs[startIdx]
  const firstHpY = yFor(hpTimeline[startIdx].hp, hpTimeline[startIdx].hpMax)
  const leftEdge = Math.min(firstHpX, minX)
  if (leftEdge < firstHpX) {
    points.push(leftEdge, firstHpY)
  }

  for (let i = startIdx; i <= endIdx; i++) {
    const p = hpTimeline[i]
    const x = xs[i]
    if (i > startIdx) {
      const prev = hpTimeline[i - 1]
      points.push(x, yFor(prev.hp, prev.hpMax))
    }
    points.push(x, yFor(p.hp, p.hpMax))
  }

  // 最后一个数据点之后的水平延伸——保持 hpTimeline[endIdx] 的 hp/hpMax 不变。
  const lastHpX = xs[endIdx]
  const lastHpY = yFor(hpTimeline[endIdx].hp, hpTimeline[endIdx].hpMax)
  const rightEdge = Math.max(lastHpX, maxX)
  if (rightEdge > lastHpX) {
    points.push(rightEdge, lastHpY)
  }

  if (points.length < 4) return null // 至少两个点

  // 面积填充：闭合到 [leftEdge, bottom] 与 [rightEdge, bottom]
  const bottomY = yOffset + height
  const fillPoints = [leftEdge, bottomY, ...points, rightEdge, bottomY]

  // maxHP 基线（视口内）
  const baselineY = yFor(1, 1)
  const baselineLeft = Math.max(0, minX)
  const baselineRight = Math.min(width, maxX)

  return (
    <>
      {/* 轨道背景（用 trackBgEven 与 damageTrackBg 区分；从 TIMELINE_START_TIME 起覆盖 pre-zero 区） */}
      <Rect
        x={TIMELINE_START_TIME * zoomLevel}
        y={yOffset}
        width={width}
        height={height}
        fill={colors.trackBgEven}
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
