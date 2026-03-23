/**
 * 创建时间轴对话框
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { createNewTimeline, saveTimeline } from '@/utils/timelineStorage'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RAID_TIERS } from '@/data/raidEncounters'

interface CreateTimelineDialogProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

export default function CreateTimelineDialog({
  open,
  onClose,
  onCreated,
}: CreateTimelineDialogProps) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [encounterId, setEncounterId] = useState(RAID_TIERS[0]?.encounters[0]?.id.toString() || '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('请输入时间轴名称')
      return
    }

    const timeline = createNewTimeline(encounterId, name.trim())
    if (description.trim()) {
      timeline.description = description.trim()
    }
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
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
              autoFocus
              autoComplete="off"
              data-1p-ignore
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">说明</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="可选：为这个时间轴添加简短说明"
              className="w-full px-3 py-2 border rounded-md"
              autoComplete="off"
              data-1p-ignore
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">副本</label>
            <Select value={encounterId} onValueChange={setEncounterId}>
              <SelectTrigger>
                <SelectValue placeholder="选择副本" />
              </SelectTrigger>
              <SelectContent>
                {RAID_TIERS.map(tier => (
                  <SelectGroup key={tier.zone}>
                    <SelectLabel>
                      {tier.name} ({tier.patch})
                    </SelectLabel>
                    {tier.encounters.map(encounter => (
                      <SelectItem key={encounter.id} value={encounter.id.toString()}>
                        {encounter.shortName} - {encounter.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
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
