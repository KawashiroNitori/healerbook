/**
 * Placement 架构公共类型：合法区间、放置上下文、引擎接口。
 */

import type { CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { StatusInterval } from '@/types/status'

/**
 * 时间比较容差（秒）。
 * 用于所有涉及"紧贴""边界包含"的浮点比较：timestamp 由 FFLogs 导入（ms/1000）、
 * 拖拽 snap（x/zoom）、shadow 端点（ts + cd）等路径算出，会带 1~2 ULP（~1e-15）
 * 级的浮点偏差。裸 `<` / `<=` 比较在这种偏差下会把紧贴误判为重叠或反之。
 * 取 1e-6 远大于浮点误差、远小于时间轴语义粒度（0.01s）——两边都留足安全裕度。
 */
export const TIME_EPS = 1e-6

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

export type InvalidReason = 'placement_lost' | 'resource_exhausted' | 'both'

export interface InvalidCastEvent {
  castEvent: CastEvent
  reason: InvalidReason
  /**
   * reason === 'resource_exhausted' | 'both' 时填；指向第一个耗尽的资源 id。
   * UI 用它查 `RESOURCE_REGISTRY[resourceId]?.max` 决定文案（max=1 → '冷却中'；max>1 → '层数不足'）。
   */
  resourceId?: string
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
  /**
   * 返回指定 cast 的蓝色 CD 条右端（秒）。null = 不画；Infinity = 时间轴内无恢复。
   * 不接受 excludeId——永远以 engine 构造时的完整 castEvents 计算。
   */
  cdBarEndFor(castEventId: string): number | null
}

export type StatusTimelineByPlayer = Map<number, Map<number, StatusInterval[]>>
