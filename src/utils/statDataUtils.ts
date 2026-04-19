/**
 * statData 工具函数
 *
 * statData 只存储用户的覆盖值。读取时按优先级合并：
 *   用户覆盖值 (statData) > 统计值 (statistics) > 硬编码默认值
 */

import type { EncounterStatistics } from '@/types/mitigation'
import type { TimelineStatData, StatDataEntryType } from '@/types/statData'
import type { Composition } from '@/types/timeline'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getNonTankMinHP, getTankMinHP } from './stats'

const DEFAULT_VALUE = 10000
const DEFAULT_MAX_HP = 100000

/**
 * 创建空的 statData（只有结构，没有预填值）
 */
export function createEmptyStatData(): TimelineStatData {
  return {
    shieldByAbility: {},
    critShieldByAbility: {},
    healByAbility: {},
    critHealByAbility: {},
  }
}

/**
 * 从 statistics 中获取指定 key 的值，不存在则返回硬编码默认值
 */
function getStatisticsValue(
  statistics: EncounterStatistics | null | undefined,
  type: StatDataEntryType,
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
 * 读取某个条目的 fallback 值（statistics > 默认值），用于 placeholder 显示
 */
export function getFallbackValue(
  statistics: EncounterStatistics | null | undefined,
  type: StatDataEntryType,
  key: number
): number {
  return getStatisticsValue(statistics, type, key)
}

/**
 * 获取 referenceMaxHP 的 fallback 值
 */
export function getFallbackMaxHP(statistics: EncounterStatistics | null | undefined): number {
  return statistics ? getNonTankMinHP(statistics) : DEFAULT_MAX_HP
}

/**
 * 获取 tankReferenceMaxHP 的 fallback 值
 */
export function getFallbackTankMaxHP(statistics: EncounterStatistics | null | undefined): number {
  return statistics ? getTankMinHP(statistics) : DEFAULT_MAX_HP
}

/**
 * 将用户覆盖值 (statData) 与 statistics 合并为完整的 TimelineStatData，
 * 供计算层和 executor 使用。
 *
 * 合并规则：statData 中有值则用，否则取 statistics，再否则取默认值。
 */
export function resolveStatData(
  statData: TimelineStatData | undefined,
  statistics: EncounterStatistics | null | undefined,
  composition: Composition | undefined
): TimelineStatData {
  const resolved: TimelineStatData = {
    referenceMaxHP: statData?.referenceMaxHP ?? getFallbackMaxHP(statistics),
    tankReferenceMaxHP: statData?.tankReferenceMaxHP ?? getFallbackTankMaxHP(statistics),
    shieldByAbility: {},
    critShieldByAbility: {},
    healByAbility: {},
    critHealByAbility: {},
  }

  if (!composition) return resolved

  // 遍历阵容中所有技能的 statDataEntries，逐个 resolve
  const jobs = new Set(composition.players.map(p => p.job))
  const actions = MITIGATION_DATA.actions.filter(
    a => a.statDataEntries && a.jobs.some(j => jobs.has(j))
  )

  for (const action of actions) {
    for (const entry of action.statDataEntries!) {
      const userValue = getUserValue(statData, entry.type, entry.key)
      const value = userValue ?? getStatisticsValue(statistics, entry.type, entry.key)
      switch (entry.type) {
        case 'shield':
          resolved.shieldByAbility[entry.key] = value
          break
        case 'critShield':
          resolved.critShieldByAbility[entry.key] = value
          break
        case 'heal':
          resolved.healByAbility[entry.key] = value
          break
        case 'critHeal':
          resolved.critHealByAbility[entry.key] = value
          break
      }
    }
  }

  return resolved
}

/**
 * 从 statData 中读取用户覆盖值，不存在返回 undefined
 */
function getUserValue(
  statData: TimelineStatData | undefined,
  type: StatDataEntryType,
  key: number
): number | undefined {
  if (!statData) return undefined
  switch (type) {
    case 'shield':
      return key in statData.shieldByAbility ? statData.shieldByAbility[key] : undefined
    case 'critShield':
      return key in statData.critShieldByAbility ? statData.critShieldByAbility[key] : undefined
    case 'heal':
      return key in statData.healByAbility ? statData.healByAbility[key] : undefined
    case 'critHeal':
      return key in statData.critHealByAbility ? statData.critHealByAbility[key] : undefined
  }
}

/**
 * 清理 statData 中不在阵容内的技能条目
 */
export function cleanupStatData(
  statData: TimelineStatData,
  composition: Composition
): TimelineStatData {
  const jobs = new Set(composition.players.map(p => p.job))
  const validEntries = MITIGATION_DATA.actions
    .filter(a => a.statDataEntries && a.jobs.some(j => jobs.has(j)))
    .flatMap(a => a.statDataEntries!)
  const validKeys = {
    shield: new Set(validEntries.filter(e => e.type === 'shield').map(e => e.key)),
    critShield: new Set(validEntries.filter(e => e.type === 'critShield').map(e => e.key)),
    heal: new Set(validEntries.filter(e => e.type === 'heal').map(e => e.key)),
    critHeal: new Set(validEntries.filter(e => e.type === 'critHeal').map(e => e.key)),
  }

  const result: TimelineStatData = {
    referenceMaxHP: statData.referenceMaxHP,
    tankReferenceMaxHP: statData.tankReferenceMaxHP,
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
