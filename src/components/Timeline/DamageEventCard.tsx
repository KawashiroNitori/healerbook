/**
 * 单个伤害事件卡片组件
 */

import { memo } from 'react'
import { Group, Rect, RegularPolygon, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { DamageEvent, DamageType } from '@/types/timeline'
import { useDamageCalculationResults } from '@/contexts/DamageCalculationContext'
import { useUIStore } from '@/store/uiStore'
import { formatDamageValue } from '@/utils/formatters'
import { deriveLethalDangerous } from '@/utils/lethalDanger'
import { useCanvasColors, TIMELINE_START_TIME } from './constants'
import { computeDamageCardGeometry } from './cardGeometry'
import { useTimelineStore } from '@/store/timelineStore'

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
  /** 多选群组拖动期间的 x 偏移（像素）；其余时间为 0 */
  dragOffsetX?: number
  onSelect: () => void
  onDragStart: () => void
  onDragMove: (x: number) => void
  onDragEnd: (x: number) => void
  isReadOnly?: boolean
  onContextMenu?: (e: KonvaEventObject<PointerEvent>) => void
  reportDamageDrag?: (eventId: string, x: number) => void
  onDiamondDragEnd?: (eventId: string, newTime: number) => void
}

const DamageEventCard = memo(function DamageEventCard({
  event,
  isSelected,
  zoomLevel,
  rowHeight,
  row,
  yOffset,
  dragOffsetX = 0,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  isReadOnly = false,
  onContextMenu,
  reportDamageDrag,
  onDiamondDragEnd,
}: DamageEventCardProps) {
  const colors = useCanvasColors()
  const soleSelected = useTimelineStore(
    s =>
      s.selectedEventIds.length === 1 &&
      s.selectedCastEventIds.length === 0 &&
      s.selectedAnnotationIds.length === 0
  )
  const diamondDraggable = isSelected && soleSelected && !isReadOnly
  const showActualDamage = useUIStore(s => s.showActualDamage)
  const showOriginalDamage = useUIStore(s => s.showOriginalDamage)
  const enableHpSimulation = useUIStore(s => s.enableHpSimulation)
  const calculationResults = useDamageCalculationResults()
  const calculatedEvent = calculationResults.get(event.id)
  const isTankOnly = event.type === 'tankbuster' || event.type === 'auto'
  const x = event.time * zoomLevel + dragOffsetX
  const y = yOffset + row * rowHeight + rowHeight / 2
  const geom = computeDamageCardGeometry(event, zoomLevel)

  const isDark = colors.cardBg !== '#ffffff'
  const damageTypeColorMap: Record<DamageType, string> = {
    physical: '#ef4444',
    magical: isDark ? '#60a5fa' : '#1e40af',
    darkness: '#c026d3',
  }
  const nameColor = damageTypeColorMap[event.damageType || 'physical'] || '#ef4444'

  const hasOverkill =
    event.playerDamageDetails?.some(
      d => (d.overkill ?? 0) > 0 && !d.statuses.some(s => s.statusId === 810)
    ) ?? false

  const { isLethal, isDangerous } = deriveLethalDangerous(
    enableHpSimulation ? calculatedEvent?.hpSimulation : undefined,
    calculatedEvent?.finalDamage ?? 0,
    calculatedEvent?.referenceMaxHP,
    hasOverkill
  )

  const getDamageText = (): string => {
    if (!showActualDamage && !showOriginalDamage) return ''

    const actualValue = hasOverkill ? calculatedEvent?.maxDamage : calculatedEvent?.finalDamage
    const originalValue = calculatedEvent?.originalDamage

    if (showActualDamage && showOriginalDamage) {
      if (actualValue === undefined || originalValue === undefined) return ''
      return `${formatDamageValue(actualValue)} / ${formatDamageValue(originalValue)}`
    }
    if (showActualDamage) {
      if (actualValue === undefined) return ''
      return formatDamageValue(actualValue)
    }
    if (showOriginalDamage) {
      if (originalValue === undefined) return ''
      return formatDamageValue(originalValue)
    }
    return ''
  }
  const damageText = getDamageText()

  const damageTextWidth = (() => {
    if (!damageText) return 0
    const ctx = getMeasureCtx()
    ctx.font = '12px Arial, sans-serif'
    return Math.ceil(ctx.measureText(damageText).width) + 5
  })()
  const nameAreaWidth = geom.width - 5 - damageTextWidth
  const nameXOffset = hasOverkill || isLethal || isDangerous ? 20 : 5
  const displayName = truncateText(
    event.name,
    nameAreaWidth - (nameXOffset - 5),
    'bold 13px Arial, sans-serif'
  )

  return (
    <Group
      name="tlObject"
      x={x}
      y={y}
      draggable={isSelected && !isReadOnly}
      dragBoundFunc={pos => ({
        x: pos.x,
        y: y,
      })}
      onClick={e => {
        // 右键不触发选中：右键的选区 / 菜单逻辑统一由 handleContextMenu 处理，
        // 避免在 onContextMenu 前把多选塌缩成单个
        if (e.evt.button !== 2) onSelect()
      }}
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
        if (e.target.x() < 0) e.target.x(0)
        onDragMove(e.target.x())
        e.target.getStage()?.batchDraw()
      }}
      onDragEnd={e => {
        if (e.target.x() < 0) e.target.x(0)
        onDragEnd(e.target.x())
      }}
      onContextMenu={onContextMenu}
    >
      {/* 背景矩形 */}
      <Rect
        x={geom.leftLocal}
        y={-15}
        width={geom.width}
        height={30}
        fill={isTankOnly ? colors.cardBgTankbuster : colors.cardBg}
        stroke={isSelected ? '#3b82f6' : isTankOnly ? colors.textSecondary : colors.gridLine}
        strokeWidth={isSelected ? 2 : 1}
        dash={isTankOnly && !isSelected ? [4, 3] : undefined}
        cornerRadius={4}
        opacity={isTankOnly ? 0.7 : 1}
        shadowEnabled={false}
        perfectDrawEnabled={false}
      />

      {/* 技能名称 */}
      <Text
        x={geom.leftLocal + nameXOffset}
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
      <Text
        x={geom.leftLocal + 3}
        y={-15}
        width={18}
        height={30}
        text="💀"
        fontSize={12}
        verticalAlign="middle"
        perfectDrawEnabled={false}
        listening={false}
        visible={hasOverkill}
      />

      {/* 致死警示（编辑模式） */}
      <Text
        x={geom.leftLocal + 3}
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
        visible={isLethal}
      />

      {/* 危险警示（编辑模式） */}
      <Text
        x={geom.leftLocal + 3}
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
        visible={isDangerous}
      />

      {/* 最终伤害数值 */}
      <Text
        x={geom.leftLocal + geom.width - damageTextWidth}
        y={-15}
        width={damageTextWidth - 5}
        height={30}
        text={damageText}
        fontSize={12}
        fill={colors.textPrimary}
        fontFamily="Arial, sans-serif"
        wrap="none"
        align="right"
        verticalAlign="middle"
        perfectDrawEnabled={false}
        listening={false}
        visible={!!damageText}
      />

      {/* 伤害判定菱形：局部 x=0（=判定时间），骑在卡片下沿 */}
      <RegularPolygon
        x={0}
        y={15}
        sides={4}
        radius={6}
        fill="#ef4444"
        stroke={diamondDraggable ? '#3b82f6' : colors.cardBg}
        strokeWidth={diamondDraggable ? 2 : 1}
        draggable={diamondDraggable}
        shadowEnabled={false}
        perfectDrawEnabled={false}
        onDragStart={e => {
          e.cancelBubble = true
        }}
        onDragMove={e => {
          e.cancelBubble = true
          e.target.y(15) // 锁回卡片下沿局部坐标
          const newTime = (x + e.target.x()) / zoomLevel
          reportDamageDrag?.(event.id, newTime * zoomLevel)
          e.target.getStage()?.batchDraw()
        }}
        onDragEnd={e => {
          e.cancelBubble = true
          const newTime = Math.max(
            TIMELINE_START_TIME,
            Math.round(((x + e.target.x()) / zoomLevel) * 10) / 10
          )
          onDiamondDragEnd?.(event.id, newTime)
          e.target.position({ x: 0, y: 15 })
        }}
      />
    </Group>
  )
})

export default DamageEventCard
