/**
 * FFLogs API 客户端（前端薄客户端）
 *
 * 只负责调用 Worker 的 HTTP 接口，不包含任何 FFLogs API 调用逻辑
 */

import type {
  FFLogsV1Report,
  FFLogsReport,
  FFLogsEvent,
  FFLogsEventsResponse,
} from '@/types/fflogs'
import { useAuthStore } from '@/store/authStore'
import { toast } from 'sonner'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/fflogs'
const REQUEST_TIMEOUT = 60000
const AUTH_REFRESH_URL = '/api/auth/refresh'

/**
 * 带鉴权和自动续期的 fetch 请求
 */
async function fetchWithAuth(url: string, timeout: number = REQUEST_TIMEOUT): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  const { accessToken } = useAuthStore.getState()

  const headers: Record<string, string> = {}
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`
  }

  try {
    const response = await fetch(url, { signal: controller.signal, headers })
    clearTimeout(timeoutId)

    // 401：尝试续期（当前 Worker 路由不强制鉴权，此逻辑为后续鉴权路由准备）
    if (response.status === 401) {
      const refreshed = await tryRefreshToken()
      if (refreshed) {
        const { accessToken: newToken } = useAuthStore.getState()
        const retryResponse = await fetch(url, {
          headers: newToken ? { Authorization: `Bearer ${newToken}` } : {},
        })
        return retryResponse
      }
    }

    return response
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试')
    }
    throw error
  }
}

async function tryRefreshToken(): Promise<boolean> {
  const { refreshToken, setTokens, clearTokens, username } = useAuthStore.getState()
  if (!refreshToken) return false

  try {
    const res = await fetch(AUTH_REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })

    if (!res.ok) {
      clearTokens()
      toast.error('登录已过期，请重新登录')
      return false
    }

    const { access_token } = (await res.json()) as { access_token: string }
    // refresh 接口不返回 name，保留 authStore 中缓存的 username
    setTokens(access_token, refreshToken, username ?? '')
    return true
  } catch {
    clearTokens()
    toast.error('登录已过期，请重新登录')
    return false
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
    fights: v1Report.fights.map(fight => ({
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
    abilities: v1Report.abilities,
  }
}

/**
 * FFLogs 客户端（前端）
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
      const response = await fetchWithAuth(url)

      if (!response.ok) {
        const error = (await response.json()) as { error?: string }
        throw new Error(error.error || `HTTP ${response.status}`)
      }

      const v1Report: FFLogsV1Report = await response.json()
      return convertV1ToReport(v1Report, reportCode)
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

      const response = await this.getEvents(reportCode, {
        start: currentStart,
        end,
        lang,
      })

      if (response.events && response.events.length > 0) {
        allEvents.push(...response.events)
      }

      if (response.nextPageTimestamp && response.nextPageTimestamp < end) {
        currentStart = response.nextPageTimestamp
      } else {
        currentStart = end
      }
    }

    return {
      events: allEvents,
      totalPages: pageCount,
    }
  }

  /**
   * 获取战斗事件（单页，私有方法）
   */
  private async getEvents(
    reportCode: string,
    params: {
      start?: number
      end?: number
      lang?: string
    } = {}
  ): Promise<FFLogsEventsResponse> {
    const queryParams = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      )
    )

    const url = `${this.baseUrl}/events/${reportCode}?${queryParams}`

    try {
      const response = await fetchWithAuth(url)

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
    if (error instanceof Error) {
      if (error.message.includes('请求超时')) {
        return error
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
