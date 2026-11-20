import { effectiveTrackGroup, type MitigationAction } from '@/types/mitigation'
import type { InvalidCastEventSummary, PlacementEngine } from '@/types/placement'
import type { CastEvent } from '@/types/timeline'
import { findClosingRecallCast, isRecallVariant } from './recall'

type CastPlacement =
  | { kind: 'add'; actionId: number }
  | { kind: 'move'; castId: string }
  | { kind: 'reject'; message: string | null }

/** 决定放置方式；调用方传入实际写入的时间，变体仍由模拟器推导。 */
export function planCastPlacement({
  actionId,
  playerId,
  time,
  castEvents,
  actions,
  resolvedVariantByCastId,
  engine,
}: {
  actionId: number
  playerId: number
  time: number
  castEvents: CastEvent[]
  actions: Map<number, MitigationAction>
  resolvedVariantByCastId: Map<string, number>
  engine: PlacementEngine | null
}): CastPlacement {
  const parent = actions.get(actionId)
  const groupId = parent ? effectiveTrackGroup(parent) : actionId
  if (engine && parent) {
    const member = engine.pickUniqueMember(groupId, playerId, time)
    if (!member) {
      return { kind: 'reject', message: engine.getResourceUnmetMessageAt(parent, playerId, time) }
    }

    // 一个收回区间最多放一个收回。前移原 cast 也会保留按 cast ID 锚定的备注。
    if (isRecallVariant(member, groupId)) {
      const trackCasts = castEvents.filter(c => {
        const action = actions.get(c.actionId)
        return (
          c.playerId === playerId && (action ? effectiveTrackGroup(action) : c.actionId) === groupId
        )
      })
      const closing = findClosingRecallCast(
        time,
        trackCasts,
        c => actions.get(resolvedVariantByCastId.get(c.id) ?? c.actionId),
        groupId
      )
      if (closing) return { kind: 'move', castId: closing.id }
    }
  }
  return { kind: 'add', actionId: groupId }
}

/** 回放的实战记录不显示编辑模式的放置校验。 */
export function getInvalidCastEventMap(
  engine: PlacementEngine | null,
  isReplayMode?: boolean,
  excludeCastId?: string
): Map<string, InvalidCastEventSummary> {
  if (!engine || isReplayMode) return new Map()
  return new Map(
    engine
      .findInvalidCastEvents(excludeCastId)
      .map(({ castEvent, reason, resourceId }) => [castEvent.id, { reason, resourceId }])
  )
}
