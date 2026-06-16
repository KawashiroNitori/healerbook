/**
 * 按坦克过滤状态：决定某个 MitigationStatus 是否对指定 tank 生效。
 *
 * 有效 category 取 `actionCategory ?? meta.category`——产出该 status 的 action 的
 * category（按 sourceActionId 解析）优先于 statusExtras 按 statusId 的默认值。这让
 * 共享同一 statusId 的技能（如战士"原初的勇猛"给目标 / "原初的血气"给自己产出的
 * 血潮 2679、血烟 2680）能各自跟随产出它的 action 的 self/target 作用域。无 action
 * 归属（敌方 debuff、派生/导入状态）时回落 meta.category。
 *
 * 规则（作用于有效 category）：
 *   1. 含 'partywide' → 有效
 *   2. 不含 'self' 也不含 'target' → 有效（未标注 = 默认放行）
 *   3. status.sourcePlayerId === tankId → 要求含 'self'
 *   4. 否则 → 要求含 'target'
 */

import type { MitigationCategory } from '@/types/mitigation'
import type { MitigationStatus, MitigationStatusMetadata } from '@/types/status'

export function isStatusValidForTank(
  meta: MitigationStatusMetadata,
  status: MitigationStatus,
  tankId: number,
  actionCategory?: MitigationCategory[]
): boolean {
  const cat = actionCategory ?? meta.category ?? []
  if (cat.includes('partywide')) return true
  if (!cat.includes('self') && !cat.includes('target')) return true
  return status.sourcePlayerId === tankId ? cat.includes('self') : cat.includes('target')
}
