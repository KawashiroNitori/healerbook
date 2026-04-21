/**
 * 按坦克过滤状态：决定某个 MitigationStatus 是否对指定 tank 生效。
 *
 * 规则：
 *   1. category 含 'partywide' → 有效
 *   2. category 不含 'self' 也不含 'target' → 有效（未标注 = 默认放行）
 *   3. status.sourcePlayerId === tankId → 要求 category 含 'self'
 *   4. 否则 → 要求 category 含 'target'
 */

import type { MitigationStatus, MitigationStatusMetadata } from '@/types/status'

export function isStatusValidForTank(
  meta: MitigationStatusMetadata,
  status: MitigationStatus,
  tankId: number
): boolean {
  const cat = meta.category ?? []
  if (cat.includes('partywide')) return true
  if (!cat.includes('self') && !cat.includes('target')) return true
  return status.sourcePlayerId === tankId ? cat.includes('self') : cat.includes('target')
}
