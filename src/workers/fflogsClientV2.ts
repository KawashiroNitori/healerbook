/**
 * FFLogs v2 API 客户端
 * 真正的 API 调用逻辑，运行在 Worker 环境中
 */

import type {
  FFLogsV1Report,
  FFLogsEventsResponse,
  FFLogsEventDataType,
  FFLogsAbility,
  FFLogsEvent,
} from '@/types/fflogs'
import type { FFLogsV2Fight, FFLogsV2Actor, FFLogsV2Ability, FFLogsV2Phase } from '@/types/fflogs'
import { buildComposition } from '@/utils/rosterUtils'

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
}

/**
 * 遭遇战排行榜查询结果
 */
export interface EncounterRankingsResult {
  encounterName: string
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
   * 清除 token 缓存，强制下次获取新 token
   */
  private async invalidateToken(): Promise<void> {
    cachedToken = null
    tokenExpiresAt = 0
    if (this.kv) {
      await this.kv.delete(KV_TOKEN_KEY)
    }
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
      const kvData = (await this.kv.get(KV_TOKEN_KEY, 'json')) as {
        token: string
        expiresAt: number
      } | null
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

    const data = (await response.json()) as { access_token?: string; expires_in?: number }

    const accessToken = data.access_token
    if (!accessToken) {
      throw new Error('FFLogs OAuth: missing access_token in response')
    }

    const expiresIn = data.expires_in ?? 86400
    const expiresAt = now + expiresIn * 1000

    // 更新内存缓存
    cachedToken = accessToken
    tokenExpiresAt = expiresAt

    // 写入 KV（TTL 略短于 token 有效期）
    if (this.kv) {
      const ttl = Math.floor(expiresIn - 5 * 60)
      await this.kv.put(KV_TOKEN_KEY, JSON.stringify({ token: accessToken, expiresAt }), {
        expirationTtl: ttl > 0 ? ttl : 3600,
      })
    }

    return cachedToken
  }

  /**
   * 执行 GraphQL 查询
   */
  private async query<T = unknown>(
    query: string,
    variables: Record<string, unknown> = {},
    region: string = 'cn'
  ): Promise<T> {
    const graphqlUrl = `https://${region}.fflogs.com/api/v2/client`

    const doRequest = async (token: string) => {
      return fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query, variables }),
      })
    }

    let token = await this.getAccessToken()
    let response = await doRequest(token)

    // 401 时清除缓存的 token，重新获取后重试一次
    if (response.status === 401) {
      await this.invalidateToken()
      token = await this.getAccessToken()
      response = await doRequest(token)
    }

    if (!response.ok) {
      throw new Error(`FFLogs GraphQL error: ${response.statusText}`)
    }

    const result = (await response.json()) as {
      data?: T
      errors?: Array<{ message: string }>
    }

    // 检查 GraphQL 错误
    if (result.errors && result.errors.length > 0) {
      const errorMessage = result.errors.map(e => e.message).join(', ')
      throw new Error(errorMessage)
    }

    return result.data as T
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
            owner {
              name
            }
            phases {
              encounterID
              separatesWipes
              phases {
                id
                name
                isIntermission
              }
            }
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

    const data = (await this.query(query, { code: reportCode })) as {
      reportData: {
        report: {
          title: string
          startTime: number
          endTime: number
          fights: FFLogsV2Fight[]
          owner: { name: string }
          phases: FFLogsV2Phase[]
          masterData: {
            actors: FFLogsV2Actor[]
            abilities: FFLogsV2Ability[]
          }
        }
      }
    }
    const report = data.reportData.report

    // 转换为 v1 格式（保持接口一致性）
    return {
      title: report.title,
      owner: report.owner?.name ?? '',
      start: report.startTime,
      end: report.endTime,
      phases: report.phases,
      fights: report.fights.map(fight => ({
        id: fight.id,
        name: fight.name,
        difficulty: fight.difficulty ?? 0,
        kill: fight.kill || false,
        start_time: fight.startTime,
        end_time: fight.endTime,
        boss: fight.encounterID,
        zoneID: 0,
        zoneName: '',
        size: 8,
        hasEcho: false,
        bossPercentage: 0,
        fightPercentage: 0,
        lastPhaseForPercentageDisplay: 0,
      })),
      friendlies: report.masterData.actors.map(actor => ({
        id: actor.id,
        guid: actor.id,
        name: actor.name,
        type: actor.subType || actor.type,
        server: actor.server,
      })),
      abilities: report.masterData.abilities.map(ability => ({
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
   * 同时获取国际区和国区数据，合并后按 DPS 降序排序
   */
  async getEncounterRankings(params: { encounterId: number }): Promise<EncounterRankingsResult> {
    const { encounterId } = params

    const query = `
      query GetEncounterRankings($encounterId: Int!) {
        worldData {
          encounter(id: $encounterId) {
            name
            characterRankings(
              includeOtherPlayers: true
              metric: healercombinedrdps
            )
          }
        }
      }
    `

    // 并行获取国际区和国区数据
    const [wwwData, cnData] = await Promise.all([
      this.query(query, { encounterId }, 'www'),
      this.query(query, { encounterId }, 'cn'),
    ])

    const wwwEncounter = (
      wwwData as { worldData?: { encounter?: { name?: string; characterRankings?: unknown } } }
    )?.worldData?.encounter
    const cnEncounter = (
      cnData as { worldData?: { encounter?: { name?: string; characterRankings?: unknown } } }
    )?.worldData?.encounter
    const encounterName = wwwEncounter?.name || cnEncounter?.name || ''

    const wwwRankings = wwwEncounter?.characterRankings as
      | {
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
      | undefined

    const cnRankings = cnEncounter?.characterRankings as
      | {
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
      | undefined

    // 合并两个区域的数据
    const allRankings = [...(wwwRankings?.rankings || []), ...(cnRankings?.rankings || [])]

    // 转换为 RankingEntry 并过滤掉阵容为空的队伍
    const entries: RankingEntry[] = allRankings
      .map(r => {
        const composition = buildComposition((r.allCharacters ?? []).map(c => c.spec))
        return {
          rank: 0, // 稍后重新分配排名
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
          serverNameTwo: r.serverTwo?.name || r.server?.name || '',
          composition,
        }
      })
      .filter(entry => entry.composition.length > 0) // 过滤掉阵容为空的队伍
      .sort((a, b) => b.amount - a.amount) // 按 DPS 降序排序

    // 重新分配排名
    entries.forEach((entry, index) => {
      entry.rank = index + 1
    })

    return {
      encounterName,
      count: entries.length,
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
      'Debuffs',
      'Buffs',
    ]
    // const dataTypes: Array<string> = ['All']

    const query = `
      query GetEvents($code: String!, $startTime: Float, $endTime: Float, $dataType: EventDataType!, $hostilityType: HostilityType, $includeResources: Boolean, $limit: Int) {
        reportData {
          report(code: $code) {
            events(
              startTime: $startTime
              endTime: $endTime
              dataType: $dataType
              hostilityType: $hostilityType
              includeResources: $includeResources
              limit: $limit
            ) {
              data
              nextPageTimestamp
            }
          }
        }
      }
    `

    const RESOURCE_DATA_TYPES = new Set(['DamageTaken', 'Healing'])

    // 为某个类型 + hostilityType 组合获取所有分页数据
    const fetchAllEventsForType = async (
      dataType: string,
      hostilityType: 'Friendlies' | 'Enemies'
    ): Promise<FFLogsEvent[]> => {
      const events: FFLogsEvent[] = []
      let currentStart = start
      let hasMore = true

      while (hasMore) {
        const result = (await this.query(query, {
          code: reportCode,
          startTime: currentStart,
          endTime: end,
          dataType,
          hostilityType,
          includeResources: RESOURCE_DATA_TYPES.has(dataType),
          limit: 10000,
        })) as {
          reportData: {
            report: {
              events: {
                data: FFLogsEvent[]
                nextPageTimestamp?: number
              }
            }
          }
        }

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

    // Casts 同时请求友方与敌方（敌方用于 Boss 技能读条），其他类型仅请求友方
    const fetchTasks: Array<Promise<FFLogsEvent[]>> = dataTypes.flatMap(dataType => {
      if (dataType === 'Casts') {
        return [
          fetchAllEventsForType(dataType, 'Friendlies'),
          fetchAllEventsForType(dataType, 'Enemies'),
        ]
      }
      return [fetchAllEventsForType(dataType, 'Friendlies')]
    })

    // 并行获取所有类型的事件
    const results = await Promise.all(fetchTasks)

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
