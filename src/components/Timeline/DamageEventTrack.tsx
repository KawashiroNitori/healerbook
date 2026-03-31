/**
 * 伤害事件轨道组件
 */

import { Rect, Line } from 'react-konva'
import DamageEventCard from './DamageEventCard'
import { GRID_LINE_STYLE, DAMAGE_TIME_LINE_STYLE, TIMELINE_START_TIME } from './constants'
import AnnotationIcon from './AnnotationIcon'
import type { DamageEvent, Annotation } from '@/types/timeline'

interface DamageEventTrackProps {
  events: DamageEvent[]
  selectedEventId: string | null
  zoomLevel: number
  timelineWidth: number
  trackHeight: number
  rowMap: Map<string, number>
  rowHeight: number
  yOffset: number
  maxTime: number
  draggingEventPosition: { eventId: string; x: number } | null
  onSelectEvent: (id: string) => void
  onDragStart: (eventId: string, x: number) => void
  onDragMove: (eventId: string, x: number) => void
  onDragEnd: (eventId: string, x: number) => void
  onDblClick?: (time: number) => void
  onContextMenu?: (
    e: { type: 'damageEvent'; eventId: string } | { type: 'damageTrackEmpty' },
    clientX: number,
    clientY: number,
    time: number
  ) => void
  isReadOnly?: boolean
  annotations: Annotation[]
  pinnedAnnotationId: string | null
  onAnnotationHover: (annotation: Annotation, screenX: number, screenY: number) => void
  onAnnotationHoverEnd: () => void
  onAnnotationClick: (annotation: Annotation, screenX: number, screenY: number) => void
  onAnnotationContextMenu: (
    annotationId: string,
    clientX: number,
    clientY: number,
    time: number
  ) => void
  onAnnotationDragStart: () => void
  onAnnotationDragEnd: (annotationId: string, newX: number) => void
}

export default function DamageEventTrack({
  events,
  selectedEventId,
  zoomLevel,
  timelineWidth,
  trackHeight,
  rowMap,
  rowHeight,
  yOffset,
  maxTime,
  draggingEventPosition,
  onSelectEvent,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDblClick,
  onContextMenu,
  isReadOnly = false,
  annotations,
  pinnedAnnotationId,
  onAnnotationHover,
  onAnnotationHoverEnd,
  onAnnotationClick,
  onAnnotationContextMenu,
  onAnnotationDragStart,
  onAnnotationDragEnd,
}: DamageEventTrackProps) {
  // 生成时间刻度网格线（每10秒一条，实线）
  const gridLines = []
  const gridInterval = 10 // 10秒间隔
  const startTick = Math.ceil(TIMELINE_START_TIME / 10) * 10
  for (let time = startTick; time <= maxTime; time += gridInterval) {
    const x = time * zoomLevel
    gridLines.push(
      <Line
        key={`grid-${time}`}
        points={[x, yOffset, x, yOffset + trackHeight]}
        stroke={time === 0 ? '#9ca3af' : GRID_LINE_STYLE.stroke}
        strokeWidth={time === 0 ? 2 : GRID_LINE_STYLE.strokeWidth}
      />
    )
  }

  // 生成伤害时间指示虚线（从卡片底部开始）
  const CARD_HEIGHT = 28 // 卡片高度
  const damageTimeLines = events.map(event => {
    const x =
      draggingEventPosition?.eventId === event.id ? draggingEventPosition.x : event.time * zoomLevel
    const row = rowMap.get(event.id) ?? 0
    const cardBottomY = yOffset + row * rowHeight + CARD_HEIGHT

    return (
      <Line
        key={`damage-line-${event.id}`}
        points={[x, cardBottomY, x, yOffset + trackHeight]}
        {...DAMAGE_TIME_LINE_STYLE}
      />
    )
  })

  return (
    <>
      {/* 伤害事件轨道背景 */}
      <Rect
        x={TIMELINE_START_TIME * zoomLevel}
        y={yOffset}
        width={timelineWidth}
        height={trackHeight}
        fill="#e5e7eb"
        draggableBackground={true}
        onDblClick={e => {
          if (isReadOnly || !onDblClick) return
          const layer = e.target.getLayer()
          if (!layer) return
          const pos = layer.getRelativePointerPosition()
          if (!pos) return
          const time = Math.max(TIMELINE_START_TIME, Math.round((pos.x / zoomLevel) * 10) / 10)
          onDblClick(time)
        }}
        onContextMenu={e => {
          e.evt.preventDefault()
          if (isReadOnly || !onContextMenu) return
          const layer = e.target.getLayer()
          if (!layer) return
          const pos = layer.getRelativePointerPosition()
          if (!pos) return
          const time = Math.max(TIMELINE_START_TIME, Math.round((pos.x / zoomLevel) * 10) / 10)
          onContextMenu({ type: 'damageTrackEmpty' }, e.evt.clientX, e.evt.clientY, time)
        }}
      />

      {/* 时间刻度网格线 */}
      {gridLines}

      {/* 伤害时间指示虚线 */}
      {damageTimeLines}

      {/* 伤害事件 */}
      {[...events]
        .sort((a, b) => {
          // 选中的事件排在最后（渲染在最顶层）
          if (a.id === selectedEventId) return 1
          if (b.id === selectedEventId) return -1
          // 其他事件按时间排序
          return a.time - b.time
        })
        .map(event => {
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
              onDragMove={x => onDragMove(event.id, x)}
              onDragEnd={x => onDragEnd(event.id, x)}
              isReadOnly={isReadOnly}
              onContextMenu={e => {
                e.evt.preventDefault()
                if (!onContextMenu) return
                onContextMenu(
                  { type: 'damageEvent', eventId: event.id },
                  e.evt.clientX,
                  e.evt.clientY,
                  event.time
                )
              }}
            />
          )
        })}
      {/* 注释图标 */}
      {annotations.map(annotation => {
        const x = annotation.time * zoomLevel
        const annotationY = yOffset + trackHeight - 20

        return (
          <AnnotationIcon
            key={`annotation-${annotation.id}`}
            x={x}
            y={annotationY}
            isPinned={pinnedAnnotationId === annotation.id}
            draggable={!isReadOnly && pinnedAnnotationId === annotation.id}
            onDragStart={onAnnotationDragStart}
            onDragEnd={newX => onAnnotationDragEnd(annotation.id, newX)}
            onMouseEnter={e => {
              const stage = e.target.getStage()
              if (!stage) return
              const box = stage.container().getBoundingClientRect()
              const parent = e.target.getParent()
              if (!parent) return
              const absPos = parent.getAbsolutePosition()
              onAnnotationHover(annotation, box.left + absPos.x + 8, box.top + absPos.y)
            }}
            onMouseLeave={onAnnotationHoverEnd}
            onClick={e => {
              const stage = e.target.getStage()
              if (!stage) return
              const box = stage.container().getBoundingClientRect()
              const parent = e.target.getParent()
              if (!parent) return
              const absPos = parent.getAbsolutePosition()
              onAnnotationClick(annotation, box.left + absPos.x + 8, box.top + absPos.y)
            }}
            onContextMenu={e => {
              e.evt.preventDefault()
              onAnnotationContextMenu(annotation.id, e.evt.clientX, e.evt.clientY, annotation.time)
            }}
          />
        )
      })}
    </>
  )
}
