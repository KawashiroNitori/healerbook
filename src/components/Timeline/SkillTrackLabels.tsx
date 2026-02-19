/**
 * 技能轨道标签列组件
 */

import JobIcon from '../JobIcon'
import { getIconUrl } from '@/utils/iconUtils'
import type { Job } from '@/types/timeline'

export interface SkillTrack {
  job: Job
  actionId: number
  actionName: string
  actionIcon: string
}

interface SkillTrackLabelsProps {
  skillTracks: SkillTrack[]
  trackHeight: number
}

export default function SkillTrackLabels({ skillTracks, trackHeight }: SkillTrackLabelsProps) {
  return (
    <div>
      {skillTracks.map((track, index) => (
        <div
          key={`label-${track.job}-${track.actionId}`}
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
            className="w-6 h-6 rounded"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
          {/* 技能名称 */}
          <span className="text-xs truncate flex-1">{track.actionName}</span>
        </div>
      ))}
    </div>
  )
}
