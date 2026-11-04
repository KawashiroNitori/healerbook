/**
 * 收回技能虚影：悬浮在「收回型变体」生效区间内时，在鼠标所指时间处画半透明变体图标。
 *
 * 由父组件通过 ref 命令式 show / hide，只重渲染本组件，避免鼠标移动时重渲染整条技能轨道。
 * 渲染在 overlay Layer（listening=false），不新增 Layer。
 */

import { forwardRef, useImperativeHandle, useState } from 'react'
import { Group, Rect } from 'react-konva'
import SkillIcon from './SkillIcon'

export interface RecallGhostTarget {
  /** 变体图标 */
  icon: number
  /** Layer 坐标：图标左边缘（= 时间 × zoom） */
  x: number
  /** Layer 坐标：轨道中线 */
  trackY: number
}

export interface RecallGhostHandle {
  show: (target: RecallGhostTarget) => void
  hide: () => void
}

const RecallGhost = forwardRef<RecallGhostHandle>(function RecallGhost(_props, ref) {
  const [target, setTarget] = useState<RecallGhostTarget | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      show: next =>
        setTarget(prev =>
          prev && prev.icon === next.icon && prev.x === next.x && prev.trackY === next.trackY
            ? prev
            : next
        ),
      hide: () => setTarget(null),
    }),
    []
  )

  if (!target) return null

  return (
    <Group x={target.x} y={target.trackY} listening={false}>
      <Group opacity={0.5} listening={false}>
        <SkillIcon icon={target.icon} isSelected={false} />
      </Group>
      <Rect
        x={-1}
        y={-16}
        width={32}
        height={32}
        stroke="#10b981"
        strokeWidth={1.5}
        dash={[4, 3]}
        cornerRadius={4}
        listening={false}
        shadowEnabled={false}
        perfectDrawEnabled={false}
      />
    </Group>
  )
})

export default RecallGhost
