/**
 * 阶段起点标记：一条 2px 竖线 + 向右固定 200px、从该色渐变到透明的色带。
 *
 * 纯展示、不响应事件。宽度固定，不随缩放与阶段长度变化。
 * 伤害轨 / HP 轨 / 技能轨画在各自 Stage 已有的 overlay 层，盖在卡片与技能之上；
 * 标尺部分画在 TimeRuler 背景之上、刻度与阶段名之下。均不新增 Layer。
 */

import { Group, Line, Rect } from 'react-konva'
import { useUIStore } from '@/store/uiStore'
import { phaseColorAlpha } from '@/utils/timelinePhases'

/** 渐变带宽度（px） */
export const PHASE_BAND_WIDTH = 200

/** 已排序、已分配颜色的阶段（拖动预览时 time 可能是临时值） */
export interface PhaseMarker {
  id: string
  name: string
  time: number
  color: string
}

interface PhaseBandsProps {
  phases: PhaseMarker[]
  zoomLevel: number
  y: number
  height: number
}

export default function PhaseBands({ phases, zoomLevel, y, height }: PhaseBandsProps) {
  const isDark = useUIStore(s => s.theme === 'dark')
  if (phases.length === 0 || height <= 0) return null
  // 深色背景上同样的不透明度显得更淡，适当提高
  const alpha = isDark ? 0.3 : 0.18

  return (
    <Group listening={false}>
      {phases.map(p => {
        const x = p.time * zoomLevel
        return (
          <Group key={p.id}>
            <Rect
              x={x}
              y={y}
              width={PHASE_BAND_WIDTH}
              height={height}
              fillLinearGradientStartPoint={{ x: 0, y: 0 }}
              fillLinearGradientEndPoint={{ x: PHASE_BAND_WIDTH, y: 0 }}
              fillLinearGradientColorStops={[
                0,
                phaseColorAlpha(p.color, alpha),
                1,
                phaseColorAlpha(p.color, 0),
              ]}
              perfectDrawEnabled={false}
              shadowEnabled={false}
            />
            <Line
              points={[x, y, x, y + height]}
              stroke={p.color}
              strokeWidth={2}
              perfectDrawEnabled={false}
              shadowEnabled={false}
            />
          </Group>
        )
      })}
    </Group>
  )
}
