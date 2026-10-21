/**
 * 表格时间单元格的直接输入框（阶段行、伤害事件行共用）
 *
 * Enter / 失焦确认，Esc 取消；无法解析视为取消。
 */

import { useEffect, useRef } from 'react'
import { formatTimeWithDecimal } from '@/utils/formatters'
import { parseTimeString } from '@/components/ui/time-input-utils'

interface TimeCellInputProps {
  initial: number
  /** 边框色，缺省为主题主色 */
  color?: string
  onCommit: (time: number) => void
  onCancel: () => void
}

export default function TimeCellInput({ initial, color, onCommit, onCancel }: TimeCellInputProps) {
  const ref = useRef<HTMLInputElement>(null)
  const settledRef = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (commit: boolean) => {
    if (settledRef.current) return
    settledRef.current = true
    const tenths = commit ? parseTimeString(ref.current?.value ?? '') : null
    if (tenths === null) onCancel()
    else onCommit(tenths / 10)
  }
  return (
    <input
      ref={ref}
      defaultValue={formatTimeWithDecimal(initial)}
      className="w-full rounded border-[1.5px] bg-background px-1 py-px text-right text-xs font-semibold tabular-nums text-foreground outline-none"
      style={{ borderColor: color ?? 'hsl(var(--primary))' }}
      autoComplete="off"
      data-1p-ignore
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    />
  )
}
