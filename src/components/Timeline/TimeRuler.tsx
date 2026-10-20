/**
 * 时间标尺组件
 */

import { Group, Line, Rect, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { TIMELINE_START_TIME, useCanvasColors } from './constants'
import PhaseBands, { type PhaseMarker } from './PhaseBands'
import { measureTextWidth } from './measureText'
import { rangesOverlap } from '@/utils/timelinePhases'

const TICK_FONT_SIZE = 12
const TICK_FONT = `${TICK_FONT_SIZE}px Arial, sans-serif`
/** 刻度文字相对刻度线的左偏移 */
const TICK_TEXT_OFFSET = 4

interface TimeRulerProps {
  maxTime: number
  zoomLevel: number
  timelineWidth: number
  height: number
  /** 阶段标记（已排序）：在背景之上画色带 */
  phases?: PhaseMarker[]
  /** 被阶段名占据的 x 区间；与之重叠的刻度（线与文字）整组隐藏 */
  hiddenTickRanges?: [number, number][]
  /** 标尺空白处右键（time 已取整到 0.1 秒并钳到时间轴起点） */
  onContextMenu?: (clientX: number, clientY: number, time: number) => void
}

function formatTime(seconds: number): string {
  const abs = Math.abs(seconds)
  const sign = seconds < 0 ? '-' : ''
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`
}

export default function TimeRuler({
  maxTime,
  zoomLevel,
  timelineWidth,
  height,
  phases,
  hiddenTickRanges,
  onContextMenu,
}: TimeRulerProps) {
  const colors = useCanvasColors()

  // 从 TIMELINE_START_TIME 开始，每 10 秒一个刻度，对齐到 10 秒整数
  const startTick = Math.ceil(TIMELINE_START_TIME / 10) * 10
  const ticks: number[] = []
  for (let t = startTick; t <= maxTime; t += 10) {
    ticks.push(t)
  }

  const isTickHidden = (x: number, text: string) => {
    if (!hiddenTickRanges || hiddenTickRanges.length === 0) return false
    const range: [number, number] = [
      x - 1,
      x + TICK_TEXT_OFFSET + measureTextWidth(text, TICK_FONT),
    ]
    return hiddenTickRanges.some(r => rangesOverlap(range, r))
  }

  const handleContextMenu = (e: KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault()
    if (!onContextMenu) return
    const pos = e.target.getLayer()?.getRelativePointerPosition()
    if (!pos) return
    const time = Math.max(TIMELINE_START_TIME, Math.round((pos.x / zoomLevel) * 10) / 10)
    onContextMenu(e.evt.clientX, e.evt.clientY, time)
  }

  return (
    <>
      {/* 时间标尺轨道背景 */}
      <Rect
        x={TIMELINE_START_TIME * zoomLevel}
        y={0}
        width={timelineWidth}
        height={height}
        fill={colors.timeRulerBg}
        draggableBackground={true}
        onContextMenu={handleContextMenu}
      />

      {phases && <PhaseBands phases={phases} zoomLevel={zoomLevel} y={0} height={height} />}

      {/* 时间标尺刻度 */}
      {ticks.map(time => {
        const x = time * zoomLevel
        const text = formatTime(time)
        if (isTickHidden(x, text)) return null
        return (
          <Group key={`ruler-${time}`} listening={false}>
            <Line points={[x, 0, x, height]} stroke={colors.gridLine} strokeWidth={1} />
            <Text
              x={x + TICK_TEXT_OFFSET}
              y={8}
              text={text}
              fontSize={TICK_FONT_SIZE}
              fill={time < 0 ? colors.textSecondary : colors.textPrimary}
              fontFamily="Arial, sans-serif"
              perfectDrawEnabled={false}
              listening={false}
            />
          </Group>
        )
      })}

      {/* 0 秒标记线（加粗） */}
      <Line points={[0, 0, 0, height]} stroke={colors.zeroLine} strokeWidth={2} />
    </>
  )
}
