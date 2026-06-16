/**
 * statusFilter 测试
 */

import { describe, it, expect } from 'vitest'
import { isStatusValidForTank } from './statusFilter'
import type { MitigationStatus, MitigationStatusMetadata } from '@/types/status'

function makeMeta(category?: MitigationStatusMetadata['category']): MitigationStatusMetadata {
  // 仅测试用；业务字段按最小必要填
  return {
    id: 999,
    name: 't',
    type: 'multiplier',
    performance: { physics: 1, magic: 1, darkness: 1 },
    isFriendly: true,
    isTankOnly: false,
    category,
  } as unknown as MitigationStatusMetadata
}

function makeStatus(sourcePlayerId: number): MitigationStatus {
  return {
    instanceId: 'x',
    statusId: 999,
    startTime: 0,
    endTime: 10,
    sourcePlayerId,
  }
}

describe('isStatusValidForTank', () => {
  it('partywide → 对任何 tank 都有效', () => {
    const meta = makeMeta(['partywide', 'percentage'])
    expect(isStatusValidForTank(meta, makeStatus(1), 1)).toBe(true)
    expect(isStatusValidForTank(meta, makeStatus(1), 2)).toBe(true)
  })

  it('未标注 category → 默认放行', () => {
    const meta = makeMeta(undefined)
    expect(isStatusValidForTank(meta, makeStatus(1), 2)).toBe(true)
  })

  it('category 不含 self/target → 默认放行', () => {
    const meta = makeMeta(['percentage'])
    expect(isStatusValidForTank(meta, makeStatus(1), 2)).toBe(true)
  })

  it('持有者评估：要求 self', () => {
    expect(isStatusValidForTank(makeMeta(['self', 'percentage']), makeStatus(1), 1)).toBe(true)
    expect(isStatusValidForTank(makeMeta(['target', 'percentage']), makeStatus(1), 1)).toBe(false)
  })

  it('非持有者评估：要求 target', () => {
    expect(isStatusValidForTank(makeMeta(['target', 'percentage']), makeStatus(1), 2)).toBe(true)
    expect(isStatusValidForTank(makeMeta(['self', 'percentage']), makeStatus(1), 2)).toBe(false)
  })

  it('self+target 同时有 → 两侧都通过', () => {
    const meta = makeMeta(['self', 'target', 'percentage'])
    expect(isStatusValidForTank(meta, makeStatus(1), 1)).toBe(true)
    expect(isStatusValidForTank(meta, makeStatus(1), 2)).toBe(true)
  })

  describe('actionCategory 覆盖', () => {
    it('提供 actionCategory 时优先于 meta.category', () => {
      // meta 说 self，但产出它的 action 说 target → 以 action 为准
      const meta = makeMeta(['self', 'percentage'])
      // 持有者（caster）：要求 self，但有效 category 是 target → 不通过
      expect(isStatusValidForTank(meta, makeStatus(1), 1, ['target', 'percentage'])).toBe(false)
      // 非持有者（目标）：要求 target，有效 category 是 target → 通过
      expect(isStatusValidForTank(meta, makeStatus(1), 2, ['target', 'percentage'])).toBe(true)
    })

    it('actionCategory 为 undefined 时回落 meta.category', () => {
      const meta = makeMeta(['self', 'percentage'])
      expect(isStatusValidForTank(meta, makeStatus(1), 1, undefined)).toBe(true)
      expect(isStatusValidForTank(meta, makeStatus(1), 2, undefined)).toBe(false)
    })

    it('共享 status：同一 statusId 由不同 action 产出 → 各自跟随 action', () => {
      const meta = makeMeta(['self', 'percentage']) // 共享 status 的 statusExtras 默认（self）
      // 自身技能产出（actionCategory=self）：持有者吃、对方不吃
      expect(isStatusValidForTank(meta, makeStatus(1), 1, ['self', 'percentage'])).toBe(true)
      expect(isStatusValidForTank(meta, makeStatus(1), 2, ['self', 'percentage'])).toBe(false)
      // 目标技能产出（actionCategory=target）：持有者不吃、对方吃
      expect(isStatusValidForTank(meta, makeStatus(1), 1, ['target', 'percentage'])).toBe(false)
      expect(isStatusValidForTank(meta, makeStatus(1), 2, ['target', 'percentage'])).toBe(true)
    })
  })
})
