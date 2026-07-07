/**
 * 时间格式化工具函数
 */

/**
 * 把非负秒数按 0.1s 精度四舍五入后拆分为 {分, 秒, 十分位}。
 * 先把 deciseconds 算成整体再拆，避免 9.97 → "9:60.0" 式进位撕裂。
 * 仅接受 t >= 0；符号与负数格式由调用方自理（各消费方负数口径不同）。
 */
export function splitDeciseconds(t: number): {
  minutes: number
  seconds: number
  tenths: number
} {
  const totalDeci = Math.round(t * 10)
  const totalSeconds = Math.floor(totalDeci / 10)
  const tenths = totalDeci % 10
  return { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60, tenths }
}

export function formatTimeWithDecimal(seconds: number): string {
  const sign = seconds < 0 ? '-' : ''
  const { minutes, seconds: sec, tenths } = splitDeciseconds(Math.abs(seconds))
  return `${sign}${minutes}:${sec < 10 ? '0' : ''}${sec}.${tenths}`
}

/**
 * 伤害数值缩略：≥10000 显示为 x.xw，否则用千分位分隔
 */
export function formatDamageValue(value: number): string {
  return value >= 10000 ? `${(value / 10000).toFixed(1)}w` : value.toLocaleString()
}
