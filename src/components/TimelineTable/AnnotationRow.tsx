/**
 * 表格视图的备注行
 *
 * 独占一行，时间列显示 mm:ss.f；其余所有列合并为一格展示备注文本。
 */

import { StickyNote } from 'lucide-react'
import { formatTimeWithDecimal } from '@/utils/formatters'
import type { Annotation } from '@/types/timeline'
import { TIME_COL_WIDTH, CAST_START_COL_WIDTH } from './constants'

interface AnnotationRowProps {
  annotation: Annotation
  /** 除时间列外的剩余列数（用于 colSpan） */
  restColSpan: number
  /** 外层滚动容器可视宽度 */
  wrapperWidth: number
  /** 表格总宽度（所有列宽之和），用于避免备注 div 撑开表格 */
  tableWidth: number
  /** 是否显示咏唱开始时间列（备注行需补一个占位前导列并右移时间列） */
  showCastStartTime: boolean
}

export default function AnnotationRow({
  annotation,
  restColSpan,
  wrapperWidth,
  tableWidth,
  showCastStartTime,
}: AnnotationRowProps) {
  // 时间列之前的前导宽度（咏唱开始占位列 + 时间列本身）
  const timeLeft = showCastStartTime ? CAST_START_COL_WIDTH : 0
  const leadingWidth = timeLeft + TIME_COL_WIDTH
  // 宽度 = min(表格剩余宽, 可视区剩余宽)：
  // - 少技能时 tableWidth 小，限制在表格内，不撑开 wrapper
  // - 多技能时 tableWidth 大于 wrapperWidth，限制在可视区内，sticky 正常工作
  const textWidth = Math.max(0, Math.min(tableWidth, wrapperWidth) - leadingWidth)

  return (
    <tr className="bg-yellow-50/40 dark:bg-yellow-900/20">
      {showCastStartTime && (
        <td
          className="sticky z-10 bg-yellow-50/40 dark:bg-yellow-900/20 border-r border-b"
          style={{ width: CAST_START_COL_WIDTH, minWidth: CAST_START_COL_WIDTH, left: 0 }}
        />
      )}
      <td
        className="sticky z-10 bg-yellow-50/40 dark:bg-yellow-900/20 border-r border-b text-xs px-2 text-right tabular-nums align-top py-2"
        style={{ width: TIME_COL_WIDTH, minWidth: TIME_COL_WIDTH, left: timeLeft }}
      >
        {formatTimeWithDecimal(annotation.time)}
      </td>
      <td
        colSpan={restColSpan}
        className="border-b bg-yellow-50/40 dark:bg-yellow-900/20 p-0 align-top"
      >
        {/*
          colSpan <td> 上的 position: sticky 各浏览器行为不一致，
          改为在 td 内部用 sticky 定位一个 div：单元级 sticky 浏览器支持稳定，
          交给 compositor 处理，滚动完全跟手
        */}
        <div
          className="sticky flex items-start gap-2 px-3 py-2 text-xs italic text-muted-foreground"
          style={{
            left: leadingWidth,
            width: textWidth,
            maxWidth: textWidth,
          }}
        >
          <StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 whitespace-pre-wrap leading-snug">{annotation.text}</div>
        </div>
      </td>
    </tr>
  )
}
