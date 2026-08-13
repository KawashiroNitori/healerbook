/**
 * 战斗资源悬浮窗数据源：组装 skillTracks / 资源事件，产出按时刻取快照的 getSnapshotAt。
 * 须在 DamageCalculationContext.Provider 作用域内使用（取 statusTimeline / resolvedVariant）。
 */

import { useCallback, useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useResolvedActions } from '@/hooks/useResolvedActions'
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

  // 资源池的 resourceEffects 可被等级覆盖，悬浮窗必须按当前时间轴等级 resolve，
  // 否则低等级下会显示按 100 级充能数算出的错误库存。
  const { actionMap: actionsById } = useResolvedActions()

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
