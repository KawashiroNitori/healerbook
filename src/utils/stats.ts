import type { EncounterStatistics } from '@/types/mitigation'
import type { Job } from '@/data/jobs'
import { getTankJobs } from '@/data/jobs'

/**
 * 计算任意百分位数并取整（默认 50 即中位数）
 * percentile: 0-100
 */
export function calculatePercentile(values: number[], percentile: number = 50): number {
  if (values.length === 0) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const idx = (percentile / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo))
}

/** FFLogs 治疗事件暴击判定：hitType === 2。已对真实报告核验。 */
export const HEAL_CRIT_HIT_TYPE = 2

/** 普通治疗：非暴击样本 p50；非暴击桶为空则回退全部（非暴击 ∪ 暴击）p50。 */
export function computeNormalHeal(nonCrit: number[], crit: number[]): number {
  if (nonCrit.length > 0) return calculatePercentile(nonCrit, 50)
  return calculatePercentile([...nonCrit, ...crit], 50)
}

/** 暴击治疗：暴击样本 p50；暴击桶为空则回退全部 p90（沿用旧估算）。 */
export function computeCritHeal(nonCrit: number[], crit: number[]): number {
  if (crit.length > 0) return calculatePercentile(crit, 50)
  return calculatePercentile([...nonCrit, ...crit], 90)
}

/** 对两桶（非暴击 / 暴击）逐 ability key 计算普通与暴击治疗值。两桶该 key 都空则跳过。 */
export function computeHealStats(
  nonCritByAbility: Record<number, number[]>,
  critByAbility: Record<number, number[]>
): { healByAbility: Record<number, number>; critHealByAbility: Record<number, number> } {
  const keys = new Set<number>([
    ...Object.keys(nonCritByAbility).map(Number),
    ...Object.keys(critByAbility).map(Number),
  ])
  const healByAbility: Record<number, number> = {}
  const critHealByAbility: Record<number, number> = {}
  for (const key of keys) {
    const nonCrit = nonCritByAbility[key] ?? []
    const crit = critByAbility[key] ?? []
    if (!nonCrit.length && !crit.length) continue
    healByAbility[key] = computeNormalHeal(nonCrit, crit)
    critHealByAbility[key] = computeCritHeal(nonCrit, crit)
  }
  return { healByAbility, critHealByAbility }
}

const DEFAULT_MAX_HP = 100000

/**
 * 从 EncounterStatistics 获取非坦克职业的最低最大 HP
 * 无数据时返回 100000
 */
export function getNonTankMinHP(statistics: EncounterStatistics | null): number {
  if (!statistics) return DEFAULT_MAX_HP

  const tankJobs = new Set<string>(getTankJobs())
  const hpValues = (Object.entries(statistics.maxHPByJob) as [Job, number][])
    .filter(([job]) => !tankJobs.has(job))
    .map(([, hp]) => hp)
    .filter(hp => hp > 0)

  return hpValues.length > 0 ? Math.min(...hpValues) : DEFAULT_MAX_HP
}

/**
 * 从 EncounterStatistics 获取坦克职业的最低最大 HP
 * 无数据时返回 100000
 */
export function getTankMinHP(statistics: EncounterStatistics | null): number {
  if (!statistics) return DEFAULT_MAX_HP

  const tankJobs = new Set<string>(getTankJobs())
  const hpValues = (Object.entries(statistics.maxHPByJob) as [Job, number][])
    .filter(([job]) => tankJobs.has(job))
    .map(([, hp]) => hp)
    .filter(hp => hp > 0)

  return hpValues.length > 0 ? Math.min(...hpValues) : DEFAULT_MAX_HP
}
