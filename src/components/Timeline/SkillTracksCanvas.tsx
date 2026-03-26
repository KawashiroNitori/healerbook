/**
 * 技能轨道 Canvas 区域组件
 */

import type { ReactElement, RefObject } from 'react'
import { Group, Layer, Line, Rect, Text } from 'react-konva'
import type Konva from 'konva'
import CastEventIcon from './CastEventIcon'
import {
  CROSSHAIR_VERTICAL_LINE_STYLE,
  CROSSHAIR_TRACK_HIGHLIGHT_COLOR,
  DAMAGE_TIME_LINE_STYLE,
  TIMELINE_START_TIME,
} from './constants'
import type { SkillTrack } from './SkillTrackLabels'
import type { Timeline } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { KonvaEventObject } from 'konva/lib/Node'

interface SkillTracksCanvasProps {
  timeline: Timeline
  skillTracks: SkillTrack[]
  actions: MitigationAction[]
  zoomLevel: number
  timelineWidth: number
  trackHeight: number
  maxTime: number
  selectedCastEventId: string | null
  draggingEventPosition: { eventId: string; x: number } | null
  scrollLeft: number
  scrollTop: number
  onSelectCastEvent: (id: string) => void
  onUpdateCastEvent: (id: string, x: number) => void
  onContextMenu: (castEventId: string) => void
  onDoubleClickTrack: (track: SkillTrack, time: number) => void
  onHoverAction: (action: MitigationAction, e: KonvaEventObject<MouseEvent>) => void
  onClickAction: (action: MitigationAction, e: KonvaEventObject<MouseEvent | TouchEvent>) => void
  isReadOnly?: boolean
  bgLayerRef?: RefObject<Konva.Layer | null>
  eventLayerRef?: RefObject<Konva.Layer | null>
  overlayLayerRef?: RefObject<Konva.Layer | null>
  hoverTrackIndex: number | null
  hoverTimeX: number | null // 鼠标时间对应的像素 X 坐标（Layer 坐标系）
}

export default function SkillTracksCanvas({
  timeline,
  skillTracks,
  actions,
  zoomLevel,
  timelineWidth,
  trackHeight,
  maxTime,
  selectedCastEventId,
  draggingEventPosition,
  scrollLeft,
  scrollTop,
  onSelectCastEvent,
  onUpdateCastEvent,
  onContextMenu,
  onDoubleClickTrack,
  onHoverAction,
  onClickAction,
  isReadOnly = false,
  bgLayerRef,
  eventLayerRef,
  overlayLayerRef,
  hoverTrackIndex,
  hoverTimeX,
}: SkillTracksCanvasProps) {
  const skillTracksHeight = skillTracks.length * trackHeight

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
            fill={index % 2 === 0 ? '#fafafa' : '#ffffff'}
            draggableBackground={true}
            onDblClick={e => {
              if (isReadOnly) return
              const stage = e.target.getStage()
              if (!stage) return

              const pointerPos = stage.getPointerPosition()
              if (!pointerPos) return

              const time = Math.round(((pointerPos.x + scrollLeft) / zoomLevel) * 10) / 10
              onDoubleClickTrack(track, time)
            }}
            onDblTap={e => {
              if (isReadOnly) return
              const stage = e.target.getStage()
              if (!stage) return

              const pointerPos = stage.getPointerPosition()
              if (!pointerPos) return

              const time = Math.round(((pointerPos.x + scrollLeft) / zoomLevel) * 10) / 10
              onDoubleClickTrack(track, time)
            }}
          />
        ))}

        {/* 鼠标悬浮轨道高亮 */}
        {hoverTrackIndex != null &&
          hoverTrackIndex >= 0 &&
          hoverTrackIndex < skillTracks.length && (
            <Rect
              x={TIMELINE_START_TIME * zoomLevel}
              y={hoverTrackIndex * trackHeight}
              width={timelineWidth}
              height={trackHeight}
              fill={CROSSHAIR_TRACK_HIGHLIGHT_COLOR}
              listening={false}
              perfectDrawEnabled={false}
            />
          )}

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
            stroke="#e5e7eb"
            strokeWidth={1}
          />
        ))}

        {/* 网格（仅垂直线） */}
        {(() => {
          const startTick = Math.ceil(TIMELINE_START_TIME / 10) * 10
          const lines = []
          for (let time = startTick; time <= maxTime; time += 10) {
            const x = time * zoomLevel
            lines.push(
              <Line
                key={`grid-${time}`}
                points={[x, 0, x, skillTracksHeight]}
                stroke={time === 0 ? '#9ca3af' : '#f3f4f6'}
                strokeWidth={time === 0 ? 2 : 1}
              />
            )
          }
          return lines
        })()}
      </Layer>

      {/* 技能使用事件层 */}
      <Layer ref={eventLayerRef} x={-scrollLeft} y={-scrollTop}>
        {/* 伤害事件时刻的红色虚线 */}
        {timeline.damageEvents.map(event => {
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
            const centerX = (startX + endX) / 2

            idleWarnings.push(
              <Group key={`idle-start-${firstCastEvent.id}`}>
                {/* 左侧连接线（从战斗开始 + CD） */}
                <Line
                  points={[startX, trackY, centerX - 35, trackY]}
                  stroke="#d1d5db"
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
                  stroke="#d1d5db"
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
            const centerX = (startX + endX) / 2

            idleWarnings.push(
              <Group key={`idle-${castEvent.id}-${nextCastEvent.id}`}>
                {/* 左侧连接线 */}
                <Line
                  points={[startX, trackY, centerX - 35, trackY]}
                  stroke="#d1d5db"
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
                  stroke="#d1d5db"
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

          const trackY = trackIndex * trackHeight + trackHeight / 2
          const isSelected = castEvent.id === selectedCastEventId

          const action = actions.find(a => a.id === castEvent.actionId)
          if (!action) return null

          const castEventTimeSeconds = castEvent.timestamp // timestamp 已经是秒

          // 计算拖动边界
          const sameTrackCastEvents = timeline.castEvents
            .filter(
              other =>
                other.id !== castEvent.id &&
                other.playerId === castEvent.playerId &&
                other.actionId === castEvent.actionId
            )
            .map(other => {
              const otherAction = actions.find(a => a.id === other.actionId)
              const otherTimeSeconds = other.timestamp // timestamp 已经是秒
              return {
                startTime: otherTimeSeconds,
                endTime: otherTimeSeconds + (otherAction?.cooldown || 0),
              }
            })
            .sort((a, b) => a.startTime - b.startTime)

          const currentDuration = action.cooldown

          const leftBoundary = sameTrackCastEvents
            .filter(other => other.endTime <= castEventTimeSeconds)
            .reduce((max, other) => Math.max(max, other.endTime), TIMELINE_START_TIME)

          const rightBoundary = sameTrackCastEvents
            .filter(other => other.startTime >= castEventTimeSeconds + currentDuration)
            .reduce((min, other) => Math.min(min, other.startTime - currentDuration), Infinity)

          const nextCastTime = sameTrackCastEvents
            .filter(other => other.startTime > castEventTimeSeconds)
            .reduce((min, other) => Math.min(min, other.startTime), Infinity)

          return (
            <CastEventIcon
              key={castEvent.id}
              castEvent={castEvent}
              action={action}
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
                if (isReadOnly) return
                e.evt.preventDefault()
                onContextMenu(castEvent.id)
              }}
              onHover={onHoverAction}
              onClickIcon={onClickAction}
              isReadOnly={isReadOnly}
            />
          )
        })}
      </Layer>

      {/* 十字准线叠加层 */}
      <Layer ref={overlayLayerRef} x={-scrollLeft} y={-scrollTop} listening={false}>
        {hoverTimeX != null && (
          <Line
            points={[hoverTimeX, 0, hoverTimeX, skillTracksHeight]}
            {...CROSSHAIR_VERTICAL_LINE_STYLE}
            listening={false}
            perfectDrawEnabled={false}
          />
        )}
      </Layer>
    </>
  )
}
