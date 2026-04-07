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
