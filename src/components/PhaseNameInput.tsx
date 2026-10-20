/**
 * 阶段名原地编辑输入框（时间轴 / 表格 / 工具栏下拉共用）。
 *
 * Enter 确认、Esc 取消、失焦确认；trim 后为空视为取消。
 */

import { useEffect, useRef, type CSSProperties } from 'react'
import { PHASE_NAME_MAX_LENGTH } from '@/constants/limits'
import { cn } from '@/lib/utils'

interface PhaseNameInputProps {
  initialName: string
  /** 阶段色，用于描边 */
  color: string
  onCommit: (name: string) => void
  onCancel: () => void
  className?: string
  style?: CSSProperties
}

export default function PhaseNameInput({
  initialName,
  color,
  onCommit,
  onCancel,
  className,
  style,
}: PhaseNameInputProps) {
  const ref = useRef<HTMLInputElement>(null)
  // Enter / Esc 之后紧接着的 blur 不再重复提交
  const settledRef = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const finish = (commit: boolean) => {
    if (settledRef.current) return
    settledRef.current = true
    const name = ref.current?.value.trim() ?? ''
    if (commit && name && name !== initialName) onCommit(name)
    else onCancel()
  }

  return (
    <input
      ref={ref}
      defaultValue={initialName}
      maxLength={PHASE_NAME_MAX_LENGTH}
      autoComplete="off"
      data-1p-ignore
      className={cn(
        'rounded border-[1.5px] bg-background px-1.5 py-px text-xs font-semibold text-foreground outline-none',
        className
      )}
      style={{ borderColor: color, ...style }}
      onKeyDown={e => {
        // 阻止冒泡：避免触发画布快捷键与下拉菜单的 typeahead
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
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    />
  )
}
