/**
 * 技能使用事件图标组件
 */

import { memo, useState, useRef } from 'react'
import { Group, Rect, Text } from 'react-konva'
import SkillIcon from './SkillIcon'
import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { KonvaContextMenuEvent } from '@/types/konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { InvalidReason } from '@/utils/placement/types'

interface CastEventIconProps {
  castEvent: CastEvent
  action: MitigationAction
  /** 覆盖显示用的技能（仅影响图标和悬浮窗，不影响持续/冷却时间条） */
  displayAction?: MitigationAction
  /** 本 cast 在当前 partyState / castEvents 下是否违反 placement/CD，非 null 时显示红边框 */
  invalidReason?: InvalidReason | null
  /** reason === 'resource_exhausted' | 'both' 时携带：首个失败的 resourceId（UI 用来查 max） */
  invalidResourceId?: string | null
  isSelected: boolean
  zoomLevel: number
  trackY: number
  leftBoundary: number
  rightBoundary: number
  nextCastTime: number
  scrollLeft: number
  scrollTop: number
  onSelect: () => void
  onDragStart?: () => void
  onDragEnd: (x: number) => void
  onContextMenu: (e: KonvaContextMenuEvent) => void
  onHover: (action: MitigationAction, e: KonvaEventObject<MouseEvent>) => void
  onHoverEnd: () => void
  onClickIcon: (action: MitigationAction, e: KonvaEventObject<MouseEvent | TouchEvent>) => void
  isReadOnly?: boolean
}

const CastEventIcon = memo(function CastEventIcon({
  castEvent,
  action,
  displayAction,
  invalidReason = null,
  isSelected,
  zoomLevel,
  trackY,
  leftBoundary,
  rightBoundary,
  nextCastTime,
  scrollLeft,
  scrollTop,
  onSelect,
  onDragStart,
  onDragEnd,
  onContextMenu,
  onHover,
  onHoverEnd,
  onClickIcon,
  isReadOnly = false,
}: CastEventIconProps) {
  const [isHovered, setIsHovered] = useState(false)
  const dragStartAbsYRef = useRef<number | null>(null)
  const x = castEvent.timestamp * zoomLevel // timestamp 已经是秒
  const effectiveDuration =
    nextCastTime === Infinity
      ? action.duration
      : Math.min(action.duration, nextCastTime - castEvent.timestamp)

  return (
    <Group
      x={x}
      y={trackY}
      draggable={isSelected && !isReadOnly}
      onDragStart={e => {
        // 拖动开始时捕获节点真实绝对 y 坐标，避免因 scrollTop prop 过时导致瞬移
        dragStartAbsYRef.current = e.target.absolutePosition().y
        onDragStart?.()
      }}
      dragBoundFunc={pos => {
        // pos 是绝对坐标（Stage 坐标系）；边界是 Layer 坐标，需要减去 scrollLeft 转换
        const minX = leftBoundary * zoomLevel - scrollLeft
        const maxX = rightBoundary === Infinity ? pos.x : rightBoundary * zoomLevel - scrollLeft
        const lockedY = dragStartAbsYRef.current ?? trackY - scrollTop

        return {
          x: Math.max(minX, Math.min(maxX, pos.x)),
          y: lockedY,
        }
      }}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={e => {
        dragStartAbsYRef.current = null
        onDragEnd(e.target.x())
      }}
      onContextMenu={onContextMenu}
    >
      {/* 持续时间条外缘光晕（在填充条之前渲染，shadow 不被自身遮挡） */}
      {isSelected && action.duration > 0 && (
        <Rect
          x={26}
          y={-15}
          width={Math.max(0, effectiveDuration * zoomLevel - 26)}
          height={30}
          fill="#10b981"
          opacity={0.6}
          shadowColor="#10b981"
          shadowBlur={18}
          shadowOpacity={1}
          shadowEnabled={true}
          listening={false}
        />
      )}

      {/* 持续时间条（从图标内部开始，填充圆角缺口，绿色，无圆角） */}
      {action.duration > 0 && (
        <Rect
          x={26}
          y={-15}
          width={Math.max(0, effectiveDuration * zoomLevel - 26)}
          height={30}
          fill="#10b981"
          opacity={isHovered ? 0.45 : 0.3}
          shadowEnabled={false}
          perfectDrawEnabled={false}
        />
      )}

      {/* 持续时间文本（在持续时间条末尾内侧） */}
      {action.duration >= 3 && (
        <Text
          x={effectiveDuration * zoomLevel - 22}
          y={0}
          text={`${action.duration}s`}
          fontSize={10}
          fill={isSelected ? '#ffffff' : '#10b981'}
          fontStyle="bold"
          fontFamily="Arial, sans-serif"
          perfectDrawEnabled={false}
          listening={false}
        />
      )}

      {isSelected && action.cooldown > 0 && (
        <Rect
          x={effectiveDuration * zoomLevel}
          y={-15}
          width={Math.max(0, action.cooldown * zoomLevel - effectiveDuration * zoomLevel)}
          height={30}
          fill="#3b82f6"
          opacity={0.5}
          shadowColor="#3b82f6"
          shadowBlur={18}
          shadowOpacity={1}
          shadowEnabled={true}
          listening={false}
        />
      )}

      {/* 冷却时间条（持续时间条右侧，蓝色，无圆角） */}
      {action.cooldown > 0 && (
        <Rect
          x={effectiveDuration * zoomLevel}
          y={-15}
          width={Math.max(0, action.cooldown * zoomLevel - effectiveDuration * zoomLevel)}
          height={30}
          fill="#3b82f6"
          opacity={isHovered ? 0.35 : 0.2}
          shadowEnabled={false}
          perfectDrawEnabled={false}
        />
      )}

      {/* 冷却时间文本（在冷却时间条末尾内侧） */}
      {action.cooldown >= 3 && (
        <Text
          x={action.cooldown * zoomLevel - 22}
          y={0}
          text={`${action.cooldown}s`}
          fontSize={10}
          fill={isSelected ? '#ffffff' : '#3b82f6'}
          fontStyle="bold"
          fontFamily="Arial, sans-serif"
          perfectDrawEnabled={false}
          listening={false}
        />
      )}

      {/* 技能图标（最后渲染，确保在最上层，左边缘对齐生效时刻） */}
      {action ? (
        <SkillIcon iconPath={(displayAction ?? action).icon} isSelected={isSelected} />
      ) : (
        // 降级方案：未知 actionId 时显示红色方块
        <Rect
          x={0}
          y={-15}
          width={30}
          height={30}
          fill={isSelected ? '#3b82f6' : '#ef4444'}
          cornerRadius={4}
          shadowEnabled={false}
          perfectDrawEnabled={false}
        />
      )}

      {/* 合法性回溯：placement 或 CD 冲突时红边框，视觉上覆盖图标 */}
      {invalidReason && (
        <Rect
          x={-1}
          y={-16}
          width={32}
          height={32}
          stroke="#ef4444"
          strokeWidth={2}
          cornerRadius={4}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}

      {/* 全宽透明鼠标响应层（覆盖图标 + 持续时间条 + 冷却时间条，仅控制高亮和光标） */}
      <Rect
        x={0}
        y={-15}
        width={Math.max(30, effectiveDuration * zoomLevel, action.cooldown * zoomLevel)}
        height={30}
        fill="transparent"
        onMouseEnter={e => {
          setIsHovered(true)
          const stage = e.target.getStage()
          if (stage) stage.container().style.cursor = 'pointer'
        }}
        onMouseLeave={e => {
          setIsHovered(false)
          const stage = e.target.getStage()
          if (stage) stage.container().style.cursor = 'default'
        }}
      />

      {/* 图标区域 hover/tap 响应（触发悬浮窗，移动端 tap） */}
      <Rect
        x={0}
        y={-15}
        width={30}
        height={30}
        fill="transparent"
        onMouseEnter={e => onHover(displayAction ?? action, e)}
        onMouseLeave={onHoverEnd}
        onTap={e => onClickIcon(displayAction ?? action, e)}
      />
    </Group>
  )
})

export default CastEventIcon
