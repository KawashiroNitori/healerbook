import type { Job } from '@/data/jobs'
import { calculatePercentile } from '@/utils/stats'

/** 样本存储（低频访问，供定时任务读写） */
export interface EncounterSamples {
  encounterId: number
  /** 每个伤害技能的原始样本值，每个 ability 独立限制 MAX_SAMPLES 条 */
  damageByAbility: Record<number, number[]>
  /** 每个职业（Job 枚举字符串，如 "WHM"）的原始最大 HP 样本值 */
  maxHPByJob: Record<Job, number[]>
  /** 每个盾值状态的原始样本值，每个 statusId 独立限制 MAX_SAMPLES 条 */
  shieldByAbility: Record<number, number[]>
  /** 每个治疗技能的原始样本值，每个 ability 独立限制 MAX_SAMPLES 条 */
  healByAbility: Record<number, number[]>
  /** 每个治疗技能的暴击样本值（hitType===2），reservoir 独立限流 */
  critHealByAbility: Record<number, number[]>
  updatedAt: string
}

export const MAX_SAMPLES = 500

/**
 * Reservoir Sampling（Algorithm R）
 * 从 reservoir + incoming 中均匀随机保留 max 条样本
 */
export function mergeWithReservoirSampling(
  reservoir: number[],
  incoming: number[],
  max: number = MAX_SAMPLES
): number[] {
  const combined = [...reservoir, ...incoming]
  if (combined.length <= max) return combined

  const result = combined.slice(0, max)
  for (let i = max; i < combined.length; i++) {
    const j = Math.floor(Math.random() * (i + 1))
    if (j < max) result[j] = combined[i]
  }
  return result
}

/**
 * 对 Record<K, number[]> 中每个 key 计算指定百分位数
 */
export function calculatePercentiles<T extends number | string>(
  data: Record<T, number[]>,
  percentile: number = 50
): Record<T, number> {
  const result: Record<string, number> = {}

  for (const [key, values] of Object.entries(data)) {
    if (Array.isArray(values) && values.length > 0) {
      result[key] = calculatePercentile(values as number[], percentile)
    }
  }

  return result as Record<T, number>
}

/** 工具：reservoir merge `Record<K, number[]>`（K 为 string 或 number——运行时都是字符串键） */
export function mergeRecord<K extends string | number>(
  base: Record<K, number[]>,
  incoming: Record<K, number[]>
): Record<K, number[]> {
  const out: Record<string, number[]> = { ...(base as unknown as Record<string, number[]>) }
  const entries = Object.entries(incoming as unknown as Record<string, number[]>)
  for (const [key, values] of entries) {
    out[key] = mergeWithReservoirSampling(out[key] ?? [], values)
  }
  return out as unknown as Record<K, number[]>
}
