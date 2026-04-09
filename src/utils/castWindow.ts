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
 * 计算每个伤害事件在其时间点上亮起的 (playerId, actionId) 组合。
 *
 * 规则：存在 castEvent 满足
 *   cast.playerId === player
 *   cast.actionId === action
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
        lit.add(cellKey(castEvent.playerId, castEvent.actionId))
      }
    }
    result.set(event.id, lit)
  }
  return result
}

/**
 * 为每个 cast 找到它之后的第一个伤害事件（即 `damageEvent.time >= cast.timestamp` 且时间最早的那个），
 * 把该 (damageEvent, playerId, actionId) 组合标记为 "cast 起点"——
 * 表格视图用这个标记在使用时刻的下一格里画上技能图标。
 *
 * @returns Map<damageEventId, Set<cellKey>>
 */
export function computeCastMarkerCells(
  damageEvents: DamageEvent[],
  castEvents: CastEvent[]
): Map<string, Set<string>> {
  const sorted = [...damageEvents].sort((a, b) => a.time - b.time)
  const result = new Map<string, Set<string>>()
  for (const castEvent of castEvents) {
    const firstAfter = sorted.find(e => e.time >= castEvent.timestamp)
    if (!firstAfter) continue
    const key = cellKey(castEvent.playerId, castEvent.actionId)
    let set = result.get(firstAfter.id)
    if (!set) {
      set = new Set()
      result.set(firstAfter.id, set)
    }
    set.add(key)
  }
  return result
}
