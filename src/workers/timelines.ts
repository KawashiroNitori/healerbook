/// <reference types="@cloudflare/workers-types" />

import type { Env } from './fflogs-proxy'
import { verifyToken } from './jwt'
import { customAlphabet } from 'nanoid'

const generateId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21
)

// 不上传到服务器的字段
const EXCLUDED_FIELDS = [
  'statusEvents',
  'isShared',
  'hasLocalChanges',
  'serverVersion',
  'isReplayMode',
]

// 服务端存储的完整格式（含 authorId）
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

async function handlePost(request: Request, env: Env): Promise<Response> {
  const auth = await getAuthUserId(request, env)
  if (!auth) return jsonRes({ error: 'Unauthorized' }, 401, env.ALLOWED_ORIGIN)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400, env.ALLOWED_ORIGIN)
  }

  // 验证必要字段
  if (!body.name || !body.encounter || !body.createdAt) {
    return jsonRes({ error: 'Missing required fields' }, 400, env.ALLOWED_ORIGIN)
  }

  const now = Math.floor(Date.now() / 1000)
  const newId = generateId()

  const shared: SharedTimeline = {
    ...stripExcludedFields(body),
    id: newId,
    name: body.name as string,
    authorId: auth.userId,
    authorName: auth.username,
    publishedAt: now,
    updatedAt: now,
    version: 1,
  }

  await env.healerbook.put(`timeline:${newId}`, JSON.stringify(shared))

  return jsonRes({ id: newId, publishedAt: now, version: 1 }, 201, env.ALLOWED_ORIGIN)
}

async function handlePut(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await getAuthUserId(request, env)
  if (!auth) return jsonRes({ error: 'Unauthorized' }, 401, env.ALLOWED_ORIGIN)

  const raw = await env.healerbook.get(`timeline:${id}`)
  if (!raw) return jsonRes({ error: 'Not found' }, 404, env.ALLOWED_ORIGIN)

  const existing = JSON.parse(raw) as SharedTimeline

  // 权限检查
  if (existing.authorId !== auth.userId) {
    return jsonRes({ error: 'Forbidden' }, 403, env.ALLOWED_ORIGIN)
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400, env.ALLOWED_ORIGIN)
  }

  // 乐观锁冲突检测
  const expectedVersion = body.expectedVersion as number | undefined
  if (expectedVersion !== undefined && existing.version !== expectedVersion) {
    return jsonRes(
      { error: 'conflict', serverVersion: existing.version, serverUpdatedAt: existing.updatedAt },
      409,
      env.ALLOWED_ORIGIN
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const newBody = { ...body }
  delete newBody.expectedVersion

  const updated: SharedTimeline = {
    ...existing,
    ...stripExcludedFields(newBody),
    id,
    authorId: existing.authorId,
    authorName: auth.username,
    publishedAt: existing.publishedAt,
    updatedAt: now,
    version: existing.version + 1,
  }

  await env.healerbook.put(`timeline:${id}`, JSON.stringify(updated))

  return jsonRes({ id, updatedAt: now, version: updated.version }, 200, env.ALLOWED_ORIGIN)
}

async function handleGet(request: Request, env: Env, id: string): Promise<Response> {
  const raw = await env.healerbook.get(`timeline:${id}`)
  if (!raw) return jsonRes({ error: 'Not found' }, 404, env.ALLOWED_ORIGIN)

  const data = JSON.parse(raw) as SharedTimeline

  // 计算 isAuthor
  let isAuthor = false
  const auth = await getAuthUserId(request, env)
  if (auth && auth.userId === data.authorId) {
    isAuthor = true
  }

  // 剥离 authorId，返回公开类型
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { authorId: _authorId, ...publicData } = data

  return jsonRes({ ...publicData, isAuthor }, 200, env.ALLOWED_ORIGIN)
}

/**
 * 处理 /api/timelines/* 路由
 */
export async function handleTimelines(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  // POST /api/timelines
  if (path === '/api/timelines' && request.method === 'POST') {
    return handlePost(request, env)
  }

  // PUT /api/timelines/:id
  const putMatch = path.match(/^\/api\/timelines\/([0-9A-Za-z]+)$/)
  if (putMatch && request.method === 'PUT') {
    return handlePut(request, env, putMatch[1])
  }

  // GET /api/timelines/:id
  const getMatch = path.match(/^\/api\/timelines\/([0-9A-Za-z]+)$/)
  if (getMatch && request.method === 'GET') {
    return handleGet(request, env, getMatch[1])
  }

  return jsonRes({ error: 'Not Found' }, 404, env.ALLOWED_ORIGIN)
}
