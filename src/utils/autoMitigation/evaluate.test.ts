import { describe, it, expect } from 'vitest'
import { createEvaluator } from './evaluate'
import type { OptimizeInput } from './types'
import type { DamageEvent } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'

const dmg = (id: string, time: number, damage: number): DamageEvent =>
  ({ id, name: id, time, damage, type: 'aoe', damageType: 'magical' }) as DamageEvent

const baseInput = (): OptimizeInput => ({
  damageEvents: [dmg('a', 10, 80000), dmg('b', 20, 120000)],
  lockedCastEvents: [],
  composition: { players: [{ id: 1, job: 'WHM' }] },
  actions: new Map(),
  initialState: { statuses: [], timestamp: 0 } as PartyState,
  baseReferenceMaxHPForAoe: 100000,
})

describe('createEvaluator', () => {
  it('无 cast 时 total = Σ 原始伤害（无减伤），并标出致死事件', () => {
    const ev = createEvaluator(baseInput())
    const r = ev([])
    expect(r.total).toBe(200000) // 80000 + 120000
    // 参考血 100000：b(120000) 致死，a(80000) 不致死
    expect(r.lethal.has('b')).toBe(true)
    expect(r.lethal.has('a')).toBe(false)
    expect(r.perEvent.get('a')?.inScope).toBe(true)
  })
  it('out-of-scope 事件不计入 total / lethal', () => {
    const input = baseInput()
    input.baseReferenceMaxHPForTank = 500000
    input.damageEvents.push({ ...dmg('t', 30, 500000), type: 'tankbuster' } as DamageEvent)
    const r = createEvaluator(input)([])
    expect(r.perEvent.has('t')).toBe(true) // 仍出现在 perEvent，仅不计 total/lethal
    expect(r.perEvent.get('t')?.inScope).toBe(false)
    expect(r.lethal.has('t')).toBe(false)
    expect(r.total).toBe(200000) // 不含 t
  })
})
