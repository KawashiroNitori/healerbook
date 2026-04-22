import { describe, it, expect } from 'vitest'
import { validateActions } from './validate'
import type { MitigationAction } from '@/types/mitigation'

function a(p: Partial<MitigationAction> & { id: number }): MitigationAction {
  return {
    name: 'x',
    icon: '',
    jobs: [] as unknown as MitigationAction['jobs'],
    category: ['partywide'],
    duration: 1,
    cooldown: 1,
    ...p,
  } as MitigationAction
}

describe('validateActions', () => {
  it('trackGroup 指向不存在的 id → error', () => {
    const issues = validateActions([a({ id: 1, trackGroup: 999 })])
    expect(issues.some(i => i.level === 'error' && i.rule === 'trackgroup-missing')).toBe(true)
  })

  it('trackGroup 链式（指向的 action 自己也有 trackGroup）→ error', () => {
    const issues = validateActions([
      a({ id: 1, trackGroup: 2 }),
      a({ id: 2, trackGroup: 3 }),
      a({ id: 3 }),
    ])
    expect(issues.some(i => i.rule === 'trackgroup-chain')).toBe(true)
  })

  it('同轨组成员必须都有 placement → error', () => {
    const issues = validateActions([
      a({ id: 1, placement: { validIntervals: () => [] } }),
      a({ id: 2, trackGroup: 1 }),
    ])
    expect(issues.some(i => i.rule === 'trackgroup-placement-missing')).toBe(true)
  })

  it('同轨组 cooldown 不一致 → warn', () => {
    const issues = validateActions([
      a({ id: 1, cooldown: 60, placement: { validIntervals: () => [] } }),
      a({ id: 2, trackGroup: 1, cooldown: 1, placement: { validIntervals: () => [] } }),
    ])
    expect(issues.some(i => i.level === 'warn' && i.rule === 'trackgroup-cooldown-mismatch')).toBe(
      true
    )
  })
})
