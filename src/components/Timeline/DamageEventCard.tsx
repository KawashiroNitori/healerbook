/**
 * 单个伤害事件卡片组件
 */

import { Group, Rect, Text } from 'react-konva'
import type { DamageEvent } from '@/types/timeline'

interface DamageEventCardProps {
  event: DamageEvent
  isSelected: boolean
  zoomLevel: number
  rowHeight: number
  row: number
  yOffset: number
  onSelect: () => void
  onDragStart: () => void
  onDragMove: (x: number) => void
  onDragEnd: (x: number) => void
  isReadOnly?: boolean
}

export default function DamageEventCard({
  event,
  isSelected,
  zoomLevel,
  rowHeight,
  row,
  yOffset,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  isReadOnly = false,
}: DamageEventCardProps) {
  const x = event.time * zoomLevel
  const y = yOffset + row * rowHeight + rowHeight / 2

  const damageTypeColorMap: Record<string, string> = {
    physical: '#ef4444',
    magical: '#1e40af',
    special: '#c026d3',
  }
  const nameColor = damageTypeColorMap[event.damageType || 'physical'] || '#ef4444'

  return (
    <Group
      x={x}
      y={y}
      draggable={!isReadOnly}
      dragBoundFunc={pos => ({
        x: Math.max(0, pos.x),
        y: y,
      })}
      onClick={onSelect}
      onTap={onSelect}
      onDragStart={onDragStart}
      onDragMove={e => {
        onDragMove(e.target.x())
        e.target.getStage()?.batchDraw()
      }}
      onDragEnd={e => {
        onDragEnd(e.target.x())
      }}
    >
      {/* 背景矩形 */}
      <Rect
        x={0}
        y={-15}
        width={150}
        height={30}
        fill="#ffffff"
        stroke={isSelected ? '#3b82f6' : '#d1d5db'}
        strokeWidth={isSelected ? 2 : 1}
        cornerRadius={4}
        shadowEnabled={false}
        perfectDrawEnabled={false}
      />

      {/* 技能名称 */}
      <Text
        x={5}
        y={-15}
        width={140}
        height={30}
        text={event.name}
        fontSize={13}
        fill={nameColor}
        fontStyle="bold"
        fontFamily="Arial, sans-serif"
        wrap="none"
        ellipsis={true}
        verticalAlign="middle"
        perfectDrawEnabled={false}
        listening={false}
      />
    </Group>
  )
}
