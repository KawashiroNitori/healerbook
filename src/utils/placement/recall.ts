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

/**
 * 在 t（已确认处于收回生效区间内）放置收回时，找出截断当前 buff 窗口的已有收回 cast。
 * 一个 buff 窗口只能收回一次：在它之前再放收回会提前移除 buff，使它回退为父技能并因 CD 变红，
 * 故调用方应把它前移到 t 而非新增。
 *
 * 判定：同轨道 t 之后的下一个 cast 若解析为收回型变体，即为截断者。buff 存续期间父技能不可放，
 * t 与该收回之间不会夹着其他 cast；若 buff 先自然到期、再放了新的父技能，下一个 cast 是父技能
 * → 返回 null（照旧新增）。
 * 不用「收回区间末端 ≈ cast 时间戳」判定：收回变体自身带 CD 时（如 cd1），资源模型会把其前
 * cd 秒从合法区间扣掉，区间末端落在 cast 之前。
 *
 * @param trackCasts 同轨道（同 playerId + trackGroup）的 cast
 * @param resolveVariant cast → simulate 解析出的实际变体
 */
export function findClosingRecallCast<C extends { timestamp: number }>(
  t: number,
  trackCasts: C[],
  resolveVariant: (cast: C) => MitigationAction | undefined,
  groupId: number
): C | null {
  let next: C | null = null
  for (const c of trackCasts) {
    if (c.timestamp > t && (!next || c.timestamp < next.timestamp)) next = c
  }
  if (!next) return null
  const variant = resolveVariant(next)
  return variant && isRecallVariant(variant, groupId) ? next : null
}

/** 在已排序的 zones 中查找包含 t 的区间（半开 [from, to)） */
export function findRecallZoneAt(zones: RecallZone[], t: number): RecallZone | null {
  for (const z of zones) {
    if (t < z.from) return null
    if (t < z.to) return z
  }
  return null
}
