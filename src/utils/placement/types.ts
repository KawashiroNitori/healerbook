/**
 * Placement 架构公共类型：合法区间、放置上下文、引擎接口。
 */

import type { CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { StatusInterval } from '@/types/status'

/**
 * 半开区间 [from, to)，单位秒。按 `from` 升序、互不重叠。
 * 空数组表示永不可放。
 */
export interface Interval {
  from: number
  to: number
}

/**
 * 放置约束上下文。由 engine 在查询时构造并传给 `Placement.validIntervals`。
 */
export interface PlacementContext {
  action: MitigationAction
  playerId: number
  /** 拖拽/回溯场景提供；新建时 undefined */
  castEvent?: CastEvent
  /** 整条时间轴；若查询带 excludeId，已过滤掉该 cast */
  castEvents: CastEvent[]
  actions: Map<number, MitigationAction>
  /** playerId → statusId → StatusInterval[]（若 excludeId 已触发重放，这里是重放结果） */
  statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
}

export interface Placement {
  validIntervals: (ctx: PlacementContext) => Interval[]
}

export type InvalidReason = 'placement_lost' | 'cooldown_conflict' | 'both'

export interface InvalidCastEvent {
  castEvent: CastEvent
  reason: InvalidReason
}

export interface PlacementEngine {
  getValidIntervals(
    action: MitigationAction,
    playerId: number,
    excludeCastEventId?: string
  ): Interval[]
  computeTrackShadow(trackGroup: number, playerId: number, excludeCastEventId?: string): Interval[]
  computePlacementShadow(
    trackGroup: number,
    playerId: number,
    excludeCastEventId?: string
  ): Interval[]
  pickUniqueMember(
    trackGroup: number,
    playerId: number,
    t: number,
    excludeCastEventId?: string
  ): MitigationAction | null
  canPlaceCastEvent(
    action: MitigationAction,
    playerId: number,
    t: number,
    excludeCastEventId?: string
  ): { ok: true } | { ok: false; reason: string }
  findInvalidCastEvents(excludeCastEventId?: string): InvalidCastEvent[]
}

export type StatusTimelineByPlayer = Map<number, Map<number, StatusInterval[]>>
