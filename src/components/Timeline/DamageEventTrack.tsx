/**
 * 伤害事件轨道组件
 */

import { Rect, Line } from 'react-konva'
import DamageEventCard from './DamageEventCard'
import { DAMAGE_TIME_LINE_STYLE, TIMELINE_START_TIME, useCanvasColors } from './constants'
import AnnotationIcon from './AnnotationIcon'
import type { DamageEvent, Annotation } from '@/types/timeline'
import { computeDamageCardGeometry } from './cardGeometry'

interface DamageEventTrackProps {
  events: DamageEvent[]
  selectedEventIds: string[]
  /** 多选群组拖动的 x 偏移（像素），0 表示无 */
  groupDragDelta?: number
  /** 群组拖动的「抓手」伤害事件 id（其卡片由 Konva 自身驱动，不重复施加偏移） */
  groupDraggedId?: string | null
  /** 选中的备注 id（群组拖动时随同偏移） */
  selectedAnnotationIds?: string[]
  zoomLevel: number
  timelineWidth: number
  trackHeight: number
  rowMap: Map<string, number>
  rowHeight: number
  yOffset: number
  maxTime: number
  draggingEventPosition: { eventId: string; x: number } | null
  viewportWidth: number
  scrollLeft: number
  /** 网格线 / 伤害事件竖线在轨道底部之外向下延伸的额外像素（用于贯穿 HP 轨道） */
  bottomExtension?: number
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
  reportDamageDrag?: (eventId: string, x: number) => void
  onDiamondDragEnd?: (eventId: string, newTime: number) => void
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
  onAnnotationDragStart: (annotationId: string) => void
  onAnnotationDragMove?: (annotationId: string, newX: number) => void
  onAnnotationDragEnd: (annotationId: string, newX: number) => void
  /** 他人正在拖动的对象 id 集合，在此集合内的 damage event / annotation 隐藏原始渲染 */
  peerDraggingIds?: Set<string>
}

export default function DamageEventTrack({
  events,
  selectedEventIds,
  groupDragDelta = 0,
  groupDraggedId = null,
  selectedAnnotationIds = [],
  zoomLevel,
  timelineWidth,
  trackHeight,
  rowMap,
  rowHeight,
  yOffset,
  maxTime,
  draggingEventPosition,
  viewportWidth,
  scrollLeft,
  bottomExtension = 0,
  onSelectEvent,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDblClick,
  onContextMenu,
  isReadOnly = false,
  reportDamageDrag,
  onDiamondDragEnd,
  annotations,
  pinnedAnnotationId,
  onAnnotationHover,
  onAnnotationHoverEnd,
  onAnnotationClick,
  onAnnotationContextMenu,
  onAnnotationDragStart,
  onAnnotationDragMove,
  onAnnotationDragEnd,
  peerDraggingIds,
}: DamageEventTrackProps) {
  const colors = useCanvasColors()

  // 视口裁剪：只渲染可见范围内的元素（含 1 个 viewport 宽度的 buffer）
  const buffer = viewportWidth
  const visibleMinX = scrollLeft - buffer
  const visibleMaxX = scrollLeft + viewportWidth + buffer

  // 生成时间刻度网格线（每10秒一条，实线，视口裁剪）
  const gridLines = []
  const gridInterval = 10 // 10秒间隔
  const gridStartTick = Math.max(
    Math.ceil(TIMELINE_START_TIME / 10) * 10,
    Math.floor(visibleMinX / zoomLevel / 10) * 10
  )
  const gridEndTick = Math.min(maxTime, Math.ceil(visibleMaxX / zoomLevel / 10) * 10)
  for (let time = gridStartTick; time <= gridEndTick; time += gridInterval) {
    const x = time * zoomLevel
    gridLines.push(
      <Line
        key={`grid-${time}`}
        points={[x, yOffset, x, yOffset + trackHeight + bottomExtension]}
        stroke={time === 0 ? colors.zeroLine : colors.gridLine}
        strokeWidth={time === 0 ? 2 : 1}
      />
    )
  }

  // 生成伤害时间指示虚线（从卡片底部开始，视口裁剪）
  const CARD_HEIGHT = 28 // 卡片高度
  const damageTimeLines = events
    .filter(event => {
      const x =
        draggingEventPosition?.eventId === event.id
          ? draggingEventPosition.x
          : event.time * zoomLevel + (selectedEventIds.includes(event.id) ? groupDragDelta : 0)
      return x >= visibleMinX && x <= visibleMaxX
    })
    .map(event => {
      const x =
        draggingEventPosition?.eventId === event.id
          ? draggingEventPosition.x
          : event.time * zoomLevel + (selectedEventIds.includes(event.id) ? groupDragDelta : 0)
      const row = rowMap.get(event.id) ?? 0
      const cardBottomY = yOffset + row * rowHeight + CARD_HEIGHT

      return (
        <Line
          key={`damage-line-${event.id}`}
          points={[x, cardBottomY, x, yOffset + trackHeight + bottomExtension]}
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
        fill={colors.damageTrackBg}
        draggableBackground={true}
        onDblClick={e => {
          if (isReadOnly || !onDblClick || e.evt.button !== 0) return
          const layer = e.target.getLayer()
          if (!layer) return
          const pos = layer.getRelativePointerPosition()
          if (!pos) return
          const time = Math.round((pos.x / zoomLevel) * 10) / 10
          if (time < 0) return
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

      {/* 伤害事件（视口裁剪，基于实际卡片左缘+宽度；他人拖动中的事件隐藏） */}
      {[...events]
        .filter(event => {
          if (peerDraggingIds?.has(event.id)) return false
          const geom = computeDamageCardGeometry(event, zoomLevel)
          const groupX =
            event.time * zoomLevel + (selectedEventIds.includes(event.id) ? groupDragDelta : 0)
          const leftX = groupX + geom.leftLocal
          return leftX + geom.width >= visibleMinX && leftX <= visibleMaxX
        })
        .sort((a, b) => {
          // 选中的事件排在最后（渲染在最顶层）
          if (selectedEventIds.includes(a.id)) return 1
          if (selectedEventIds.includes(b.id)) return -1
          // 其他事件按时间排序
          return a.time - b.time
        })
        .map(event => {
          return (
            <DamageEventCard
              key={event.id}
              event={event}
              isSelected={selectedEventIds.includes(event.id)}
              dragOffsetX={
                selectedEventIds.includes(event.id) && event.id !== groupDraggedId
                  ? groupDragDelta
                  : 0
              }
              zoomLevel={zoomLevel}
              rowHeight={rowHeight}
              row={rowMap.get(event.id) ?? 0}
              yOffset={yOffset}
              onSelect={() => onSelectEvent(event.id)}
              onDragStart={() => onDragStart(event.id, event.time * zoomLevel)}
              onDragMove={x => onDragMove(event.id, x)}
              onDragEnd={x => onDragEnd(event.id, x)}
              isReadOnly={isReadOnly}
              reportDamageDrag={reportDamageDrag}
              onDiamondDragEnd={onDiamondDragEnd}
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
      {/* 备注图标（视口裁剪；他人拖动中的备注隐藏） */}
      {annotations
        .filter(annotation => {
          if (peerDraggingIds?.has(annotation.id)) return false
          const x = annotation.time * zoomLevel
          return x >= visibleMinX && x <= visibleMaxX
        })
        .map(annotation => {
          const x = annotation.time * zoomLevel
          const annotationY = yOffset + trackHeight - 20

          return (
            <AnnotationIcon
              key={`annotation-${annotation.id}`}
              x={x}
              y={annotationY}
              dragOffsetX={selectedAnnotationIds.includes(annotation.id) ? groupDragDelta : 0}
              isPinned={pinnedAnnotationId === annotation.id}
              draggable={!isReadOnly && pinnedAnnotationId === annotation.id}
              onDragStart={() => onAnnotationDragStart(annotation.id)}
              onDragMove={newX => onAnnotationDragMove?.(annotation.id, newX)}
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
                onAnnotationContextMenu(
                  annotation.id,
                  e.evt.clientX,
                  e.evt.clientY,
                  annotation.time
                )
              }}
            />
          )
        })}
    </>
  )
}
