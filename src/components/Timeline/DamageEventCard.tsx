/**
 * 单个伤害事件卡片组件
 */

import { Group, Rect, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { DamageEvent, DamageType } from '@/types/timeline'
import { useDamageCalculationResults } from '@/contexts/DamageCalculationContext'

let _measureCtx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d')!
  return _measureCtx
}

function truncateText(text: string, maxWidth: number, font: string): string {
  const ctx = getMeasureCtx()
  ctx.font = font
  if (ctx.measureText(text).width <= maxWidth) return text
  const ellipsisWidth = ctx.measureText('...').width
  let i = text.length
  while (i > 0 && ctx.measureText(text.slice(0, i)).width + ellipsisWidth > maxWidth) i--
  return text.slice(0, i) + '...'
}

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
  onContextMenu?: (e: KonvaEventObject<PointerEvent>) => void
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
  onContextMenu,
}: DamageEventCardProps) {
  const calculationResults = useDamageCalculationResults()
  const calculatedEvent = calculationResults.get(event.id)
  const isTankbuster = event.type === 'tankbuster'
  const x = event.time * zoomLevel
  const y = yOffset + row * rowHeight + rowHeight / 2

  const damageTypeColorMap: Record<DamageType, string> = {
    physical: '#ef4444',
    magical: '#1e40af',
    darkness: '#c026d3',
  }
  const nameColor = damageTypeColorMap[event.damageType || 'physical'] || '#ef4444'

  const hasOverkill =
    event.playerDamageDetails?.some(
      d => (d.overkill ?? 0) > 0 && !d.statuses.some(s => s.statusId === 810)
    ) ?? false

  // 编辑模式警示（referenceMaxHP 仅编辑模式存在）
  const refHP = calculatedEvent?.referenceMaxHP
  const isLethal = !hasOverkill && refHP != null && calculatedEvent!.finalDamage >= refHP
  const isDangerous =
    !hasOverkill && !isLethal && refHP != null && calculatedEvent!.finalDamage >= refHP * 0.9

  const getDamageText = (): string => {
    if (isTankbuster) return '死刑'
    const displayDamage = hasOverkill ? calculatedEvent?.maxDamage : calculatedEvent?.finalDamage
    if (displayDamage === undefined) return ''
    return displayDamage >= 10000
      ? `${(displayDamage / 10000).toFixed(1)}w`
      : displayDamage.toLocaleString()
  }
  const damageText = getDamageText()

  const nameAreaWidth = damageText ? 90 : 140
  const nameXOffset = hasOverkill || isLethal || isDangerous ? 20 : 5
  const displayName = truncateText(
    event.name,
    nameAreaWidth - (nameXOffset - 5),
    'bold 13px Arial, sans-serif'
  )

  return (
    <Group
      x={x}
      y={y}
      draggable={isSelected && !isReadOnly}
      dragBoundFunc={pos => ({
        x: pos.x,
        y: y,
      })}
      onClick={onSelect}
      onTap={onSelect}
      onMouseEnter={e => {
        const stage = e.target.getStage()
        if (stage) stage.container().style.cursor = 'pointer'
      }}
      onMouseLeave={e => {
        const stage = e.target.getStage()
        if (stage) stage.container().style.cursor = 'default'
      }}
      onDragStart={onDragStart}
      onDragMove={e => {
        onDragMove(e.target.x())
        e.target.getStage()?.batchDraw()
      }}
      onDragEnd={e => {
        onDragEnd(e.target.x())
      }}
      onContextMenu={onContextMenu}
    >
      {/* 背景矩形 */}
      <Rect
        x={0}
        y={-15}
        width={150}
        height={30}
        fill={isTankbuster ? '#f9fafb' : '#ffffff'}
        stroke={isSelected ? '#3b82f6' : isTankbuster ? '#9ca3af' : '#d1d5db'}
        strokeWidth={isSelected ? 2 : 1}
        dash={isTankbuster && !isSelected ? [4, 3] : undefined}
        cornerRadius={4}
        opacity={isTankbuster ? 0.7 : 1}
        shadowEnabled={false}
        perfectDrawEnabled={false}
      />

      {/* 技能名称 */}
      <Text
        x={nameXOffset}
        y={-15}
        width={nameAreaWidth}
        height={30}
        text={displayName}
        fontSize={13}
        fill={nameColor}
        fontStyle="bold"
        fontFamily="Arial, sans-serif"
        wrap="none"
        ellipsis={false}
        verticalAlign="middle"
        perfectDrawEnabled={false}
        listening={false}
      />

      {/* 死亡图标（回放模式） */}
      {hasOverkill && (
        <Text
          x={3}
          y={-15}
          width={18}
          height={30}
          text="💀"
          fontSize={12}
          verticalAlign="middle"
          perfectDrawEnabled={false}
          listening={false}
        />
      )}

      {/* 致死警示（编辑模式） */}
      {isLethal && (
        <Text
          x={3}
          y={-15}
          width={18}
          height={30}
          text="⚠"
          fontSize={13}
          fill="#dc2626"
          fontStyle="bold"
          verticalAlign="middle"
          perfectDrawEnabled={false}
          listening={false}
        />
      )}

      {/* 危险警示（编辑模式） */}
      {isDangerous && (
        <Text
          x={3}
          y={-15}
          width={18}
          height={30}
          text="⚠"
          fontSize={13}
          fill="#f59e0b"
          fontStyle="bold"
          verticalAlign="middle"
          perfectDrawEnabled={false}
          listening={false}
        />
      )}

      {/* 最终伤害数值 */}
      {damageText && (
        <Text
          x={95}
          y={-15}
          width={50}
          height={30}
          text={damageText}
          fontSize={12}
          fill="#6b7280"
          fontFamily="Arial, sans-serif"
          wrap="none"
          align="right"
          verticalAlign="middle"
          perfectDrawEnabled={false}
          listening={false}
        />
      )}
    </Group>
  )
}
