import { describe, it, expect } from 'vitest'
import {
  mergeWithReservoirSampling,
  getSamplesKVKey,
  calculatePercentiles,
  slimDamageEvents,
} from './top100Sync'
import { calculatePercentile } from '@/utils/stats'
import type { DamageEvent } from '@/types/timeline'

describe('mergeWithReservoirSampling', () => {
  it('总量未超上限时直接追加', () => {
    const result = mergeWithReservoirSampling([1, 2, 3], [4, 5], 10)
    expect(result).toEqual([1, 2, 3, 4, 5])
  })

  it('总量超上限时结果长度等于 max', () => {
    const reservoir = Array.from({ length: 10 }, (_, i) => i)
    const incoming = Array.from({ length: 5 }, (_, i) => i + 100)
    const result = mergeWithReservoirSampling(reservoir, incoming, 10)
    expect(result).toHaveLength(10)
  })

  it('空旧样本时直接返回新数据（不超限）', () => {
    const result = mergeWithReservoirSampling([], [1, 2, 3], 10)
    expect(result).toEqual([1, 2, 3])
  })

  it('空新数据时返回旧样本', () => {
    const result = mergeWithReservoirSampling([1, 2, 3], [], 10)
    expect(result).toEqual([1, 2, 3])
  })
})

describe('calculatePercentile', () => {
  it('奇数个样本', () => {
    expect(calculatePercentile([3, 1, 2])).toBe(2)
  })

  it('偶数个样本', () => {
    expect(calculatePercentile([1, 2, 3, 4])).toBe(3) // round((2+3)/2)
  })

  it('偶数个样本，中间两值之和为奇数（.5 舍入）', () => {
    expect(calculatePercentile([1, 2])).toBe(2) // round((1+2)/2) = round(1.5) = 2
  })

  it('单个样本', () => {
    expect(calculatePercentile([42])).toBe(42)
  })

  it('空数组返回 0', () => {
    expect(calculatePercentile([])).toBe(0)
  })
})

describe('getSamplesKVKey', () => {
  it('返回正确格式', () => {
    expect(getSamplesKVKey(1234)).toBe('statistics-samples:encounter:1234')
  })
})

describe('calculatePercentiles', () => {
  it('计算每个 key 的中位数', () => {
    const result = calculatePercentiles({ 100: [1, 3, 5], 200: [2, 4] })
    expect(result[100]).toBe(3)
    expect(result[200]).toBe(3) // round((2+4)/2)
  })

  it('空数组的 key 不出现在结果中', () => {
    const result = calculatePercentiles({ 100: [], 200: [5] })
    expect(result[100]).toBeUndefined()
    expect(result[200]).toBe(5)
  })
})

describe('slimDamageEvents', () => {
  it('剥离 id / targetPlayerId / playerDamageDetails 并提取 abilityId', () => {
    const full: DamageEvent[] = [
      {
        id: 'event-123',
        name: '死刑',
        time: 12.3,
        damage: 80000,
        type: 'tankbuster',
        damageType: 'physical',
        targetPlayerId: 5,
        playerDamageDetails: [
          {
            timestamp: 12345,
            packetId: 1,
            sourceId: 99,
            playerId: 5,
            job: 'WAR',
            abilityId: 40000,
            skillName: '死刑',
            unmitigatedDamage: 80000,
            finalDamage: 40000,
            statuses: [],
          },
        ],
        packetId: 1,
      },
    ]
    const result = slimDamageEvents(full)
    expect(result).toEqual([
      {
        name: '死刑',
        time: 12.3,
        damage: 80000,
        type: 'tankbuster',
        damageType: 'physical',
        packetId: 1,
        abilityId: 40000,
        snapshotTime: undefined,
      },
    ])
  })

  it('playerDamageDetails 为空时 abilityId 为 0', () => {
    const full: DamageEvent[] = [
      {
        id: 'x',
        name: '未知',
        time: 0,
        damage: 0,
        type: 'aoe',
        damageType: 'magical',
      },
    ]
    const result = slimDamageEvents(full)
    expect(result[0].abilityId).toBe(0)
  })
})
