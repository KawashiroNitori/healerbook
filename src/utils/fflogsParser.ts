/**
 * FFLogs URL 解析工具
 */

/**
 * 从 FFLogs URL 提取报告代码和战斗 ID
 *
 * 支持的 URL 格式：
 * - https://www.fflogs.com/reports/ABC123#fight=5
 * - https://zh.fflogs.com/reports/ABC123?fight=5
 * - https://www.fflogs.com/reports/ABC123
 * - ABC123#fight=5
 * - ABC123
 */
export function parseFFLogsUrl(url: string): {
  reportCode: string | null
  fightId: number | null
} {
  let reportCode: string | null = null
  let fightId: number | null = null

  // 提取报告代码
  const reportMatch = url.match(/reports\/([a-zA-Z0-9]+)/)
  if (reportMatch) {
    reportCode = reportMatch[1]
  } else if (/^[a-zA-Z0-9]+(?:[#?]|$)/.test(url)) {
    // 如果是纯代码（可能带 #fight=5 或 ?fight=5）
    // 确保不是以 http:// 或 https:// 开头的无效 URL
    const codeMatch = url.match(/^([a-zA-Z0-9]+)/)
    if (codeMatch) {
      reportCode = codeMatch[1]
    }
  }

  // 提取战斗 ID
  const fightMatch = url.match(/[#?&]fight=(\d+)/)
  if (fightMatch) {
    fightId = parseInt(fightMatch[1], 10)
  }

  return { reportCode, fightId }
}
