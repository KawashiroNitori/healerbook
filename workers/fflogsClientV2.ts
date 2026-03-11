/**
 * FFLogs v2 API 客户端
 * 真正的 API 调用逻辑，运行在 Worker 环境中
 */

import type { FFLogsV1Report, FFLogsEventsResponse, FFLogsEventDataType, FFLogsAbility } from '../src/types/fflogs'
import { buildComposition, buildMitigationKey } from './rosterUtils'

export interface FFLogsV2Config {
  clientId: string
  clientSecret: string
  kv?: KVNamespace
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
 * 排行榜单条目
 */
export interface RankingEntry {
  rank: number
  characterName: string
  jobClass: string
  characterNameTwo: string
  jobClassTwo: string
  /** 合计 DPS（healercombineddps） */
  amount: number
  /** 战斗时长（毫秒） */
  duration: number
  reportCode: string
  fightID: number
  startTime: number
  serverName: string
  serverRegion: string
  serverNameTwo: string
  /** 按标准职业顺序排列的完整阵容职业代码列表 */
  composition: string[]
  /** 阵容内所有减伤技能 ID 升序排列，用 - 连接（隐藏字段，用于分组/筛选） */
  mitigationKey: string
}

/**
 * 遭遇战排行榜查询结果
 */
export interface EncounterRankingsResult {
  encounterName: string
  page: number
  hasMorePages: boolean
  count: number
  entries: RankingEntry[]
}

/**
 * OAuth Token 缓存（内存，Worker 重启后失效）
 */
let cachedToken: string | null = null
let tokenExpiresAt: number = 0

const KV_TOKEN_KEY = 'fflogs:oauth_token'

export class FFLogsClientV2 {
  private clientId: string
  private clientSecret: string
  private kv?: KVNamespace

  constructor(config: FFLogsV2Config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.kv = config.kv
  }

  /**
   * 获取 Access Token（优先从 KV 读取，其次内存缓存）
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now()

    // 1. 检查内存缓存
    if (cachedToken && tokenExpiresAt > now + 5 * 60 * 1000) {
      return cachedToken
    }

    // 2. 检查 KV 缓存
    if (this.kv) {
      const kvData = await this.kv.get(KV_TOKEN_KEY, 'json') as { token: string; expiresAt: number } | null
      if (kvData && kvData.expiresAt > now + 5 * 60 * 1000) {
        cachedToken = kvData.token
        tokenExpiresAt = kvData.expiresAt
        return cachedToken
      }
    }

    // 3. 获取新 token
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

    const accessToken = data.access_token as string | undefined
    if (!accessToken) {
      throw new Error('FFLogs OAuth: missing access_token in response')
    }

    const expiresAt = now + (data.expires_in as number) * 1000

    // 更新内存缓存
    cachedToken = accessToken
    tokenExpiresAt = expiresAt

    // 写入 KV（TTL 略短于 token 有效期）
    if (this.kv) {
      const ttl = Math.floor((data.expires_in as number) - 5 * 60)
      await this.kv.put(KV_TOKEN_KEY, JSON.stringify({ token: accessToken, expiresAt }), {
        expirationTtl: ttl > 0 ? ttl : 3600,
      })
    }

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
   * 获取遭遇战治疗角色排行（TOP100）
   *
   * 使用 HPS（每秒治疗量）指标，自然筛选出治疗职业排名
   * 每页最多 100 条记录
   */
  async getEncounterRankings(params: {
    encounterId: number
    difficulty: number
    page?: number
  }): Promise<EncounterRankingsResult> {
    const { encounterId, page = 1 } = params

    const query = `
      query GetEncounterRankings($encounterId: Int!, $page: Int) {
        worldData {
          encounter(id: $encounterId) {
            name
            characterRankings(
              includeOtherPlayers: true
              metric: healercombinedrdps
              page: $page
            )
          }
        }
      }
    `

    const data = await this.query(query, { encounterId, page })
    const encounter = data.worldData.encounter
    const rankings = encounter.characterRankings as {
      page: number
      hasMorePages: boolean
      count: number
      rankings: Array<{
        name: string
        spec: string
        nameTwo: string
        specTwo: string
        amount: number
        duration: number
        report: { code: string; fightID: number; startTime: number }
        server?: { name: string; region?: string }
        serverTwo?: { name: string }
        allCharacters?: Array<{ name: string; spec: string }>
      }>
    }

    const entries: RankingEntry[] = []
    if (rankings?.rankings) {
      for (let i = 0; i < rankings.rankings.length; i++) {
        const r = rankings.rankings[i]
        entries.push({
          rank: (page - 1) * 100 + i + 1,
          characterName: r.name || '',
          jobClass: r.spec || '',
          characterNameTwo: r.nameTwo || '',
          jobClassTwo: r.specTwo || '',
          amount: r.amount || 0,
          duration: r.duration || 0,
          reportCode: r.report?.code || '',
          fightID: r.report?.fightID || 0,
          startTime: r.report?.startTime || 0,
          serverName: r.server?.name || '',
          serverRegion: r.server?.region || '',
          // serverTwo 缺失时，说明两个玩家在同一服务器
          serverNameTwo: r.serverTwo?.name || r.server?.name || '',
          composition: buildComposition((r.allCharacters ?? []).map((c) => c.spec)),
          mitigationKey: buildMitigationKey(
            buildComposition((r.allCharacters ?? []).map((c) => c.spec))
          ),
        })
      }
    }

    return {
      encounterName: encounter.name || '',
      page: rankings?.page ?? page,
      hasMorePages: rankings?.hasMorePages ?? false,
      count: rankings?.count ?? entries.length,
      entries,
    }
  }

  /**
   * 获取战斗事件
   * 并行获取多种类型的完整事件：Buffs, Debuffs, Casts, DamageTaken, Healing
   * 自动处理每种类型的分页
   */
  async getEvents(params: GetEventsParams): Promise<FFLogsEventsResponse> {
    const { reportCode, start, end } = params

    // 为每种类型单独查询，并自动处理分页
    const dataTypes: Array<string> = [
      'Casts',
      'DamageTaken',
      'Healing',
      'CombatantInfo',
    ]

    const query = `
      query GetEvents($code: String!, $startTime: Float, $endTime: Float, $dataType: EventDataType!, $limit: Int) {
        reportData {
          report(code: $code) {
            events(
              startTime: $startTime
              endTime: $endTime
              dataType: $dataType
              includeResources: true
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
