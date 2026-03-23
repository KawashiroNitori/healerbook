/**
 * 可编辑说明组件
 */

import { useState } from 'react'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'

interface EditableDescriptionProps {
  value: string
  onChange: (value: string) => void
}

export default function EditableDescription({ value, onChange }: EditableDescriptionProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)

  const handleOpen = () => {
    setDraft(value)
    setOpen(true)
  }

  const handleSave = () => {
    onChange(draft.trim())
    setOpen(false)
  }

  const handleCancel = () => {
    setOpen(false)
  }

  return (
    <>
      <p
        className="text-xs text-muted-foreground cursor-text hover:text-foreground transition-colors truncate max-w-xs"
        onClick={handleOpen}
        title={value || '点击添加说明'}
      >
        {value || <span className="opacity-40">添加说明...</span>}
      </p>

      <Modal open={open} onClose={handleCancel} maxWidth="2xl" disableBackdropClick>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>编辑说明</ModalTitle>
          </ModalHeader>
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') handleCancel()
            }}
            rows={12}
            className="w-full px-3 py-2 border rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="为这个时间轴添加说明..."
          />
          <ModalFooter>
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 border rounded-md hover:bg-accent transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              保存
            </button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
