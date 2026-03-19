import { useState } from 'react'
import { Users, X, Eye, EyeOff } from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import CompositionDialog from './CompositionDialog'
import JobIcon from './JobIcon'
import { sortJobsByOrder, getJobName } from '@/data/jobs'
import { MAX_PARTY_SIZE } from '@/types/timeline'
import type { Composition } from '@/types/timeline'

export default function CompositionPopover() {
  const { timeline, updateComposition } = useTimelineStore()
  const { hiddenPlayerIds, togglePlayerVisibility } = useUIStore()
  const isReadOnly = useEditorReadOnly()
  const [hoveredPlayerId, setHoveredPlayerId] = useState<number | null>(null)

  const composition = timeline?.composition || { players: [] }
  const sortedPlayers = [...composition.players].sort((a, b) => {
    const jobs = sortJobsByOrder([a.job, b.job])
    return jobs.indexOf(a.job) - jobs.indexOf(b.job)
  })
  const canAddMore = sortedPlayers.length < MAX_PARTY_SIZE

  const handleSave = (newComposition: Composition) => updateComposition(newComposition)

  const handleRemove = (playerId: number) => {
    updateComposition({ players: composition.players.filter(p => p.id !== playerId) })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 h-9 px-3 py-2 text-sm border rounded hover:bg-accent transition-colors">
          <Users className="w-4 h-4" />
          小队阵容
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
                onMouseEnter={() => setHoveredPlayerId(player.id)}
                onMouseLeave={() => setHoveredPlayerId(null)}
              >
                <JobIcon job={player.job} size="sm" />
                <span
                  className={`text-sm flex-1 ${hiddenPlayerIds.has(player.id) ? 'text-muted-foreground line-through' : ''}`}
                >
                  {getJobName(player.job)}
                </span>
                {(hoveredPlayerId === player.id || hiddenPlayerIds.has(player.id)) && (
                  <button
                    onClick={() => togglePlayerVisibility(player.id)}
                    className="p-0.5 hover:bg-muted rounded"
                  >
                    {hiddenPlayerIds.has(player.id) ? (
                      <EyeOff className="w-3 h-3 text-muted-foreground" />
                    ) : (
                      <Eye className="w-3 h-3 text-muted-foreground" />
                    )}
                  </button>
                )}
                {!isReadOnly && (
                  <button
                    onClick={() => handleRemove(player.id)}
                    className="p-0.5 hover:bg-muted rounded"
                  >
                    <X className="w-3 h-3 text-muted-foreground" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
        <CompositionDialog
          composition={composition}
          onSave={handleSave}
          disabled={!canAddMore || isReadOnly}
        />
      </PopoverContent>
    </Popover>
  )
}
