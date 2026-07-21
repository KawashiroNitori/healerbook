/**
 * 创建时间轴对话框
 *
 * 打开或切换副本时预取 encounter template；submit 时从 query cache 同步取数据
 * 并作为初始 damageEvents 传给 createNewTimeline。取不到数据就静默退化为空白时间轴。
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { TIMELINE_NAME_MAX_LENGTH } from '@/constants/limits'
import { toast } from 'sonner'
import { createNewTimeline } from '@/utils/timelineStorage'
import { createLocalTimeline } from '@/collab/createLocalTimeline'
import { timelineToLocalInit } from '@/collab/timelineToLocalInit'
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
import { fetchEncounterTemplate } from '@/api/encounterTemplate'
import type { EncounterTemplateResponse } from '@/types/apiContracts'

// 妖星乱舞绝境战置顶展示，其余副本保持原有顺序
const PRIORITY_ENCOUNTER_ID = 1085
const VISIBLE_TIERS = [...RAID_TIERS]
  .filter(tier => !tier.comingSoon)
  .sort((a, b) => {
    const rank = (tier: (typeof RAID_TIERS)[number]) =>
      tier.encounters.some(e => e.id === PRIORITY_ENCOUNTER_ID) ? 0 : 1
    return rank(a) - rank(b)
  })

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
  const { t } = useTranslation(['home', 'common'])
  const [name, setName] = useState('')
  const [encounterId, setEncounterId] = useState(
    VISIBLE_TIERS[0]?.encounters[0]?.id.toString() || ''
  )
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toast.error(t('home:createTimeline.nameRequired'))
      return
    }

    const encounterIdNum = parseInt(encounterId)
    const cached = queryClient.getQueryData<EncounterTemplateResponse>([
      'encounter-template',
      encounterIdNum,
    ])
    const initialEvents = cached?.events

    const base = createNewTimeline(encounterId, name.trim(), initialEvents)
    const newId = await createLocalTimeline(timelineToLocalInit(base))
    useUIStore.setState({ manualLock: false })
    track('timeline-create', { method: 'manual', encounterId: encounterIdNum })
    onCreated()
    window.open(`/timeline/${newId}`, '_blank')
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{t('home:createTimeline.title')}</ModalTitle>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('home:createTimeline.nameLabel')} <span className="text-destructive">*</span>
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
            <label className="block text-sm font-medium mb-1">
              {t('home:createTimeline.encounterLabel')}
            </label>
            <Select value={encounterId} onValueChange={setEncounterId}>
              <SelectTrigger>
                <SelectValue placeholder={t('home:createTimeline.encounterPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {VISIBLE_TIERS.map(tier => (
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
                <SelectItem value="0">{t('home:createTimeline.encounterNone')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ModalFooter>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-md hover:bg-accent transition-colors"
            >
              {t('common:cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              {t('home:createTimeline.submit')}
            </button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
