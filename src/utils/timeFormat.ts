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
