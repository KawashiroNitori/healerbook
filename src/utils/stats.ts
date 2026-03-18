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
