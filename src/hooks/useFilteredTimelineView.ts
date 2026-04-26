/**
 * 时间轴事件过滤 hook。
 *
 * 产出当前选中 FilterPreset 下应显示的 damage / cast 事件集合。
 * 不做减伤重算，纯视觉过滤。
 */

import { useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useFilterStore } from '@/store/filterStore'
import { getJobRole, type Job } from '@/data/jobs'
import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { FilterPreset } from '@/types/filter'
import type { SkillTrack } from '@/utils/skillTracks'

export interface FilteredView {
  filteredDamageEvents: DamageEvent[]
  filteredCastEvents: CastEvent[]
}

export function matchSingleAction(
  action: MitigationAction,
  playerJob: Job,
  preset: FilterPreset
): boolean {
  if (preset.kind === 'builtin') {
    const { categories, jobRoles } = preset.rule
    if (categories && categories.length > 0) {
      if (!categories.some(c => action.category.includes(c))) return false
    }
    if (!jobRoles || jobRoles.length === 0) return true
    const role = getJobRole(playerJob)
    return role != null && jobRoles.includes(role)
  }
  // 同 trackGroup 的变体（如 37016 trackGroup=37013）共用主轨道：
  // 自定义预设里只能勾父，变体匹配时回退到父 ID。
  const groupId = action.trackGroup ?? action.id
  return preset.rule.selectedActionsByJob[playerJob]?.includes(groupId) ?? false
}

export function matchDamageEvent(e: DamageEvent, preset: FilterPreset): boolean {
  const { damageTypes } = preset.rule
  if (!damageTypes || damageTypes.length === 0) return true
  return damageTypes.includes(e.type)
}

export function matchCastEvent(
  e: CastEvent,
  playerJob: Job,
  preset: FilterPreset,
  actionMap: Map<number, MitigationAction>
): boolean {
  const action = actionMap.get(e.actionId)
  if (!action) return false
  return matchSingleAction(action, playerJob, preset)
}

export function matchTrack(
  t: SkillTrack,
  preset: FilterPreset,
  actionMap: Map<number, MitigationAction>
): boolean {
  const action = actionMap.get(t.actionId)
  if (!action) return false
  return matchSingleAction(action, t.job, preset)
}

export function useFilteredTimelineView(): FilteredView {
  const timeline = useTimelineStore(s => s.timeline)
  const actions = useMitigationStore(s => s.actions)
  const activePreset = useFilterStore(s => s.getActivePreset())

  return useMemo(() => {
    if (!timeline) {
      return { filteredDamageEvents: [], filteredCastEvents: [] }
    }

    const actionMap = new Map(actions.map(a => [a.id, a]))
    const playerJobById = new Map<number, Job>(timeline.composition.players.map(p => [p.id, p.job]))

    const filteredDamageEvents = timeline.damageEvents.filter(e =>
      matchDamageEvent(e, activePreset)
    )

    const filteredCastEvents = timeline.castEvents.filter(e => {
      const job = playerJobById.get(e.playerId)
      if (!job) return false
      return matchCastEvent(e, job, activePreset, actionMap)
    })

    return { filteredDamageEvents, filteredCastEvents }
  }, [timeline, actions, activePreset])
}
