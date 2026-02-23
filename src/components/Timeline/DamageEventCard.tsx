/**
 * 单个伤害事件卡片组件
 */

import { Group, Rect, Text } from 'react-konva'
import type { DamageEvent } from '@/types/timeline'
import type { CalculationResult } from '@/utils/mitigationCalculator.v2'

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
  isReadOnly?: boolean
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
  isReadOnly = false,
}: DamageEventCardProps) {
  const x = event.time * zoomLevel
  const y = yOffset + trackHeight / 2

  // 在回放模式下（有 playerDamageDetails），使用实际数据
  let originalDamage = event.damage
  let finalDamage = result.finalDamage
  let mitigationPercent = result.mitigationPercentage.toFixed(1)

  if (event.playerDamageDetails && event.playerDamageDetails.length > 0) {
    // 计算平均原始伤害和平均最终伤害
    const totalUnmitigated = event.playerDamageDetails.reduce(
      (sum, detail) => sum + detail.unmitigatedDamage,
      0
    )
    const totalFinal = event.playerDamageDetails.reduce(
      (sum, detail) => sum + detail.finalDamage,
      0
    )
    const count = event.playerDamageDetails.length

    originalDamage = Math.floor(totalUnmitigated / count)
    finalDamage = Math.floor(totalFinal / count)

    // 重新计算减伤比例
    if (originalDamage > 0) {
      const actualMitigation = ((originalDamage - finalDamage) / originalDamage) * 100
      mitigationPercent = actualMitigation.toFixed(1)
    }
  }

  // 伤害类型颜色映射
  const damageTypeColorMap: Record<string, string> = {
    physical: '#ef4444', // 红色
    magical: '#1e40af',  // 深蓝色
    special: '#c026d3',  // 紫红色
  }
  const nameColor = damageTypeColorMap[event.damageType || 'physical'] || '#ef4444'

  return (
    <Group
      x={x}
      y={y}
      draggable={!isReadOnly}
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
        fill={nameColor}
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
        text={`原始: ${originalDamage.toLocaleString()}`}
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
    </Group>
  )
}
