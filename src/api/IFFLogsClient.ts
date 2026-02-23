/**
 * FFLogs 客户端接口
 * v1 和 v2 客户端都实现此接口，确保 API 一致性
 */

import type { FFLogsReport } from '@/types/fflogs'

/**
 * FFLogs 客户端接口
 */
export interface IFFLogsClient {
  /**
   * 获取战斗报告
   */
  getReport(reportCode: string): Promise<FFLogsReport>

  /**
   * 获取战斗所有事件（自动分页）
   */
  getAllEvents(
    reportCode: string,
    params: {
      start: number
      end: number
      lang?: string
    },
    onProgress?: (progress: { current: number; total: number; percentage: number }) => void
  ): Promise<{
    events: any[]
    totalPages: number
  }>
}
