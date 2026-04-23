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
      // 放置 `action` 于 t_n 与已有 cast e 冲突当且仅当两者 CD 条重叠：
      //   [t_n, t_n + action.cooldown) ∩ [e.timestamp, e.timestamp + other.cooldown) ≠ ∅
      // ↔ t_n ∈ (e.timestamp − action.cooldown, e.timestamp + other.cooldown)
      // 左右各扩一次可以覆盖"前向与已有 CD 条重叠"和"后向自己 CD 未到"两种冲突。
      forbidden.push({
        from: e.timestamp - action.cooldown,
        to: e.timestamp + other.cooldown,
      })
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
      : [{ from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY }]
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
    if (intervals.some(i => i.from <= t && t <= i.to)) return { ok: true }
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
        !action.placement ||
        action.placement.validIntervals(ctx).some(i => i.from <= t && t <= i.to)
      // cooldown 用严格重叠 (<) 直接判定，避开区间半开表示在 t_n = t_e - cd_x 边界处的
      // off-by-one：两 CD 条刚好紧贴不算冲突（与原 checkOverlap 行为一致）。
      const groupId = effectiveTrackGroup(action)
      const cooldownOk = !ctx.castEvents.some(e => {
        if (e.id === castEvent.id) return false
        if (e.playerId !== castEvent.playerId) return false
        const other = actions.get(e.actionId)
        if (!other) return false
        if (effectiveTrackGroup(other) !== groupId) return false
        return t < e.timestamp + other.cooldown && e.timestamp < t + action.cooldown
      })
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
    computePlacementShadow,
    pickUniqueMember,
    canPlaceCastEvent,
    findInvalidCastEvents,
  }
}
