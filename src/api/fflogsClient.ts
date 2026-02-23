/**
 * FFLogs API 客户端（通过后端代理）
 */

import type { FFLogsV1Report, FFLogsReport } from '@/types/fflogs'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/fflogs'
const REQUEST_TIMEOUT = 60000 

/**
 * 带超时的 fetch 请求
 */
async function fetchWithTimeout(url: string, timeout: number = REQUEST_TIMEOUT): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试')
    }
    throw error
  }
}

/**
 * 将 v1 响应转换为统一格式
 */
function convertV1ToReport(v1Report: FFLogsV1Report, reportCode: string): FFLogsReport {
  return {
    code: reportCode,
    title: v1Report.title || '未命名报告',
    lang: v1Report.lang,
    startTime: v1Report.start,
    endTime: v1Report.end,
    fights: v1Report.fights.map((fight) => ({
      id: fight.id,
      name: fight.name,
      difficulty: fight.difficulty,
      kill: fight.kill || false,
      startTime: fight.start_time,
      endTime: fight.end_time,
      encounterID: fight.boss,
    })),
    friendlies: v1Report.friendlies,
    enemies: v1Report.enemies,
  }
}

/**
 * FFLogs 客户端
 */
export class FFLogsClient {
  private baseUrl: string

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl
  }

  /**
   * 获取战斗报告
   */
  async getReport(reportCode: string): Promise<FFLogsReport> {
    const url = `${this.baseUrl}/report/${reportCode}`

    try {
      const response = await fetchWithTimeout(url)

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || `HTTP ${response.status}`)
      }

      const v1Report: FFLogsV1Report = await response.json()
      return convertV1ToReport(v1Report, reportCode)
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * 获取战斗事件（单页）
   */
  async getEvents(reportCode: string, params: {
    start?: number
    end?: number
    actorid?: number
    actorinstance?: number
    actorclass?: string
    cutoff?: number
    encounter?: number
    wipes?: number
    difficulty?: number
    filter?: string
    translate?: boolean
    lang?: string
  } = {}) {
    const queryParams = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      )
    )

    const url = `${this.baseUrl}/events/${reportCode}?${queryParams}`

    try {
      const response = await fetchWithTimeout(url)

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || `HTTP ${response.status}`)
      }

      return await response.json()
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
      lang?: string
    },
    onProgress?: (progress: { current: number; total: number; percentage: number }) => void
  ) {
    const allEvents: any[] = []
    let currentStart = params.start
    const { end, lang } = params
    const totalRange = end - params.start

    // 最多请求 100 页，防止无限循环
    const MAX_PAGES = 100
    let pageCount = 0

    while (currentStart < end && pageCount < MAX_PAGES) {
      pageCount++

      const response = await this.getEvents(reportCode, {
        start: currentStart,
        end,
        lang,
      })

      // 收集事件
      if (response.events && response.events.length > 0) {
        allEvents.push(...response.events)
      }

      // 检查是否有下一页
      if (response.nextPageTimestamp && response.nextPageTimestamp < end) {
        currentStart = response.nextPageTimestamp
      } else {
        // 没有更多数据
        currentStart = end
      }

      // 报告进度
      if (onProgress) {
        const processedRange = currentStart - params.start
        const percentage = Math.min(Math.round((processedRange / totalRange) * 100), 100)
        onProgress({
          current: processedRange,
          total: totalRange,
          percentage,
        })
      }
    }

    return {
      events: allEvents,
      totalPages: pageCount,
    }
  }

  /**
   * 错误处理
   */
  private handleError(error: unknown): Error {
    if (error instanceof Error) {
      if (error.message.includes('请求超时')) {
        return error
      }
      if (error.message.includes('401')) {
        return new Error('FFLogs 连接配置错误，请联系开发者')
      }
      if (error.message.includes('403')) {
        return new Error('没有访问权限')
      }
      if (error.message.includes('404')) {
        return new Error('报告不存在或已被删除')
      }
      if (error.message.includes('429')) {
        return new Error('请求过于频繁，请稍后重试')
      }
      if (error.message.includes('fetch')) {
        return new Error('网络连接失败，请检查网络设置')
      }
      return error
    }
    return new Error('未知错误')
  }
}

/**
 * 创建 FFLogs 客户端实例
 */
export function createFFLogsClient(): FFLogsClient {
  return new FFLogsClient()
}
