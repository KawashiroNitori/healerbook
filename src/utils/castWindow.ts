/**
 * 表格视图单元格命中判定：判断某个伤害事件时刻是否处于某个 cast 窗口内
 */

import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

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
