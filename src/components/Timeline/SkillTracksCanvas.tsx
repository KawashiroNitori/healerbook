/**
 * 技能轨道 Canvas 区域组件
 */

import { type ReactElement, type RefObject } from 'react'
import { Group, Layer, Line, Rect, Shape, Text } from 'react-konva'
import type Konva from 'konva'
import AnnotationIcon from './AnnotationIcon'
import CastEventIcon from './CastEventIcon'
import { DAMAGE_TIME_LINE_STYLE, TIMELINE_START_TIME, useCanvasColors } from './constants'
import type { SkillTrack } from '@/utils/skillTracks'
import type { Annotation, Timeline } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { InvalidReason, PlacementEngine } from '@/utils/placement/types'

interface SkillTracksCanvasProps {
  timeline: Timeline
  skillTracks: SkillTrack[]
  actions: MitigationAction[]
  /** Task 14 会用这些 prop 接入 engine 阴影 / 拖拽 / 红边框；Task 13 仅占位。 */
  actionMap?: Map<number, MitigationAction>
  engine?: PlacementEngine | null
  invalidCastEventMap?: Map<string, InvalidReason>
  draggingId?: string | null
  setDraggingId?: (id: string | null) => void
  displayActionOverrides: Map<string, MitigationAction>
  zoomLevel: number
  timelineWidth: number
  trackHeight: number
  maxTime: number
  selectedCastEventId: string | null
  draggingEventPosition: { eventId: string; x: number } | null
  scrollLeft: number
  scrollTop: number
  viewportWidth: number
  onSelectCastEvent: (id: string) => void
  onUpdateCastEvent: (id: string, x: number) => void
  onContextMenu: (
    payload:
      | { type: 'castEvent'; castEventId: string; actionId: number }
      | { type: 'skillTrackEmpty'; actionId: number; playerId: number },
    clientX: number,
    clientY: number,
    time: number
  ) => void
  onDoubleClickTrack: (track: SkillTrack, time: number) => void
  onHoverAction: (action: MitigationAction, e: KonvaEventObject<MouseEvent>) => void
  onHoverActionEnd: () => void
  onClickAction: (action: MitigationAction, e: KonvaEventObject<MouseEvent | TouchEvent>) => void
  isReadOnly?: boolean
  bgLayerRef?: RefObject<Konva.Layer | null>
  eventLayerRef?: RefObject<Konva.Layer | null>
  overlayLayerRef?: RefObject<Konva.Layer | null>
  crosshairLineRef?: RefObject<Konva.Line | null>
  trackHighlightRef?: RefObject<Konva.Rect | null>
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

export default function SkillTracksCanvas({
  timeline,
  skillTracks,
  actions,
  actionMap,
  engine,
  invalidCastEventMap,
  draggingId,
  displayActionOverrides,
  zoomLevel,
  timelineWidth,
  trackHeight,
  maxTime,
  selectedCastEventId,
  draggingEventPosition,
  scrollLeft,
  scrollTop,
  viewportWidth,
  onSelectCastEvent,
  onUpdateCastEvent,
  onContextMenu,
  onDoubleClickTrack,
  onHoverAction,
  onHoverActionEnd,
  onClickAction,
  isReadOnly = false,
  bgLayerRef,
  eventLayerRef,
  overlayLayerRef,
  crosshairLineRef,
  trackHighlightRef,
  annotations,
  pinnedAnnotationId,
  onAnnotationHover,
  onAnnotationHoverEnd,
  onAnnotationClick,
  onAnnotationContextMenu,
  onAnnotationDragStart,
  onAnnotationDragEnd,
}: SkillTracksCanvasProps) {
  const colors = useCanvasColors()
  const skillTracksHeight = skillTracks.length * trackHeight

  // 视口裁剪：只渲染可见范围内的元素（含 1 个 viewport 宽度的 buffer）
  const buffer = viewportWidth
  const visibleMinX = scrollLeft - buffer
  const visibleMaxX = scrollLeft + viewportWidth + buffer

  return (
    <>
      <Layer ref={bgLayerRef} x={-scrollLeft} y={-scrollTop}>
        {/* 技能轨道背景（可双击添加技能） */}
        {skillTracks.map((track, index) => (
          <Rect
            key={`track-bg-${track.playerId}-${track.actionId}`}
            x={TIMELINE_START_TIME * zoomLevel}
            y={index * trackHeight}
            width={timelineWidth}
            height={trackHeight}
            fill={index % 2 === 0 ? colors.trackBgEven : colors.trackBgOdd}
            draggableBackground={true}
            onDblClick={e => {
              if (isReadOnly || e.evt.button !== 0) return
              const layer = bgLayerRef?.current
              if (!layer) return
              const pos = layer.getRelativePointerPosition()
              if (!pos) return
              const time = Math.round((pos.x / zoomLevel) * 10) / 10
              onDoubleClickTrack(track, time)
            }}
            onDblTap={() => {
              if (isReadOnly) return
              const layer = bgLayerRef?.current
              if (!layer) return
              const pos = layer.getRelativePointerPosition()
              if (!pos) return
              const time = Math.round((pos.x / zoomLevel) * 10) / 10
              onDoubleClickTrack(track, time)
            }}
            onContextMenu={e => {
              e.evt.preventDefault()
              if (isReadOnly) return
              const layer = bgLayerRef?.current
              if (!layer) return
              const pos = layer.getRelativePointerPosition()
              if (!pos) return
              const time = Math.round((pos.x / zoomLevel) * 10) / 10
              onContextMenu(
                { type: 'skillTrackEmpty', actionId: track.actionId, playerId: track.playerId },
                e.evt.clientX,
                e.evt.clientY,
                time
              )
            }}
          />
        ))}

        {/* 不可放阴影（PlacementEngine 统一：合并 CD + placement 补集，仅编辑模式） */}
        {!isReadOnly &&
          engine &&
          skillTracks.map((track, trackIndex) => {
            const parent = actionMap?.get(track.actionId)
            if (!parent || parent.cooldown < 30) return null
            const groupId = parent.trackGroup ?? parent.id
            const shadow = engine.computeTrackShadow(
              groupId,
              track.playerId,
              draggingId ?? undefined
            )
            return shadow.map((interval, idx) => {
              const left = Math.max(interval.from, TIMELINE_START_TIME) * zoomLevel
              const right = Math.min(interval.to, maxTime) * zoomLevel
              const width = right - left
              if (width <= 0) return null
              if (right < visibleMinX || left > visibleMaxX) return null
              return (
                <Shape
                  key={`track-shadow-${track.playerId}-${track.actionId}-${idx}`}
                  x={left}
                  y={trackIndex * trackHeight}
                  width={width}
                  height={trackHeight}
                  sceneFunc={(kCtx, shape) => {
                    const ctx = kCtx._context
                    const w = shape.width()
                    const h = shape.height()
                    ctx.save()
                    ctx.beginPath()
                    ctx.rect(0, 0, w, h)
                    ctx.clip()
                    const step = 7
                    ctx.strokeStyle = colors.cooldownStripe
                    ctx.lineWidth = colors.cooldownStripeWidth
                    for (let i = -h; i < w + h; i += step) {
                      ctx.beginPath()
                      ctx.moveTo(i, 0)
                      ctx.lineTo(i + h, h)
                      ctx.stroke()
                    }
                    ctx.restore()
                  }}
                  shadowEnabled={false}
                  perfectDrawEnabled={false}
                  listening={false}
                />
              )
            })
          })}

        {/* 鼠标悬浮轨道高亮（由 ref 直接控制） */}
        <Rect
          ref={trackHighlightRef}
          x={TIMELINE_START_TIME * zoomLevel}
          y={0}
          width={timelineWidth}
          height={trackHeight}
          fill={colors.crosshairTrackHighlight}
          listening={false}
          perfectDrawEnabled={false}
          visible={false}
        />

        {/* 技能轨道分隔线 */}
        {skillTracks.map((track, index) => (
          <Line
            key={`track-line-${track.playerId}-${track.actionId}`}
            points={[
              TIMELINE_START_TIME * zoomLevel,
              (index + 1) * trackHeight,
              TIMELINE_START_TIME * zoomLevel + timelineWidth,
              (index + 1) * trackHeight,
            ]}
            stroke={colors.separator}
            strokeWidth={1}
          />
        ))}

        {/* 网格（仅垂直线，视口裁剪） */}
        {(() => {
          const gridStartTick = Math.max(
            Math.ceil(TIMELINE_START_TIME / 10) * 10,
            Math.floor(visibleMinX / zoomLevel / 10) * 10
          )
          const gridEndTick = Math.min(maxTime, Math.ceil(visibleMaxX / zoomLevel / 10) * 10)
          const lines = []
          for (let time = gridStartTick; time <= gridEndTick; time += 10) {
            const x = time * zoomLevel
            lines.push(
              <Line
                key={`grid-${time}`}
                points={[x, 0, x, skillTracksHeight]}
                stroke={time === 0 ? colors.zeroLine : colors.gridLineLight}
                strokeWidth={time === 0 ? 2 : 1}
              />
            )
          }
          return lines
        })()}
      </Layer>

      {/* 技能使用事件层 */}
      <Layer ref={eventLayerRef} x={-scrollLeft} y={-scrollTop}>
        {/* 伤害事件时刻的红色虚线（视口裁剪） */}
        {timeline.damageEvents
          .filter(event => {
            const x =
              draggingEventPosition?.eventId === event.id
                ? draggingEventPosition.x
                : event.time * zoomLevel
            return x >= visibleMinX && x <= visibleMaxX
          })
          .map(event => {
            const x =
              draggingEventPosition?.eventId === event.id
                ? draggingEventPosition.x
                : event.time * zoomLevel

            return (
              <Line
                key={`damage-line-${event.id}`}
                points={[x, 0, x, skillTracksHeight]}
                {...DAMAGE_TIME_LINE_STYLE}
                shadowEnabled={false}
                perfectDrawEnabled={false}
                listening={false}
              />
            )
          })}

        {/* 技能空转时间提示 */}
        {skillTracks.map((track, trackIndex) => {
          // 获取该轨道的所有技能使用记录，按时间排序
          const trackCastEvents = timeline.castEvents
            .filter(
              castEvent =>
                castEvent.playerId === track.playerId && castEvent.actionId === track.actionId
            )
            .sort((a, b) => a.timestamp - b.timestamp)

          if (trackCastEvents.length < 1) return null

          const action = actions.find(a => a.id === track.actionId)
          if (!action) return null

          // 只对冷却时间 >= 40 秒的技能显示空转提示
          if (action.cooldown < 40) return null

          const trackY = trackIndex * trackHeight + trackHeight / 2

          const idleWarnings: ReactElement[] = []

          // 检查第一个技能与战斗开始时间的空转
          const firstCastEvent = trackCastEvents[0]
          const firstTimeDiff = firstCastEvent.timestamp // 战斗开始时间为 0
          if (firstTimeDiff > action.cooldown) {
            const firstIdleTime = firstTimeDiff // 完整的使用时间即为空转时间
            const startX = 0 // 从战斗开始位置
            const endX = firstCastEvent.timestamp * zoomLevel

            // 视口裁剪：跳过完全不可见的空转提示
            if (!(endX < visibleMinX || startX > visibleMaxX)) {
              const centerX = (startX + endX) / 2

              idleWarnings.push(
                <Group key={`idle-start-${firstCastEvent.id}`}>
                  {/* 左侧连接线（从战斗开始 + CD） */}
                  <Line
                    points={[startX, trackY, centerX - 35, trackY]}
                    stroke={colors.idleLine}
                    strokeWidth={1}
                    dash={[4, 4]}
                    opacity={0.6}
                    shadowEnabled={false}
                    perfectDrawEnabled={false}
                    listening={false}
                  />

                  {/* 右侧连接线 */}
                  <Line
                    points={[centerX + 35, trackY, endX, trackY]}
                    stroke={colors.idleLine}
                    strokeWidth={1}
                    dash={[4, 4]}
                    opacity={0.6}
                    shadowEnabled={false}
                    perfectDrawEnabled={false}
                    listening={false}
                  />

                  {/* 空转时间文本 */}
                  <Text
                    x={centerX}
                    y={trackY - 6}
                    text={`空转 ${firstIdleTime.toFixed(1)}s`}
                    fontSize={11}
                    fill="#f59e0b"
                    fontStyle="bold"
                    fontFamily="Arial, sans-serif"
                    align="center"
                    offsetX={30}
                    perfectDrawEnabled={false}
                    listening={false}
                  />
                </Group>
              )
            }
          }

          // 检查每两个相邻技能之间的空转时间
          trackCastEvents.slice(0, -1).forEach((castEvent, index) => {
            const nextCastEvent = trackCastEvents[index + 1]
            const timeDiff = nextCastEvent.timestamp - castEvent.timestamp
            const idleTime = timeDiff - action.cooldown

            // 只显示时间差大于 2 倍冷却时间的情况
            if (timeDiff <= action.cooldown * 2) return

            // 计算提示位置（在两个技能之间的中点）
            const startX = (castEvent.timestamp + action.cooldown) * zoomLevel
            const endX = nextCastEvent.timestamp * zoomLevel

            // 视口裁剪：跳过完全不可见的空转提示
            if (endX < visibleMinX || startX > visibleMaxX) return

            const centerX = (startX + endX) / 2

            idleWarnings.push(
              <Group key={`idle-${castEvent.id}-${nextCastEvent.id}`}>
                {/* 左侧连接线 */}
                <Line
                  points={[startX, trackY, centerX - 35, trackY]}
                  stroke={colors.idleLine}
                  strokeWidth={1}
                  dash={[4, 4]}
                  opacity={0.6}
                  shadowEnabled={false}
                  perfectDrawEnabled={false}
                  listening={false}
                />

                {/* 右侧连接线 */}
                <Line
                  points={[centerX + 35, trackY, endX, trackY]}
                  stroke={colors.idleLine}
                  strokeWidth={1}
                  dash={[4, 4]}
                  opacity={0.6}
                  shadowEnabled={false}
                  perfectDrawEnabled={false}
                  listening={false}
                />

                {/* 空转时间文本 */}
                <Text
                  x={centerX}
                  y={trackY - 6}
                  text={`空转 ${idleTime.toFixed(1)}s`}
                  fontSize={11}
                  fill="#f59e0b"
                  fontStyle="bold"
                  fontFamily="Arial, sans-serif"
                  align="center"
                  offsetX={30}
                  perfectDrawEnabled={false}
                  listening={false}
                />
              </Group>
            )
          })

          return idleWarnings
        })}

        {timeline.castEvents.map(castEvent => {
          const trackIndex = skillTracks.findIndex(
            t => t.playerId === castEvent.playerId && t.actionId === castEvent.actionId
          )

          if (trackIndex === -1) return null

          const action = actions.find(a => a.id === castEvent.actionId)
          if (!action) return null

          // 视口裁剪：跳过完全不可见的 castEvent（考虑 cooldown 条宽度）
          const castX = castEvent.timestamp * zoomLevel
          const cooldownWidth = action.cooldown * zoomLevel
          if (castX + cooldownWidth < visibleMinX || castX > visibleMaxX) return null

          const trackY = trackIndex * trackHeight + trackHeight / 2
          const isSelected = castEvent.id === selectedCastEventId

          const displayAction = displayActionOverrides.get(castEvent.id)

          // engine 基于 placement ∩ CD 算出当前合法区间，作为拖拽边界；未接入 engine 时退化为无约束
          let leftBoundary = TIMELINE_START_TIME
          let rightBoundary = Infinity
          let nextCastTime = Infinity
          if (engine) {
            const intervals = engine.getValidIntervals(action, castEvent.playerId, castEvent.id)
            const cur = intervals.find(
              i => i.from <= castEvent.timestamp && castEvent.timestamp < i.to
            )
            if (cur) {
              leftBoundary = cur.from
              rightBoundary = cur.to
            }
            // 同 playerId 同 trackGroup 的下一 cast，用于 duration 条的短时收窄
            const groupId = action.trackGroup ?? action.id
            const nextSame = timeline.castEvents
              .filter(ce => {
                if (ce.id === castEvent.id) return false
                if (ce.playerId !== castEvent.playerId) return false
                if (ce.timestamp <= castEvent.timestamp) return false
                const other = actionMap?.get(ce.actionId)
                if (!other) return false
                return (other.trackGroup ?? other.id) === groupId
              })
              .sort((a, b) => a.timestamp - b.timestamp)[0]
            if (nextSame) nextCastTime = nextSame.timestamp
          }

          return (
            <CastEventIcon
              key={castEvent.id}
              castEvent={castEvent}
              action={action}
              displayAction={displayAction}
              invalidReason={invalidCastEventMap?.get(castEvent.id) ?? null}
              isSelected={isSelected}
              zoomLevel={zoomLevel}
              trackY={trackY}
              leftBoundary={leftBoundary}
              rightBoundary={rightBoundary}
              nextCastTime={nextCastTime}
              scrollLeft={scrollLeft}
              scrollTop={scrollTop}
              onSelect={() => onSelectCastEvent(castEvent.id)}
              onDragEnd={x => onUpdateCastEvent(castEvent.id, x)}
              onContextMenu={e => {
                e.evt.preventDefault()
                if (isReadOnly) return
                onContextMenu(
                  { type: 'castEvent', castEventId: castEvent.id, actionId: castEvent.actionId },
                  e.evt.clientX,
                  e.evt.clientY,
                  castEvent.timestamp
                )
              }}
              onHover={onHoverAction}
              onHoverEnd={onHoverActionEnd}
              onClickIcon={onClickAction}
              isReadOnly={isReadOnly}
            />
          )
        })}

        {/* 注释图标（视口裁剪） */}
        {annotations
          .filter(a => {
            if (a.anchor.type !== 'skillTrack') return false
            const x = a.time * zoomLevel
            return x >= visibleMinX && x <= visibleMaxX
          })
          .map(annotation => {
            const anchor = annotation.anchor as {
              type: 'skillTrack'
              playerId: number
              actionId: number
            }
            const trackIndex = skillTracks.findIndex(
              t => t.playerId === anchor.playerId && t.actionId === anchor.actionId
            )
            if (trackIndex === -1) return null

            const x = annotation.time * zoomLevel
            const y = trackIndex * trackHeight + trackHeight / 2

            return (
              <AnnotationIcon
                key={`annotation-${annotation.id}`}
                x={x}
                isPinned={pinnedAnnotationId === annotation.id}
                draggable={!isReadOnly && pinnedAnnotationId === annotation.id}
                onDragStart={onAnnotationDragStart}
                onDragEnd={newX => onAnnotationDragEnd(annotation.id, newX)}
                y={y}
                onMouseEnter={(e: KonvaEventObject<MouseEvent>) => {
                  const stage = e.target.getStage()
                  if (!stage) return
                  const box = stage.container().getBoundingClientRect()
                  const parent = e.target.getParent()
                  if (!parent) return
                  const absPos = parent.getAbsolutePosition()
                  onAnnotationHover(annotation, box.left + absPos.x + 8, box.top + absPos.y + 8)
                }}
                onMouseLeave={onAnnotationHoverEnd}
                onClick={(e: KonvaEventObject<MouseEvent>) => {
                  const stage = e.target.getStage()
                  if (!stage) return
                  const box = stage.container().getBoundingClientRect()
                  const parent = e.target.getParent()
                  if (!parent) return
                  const absPos = parent.getAbsolutePosition()
                  onAnnotationClick(annotation, box.left + absPos.x + 8, box.top + absPos.y + 8)
                }}
                onContextMenu={(e: KonvaEventObject<PointerEvent>) => {
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
      </Layer>

      {/* 十字准线叠加层（由 ref 直接控制） */}
      <Layer ref={overlayLayerRef} x={-scrollLeft} y={-scrollTop} listening={false}>
        <Line
          ref={crosshairLineRef}
          points={[0, 0, 0, skillTracksHeight]}
          stroke={colors.crosshairStroke}
          strokeWidth={1}
          listening={false}
          perfectDrawEnabled={false}
          visible={false}
        />
      </Layer>
    </>
  )
}
