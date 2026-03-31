/// <reference types="@cloudflare/workers-types" />

import type { Env } from './fflogs-proxy'
import { verifyToken } from './jwt'
import { customAlphabet } from 'nanoid'

const generateId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21
)

// 不存入数据库的字段
const EXCLUDED_FIELDS = ['statusEvents', 'isShared', 'hasLocalChanges', 'serverVersion']

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

function stripExcludedFields(obj: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...obj }
  for (const field of EXCLUDED_FIELDS) {
    delete copy[field]
  }
  return copy
}

/**
 * 将请求 body 拆分为结构化字段和 content JSON blob。
 * content 包含除 id、name 之外的所有透传字段（id 和 name 均存为独立列）。
 */
function buildContent(body: Record<string, unknown>): string {
  const stripped = stripExcludedFields(body)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { name: _name, id: _id, ...rest } = stripped
  return JSON.stringify(rest)
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

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400, env.ALLOWED_ORIGIN)
  }

  if (!body.name || !body.encounter || !body.createdAt) {
    return jsonRes({ error: 'Missing required fields' }, 400, env.ALLOWED_ORIGIN)
  }

  if (typeof body.name === 'string' && body.name.length > 50) {
    return jsonRes({ error: 'Name too long (max 50)' }, 400, env.ALLOWED_ORIGIN)
  }
  if (typeof body.description === 'string' && body.description.length > 500) {
    return jsonRes({ error: 'Description too long (max 500)' }, 400, env.ALLOWED_ORIGIN)
  }

  const now = Math.floor(Date.now() / 1000)
  const newId = generateId()
  const content = buildContent(body)

  await env.healerbook_timelines
    .prepare(
      'INSERT INTO timelines (id, name, author_id, author_name, published_at, updated_at, version, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(newId, body.name as string, auth.userId, auth.username, now, now, 1, content)
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

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400, env.ALLOWED_ORIGIN)
  }

  const expectedVersion = body.expectedVersion as number | undefined
  const now = Math.floor(Date.now() / 1000)

  const newBody = { ...body }
  delete newBody.expectedVersion

  const newName = (newBody.name as string | undefined) ?? row.name
  if (newName.length > 50) {
    return jsonRes({ error: 'Name too long (max 50)' }, 400, env.ALLOWED_ORIGIN)
  }
  if (typeof newBody.description === 'string' && newBody.description.length > 500) {
    return jsonRes({ error: 'Description too long (max 500)' }, 400, env.ALLOWED_ORIGIN)
  }
  const content = buildContent(newBody)

  let result: { meta: { changes: number } }

  if (expectedVersion !== undefined) {
    result = await env.healerbook_timelines
      .prepare(
        'UPDATE timelines SET name=?, author_name=?, updated_at=?, version=version+1, content=? WHERE id=? AND version=?'
      )
      .bind(newName, auth.username, now, content, id, expectedVersion)
      .run()
  } else {
    result = await env.healerbook_timelines
      .prepare(
        'UPDATE timelines SET name=?, author_name=?, updated_at=?, version=version+1, content=? WHERE id=?'
      )
      .bind(newName, auth.username, now, content, id)
      .run()
  }

  if (result.meta.changes === 0) {
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
  const { authorId: _authorId, ...publicData } = data

  return jsonRes({ ...publicData, isAuthor }, 200, env.ALLOWED_ORIGIN)
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
      composition: content.composition ?? null,
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
