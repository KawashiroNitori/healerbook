/**
 * 技能轨道 Canvas 区域组件
 */

import { Layer, Line, Rect } from 'react-konva'
import CastEventIcon from './CastEventIcon'
import type { SkillTrack } from './SkillTrackLabels'
import type { Timeline } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

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
  onSelectCastEvent: (id: string) => void
  onUpdateCastEvent: (id: string, x: number) => void
  onContextMenu: (castEventId: string) => void
  onDoubleClickTrack: (track: SkillTrack, time: number) => void
  isReadOnly?: boolean
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
  onSelectCastEvent,
  onUpdateCastEvent,
  onContextMenu,
  onDoubleClickTrack,
  isReadOnly = false,
}: SkillTracksCanvasProps) {
  const skillTracksHeight = skillTracks.length * trackHeight

  return (
    <>
      <Layer>
        {/* 技能轨道背景（可双击添加技能） */}
        {skillTracks.map((track, index) => (
          <Rect
            key={`track-bg-${track.playerId}-${track.actionId}`}
            x={0}
            y={index * trackHeight}
            width={timelineWidth}
            height={trackHeight}
            fill={index % 2 === 0 ? '#fafafa' : '#ffffff'}
            draggableBackground={true}
            onDblClick={(e) => {
              if (isReadOnly) return
              const stage = e.target.getStage()
              if (!stage) return

              const pointerPos = stage.getPointerPosition()
              if (!pointerPos) return

              const time = Math.round((pointerPos.x / zoomLevel) * 10) / 10
              onDoubleClickTrack(track, time)
            }}
          />
        ))}

        {/* 技能轨道分隔线 */}
        {skillTracks.map((track, index) => (
          <Line
            key={`track-line-${track.playerId}-${track.actionId}`}
            points={[0, (index + 1) * trackHeight, timelineWidth, (index + 1) * trackHeight]}
            stroke="#e5e7eb"
            strokeWidth={1}
          />
        ))}

        {/* 网格（仅垂直线） */}
        {Array.from({ length: Math.ceil(maxTime / 10) + 1 }).map((_, i) => {
          const time = i * 10
          const x = time * zoomLevel
          return (
            <Line
              key={`grid-${i}`}
              points={[x, 0, x, skillTracksHeight]}
              stroke="#f3f4f6"
              strokeWidth={1}
            />
          )
        })}
      </Layer>

      {/* 技能使用事件层 */}
      <Layer>
        {/* 伤害事件时刻的红色虚线 */}
        {timeline.damageEvents.map((event) => {
          const x =
            draggingEventPosition?.eventId === event.id
              ? draggingEventPosition.x
              : event.time * zoomLevel

          return (
            <Line
              key={`damage-line-${event.id}`}
              points={[x, 0, x, skillTracksHeight]}
              stroke="#ef4444"
              strokeWidth={2}
              dash={[5, 5]}
              shadowEnabled={false}
              perfectDrawEnabled={false}
              listening={false}
            />
          )
        })}

        {timeline.castEvents.map((castEvent) => {
          const trackIndex = skillTracks.findIndex(
            (t) => t.playerId === castEvent.playerId && t.actionId === castEvent.actionId
          )

          if (trackIndex === -1) return null

          const trackY = trackIndex * trackHeight + trackHeight / 2
          const isSelected = castEvent.id === selectedCastEventId

          const action = actions.find((a) => a.id === castEvent.actionId)
          if (!action) return null

          const castEventTimeSeconds = castEvent.timestamp / 1000

          // 计算拖动边界
          const sameTrackCastEvents = timeline.castEvents
            .filter(
              (other) =>
                other.id !== castEvent.id &&
                other.playerId === castEvent.playerId &&
                other.actionId === castEvent.actionId
            )
            .map((other) => {
              const otherAction = actions.find((a) => a.id === other.actionId)
              const otherTimeSeconds = other.timestamp / 1000
              return {
                startTime: otherTimeSeconds,
                endTime: otherTimeSeconds + (otherAction?.cooldown || 0),
              }
            })
            .sort((a, b) => a.startTime - b.startTime)

          const currentDuration = action.cooldown

          const leftBoundary = sameTrackCastEvents
            .filter((other) => other.endTime <= castEventTimeSeconds)
            .reduce((max, other) => Math.max(max, other.endTime), 0)

          const rightBoundary = sameTrackCastEvents
            .filter((other) => other.startTime >= castEventTimeSeconds + currentDuration)
            .reduce((min, other) => Math.min(min, other.startTime - currentDuration), Infinity)

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
              onSelect={() => onSelectCastEvent(castEvent.id)}
              onDragEnd={(x) => onUpdateCastEvent(castEvent.id, x)}
              onContextMenu={(e) => {
                if (isReadOnly) return
                e.evt.preventDefault()
                onContextMenu(castEvent.id)
              }}
              isReadOnly={isReadOnly}
            />
          )
        })}
      </Layer>
    </>
  )
}
