import type { DamageEvent } from '@/types/timeline'

const AOE_TYPES = new Set<DamageEvent['type']>(['aoe', 'partial_aoe', 'partial_final_aoe'])

/**
 * in-scope：受自动放置优化的伤害事件（非坦 AOE、原始伤害 <100 万）。
 *
 * 注意：**不**因 `targetMitigationDisabled` 排除事件。该开关只表示"目标减（boss debuff，
 * 如雪仇/牵制）对本事件无效"，而队友百分比减伤/盾（非 boss）仍正常生效——这类事件同样需要
 * 被减伤保命。目标减技能对它们的无效由 calculator（targetMitigationDisabled 时跳过 boss 状态）
 * 天然处理：probe 出零增益，优化器自然不会为它们放目标减技能，无需在此特判。
 */
export function isInScope(e: DamageEvent): boolean {
  return AOE_TYPES.has(e.type) && e.damage < 1_000_000
}
