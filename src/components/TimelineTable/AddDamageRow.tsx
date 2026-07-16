/**
 * 表格视图的"添加伤害事件"行
 *
 * 固定置于所有数据行 / 备注行之下，仅编辑模式可见。点击打开 AddEventDialog。
 * 排版策略同 AnnotationRow：colSpan 整行 + 内部 sticky div，保证横向滚动时按钮
 * 始终在可视区内居中。
 */

import { Plus } from 'lucide-react'
import { ROW_HEIGHT } from './constants'

interface AddDamageRowProps {
  /** 表格全部列数（time + 其他） */
  totalColSpan: number
  /** 外层滚动容器可视宽度 */
  wrapperWidth: number
  /** 表格总宽度 */
  tableWidth: number
  onClick: () => void
}

export default function AddDamageRow({
  totalColSpan,
  wrapperWidth,
  tableWidth,
  onClick,
}: AddDamageRowProps) {
  const innerWidth = Math.max(0, Math.min(tableWidth, wrapperWidth))

  return (
    <tr style={{ height: ROW_HEIGHT }} className="group">
      <td
        colSpan={totalColSpan}
        className="border-b p-0 cursor-pointer group-hover:bg-muted/40 transition-colors"
        onClick={e => {
          e.stopPropagation()
          onClick()
        }}
      >
        <div
          className="sticky flex items-center justify-center gap-1.5 text-xs text-muted-foreground group-hover:text-foreground transition-colors"
          style={{
            left: 0,
            width: innerWidth,
            height: ROW_HEIGHT,
          }}
        >
          <Plus className="w-3.5 h-3.5" />
          添加伤害事件
        </div>
      </td>
    </tr>
  )
}
