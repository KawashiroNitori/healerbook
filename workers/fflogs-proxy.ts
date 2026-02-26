/// <reference types="@cloudflare/workers-types" />

/**
 * FFLogs API 代理 Worker
 *
 * 用途：
 * 1. 隐藏 API Key 和 Client Secret，避免暴露到前端
 * 2. 添加缓存层，减少 API 调用
 * 3. 统一错误处理
 * 4. 对外提供统一接口，内部根据常量选择 v1 或 v2 API
 */

import { FFLogsClientV1, GetReportParams, GetEventsParams } from './fflogsClientV1'
import { FFLogsClientV2 } from './fflogsClientV2'
import type { FFLogsV1Report, FFLogsEventsResponse } from '../src/types/fflogs'

export interface Env {
  // FFLogs v1 API Key
  FFLOGS_API_KEY?: string
  // FFLogs v2 OAuth Client ID
  FFLOGS_CLIENT_ID?: string
  // FFLogs v2 OAuth Client Secret
  FFLOGS_CLIENT_SECRET?: string
  // KV 缓存（可选）
  FFLOGS_CACHE?: KVNamespace
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS 处理
    if (request.method === 'OPTIONS') {
      return handleCORS()
    }

    const url = new URL(request.url)
    const path = url.pathname

    try {
      // 统一路由处理（不暴露 v1/v2 差异）
      if (path.startsWith('/api/fflogs/report/')) {
        return await handleReport(request, env)
      } else if (path.startsWith('/api/fflogs/events/')) {
        return await handleEvents(request, env)
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
  if (env.FFLOGS_CACHE) {
    const cached = await env.FFLOGS_CACHE.get(cacheKey, 'json')
    if (cached) {
      return jsonResponse(cached, 200, { 'X-Cache': 'HIT', 'X-API-Version': USE_API_VERSION })
    }
  }

  try {
    const client = createClient(env)
    const data = await client.getReport({ reportCode })

    // 存入缓存
    if (env.FFLOGS_CACHE) {
      await env.FFLOGS_CACHE.put(cacheKey, JSON.stringify(data), {
        expirationTtl: CACHE_TTL,
      })
    }

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
  if (env.FFLOGS_CACHE) {
    const cached = await env.FFLOGS_CACHE.get(cacheKey, 'json')
    if (cached) {
      return jsonResponse(cached, 200, { 'X-Cache': 'HIT', 'X-API-Version': USE_API_VERSION })
    }
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
    if (env.FFLOGS_CACHE) {
      await env.FFLOGS_CACHE.put(cacheKey, JSON.stringify(data), {
        expirationTtl: CACHE_TTL,
      })
    }

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
  data: any,
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
