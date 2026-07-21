/**
 * FFLogs API 客户端（前端薄客户端）
 *
 * 只负责调用 Worker 的 HTTP 接口，不包含任何 FFLogs API 调用逻辑
 */

import i18n from '@/i18n'
import { TimeoutError } from 'ky'
import type { FFLogsReport, FFLogsEvent, FFLogsEventsResponse } from '@/types/fflogs'
import { apiClient } from './apiClient'

const REQUEST_TIMEOUT = 60000

/**
 * FFLogs 客户端（前端）
 */
export class FFLogsClient {
  /**
   * 获取战斗报告
   */
  async getReport(reportCode: string): Promise<FFLogsReport> {
    try {
      const response = await apiClient.get(`fflogs/report/${reportCode}`, {
        timeout: REQUEST_TIMEOUT,
        throwHttpErrors: false,
      })
      if (!response.ok) {
        const error = (await response.json()) as { error?: string }
        throw new Error(error.error || `HTTP ${response.status}`)
      }
      return (await response.json()) as FFLogsReport
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * 获取战斗所有事件（自动分页）
   */
  async getAllEvents(
    reportCode: string,
    params: {
      start: number
      end: number
      /** i18n 扩展点：随请求透传语言，当前 Worker 侧 GraphQL 仍固定 translate: false */
      lang?: string
    }
  ) {
    const allEvents: FFLogsEvent[] = []
    let currentStart = params.start
    const { end, lang } = params

    // 最多请求 100 页，防止无限循环
    const MAX_PAGES = 100
    let pageCount = 0

    while (currentStart < end && pageCount < MAX_PAGES) {
      pageCount++

      const response = await this.getEvents(reportCode, { start: currentStart, end, lang })

      if (response.events && response.events.length > 0) {
        allEvents.push(...response.events)
      }

      if (response.nextPageTimestamp && response.nextPageTimestamp < end) {
        currentStart = response.nextPageTimestamp
      } else {
        currentStart = end
      }
    }

    return { events: allEvents, totalPages: pageCount }
  }

  /**
   * 获取战斗事件（单页，私有方法）
   */
  private async getEvents(
    reportCode: string,
    params: { start?: number; end?: number; lang?: string } = {}
  ): Promise<FFLogsEventsResponse> {
    const queryParams = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      )
    )

    try {
      const response = await apiClient.get(`fflogs/events/${reportCode}?${queryParams}`, {
        timeout: REQUEST_TIMEOUT,
        throwHttpErrors: false,
      })
      if (!response.ok) {
        const error = (await response.json()) as { error?: string }
        throw new Error(error.error || `HTTP ${response.status}`)
      }
      return (await response.json()) as FFLogsEventsResponse
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * 错误处理
   */
  private handleError(error: unknown): Error {
    if (error instanceof TimeoutError) return new Error(i18n.t('common:fflogsError.timeout'))
    if (error instanceof Error) {
      if (error.message.includes('403')) return new Error(i18n.t('common:fflogsError.forbidden'))
      if (error.message.includes('404'))
        return new Error(i18n.t('common:fflogsError.reportNotFound'))
      if (error.message.includes('429'))
        return new Error(i18n.t('common:fflogsError.tooManyRequests'))
      if (error.message.includes('fetch'))
        return new Error(i18n.t('common:fflogsError.networkFailed'))
      return error
    }
    return new Error(i18n.t('common:unknownError'))
  }
}

/**
 * 创建 FFLogs 客户端实例
 */
export function createFFLogsClient(): FFLogsClient {
  return new FFLogsClient()
}
