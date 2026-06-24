import { describe, it, expect } from 'vitest'
import { buildOptimizeWireInput } from './useAutoMitigate'
import type { Timeline } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'

const timeline = {
  damageEvents: [
    { id: 'd1', name: 'x', time: 30, damage: 90000, type: 'aoe', damageType: 'magical' },
  ],
  castEvents: [{ id: 'c1', actionId: 7535, timestamp: 5, playerId: 1 }],
  composition: { players: [{ id: 1, job: 'WAR' }] },
  statData: undefined,
} as unknown as Timeline
const partyState = { statuses: [], timestamp: 0 } as PartyState

describe('buildOptimizeWireInput', () => {
  it('把 timeline/partyState/statistics 映射到 wire 输入，且不含 actions', () => {
    const wire = buildOptimizeWireInput(timeline, partyState, null)
    expect(wire.damageEvents).toBe(timeline.damageEvents)
    expect(wire.lockedCastEvents).toBe(timeline.castEvents) // 当前 casts 作 locked
    expect(wire.composition).toBe(timeline.composition)
    expect(wire.initialState).toBe(partyState)
    expect('actions' in wire).toBe(false) // actions 由 worker 补
    expect(typeof wire.baseReferenceMaxHPForAoe).toBe('number')
    expect(wire.options?.timeBudgetMs).toBe(2000)
  })
})
