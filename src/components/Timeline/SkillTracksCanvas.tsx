/**
 * 技能轨道 Canvas 区域组件
 */

import { Layer, Line, Rect } from 'react-konva'
import MitigationAssignmentIcon from './MitigationAssignmentIcon'
import type { SkillTrack } from './SkillTrackLabels'
import type { Timeline, MitigationAssignment, Job } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

interface SkillTracksCanvasProps {
  timeline: Timeline
  skillTracks: SkillTrack[]
  actions: MitigationAction[]
  zoomLevel: number
  timelineWidth: number
  trackHeight: number
  maxTime: number
  selectedAssignmentId: string | null
  draggingEventPosition: { eventId: string; x: number } | null
  onSelectAssignment: (id: string) => void
  onUpdateAssignment: (id: string, x: number) => void
  onContextMenu: (assignmentId: string) => void
  onDoubleClickTrack: (track: SkillTrack, time: number) => void
}

export default function SkillTracksCanvas({
  timeline,
  skillTracks,
  actions,
  zoomLevel,
  timelineWidth,
  trackHeight,
  maxTime,
  selectedAssignmentId,
  draggingEventPosition,
  onSelectAssignment,
  onUpdateAssignment,
  onContextMenu,
  onDoubleClickTrack,
}: SkillTracksCanvasProps) {
  const skillTracksHeight = skillTracks.length * trackHeight

  return (
    <>
      <Layer>
        {/* 技能轨道背景（可双击添加技能） */}
        {skillTracks.map((track, index) => (
          <Rect
            key={`track-bg-${track.job}-${track.actionId}`}
            x={0}
            y={index * trackHeight}
            width={timelineWidth}
            height={trackHeight}
            fill={index % 2 === 0 ? '#fafafa' : '#ffffff'}
            draggableBackground={true}
            onDblClick={(e) => {
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
            key={`track-line-${track.job}-${track.actionId}`}
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

      {/* 减伤分配层 */}
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

        {timeline.mitigationAssignments.map((assignment) => {
          const trackIndex = skillTracks.findIndex(
            (t) => t.job === assignment.job && t.actionId === assignment.actionId
          )

          if (trackIndex === -1) return null

          const trackY = trackIndex * trackHeight + trackHeight / 2
          const isSelected = assignment.id === selectedAssignmentId

          const action = actions.find((a) => a.id === assignment.actionId)
          if (!action) return null

          // 计算拖动边界
          const sameTrackAssignments = timeline.mitigationAssignments
            .filter(
              (other) =>
                other.id !== assignment.id &&
                other.job === assignment.job &&
                other.actionId === assignment.actionId
            )
            .map((other) => {
              const otherAction = actions.find((a) => a.id === other.actionId)
              return {
                startTime: other.time,
                endTime: other.time + (otherAction?.cooldown || 0),
              }
            })
            .sort((a, b) => a.startTime - b.startTime)

          const currentDuration = action.cooldown

          const leftBoundary = sameTrackAssignments
            .filter((other) => other.endTime <= assignment.time)
            .reduce((max, other) => Math.max(max, other.endTime), 0)

          const rightBoundary = sameTrackAssignments
            .filter((other) => other.startTime >= assignment.time + currentDuration)
            .reduce((min, other) => Math.min(min, other.startTime - currentDuration), Infinity)

          return (
            <MitigationAssignmentIcon
              key={assignment.id}
              assignment={assignment}
              action={action}
              isSelected={isSelected}
              zoomLevel={zoomLevel}
              trackY={trackY}
              leftBoundary={leftBoundary}
              rightBoundary={rightBoundary}
              onSelect={() => onSelectAssignment(assignment.id)}
              onDragEnd={(x) => onUpdateAssignment(assignment.id, x)}
              onContextMenu={(e) => {
                e.evt.preventDefault()
                onContextMenu(assignment.id)
              }}
            />
          )
        })}
      </Layer>
    </>
  )
}
