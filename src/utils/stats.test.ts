import { describe, it, expect } from 'vitest'
import { calculatePercentile } from './stats'

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
