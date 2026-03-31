/**
 * 注释查看/编辑 Popover
 */

import { useState, useRef, useEffect } from 'react'
import { ANNOTATION_TEXT_MAX_LENGTH } from '@/constants/limits'

interface AnnotationPopoverProps {
  mode: 'view' | 'edit'
  text: string
  screenX: number
  screenY: number
  onConfirm?: (text: string) => void
  onClose: () => void
}

export default function AnnotationPopover({
  mode,
  text,
  screenX,
  screenY,
  onConfirm,
  onClose,
}: AnnotationPopoverProps) {
  const [editText, setEditText] = useState(text)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mode === 'edit' && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(editText.length, editText.length)
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== 'edit') return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [mode, onClose])

  const handleConfirm = () => {
    const trimmed = editText.trim()
    if (trimmed && onConfirm) {
      onConfirm(trimmed)
    }
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleConfirm()
    }
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-50 bg-popover text-popover-foreground border rounded-md shadow-md"
      style={{ left: screenX, top: screenY }}
      onMouseLeave={mode === 'view' ? onClose : undefined}
    >
      {mode === 'view' ? (
        <div className="px-3 py-2 text-xs max-w-[240px] whitespace-pre-wrap break-words">
          {text}
        </div>
      ) : (
        <div className="p-2 flex flex-col gap-1.5">
          <textarea
            ref={textareaRef}
            className="w-[220px] h-[80px] text-xs p-1.5 border rounded resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            maxLength={ANNOTATION_TEXT_MAX_LENGTH}
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入注释..."
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {editText.length}/{ANNOTATION_TEXT_MAX_LENGTH}
            </span>
            <div className="flex gap-1">
              <button
                className="px-2 py-0.5 text-[11px] rounded border hover:bg-muted"
                onClick={onClose}
              >
                取消
              </button>
              <button
                className="px-2 py-0.5 text-[11px] rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={!editText.trim()}
                onClick={handleConfirm}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
