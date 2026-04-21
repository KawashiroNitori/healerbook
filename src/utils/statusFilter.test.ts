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
})
