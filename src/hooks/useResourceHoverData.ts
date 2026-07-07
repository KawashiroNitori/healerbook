/**
 * 战斗资源悬浮窗数据源：组装 skillTracks / 资源事件，产出按时刻取快照的 getSnapshotAt。
 * 须在 DamageCalculationContext.Provider 作用域内使用（取 statusTimeline / resolvedVariant）。
 */

import { useCallback, useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { ACTIONS } from '@/data/mitigationActions'
import { useSkillTracks } from '@/hooks/useSkillTracks'
import {
  useStatusTimelineByPlayer,
  useResolvedVariantByCastId,
} from '@/contexts/DamageCalculationContext'
import { deriveResourceEvents } from '@/utils/resource/compute'
import {
  computeResourceSnapshots,
  type MemberResourceSnapshot,
} from '@/utils/resource/hoverSnapshot'
import { RESOURCE_REGISTRY } from '@/data/resources'

export function useResourceHoverData(): {
  getSnapshotAt: (time: number) => MemberResourceSnapshot[]
} {
  const timeline = useTimelineStore(s => s.timeline)
  const tracks = useSkillTracks()
  const statusTimeline = useStatusTimelineByPlayer()
  const resolvedVariant = useResolvedVariantByCastId()

  const actionsById = useMemo(() => new Map(ACTIONS.map(a => [a.id, a])), [])

  const resourceEventsByKey = useMemo(() => {
    if (!timeline) return new Map()
    return deriveResourceEvents(timeline.castEvents, actionsById, statusTimeline, resolvedVariant)
  }, [timeline, actionsById, statusTimeline, resolvedVariant])

  return {
    getSnapshotAt: useCallback(
      (time: number) =>
        timeline
          ? computeResourceSnapshots(
              { tracks, actionsById, registry: RESOURCE_REGISTRY, resourceEventsByKey },
              time
            )
          : [],
      [timeline, tracks, actionsById, resourceEventsByKey]
    ),
  }
}
