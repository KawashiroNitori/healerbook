import type { CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import { effectiveTrackGroup } from '@/types/mitigation'
import type { Interval, PlacementContext, PlacementEngine, StatusTimelineByPlayer } from './types'
import { complement, intersect, mergeOverlapping, sortIntervals } from './intervals'

export interface PlacementEngineInput {
  castEvents: CastEvent[]
  actions: Map<number, MitigationAction>
  simulate: (castEvents: CastEvent[]) => { statusTimelineByPlayer: StatusTimelineByPlayer }
}

export function createPlacementEngine(input: PlacementEngineInput): PlacementEngine {
  const { castEvents, actions, simulate } = input
  const defaultTimeline = simulate(castEvents).statusTimelineByPlayer

  // Task 8 会把下面这两个 helper 扩成接受 excludeId 的重放/过滤版本；Task 6 只返回默认快照。
  function timelineFor(): StatusTimelineByPlayer {
    return defaultTimeline
  }

  function effectiveCastEvents(): CastEvent[] {
    return castEvents
  }

  function buildContext(
    action: MitigationAction,
    playerId: number,
    castEvent?: CastEvent
  ): PlacementContext {
    return {
      action,
      playerId,
      castEvent,
      castEvents: effectiveCastEvents(),
      actions,
      statusTimelineByPlayer: timelineFor(),
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

  // Task 6 的 getValidIntervals 签名已保留 excludeId（满足 PlacementEngine 接口），
  // 但 Task 8 才接入重放语义；目前 excludeId 仅作占位，不影响查询结果。
  function getValidIntervals(
    action: MitigationAction,
    playerId: number,
    excludeId?: string
  ): Interval[] {
    void excludeId
    const ctx = buildContext(action, playerId)
    const placementIntervals = action.placement
      ? action.placement.validIntervals(ctx)
      : [{ from: 0, to: Number.POSITIVE_INFINITY }]
    const cd = cooldownAvailable(action, playerId, ctx.castEvents)
    return intersect(placementIntervals, cd)
  }

  return {
    getValidIntervals,
    computeTrackShadow: () => {
      throw new Error('computeTrackShadow not implemented yet')
    },
    pickUniqueMember: () => {
      throw new Error('pickUniqueMember not implemented yet')
    },
    canPlaceCastEvent: () => {
      throw new Error('canPlaceCastEvent not implemented yet')
    },
    findInvalidCastEvents: () => {
      throw new Error('findInvalidCastEvents not implemented yet')
    },
  }
}
