/**
 * 表格视图单元格命中判定：判断某个伤害事件时刻是否处于某个 cast 窗口内
 */

import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { Interval } from '@/utils/placement/types'
import type { SkillTrack } from '@/utils/skillTracks'

/**
 * 生成单元格 key，用于 `Set<string>` 存储
 */
export function cellKey(playerId: number, actionId: number): string {
  return `${playerId}:${actionId}`
}

/**
 * 把 castEvent 映射到其"渲染所在列"的 cellKey——trackGroup 变体（如 37016）挂在
 * parent（37013）轨道上，因此 cell 按 effectiveTrackGroup 归类。
 */
function castCellKey(castEvent: CastEvent, actionsById: Map<number, MitigationAction>): string {
  const a = actionsById.get(castEvent.actionId)
  const groupId = a?.trackGroup ?? castEvent.actionId
  return cellKey(castEvent.playerId, groupId)
}

/**
 * 计算每个伤害事件在其时间点上亮起的 (playerId, trackGroupId) 组合。
 *
 * 规则：存在 castEvent 满足
 *   cast.playerId === player
 *   cast 所属 trackGroup === 列对应的 track.actionId
 *   cast.timestamp ≤ damageEvent.time < cast.timestamp + action.duration
 *
 * @returns Map<damageEventId, Set<cellKey>>
 */
export function computeLitCellsByEvent(
  damageEvents: DamageEvent[],
  castEvents: CastEvent[],
  actionsById: Map<number, MitigationAction>
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  for (const event of damageEvents) {
    const lit = new Set<string>()
    for (const castEvent of castEvents) {
      const action = actionsById.get(castEvent.actionId)
      if (!action) continue
      if (castEvent.timestamp <= event.time && event.time < castEvent.timestamp + action.duration) {
        lit.add(castCellKey(castEvent, actionsById))
      }
    }
    result.set(event.id, lit)
  }
  return result
}

/**
 * 为每个 cast 找到它之后的第一个伤害事件，把该 (damageEvent, playerId, trackGroupId)
 * 组合标记为 "cast 起点"——表格视图用这个标记在使用时刻的下一格里画技能图标。
 *
 * 返回 `Map<damageEventId, Map<cellKey, actionId>>`：内层 Map 的 value 是该格实际
 * 住着的 cast 的 `actionId`（区别于 cellKey 里用的 trackGroupId）。渲染时用
 * `actionsById.get(actionId).icon` 显示正确的变体图标（如 buff 期的 37016）。
 *
 * @returns Map<damageEventId, Map<cellKey, actionId>>
 */
export function computeCastMarkerCells(
  damageEvents: DamageEvent[],
  castEvents: CastEvent[],
  actionsById: Map<number, MitigationAction>
): Map<string, Map<string, number>> {
  const sorted = [...damageEvents].sort((a, b) => a.time - b.time)
  const result = new Map<string, Map<string, number>>()
  for (const castEvent of castEvents) {
    const firstAfter = sorted.find(e => e.time >= castEvent.timestamp)
    if (!firstAfter) continue
    const key = castCellKey(castEvent, actionsById)
    let map = result.get(firstAfter.id)
    if (!map) {
      map = new Map()
      result.set(firstAfter.id, map)
    }
    map.set(key, castEvent.actionId)
  }
  return result
}

/**
 * 计算每个伤害事件落在哪些 cast 的"蓝色 CD 区间"内。
 *
 * 与时间轴蓝条同源：CD 右端来自 `cdBarEndFor(castEventId)`
 *   - null     → 此 cast 不画 CD
 *   - Infinity → CD 延伸到时间轴末尾
 *   - 数值     → CD 右端秒数
 *
 * 每个 cast 的 CD 区间 = [greenEnd, rawEnd)，greenEnd = cast.timestamp + action.duration
 * （与 computeLitCellsByEvent 的绿格同基准，保证绿/蓝衔接无缝、不重叠）。
 * 命中规则：greenEnd <= damageEvent.time < rawEnd（左闭右开；Infinity 恒真）。
 * 归列同绿格：按 castCellKey（trackGroup 变体归 parent 列）。
 *
 * @returns Map<damageEventId, Set<cellKey>>
 */
export function computeCdCellsByEvent(
  damageEvents: DamageEvent[],
  castEvents: CastEvent[],
  actionsById: Map<number, MitigationAction>,
  cdBarEndFor: (castEventId: string) => number | null
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  for (const event of damageEvents) result.set(event.id, new Set<string>())

  for (const castEvent of castEvents) {
    const action = actionsById.get(castEvent.actionId)
    if (!action) continue
    const rawEnd = cdBarEndFor(castEvent.id)
    if (rawEnd === null) continue
    const greenEnd = castEvent.timestamp + action.duration
    const key = castCellKey(castEvent, actionsById)
    for (const event of damageEvents) {
      if (greenEnd <= event.time && event.time < rawEnd) {
        result.get(event.id)!.add(key)
      }
    }
  }
  return result
}

/**
 * 计算每个伤害事件落在哪些技能列的"斜纹不可放置阴影"区间内。
 *
 * 与时间轴斜纹同源：shadow 区间逐轨（per trackGroup）由 `shadowIntervalsForTrack`
 * 回调给出（调用方封装 cd<=3 / placement 分支 + engine.computeTrackShadow /
 * computePlacementShadow，见 SkillTracksCanvas）。本函数只做区间→单元格映射。
 *
 * 命中规则：from <= damageEvent.time < to（左闭右开，与 computeCdCellsByEvent 一致）。
 * 归列：按 cellKey(track.playerId, track.actionId)（track.actionId 即 trackGroup id）。
 * 绿/蓝/斜纹优先级在 TableDataRow 渲染层处理（绿 > 蓝 > 斜纹），本函数不做区间相减。
 *
 * @returns Map<damageEventId, Set<cellKey>>
 */
export function computeShadowCellsByEvent(
  damageEvents: DamageEvent[],
  skillTracks: SkillTrack[],
  shadowIntervalsForTrack: (track: SkillTrack) => Interval[]
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  for (const event of damageEvents) result.set(event.id, new Set<string>())

  for (const track of skillTracks) {
    const intervals = shadowIntervalsForTrack(track)
    if (intervals.length === 0) continue
    const key = cellKey(track.playerId, track.actionId)
    for (const event of damageEvents) {
      if (intervals.some(iv => iv.from <= event.time && event.time < iv.to)) {
        result.get(event.id)!.add(key)
      }
    }
  }
  return result
}
