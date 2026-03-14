/**
 * 伤害事件轨道组件
 */

import { Rect } from 'react-konva'
import DamageEventCard from './DamageEventCard'
import type { DamageEvent } from '@/types/timeline'
import type { CalculationResult } from '@/utils/mitigationCalculator'

interface DamageEventTrackProps {
  events: DamageEvent[]
  eventResults: Map<string, CalculationResult>
  selectedEventId: string | null
  zoomLevel: number
  timelineWidth: number
  trackHeight: number
  rowMap: Map<string, number>
  rowHeight: number
  yOffset: number
  onSelectEvent: (id: string) => void
  onDragStart: (eventId: string, x: number) => void
  onDragMove: (eventId: string, x: number) => void
  onDragEnd: (eventId: string, x: number) => void
  isReadOnly?: boolean
}

export default function DamageEventTrack({
  events,
  eventResults,
  selectedEventId,
  zoomLevel,
  timelineWidth,
  trackHeight,
  rowMap,
  rowHeight,
  yOffset,
  onSelectEvent,
  onDragStart,
  onDragMove,
  onDragEnd,
  isReadOnly = false,
}: DamageEventTrackProps) {
  return (
    <>
      {/* 伤害事件轨道背景 */}
      <Rect x={0} y={yOffset} width={timelineWidth} height={trackHeight} fill="#e5e7eb" />

      {/* 伤害事件 */}
      {[...events]
        .sort((a, b) => {
          // 选中的事件排在最后（渲染在最顶层）
          if (a.id === selectedEventId) return 1
          if (b.id === selectedEventId) return -1
          // 其他事件按时间排序
          return a.time - b.time
        })
        .map((event) => {
          const result = eventResults.get(event.id)
          if (!result) return null

          return (
            <DamageEventCard
              key={event.id}
              event={event}
              isSelected={selectedEventId === event.id}
              zoomLevel={zoomLevel}
              rowHeight={rowHeight}
              row={rowMap.get(event.id) ?? 0}
              yOffset={yOffset}
              onSelect={() => onSelectEvent(event.id)}
              onDragStart={() => onDragStart(event.id, event.time * zoomLevel)}
              onDragMove={(x) => onDragMove(event.id, x)}
              onDragEnd={(x) => onDragEnd(event.id, x)}
              isReadOnly={isReadOnly}
            />
          )
        })}
    </>
  )
}
