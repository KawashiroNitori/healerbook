/**
 * 时间标尺组件
 */

import { Group, Line, Rect, Text } from 'react-konva'
import { TIMELINE_START_TIME } from './constants'

interface TimeRulerProps {
  maxTime: number
  zoomLevel: number
  timelineWidth: number
  height: number
}

function formatTime(seconds: number): string {
  const abs = Math.abs(seconds)
  const sign = seconds < 0 ? '-' : ''
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`
}

export default function TimeRuler({ maxTime, zoomLevel, timelineWidth, height }: TimeRulerProps) {
  // 从 TIMELINE_START_TIME 开始，每 10 秒一个刻度，对齐到 10 秒整数
  const startTick = Math.ceil(TIMELINE_START_TIME / 10) * 10
  const ticks: number[] = []
  for (let t = startTick; t <= maxTime; t += 10) {
    ticks.push(t)
  }

  return (
    <>
      {/* 时间标尺轨道背景 */}
      <Rect
        x={TIMELINE_START_TIME * zoomLevel}
        y={0}
        width={timelineWidth}
        height={height}
        fill="#f3f4f6"
        draggableBackground={true}
      />

      {/* 时间标尺刻度 */}
      {ticks.map(time => {
        const x = time * zoomLevel
        return (
          <Group key={`ruler-${time}`}>
            <Line points={[x, 0, x, height]} stroke="#d1d5db" strokeWidth={1} />
            <Text
              x={x + 4}
              y={8}
              text={formatTime(time)}
              fontSize={12}
              fill={time < 0 ? '#9ca3af' : '#6b7280'}
              fontFamily="Arial, sans-serif"
              perfectDrawEnabled={false}
              listening={false}
            />
          </Group>
        )
      })}

      {/* 0 秒标记线（加粗） */}
      <Line points={[0, 0, 0, height]} stroke="#9ca3af" strokeWidth={2} />
    </>
  )
}
