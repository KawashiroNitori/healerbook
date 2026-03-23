/// <reference types="@cloudflare/workers-types" />

/**
 * FFLogs API 代理 Worker
 *
 * 用途：
 * 1. 隐藏 API Key 和 Client Secret，避免暴露到前端
 * 2. 添加缓存层，减少 API 调用
 * 3. 统一错误处理
 * 4. 对外提供统一接口，内部根据常量选择 v1 或 v2 API
 * 5. Cron 定时同步 TOP100 数据到 KV
 */

import { FFLogsClientV2, type GetReportParams, type GetEventsParams } from './fflogsClientV2'
import {
  syncEncounter,
  extractFightStatistics,
  getTop100KVKey,
  getStatisticsKVKey,
  type Top100Data,
} from './top100Sync'
import { ALL_ENCOUNTERS } from '@/data/raidEncounters'
import type { FFLogsV1Report, FFLogsEventsResponse } from '@/types/fflogs'

interface QueueMessageBody {
  type: string
  encounterId?: number
  reportCode?: string
  fightID?: number
}

export interface Env {
  // FFLogs v2 OAuth Client ID
  FFLOGS_CLIENT_ID?: string
  // FFLogs v2 OAuth Client Secret
  FFLOGS_CLIENT_SECRET?: string
  // 手动同步接口的鉴权密钥
  SYNC_AUTH_TOKEN?: string
  // KV 命名空间（对应 wrangler.toml 中 binding = "healerbook"）
  healerbook: KVNamespace
  // Queue 绑定
  TOP100_SYNC_QUEUE: Queue
  STATISTICS_EXTRACT_QUEUE: Queue
  // FFLogs 用户端 OAuth（Authorization Code Flow）
  FFLOGS_OAUTH_CLIENT_ID?: string
  FFLOGS_OAUTH_CLIENT_SECRET?: string
  FFLOGS_OAUTH_REDIRECT_URI?: string
  // JWT 签名密钥
  JWT_SECRET?: string
}

/**
 * 统一的 FFLogs 客户端接口
 */
export interface IFFLogsClient {
  getReport(params: GetReportParams): Promise<FFLogsV1Report>
  getEvents(params: GetEventsParams): Promise<FFLogsEventsResponse>
}

/**
 * 创建 FFLogs V2 客户端
 */
function createClient(env: Env): FFLogsClientV2 {
  if (!env.FFLOGS_CLIENT_ID || !env.FFLOGS_CLIENT_SECRET) {
    throw new Error('FFLogs v2 credentials not configured')
  }
  return new FFLogsClientV2({
    clientId: env.FFLOGS_CLIENT_ID,
    clientSecret: env.FFLOGS_CLIENT_SECRET,
    kv: env.healerbook,
  })
}

/**
 * HTTP 请求处理
 */
export async function handleFetch(request: Request, env: Env): Promise<Response> {
  // CORS 处理
  if (request.method === 'OPTIONS') {
    return handleCORS()
  }

  const url = new URL(request.url)
  const path = url.pathname

  try {
    if (path === '/api/auth/callback' && request.method === 'POST') {
      return await handleAuthCallback(request, env)
    } else if (path === '/api/auth/refresh' && request.method === 'POST') {
      return await handleAuthRefresh(request, env)
    } else if (path.startsWith('/api/fflogs/report/')) {
      return await handleReport(request, env)
    } else if (path.startsWith('/api/fflogs/events/')) {
      return await handleEvents(request, env)
    } else if (path === '/api/top100') {
      return await handleTop100All(env)
    } else if (path === '/api/top100/sync' && request.method === 'POST') {
      return await handleManualSync(request, env)
    } else if (path.startsWith('/api/top100/')) {
      return await handleTop100Encounter(request, env)
    } else if (path.startsWith('/api/statistics/')) {
      return await handleStatistics(request, env)
    } else {
      return jsonResponse({ error: 'Not Found' }, 404)
    }
  } catch (error) {
    console.error('Worker error:', error)
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      500
    )
  }
}

/**
 * Cron 定时任务：将所有遭遇战推送到队列
 * 触发频率见 wrangler.toml [triggers.crons]
 */
export async function handleScheduled(
  _event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  ctx.waitUntil(enqueueAllEncounters(env))
}

/**
 * Queue 消费者：处理队列消息
 */
export async function handleQueue(batch: MessageBatch, env: Env): Promise<void> {
  const client = createClient(env)

  for (const message of batch.messages) {
    try {
      const body = message.body as QueueMessageBody

      switch (body.type) {
        case 'sync-encounter': {
          // TOP100 同步任务
          const encounter = ALL_ENCOUNTERS.find(e => e.id === body.encounterId)
          if (!encounter) {
            console.error(`[Queue] 未找到遭遇战: ${body.encounterId}`)
            message.ack()
            continue
          }
          await syncEncounter(encounter, client, env.healerbook, env.STATISTICS_EXTRACT_QUEUE)
          break
        }

        case 'extract-statistics': {
          // 统计数据提取任务
          if (!body.encounterId || !body.reportCode || !body.fightID) {
            console.error('[Queue] 缺少必需参数')
            message.ack()
            continue
          }
          await extractFightStatistics(
            body.encounterId,
            body.reportCode,
            body.fightID,
            client,
            env.healerbook
          )
          break
        }

        default:
          console.error(`[Queue] 未知的消息类型: ${body.type}`)
          message.ack()
          continue
      }

      message.ack()
    } catch (err) {
      console.error(`[Queue] 处理失败:`, err)
      message.retry()
    }
  }
}

/**
 * 将所有遭遇战推送到队列
 */
async function enqueueAllEncounters(env: Env): Promise<void> {
  console.log('[TOP100 Sync] 开始推送任务到队列...')

  try {
    const messages = ALL_ENCOUNTERS.map(encounter => ({
      body: {
        type: 'sync-encounter',
        encounterId: encounter.id,
      },
    }))

    await env.TOP100_SYNC_QUEUE.sendBatch(messages)
    console.log(`[TOP100 Sync] 已推送 ${messages.length} 个任务到队列`)
  } catch (err) {
    console.error('[TOP100 Sync] 推送任务失败:', err)
  }
}

/**
 * 获取所有遭遇战的 TOP100 数据
 * GET /api/top100
 */
async function handleTop100All(env: Env): Promise<Response> {
  const results: Record<number, Top100Data | null> = {}

  await Promise.all(
    ALL_ENCOUNTERS.map(async encounter => {
      const data = await env.healerbook.get(getTop100KVKey(encounter.id), 'json')
      results[encounter.id] = data as Top100Data | null
    })
  )

  return jsonResponse(results)
}

/**
 * 获取单个遭遇战的 TOP100 数据
 * GET /api/top100/:encounterId
 */
async function handleTop100Encounter(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const encounterIdStr = url.pathname.replace('/api/top100/', '')
  const encounterId = parseInt(encounterIdStr, 10)

  if (isNaN(encounterId)) {
    return jsonResponse({ error: 'Invalid encounter ID' }, 400)
  }

  const data = await env.healerbook.get(getTop100KVKey(encounterId), 'json')

  if (!data) {
    return jsonResponse({ error: 'Data not available yet. Sync may be pending.' }, 404)
  }

  return jsonResponse(data)
}

/**
 * 获取单个遭遇战的统计数据
 * GET /api/statistics/:encounterId
 */
async function handleStatistics(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const encounterIdStr = url.pathname.replace('/api/statistics/', '')
  const encounterId = parseInt(encounterIdStr, 10)

  if (isNaN(encounterId)) {
    return jsonResponse({ error: 'Invalid encounter ID' }, 400)
  }

  const data = await env.healerbook.get(getStatisticsKVKey(encounterId), 'json')

  if (!data) {
    return jsonResponse({ error: 'Statistics not available yet. Sync may be pending.' }, 404)
  }

  return jsonResponse(data)
}

/**
 * 验证请求的 Authorization header
 * 期望格式: Authorization: Bearer <token>
 */
function verifyAuth(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization')

  if (!authHeader) {
    return false
  }

  const [scheme, token] = authHeader.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return false
  }

  // 如果未配置 SYNC_AUTH_TOKEN，拒绝所有请求
  if (!env.SYNC_AUTH_TOKEN) {
    console.warn('[Auth] SYNC_AUTH_TOKEN not configured')
    return false
  }

  return token === env.SYNC_AUTH_TOKEN
}

/**
 * 手动触发 TOP100 同步（POST /api/top100/sync）
 * 用于开发测试，生产中建议通过 Cron 触发
 * 需要 Authorization: Bearer <token> 鉴权
 */
async function handleManualSync(request: Request, env: Env): Promise<Response> {
  // 验证鉴权
  if (!verifyAuth(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  // 推送所有任务到队列
  await enqueueAllEncounters(env)
  return jsonResponse({ message: '已推送所有同步任务到队列', count: ALL_ENCOUNTERS.length })
}

/**
 * 处理报告请求（统一接口）
 * GET /api/fflogs/report/:reportCode
 */
async function handleReport(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const reportCode = url.pathname.split('/').pop()

  if (!reportCode) {
    return jsonResponse({ error: 'Missing report code' }, 400)
  }

  try {
    const client = createClient(env)
    const data = await client.getReport({ reportCode })
    return jsonResponse(data, 200)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
}

/**
 * 处理事件请求（统一接口）
 * GET /api/fflogs/events/:reportCode?start=0&end=1000&lang=cn
 */
async function handleEvents(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const reportCode = url.pathname.split('/').pop()

  if (!reportCode) {
    return jsonResponse({ error: 'Missing report code' }, 400)
  }

  const params = new URLSearchParams(url.search)
  const start = params.get('start')
  const end = params.get('end')
  const lang = params.get('lang') || undefined

  if (!start || !end) {
    return jsonResponse({ error: 'Missing start or end parameter' }, 400)
  }

  try {
    const client = createClient(env)
    const data = await client.getEvents({
      reportCode,
      start: parseFloat(start),
      end: parseFloat(end),
      lang,
    })
    return jsonResponse(data, 200)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
}

/**
 * CORS 处理
 */
function handleCORS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  })
}

/**
 * JSON 响应辅助函数
 */
function jsonResponse(
  data: unknown,
  status: number = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  })
}
