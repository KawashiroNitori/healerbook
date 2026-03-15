/**
 * 技能轨道标签列组件
 */

import JobIcon from '../JobIcon'
import { getIconUrl } from '@/utils/iconUtils'
import type { Job } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

export interface SkillTrack {
  job: Job
  playerId: number
  actionId: number
  actionName: string
  actionIcon: string
}

interface SkillTrackLabelsProps {
  skillTracks: SkillTrack[]
  trackHeight: number
  actions: MitigationAction[]
  onHoverAction: (action: MitigationAction, anchorRect: DOMRect) => void
  onClickAction: (action: MitigationAction, anchorRect: DOMRect) => void
  onUnhoverAction: () => void
}

export default function SkillTrackLabels({ skillTracks, trackHeight, actions, onHoverAction, onClickAction, onUnhoverAction }: SkillTrackLabelsProps) {
  return (
    <div>
      {skillTracks.map((track, index) => {
        const action = actions.find((a) => a.id === track.actionId)
        return (
          <div
            key={`label-${track.playerId}-${track.actionId}`}
            style={{ height: trackHeight }}
            className={`border-b flex items-center gap-2 px-2 ${
              index % 2 === 0 ? 'bg-background' : 'bg-muted/20'
            }`}
          >
            {/* 职业图标 */}
            <div className="opacity-60">
              <JobIcon job={track.job} size="sm" />
            </div>
            {/* 技能图标 */}
            <img
              src={getIconUrl(track.actionIcon)}
              alt={track.actionName}
              className="w-6 h-6 rounded cursor-pointer"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
              onMouseEnter={(e) => {
                if (action) onHoverAction(action, e.currentTarget.getBoundingClientRect())
              }}
              onMouseLeave={onUnhoverAction}
              onClick={(e) => {
                if (action) onClickAction(action, e.currentTarget.getBoundingClientRect())
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
