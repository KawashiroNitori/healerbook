import { describe, it, expect } from 'vitest'
import { isInScope } from './scope'
import type { DamageEvent } from '@/types/timeline'

const base = (over: Partial<DamageEvent>): DamageEvent =>
  ({
    id: 'e',
    name: 'x',
    time: 10,
    damage: 50000,
    type: 'aoe',
    damageType: 'magical',
    ...over,
  }) as DamageEvent

describe('isInScope', () => {
  it('接受普通 AOE', () => {
    expect(isInScope(base({ type: 'aoe' }))).toBe(true)
    expect(isInScope(base({ type: 'partial_aoe' }))).toBe(true)
    expect(isInScope(base({ type: 'partial_final_aoe' }))).toBe(true)
  })
  it('排除坦专', () => {
    expect(isInScope(base({ type: 'tankbuster' }))).toBe(false)
    expect(isInScope(base({ type: 'auto' }))).toBe(false)
  })
  it('排除 ≥100 万伤害的超大机制', () => {
    expect(isInScope(base({ damage: 1_000_000 }))).toBe(false)
    expect(isInScope(base({ damage: 1_500_000 }))).toBe(false)
  })
  it('targetMitigationDisabled 事件仍 in-scope（目标减无效≠队友减伤无效，需被保命）', () => {
    expect(isInScope(base({ targetMitigationDisabled: true }))).toBe(true)
  })
})
