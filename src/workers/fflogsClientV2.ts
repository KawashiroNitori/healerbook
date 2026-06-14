/**
 * FFLogs v2 API 客户端
 * 真正的 API 调用逻辑，运行在 Worker 环境中
 */

import type {
  FFLogsReport,
  FFLogsEventsResponse,
  FFLogsEventDataType,
  FFLogsEvent,
} from '@/types/fflogs'
import type { FFLogsV2Fight, FFLogsV2Actor, FFLogsV2Ability } from '@/types/fflogs'
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

/** getReport 的 GraphQL 响应中 reportData.report 的结构 */
interface V2ReportPayload {
  title: string
  startTime: number
  endTime: number
  fights: FFLogsV2Fight[]
  masterData: {
    actors: FFLogsV2Actor[]
    enemyActors: FFLogsV2Actor[]
    abilities: FFLogsV2Ability[]
  }
}

/**
 * 把 getReport 的 V2 响应直接映射为应用内的 FFLogsReport。导出以便单测。
 *
 * 敌方 actor 用 `subType || type` 派生 type：FFLogs 中 boss 为
 * `type:"NPC"` + `subType:"Boss"`，映射后 type="Boss"，使 buildBossIds 的 'Boss'
 * 判定命中（已对真实 API 验证：subType 字面值确为 "Boss"，普通小怪为 "NPC"）。
 */
export function mapV2ReportToReport(report: V2ReportPayload, reportCode: string): FFLogsReport {
  const toActor = (actor: FFLogsV2Actor) => ({
    id: actor.id,
    guid: actor.id,
    name: actor.name,
    type: actor.subType || actor.type,
    server: actor.server,
  })
  return {
    code: reportCode,
    title: report.title || '未命名报告',
    startTime: report.startTime,
    endTime: report.endTime,
    fights: report.fights.map(fight => ({
      id: fight.id,
      name: fight.name,
      difficulty: fight.difficulty ?? 0,
      kill: fight.kill || false,
      startTime: fight.startTime,
      endTime: fight.endTime,
      encounterID: fight.encounterID,
      gameZoneId: fight.gameZone?.id != null ? Math.floor(fight.gameZone.id) : undefined,
    })),
    friendlies: report.masterData.actors.map(toActor),
    enemies: (report.masterData.enemyActors ?? []).map(toActor),
    abilities: report.masterData.abilities.map(ability => ({
      gameID: ability.gameID,
      name: ability.name,
      type: ability.type,
      icon: ability.icon,
    })),
  }
}

/** 单条事件抓取参数 */
export type FetchSpec = {
  dataType: string
  hostilityType?: 'Friendlies' | 'Enemies'
  includeResources?: boolean
  /** 单页请求条数，默认 10000 */
  limit?: number
  /** 只取首页、不翻页（用于锚点类小请求） */
  singlePage?: boolean
  /** 仅保留该 type 的事件（其余丢弃，避免与其他 spec 重复） */
  filterType?: string
  /** FFLogs 服务端过滤表达式（如 type="targetabilityupdate"），让服务端只回匹配事件 */
  filterExpression?: string
}

/**
 * 事件抓取矩阵（每条一种类型，自动分页）：
 * - Casts 额外追加一条 Enemies 请求（Boss 技能读条）
 * - DamageTaken / Healing 需 includeResources 拿玩家资源快照
 * - limitbreakupdate：仅首页锚点（零时间）
 * - targetabilityupdate：全程分页，但服务端 filterExpression 过滤后返回量极小；
 *   用于导入期重建敌方可选中区间（目标减无效判定）
 *
 * 注：limitbreakupdate / targetabilityupdate 的 filterType 仅作客户端二次过滤（双保险），
 * 服务端 filterExpression 才是返回量收敛的主手段——勿因"有 filterType"而去掉 filterExpression。
 */
export const EVENT_FETCH_SPECS: FetchSpec[] = [
  { dataType: 'Casts' },
  { dataType: 'Casts', hostilityType: 'Enemies' },
  { dataType: 'DamageTaken', includeResources: true },
  { dataType: 'Healing', includeResources: true },
  { dataType: 'CombatantInfo' },
  { dataType: 'Debuffs' },
  { dataType: 'Buffs' },
  { dataType: 'All', limit: 200, singlePage: true, filterType: 'limitbreakupdate' },
  // 【临时屏蔽】targetabilityupdate 抓取（dataType:'All' 全程分页）。实测此条 spec 会让
  // 单场导入的 FFLogs 请求数显著增多，触发大量 429 限流。在限流方案落地前先停掉——下游
  // buildTargetabilityIntervals 拿不到此类事件时区间为空、isTargetableAt 默认可选中，目标减
  // 无效判定优雅退化为仅按"来源非 Boss"判断，不会报错。恢复时取消下面整段注释即可。
  // {
  //   // 不设 hostilityType：dataType:'All' + filterExpression 下，targetabilityupdate 事件不受
  //   // hostilityType 影响——默认 'Friendlies' 与 'Enemies' 均返回全量敌方可选中事件（已对真实
  //   // 报告核验：Friendlies/Enemies/省略三者条数一致），故沿用默认即可，勿改成 'Enemies'。
  //   dataType: 'All',
  //   filterExpression: 'type="targetabilityupdate"',
  //   filterType: 'targetabilityupdate',
  // },
]

/**
 * getEvents 抓取各 spec 时的最大在途 FFLogs 请求数。
 *
 * 此前 getEvents 用 Promise.all 一次性并发全部 EVENT_FETCH_SPECS（9 条），单场导入瞬时
 * 打满 9 路 GraphQL 请求，易触发 FFLogs 点数限流（429）。改用有界并发池后峰值锁定在此值。
 */
export const EVENT_FETCH_CONCURRENCY = 4

/**
 * 有界并发 map：对 items 逐个跑 fn，任意时刻在途任务数不超过 limit，结果按输入顺序返回。
 *
 * worker 池共享一个递增游标，空出 slot 立刻领取下一个 item，因此快慢任务混合时利用率高于
 * 固定分批。limit 会被夹到 [1, items.length]，空数组直接返回空数组。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

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
  async getReport(params: GetReportParams): Promise<FFLogsReport> {
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
              gameZone {
                id
              }
            }
            masterData(translate: false) {
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
              enemyActors: actors(type: "NPC") {
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
      reportData: { report: V2ReportPayload }
    }
    return mapV2ReportToReport(data.reportData.report, reportCode)
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

    const query = `
      query GetEvents($code: String!, $startTime: Float, $endTime: Float, $dataType: EventDataType!, $hostilityType: HostilityType, $includeResources: Boolean, $limit: Int, $filterExpression: String) {
        reportData {
          report(code: $code) {
            events(
              startTime: $startTime
              endTime: $endTime
              dataType: $dataType
              hostilityType: $hostilityType
              translate: false
              includeResources: $includeResources
              limit: $limit
              filterExpression: $filterExpression
            ) {
              data
              nextPageTimestamp
            }
          }
        }
      }
    `

    // 按给定参数抓取一条类型的全部分页数据
    const fetchAllEventsForSpec = async (spec: FetchSpec): Promise<FFLogsEvent[]> => {
      const events: FFLogsEvent[] = []
      let currentStart = start
      let hasMore = true

      while (hasMore) {
        const result = (await this.query(query, {
          code: reportCode,
          startTime: currentStart,
          endTime: end,
          dataType: spec.dataType,
          hostilityType: spec.hostilityType ?? 'Friendlies',
          includeResources: spec.includeResources ?? false,
          limit: spec.limit ?? 10000,
          filterExpression: spec.filterExpression ?? null,
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

        // 检查是否有下一页（singlePage 锚点请求只取首页）
        if (
          !spec.singlePage &&
          eventsData.nextPageTimestamp &&
          eventsData.nextPageTimestamp < end
        ) {
          currentStart = eventsData.nextPageTimestamp
        } else {
          hasMore = false
        }
      }

      return spec.filterType ? events.filter(e => e.type === spec.filterType) : events
    }

    // 有界并发抓取所有 spec 的事件（含 limitbreakupdate 锚点）。
    // 限制在途请求数，避免单场导入瞬时打满 9 路 GraphQL 触发 FFLogs 限流。
    const results = await mapWithConcurrency(
      EVENT_FETCH_SPECS,
      EVENT_FETCH_CONCURRENCY,
      fetchAllEventsForSpec
    )

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
