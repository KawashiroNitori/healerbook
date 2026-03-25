/// <reference types="@cloudflare/workers-types" />

import { describe, it, expect, vi } from 'vitest'
import { handleTimelines } from './timelines'
import type { Env } from './fflogs-proxy'

// 模拟 KV
function makeMockKV(initial: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    list: vi.fn(async () => ({ keys: [] })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
  } as unknown as KVNamespace
}

function makeMockEnv(kv: KVNamespace, jwtSecret = 'test-secret'): Env {
  return {
    healerbook: kv,
    JWT_SECRET: jwtSecret,
    ALLOWED_ORIGIN: 'http://localhost:5173',
  } as unknown as Env
}

async function makeAccessToken(userId: string, name: string, secret: string): Promise<string> {
  const { signAccessToken } = await import('./jwt')
  return signAccessToken(userId, name, secret)
}

const MINIMAL_TIMELINE = {
  id: 'local123',
  name: '测试时间轴',
  encounter: { id: 1001, name: '副本', displayName: '副本', zone: '', damageEvents: [] },
  composition: { players: [] },
  phases: [],
  damageEvents: [],
  castEvents: [],
  createdAt: 1742780000,
  updatedAt: 1742780000,
}

describe('POST /api/timelines', () => {
  it('无 Authorization 头时返回 401', async () => {
    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(MINIMAL_TIMELINE),
    })
    const res = await handleTimelines(req, makeMockEnv(makeMockKV()))
    expect(res.status).toBe(401)
  })

  it('有效 token 发布成功，返回 { id, publishedAt, version: 1 }', async () => {
    const kv = makeMockKV()
    const env = makeMockEnv(kv, 'test-secret')
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')

    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(MINIMAL_TIMELINE),
    })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(201)

    const body = (await res.json()) as { id: string; publishedAt: number; version: number }
    expect(body.version).toBe(1)
    expect(typeof body.id).toBe('string')
    expect(body.id).toMatch(/^[0-9A-Za-z]{21}$/)
    expect(typeof body.publishedAt).toBe('number')
  })

  it('请求体缺少必要字段时返回 400', async () => {
    const env = makeMockEnv(makeMockKV(), 'test-secret')
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')

    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: '没有 id' }),
    })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/timelines/:id', () => {
  it('非作者尝试更新时返回 403', async () => {
    const existing = {
      ...MINIMAL_TIMELINE,
      id: 'server123',
      authorId: 'user1',
      authorName: 'User1',
      publishedAt: 1742780000,
      updatedAt: 1742780000,
      version: 1,
    }
    const kv = makeMockKV({ 'timeline:server123': JSON.stringify(existing) })
    const env = makeMockEnv(kv, 'test-secret')
    const token = await makeAccessToken('user2', 'OtherUser', 'test-secret')

    const req = new Request('https://example.com/api/timelines/server123', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...MINIMAL_TIMELINE, id: 'server123', expectedVersion: 1 }),
    })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(403)
  })

  it('版本冲突时返回 409 并携带 serverVersion 和 serverUpdatedAt', async () => {
    const existing = {
      ...MINIMAL_TIMELINE,
      id: 'server123',
      authorId: 'user1',
      authorName: 'User1',
      publishedAt: 1742780000,
      updatedAt: 1742780000,
      version: 2,
    }
    const kv = makeMockKV({ 'timeline:server123': JSON.stringify(existing) })
    const env = makeMockEnv(kv, 'test-secret')
    const token = await makeAccessToken('user1', 'User1', 'test-secret')

    const req = new Request('https://example.com/api/timelines/server123', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...MINIMAL_TIMELINE, id: 'server123', expectedVersion: 1 }),
    })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(409)
    const body = (await res.json()) as {
      error: string
      serverVersion: number
      serverUpdatedAt: number
    }
    expect(body.error).toBe('conflict')
    expect(body.serverVersion).toBe(2)
  })

  it('作者更新成功，version 递增', async () => {
    const existing = {
      ...MINIMAL_TIMELINE,
      id: 'server123',
      authorId: 'user1',
      authorName: 'User1',
      publishedAt: 1742780000,
      updatedAt: 1742780000,
      version: 1,
    }
    const kv = makeMockKV({ 'timeline:server123': JSON.stringify(existing) })
    const env = makeMockEnv(kv, 'test-secret')
    const token = await makeAccessToken('user1', 'User1', 'test-secret')

    const req = new Request('https://example.com/api/timelines/server123', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...MINIMAL_TIMELINE, id: 'server123', expectedVersion: 1 }),
    })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; updatedAt: number; version: number }
    expect(body.version).toBe(2)
  })
})

describe('GET /api/timelines/:id', () => {
  it('不存在的 ID 返回 404', async () => {
    const req = new Request('https://example.com/api/timelines/notexist', {
      method: 'GET',
    })
    const res = await handleTimelines(req, makeMockEnv(makeMockKV()))
    expect(res.status).toBe(404)
  })

  it('无 token 时 isAuthor 为 false，不暴露 authorId', async () => {
    const existing = {
      ...MINIMAL_TIMELINE,
      id: 'server123',
      authorId: 'user1',
      authorName: 'User1',
      publishedAt: 1742780000,
      updatedAt: 1742780000,
      version: 1,
    }
    const kv = makeMockKV({ 'timeline:server123': JSON.stringify(existing) })
    const env = makeMockEnv(kv, 'test-secret')

    const req = new Request('https://example.com/api/timelines/server123', {
      method: 'GET',
    })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.isAuthor).toBe(false)
    expect(body.authorId).toBeUndefined()
  })

  it('作者携带有效 token 时 isAuthor 为 true', async () => {
    const existing = {
      ...MINIMAL_TIMELINE,
      id: 'server123',
      authorId: 'user1',
      authorName: 'User1',
      publishedAt: 1742780000,
      updatedAt: 1742780000,
      version: 1,
    }
    const kv = makeMockKV({ 'timeline:server123': JSON.stringify(existing) })
    const env = makeMockEnv(kv, 'test-secret')
    const token = await makeAccessToken('user1', 'User1', 'test-secret')

    const req = new Request('https://example.com/api/timelines/server123', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.isAuthor).toBe(true)
  })
})
