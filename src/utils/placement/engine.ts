import type { CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import { effectiveTrackGroup } from '@/types/mitigation'
import type { StatusInterval } from '@/types/status'
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
import { findResourceExhaustedCasts, probeResourceUnmetMessage } from '@/utils/resource/validator'
import { resourceLegalIntervals } from '@/utils/resource/legalIntervals'
import { RESOURCE_REGISTRY } from '@/data/resources'
import { computeCdBarEnd } from '@/utils/resource/cdBar'

export interface PlacementEngineInput {
  castEvents: CastEvent[]
  actions: Map<number, MitigationAction>
  /** 主路径 status timeline。`excludeId` 缺省时所有查询直接共享这一份。 */
  statusTimelineByPlayer: StatusTimelineByPlayer
  /**
   * 预算好的"假装该 cast 不存在"的 status timeline 表。worker 路径下由
   * `useDamageCalculation` 一次性返回。带 excludeId 的查询命中即用；未命中
   * 降级为"按 sourceCastEventId 过滤主路径 timeline"——降级语义与原 simulateOnRemove
   * 缺省时一致：只适合"该 cast 只 attach、不消费 / 不打断"的场景，消费型 cast 的
   * 截断效果不可还原（详见 timelineExcluding 注释）。
   *
   * 不传 = engine 内所有带 excludeId 查询走过滤降级。EditorPage 自动重分类即此路径。
   */
  removalTimelinesByExcludeId?: Map<string, StatusTimelineByPlayer>
  /**
   * simulate 因果推导的 cast→具体变体 id 映射。资源 / CD 层按变体（而非持久化的
   * trackGroup 父 id）算 cd 与池消耗——「收回」型变体（如星体爆轰 8324，cd0）不再
   * 误占父技能（地星 7439，cd60）的 CD。缺省则退回父 id。
   */
  resolvedVariantByCastId?: Map<string, number>
}

export function createPlacementEngine(input: PlacementEngineInput): PlacementEngine {
  const {
    castEvents,
    actions,
    statusTimelineByPlayer: defaultTimeline,
    removalTimelinesByExcludeId,
    resolvedVariantByCastId,
  } = input
  const resourceEventsByKey = deriveResourceEvents(
    castEvents,
    actions,
    defaultTimeline,
    resolvedVariantByCastId
  )

  function effectiveCastEvents(excludeId?: string): CastEvent[] {
    return excludeId ? castEvents.filter(e => e.id !== excludeId) : castEvents
  }

  // "假装该 cast 不存在"的 placement timeline 缓存。优先用 worker 路径预算好的
  // removalTimelinesByExcludeId（能还原被消费型 cast 截断的 buff 自然时长），未命中时
  // 降级为 sourceCastEventId 过滤（仅适合"该 cast 只 attach、不消费 / 不打断"的场景）。
  // engine 每帧重建，缓存生命周期 = engine 生命周期。
  const removalTimelineCache = new Map<string, StatusTimelineByPlayer>()
  function timelineExcluding(excludeId: string): StatusTimelineByPlayer {
    const cached = removalTimelineCache.get(excludeId)
    if (cached) return cached
    let result: StatusTimelineByPlayer
    const prebuilt = removalTimelinesByExcludeId?.get(excludeId)
    if (prebuilt) {
      result = prebuilt
    } else {
      // 降级：按 sourceCastEventId 过滤主路径 timeline。消费型 cast 的截断效果不可还原；
      // 适合自动重分类等不需要拖拽预览精确语义的场景。
      result = new Map()
      for (const [pid, byStatus] of defaultTimeline) {
        const newByStatus = new Map<number, StatusInterval[]>()
        for (const [sid, intervals] of byStatus) {
          const filtered = intervals.filter(i => i.sourceCastEventId !== excludeId)
          if (filtered.length > 0) newByStatus.set(sid, filtered)
        }
        if (newByStatus.size > 0) result.set(pid, newByStatus)
      }
    }
    removalTimelineCache.set(excludeId, result)
    return result
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
      statusTimelineByPlayer: excludeId ? timelineExcluding(excludeId) : defaultTimeline,
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
          actions,
          timelineExcluding(excludeId),
          resolvedVariantByCastId
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
    // CD 条按解析后的具体变体算：「收回」型变体（cd0）不画父技能的 CD 条。
    const action = actions.get(resolvedVariantByCastId?.get(ce.id) ?? ce.actionId)
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

  function getResourceUnmetMessageAt(
    action: MitigationAction,
    playerId: number,
    t: number,
    excludeId?: string
  ): string | null {
    return probeResourceUnmetMessage(
      action,
      playerId,
      t,
      effectiveCastEvents(excludeId),
      actions,
      RESOURCE_REGISTRY,
      excludeId ? timelineExcluding(excludeId) : defaultTimeline
    )
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

  function findInvalidCastEvents(removeCastEventId?: string): InvalidCastEvent[] {
    const effectiveEvents = effectiveCastEvents(removeCastEventId)

    // 显式"模拟删除某 cast"语义：placement 必须用预算好的 timeline，让依赖被删 cast
    // buff 的其他 cast 在预览中真实失效。常规调用（无 removeCastEventId）共享 default。
    // 未预算时降级（通过 timelineExcluding 走 sourceCastEventId 过滤）。
    const placementTimeline = removeCastEventId
      ? timelineExcluding(removeCastEventId)
      : defaultTimeline

    // 1. placement 层失效
    //    cast 只存 trackGroup 父 id；变体在运行时按 buff 状态派生（resolveVariant）。
    //    因此合法性按「组内任一变体在 t 合法」判定（与 computeTrackShadow /
    //    computePlacementShadow 的成员并集一致），组内全员非法才算 placement_lost。
    //    否则会把「父 id 自身在 buff 期内非法、但存在合法变体（如炽天附体期内的降临之章
    //    37016）」误判成红框，且与该轨道空 shadow 自相矛盾。
    const placementLost = new Map<string, boolean>()
    for (const castEvent of effectiveEvents) {
      const action = actions.get(castEvent.actionId)
      if (!action) continue
      const t = castEvent.timestamp
      const members = trackGroupMembers.get(effectiveTrackGroup(action)) ?? [action]
      // ctx.action 不被 placement combinator 读取（读的是 statusTimelineByPlayer /
      // castEvents / playerId），故一份 ctx 可供全组成员复用。
      const ctx: PlacementContext = {
        action,
        playerId: castEvent.playerId,
        castEvent,
        castEvents: effectiveEvents,
        actions,
        statusTimelineByPlayer: placementTimeline,
      }
      const ok = members.some(
        m =>
          !m.placement ||
          m.placement.validIntervals(ctx).some(i => i.from - TIME_EPS <= t && t <= i.to + TIME_EPS)
      )
      if (!ok) placementLost.set(castEvent.id, true)
    }

    // 2. resource 层失效（复用上面的 placementTimeline 做 suppressedByStatus 条件消耗判定）
    const resourceExhausted = findResourceExhaustedCasts(
      castEvents,
      actions,
      RESOURCE_REGISTRY,
      removeCastEventId,
      placementTimeline,
      resolvedVariantByCastId
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
    getResourceUnmetMessageAt,
  }
}
