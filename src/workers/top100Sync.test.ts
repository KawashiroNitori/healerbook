import { describe, it, expect } from 'vitest'
import { mergeWithReservoirSampling, calculateMedian, getSamplesKVKey, calculateMedians } from './top100Sync'

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

describe('calculateMedian', () => {
  it('奇数个样本', () => {
    expect(calculateMedian([3, 1, 2])).toBe(2)
  })

  it('偶数个样本', () => {
    expect(calculateMedian([1, 2, 3, 4])).toBe(3) // round((2+3)/2)
  })

  it('偶数个样本，中间两值之和为奇数（.5 舍入）', () => {
    expect(calculateMedian([1, 2])).toBe(2) // round((1+2)/2) = round(1.5) = 2
  })

  it('单个样本', () => {
    expect(calculateMedian([42])).toBe(42)
  })

  it('空数组返回 0', () => {
    expect(calculateMedian([])).toBe(0)
  })
})

describe('getSamplesKVKey', () => {
  it('返回正确格式', () => {
    expect(getSamplesKVKey(1234)).toBe('statistics-samples:encounter:1234')
  })
})

describe('calculateMedians', () => {
  it('计算每个 key 的中位数', () => {
    const result = calculateMedians({ 100: [1, 3, 5], 200: [2, 4] })
    expect(result[100]).toBe(3)
    expect(result[200]).toBe(3) // round((2+4)/2)
  })

  it('空数组的 key 不出现在结果中', () => {
    const result = calculateMedians({ 100: [], 200: [5] })
    expect(result[100]).toBeUndefined()
    expect(result[200]).toBe(5)
  })
})
