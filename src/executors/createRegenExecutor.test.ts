import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRegenExecutor } from './createRegenExecutor'
import { regenStatusExecutor } from './regenStatusExecutor'
import type { ActionExecutionContext } from '@/types/mitigation'
import type { PartyState, HpPool } from '@/types/partyState'
import type { MitigationStatus, StatusTickContext } from '@/types/status'
import type { HealSnapshot } from '@/types/healSnapshot'
import { getStatusById } from '@/utils/statusRegistry'

vi.mock('@/utils/statusRegistry', () => ({ getStatusById: vi.fn() }))

const mkHp = (overrides: Partial<HpPool> = {}): HpPool => ({
  current: 100000,
  max: 100000,
  base: 100000,
  ...overrides,
})

const mkCtx = (overrides: Partial<ActionExecutionContext> = {}): ActionExecutionContext => ({
  actionId: 100,
  useTime: 0,
  sourcePlayerId: 7,
  partyState: { statuses: [], timestamp: 0, hp: mkHp() } as PartyState,
  ...overrides,
})

describe('createRegenExecutor (cast 时挂状态)', () => {
  beforeEach(() => vi.mocked(getStatusById).mockReset())

  it('挂状态：startTime / endTime / sourceActionId / sourcePlayerId 正确', () => {
    const exec = createRegenExecutor(500, 30, { tickAmount: 1000 })
    const ctx = mkCtx({ useTime: 5, actionId: 100, sourcePlayerId: 7 })
    const next = exec(ctx)
    expect(next.statuses).toHaveLength(1)
    expect(next.statuses[0]).toMatchObject({
      statusId: 500,
      startTime: 5,
      endTime: 35,
      sourceActionId: 100,
      sourcePlayerId: 7,
    })
  })

  it('snapshot tickAmount 写进 status.data', () => {
    const exec = createRegenExecutor(500, 30, { tickAmount: 1000 })
    const ctx = mkCtx({ castEventId: 'cast-x' })
    const next = exec(ctx)
    expect(next.statuses[0].data).toEqual({
      tickAmount: 1000,
      castEventId: 'cast-x',
    })
  })

  it('snapshot 在 cast 时锁定 heal buff（之后挂的 buff 不影响 tickAmount）', () => {
    vi.mocked(getStatusById).mockReturnValue({
      id: 999,
      name: 'X',
      isTankOnly: false,
      performance: { physics: 1, magic: 1, darkness: 1, heal: 1.2 },
    } as never)

    // cast 时已存在一个 heal=1.2 buff
    const partyState: PartyState = {
      statuses: [
        {
          instanceId: 'b1',
          statusId: 999,
          startTime: 0,
          endTime: 60,
          sourcePlayerId: 7,
        },
      ],
      timestamp: 0,
      hp: mkHp(),
    }
    const exec = createRegenExecutor(500, 30, { tickAmount: 1000 })
    const next = exec(mkCtx({ partyState, useTime: 5 }))
    expect(next.statuses.find(s => s.statusId === 500)!.data!.tickAmount).toBeCloseTo(1200, 5)
  })

  it('同一玩家的同名 HoT 替换：旧实例被移除，只保留新实例', () => {
    const partyState: PartyState = {
      statuses: [
        { instanceId: 'old', statusId: 500, startTime: 0, endTime: 30, sourcePlayerId: 7 },
      ],
      timestamp: 0,
      hp: mkHp(),
    }
    const exec = createRegenExecutor(500, 30, { tickAmount: 1000 })
    const next = exec(mkCtx({ partyState, useTime: 10, sourcePlayerId: 7 }))
    expect(next.statuses).toHaveLength(1)
    expect(next.statuses[0].instanceId).not.toBe('old')
  })

  it('不同玩家的同名 HoT 共存', () => {
    const partyState: PartyState = {
      statuses: [
        { instanceId: 'other', statusId: 500, startTime: 0, endTime: 30, sourcePlayerId: 9 },
      ],
      timestamp: 0,
      hp: mkHp(),
    }
    const exec = createRegenExecutor(500, 30, { tickAmount: 1000 })
    const next = exec(mkCtx({ partyState, useTime: 10, sourcePlayerId: 7 }))
    expect(next.statuses).toHaveLength(2)
    expect(next.statuses.map(s => s.instanceId)).toContain('other')
  })

  it('未指定 tickAmount 时按 healByAbility[1e6 + statusId] 取每 tick 量', () => {
    const exec = createRegenExecutor(500, 30)
    const ctx = mkCtx({
      statistics: {
        shieldByAbility: {},
        critShieldByAbility: {},
        healByAbility: { [1e6 + 500]: 5000 },
        critHealByAbility: {},
      },
    })
    const next = exec(ctx)
    expect(next.statuses[0].data!.tickAmount).toBeCloseTo(5000, 5)
  })
})

describe('regenStatusExecutor.onTick', () => {
  const mkTickCtx = (overrides: Partial<StatusTickContext> = {}): StatusTickContext => ({
    status: {
      instanceId: 'inst-1',
      statusId: 500,
      startTime: 0,
      endTime: 30,
      sourceActionId: 100,
      sourcePlayerId: 7,
      data: { tickAmount: 5000, castEventId: 'cast-x' },
    } as MitigationStatus,
    tickTime: 3,
    partyState: { statuses: [], timestamp: 3, hp: mkHp({ current: 80000 }) } as PartyState,
    ...overrides,
  })

  it('每 tick +tickAmount 到 hp.current', () => {
    const ctx = mkTickCtx()
    const next = regenStatusExecutor.onTick!(ctx)!
    expect((next as PartyState).hp!.current).toBe(85000)
  })

  it('hp 满血时 applied=0、overheal=tickAmount，仍记录 snapshot', () => {
    const snaps: HealSnapshot[] = []
    const ctx = mkTickCtx({
      partyState: { statuses: [], timestamp: 3, hp: mkHp({ current: 100000 }) } as PartyState,
      recordHeal: s => snaps.push(s),
    })
    regenStatusExecutor.onTick!(ctx)
    expect(snaps).toHaveLength(1)
    expect(snaps[0]).toMatchObject({
      isHotTick: true,
      applied: 0,
      overheal: 5000,
      finalHeal: 5000,
      castEventId: 'cast-x',
    })
  })

  it('hp 未初始化时不动', () => {
    const ctx = mkTickCtx({
      partyState: { statuses: [], timestamp: 3 } as PartyState,
    })
    expect(regenStatusExecutor.onTick!(ctx)).toBeUndefined()
  })

  it('tickAmount 缺失时不动', () => {
    const ctx = mkTickCtx({
      status: {
        instanceId: 'inst-1',
        statusId: 500,
        startTime: 0,
        endTime: 30,
        data: {},
      } as MitigationStatus,
    })
    expect(regenStatusExecutor.onTick!(ctx)).toBeUndefined()
  })
})
