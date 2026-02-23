/**
 * FFLogs v1 API 客户端
 * 真正的 API 调用逻辑，运行在 Worker 环境中
 */

import type { FFLogsV1Report, FFLogsEventsResponse, FFLogsEventDataType } from '../src/types/fflogs'

export interface FFLogsV1Config {
  apiKey: string
}

/**
 * 获取报告参数（业务需要的）
 */
export interface GetReportParams {
  reportCode: string
}

/**
 * 获取事件参数（业务需要的）
 */
export interface GetEventsParams {
  reportCode: string
  start: number
  end: number
  lang?: string
  dataType?: FFLogsEventDataType[] // 可选，默认只获取 DamageTaken
}

export class FFLogsClientV1 {
  private apiKey: string

  constructor(config: FFLogsV1Config) {
    this.apiKey = config.apiKey
  }

  /**
   * 获取战斗报告
   */
  async getReport(params: GetReportParams): Promise<FFLogsV1Report> {
    const { reportCode } = params
    const apiUrl = 'https://www.fflogs.com/v1'
    const url = `${apiUrl}/report/fights/${reportCode}?api_key=${this.apiKey}`

    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`FFLogs API error: ${response.statusText}`)
    }

    return await response.json()
  }

  /**
   * 获取战斗事件
   */
  async getEvents(params: GetEventsParams): Promise<FFLogsEventsResponse> {
    const { reportCode, start, end, lang } = params

    // 构建查询参数
    const queryParams = new URLSearchParams()
    queryParams.set('start', String(start))
    queryParams.set('end', String(end))
    queryParams.set('translate', 'true')
    queryParams.set('api_key', this.apiKey)

    // 根据 lang 选择对应的 API 域名
    const subdomain = lang || 'www'
    const apiUrl = `https://${subdomain}.fflogs.com/v1`
    const url = `${apiUrl}/report/events/${reportCode}?${queryParams}`

    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`FFLogs API error: ${response.statusText}`)
    }

    return await response.json()
  }
}
