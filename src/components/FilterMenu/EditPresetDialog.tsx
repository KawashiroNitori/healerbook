/**
 * 新建 / 编辑过滤预设对话框。
 */

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronRight } from 'lucide-react'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useMitigationStore } from '@/store/mitigationStore'
import { useFilterStore } from '@/store/filterStore'
import { useTooltipStore } from '@/store/tooltipStore'
import {
  JOB_ORDER,
  ROLE_ORDER,
  ROLE_LABELS,
  getJobName,
  groupJobsByRole,
  type Job,
  type JobRole,
} from '@/data/jobs'
import { getIconUrl } from '@/utils/iconUtils'
import JobIcon from '../JobIcon'
import { cn } from '@/lib/utils'
import type { FilterPreset, CustomFilterRule } from '@/types/filter'
import type { DamageEventType } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

interface Props {
  open: boolean
  onClose: () => void
  preset?: FilterPreset
}

const MAX_NAME = 20

export default function EditPresetDialog({ open, onClose, preset }: Props) {
  const allActions = useMitigationStore(s => s.actions)
  const addPreset = useFilterStore(s => s.addPreset)
  const updatePreset = useFilterStore(s => s.updatePreset)
  const showTooltip = useTooltipStore(s => s.showTooltip)
  const hideTooltip = useTooltipStore(s => s.hideTooltip)

  const visibleActions = useMemo(() => allActions.filter(a => !a.hidden), [allActions])

  const actionsByJob = useMemo(() => {
    const map = new Map<Job, MitigationAction[]>()
    for (const job of JOB_ORDER) {
      map.set(
        job,
        visibleActions.filter(a => a.jobs.includes(job))
      )
    }
    return map
  }, [visibleActions])

  const defaultSelectedAll = useMemo(() => {
    const byJob: Partial<Record<Job, number[]>> = {}
    for (const job of JOB_ORDER) {
      byJob[job] = actionsByJob.get(job)!.map(a => a.id)
    }
    return byJob
  }, [actionsByJob])

  const [name, setName] = useState<string>(() => (preset?.kind === 'custom' ? preset.name : ''))
  const [damageTypes, setDamageTypes] = useState<DamageEventType[]>(() =>
    preset?.kind === 'custom' ? preset.rule.damageTypes : ['aoe', 'tankbuster']
  )
  const [selectedActionsByJob, setSelectedActionsByJob] = useState<Partial<Record<Job, number[]>>>(
    () => (preset?.kind === 'custom' ? preset.rule.selectedActionsByJob : defaultSelectedAll)
  )

  const [expandedRoles, setExpandedRoles] = useState<Record<JobRole, boolean>>(() =>
    ROLE_ORDER.reduce((acc, r) => ({ ...acc, [r]: true }), {} as Record<JobRole, boolean>)
  )
  const toggleRoleExpanded = (role: JobRole) => {
    setExpandedRoles(prev => ({ ...prev, [role]: !prev[role] }))
  }

  const toggleDamageType = (t: DamageEventType) => {
    setDamageTypes(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]))
  }

  const toggleAction = (job: Job, actionId: number) => {
    setSelectedActionsByJob(prev => {
      const current = prev[job] ?? []
      const next = current.includes(actionId)
        ? current.filter(id => id !== actionId)
        : [...current, actionId]
      return { ...prev, [job]: next }
    })
  }

  const toggleJobAll = (job: Job) => {
    const jobActionIds = actionsByJob.get(job)!.map(a => a.id)
    const currentIds = selectedActionsByJob[job] ?? []
    const allSelected = jobActionIds.every(id => currentIds.includes(id))
    setSelectedActionsByJob(prev => ({
      ...prev,
      [job]: allSelected ? [] : jobActionIds,
    }))
  }

  const toggleRoleAll = (jobs: Job[]) => {
    const relevantJobs = jobs.filter(job => (actionsByJob.get(job) ?? []).length > 0)
    const allSelected = relevantJobs.every(job => {
      const jobActionIds = actionsByJob.get(job)!.map(a => a.id)
      const currentIds = selectedActionsByJob[job] ?? []
      return jobActionIds.every(id => currentIds.includes(id))
    })
    setSelectedActionsByJob(prev => {
      const next = { ...prev }
      for (const job of relevantJobs) {
        next[job] = allSelected ? [] : actionsByJob.get(job)!.map(a => a.id)
      }
      return next
    })
  }

  const canSave = name.trim().length > 0

  const handleSave = () => {
    if (!canSave) return
    const rule: CustomFilterRule = { damageTypes, selectedActionsByJob }
    if (preset?.kind === 'custom') {
      updatePreset(preset.id, { name: name.trim(), rule })
      toast.success('已保存')
    } else {
      addPreset(name.trim(), rule)
      toast.success('已创建')
    }
    onClose()
  }

  const jobsByRole = useMemo(() => groupJobsByRole(JOB_ORDER), [])

  return (
    <Modal open={open} onClose={onClose} maxWidth="2xl">
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{preset?.kind === 'custom' ? '编辑过滤预设' : '新建过滤预设'}</ModalTitle>
        </ModalHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">预设名称</label>
            <div className="relative">
              <Input
                value={name}
                onChange={e => setName(e.target.value.slice(0, MAX_NAME))}
                maxLength={MAX_NAME}
                placeholder="输入预设名称"
                className="pr-14"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                {name.length} / {MAX_NAME}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">伤害事件类型</label>
            <div className="flex items-center gap-6 px-2 py-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={damageTypes.includes('aoe')}
                  onCheckedChange={() => toggleDamageType('aoe')}
                />
                <span className="text-sm">AOE</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={damageTypes.includes('tankbuster')}
                  onCheckedChange={() => toggleDamageType('tankbuster')}
                />
                <span className="text-sm">死刑</span>
              </label>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">技能选择</label>
            <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1 scrollbar-thin">
              {ROLE_ORDER.map(role => {
                const jobsInRole = jobsByRole[role]
                if (jobsInRole.length === 0) return null
                const relevantJobs = jobsInRole.filter(
                  job => (actionsByJob.get(job) ?? []).length > 0
                )
                const roleAllSelected =
                  relevantJobs.length > 0 &&
                  relevantJobs.every(job => {
                    const jobActionIds = actionsByJob.get(job)!.map(a => a.id)
                    const currentIds = selectedActionsByJob[job] ?? []
                    return jobActionIds.every(id => currentIds.includes(id))
                  })
                return (
                  <Collapsible
                    key={role}
                    open={expandedRoles[role]}
                    onOpenChange={() => toggleRoleExpanded(role)}
                    className="space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <CollapsibleTrigger className="flex items-center gap-1 flex-1 text-left hover:text-foreground">
                        <ChevronRight
                          className={cn(
                            'h-3.5 w-3.5 text-muted-foreground transition-transform',
                            expandedRoles[role] && 'rotate-90'
                          )}
                        />
                        <h4 className="text-xs font-medium text-muted-foreground">
                          {ROLE_LABELS[role]}
                        </h4>
                      </CollapsibleTrigger>
                      {relevantJobs.length > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => toggleRoleAll(jobsInRole)}
                        >
                          {roleAllSelected ? '取消全选' : '全选'}
                        </Button>
                      )}
                    </div>
                    <CollapsibleContent className="space-y-0">
                      {jobsInRole.map(job => {
                        const jobActions = actionsByJob.get(job) ?? []
                        if (jobActions.length === 0) return null
                        const currentIds = selectedActionsByJob[job] ?? []
                        const allSelected = jobActions.every(a => currentIds.includes(a.id))
                        return (
                          <div
                            key={job}
                            className="py-1.5 border-t border-border/50 first:border-t-0"
                          >
                            <div className="flex items-center gap-2">
                              <JobIcon job={job} size="sm" />
                              <span className="text-xs flex-1">{getJobName(job)}</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs shrink-0"
                                onClick={() => toggleJobAll(job)}
                              >
                                {allSelected ? '取消全选' : '全选'}
                              </Button>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-1.5 pl-6">
                              {jobActions.map(action => {
                                const isSelected = currentIds.includes(action.id)
                                return (
                                  <button
                                    key={action.id}
                                    type="button"
                                    onClick={() => toggleAction(job, action.id)}
                                    onMouseEnter={e =>
                                      showTooltip(action, e.currentTarget.getBoundingClientRect(), [
                                        'b',
                                        't',
                                        'r',
                                        'l',
                                      ])
                                    }
                                    onMouseLeave={hideTooltip}
                                    className={cn(
                                      'relative h-8 w-8 overflow-hidden rounded-md border transition',
                                      isSelected
                                        ? 'border-primary ring-1 ring-primary'
                                        : 'border-border opacity-60 saturate-50 hover:opacity-90 hover:saturate-100'
                                    )}
                                  >
                                    <img
                                      src={getIconUrl(action.icon)}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                    {isSelected && (
                                      <span className="absolute right-0 top-0 flex h-3 w-3 items-center justify-center rounded-tr-md rounded-bl-md bg-green-500 text-[8px] font-bold leading-none text-white">
                                        ✓
                                      </span>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </div>
          </div>
        </div>

        <ModalFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            保存
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
