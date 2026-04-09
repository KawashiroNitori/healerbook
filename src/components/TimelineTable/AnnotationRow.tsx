/**
 * 表格视图的注释行
 *
 * 独占一行，时间列显示 mm:ss.f；其余所有列合并为一格展示注释文本。
 */

import { StickyNote } from 'lucide-react'
import { formatTimeWithDecimal } from '@/utils/timeFormat'
import type { Annotation } from '@/types/timeline'
import { TIME_COL_WIDTH } from './constants'

interface AnnotationRowProps {
  annotation: Annotation
  /** 除时间列外的剩余列数（用于 colSpan） */
  restColSpan: number
}

export default function AnnotationRow({ annotation, restColSpan }: AnnotationRowProps) {
  return (
    <tr className="bg-yellow-50/40 dark:bg-yellow-900/20">
      <td
        className="sticky left-0 z-10 bg-yellow-50/40 dark:bg-yellow-900/20 border-r border-b text-xs px-2 tabular-nums align-top py-2"
        style={{ width: TIME_COL_WIDTH, minWidth: TIME_COL_WIDTH }}
      >
        {formatTimeWithDecimal(annotation.time)}
      </td>
      <td
        colSpan={restColSpan}
        className="border-b text-xs italic text-muted-foreground px-3 py-2 align-top"
      >
        <div className="flex items-start gap-2">
          <StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="whitespace-pre-wrap leading-snug">{annotation.text}</div>
        </div>
      </td>
    </tr>
  )
}
