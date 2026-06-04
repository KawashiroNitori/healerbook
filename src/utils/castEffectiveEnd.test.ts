import { describe, it, expect } from 'vitest'
import { statusTier, reduceCastEffectiveEnds } from './castEffectiveEnd'
import type { MitigationStatus, MitigationStatusMetadata } from '@/types/status'

const mkStatus = (patch: Partial<MitigationStatus> = {}): MitigationStatus =>
  ({ instanceId: 'i', statusId: 1, startTime: 0, endTime: 1, ...patch }) as MitigationStatus

const mkMeta = (patch: Partial<MitigationStatusMetadata> = {}): MitigationStatusMetadata =>
  ({ isTankOnly: false, ...patch }) as MitigationStatusMetadata

describe('statusTier', () => {
  it('category 含 percentage → primary', () => {
    expect(statusTier(mkMeta({ category: ['partywide', 'percentage'] }), mkStatus())).toBe(
      'primary'
    )
  })

  it('category 含 shield → primary', () => {
    expect(statusTier(mkMeta({ category: ['partywide', 'shield'] }), mkStatus())).toBe('primary')
  })

  it('category 为 heal → other', () => {
    expect(statusTier(mkMeta({ category: ['partywide', 'heal'] }), mkStatus())).toBe('other')
  })

  it('category 仅 scope（self）无效果类 → other', () => {
    expect(statusTier(mkMeta({ category: ['self'] }), mkStatus())).toBe('other')
  })

  it('category 为空数组（视作未标注）+ 实例带 barrier → 兜底 primary', () => {
    expect(statusTier(mkMeta({ category: [] }), mkStatus({ remainingBarrier: 100 }))).toBe(
      'primary'
    )
  })

  it('category 已标注但不含 percentage/shield 时不再叠加 type 兜底 → other', () => {
    expect(statusTier(mkMeta({ category: ['self'], type: 'multiplier' }), mkStatus())).toBe('other')
  })

  it('category 缺省 + type===multiplier → 兜底 primary', () => {
    expect(statusTier(mkMeta({ type: 'multiplier' }), mkStatus())).toBe('primary')
  })

  it('category 缺省 + 实例带 remainingBarrier → 兜底 primary', () => {
    expect(statusTier(mkMeta({}), mkStatus({ remainingBarrier: 100 }))).toBe('primary')
  })

  it('category 缺省 + 实例带 initialBarrier → 兜底 primary', () => {
    expect(statusTier(mkMeta({}), mkStatus({ initialBarrier: 100 }))).toBe('primary')
  })

  it('category 缺省 + 无 type 无 barrier → other', () => {
    expect(statusTier(mkMeta({}), mkStatus())).toBe('other')
  })

  it('meta 为 undefined + 无 barrier → other', () => {
    expect(statusTier(undefined, mkStatus())).toBe('other')
  })

  it('meta 为 undefined + 有 barrier → primary', () => {
    expect(statusTier(undefined, mkStatus({ remainingBarrier: 50 }))).toBe('primary')
  })
})

describe('reduceCastEffectiveEnds', () => {
  it('有 primary 时取 primary 的 max，即使比 other 短', () => {
    const out = reduceCastEffectiveEnds([
      { castId: 'c1', to: 5, tier: 'primary' },
      { castId: 'c1', to: 15, tier: 'other' },
    ])
    expect(out.get('c1')).toBe(5)
  })

  it('多个 primary 取其 max', () => {
    const out = reduceCastEffectiveEnds([
      { castId: 'c1', to: 20, tier: 'primary' },
      { castId: 'c1', to: 30, tier: 'primary' },
      { castId: 'c1', to: 100, tier: 'other' },
    ])
    expect(out.get('c1')).toBe(30)
  })

  it('无 primary 时回退全部 max', () => {
    const out = reduceCastEffectiveEnds([
      { castId: 'c1', to: 10, tier: 'other' },
      { castId: 'c1', to: 24, tier: 'other' },
    ])
    expect(out.get('c1')).toBe(24)
  })

  it('多 cast 互不影响', () => {
    const out = reduceCastEffectiveEnds([
      { castId: 'a', to: 5, tier: 'primary' },
      { castId: 'a', to: 9, tier: 'other' },
      { castId: 'b', to: 7, tier: 'other' },
    ])
    expect(out.get('a')).toBe(5)
    expect(out.get('b')).toBe(7)
  })

  it('空输入 → 空 map', () => {
    expect(reduceCastEffectiveEnds([]).size).toBe(0)
  })
})
