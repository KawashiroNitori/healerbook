import { describe, it, expect } from 'vitest'
import type { EncounterStatistics } from '@/types/mitigation'
import type { TimelineStatData } from '@/types/statData'
import type { Composition } from '@/types/timeline'
import type { Job } from '@/data/jobs'
import { initializeStatData, fillMissingStatData, cleanupStatData } from './statDataUtils'

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

describe('initializeStatData', () => {
  it('从 EncounterStatistics 和阵容提取相关字段', () => {
    const composition: Composition = {
      players: [
        { id: 1, job: 'PLD' },
        { id: 2, job: 'SCH' },
      ],
    }
    const result = initializeStatData(mockStatistics, composition)

    expect(result.referenceMaxHP).toBe(95000) // 非坦最低 HP (WHM 95000)
    expect(result.shieldByAbility[1362]).toBe(24000) // PLD 圣光幕帘
    expect(result.shieldByAbility[1917]).toBe(18000) // SCH 慰藉
    expect(result.healByAbility[185]).toBe(12000) // SCH 展开战术(鼓舞)
    expect(result.healByAbility[37013]).toBe(15000) // SCH 意气轩昂之策
    expect(result.critHealByAbility[37013]).toBe(22000) // SCH 意气轩昂之策(暴击)
  })

  it('statistics 中没有的字段使用默认值 10000', () => {
    const composition: Composition = {
      players: [{ id: 1, job: 'WHM' }],
    }
    const emptyStats: EncounterStatistics = {
      ...mockStatistics,
      shieldByAbility: {},
    }
    const result = initializeStatData(emptyStats, composition)
    expect(result.shieldByAbility[3903]).toBe(10000) // 默认值
  })

  it('statistics 为 null 时使用全部默认值', () => {
    const composition: Composition = {
      players: [{ id: 1, job: 'PLD' }],
    }
    const result = initializeStatData(null, composition)
    expect(result.referenceMaxHP).toBe(100000)
    expect(result.shieldByAbility[1362]).toBe(10000)
  })
})

describe('fillMissingStatData', () => {
  it('只填充 statData 中不存在的 key', () => {
    const existing: TimelineStatData = {
      referenceMaxHP: 90000,
      shieldByAbility: { 1362: 20000 },
      critShieldByAbility: {},
      healByAbility: {},
      critHealByAbility: {},
    }
    const composition: Composition = {
      players: [
        { id: 1, job: 'PLD' },
        { id: 2, job: 'SCH' },
      ],
    }
    const result = fillMissingStatData(existing, mockStatistics, composition)

    expect(result.referenceMaxHP).toBe(90000) // 保留原值
    expect(result.shieldByAbility[1362]).toBe(20000) // 保留原值
    expect(result.shieldByAbility[1917]).toBe(18000) // 新填入 SCH 慰藉
    expect(result.healByAbility[185]).toBe(12000) // 新填入 SCH 展开战术
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
  })
})
