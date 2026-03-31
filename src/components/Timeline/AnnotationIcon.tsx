/**
 * 注释图标 Konva 组件
 */

import { Group, Rect, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'

interface AnnotationIconProps {
  x: number
  y: number
  onMouseEnter: (e: KonvaEventObject<MouseEvent>) => void
  onMouseLeave: () => void
  onClick: (e: KonvaEventObject<MouseEvent>) => void
  onContextMenu: (e: KonvaEventObject<PointerEvent>) => void
}

const ICON_SIZE = 16

export default function AnnotationIcon({
  x,
  y,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onContextMenu,
}: AnnotationIconProps) {
  return (
    <Group
      x={x - ICON_SIZE / 2}
      y={y - ICON_SIZE / 2}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <Rect
        width={ICON_SIZE}
        height={ICON_SIZE}
        cornerRadius={3}
        fill="rgba(59, 130, 246, 0.7)"
        shadowEnabled={false}
        perfectDrawEnabled={false}
      />
      <Text
        x={0}
        y={1}
        width={ICON_SIZE}
        height={ICON_SIZE}
        text="✎"
        fontSize={11}
        fill="white"
        align="center"
        verticalAlign="middle"
        listening={false}
        perfectDrawEnabled={false}
      />
    </Group>
  )
}
