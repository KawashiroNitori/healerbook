/**
 * FFLogs GraphQL API 客户端
 */

import { GraphQLClient } from 'graphql-request'
import type {
  FFLogsReport,
  FFLogsFight,
  FFLogsEvent,
  FFLogsGraphQLResponse,
} from '@/types/fflogs'

const FFLOGS_API_URL = 'https://www.fflogs.com/api/v2/client'

/**
 * FFLogs API 客户端配置
 */
export interface FFLogsClientConfig {
  /** API Token */
  apiToken: string
  /** API URL（可选，默认使用官方 API） */
  apiUrl?: string
  /** 请求超时时间（毫秒） */
  timeout?: number
}

/**
 * FFLogs API 客户端
 */
export class FFLogsClient {
  private client: GraphQLClient
  private config: Required<FFLogsClientConfig>

  constructor(config: FFLogsClientConfig) {
    this.config = {
      apiUrl: config.apiUrl || FFLOGS_API_URL,
      apiToken: config.apiToken,
      timeout: config.timeout || 30000,
    }

    this.client = new GraphQLClient(this.config.apiUrl, {
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
      },
      timeout: this.config.timeout,
    })
  }

  /**
   * 获取战斗报告
   */
  async getReport(reportCode: string): Promise<FFLogsReport> {
    const query = `
      query {
        reportData {
          report(code: "${reportCode}") {
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
          }
        }
      }
    `

    try {
      const response = await this.client.request<FFLogsGraphQLResponse>(query)

      if (response.errors) {
        throw new Error(`FFLogs API Error: ${response.errors[0].message}`)
      }

      return response.data.reportData.report
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * 获取指定战斗的伤害事件
   */
  async getDamageEvents(reportCode: string, fightId: number): Promise<FFLogsEvent[]> {
    const query = `
      query {
        reportData {
          report(code: "${reportCode}") {
            events(
              fightIDs: [${fightId}]
              dataType: DamageTaken
              limit: 10000
            ) {
              data
            }
          }
        }
      }
    `

    try {
      const response = await this.client.request<FFLogsGraphQLResponse>(query)

      if (response.errors) {
        throw new Error(`FFLogs API Error: ${response.errors[0].message}`)
      }

      return response.data.reportData.report.events.data
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * 获取战斗的小队阵容
   */
  async getComposition(reportCode: string, fightId: number) {
    const query = `
      query {
        reportData {
          report(code: "${reportCode}") {
            masterData {
              actors(type: "Player") {
                id
                name
                type
                subType
                server
              }
            }
            fights(fightIDs: [${fightId}]) {
              id
              friendlyPlayers
            }
          }
        }
      }
    `

    try {
      const response = await this.client.request<FFLogsGraphQLResponse>(query)

      if (response.errors) {
        throw new Error(`FFLogs API Error: ${response.errors[0].message}`)
      }

      return response.data.reportData.report
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * 搜索 TOP100 排名
   */
  async getTop100Rankings(encounterId: number, limit: number = 100) {
    const query = `
      query {
        worldData {
          encounter(id: ${encounterId}) {
            characterRankings(
              metric: hps
              size: ${limit}
            )
          }
        }
      }
    `

    try {
      const response = await this.client.request<FFLogsGraphQLResponse>(query)

      if (response.errors) {
        throw new Error(`FFLogs API Error: ${response.errors[0].message}`)
      }

      return response.data.worldData.encounter.characterRankings
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * 错误处理
   */
  private handleError(error: unknown): Error {
    if (error instanceof Error) {
      // 网络错误
      if (error.message.includes('fetch')) {
        return new Error('网络连接失败，请检查网络设置')
      }

      // 超时错误
      if (error.message.includes('timeout')) {
        return new Error('请求超时，请稍后重试')
      }

      // API 错误
      if (error.message.includes('401')) {
        return new Error('API Token 无效，请检查配置')
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

      return error
    }

    return new Error('未知错误')
  }
}

/**
 * 创建 FFLogs 客户端实例
 */
export function createFFLogsClient(apiToken: string): FFLogsClient {
  return new FFLogsClient({ apiToken })
}
