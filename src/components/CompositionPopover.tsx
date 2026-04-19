import { Users } from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import CompositionDialog from './CompositionDialog'
import JobIcon from './JobIcon'
import { sortJobsByOrder, getJobName } from '@/data/jobs'
import { MAX_PARTY_SIZE } from '@/types/timeline'
import type { Composition } from '@/types/timeline'

export default function CompositionPopover() {
  const { timeline, updateComposition } = useTimelineStore()
  const isReadOnly = useEditorReadOnly()

  const composition = timeline?.composition || { players: [] }
  const sortedPlayers = [...composition.players].sort((a, b) => {
    const jobs = sortJobsByOrder([a.job, b.job])
    return jobs.indexOf(a.job) - jobs.indexOf(b.job)
  })
  const handleSave = (newComposition: Composition) => updateComposition(newComposition)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex shrink-0 items-center gap-2 h-7 px-2 py-1 text-xs border rounded hover:bg-accent transition-colors whitespace-nowrap">
          <Users className="w-4 h-4 shrink-0" />
          <span className="hidden lg:inline">小队阵容</span>
          <span className="text-xs text-muted-foreground">
            {sortedPlayers.length}/{MAX_PARTY_SIZE}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="space-y-1 mb-2">
          {sortedPlayers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">暂无队员</p>
          ) : (
            sortedPlayers.map(player => (
              <div
                key={player.id}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50"
              >
                <JobIcon job={player.job} size="sm" />
                <span className="text-sm flex-1">{getJobName(player.job)}</span>
              </div>
            ))
          )}
        </div>
        {!isReadOnly && <CompositionDialog composition={composition} onSave={handleSave} />}
      </PopoverContent>
    </Popover>
  )
}
