/**
 * 绿条末端（castEffectiveEnd）的分类与聚合纯函数。
 *
 * 一个 cast 可附着多个 status；绿条末端优先采用「主减伤」层（percentage / shield）的
 * 实际收束时刻，仅当 cast 完全不产生主减伤 status 时回退到「全部 instance 取 max」。
 * 详见 design/superpowers/specs/2026-06-05-green-bar-category-priority-design.md
 */

import type { MitigationStatus, MitigationStatusMetadata } from '@/types/status'

/** status 在绿条聚合中的层级：primary = percentage/shield，other = 其余 */
export type StatusTier = 'primary' | 'other'

/**
 * 判定一个 status instance 归入主减伤层还是其它层。
 *
 * category 为主：`meta.category` 含 'percentage' 或 'shield' → primary，否则 other。
 * category 缺省（undefined 或空数组）时兜底：`type === 'multiplier'`（百分比）或实例带
 * barrier（盾）→ primary。category 非空标注即视为权威，不再叠加 type/barrier 兜底。
 */
export function statusTier(
  meta: MitigationStatusMetadata | undefined,
  status: MitigationStatus
): StatusTier {
  const category = meta?.category
  if (category && category.length > 0) {
    return category.includes('percentage') || category.includes('shield') ? 'primary' : 'other'
  }
  const isPercentage = meta?.type === 'multiplier'
  const isShield = status.remainingBarrier !== undefined || status.initialBarrier !== undefined
  return isPercentage || isShield ? 'primary' : 'other'
}

/** 一条绿条区间收束记录（按 cast 聚合的输入单元） */
export interface CastEndEntry {
  castId: string
  /** 该区间实际收束时刻 */
  to: number
  tier: StatusTier
}

/**
 * 按 cast 聚合绿条末端：
 *   - 该 cast 有 primary 条目 → 取 primary 条目的 max
 *   - 否则 → 取全部条目的 max
 */
export function reduceCastEffectiveEnds(entries: CastEndEntry[]): Map<string, number> {
  const primary = new Map<string, number>()
  const all = new Map<string, number>()
  for (const e of entries) {
    all.set(e.castId, Math.max(all.get(e.castId) ?? -Infinity, e.to))
    if (e.tier === 'primary') {
      primary.set(e.castId, Math.max(primary.get(e.castId) ?? -Infinity, e.to))
    }
  }
  const result = new Map<string, number>()
  for (const castId of all.keys()) {
    result.set(castId, primary.get(castId) ?? all.get(castId)!)
  }
  return result
}
