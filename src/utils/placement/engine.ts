import type { CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import { effectiveTrackGroup } from '@/types/mitigation'
import type {
  Interval,
  InvalidCastEvent,
  PlacementContext,
  PlacementEngine,
  StatusTimelineByPlayer,
} from './types'
import { complement, intersect, mergeOverlapping, sortIntervals } from './intervals'

export interface PlacementEngineInput {
  castEvents: CastEvent[]
  actions: Map<number, MitigationAction>
  simulate: (castEvents: CastEvent[]) => { statusTimelineByPlayer: StatusTimelineByPlayer }
}

export function createPlacementEngine(input: PlacementEngineInput): PlacementEngine {
  const { castEvents, actions, simulate } = input
  const defaultTimeline = simulate(castEvents).statusTimelineByPlayer

  const excludedTimelineCache = new Map<string, StatusTimelineByPlayer>()

  function timelineFor(excludeId?: string): StatusTimelineByPlayer {
    if (!excludeId) return defaultTimeline
    const cached = excludedTimelineCache.get(excludeId)
    if (cached) return cached
    const filtered = castEvents.filter(e => e.id !== excludeId)
    const next = simulate(filtered).statusTimelineByPlayer
    excludedTimelineCache.set(excludeId, next)
    return next
  }

  function effectiveCastEvents(excludeId?: string): CastEvent[] {
    return excludeId ? castEvents.filter(e => e.id !== excludeId) : castEvents
  }

  function buildContext(
    action: MitigationAction,
    playerId: number,
    excludeId?: string,
    castEvent?: CastEvent
  ): PlacementContext {
    return {
      action,
      playerId,
      castEvent,
      castEvents: effectiveCastEvents(excludeId),
      actions,
      statusTimelineByPlayer: timelineFor(excludeId),
    }
  }

  function cooldownAvailable(
    action: MitigationAction,
    playerId: number,
    ctxEvents: CastEvent[]
  ): Interval[] {
    const groupId = effectiveTrackGroup(action)
    const forbidden: Interval[] = []
    for (const e of ctxEvents) {
      if (e.playerId !== playerId) continue
      const other = actions.get(e.actionId)
      if (!other) continue
      if (effectiveTrackGroup(other) !== groupId) continue
      forbidden.push({ from: e.timestamp, to: e.timestamp + other.cooldown })
    }
    return complement(mergeOverlapping(sortIntervals(forbidden)))
  }

  function getValidIntervals(
    action: MitigationAction,
    playerId: number,
    excludeId?: string
  ): Interval[] {
    const ctx = buildContext(action, playerId, excludeId)
    const placementIntervals = action.placement
      ? action.placement.validIntervals(ctx)
      : [{ from: 0, to: Number.POSITIVE_INFINITY }]
    const cd = cooldownAvailable(action, playerId, ctx.castEvents)
    return intersect(placementIntervals, cd)
  }

  const trackGroupMembers = new Map<number, MitigationAction[]>()
  for (const action of actions.values()) {
    const gid = effectiveTrackGroup(action)
    const arr = trackGroupMembers.get(gid) ?? []
    arr.push(action)
    trackGroupMembers.set(gid, arr)
  }

  function computeTrackShadow(groupId: number, playerId: number, excludeId?: string): Interval[] {
    const members = trackGroupMembers.get(groupId) ?? []
    const legal = members.flatMap(m => getValidIntervals(m, playerId, excludeId))
    return complement(mergeOverlapping(sortIntervals(legal)))
  }

  function canPlaceCastEvent(
    action: MitigationAction,
    playerId: number,
    t: number,
    excludeId?: string
  ): { ok: true } | { ok: false; reason: string } {
    const intervals = getValidIntervals(action, playerId, excludeId)
    if (intervals.some(i => i.from <= t && t < i.to)) return { ok: true }
    return { ok: false, reason: 'not_available' }
  }

  function pickUniqueMember(
    groupId: number,
    playerId: number,
    t: number,
    excludeId?: string
  ): MitigationAction | null {
    const members = trackGroupMembers.get(groupId) ?? []
    const legal = members.filter(m => canPlaceCastEvent(m, playerId, t, excludeId).ok)
    return legal.length === 1 ? legal[0] : null
  }

  function findInvalidCastEvents(excludeId?: string): InvalidCastEvent[] {
    const result: InvalidCastEvent[] = []
    const events = effectiveCastEvents(excludeId).filter(e => e.id !== excludeId)
    for (const castEvent of events) {
      const action = actions.get(castEvent.actionId)
      if (!action) continue
      const t = castEvent.timestamp
      const ctx = buildContext(action, castEvent.playerId, excludeId, castEvent)
      const placementOk =
        !action.placement || action.placement.validIntervals(ctx).some(i => i.from <= t && t < i.to)
      const cooldownOk = cooldownAvailable(
        action,
        castEvent.playerId,
        // castEvent 自己一定在 ctx.castEvents 中；要排除它自己避免自我 CD 冲突
        ctx.castEvents.filter(e => e.id !== castEvent.id)
      ).some(i => i.from <= t && t < i.to)
      if (placementOk && cooldownOk) continue
      const reason =
        !placementOk && !cooldownOk
          ? ('both' as const)
          : !placementOk
            ? ('placement_lost' as const)
            : ('cooldown_conflict' as const)
      result.push({ castEvent, reason })
    }
    return result
  }

  return {
    getValidIntervals,
    computeTrackShadow,
    pickUniqueMember,
    canPlaceCastEvent,
    findInvalidCastEvents,
  }
}
