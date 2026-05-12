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

import { type GetReportParams, type GetEventsParams } from './fflogsClientV2'
import {
  syncAllTop100,
  getTop100KVKey,
  getStatisticsKVKey,
  handleGetEncounterTemplate,
  processOneSample,
  makeDefaultFetchExtracted,
  defaultLookupEncounterName,
  type Top100Data,
} from './top100Sync'
import { ALL_ENCOUNTERS } from '@/data/raidEncounters'
import type { FFLogsV1Report, FFLogsEventsResponse } from '@/types/fflogs'
import { handleAuthCallback, handleAuthRefresh } from './auth'
import { handleTimelines } from './timelines'
import { handleFFLogsImport } from './fflogsImportHandler'
import { enqueueRankings, validateEnqueueSamplesRequest } from './samplesQueue'

import { type Env, createClient } from './env'
export { type Env, createClient }

/**
 * 统一的 FFLogs 客户端接口
 */
export interface IFFLogsClient {
  getReport(params: GetReportParams): Promise<FFLogsV1Report>
  getEvents(params: GetEventsParams): Promise<FFLogsEventsResponse>
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
    } else if (
      path === '/api/timelines' ||
      path === '/api/my/timelines' ||
      path.match(/^\/api\/timelines\/[0-9A-Za-z]+$/)
    ) {
      return await handleTimelines(request, env)
    } else if (path === '/api/fflogs/import' && request.method === 'GET') {
      return await handleFFLogsImport(request, env)
    } else if (path.startsWith('/api/fflogs/report/')) {
      return await handleReport(request, env)
    } else if (path.startsWith('/api/fflogs/events/')) {
      return await handleEvents(request, env)
    } else if (path === '/api/top100') {
      return await handleTop100All(env)
    } else if (path === '/api/top100/sync' && request.method === 'POST') {
      return await handleManualSync(request, env)
    } else if (path === '/api/samples-queue/enqueue' && request.method === 'POST') {
      return await handleEnqueueSamples(request, env)
    } else if (path.startsWith('/api/top100/')) {
      return await handleTop100Encounter(request, env)
    } else if (path.startsWith('/api/statistics/')) {
      return await handleStatistics(request, env)
    } else if (path.startsWith('/api/encounter-templates/')) {
      return await handleEncounterTemplate(request, env)
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
 * Cron 定时任务：根据 event.cron 分发
 *
 * 新增 cron 时：在 wrangler.toml [triggers.crons] 加表达式，并在下面 switch 加 case。
 * 表达式字符串必须与 wrangler.toml 完全一致（含空格）。
 */
export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  switch (event.cron) {
    case '*/10 * * * *':
      ctx.waitUntil(runSampleTick(env))
      return
    case '0 */12 * * *':
      ctx.waitUntil(runTop100Sync(env))
      return
    default:
      console.error(`[Cron] 未知 cron 表达式: ${event.cron}`)
  }
}

async function runSampleTick(env: Env): Promise<void> {
  console.log('[Sample-tick] 启动')
  const client = createClient(env)
  const ranOnce = await processOneSample({
    db: env.healerbook_timelines,
    kv: env.healerbook,
    fetchExtracted: makeDefaultFetchExtracted(client),
    lookupEncounterName: defaultLookupEncounterName,
  })
  console.log(`[Sample-tick] 结束 (ranOnce=${ranOnce})`)
}

/**
 * 直接串行同步所有副本的 TOP100（每场 ~1-2s × ~9 场，总耗时在 Worker 30s 预算内）。
 * 单场失败由 syncAllTop100 内部 try/catch 隔离，不影响其他副本。
 */
async function runTop100Sync(env: Env): Promise<void> {
  console.log('[TOP100 Sync] 启动')
  const client = createClient(env)
  const result = await syncAllTop100(client, env.healerbook, env.healerbook_timelines)
  console.log(
    `[TOP100 Sync] 结束 (success=${result.success}, failed=${result.failed})` +
      (result.errors.length > 0 ? `, errors=${result.errors.join('; ')}` : '')
  )
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
 * GET /api/encounter-templates/:encounterId
 */
async function handleEncounterTemplate(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const encounterIdStr = url.pathname.replace('/api/encounter-templates/', '')
  const encounterId = parseInt(encounterIdStr, 10)

  if (isNaN(encounterId)) {
    return jsonResponse({ error: 'Invalid encounter ID' }, 400)
  }

  return handleGetEncounterTemplate(encounterId, env.healerbook)
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
 *
 * 同步执行（不返回直到 syncAllTop100 完成），便于手动触发后立即看结果。
 */
async function handleManualSync(request: Request, env: Env): Promise<Response> {
  if (!verifyAuth(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const client = createClient(env)
  const result = await syncAllTop100(client, env.healerbook, env.healerbook_timelines)
  return jsonResponse({
    message: `已完成同步：${result.success} 成功 / ${result.failed} 失败`,
    total: ALL_ENCOUNTERS.length,
    ...result,
  })
}

/**
 * 手动按 reportCode 批量入队 samples_queue
 * POST /api/samples-queue/enqueue
 * 需要 Authorization: Bearer <token>
 *
 * 请求体：{ encounterId, reportCodes: string[] }（reportCodes 最多 20 条）
 *
 * 处理流程：
 * 1. 并行拉每个 report
 * 2. 在 report.fights 中筛 boss === encounterId
 * 3. 选 duration（end_time - start_time）最长的那场入队（INSERT OR IGNORE）
 *
 * 单个 report 拉取失败 / 无匹配 fight 不会影响其他 report，会在响应里分别列出。
 */
async function handleEnqueueSamples(request: Request, env: Env): Promise<Response> {
  if (!verifyAuth(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const result = validateEnqueueSamplesRequest(raw)
  if (!result.success) {
    return jsonResponse({ error: 'Validation failed', details: formatIssues(result.issues) }, 400)
  }

  const { encounterId, reportCodes } = result.output
  const client = createClient(env)

  type Pick =
    | { reportCode: string; status: 'ok'; fightID: number; durationMs: number }
    | { reportCode: string; status: 'no-match' }
    | { reportCode: string; status: 'error'; message: string }

  const picks: Pick[] = await Promise.all(
    reportCodes.map(async (reportCode): Promise<Pick> => {
      try {
        const report = await client.getReport({ reportCode })
        const matching = report.fights.filter(f => f.boss === encounterId)
        if (matching.length === 0) {
          return { reportCode, status: 'no-match' }
        }
        // 优先在 kill 里挑最长；没有 kill 时退回所有 wipe 里挑最长
        const kills = matching.filter(f => f.kill)
        const pool = kills.length > 0 ? kills : matching
        const longest = pool.reduce((best, f) =>
          f.end_time - f.start_time > best.end_time - best.start_time ? f : best
        )
        return {
          reportCode,
          status: 'ok',
          fightID: longest.id,
          durationMs: longest.end_time - longest.start_time,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[Enqueue] getReport(${reportCode}) failed: ${message}`)
        return { reportCode, status: 'error', message }
      }
    })
  )

  const entries = picks
    .filter((p): p is Extract<Pick, { status: 'ok' }> => p.status === 'ok')
    .map(p => ({ reportCode: p.reportCode, fightID: p.fightID, durationMs: p.durationMs }))

  const { inserted } = await enqueueRankings(env.healerbook_timelines, encounterId, entries)

  return jsonResponse({
    received: reportCodes.length,
    matched: entries.length,
    inserted,
    skippedDuplicates: entries.length - inserted,
    noMatch: picks.filter(p => p.status === 'no-match').map(p => p.reportCode),
    errors: picks
      .filter((p): p is Extract<Pick, { status: 'error' }> => p.status === 'error')
      .map(p => ({ reportCode: p.reportCode, message: p.message })),
  })
}

function formatIssues(issues: readonly { path?: unknown; message: string }[]): string {
  return issues
    .slice(0, 5)
    .map(issue => {
      const path = Array.isArray(issue.path)
        ? (issue.path as { key: unknown }[]).map(p => String(p.key)).join('.')
        : ''
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
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
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  })
}

/**
 * JSON 响应辅助函数
 */
export function jsonResponse(
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
