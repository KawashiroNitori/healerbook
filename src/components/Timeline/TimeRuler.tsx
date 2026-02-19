/**
 * 时间标尺组件
 */

import { Group, Line, Rect, Text } from 'react-konva'

interface TimeRulerProps {
  maxTime: number
  zoomLevel: number
  timelineWidth: number
  height: number
}

export default function TimeRuler({
  maxTime,
  zoomLevel,
  timelineWidth,
  height,
}: TimeRulerProps) {
  return (
    <>
      {/* 时间标尺轨道背景 */}
      <Rect x={0} y={0} width={timelineWidth} height={height} fill="#f3f4f6" />

      {/* 时间标尺刻度 */}
      {Array.from({ length: Math.ceil(maxTime / 10) + 1 }).map((_, i) => {
        const time = i * 10
        const x = time * zoomLevel
        return (
          <Group key={`ruler-${i}`}>
            <Line points={[x, 0, x, height]} stroke="#d1d5db" strokeWidth={1} />
            <Text
              x={x + 4}
              y={8}
              text={`${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`}
              fontSize={12}
              fill="#6b7280"
              fontFamily="Arial, sans-serif"
              perfectDrawEnabled={false}
              listening={false}
            />
          </Group>
        )
      })}
    </>
  )
}
