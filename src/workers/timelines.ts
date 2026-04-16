/// <reference types="@cloudflare/workers-types" />

import type { Env } from './fflogs-proxy'
import { verifyToken } from './jwt'
import { generateId } from '@/utils/id'
import { validateCreateRequest, validateUpdateRequest } from './timelineSchema'

/** 格式化 Valibot 校验错误为可读字符串 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatIssues(issues: readonly any[]): string {
  return issues
    .slice(0, 5)
    .map(issue => {
      const path = issue.path?.map((p: { key: unknown }) => String(p.key)).join('.') ?? ''
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

// D1 timelines 表的行结构
interface DbRow {
  id: string
  name: string
  author_id: string
  author_name: string
  published_at: number
  updated_at: number
  version: number
  content: string
}

// 对外暴露的完整时间轴（含 authorId，GET 时会剥离）
interface SharedTimeline {
  id: string
  name: string
  authorId: string
  authorName: string
  publishedAt: number
  updatedAt: number
  version: number
  [key: string]: unknown
}

function jsonRes(data: unknown, status: number, allowedOrigin?: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin ?? '*',
    },
  })
}

async function getAuthUserId(
  request: Request,
  env: Env
): Promise<{ userId: string; username: string } | null> {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  if (!env.JWT_SECRET) return null
  const result = await verifyToken(token, env.JWT_SECRET)
  if (!result.ok) return null
  const sub = result.payload.sub
  const name = (result.payload as { name?: string }).name ?? ''
  if (!sub) return null
  return { userId: sub, username: name }
}

/**
 * 将 D1 行合并还原为 SharedTimeline。
 * 结构化列优先，覆盖 content 中可能残留的同名字段。
 */
function rowToSharedTimeline(row: DbRow): SharedTimeline {
  const content = JSON.parse(row.content) as Record<string, unknown>
  return {
    ...content,
    id: row.id,
    name: row.name,
    authorId: row.author_id,
    authorName: row.author_name,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    version: row.version,
  }
}

async function handlePost(request: Request, env: Env): Promise<Response> {
  const auth = await getAuthUserId(request, env)
  if (!auth) return jsonRes({ error: 'Unauthorized' }, 401, env.ALLOWED_ORIGIN)

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400, env.ALLOWED_ORIGIN)
  }

  const result = validateCreateRequest(raw)
  if (!result.success) {
    return jsonRes(
      { error: 'Validation failed', details: formatIssues(result.issues) },
      400,
      env.ALLOWED_ORIGIN
    )
  }

  const { timeline } = result.output
  const now = Math.floor(Date.now() / 1000)
  const newId = generateId()
  const { n: _, ...rest } = timeline // eslint-disable-line @typescript-eslint/no-unused-vars
  const content = JSON.stringify(rest)

  await env.healerbook_timelines
    .prepare(
      'INSERT INTO timelines (id, name, author_id, author_name, published_at, updated_at, version, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(newId, timeline.n, auth.userId, auth.username, now, now, 1, content)
    .run()

  return jsonRes({ id: newId, publishedAt: now, version: 1 }, 201, env.ALLOWED_ORIGIN)
}

async function handlePut(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await getAuthUserId(request, env)
  if (!auth) return jsonRes({ error: 'Unauthorized' }, 401, env.ALLOWED_ORIGIN)

  const row = await env.healerbook_timelines
    .prepare('SELECT * FROM timelines WHERE id = ?')
    .bind(id)
    .first<DbRow>()

  if (!row) return jsonRes({ error: 'Not found' }, 404, env.ALLOWED_ORIGIN)

  if (row.author_id !== auth.userId) {
    return jsonRes({ error: 'Forbidden' }, 403, env.ALLOWED_ORIGIN)
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400, env.ALLOWED_ORIGIN)
  }

  const validation = validateUpdateRequest(raw)
  if (!validation.success) {
    return jsonRes(
      { error: 'Validation failed', details: formatIssues(validation.issues) },
      400,
      env.ALLOWED_ORIGIN
    )
  }

  const { timeline, expectedVersion } = validation.output
  const now = Math.floor(Date.now() / 1000)

  const newName = timeline.n ?? row.name
  const { n: _, ...rest } = timeline // eslint-disable-line @typescript-eslint/no-unused-vars
  const content = JSON.stringify(rest)

  let dbResult: { meta: { changes: number } }

  if (expectedVersion !== undefined) {
    dbResult = await env.healerbook_timelines
      .prepare(
        'UPDATE timelines SET name=?, author_name=?, updated_at=?, version=version+1, content=? WHERE id=? AND version=?'
      )
      .bind(newName, auth.username, now, content, id, expectedVersion)
      .run()
  } else {
    dbResult = await env.healerbook_timelines
      .prepare(
        'UPDATE timelines SET name=?, author_name=?, updated_at=?, version=version+1, content=? WHERE id=?'
      )
      .bind(newName, auth.username, now, content, id)
      .run()
  }

  if (dbResult.meta.changes === 0) {
    // expectedVersion 不匹配（极低概率：步骤间记录被删除，统一返回 409）
    return jsonRes(
      { error: 'conflict', serverVersion: row.version, serverUpdatedAt: row.updated_at },
      409,
      env.ALLOWED_ORIGIN
    )
  }

  return jsonRes({ id, updatedAt: now, version: row.version + 1 }, 200, env.ALLOWED_ORIGIN)
}

async function handleGet(request: Request, env: Env, id: string): Promise<Response> {
  const row = await env.healerbook_timelines
    .prepare('SELECT * FROM timelines WHERE id = ?')
    .bind(id)
    .first<DbRow>()

  if (!row) return jsonRes({ error: 'Not found' }, 404, env.ALLOWED_ORIGIN)

  const data = rowToSharedTimeline(row)

  let isAuthor = false
  const auth = await getAuthUserId(request, env)
  if (auth && auth.userId === data.authorId) {
    isAuthor = true
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { authorId: _, authorName: __, publishedAt: ___, version: ____, ...timeline } = data

  return jsonRes(
    {
      timeline,
      authorName: data.authorName,
      publishedAt: data.publishedAt,
      version: data.version,
      isAuthor,
    },
    200,
    env.ALLOWED_ORIGIN
  )
}

interface TimelineListItem {
  id: string
  name: string
  publishedAt: number
  updatedAt: number
  version: number
  composition: unknown
}

async function handleList(request: Request, env: Env): Promise<Response> {
  const auth = await getAuthUserId(request, env)
  if (!auth) return jsonRes({ error: 'Unauthorized' }, 401, env.ALLOWED_ORIGIN)

  const result = await env.healerbook_timelines
    .prepare(
      'SELECT id, name, published_at, updated_at, version, content FROM timelines WHERE author_id = ? ORDER BY updated_at DESC'
    )
    .bind(auth.userId)
    .all<{
      id: string
      name: string
      published_at: number
      updated_at: number
      version: number
      content: string
    }>()

  const items: TimelineListItem[] = result.results.map(r => {
    const content = JSON.parse(r.content) as Record<string, unknown>
    return {
      id: r.id,
      name: r.name,
      publishedAt: r.published_at,
      updatedAt: r.updated_at,
      version: r.version,
      composition: content.c ?? null,
    }
  })

  return jsonRes(items, 200, env.ALLOWED_ORIGIN)
}

async function handleDelete(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await getAuthUserId(request, env)
  if (!auth) return jsonRes({ error: 'Unauthorized' }, 401, env.ALLOWED_ORIGIN)

  const result = await env.healerbook_timelines
    .prepare('DELETE FROM timelines WHERE id = ? AND author_id = ?')
    .bind(id, auth.userId)
    .run()

  if (result.meta.changes === 0) {
    return jsonRes({ error: 'Not found or forbidden' }, 404, env.ALLOWED_ORIGIN)
  }

  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN ?? '*' },
  })
}

/**
 * 处理 /api/timelines/* 路由
 */
export async function handleTimelines(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  if (path === '/api/timelines' && request.method === 'POST') {
    return handlePost(request, env)
  }

  if (path === '/api/my/timelines' && request.method === 'GET') {
    return handleList(request, env)
  }

  const idMatch = path.match(/^\/api\/timelines\/([0-9A-Za-z]+)$/)
  if (idMatch && request.method === 'PUT') {
    return handlePut(request, env, idMatch[1])
  }
  if (idMatch && request.method === 'GET') {
    return handleGet(request, env, idMatch[1])
  }
  if (idMatch && request.method === 'DELETE') {
    return handleDelete(request, env, idMatch[1])
  }

  return jsonRes({ error: 'Not Found' }, 404, env.ALLOWED_ORIGIN)
}
