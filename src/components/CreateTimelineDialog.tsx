/**
 * 创建时间轴对话框
 *
 * 打开或切换副本时预取 encounter template；submit 时从 query cache 同步取数据
 * 并作为初始 damageEvents 传给 createNewTimeline。取不到数据就静默退化为空白时间轴。
 */

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { TIMELINE_NAME_MAX_LENGTH } from '@/constants/limits'
import { toast } from 'sonner'
import { createNewTimeline, saveTimeline } from '@/utils/timelineStorage'
import { useUIStore } from '@/store/uiStore'
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
import { track } from '@/utils/analytics'
import { fetchEncounterTemplate, type EncounterTemplateResponse } from '@/api/encounterTemplate'

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
  const [name, setName] = useState('')
  const [encounterId, setEncounterId] = useState(RAID_TIERS[0]?.encounters[0]?.id.toString() || '')
  const queryClient = useQueryClient()

  // 对话框打开或副本切换时预取模板
  useEffect(() => {
    if (!open) return
    const encounterIdNum = parseInt(encounterId)
    if (encounterIdNum > 0) {
      queryClient.prefetchQuery({
        queryKey: ['encounter-template', encounterIdNum],
        queryFn: () => fetchEncounterTemplate(encounterIdNum),
        staleTime: 1000 * 60 * 60,
      })
    }
  }, [open, encounterId, queryClient])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('请输入时间轴名称')
      return
    }

    const encounterIdNum = parseInt(encounterId)
    const cached = queryClient.getQueryData<EncounterTemplateResponse>([
      'encounter-template',
      encounterIdNum,
    ])
    const initialEvents = cached?.events

    const timeline = createNewTimeline(encounterId, name.trim(), initialEvents)
    saveTimeline(timeline)
    useUIStore.setState({ isReadOnly: false })
    track('timeline-create', { method: 'manual', encounterId: encounterIdNum })
    onCreated()
    window.open(`/timeline/${timeline.id}`, '_blank')
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
              maxLength={TIMELINE_NAME_MAX_LENGTH}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
              autoFocus
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
                {RAID_TIERS.filter(tier => !tier.comingSoon).map(tier => (
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
