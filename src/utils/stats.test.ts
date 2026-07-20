import { describe, it, expect } from 'vitest'
import {
  calculatePercentile,
  computeNormalHeal,
  computeCritHeal,
  computeHealStats,
  HEAL_CRIT_HIT_TYPE,
} from './stats'

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

describe('computeNormalHeal', () => {
  it('非暴击桶非空取其 p50', () => {
    expect(computeNormalHeal([10000, 20000, 30000], [99999])).toBe(20000)
  })
  it('非暴击桶为空回退全部 p50', () => {
    expect(computeNormalHeal([], [10000, 20000, 30000])).toBe(20000)
  })
})

describe('computeCritHeal', () => {
  it('暴击桶非空取其 p50', () => {
    expect(computeCritHeal([1, 2, 3], [40000, 50000, 60000])).toBe(50000)
  })
  it('暴击桶为空回退全部 p90', () => {
    // 全部 = [10000,20000,30000,40000,50000]，p90 = 46000
    expect(computeCritHeal([10000, 20000, 30000, 40000, 50000], [])).toBe(46000)
  })
})

describe('computeHealStats', () => {
  it('逐 key 分别算普通/暴击，两桶 key 取并集', () => {
    const nonCrit = { 100: [10000, 20000, 30000], 200: [5000] }
    const crit = { 100: [40000, 50000, 60000], 300: [70000] }
    const { healByAbility, critHealByAbility } = computeHealStats(nonCrit, crit)
    expect(healByAbility[100]).toBe(20000) // p50 非暴击
    expect(critHealByAbility[100]).toBe(50000) // p50 暴击
    expect(healByAbility[200]).toBe(5000) // 仅非暴击 → 普通 p50
    expect(critHealByAbility[200]).toBe(5000) // 暴击桶空 → p90 全部（单样本 = 5000）
    expect(healByAbility[300]).toBe(70000) // 非暴击桶空 → 回退全部 p50
    expect(critHealByAbility[300]).toBe(70000) // 暴击桶非空 → p50
  })
  it('HEAL_CRIT_HIT_TYPE 为 2', () => {
    expect(HEAL_CRIT_HIT_TYPE).toBe(2)
  })
})
