/**
 * 技能轨道派生的响应式 hook，供时间轴视图和表格视图共用。
 */

import { useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { deriveSkillTracks, type SkillTrack } from '@/utils/skillTracks'

export function useSkillTracks(): SkillTrack[] {
  const composition = useTimelineStore(s => s.timeline?.composition)
  const hiddenPlayerIds = useUIStore(s => s.hiddenPlayerIds)
  const actions = useMitigationStore(s => s.actions)

  return useMemo(() => {
    if (!composition) return []
    return deriveSkillTracks(composition, hiddenPlayerIds, actions)
  }, [composition, hiddenPlayerIds, actions])
}
