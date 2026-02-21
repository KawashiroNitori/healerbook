/**
 * FFLogs API 代理 Worker
 *
 * 用途：
 * 1. 隐藏 API Key，避免暴露到前端
 * 2. 添加缓存层，减少 API 调用
 * 3. 统一错误处理
 */

export interface Env {
  // FFLogs API Key（在 Cloudflare Workers 环境变量中配置）
  FFLOGS_API_KEY: string
  // KV 缓存（可选）
  FFLOGS_CACHE?: KVNamespace
}

const CACHE_TTL = 3600 // 1 小时缓存

/**
 * 根据 lang 获取对应的 API 域名
 * - 如果 lang 存在，使用 {lang}.fflogs.com
 * - 如果 lang 为空，使用 www.fflogs.com
 */
function getApiUrl(lang?: string): string {
  const subdomain = lang || 'www'
  return `https://${subdomain}.fflogs.com/v1`
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
      // 路由处理
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
 * 处理报告请求
 * GET /api/fflogs/report/:reportCode
 */
async function handleReport(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const reportCode = url.pathname.split('/').pop()

  if (!reportCode) {
    return jsonResponse({ error: 'Missing report code' }, 400)
  }

  // 检查缓存
  const cacheKey = `report:${reportCode}`
  if (env.FFLOGS_CACHE) {
    const cached = await env.FFLOGS_CACHE.get(cacheKey, 'json')
    if (cached) {
      return jsonResponse(cached, 200, { 'X-Cache': 'HIT' })
    }
  }

  // 调用 FFLogs API（使用默认域名）
  const apiUrl = getApiUrl()
  const fflogsUrl = `${apiUrl}/report/fights/${reportCode}?api_key=${env.FFLOGS_API_KEY}`
  console.log(fflogsUrl)
  const response = await fetch(fflogsUrl)

  if (!response.ok) {
    return jsonResponse(
      { error: `FFLogs API error: ${response.statusText}` },
      response.status
    )
  }

  const data = await response.json()

  // 存入缓存
  if (env.FFLOGS_CACHE) {
    await env.FFLOGS_CACHE.put(cacheKey, JSON.stringify(data), {
      expirationTtl: CACHE_TTL,
    })
  }

  return jsonResponse(data, 200, { 'X-Cache': 'MISS' })
}

/**
 * 处理事件请求
 * GET /api/fflogs/events/:reportCode?start=0&end=1000&lang=cn&...
 */
async function handleEvents(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const reportCode = url.pathname.split('/').pop()

  if (!reportCode) {
    return jsonResponse({ error: 'Missing report code' }, 400)
  }

  // 构建查询参数
  const params = new URLSearchParams(url.search)

  // 提取 lang 参数
  const lang = params.get('lang') || undefined

  // 移除 lang 参数（不传给 FFLogs API）
  params.delete('lang')

  // 固定添加 translate=true
  params.set('translate', 'true')

  // 添加 API Key
  params.set('api_key', env.FFLOGS_API_KEY)

  // 检查缓存
  const cacheKey = `events:${reportCode}:${params.toString()}`
  if (env.FFLOGS_CACHE) {
    const cached = await env.FFLOGS_CACHE.get(cacheKey, 'json')
    if (cached) {
      return jsonResponse(cached, 200, { 'X-Cache': 'HIT' })
    }
  }

  // 根据 lang 选择对应的 API 域名
  const apiUrl = getApiUrl(lang)
  const fflogsUrl = `${apiUrl}/report/events/${reportCode}?${params}`
  console.log(fflogsUrl)
  const response = await fetch(fflogsUrl)

  if (!response.ok) {
    return jsonResponse(
      { error: `FFLogs API error: ${response.statusText}` },
      response.status
    )
  }

  const data = await response.json()

  // 存入缓存
  if (env.FFLOGS_CACHE) {
    await env.FFLOGS_CACHE.put(cacheKey, JSON.stringify(data), {
      expirationTtl: CACHE_TTL,
    })
  }

  return jsonResponse(data, 200, { 'X-Cache': 'MISS' })
}

/**
 * CORS 处理
 */
function handleCORS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
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
