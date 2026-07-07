/**
 * 技能轨道派生的响应式 hook，集成过滤器。
 */

import { useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { ACTIONS } from '@/data/mitigationActions'
import { useFilterStore } from '@/store/filterStore'
import { deriveSkillTracks, type SkillTrack } from '@/utils/skillTracks'
import { matchTrack } from './useFilteredTimelineView'

export function useSkillTracks(): SkillTrack[] {
  const composition = useTimelineStore(s => s.timeline?.composition)
  const activePreset = useFilterStore(s => s.getActivePreset())

  return useMemo(() => {
    if (!composition) return []
    const tracks = deriveSkillTracks(composition, new Set(), ACTIONS)
    const actionMap = new Map(ACTIONS.map(a => [a.id, a]))
    return tracks.filter(t => matchTrack(t, activePreset, actionMap))
  }, [composition, activePreset])
}
