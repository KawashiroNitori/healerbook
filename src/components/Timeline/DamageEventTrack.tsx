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
  yOffset: number
  onSelectEvent: (id: string) => void
  onDragStart: (eventId: string, x: number) => void
  onDragMove: (eventId: string, x: number) => void
  onDragEnd: (eventId: string, x: number) => void
}

export default function DamageEventTrack({
  events,
  eventResults,
  selectedEventId,
  zoomLevel,
  timelineWidth,
  trackHeight,
  yOffset,
  onSelectEvent,
  onDragStart,
  onDragMove,
  onDragEnd,
}: DamageEventTrackProps) {
  return (
    <>
      {/* 伤害事件轨道背景 */}
      <Rect x={0} y={yOffset} width={timelineWidth} height={trackHeight} fill="#e5e7eb" />

      {/* 伤害事件 */}
      {[...events]
        .sort((a, b) => a.time - b.time)
        .map((event) => {
          const result = eventResults.get(event.id)
          if (!result) return null

          return (
            <DamageEventCard
              key={event.id}
              event={event}
              result={result}
              isSelected={selectedEventId === event.id}
              zoomLevel={zoomLevel}
              trackHeight={trackHeight}
              onSelect={() => onSelectEvent(event.id)}
              onDragStart={() => onDragStart(event.id, event.time * zoomLevel)}
              onDragMove={(x) => onDragMove(event.id, x)}
              onDragEnd={(x) => onDragEnd(event.id, x)}
            />
          )
        })}
    </>
  )
}
