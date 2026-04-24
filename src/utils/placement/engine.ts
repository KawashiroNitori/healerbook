import type { CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import { effectiveTrackGroup } from '@/types/mitigation'
import type {
  Interval,
  InvalidCastEvent,
  InvalidReason,
  PlacementContext,
  PlacementEngine,
  StatusTimelineByPlayer,
} from './types'
import { TIME_EPS } from './types'
import { complement, intersect, mergeOverlapping, sortIntervals } from './intervals'
import { deriveResourceEvents } from '@/utils/resource/compute'
import { findResourceExhaustedCasts } from '@/utils/resource/validator'
import { resourceLegalIntervals } from '@/utils/resource/legalIntervals'
import { RESOURCE_REGISTRY } from '@/data/resources'
import { computeCdBarEnd } from '@/utils/resource/cdBar'

export interface PlacementEngineInput {
  castEvents: CastEvent[]
  actions: Map<number, MitigationAction>
  simulate: (castEvents: CastEvent[]) => { statusTimelineByPlayer: StatusTimelineByPlayer }
}

export function createPlacementEngine(input: PlacementEngineInput): PlacementEngine {
  const { castEvents, actions, simulate } = input
  const defaultTimeline = simulate(castEvents).statusTimelineByPlayer
  const resourceEventsByKey = deriveResourceEvents(castEvents, actions)

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

  function getValidIntervals(
    action: MitigationAction,
    playerId: number,
    excludeId?: string
  ): Interval[] {
    const ctx = buildContext(action, playerId, excludeId)
    const placementIntervals = action.placement
      ? action.placement.validIntervals(ctx)
      : [{ from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY }]
    const effectiveResourceEvents = excludeId
      ? deriveResourceEvents(
          castEvents.filter(e => e.id !== excludeId),
          actions
        )
      : resourceEventsByKey
    const resourceIntervals = resourceLegalIntervals(
      action,
      playerId,
      effectiveResourceEvents,
      RESOURCE_REGISTRY
    )
    return intersect(placementIntervals, resourceIntervals)
  }

  // 蓝条 rawEnd cache：key = castEventId。engine 生命周期内固定（castEvents 不变）。
  const cdBarEndCache = new Map<string, number | null>()
  const castEventById = new Map(castEvents.map(ce => [ce.id, ce]))

  function cdBarEndFor(castEventId: string): number | null {
    if (cdBarEndCache.has(castEventId)) return cdBarEndCache.get(castEventId)!
    const ce = castEventById.get(castEventId)
    if (!ce) {
      cdBarEndCache.set(castEventId, null)
      return null
    }
    const action = actions.get(ce.actionId)
    if (!action) {
      cdBarEndCache.set(castEventId, null)
      return null
    }
    const end = computeCdBarEnd(action, ce, resourceEventsByKey, RESOURCE_REGISTRY)
    cdBarEndCache.set(castEventId, end)
    return end
  }

  const trackGroupMembers = new Map<number, MitigationAction[]>()
  for (const action of actions.values()) {
    const gid = effectiveTrackGroup(action)
    const arr = trackGroupMembers.get(gid) ?? []
    arr.push(action)
    trackGroupMembers.set(gid, arr)
  }

  // 阴影缓存：按 (groupId, playerId, excludeId) 记忆。
  // engine 实例本身随 timeline.castEvents 变化重建，故缓存生命周期等价于"当前轨道数据快照"，
  // 拖拽 / 多次 re-render 时命中缓存避免重复 flatMap + complement。
  const trackShadowCache = new Map<string, Interval[]>()
  const placementShadowCache = new Map<string, Interval[]>()
  const shadowKey = (groupId: number, playerId: number, excludeId?: string) =>
    `${groupId}|${playerId}|${excludeId ?? ''}`

  function computeTrackShadow(groupId: number, playerId: number, excludeId?: string): Interval[] {
    const key = shadowKey(groupId, playerId, excludeId)
    const cached = trackShadowCache.get(key)
    if (cached) return cached
    const members = trackGroupMembers.get(groupId) ?? []
    const legal = members.flatMap(m => getValidIntervals(m, playerId, excludeId))
    const shadow = complement(mergeOverlapping(sortIntervals(legal)))
    trackShadowCache.set(key, shadow)
    return shadow
  }

  /**
   * 同 computeTrackShadow，但只看 placement 合法区，不把 CD 冲突带入阴影。
   * 用于短 CD 技能轨道（cd<=3）——其 CD 冲突窗口只有几秒宽，视觉上是噪音，
   * 合法性反馈交给红框即可，阴影只用来表达 placement 非法区。
   */
  function computePlacementShadow(
    groupId: number,
    playerId: number,
    excludeId?: string
  ): Interval[] {
    const key = shadowKey(groupId, playerId, excludeId)
    const cached = placementShadowCache.get(key)
    if (cached) return cached
    const members = trackGroupMembers.get(groupId) ?? []
    if (members.length === 0) {
      placementShadowCache.set(key, [])
      return []
    }
    // 任一 member 用于构造共享 ctx——ctx 里 action 字段目前未被 placement 读取，
    // 读的是 statusTimelineByPlayer / castEvents / playerId。
    const ctx = buildContext(members[0], playerId, excludeId)
    const legal = members.flatMap(m =>
      m.placement
        ? m.placement.validIntervals(ctx)
        : [{ from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY }]
    )
    const shadow = complement(mergeOverlapping(sortIntervals(legal)))
    placementShadowCache.set(key, shadow)
    return shadow
  }

  function canPlaceCastEvent(
    action: MitigationAction,
    playerId: number,
    t: number,
    excludeId?: string
  ): { ok: true } | { ok: false; reason: string } {
    const intervals = getValidIntervals(action, playerId, excludeId)
    // 上界用 <=：cast 在 interval 终点时仍算合法。
    // 两种边界场景语义一致：
    //   - 自耗型 cast（如神爱抚自己 consume 3881）的 interval 被 simulate 收束在 cast 瞬间
    //   - buff 自然过期当拍 cast，simulate 的 endTime >= cur 过滤也保留了该拍
    // 两端各放 TIME_EPS：吸收 interval 端点的浮点误差，避免边界浮点偏差导致"本应合法"被判非法。
    if (intervals.some(i => i.from - TIME_EPS <= t && t <= i.to + TIME_EPS)) return { ok: true }
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
    const effectiveEvents = effectiveCastEvents(excludeId)

    // 1. placement 层失效
    const placementLost = new Map<string, boolean>()
    for (const castEvent of effectiveEvents) {
      const action = actions.get(castEvent.actionId)
      if (!action) continue
      const t = castEvent.timestamp
      const ctx = buildContext(action, castEvent.playerId, excludeId, castEvent)
      const ok =
        !action.placement ||
        action.placement
          .validIntervals(ctx)
          .some(i => i.from - TIME_EPS <= t && t <= i.to + TIME_EPS)
      if (!ok) placementLost.set(castEvent.id, true)
    }

    // 2. resource 层失效
    const resourceExhausted = findResourceExhaustedCasts(
      castEvents,
      actions,
      RESOURCE_REGISTRY,
      excludeId
    )
    const exhaustedMap = new Map<string, string>()
    for (const ex of resourceExhausted) {
      // 一次 cast 可能命中多个资源，保留第一个
      if (!exhaustedMap.has(ex.castEventId)) exhaustedMap.set(ex.castEventId, ex.resourceId)
    }

    // 3. 合并
    const result: InvalidCastEvent[] = []
    for (const castEvent of effectiveEvents) {
      const pLost = placementLost.has(castEvent.id)
      const rExhausted = exhaustedMap.has(castEvent.id)
      if (!pLost && !rExhausted) continue
      const reason: InvalidReason =
        pLost && rExhausted ? 'both' : pLost ? 'placement_lost' : 'resource_exhausted'
      const entry: InvalidCastEvent = { castEvent, reason }
      if (rExhausted) entry.resourceId = exhaustedMap.get(castEvent.id)
      result.push(entry)
    }
    return result
  }

  return {
    getValidIntervals,
    computeTrackShadow,
    computePlacementShadow,
    pickUniqueMember,
    canPlaceCastEvent,
    findInvalidCastEvents,
    cdBarEndFor,
  }
}
