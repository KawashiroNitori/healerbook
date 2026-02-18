/**
 * 时间轴 Canvas 组件
 */

import { useRef, useEffect } from 'react'
import { Stage, Layer, Rect, Line, Text, Group } from 'react-konva'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import type { DamageEvent, MitigationAssignment } from '@/types/timeline'

interface TimelineCanvasProps {
  width: number
  height: number
}

export default function TimelineCanvas({ width, height }: TimelineCanvasProps) {
  const stageRef = useRef<any>(null)
  const { timeline, currentTime, zoomLevel, selectedEventId, selectEvent } = useTimelineStore()
  const { showGrid, showTimeRuler } = useUIStore()

  if (!timeline) {
    return (
      <div
        className="flex items-center justify-center bg-muted/20"
        style={{ width, height }}
      >
        <p className="text-muted-foreground">未加载时间轴</p>
      </div>
    )
  }

  // 计算时间轴总长度 (秒)
  const maxTime = Math.max(
    ...timeline.damageEvents.map((e) => e.time),
    ...timeline.mitigationAssignments.map((a) => a.time),
    600 // 最小 10 分钟
  )

  const timelineWidth = maxTime * zoomLevel

  return (
    <div className="relative overflow-auto bg-background" style={{ width, height }}>
      <Stage width={Math.max(width, timelineWidth)} height={height} ref={stageRef}>
        {/* 背景层 */}
        <Layer>
          <Rect x={0} y={0} width={timelineWidth} height={height} fill="#fafafa" />
        </Layer>

        {/* 网格层 */}
        {showGrid && <GridLayer width={timelineWidth} height={height} zoomLevel={zoomLevel} />}

        {/* 时间标尺层 */}
        {showTimeRuler && (
          <TimeRulerLayer width={timelineWidth} maxTime={maxTime} zoomLevel={zoomLevel} />
        )}

        {/* 伤害事件层 */}
        <DamageEventsLayer
          events={timeline.damageEvents}
          zoomLevel={zoomLevel}
          selectedEventId={selectedEventId}
          onSelectEvent={selectEvent}
        />

        {/* 减伤分配层 */}
        <MitigationAssignmentsLayer
          assignments={timeline.mitigationAssignments}
          events={timeline.damageEvents}
          zoomLevel={zoomLevel}
        />

        {/* 当前时间指示器 */}
        <Layer>
          <Line
            points={[currentTime * zoomLevel, 0, currentTime * zoomLevel, height]}
            stroke="#ef4444"
            strokeWidth={2}
            dash={[5, 5]}
          />
        </Layer>
      </Stage>
    </div>
  )
}

/**
 * 网格层
 */
function GridLayer({
  width,
  height,
  zoomLevel,
}: {
  width: number
  height: number
  zoomLevel: number
}) {
  const lines: JSX.Element[] = []

  // 垂直网格线 (每 10 秒)
  const interval = 10
  const step = interval * zoomLevel

  for (let x = 0; x <= width; x += step) {
    lines.push(
      <Line
        key={`v-${x}`}
        points={[x, 0, x, height]}
        stroke="#e5e7eb"
        strokeWidth={1}
        opacity={0.5}
      />
    )
  }

  // 水平网格线 (每 50 像素)
  for (let y = 0; y <= height; y += 50) {
    lines.push(
      <Line
        key={`h-${y}`}
        points={[0, y, width, y]}
        stroke="#e5e7eb"
        strokeWidth={1}
        opacity={0.3}
      />
    )
  }

  return <Layer>{lines}</Layer>
}

/**
 * 时间标尺层
 */
function TimeRulerLayer({
  width,
  maxTime,
  zoomLevel,
}: {
  width: number
  maxTime: number
  zoomLevel: number
}) {
  const labels: JSX.Element[] = []
  const interval = 10 // 每 10 秒一个标签

  for (let time = 0; time <= maxTime; time += interval) {
    const x = time * zoomLevel

    labels.push(
      <Group key={time}>
        <Rect x={x - 25} y={5} width={50} height={20} fill="#ffffff" opacity={0.9} />
        <Text
          x={x - 25}
          y={10}
          width={50}
          text={`${time}s`}
          fontSize={12}
          fill="#374151"
          align="center"
        />
      </Group>
    )
  }

  return <Layer>{labels}</Layer>
}

/**
 * 伤害事件层
 */
function DamageEventsLayer({
  events,
  zoomLevel,
  selectedEventId,
  onSelectEvent,
}: {
  events: DamageEvent[]
  zoomLevel: number
  selectedEventId: string | null
  onSelectEvent: (id: string | null) => void
}) {
  return (
    <Layer>
      {events.map((event) => {
        const x = event.time * zoomLevel
        const isSelected = event.id === selectedEventId

        return (
          <Group
            key={event.id}
            x={x}
            y={100}
            onClick={() => onSelectEvent(event.id)}
            onTap={() => onSelectEvent(event.id)}
          >
            {/* 事件矩形 */}
            <Rect
              x={-30}
              y={-20}
              width={60}
              height={40}
              fill={isSelected ? '#3b82f6' : '#6366f1'}
              cornerRadius={4}
              shadowBlur={isSelected ? 10 : 5}
              shadowColor="black"
              shadowOpacity={0.3}
            />

            {/* 事件名称 */}
            <Text
              x={-25}
              y={-10}
              width={50}
              text={event.name}
              fontSize={10}
              fill="#ffffff"
              align="center"
              ellipsis={true}
            />

            {/* 伤害值 */}
            <Text
              x={-25}
              y={2}
              width={50}
              text={event.damage.toString()}
              fontSize={9}
              fill="#ffffff"
              align="center"
            />
          </Group>
        )
      })}
    </Layer>
  )
}

/**
 * 减伤分配层
 */
function MitigationAssignmentsLayer({
  assignments,
  events,
  zoomLevel,
}: {
  assignments: MitigationAssignment[]
  events: DamageEvent[]
  zoomLevel: number
}) {
  return (
    <Layer>
      {assignments.map((assignment) => {
        const x = assignment.time * zoomLevel
        const event = events.find((e) => e.id === assignment.damageEventId)
        const yOffset = event ? 150 : 200

        return (
          <Group key={assignment.id} x={x} y={yOffset}>
            {/* 技能图标占位 */}
            <Rect
              x={-15}
              y={-15}
              width={30}
              height={30}
              fill="#10b981"
              cornerRadius={4}
              shadowBlur={3}
              shadowColor="black"
              shadowOpacity={0.2}
            />

            {/* 职业标签 */}
            <Text
              x={-15}
              y={-10}
              width={30}
              text={assignment.job}
              fontSize={8}
              fill="#ffffff"
              align="center"
            />
          </Group>
        )
      })}
    </Layer>
  )
}
