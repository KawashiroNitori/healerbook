/**
 * 减伤分配图标组件
 */

import { Group, Rect, Text } from 'react-konva'
import SkillIcon from './SkillIcon'
import type { MitigationAction } from '@/types/mitigation'
import type { MitigationAssignment, Job } from '@/types/timeline'

interface MitigationAssignmentIconProps {
  assignment: MitigationAssignment
  action: MitigationAction
  isSelected: boolean
  zoomLevel: number
  trackY: number
  leftBoundary: number
  rightBoundary: number
  onSelect: () => void
  onDragEnd: (x: number) => void
  onContextMenu: (e: any) => void
}

export default function MitigationAssignmentIcon({
  assignment,
  action,
  isSelected,
  zoomLevel,
  trackY,
  leftBoundary,
  rightBoundary,
  onSelect,
  onDragEnd,
  onContextMenu,
}: MitigationAssignmentIconProps) {
  const x = assignment.time * zoomLevel
  const currentDuration = action.cooldown

  return (
    <Group
      x={x}
      y={trackY}
      draggable
      dragBoundFunc={(pos) => {
        const minX = leftBoundary * zoomLevel
        const maxX = rightBoundary === Infinity ? pos.x : rightBoundary * zoomLevel

        return {
          x: Math.max(minX, Math.min(maxX, pos.x)),
          y: trackY,
        }
      }}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => {
        onDragEnd(e.target.x())
      }}
      onContextMenu={onContextMenu}
    >
      {/* 持续时间条（从图标内部开始，填充圆角缺口，绿色，无圆角） */}
      {action.duration > 0 && (
        <Rect
          x={26}
          y={-15}
          width={Math.max(0, action.duration * zoomLevel - 26)}
          height={30}
          fill="#10b981"
          opacity={0.3}
          shadowEnabled={false}
          perfectDrawEnabled={false}
          listening={false}
        />
      )}

      {/* 持续时间文本（在持续时间条内侧） */}
      {action.duration >= 3 && (
        <Text
          x={28}
          y={0}
          text={`${action.duration}s`}
          fontSize={10}
          fill="#10b981"
          fontStyle="bold"
          fontFamily="Arial, sans-serif"
          perfectDrawEnabled={false}
          listening={false}
        />
      )}

      {/* 冷却时间条（持续时间条右侧，蓝色，无圆角） */}
      {action.cooldown > 0 && (
        <Rect
          x={action.duration * zoomLevel}
          y={-15}
          width={Math.max(0, action.cooldown * zoomLevel - action.duration * zoomLevel)}
          height={30}
          fill="#3b82f6"
          opacity={0.2}
          shadowEnabled={false}
          perfectDrawEnabled={false}
          listening={false}
        />
      )}

      {/* 冷却时间文本（在冷却时间条内侧） */}
      {action.cooldown >= 3 && (
        <Text
          x={action.duration * zoomLevel + 2}
          y={0}
          text={`${action.cooldown}s`}
          fontSize={10}
          fill="#3b82f6"
          fontStyle="bold"
          fontFamily="Arial, sans-serif"
          perfectDrawEnabled={false}
          listening={false}
        />
      )}

      {/* 技能图标（最后渲染，确保在最上层，左边缘对齐生效时刻） */}
      {action ? (
        <SkillIcon iconPath={action.icon} isSelected={isSelected} />
      ) : (
        <>
          {/* 降级方案 */}
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
          <Text
            x={0}
            y={-8}
            width={30}
            text={assignment.job}
            fontSize={10}
            fill="#ffffff"
            align="center"
            fontStyle="bold"
            fontFamily="Arial, sans-serif"
            perfectDrawEnabled={false}
            listening={false}
          />
        </>
      )}
    </Group>
  )
}
