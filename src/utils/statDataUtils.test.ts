import { describe, it, expect } from 'vitest'
import type { EncounterStatistics } from '@/types/mitigation'
import type { TimelineStatData } from '@/types/statData'
import type { Composition } from '@/types/timeline'
import type { Job } from '@/data/jobs'
import {
  createEmptyStatData,
  resolveStatData,
  cleanupStatData,
  getFallbackValue,
  getFallbackMaxHP,
} from './statDataUtils'

const mockStatistics: EncounterStatistics = {
  encounterId: 1,
  encounterName: 'Test',
  damageByAbility: {},
  maxHPByJob: { WHM: 95000, SCH: 96000, WAR: 120000, PLD: 118000 } as Record<Job, number>,
  shieldByAbility: { 1362: 24000, 1917: 18000, 3903: 15000 },
  critShieldByAbility: {},
  healByAbility: { 185: 12000, 37013: 15000, 37016: 11000 },
  critHealByAbility: { 37013: 22000 },
  sampleSize: 100,
  updatedAt: '2026-01-01',
}

describe('createEmptyStatData', () => {
  it('创建空的 statData 结构', () => {
    const result = createEmptyStatData()
    expect(result.referenceMaxHP).toBeUndefined()
    expect(Object.keys(result.shieldByAbility)).toHaveLength(0)
    expect(Object.keys(result.critShieldByAbility)).toHaveLength(0)
    expect(Object.keys(result.healByAbility)).toHaveLength(0)
    expect(Object.keys(result.critHealByAbility)).toHaveLength(0)
  })
})

describe('resolveStatData', () => {
  const composition: Composition = {
    players: [
      { id: 1, job: 'PLD' },
      { id: 2, job: 'SCH' },
    ],
  }

  it('statData 为空时，使用 statistics 值', () => {
    const statData = createEmptyStatData()
    const result = resolveStatData(statData, mockStatistics, composition)

    expect(result.referenceMaxHP).toBe(95000) // 非坦最低 HP
    expect(result.shieldByAbility[1362]).toBe(24000) // PLD 圣光幕帘
    expect(result.shieldByAbility[1917]).toBe(18000) // SCH 慰藉
    expect(result.healByAbility[185]).toBe(12000) // SCH 展开战术(鼓舞)
  })

  it('statData 有用户覆盖值时，覆盖值优先', () => {
    const statData: TimelineStatData = {
      referenceMaxHP: 90000,
      shieldByAbility: { 1362: 20000 }, // 用户手动设定
      critShieldByAbility: {},
      healByAbility: {},
      critHealByAbility: {},
    }
    const result = resolveStatData(statData, mockStatistics, composition)

    expect(result.referenceMaxHP).toBe(90000) // 用户值
    expect(result.shieldByAbility[1362]).toBe(20000) // 用户值
    expect(result.shieldByAbility[1917]).toBe(18000) // fallback 到 statistics
  })

  it('statistics 为 null 时，使用硬编码默认值', () => {
    const statData = createEmptyStatData()
    const result = resolveStatData(statData, null, composition)

    expect(result.referenceMaxHP).toBe(100000) // 默认值
    expect(result.shieldByAbility[1362]).toBe(10000) // 默认值
  })

  it('statData 为 undefined 时，等效空 statData', () => {
    const result = resolveStatData(undefined, mockStatistics, composition)

    expect(result.referenceMaxHP).toBe(95000)
    expect(result.shieldByAbility[1362]).toBe(24000)
  })
})

describe('getFallbackValue / getFallbackMaxHP', () => {
  it('有 statistics 时返回 statistics 值', () => {
    expect(getFallbackValue(mockStatistics, 'shield', 1362)).toBe(24000)
    expect(getFallbackMaxHP(mockStatistics)).toBe(95000)
  })

  it('statistics 为 null 时返回默认值', () => {
    expect(getFallbackValue(null, 'shield', 1362)).toBe(10000)
    expect(getFallbackMaxHP(null)).toBe(100000)
  })
})

describe('cleanupStatData', () => {
  it('移除不在阵容中的职业独有技能条目', () => {
    const statData: TimelineStatData = {
      referenceMaxHP: 95000,
      shieldByAbility: { 1362: 24000, 1917: 18000 },
      critShieldByAbility: {},
      healByAbility: { 185: 12000 },
      critHealByAbility: {},
    }
    // 移除 SCH，只保留 PLD
    const composition: Composition = {
      players: [{ id: 1, job: 'PLD' }],
    }
    const result = cleanupStatData(statData, composition)

    expect(result.shieldByAbility[1362]).toBe(24000) // PLD 保留
    expect(result.shieldByAbility[1917]).toBeUndefined() // SCH 移除
    expect(result.healByAbility[185]).toBeUndefined() // SCH 移除
    expect(result.referenceMaxHP).toBe(95000) // 不受 cleanup 影响
  })
})
