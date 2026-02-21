/**
 * 创建时间轴对话框
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { createNewTimeline, saveTimeline } from '@/utils/timelineStorage'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'

interface CreateTimelineDialogProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

export default function CreateTimelineDialog({ open, onClose, onCreated }: CreateTimelineDialogProps) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [encounterId, setEncounterId] = useState('p9s')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('请输入时间轴名称')
      return
    }

    const timeline = createNewTimeline(encounterId, name.trim())
    saveTimeline(timeline)
    onCreated()
    navigate(`/editor/${timeline.id}`)
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>新建时间轴</ModalTitle>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              时间轴名称 <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: P9S 减伤规划"
              className="w-full px-3 py-2 border rounded-md"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">副本</label>
            <select
              value={encounterId}
              onChange={(e) => setEncounterId(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="p9s">P9S - Kokytos</option>
              <option value="p10s">P10S - Pandæmonium</option>
              <option value="p11s">P11S - Themis</option>
              <option value="p12s_p1">P12S Phase 1 - Athena</option>
              <option value="p12s_p2">P12S Phase 2 - Pallas Athena</option>
              <option value="top">TOP - The Omega Protocol</option>
              <option value="dsr">DSR - Dragonsong's Reprise</option>
              <option value="tea">TEA - The Epic of Alexander</option>
              <option value="uwu">UWU - The Weapon's Refrain</option>
              <option value="ucob">UCOB - The Unending Coil of Bahamut</option>
            </select>
          </div>

          <ModalFooter>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-md hover:bg-accent transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              创建
            </button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
