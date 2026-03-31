/**
 * 注释图标 Konva 组件
 * Lucide message-square-text 图标
 */

import { useRef } from 'react'
import { Group, Path } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'

interface AnnotationIconProps {
  x: number
  y: number
  isPinned?: boolean
  draggable?: boolean
  onMouseEnter: (e: KonvaEventObject<MouseEvent>) => void
  onMouseLeave: () => void
  onClick: (e: KonvaEventObject<MouseEvent>) => void
  onContextMenu: (e: KonvaEventObject<PointerEvent>) => void
  onDragStart?: () => void
  onDragEnd?: (newX: number) => void
}

const ICON_SIZE = 22
// 缩放 24x24 viewBox → ICON_SIZE
const SCALE = ICON_SIZE / 24

export default function AnnotationIcon({
  x,
  y,
  isPinned = false,
  draggable = false,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
}: AnnotationIconProps) {
  // 记录拖动开始时的绝对 Y 坐标，用于锁定垂直位置
  const dragStartAbsYRef = useRef(0)

  return (
    <Group
      x={x - ICON_SIZE / 2}
      y={y - ICON_SIZE / 2}
      scaleX={SCALE}
      scaleY={SCALE}
      opacity={isPinned ? 1 : 0.55}
      draggable={draggable}
      dragBoundFunc={pos => ({ x: pos.x, y: dragStartAbsYRef.current })}
      onDragStart={e => {
        dragStartAbsYRef.current = e.target.getAbsolutePosition().y
        onDragStart?.()
      }}
      onDragEnd={e => {
        if (!onDragEnd) return
        const newCenterX = e.target.x() + ICON_SIZE / 2
        onDragEnd(newCenterX)
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {/* 气泡外框 */}
      <Path
        data="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        fill="rgba(59, 130, 246, 0.7)"
        stroke="rgba(59, 130, 246, 0.9)"
        strokeWidth={1.5}
        shadowEnabled={false}
        perfectDrawEnabled={false}
      />
      {/* 文字线条 */}
      <Path
        data="M13 8H7 M17 12H7"
        stroke="white"
        strokeWidth={2}
        lineCap="round"
        listening={false}
        shadowEnabled={false}
        perfectDrawEnabled={false}
      />
    </Group>
  )
}
