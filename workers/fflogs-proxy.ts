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

import { FFLogsClientV1, type GetReportParams, type GetEventsParams } from './fflogsClientV1'
import { FFLogsClientV2 } from './fflogsClientV2'
import { syncAllTop100, getTop100KVKey, type Top100Data } from './top100Sync'
import { ALL_ENCOUNTERS } from '../src/data/raidEncounters'
import type { FFLogsV1Report, FFLogsEventsResponse } from '../src/types/fflogs'

export interface Env {
  // FFLogs v1 API Key
  FFLOGS_API_KEY?: string
  // FFLogs v2 OAuth Client ID
  FFLOGS_CLIENT_ID?: string
  // FFLogs v2 OAuth Client Secret
  FFLOGS_CLIENT_SECRET?: string
  // KV 命名空间（对应 wrangler.toml 中 binding = "healerbook"）
  healerbook: KVNamespace
}

const CACHE_TTL = 3600 // 1 小时缓存

// API 版本选择（硬编码常量）
const USE_API_VERSION: 'v1' | 'v2' = 'v2' // 修改此常量来切换 API 版本

/**
 * 统一的 FFLogs 客户端接口
 */
export interface IFFLogsClient {
  getReport(params: GetReportParams): Promise<FFLogsV1Report>
  getEvents(params: GetEventsParams): Promise<FFLogsEventsResponse>
}

/**
 * 创建 FFLogs 客户端实例
 * 根据 USE_API_VERSION 常量选择 v1 或 v2 客户端
 */
function createClient(env: Env): IFFLogsClient {
  if (USE_API_VERSION === 'v2') {
    if (!env.FFLOGS_CLIENT_ID || !env.FFLOGS_CLIENT_SECRET) {
      throw new Error('FFLogs v2 credentials not configured')
    }
    return new FFLogsClientV2({
      clientId: env.FFLOGS_CLIENT_ID,
      clientSecret: env.FFLOGS_CLIENT_SECRET,
    })
  } else {
    if (!env.FFLOGS_API_KEY) {
      throw new Error('FFLogs v1 API key not configured')
    }
    return new FFLogsClientV1({ apiKey: env.FFLOGS_API_KEY })
  }
}

/**
 * 创建 FFLogs V2 客户端（用于 TOP100 同步，仅支持 v2）
 */
function createV2Client(env: Env): FFLogsClientV2 {
  if (!env.FFLOGS_CLIENT_ID || !env.FFLOGS_CLIENT_SECRET) {
    throw new Error('FFLogs v2 credentials not configured')
  }
  return new FFLogsClientV2({
    clientId: env.FFLOGS_CLIENT_ID,
    clientSecret: env.FFLOGS_CLIENT_SECRET,
  })
}

export default {
  /**
   * HTTP 请求处理
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS 处理
    if (request.method === 'OPTIONS') {
      return handleCORS()
    }

    const url = new URL(request.url)
    const path = url.pathname

    try {
      if (path.startsWith('/api/fflogs/report/')) {
        return await handleReport(request, env)
      } else if (path.startsWith('/api/fflogs/events/')) {
        return await handleEvents(request, env)
      } else if (path === '/api/top100') {
        return await handleTop100All(env)
      } else if (path === '/api/top100/sync' && request.method === 'POST') {
        // 手动触发同步（仅用于测试/管理）—— 必须在 startsWith 之前检查
        return await handleManualSync(env)
      } else if (path.startsWith('/api/top100/')) {
        return await handleTop100Encounter(request, env)
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
  },

  /**
   * Cron 定时任务：同步 TOP100 数据
   * 触发频率见 wrangler.toml [triggers.crons]
   */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runTop100Sync(env))
  },
}

/**
 * 执行 TOP100 同步
 */
async function runTop100Sync(env: Env): Promise<void> {
  console.log('[TOP100 Sync] 开始同步...')

  try {
    const client = createV2Client(env)
    const result = await syncAllTop100(client, env.healerbook)
    console.log(
      `[TOP100 Sync] 完成: 成功=${result.success}, 失败=${result.failed}`,
      result.errors.length > 0 ? `错误: ${result.errors.join('; ')}` : ''
    )
  } catch (err) {
    console.error('[TOP100 Sync] 同步失败:', err)
  }
}

/**
 * 获取所有遭遇战的 TOP100 数据
 * GET /api/top100
 */
async function handleTop100All(env: Env): Promise<Response> {
  const results: Record<number, Top100Data | null> = {}

  await Promise.all(
    ALL_ENCOUNTERS.map(async (encounter) => {
      const data = await env.healerbook.get(getTop100KVKey(encounter.id), 'json')
      results[encounter.id] = (data as Top100Data | null)
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
 * 手动触发 TOP100 同步（POST /api/top100/sync）
 * 用于开发测试，生产中建议通过 Cron 触发
 */
async function handleManualSync(env: Env): Promise<Response> {
  // 异步执行同步，立即返回响应
  const client = createV2Client(env)
  const result = await syncAllTop100(client, env.healerbook)
  return jsonResponse({ message: '同步完成', ...result })
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

  // 检查缓存
  const cacheKey = `report:${USE_API_VERSION}:${reportCode}`
  const cached = await env.healerbook.get(cacheKey, 'json')
  if (cached) {
    return jsonResponse(cached, 200, { 'X-Cache': 'HIT', 'X-API-Version': USE_API_VERSION })
  }

  try {
    const client = createClient(env)
    const data = await client.getReport({ reportCode })

    // 存入缓存
    await env.healerbook.put(cacheKey, JSON.stringify(data), {
      expirationTtl: CACHE_TTL,
    })

    return jsonResponse(data, 200, { 'X-Cache': 'MISS', 'X-API-Version': USE_API_VERSION })
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
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

  // 检查缓存
  const cacheKey = `events:${USE_API_VERSION}:${reportCode}:${params.toString()}`
  const cached = await env.healerbook.get(cacheKey, 'json')
  if (cached) {
    return jsonResponse(cached, 200, { 'X-Cache': 'HIT', 'X-API-Version': USE_API_VERSION })
  }

  try {
    const client = createClient(env)
    const data = await client.getEvents({
      reportCode,
      start: parseFloat(start),
      end: parseFloat(end),
      lang,
    })

    // 存入缓存
    await env.healerbook.put(cacheKey, JSON.stringify(data), {
      expirationTtl: CACHE_TTL,
    })

    return jsonResponse(data, 200, { 'X-Cache': 'MISS', 'X-API-Version': USE_API_VERSION })
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
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
