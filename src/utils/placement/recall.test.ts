import { describe, it, expect } from 'vitest'
import { createPlacementEngine } from './engine'
import { getInvalidCastEventMap, planCastPlacement } from './castPlacement'
import {
  computeRecallZones,
  findClosingRecallCast,
  findRecallZoneAt,
  isRecallVariant,
} from './recall'
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

  it('findClosingRecallCast：区间被后面的收回截断 → 返回该收回；自然到期 → null', () => {
    const casts = [cast('p', 7439, 0), cast('r', 7439, 9)]
    const { engine, full } = setup(casts)
    const resolve = (c: CastEvent) =>
      actions.get(full.resolvedVariantByCastId.get(c.id) ?? c.actionId)
    expect(findRecallZoneAt(computeRecallZones(engine, 7439, 1), 5)).not.toBeNull()
    expect(findClosingRecallCast(5, casts, resolve, 7439)?.id).toBe('r')

    // 只放地星、不收回：区间自然到期结束，没有可前移的收回
    const only = [cast('p', 7439, 0)]
    const s2 = setup(only)
    const resolve2 = (c: CastEvent) =>
      actions.get(s2.full.resolvedVariantByCastId.get(c.id) ?? c.actionId)
    expect(findClosingRecallCast(5, only, resolve2, 7439)).toBeNull()
  })

  it('findClosingRecallCast：收回变体自带 CD（天宫图 + 阳星合相升级，20s 收回）→ 仍找到 20s 收回', () => {
    // 收回天宫图 16558 cd1：资源模型把 [19, 20) 扣出合法区间，收回区间末端落在 19 而非 20
    const casts = [cast('h', 16557, 0), cast('a', 37030, 2), cast('r', 16557, 20)]
    const { engine, full } = setup(casts)
    const resolve = (c: CastEvent) =>
      actions.get(full.resolvedVariantByCastId.get(c.id) ?? c.actionId)
    const zone = findRecallZoneAt(computeRecallZones(engine, 16557, 1), 10)
    expect(zone?.variant.id).toBe(16558)
    expect(zone!.to).toBeLessThan(19.5)
    expect(findClosingRecallCast(10, casts, resolve, 16557)?.id).toBe('r')
    // 前移后：收回在 10s，时间轴无红框
    const moved = setup([cast('h', 16557, 0), cast('a', 37030, 2), cast('r', 16557, 10)])
    expect(moved.engine.findInvalidCastEvents()).toEqual([])
  })

  it('findClosingRecallCast：下一个 cast 是父技能（buff 自然到期后重放）→ null', () => {
    const casts = [cast('p1', 7439, 0), cast('p2', 7439, 70), cast('r', 7439, 75)]
    const { full } = setup(casts)
    const resolve = (c: CastEvent) =>
      actions.get(full.resolvedVariantByCastId.get(c.id) ?? c.actionId)
    expect(findClosingRecallCast(5, casts, resolve, 7439)).toBeNull()
  })

  it('前移后的时间轴：收回移到 5s，原 9s 不复存在，无红框', () => {
    const { engine } = setup([cast('p', 7439, 0), cast('r', 7439, 5)])
    expect(engine.findInvalidCastEvents()).toEqual([])
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

describe('shared canvas and table cast placement', () => {
  const actionId = 7439
  const choosePlacement = (casts: CastEvent[], time: number) => {
    const { engine, full } = setup(casts)
    return planCastPlacement({
      actionId,
      playerId: 1,
      time,
      castEvents: casts,
      actions,
      resolvedVariantByCastId: full.resolvedVariantByCastId,
      engine,
    })
  }

  it('moves the same player’s closing recall to the actual table cast time', () => {
    const casts = [cast('p', actionId, 0), cast('r', actionId, 9)]
    const decision = choosePlacement(casts, 5 - 0.1)
    expect(decision).toEqual({ kind: 'move', castId: 'r' })
    const moved = casts.map(c => (c.id === 'r' ? { ...c, timestamp: 5 - 0.1 } : c))
    expect(moved.map(c => [c.id, c.timestamp])).toEqual([
      ['p', 0],
      ['r', 4.9],
    ])
    expect(getInvalidCastEventMap(setup(moved).engine).size).toBe(0)
  })

  it('adds a recall when the current window ends naturally', () => {
    const casts = [cast('p', actionId, 0), cast('later-placement', actionId, 70)]
    expect(choosePlacement(casts, 5 - 0.1)).toEqual({ kind: 'add', actionId })
  })

  it('validates the earlier actual cast time when the table lead crosses a boundary', () => {
    const casts = [cast('p', actionId, 0), cast('r', actionId, 9)]
    expect(choosePlacement(casts, 9.05).kind).toBe('reject')
    expect(choosePlacement(casts, 9.05 - 0.1)).toEqual({ kind: 'move', castId: 'r' })
  })

  it('keys the pre-existing conflict to the original late cast, with replay suppression', () => {
    const casts = [cast('p', actionId, 0), cast('early', actionId, 4.9), cast('late', actionId, 9)]
    const { engine } = setup(casts)
    const invalid = getInvalidCastEventMap(engine)
    expect([...invalid.keys()]).toEqual(['late'])
    expect(invalid.get('late')?.reason).toBe('resource_exhausted')
    expect(getInvalidCastEventMap(engine, true).size).toBe(0)
  })
})
