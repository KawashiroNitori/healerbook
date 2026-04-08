/**
 * FFLogs URL 解析工具
 */

/**
 * 从 FFLogs URL 提取报告代码和战斗 ID
 *
 * 支持的 URL 格式：
 * - https://www.fflogs.com/reports/ABC123#fight=5
 * - https://zh.fflogs.com/reports/ABC123?fight=5
 * - https://www.fflogs.com/reports/ABC123#fight=last
 * - https://www.fflogs.com/reports/ABC123
 * - https://www.fflogs.com/reports/a:ABC123#fight=5  (匿名报告)
 * - ABC123#fight=5
 * - ABC123#fight=last
 * - ABC123
 * - a:ABC123#fight=5  (匿名报告)
 */
export function parseFFLogsUrl(url: string): {
  reportCode: string | null
  fightId: number | null
  isLastFight: boolean
} {
  let reportCode: string | null = null
  let fightId: number | null = null
  let isLastFight = false

  // 提取报告代码（支持匿名报告 a:CODE 格式）
  const reportMatch = url.match(/reports\/(a:[a-zA-Z0-9]+|[a-zA-Z0-9]+)/)
  if (reportMatch) {
    reportCode = reportMatch[1]
  } else if (/^(a:)?[a-zA-Z0-9]+(?:[#?]|$)/.test(url)) {
    // 如果是纯代码（可能带 #fight=5 或 ?fight=5）
    // 确保不是以 http:// 或 https:// 开头的无效 URL
    const codeMatch = url.match(/^(a:[a-zA-Z0-9]+|[a-zA-Z0-9]+)/)
    if (codeMatch) {
      reportCode = codeMatch[1]
    }
  }

  // 提取战斗 ID
  const fightMatch = url.match(/[#?&]fight=(\d+|last)/)
  if (fightMatch) {
    if (fightMatch[1] === 'last') {
      isLastFight = true
    } else {
      fightId = parseInt(fightMatch[1], 10)
    }
  } else if (reportCode) {
    // 未指定 fight 参数时，默认取最后一个战斗
    isLastFight = true
  }

  return { reportCode, fightId, isLastFight }
}
