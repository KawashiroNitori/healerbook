/**
 * 单个伤害事件卡片组件
 */

import { Group, Rect, Text } from 'react-konva'
import type { DamageEvent } from '@/types/timeline'
import type { CalculationResult } from '@/utils/mitigationCalculator'

interface DamageEventCardProps {
  event: DamageEvent
  result: CalculationResult
  isSelected: boolean
  zoomLevel: number
  trackHeight: number
  yOffset: number
  onSelect: () => void
  onDragStart: () => void
  onDragMove: (x: number) => void
  onDragEnd: (x: number) => void
}

export default function DamageEventCard({
  event,
  result,
  isSelected,
  zoomLevel,
  trackHeight,
  yOffset,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: DamageEventCardProps) {
  const x = event.time * zoomLevel
  const y = yOffset + trackHeight / 2
  const finalDamage = result.finalDamage
  const mitigationPercent = result.mitigationPercentage.toFixed(1)

  // 伤害类型映射
  const damageTypeMap: Record<string, string> = {
    physical: '物理',
    magical: '魔法',
    special: '特殊',
  }
  const damageTypeText = damageTypeMap[event.damageType || 'physical'] || '物理'

  return (
    <Group
      x={x}
      y={y}
      draggable
      dragBoundFunc={(pos) => ({
        x: Math.max(0, pos.x),
        y: y,
      })}
      onClick={onSelect}
      onTap={onSelect}
      onDragStart={onDragStart}
      onDragMove={(e) => {
        onDragMove(e.target.x())
        e.target.getStage()?.batchDraw()
      }}
      onDragEnd={(e) => {
        onDragEnd(e.target.x())
      }}
    >
      {/* 白色背景矩形 */}
      <Rect
        x={0}
        y={-40}
        width={150}
        height={80}
        fill="#ffffff"
        stroke={isSelected ? '#3b82f6' : '#d1d5db'}
        strokeWidth={isSelected ? 2 : 1}
        cornerRadius={4}
        shadowEnabled={false}
        perfectDrawEnabled={false}
      />

      {/* 伤害名称 */}
      <Text
        x={5}
        y={-35}
        width={140}
        text={event.name}
        fontSize={14}
        fill="#000000"
        fontStyle="bold"
        fontFamily="Arial, sans-serif"
        wrap="none"
        ellipsis={true}
        perfectDrawEnabled={false}
        listening={false}
      />

      {/* 原始伤害 */}
      <Text
        x={5}
        y={-18}
        text={`原始: ${event.damage.toLocaleString()}`}
        fontSize={12}
        fill="#6b7280"
        fontFamily="Arial, sans-serif"
        perfectDrawEnabled={false}
        listening={false}
      />

      {/* 最终伤害 */}
      <Text
        x={5}
        y={0}
        text={`最终: ${finalDamage.toLocaleString()}`}
        fontSize={12}
        fill="#10b981"
        fontStyle="bold"
        fontFamily="Arial, sans-serif"
        perfectDrawEnabled={false}
        listening={false}
      />

      {/* 减伤比例 */}
      <Text
        x={5}
        y={18}
        text={`减伤: ${mitigationPercent}%`}
        fontSize={12}
        fill="#ef4444"
        fontFamily="Arial, sans-serif"
        perfectDrawEnabled={false}
        listening={false}
      />

      {/* 右上角伤害类型 */}
      <Text
        x={125}
        y={-35}
        text={damageTypeText}
        fontSize={11}
        fill="##9ca3af"
        fontFamily="Arial, sans-serif"
        align="right"
        perfectDrawEnabled={false}
        listening={false}
      />
    </Group>
  )
}
