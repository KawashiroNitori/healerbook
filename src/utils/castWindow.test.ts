import { describe, it, expect } from 'vitest'
import { computeLitCellsByEvent, cellKey } from './castWindow'
import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

const damage = (id: string, time: number): DamageEvent =>
  ({
    id,
    name: `dmg-${id}`,
    time,
    damage: 100000,
    type: 'aoe',
    damageType: 'magical',
  }) as DamageEvent

const cast = (id: string, playerId: number, actionId: number, timestamp: number): CastEvent =>
  ({
    id,
    actionId,
    timestamp,
    playerId,
    job: 'WHM',
  }) as CastEvent

const action = (id: number, duration: number): MitigationAction =>
  ({
    id,
    name: `a-${id}`,
    icon: '',
    jobs: [],
    duration,
    cooldown: 60,
    executor: () => ({ players: [], statuses: [], timestamp: 0 }),
  }) as unknown as MitigationAction

describe('computeLitCellsByEvent', () => {
  it('castTime <= damageTime < castTime + duration 时亮起', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const events = [damage('d1', 5)]
    const casts = [cast('c1', 1, 100, 0)] // 窗口 [0, 10)
    const result = computeLitCellsByEvent(events, casts, actionsById)
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
  })

  it('castTime === damageTime 时亮起（左闭）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const result = computeLitCellsByEvent([damage('d1', 0)], [cast('c1', 1, 100, 0)], actionsById)
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
  })

  it('damageTime === castTime + duration 时不亮起（右开）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const result = computeLitCellsByEvent([damage('d1', 10)], [cast('c1', 1, 100, 0)], actionsById)
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false)
  })

  it('damageTime 在 cast 窗口之前不亮起', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const result = computeLitCellsByEvent([damage('d1', 0)], [cast('c1', 1, 100, 5)], actionsById)
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false)
  })

  it('一个玩家的多次 cast 只要有一个窗口命中就亮起', () => {
    const actionsById = new Map([[100, action(100, 5)]])
    const casts = [
      cast('c1', 1, 100, 0), // 窗口 [0, 5)
      cast('c2', 1, 100, 20), // 窗口 [20, 25)
    ]
    const result = computeLitCellsByEvent(
      [damage('d1', 2), damage('d2', 10), damage('d3', 22)],
      casts,
      actionsById
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
    expect(result.get('d2')?.has(cellKey(1, 100))).toBe(false)
    expect(result.get('d3')?.has(cellKey(1, 100))).toBe(true)
  })

  it('不同 playerId / actionId 的 cast 独立计算', () => {
    const actionsById = new Map([
      [100, action(100, 10)],
      [200, action(200, 10)],
    ])
    const casts = [cast('c1', 1, 100, 0), cast('c2', 2, 200, 0)]
    const result = computeLitCellsByEvent([damage('d1', 5)], casts, actionsById)
    const lit = result.get('d1')!
    expect(lit.has(cellKey(1, 100))).toBe(true)
    expect(lit.has(cellKey(2, 200))).toBe(true)
    expect(lit.has(cellKey(1, 200))).toBe(false)
    expect(lit.has(cellKey(2, 100))).toBe(false)
  })

  it('actionsById 中不存在的 actionId 被跳过', () => {
    const actionsById = new Map<number, MitigationAction>()
    const result = computeLitCellsByEvent([damage('d1', 5)], [cast('c1', 1, 999, 0)], actionsById)
    expect(result.get('d1')?.size).toBe(0)
  })

  it('每个伤害事件都有一个 Set（可能为空）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const result = computeLitCellsByEvent([damage('d1', 100), damage('d2', 200)], [], actionsById)
    expect(result.get('d1')).toEqual(new Set())
    expect(result.get('d2')).toEqual(new Set())
  })
})

describe('cellKey', () => {
  it('格式为 playerId:actionId', () => {
    expect(cellKey(1, 100)).toBe('1:100')
  })
})
