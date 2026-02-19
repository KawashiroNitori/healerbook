/**
 * 技能图标组件
 */

import { Rect, Image as KonvaImage } from 'react-konva'
import { useKonvaImage } from '@/utils/useKonvaImage'

interface SkillIconProps {
  iconPath: string
  isSelected: boolean
}

export default function SkillIcon({ iconPath, isSelected }: SkillIconProps) {
  const image = useKonvaImage(iconPath)

  if (!image) {
    // 加载中或加载失败，显示占位符
    return (
      <Rect
        x={0}
        y={-15}
        width={30}
        height={30}
        fill="#e5e7eb"
        cornerRadius={4}
        shadowEnabled={false}
        perfectDrawEnabled={false}
      />
    )
  }

  return (
    <>
      <KonvaImage
        image={image}
        x={0}
        y={-15}
        width={30}
        height={30}
        cornerRadius={4}
      />
      {isSelected && (
        <Rect
          x={0}
          y={-15}
          width={30}
          height={30}
          stroke="#3b82f6"
          strokeWidth={2}
          cornerRadius={4}
          shadowEnabled={false}
          perfectDrawEnabled={false}
        />
      )}
    </>
  )
}
