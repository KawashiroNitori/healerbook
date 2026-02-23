/**
 * FFLogs v2 API 客户端（GraphQL）
 *
 * FFLogs v2 使用 GraphQL API，需要通过后端代理访问
 * API 文档：https://www.fflogs.com/api/docs
 */

import type { FFLogsReport } from '@/types/fflogs'
import type { IFFLogsClient } from './IFFLogsClient'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/fflogs'
const REQUEST_TIMEOUT = 60000

/**
 * 带超时的 fetch 请求
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout: number = REQUEST_TIMEOUT
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
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
 * FFLogs v2 GraphQL 客户端
 */
export class FFLogsClientV2 implements IFFLogsClient {
  private baseUrl: string

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl
  }

  /**
   * 执行 GraphQL 查询
   */
  private async query<T = any>(query: string, variables: Record<string, any> = {}): Promise<T> {
    const url = `${this.baseUrl}/v2/graphql`

    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || `HTTP ${response.status}`)
      }

      const result = await response.json()

      // 检查 GraphQL 错误
      if (result.errors && result.errors.length > 0) {
        const errorMessage = result.errors.map((e: any) => e.message).join(', ')
        throw new Error(errorMessage)
      }

      return result.data
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * 获取战斗报告
   */
  async getReport(reportCode: string): Promise<FFLogsReport> {
    const query = `
      query GetReport($code: String!) {
        reportData {
          report(code: $code) {
            code
            title
            startTime
            endTime
            fights {
              id
              name
              difficulty
              kill
              startTime
              endTime
              encounterID
            }
            masterData {
              actors(type: "Player") {
                id
                name
                type
                subType
                server
              }
            }
          }
        }
      }
    `

    const data = await this.query<{
      reportData: {
        report: {
          code: string
          title: string
          startTime: number
          endTime: number
          fights: Array<{
            id: number
            name: string
            difficulty?: number
            kill?: boolean
            startTime: number
            endTime: number
            encounterID?: number
          }>
          masterData: {
            actors: Array<{
              id: number
              name: string
              type: string
              subType: string
              server?: string
            }>
          }
        }
      }
    }>(query, { code: reportCode })

    const report = data.reportData.report

    // 转换为统一格式
    return {
      code: report.code,
      title: report.title,
      startTime: report.startTime,
      endTime: report.endTime,
      fights: report.fights.map((fight) => ({
        id: fight.id,
        name: fight.name,
        difficulty: fight.difficulty,
        kill: fight.kill || false,
        startTime: fight.startTime,
        endTime: fight.endTime,
        encounterID: fight.encounterID,
      })),
      friendlies: report.masterData.actors.map((actor) => ({
        id: actor.id,
        guid: actor.id,
        name: actor.name,
        type: actor.subType || actor.type,
        server: actor.server,
      })),
    }
  }

  /**
   * 获取战斗事件（单页，内部使用）
   *
   * 注意：v2 API 参数映射：
   * - start/end: 时间范围（毫秒）
   * - lang: 语言（v2 暂不支持，忽略）
   */
  private async getEvents(
    reportCode: string,
    params: {
      start?: number
      end?: number
      lang?: string
    } = {}
  ) {
    const { start: startTime, end: endTime } = params

    const query = `
      query GetEvents(
        $code: String!
        $startTime: Float
        $endTime: Float
        $limit: Int
      ) {
        reportData {
          report(code: $code) {
            events(
              startTime: $startTime
              endTime: $endTime
              dataType: DamageTaken
              limit: $limit
            ) {
              data
              nextPageTimestamp
            }
          }
        }
      }
    `

    const data = await this.query<{
      reportData: {
        report: {
          events: {
            data: any[]
            nextPageTimestamp?: number
          }
        }
      }
    }>(query, {
      code: reportCode,
      startTime,
      endTime,
      limit: 10000,
    })

    const result = data.reportData.report.events

    // 返回与 v1 相同的格式
    return {
      events: result.data,
      nextPageTimestamp: result.nextPageTimestamp,
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
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        return new Error('FFLogs 连接配置错误，请联系开发者')
      }
      if (error.message.includes('403') || error.message.includes('Forbidden')) {
        return new Error('没有访问权限')
      }
      if (error.message.includes('404') || error.message.includes('Not Found')) {
        return new Error('报告不存在或已被删除')
      }
      if (error.message.includes('429') || error.message.includes('Too Many Requests')) {
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
 * 创建 FFLogs v2 客户端实例
 */
export function createFFLogsClientV2(): FFLogsClientV2 {
  return new FFLogsClientV2()
}
