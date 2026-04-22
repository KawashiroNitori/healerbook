import { describe, it, expect } from 'vitest'
import { createPlacementEngine } from './engine'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { createMitigationCalculator } from '@/utils/mitigationCalculator'
import type { CastEvent, DamageEvent } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'

const actions = new Map(MITIGATION_DATA.actions.map(a => [a.id, a]))
const initialState: PartyState = { statuses: [], timestamp: 0 } as PartyState

function makeEngine(castEvents: CastEvent[]) {
  const calc = createMitigationCalculator()
  return createPlacementEngine({
    castEvents,
    actions,
    simulate: evs =>
      calc.simulate({
        castEvents: evs,
        damageEvents: [
          {
            id: 'd-end',
            name: 'd-end',
            time: 600,
            damage: 100000,
            type: 'aoe',
            damageType: 'physical',
          } as DamageEvent,
        ],
        initialState,
      }),
  })
}

describe('placement 集成', () => {
  it('炽天附体期间双击产出 37016，非 buff 期产出 37013', () => {
    const SERAPHISM_CAST = {
      id: 's',
      actionId: 37014,
      playerId: 1,
      timestamp: 10,
    } as unknown as CastEvent
    const engine = makeEngine([SERAPHISM_CAST])

    expect(engine.pickUniqueMember(37013, 1, 20)?.id).toBe(37016)
    expect(engine.pickUniqueMember(37013, 1, 45)?.id).toBe(37013) // buff 10+30=40 后失效
  })

  it('炽天附体期间把 37013 cast 在 buff 窗口内 → findInvalidCastEvents 标记 placement_lost', () => {
    const SERAPHISM_CAST = {
      id: 's',
      actionId: 37014,
      playerId: 1,
      timestamp: 10,
    } as unknown as CastEvent
    const BAD_INTUITION = {
      id: 'bad',
      actionId: 37013,
      playerId: 1,
      timestamp: 20,
    } as unknown as CastEvent
    const engine = makeEngine([SERAPHISM_CAST, BAD_INTUITION])

    const invalid = engine.findInvalidCastEvents()
    expect(invalid.some(r => r.castEvent.id === 'bad' && r.reason === 'placement_lost')).toBe(true)
  })

  it('拖拽 37014 到新位置预览：把 37016 cast 带出 buff 窗口外时应红边框', () => {
    const SERAPHISM_CAST = {
      id: 's',
      actionId: 37014,
      playerId: 1,
      timestamp: 10,
    } as unknown as CastEvent
    const ACCESSION_CAST = {
      id: 'a',
      actionId: 37016,
      playerId: 1,
      timestamp: 20,
    } as unknown as CastEvent
    const engine = makeEngine([SERAPHISM_CAST, ACCESSION_CAST])

    // 默认（不拖拽）：37016 在 buff 内 → 合法
    expect(engine.findInvalidCastEvents().some(r => r.castEvent.id === 'a')).toBe(false)
    // 预览"删除 37014"：37016 失去 buff 触发 → placement_lost
    expect(
      engine
        .findInvalidCastEvents('s')
        .some(r => r.castEvent.id === 'a' && r.reason === 'placement_lost')
    ).toBe(true)
  })
})
