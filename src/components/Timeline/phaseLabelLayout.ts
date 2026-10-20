/**
 * 标尺阶段标签的几何：渲染（PhaseLabels）与刻度遮挡（TimeRuler）共用同一份计算。
 */

import { formatTimeWithDecimal } from '@/utils/formatters'
import type { PhaseMarker } from './PhaseBands'
import { measureTextWidth } from './measureText'

export const PHASE_LABEL = {
  FONT_SIZE: 12,
  /** 未选中文字相对竖线的左偏移 */
  NAME_OFFSET: 6,
  /** 选中标签相对竖线的左偏移 */
  CHIP_OFFSET: 4,
  CHIP_PAD_LEFT: 6,
  CHIP_PAD_RIGHT: 6,
  CHIP_GAP: 8,
  ICON_BOX: 18,
  ICON_PAD_RIGHT: 3,
  Y: 5,
  HEIGHT: 20,
} as const

export const phaseLabelFont = (family: string, bold: boolean) =>
  `${bold ? 'bold ' : ''}${PHASE_LABEL.FONT_SIZE}px ${family}`

export interface PhaseLabelBox {
  /** 标签左缘（Layer 坐标） */
  left: number
  width: number
  nameWidth: number
  timeWidth: number
  selected: boolean
}

/** 计算每个阶段标签的占位（Layer 坐标） */
export function computePhaseLabelBoxes(
  phases: PhaseMarker[],
  zoomLevel: number,
  selectedId: string | null,
  editable: boolean,
  fontFamily: string
): Map<string, PhaseLabelBox> {
  const L = PHASE_LABEL
  const out = new Map<string, PhaseLabelBox>()
  for (const p of phases) {
    const x = p.time * zoomLevel
    const nameWidth = measureTextWidth(p.name, phaseLabelFont(fontFamily, true))
    if (p.id === selectedId) {
      const timeWidth = measureTextWidth(
        formatTimeWithDecimal(p.time),
        phaseLabelFont(fontFamily, false)
      )
      const width =
        L.CHIP_PAD_LEFT +
        nameWidth +
        L.CHIP_GAP +
        timeWidth +
        (editable ? 4 + L.ICON_BOX * 2 + L.ICON_PAD_RIGHT : L.CHIP_PAD_RIGHT)
      out.set(p.id, { left: x + L.CHIP_OFFSET, width, nameWidth, timeWidth, selected: true })
    } else {
      // 悬停底色左右各留 2px
      out.set(p.id, {
        left: x + L.NAME_OFFSET - 2,
        width: nameWidth + 4,
        nameWidth,
        timeWidth: 0,
        selected: false,
      })
    }
  }
  return out
}
