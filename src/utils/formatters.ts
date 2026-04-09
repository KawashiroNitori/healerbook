/**
 * 时间格式化工具函数
 */

export function formatTimeWithDecimal(seconds: number): string {
  const abs = Math.abs(seconds)
  const sign = seconds < 0 ? '-' : ''
  const min = Math.floor(abs / 60)
  const sec = abs % 60
  return `${sign}${min}:${sec < 10 ? '0' : ''}${sec.toFixed(1)}`
}

/**
 * 伤害数值缩略：≥10000 显示为 x.xw，否则用千分位分隔
 */
export function formatDamageValue(value: number): string {
  return value >= 10000 ? `${(value / 10000).toFixed(1)}w` : value.toLocaleString()
}
