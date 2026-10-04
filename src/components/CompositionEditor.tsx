import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, X } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { MAX_PARTY_SIZE, type Job, type Composition } from '@/types/timeline'
import {
  getJobName,
  getTankJobs,
  getHealerJobs,
  getDPSJobs,
  getJobRole,
  sortJobsByOrder,
} from '@/data/jobs'
import JobIcon from './JobIcon'

interface CompositionEditorProps {
  composition: Composition
  onChange: (composition: Composition) => void
  isReadOnly: boolean
}

const dpsJobs = getDPSJobs()
const JOB_ROWS: Array<{ labelKey: string; jobs: Job[] }> = [
  { labelKey: 'composition.roleTank', jobs: getTankJobs() },
  { labelKey: 'composition.roleHealer', jobs: getHealerJobs() },
  { labelKey: 'composition.roleMelee', jobs: dpsJobs.filter(j => getJobRole(j) === 'melee') },
  { labelKey: 'composition.roleRanged', jobs: dpsJobs.filter(j => getJobRole(j) === 'ranged') },
  { labelKey: 'composition.roleCaster', jobs: dpsJobs.filter(j => getJobRole(j) === 'caster') },
]

function generatePlayerId(players: Composition['players']): number {
  const ids = new Set(players.map(p => p.id))
  let id = Date.now() + Math.floor(Math.random() * 1000)
  while (ids.has(id)) id++
  return id
}

export default function CompositionEditor({
  composition,
  onChange,
  isReadOnly,
}: CompositionEditorProps) {
  const { t } = useTranslation(['editor', 'common'])
  const [isAdjusting, setIsAdjusting] = useState(false)
  const canEdit = isAdjusting && !isReadOnly
  const canAddMore = canEdit && composition.players.length < MAX_PARTY_SIZE
  const sortedPlayers = [...composition.players].sort((a, b) => {
    const jobs = sortJobsByOrder([a.job, b.job])
    return jobs.indexOf(a.job) - jobs.indexOf(b.job)
  })

  const handleAddJob = (job: Job) => {
    if (!canAddMore) return
    const id = generatePlayerId(composition.players)
    onChange({ ...composition, players: [...composition.players, { id, job }] })
  }

  const handleRemove = (playerId: number) => {
    if (!canEdit) return
    onChange({ ...composition, players: composition.players.filter(p => p.id !== playerId) })
  }

  return (
    <TooltipProvider>
      <Collapsible open={isAdjusting} onOpenChange={setIsAdjusting}>
        <div>
          <div className="flex items-center justify-between gap-4">
            <span className="shrink-0 text-sm text-muted-foreground">
              {composition.players.length}/{MAX_PARTY_SIZE}
            </span>
            <div className="flex-1 min-w-0">
              {sortedPlayers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  {t('editor:composition.empty')}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {sortedPlayers.map(player => (
                    <Tooltip key={player.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => handleRemove(player.id)}
                          disabled={!canEdit}
                          aria-label={
                            canEdit
                              ? t('editor:composition.removeHint', { name: getJobName(player.job) })
                              : getJobName(player.job)
                          }
                          className="relative group disabled:cursor-default"
                        >
                          <JobIcon job={player.job} size="lg" />
                          {canEdit && (
                            <span className="absolute inset-0 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity">
                              <X className="w-3 h-3 text-white" />
                            </span>
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {canEdit
                          ? t('editor:composition.removeHint', { name: getJobName(player.job) })
                          : getJobName(player.job)}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>
            {!isReadOnly && (
              <CollapsibleTrigger className="group flex shrink-0 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                <ChevronDown className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
                {t('editor:composition.adjustComposition')}
              </CollapsibleTrigger>
            )}
          </div>
        </div>
        {!isReadOnly && (
          <CollapsibleContent className="space-y-2 border-t mt-3 pt-3">
            {JOB_ROWS.map(({ labelKey, jobs }) => (
              <div key={labelKey} className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground w-8 shrink-0">
                  {t(`editor:${labelKey}`)}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {jobs.map(job => (
                    <Tooltip key={job}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => handleAddJob(job)}
                          disabled={!canAddMore}
                          aria-label={getJobName(job)}
                          className={`transition-all ${canAddMore ? 'opacity-60 hover:opacity-100 hover:scale-105' : 'opacity-20 cursor-not-allowed'}`}
                        >
                          <JobIcon job={job} size="lg" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{getJobName(job)}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>
            ))}
          </CollapsibleContent>
        )}
      </Collapsible>
    </TooltipProvider>
  )
}
