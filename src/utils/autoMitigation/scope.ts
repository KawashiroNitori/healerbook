import type { DamageEvent } from '@/types/timeline'

const AOE_TYPES = new Set<DamageEvent['type']>(['aoe', 'partial_aoe', 'partial_final_aoe'])

/** in-scope：受自动放置优化的伤害事件（非坦 AOE、原始伤害 <100 万、未禁用减伤）。 */
export function isInScope(e: DamageEvent): boolean {
  return AOE_TYPES.has(e.type) && e.damage < 1_000_000 && !e.targetMitigationDisabled
}
