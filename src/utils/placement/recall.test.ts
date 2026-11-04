import { describe, it, expect } from 'vitest'
import { createPlacementEngine } from './engine'
import { computeRecallZones, findRecallZoneAt, isRecallVariant } from './recall'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { simulate } from '@/utils/mitigationCalculator'
import type { CastEvent, DamageEvent } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'

const actions = new Map(MITIGATION_DATA.actions.map(a => [a.id, a]))
const initialState: PartyState = { statuses: [], timestamp: 0 } as PartyState
const damageEvents: DamageEvent[] = [
  {
    id: 'd-end',
    name: 'd-end',
    time: 600,
    damage: 100000,
    type: 'aoe',
    damageType: 'physical',
  } as DamageEvent,
]

function setup(castEvents: CastEvent[]) {
  const full = simulate({ castEvents, damageEvents, initialState })
  const engine = createPlacementEngine({
    castEvents,
    actions,
    statusTimelineByPlayer: full.statusTimelineByPlayer,
    resolvedVariantByCastId: full.resolvedVariantByCastId,
  })
  return { engine, full }
}

const cast = (id: string, actionId: number, timestamp: number) =>
  ({ id, actionId, playerId: 1, timestamp }) as unknown as CastEvent

describe('isRecallVariant', () => {
  it('同 trackGroup 非父成员且 duration0 → 收回型；父自身与有持续时间的变体不是', () => {
    expect(isRecallVariant(actions.get(8324)!, 7439)).toBe(true)
    expect(isRecallVariant(actions.get(7439)!, 7439)).toBe(false)
    // 37016 挂在 37013 下但 duration 30，不是收回型
    expect(isRecallVariant(actions.get(37016)!, 37013)).toBe(false)
  })
})

describe('computeRecallZones', () => {
  it('地星：区间 = 变体 placement 依赖的 status（1224 / 1248）实际存在区间，与绿条无关', () => {
    const { engine, full } = setup([cast('p', 7439, 10)])
    const zones = computeRecallZones(engine, 7439, 1)

    const byStatus = full.statusTimelineByPlayer.get(1)
    const statusIntervals = [1224, 1248].flatMap(id => byStatus?.get(id) ?? [])
    const statusEnd = Math.max(...statusIntervals.map(s => s.to))

    expect(zones.length).toBeGreaterThan(0)
    expect(zones.every(z => z.variant.id === 8324)).toBe(true)
    expect(zones[0].from).toBeCloseTo(10)
    expect(zones[zones.length - 1].to).toBeCloseTo(statusEnd)

    expect(findRecallZoneAt(zones, 14)?.variant.id).toBe(8324)
    expect(findRecallZoneAt(zones, 5)).toBeNull()
    expect(findRecallZoneAt(zones, statusEnd + 1)).toBeNull()
  })

  it('已放置收回 → status 被移除，收回点之后不再有区间', () => {
    const { engine } = setup([cast('p', 7439, 10), cast('r', 7439, 14)])
    const zones = computeRecallZones(engine, 7439, 1)
    expect(findRecallZoneAt(zones, 13)?.variant.id).toBe(8324)
    expect(findRecallZoneAt(zones, 16)).toBeNull()
  })

  it('无 buff 时无区间', () => {
    const { engine } = setup([])
    expect(computeRecallZones(engine, 7439, 1)).toEqual([])
  })

  it('组内无收回型变体（炽天附体期的降临之章）→ 无区间', () => {
    const { engine } = setup([cast('s', 37014, 10)])
    expect(computeRecallZones(engine, 37013, 1)).toEqual([])
  })
})
