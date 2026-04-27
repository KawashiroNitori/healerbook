import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computeFinalHeal, computeMaxHpMultiplier } from './healMath'
import type { PartyState } from '@/types/partyState'
import type { MitigationStatus, MitigationStatusMetadata } from '@/types/status'
import { getStatusById } from '@/utils/statusRegistry'

vi.mock('@/utils/statusRegistry', () => ({
  getStatusById: vi.fn(),
}))

const mkStatus = (overrides: Partial<MitigationStatus>): MitigationStatus => ({
  instanceId: 'inst-' + Math.random(),
  statusId: 1,
  startTime: 0,
  endTime: 60,
  ...overrides,
})

const mkMeta = (overrides: Partial<MitigationStatusMetadata>): MitigationStatusMetadata =>
  ({
    id: 1,
    name: 'X',
    isTankOnly: false,
    performance: { physics: 1, magic: 1, darkness: 1 },
    ...overrides,
  }) as MitigationStatusMetadata

const partyStateOf = (statuses: MitigationStatus[]): PartyState => ({
  statuses,
  timestamp: 0,
})

describe('computeFinalHeal', () => {
  beforeEach(() => vi.mocked(getStatusById).mockReset())

  it('无 buff 时返回 baseAmount', () => {
    expect(computeFinalHeal(10000, partyStateOf([]), 1, 5)).toBe(10000)
  })

  it('单个全队 heal buff 累乘', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ performance: { physics: 1, magic: 1, darkness: 1, heal: 1.2 } })
    )
    const ps = partyStateOf([mkStatus({ sourcePlayerId: 2 })])
    expect(computeFinalHeal(10000, ps, 1, 5)).toBe(12000)
  })

  it('selfHeal 仅在 sourcePlayer 匹配时生效', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ performance: { physics: 1, magic: 1, darkness: 1, selfHeal: 1.3 } })
    )
    const ps = partyStateOf([mkStatus({ sourcePlayerId: 7 })])

    // 持有者 cast：×1.3
    expect(computeFinalHeal(10000, ps, 7, 5)).toBe(13000)
    // 非持有者 cast：×1
    expect(computeFinalHeal(10000, ps, 8, 5)).toBe(10000)
  })

  it('heal + selfHeal 同时（持有者 cast）累乘两者', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ performance: { physics: 1, magic: 1, darkness: 1, heal: 1.2, selfHeal: 1.3 } })
    )
    const ps = partyStateOf([mkStatus({ sourcePlayerId: 7 })])
    expect(computeFinalHeal(10000, ps, 7, 5)).toBeCloseTo(15600, 5)
  })

  it('heal + selfHeal 同时（非持有者 cast）只累乘 heal', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ performance: { physics: 1, magic: 1, darkness: 1, heal: 1.2, selfHeal: 1.3 } })
    )
    const ps = partyStateOf([mkStatus({ sourcePlayerId: 7 })])
    expect(computeFinalHeal(10000, ps, 8, 5)).toBe(12000)
  })

  it('isTankOnly buff 永远不参与累乘', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({
        isTankOnly: true,
        performance: { physics: 1, magic: 1, darkness: 1, heal: 1.5, selfHeal: 1.5 },
      })
    )
    const ps = partyStateOf([mkStatus({ sourcePlayerId: 7 })])
    expect(computeFinalHeal(10000, ps, 7, 5)).toBe(10000)
    expect(computeFinalHeal(10000, ps, 8, 5)).toBe(10000)
  })

  it('过期 / 未开始 buff 不参与', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ performance: { physics: 1, magic: 1, darkness: 1, heal: 1.2 } })
    )
    // endTime <= castTime
    const expired = partyStateOf([mkStatus({ endTime: 5 })])
    expect(computeFinalHeal(10000, expired, 1, 5)).toBe(10000)
    // startTime > castTime
    const notYet = partyStateOf([mkStatus({ startTime: 10 })])
    expect(computeFinalHeal(10000, notYet, 1, 5)).toBe(10000)
  })

  it('多个 buff 累乘', () => {
    vi.mocked(getStatusById).mockImplementation((id: number) => {
      if (id === 100)
        return mkMeta({ id: 100, performance: { physics: 1, magic: 1, darkness: 1, heal: 1.2 } })
      if (id === 200)
        return mkMeta({ id: 200, performance: { physics: 1, magic: 1, darkness: 1, heal: 1.1 } })
      return undefined
    })
    const ps = partyStateOf([
      mkStatus({ statusId: 100, sourcePlayerId: 1 }),
      mkStatus({ statusId: 200, sourcePlayerId: 2 }),
    ])
    expect(computeFinalHeal(10000, ps, 3, 5)).toBeCloseTo(13200, 5)
  })
})

describe('computeMaxHpMultiplier', () => {
  beforeEach(() => vi.mocked(getStatusById).mockReset())

  it('无 buff 返回 1', () => {
    expect(computeMaxHpMultiplier([], 5)).toBe(1)
  })

  it('单个 maxHP buff 累乘', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ performance: { physics: 1, magic: 1, darkness: 1, maxHP: 1.1 } })
    )
    expect(computeMaxHpMultiplier([mkStatus({})], 5)).toBeCloseTo(1.1, 5)
  })

  it('isTankOnly maxHP buff 永远不参与', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ isTankOnly: true, performance: { physics: 1, magic: 1, darkness: 1, maxHP: 1.1 } })
    )
    expect(computeMaxHpMultiplier([mkStatus({})], 5)).toBe(1)
  })

  it('过期 buff 不参与', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ performance: { physics: 1, magic: 1, darkness: 1, maxHP: 1.1 } })
    )
    expect(computeMaxHpMultiplier([mkStatus({ endTime: 5 })], 5)).toBe(1)
  })
})
