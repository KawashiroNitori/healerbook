/**
 * 「收回」型变体的生效区间（悬浮虚影 / 单击放置用）。
 *
 * 收回型变体：同 trackGroup 的非父成员，且 duration === 0（再次使用父技能时立即结算、
 * 只移除父技能挂的 status，不附着新状态）。其可用窗口由数据里父 / 变体互斥的 placement
 * 决定（父 `not(whileStatus(X))`、变体 `whileStatus(X)`），即 status X 的实际存在区间，
 * 不等价于绿条（绿条按主减伤层 status 聚合，可能更长或更短）。
 */

import type { MitigationAction } from '@/types/mitigation'
import type { Interval, PlacementEngine } from '@/types/placement'

export interface RecallZone extends Interval {
  /** 该区间内 pickUniqueMember 唯一选出的收回型变体 */
  variant: MitigationAction
}

export function isRecallVariant(action: MitigationAction, groupId: number): boolean {
  return action.id !== groupId && action.trackGroup === groupId && action.duration === 0
}

/**
 * (groupId, playerId) 轨道上「此刻放置会唯一解析为收回型变体」的区间，按 from 升序。
 * 直接取 engine.uniqueMemberIntervals 中收回型成员的部分，与双击放置的判定同源。
 */
export function computeRecallZones(
  engine: PlacementEngine,
  groupId: number,
  playerId: number
): RecallZone[] {
  return engine
    .uniqueMemberIntervals(groupId, playerId)
    .filter(m => isRecallVariant(m.action, groupId))
    .flatMap(m => m.intervals.map(iv => ({ from: iv.from, to: iv.to, variant: m.action })))
    .sort((a, b) => a.from - b.from)
}

/** 在已排序的 zones 中查找包含 t 的区间（半开 [from, to)） */
export function findRecallZoneAt(zones: RecallZone[], t: number): RecallZone | null {
  for (const z of zones) {
    if (t < z.from) return null
    if (t < z.to) return z
  }
  return null
}
