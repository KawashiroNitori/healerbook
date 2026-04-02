/**
 * 可编辑说明组件（Popover 形式）
 */

import { useState } from 'react'
import { TIMELINE_DESCRIPTION_MAX_LENGTH } from '@/constants/limits'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

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

  const handleOpen = (nextOpen: boolean) => {
    if (nextOpen) setDraft(value)
    setOpen(nextOpen)
  }

  const handleSave = () => {
    onChange(draft.trim())
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <p
          className="text-xs text-muted-foreground cursor-text hover:text-foreground transition-colors truncate max-w-xs"
          title={value || (readOnly ? undefined : '点击添加说明')}
        >
          {value || (!readOnly && <span className="opacity-40">添加说明...</span>)}
        </p>
      </PopoverTrigger>

      {(value || !readOnly) && (
        <PopoverContent className="w-96 p-3" align="start">
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
        </PopoverContent>
      )}
    </Popover>
  )
}
