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
import { SUPPORTED_LEVELS } from '@/types/level'

const VISIBLE_TIERS = RAID_TIERS.filter(tier => !tier.comingSoon)

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
    VISIBLE_TIERS[0]?.encounters[0]?.id.toString() || 'other:100'
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

    const otherLevel = SUPPORTED_LEVELS.find(level => encounterId === `other:${level}`)
    const encounterIdNum = otherLevel ? 0 : parseInt(encounterId)
    const cached =
      encounterIdNum > 0
        ? queryClient.getQueryData<EncounterTemplateResponse>([
            'encounter-template',
            encounterIdNum,
          ])
        : undefined
    const initialEvents = cached?.events

    const base = createNewTimeline(String(encounterIdNum), name.trim(), initialEvents)
    if (otherLevel) base.level = otherLevel
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
                      {tier.patch ? `${tier.name} (${tier.patch})` : tier.name}
                    </SelectLabel>
                    {tier.encounters.map(encounter => (
                      <SelectItem key={encounter.id} value={encounter.id.toString()}>
                        {encounter.shortName} - {encounter.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
                <SelectGroup>
                  <SelectLabel>{t('home:createTimeline.otherGroup')}</SelectLabel>
                  {SUPPORTED_LEVELS.map(level => (
                    <SelectItem key={level} value={`other:${level}`}>
                      {t('home:createTimeline.otherLevel', { level })}
                    </SelectItem>
                  ))}
                </SelectGroup>
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
