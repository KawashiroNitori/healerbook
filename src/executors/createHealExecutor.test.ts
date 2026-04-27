import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHealExecutor } from './createHealExecutor'
import type { ActionExecutionContext } from '@/types/mitigation'
import type { PartyState, HpPool } from '@/types/partyState'
import type { HealSnapshot } from '@/types/healSnapshot'
import { getStatusById } from '@/utils/statusRegistry'

vi.mock('@/utils/statusRegistry', () => ({ getStatusById: vi.fn() }))

const mkHp = (overrides: Partial<HpPool> = {}): HpPool => ({
  current: 100000,
  max: 100000,
  base: 100000,
  segMax: 0,
  inSegment: false,
  ...overrides,
})

const mkCtx = (overrides: Partial<ActionExecutionContext> = {}): ActionExecutionContext => ({
  actionId: 1,
  useTime: 5,
  sourcePlayerId: 7,
  partyState: { statuses: [], timestamp: 0, hp: mkHp() } as PartyState,
  ...overrides,
})

describe('createHealExecutor', () => {
  beforeEach(() => vi.mocked(getStatusById).mockReset())

  it('hp 未初始化时直接返回原 state', () => {
    const exec = createHealExecutor({ fixedAmount: 5000 })
    const ctx = mkCtx({ partyState: { statuses: [], timestamp: 0 } })
    const next = exec(ctx)
    expect(next).toBe(ctx.partyState)
  })

  it('一次性治疗 +amount 到 hp.current', () => {
    const exec = createHealExecutor({ fixedAmount: 15000 })
    const ctx = mkCtx({ partyState: { statuses: [], timestamp: 0, hp: mkHp({ current: 50000 }) } })
    const next = exec(ctx)
    expect(next.hp!.current).toBe(65000)
  })

  it('治疗 clamp 到 hp.max（满血时 applied=0、overheal=finalHeal）', () => {
    const snaps: HealSnapshot[] = []
    const exec = createHealExecutor({ fixedAmount: 20000 })
    const ctx = mkCtx({
      partyState: { statuses: [], timestamp: 0, hp: mkHp({ current: 90000 }) },
      recordHeal: snap => snaps.push(snap),
      castEventId: 'cast-1',
    })
    const next = exec(ctx)
    expect(next.hp!.current).toBe(100000)
    expect(snaps).toHaveLength(1)
    expect(snaps[0]).toMatchObject({
      castEventId: 'cast-1',
      baseAmount: 20000,
      finalHeal: 20000,
      applied: 10000,
      overheal: 10000,
      isHotTick: false,
    })
  })

  it('hp=0 时 cast 治疗仍能加血（"复活"语义）', () => {
    const exec = createHealExecutor({ fixedAmount: 30000 })
    const ctx = mkCtx({ partyState: { statuses: [], timestamp: 0, hp: mkHp({ current: 0 }) } })
    const next = exec(ctx)
    expect(next.hp!.current).toBe(30000)
  })

  it('baseAmount=0 时跳过（无 statistics 且无 fixedAmount）', () => {
    const exec = createHealExecutor()
    const ctx = mkCtx()
    const next = exec(ctx)
    expect(next.hp!.current).toBe(100000) // 不变
  })

  it('amountSourceId 覆盖 ctx.actionId 取 statistics 值', () => {
    const exec = createHealExecutor({ amountSourceId: 999 })
    const ctx = mkCtx({
      actionId: 1,
      partyState: { statuses: [], timestamp: 0, hp: mkHp({ current: 50000 }) },
      statistics: {
        shieldByAbility: {},
        critShieldByAbility: {},
        healByAbility: { 1: 5000, 999: 12000 },
        critHealByAbility: {},
      },
    })
    const next = exec(ctx)
    expect(next.hp!.current).toBe(62000) // 50k + 12k（取 999 不取 1）
  })
})
