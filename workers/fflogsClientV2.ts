/**
 * FFLogs v2 API 客户端
 * 真正的 API 调用逻辑，运行在 Worker 环境中
 */

import type { FFLogsV1Report, FFLogsEventsResponse, FFLogsEventDataType, FFLogsAbility } from '../src/types/fflogs'

export interface FFLogsV2Config {
  clientId: string
  clientSecret: string
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
  dataType?: FFLogsEventDataType[]
}

/**
 * OAuth Token 缓存
 */
let cachedToken: string | null = null
let tokenExpiresAt: number = 0

export class FFLogsClientV2 {
  private clientId: string
  private clientSecret: string

  constructor(config: FFLogsV2Config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

  /**
   * 获取 Access Token
   */
  private async getAccessToken(): Promise<string> {
    // 检查缓存的 token 是否有效（提前 5 分钟刷新）
    const now = Date.now()
    if (cachedToken && tokenExpiresAt > now + 5 * 60 * 1000) {
      return cachedToken
    }

    // 使用 Client Credentials Flow 获取新 token
    const tokenUrl = 'https://www.fflogs.com/oauth/token'
    const credentials = btoa(`${this.clientId}:${this.clientSecret}`)

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })

    if (!response.ok) {
      throw new Error(`FFLogs OAuth error: ${response.statusText}`)
    }

    const data = await response.json()

    // 缓存 token
    cachedToken = data.access_token
    tokenExpiresAt = now + data.expires_in * 1000

    return cachedToken
  }

  /**
   * 执行 GraphQL 查询
   */
  private async query<T = any>(query: string, variables: Record<string, any> = {}): Promise<T> {
    const token = await this.getAccessToken()
    const graphqlUrl = 'https://cn.fflogs.com/api/v2/client'

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    })

    if (!response.ok) {
      throw new Error(`FFLogs GraphQL error: ${response.statusText}`)
    }

    const result = await response.json()

    // 检查 GraphQL 错误
    if (result.errors && result.errors.length > 0) {
      const errorMessage = result.errors.map((e: any) => e.message).join(', ')
      throw new Error(errorMessage)
    }

    return result.data
  }

  /**
   * 获取战斗报告
   */
  async getReport(params: GetReportParams): Promise<FFLogsV1Report> {
    const { reportCode } = params

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
              abilities {
                gameID
                icon
                name
                type
              }
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

    const data = await this.query(query, { code: reportCode })
    const report = data.reportData.report

    // 转换为 v1 格式（保持接口一致性）
    return {
      title: report.title,
      start: report.startTime,
      end: report.endTime,
      fights: report.fights.map((fight: any) => ({
        id: fight.id,
        name: fight.name,
        difficulty: fight.difficulty,
        kill: fight.kill || false,
        start_time: fight.startTime,
        end_time: fight.endTime,
        boss: fight.encounterID,
      })),
      friendlies: report.masterData.actors.map((actor: any) => ({
        id: actor.id,
        guid: actor.id,
        name: actor.name,
        type: actor.subType || actor.type,
        server: actor.server,
      })),
      abilities: report.masterData.abilities.map((ability: any) => ({
        gameID: ability.gameID,
        name: ability.name,
        type: ability.type,
        icon: ability.icon,
      })) as FFLogsAbility[],
    }
  }

  /**
   * 获取战斗事件
   * 并行获取多种类型的完整事件：Buffs, Debuffs, Casts, DamageTaken
   * 自动处理每种类型的分页
   */
  async getEvents(params: GetEventsParams): Promise<FFLogsEventsResponse> {
    const { reportCode, start, end } = params

    // 为每种类型单独查询，并自动处理分页
    const dataTypes: Array<'Buffs' | 'Debuffs' | 'Casts' | 'DamageTaken'> = [
      'Buffs',
      'Debuffs',
      'Casts',
      'DamageTaken',
    ]

    const query = `
      query GetEvents($code: String!, $startTime: Float, $endTime: Float, $dataType: EventDataType!, $limit: Int) {
        reportData {
          report(code: $code) {
            events(
              startTime: $startTime
              endTime: $endTime
              dataType: $dataType
              limit: $limit
            ) {
              data
              nextPageTimestamp
            }
          }
        }
      }
    `

    // 为每种类型获取所有分页数据的函数
    const fetchAllEventsForType = async (dataType: string): Promise<any[]> => {
      const events: any[] = []
      let currentStart = start
      let hasMore = true

      while (hasMore) {
        const result = await this.query(query, {
          code: reportCode,
          startTime: currentStart,
          endTime: end,
          dataType,
          limit: 10000,
        })

        const eventsData = result.reportData.report.events
        events.push(...eventsData.data)

        // 检查是否有下一页
        if (eventsData.nextPageTimestamp && eventsData.nextPageTimestamp < end) {
          currentStart = eventsData.nextPageTimestamp
        } else {
          hasMore = false
        }
      }

      return events
    }

    // 并行获取所有类型的事件
    const results = await Promise.all(dataTypes.map((dataType) => fetchAllEventsForType(dataType)))

    // 合并所有事件
    const allEvents = results.flat()

    // 按时间戳排序
    allEvents.sort((a, b) => a.timestamp - b.timestamp)

    return {
      events: allEvents,
      nextPageTimestamp: undefined, // 已获取完整数据，无需分页
    }
  }
}
