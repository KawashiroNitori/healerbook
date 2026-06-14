/**
 * 可编辑说明组件（浮层形式）
 *
 * 说明：刻意不使用 Radix Popover。Radix（Floating UI）通过 `transform: translate(...)`
 * 定位浮层，而被 transform 的祖先会让浏览器在「指针拖到 textarea 外部」时把
 * caret 命中位置算偏一截，导致已选内容意外回缩/跳变。改用 portal + `position: fixed`
 * 定位（无 transform 祖先），从根因上规避该浏览器问题。
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TIMELINE_DESCRIPTION_MAX_LENGTH } from '@/constants/limits'

interface EditableDescriptionProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}

export default function EditableDescription({
  value,
  onChange,
  readOnly,
}: EditableDescriptionProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const triggerRef = useRef<HTMLParagraphElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const canOpen = Boolean(value) || !readOnly

  const reposition = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setPos({ left: rect.left, top: rect.bottom + 4 })
  }

  const handleOpen = () => {
    if (!canOpen) return
    setDraft(value)
    reposition()
    setOpen(true)
  }

  const handleSave = () => {
    onChange(draft.trim())
    setOpen(false)
  }

  // 外部点击 / Esc 关闭，窗口尺寸变化时重新定位
  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onReposition = () => reposition()

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  return (
    <>
      <p
        ref={triggerRef}
        onClick={() => (open ? setOpen(false) : handleOpen())}
        className="text-xs text-muted-foreground cursor-text hover:text-foreground transition-colors truncate max-w-xs"
        title={value || (readOnly ? undefined : '点击添加说明')}
      >
        {value || (!readOnly && <span className="opacity-40">添加说明...</span>)}
      </p>

      {open &&
        canOpen &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            style={{ position: 'fixed', left: pos.left, top: pos.top }}
            className="z-50 w-96 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none"
          >
            {readOnly ? (
              <p className="text-sm whitespace-pre-wrap break-all">{value}</p>
            ) : (
              <div className="space-y-2">
                <textarea
                  autoFocus
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  maxLength={TIMELINE_DESCRIPTION_MAX_LENGTH}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setOpen(false)
                  }}
                  rows={8}
                  className="w-full px-2 py-1.5 border border-border rounded-md text-sm resize-none bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="为这个时间轴添加说明..."
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-3 py-1.5 text-sm border border-border rounded-md text-foreground hover:bg-accent transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                  >
                    保存
                  </button>
                </div>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
