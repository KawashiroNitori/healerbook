/**
 * statData 初始化和维护工具
 */

import type { EncounterStatistics } from '@/types/mitigation'
import type { TimelineStatData } from '@/types/statData'
import type { Composition } from '@/types/timeline'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getNonTankMinHP } from './stats'

const DEFAULT_VALUE = 10000
const DEFAULT_MAX_HP = 100000

/**
 * 获取阵容中所有技能的 statDataEntries
 */
function getCompositionEntries(composition: Composition) {
  const jobs = new Set(composition.players.map(p => p.job))
  return MITIGATION_DATA.actions
    .filter(a => a.statDataEntries && a.jobs.some(j => jobs.has(j)))
    .flatMap(a => a.statDataEntries!)
}

/**
 * 从 EncounterStatistics 中获取指定 key 的值
 */
function getValueFromStatistics(
  statistics: EncounterStatistics | null,
  type: 'shield' | 'critShield' | 'heal' | 'critHeal',
  key: number
): number {
  if (!statistics) return DEFAULT_VALUE
  switch (type) {
    case 'shield':
      return statistics.shieldByAbility[key] ?? DEFAULT_VALUE
    case 'critShield':
      return statistics.critShieldByAbility[key] ?? DEFAULT_VALUE
    case 'heal':
      return statistics.healByAbility[key] ?? DEFAULT_VALUE
    case 'critHeal':
      return statistics.critHealByAbility[key] ?? DEFAULT_VALUE
  }
}

/**
 * 从 EncounterStatistics 和阵容初始化 statData
 */
export function initializeStatData(
  statistics: EncounterStatistics | null,
  composition: Composition
): TimelineStatData {
  const statData: TimelineStatData = {
    referenceMaxHP: statistics ? getNonTankMinHP(statistics) : DEFAULT_MAX_HP,
    shieldByAbility: {},
    critShieldByAbility: {},
    healByAbility: {},
    critHealByAbility: {},
  }

  for (const entry of getCompositionEntries(composition)) {
    const value = getValueFromStatistics(statistics, entry.type, entry.key)
    switch (entry.type) {
      case 'shield':
        statData.shieldByAbility[entry.key] = value
        break
      case 'critShield':
        statData.critShieldByAbility[entry.key] = value
        break
      case 'heal':
        statData.healByAbility[entry.key] = value
        break
      case 'critHeal':
        statData.critHealByAbility[entry.key] = value
        break
    }
  }

  return statData
}

/**
 * 填充 statData 中缺失的 key（阵容新增玩家时使用）
 * 已有的 key 不覆盖
 */
export function fillMissingStatData(
  existing: TimelineStatData,
  statistics: EncounterStatistics | null,
  composition: Composition
): TimelineStatData {
  const result: TimelineStatData = {
    referenceMaxHP: existing.referenceMaxHP,
    shieldByAbility: { ...existing.shieldByAbility },
    critShieldByAbility: { ...existing.critShieldByAbility },
    healByAbility: { ...existing.healByAbility },
    critHealByAbility: { ...existing.critHealByAbility },
  }

  for (const entry of getCompositionEntries(composition)) {
    const value = getValueFromStatistics(statistics, entry.type, entry.key)
    switch (entry.type) {
      case 'shield':
        if (!(entry.key in result.shieldByAbility)) {
          result.shieldByAbility[entry.key] = value
        }
        break
      case 'critShield':
        if (!(entry.key in result.critShieldByAbility)) {
          result.critShieldByAbility[entry.key] = value
        }
        break
      case 'heal':
        if (!(entry.key in result.healByAbility)) {
          result.healByAbility[entry.key] = value
        }
        break
      case 'critHeal':
        if (!(entry.key in result.critHealByAbility)) {
          result.critHealByAbility[entry.key] = value
        }
        break
    }
  }

  return result
}

/**
 * 清理 statData 中不在阵容内的技能条目
 */
export function cleanupStatData(
  statData: TimelineStatData,
  composition: Composition
): TimelineStatData {
  const validEntries = getCompositionEntries(composition)
  const validKeys = {
    shield: new Set(validEntries.filter(e => e.type === 'shield').map(e => e.key)),
    critShield: new Set(validEntries.filter(e => e.type === 'critShield').map(e => e.key)),
    heal: new Set(validEntries.filter(e => e.type === 'heal').map(e => e.key)),
    critHeal: new Set(validEntries.filter(e => e.type === 'critHeal').map(e => e.key)),
  }

  const result: TimelineStatData = {
    referenceMaxHP: statData.referenceMaxHP,
    shieldByAbility: {},
    critShieldByAbility: {},
    healByAbility: {},
    critHealByAbility: {},
  }

  for (const [key, value] of Object.entries(statData.shieldByAbility)) {
    if (validKeys.shield.has(Number(key))) result.shieldByAbility[Number(key)] = value
  }
  for (const [key, value] of Object.entries(statData.critShieldByAbility)) {
    if (validKeys.critShield.has(Number(key))) result.critShieldByAbility[Number(key)] = value
  }
  for (const [key, value] of Object.entries(statData.healByAbility)) {
    if (validKeys.heal.has(Number(key))) result.healByAbility[Number(key)] = value
  }
  for (const [key, value] of Object.entries(statData.critHealByAbility)) {
    if (validKeys.critHeal.has(Number(key))) result.critHealByAbility[Number(key)] = value
  }

  return result
}
