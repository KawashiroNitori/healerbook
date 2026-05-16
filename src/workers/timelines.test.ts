/// <reference types="@cloudflare/workers-types" />

/**
 * timelines 路由单元测试（node / vitest）
 *
 * 测试新版路由：POST 发布（客户端给定 id + name）、GET 公开读、DELETE 删除。
 * 旧版 PUT（全量更新 + 版本锁）已在重构中移除，不再测试。
 */

import { describe, it, expect, vi } from 'vitest'
import { app } from './index'
import type { Env } from './env'

// D1 行结构（对应 timelines 表）
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

interface EditorRow {
  timeline_id: string
  user_id: string
  created_at: number
}

/**
 * 内存 D1 mock，支持新版路由所需的 SQL 操作：
 *   SELECT 1 FROM timelines WHERE id = ?
 *   SELECT id FROM timelines WHERE id = ?
 *   INSERT INTO timelines (...)
 *   INSERT OR IGNORE INTO timeline_editors (...)
 *   DELETE FROM timelines WHERE id = ? AND author_id = ?
 *   DELETE FROM timeline_editors WHERE timeline_id = ?
 *   SELECT ... FROM timelines WHERE author_id = ?
 */
function makeMockD1(initialRows: DbRow[] = []): D1Database {
  const store = new Map<string, DbRow>(initialRows.map(r => [r.id, r]))
  const editors = new Map<string, EditorRow>() // key: `${timeline_id}:${user_id}`

  function makeStmt(sql: string) {
    return {
      bind: (...args: unknown[]) => {
        if (sql.startsWith('SELECT')) {
          if (sql.includes('WHERE author_id = ?')) {
            return {
              all: async <T>(): Promise<{ results: T[] }> => {
                const authorId = args[0] as string
                const rows = [...store.values()].filter(r => r.author_id === authorId)
                rows.sort((a, b) => b.updated_at - a.updated_at)
                return { results: rows as unknown as T[] }
              },
            }
          }
          if (sql.includes('FROM timeline_editors')) {
            return {
              first: async <T>(): Promise<T | null> => {
                const [timelineId, userId] = args as string[]
                return (editors.get(`${timelineId}:${userId}`) ?? null) as T | null
              },
            }
          }
          // SELECT 1 or SELECT id FROM timelines WHERE id = ?
          return {
            first: async <T>(): Promise<T | null> => {
              const id = args[0] as string
              return (store.get(id) ?? null) as T | null
            },
          }
        }

        if (sql.startsWith('INSERT') && sql.includes('INTO timelines')) {
          return {
            run: async () => {
              const [id, name, author_id, author_name, published_at, updated_at, version, content] =
                args
              // INSERT OR IGNORE: skip if id already exists
              if (store.has(id as string)) return { meta: { changes: 0 } }
              store.set(id as string, {
                id: id as string,
                name: name as string,
                author_id: author_id as string,
                author_name: author_name as string,
                published_at: published_at as number,
                updated_at: updated_at as number,
                version: version as number,
                content: content as string,
              })
              return { meta: { changes: 1 } }
            },
          }
        }

        if (sql.startsWith('INSERT') && sql.includes('INTO timeline_editors')) {
          return {
            run: async () => {
              const [timelineId, userId, createdAt] = args
              const key = `${timelineId}:${userId}`
              if (!editors.has(key)) {
                editors.set(key, {
                  timeline_id: timelineId as string,
                  user_id: userId as string,
                  created_at: createdAt as number,
                })
              }
              return { meta: { changes: 1 } }
            },
          }
        }

        if (sql.startsWith('DELETE') && sql.includes('FROM timelines')) {
          return {
            run: async () => {
              const [id, authorId] = args
              const row = store.get(id as string)
              if (!row || row.author_id !== authorId) return { meta: { changes: 0 } }
              store.delete(id as string)
              return { meta: { changes: 1 } }
            },
          }
        }

        if (sql.startsWith('DELETE') && sql.includes('FROM timeline_editors')) {
          return {
            run: async () => {
              const [timelineId] = args
              for (const key of [...editors.keys()]) {
                if (key.startsWith(`${timelineId}:`)) editors.delete(key)
              }
              return { meta: { changes: 1 } }
            },
          }
        }

        throw new Error(`Unhandled SQL in mock: ${sql}`)
      },
    }
  }

  return {
    prepare: (sql: string) => makeStmt(sql),
    batch: async (statements: ReturnType<typeof makeStmt>[]) => {
      for (const stmt of statements) {
        await (stmt as unknown as { run: () => Promise<unknown> }).run()
      }
      return []
    },
  } as unknown as D1Database
}

function makeMockKV(): KVNamespace {
  const kv = new Map<string, string>()
  return {
    get: async (key: string) => kv.get(key) ?? null,
    put: async (key: string, value: string) => {
      kv.set(key, value)
    },
    delete: async (key: string) => {
      kv.delete(key)
    },
  } as unknown as KVNamespace
}

function makeMockEnv(db: D1Database, jwtSecret = 'test-secret'): Env {
  return {
    healerbook_timelines: db,
    healerbook_snapshots: makeMockKV(),
    JWT_SECRET: jwtSecret,
  } as unknown as Env
}

async function makeAccessToken(userId: string, name: string, secret: string): Promise<string> {
  const { signAccessToken } = await import('./jwt')
  return signAccessToken(userId, name, secret)
}

function makeDbRow(overrides: Partial<DbRow> = {}): DbRow {
  return {
    id: 'server123',
    name: '测试时间轴',
    author_id: 'user1',
    author_name: 'User1',
    published_at: 1742780000,
    updated_at: 1742780000,
    version: 1,
    content: '{}',
    ...overrides,
  }
}

describe('POST /api/timelines', () => {
  it('无 Authorization 头时返回 401', async () => {
    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'mytimeline001', name: 'Test' }),
    })
    const res = await app.fetch(req, makeMockEnv(makeMockD1()))
    expect(res.status).toBe(401)
  })

  it('有效 token 发布成功，返回 { id, publishedAt }', async () => {
    const db = makeMockD1()
    const env = makeMockEnv(db)
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')

    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: 'my-timeline-001', name: '测试时间轴' }),
    })

    const res = await app.fetch(req, env)
    expect(res.status).toBe(201)

    const body = (await res.json()) as { id: string; publishedAt: number }
    expect(body.id).toBe('my-timeline-001')
    expect(typeof body.publishedAt).toBe('number')
  })

  it('id 为空字符串时返回 400', async () => {
    const env = makeMockEnv(makeMockD1())
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')

    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: '', name: 'Test' }),
    })

    const res = await app.fetch(req, env)
    expect(res.status).toBe(400)
  })

  it('id 超过 64 字符时返回 400', async () => {
    const env = makeMockEnv(makeMockD1())
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')

    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: 'a'.repeat(65), name: 'Test' }),
    })

    const res = await app.fetch(req, env)
    expect(res.status).toBe(400)
  })

  it('id 已存在时返回 409 id_taken', async () => {
    const db = makeMockD1([makeDbRow()])
    const env = makeMockEnv(db)
    const token = await makeAccessToken('user1', 'User1', 'test-secret')

    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: 'server123', name: '重复' }),
    })

    const res = await app.fetch(req, env)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('id_taken')
  })

  it('敏感词过滤命中时返回 409 id_rejected', async () => {
    const filterModule = await import('./sensitiveWordFilter')
    const spy = vi.spyOn(filterModule, 'containsBannedSubstring')
    spy.mockResolvedValue(true)

    const env = makeMockEnv(makeMockD1())
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')
    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: 'badword-id', name: 'Test' }),
    })
    const res = await app.fetch(req, env)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('id_rejected')

    spy.mockRestore()
  })
})

describe('GET /api/timelines/:id', () => {
  it('不存在的 ID 返回 404（无 KV 缓存, DO 未命中）', async () => {
    const req = new Request('https://example.com/api/timelines/notexist', { method: 'GET' })
    const res = await app.fetch(req, makeMockEnv(makeMockD1()))
    expect(res.status).toBe(404)
  })

  it('KV 缓存命中时返回 cached JSON', async () => {
    const db = makeMockD1([makeDbRow()])
    const env = makeMockEnv(db)
    // Pre-populate KV
    await env.healerbook_snapshots.put('tl-snapshot:server123', JSON.stringify({ name: 'Cached' }))

    const req = new Request('https://example.com/api/timelines/server123', { method: 'GET' })
    const res = await app.fetch(req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string }
    expect(body.name).toBe('Cached')
  })
})

describe('DELETE /api/timelines/:id', () => {
  it('未登录时返回 401', async () => {
    const db = makeMockD1([makeDbRow()])
    const env = makeMockEnv(db)

    const req = new Request('https://example.com/api/timelines/server123', { method: 'DELETE' })
    const res = await app.fetch(req, env)
    expect(res.status).toBe(401)
  })

  it('非作者删除返回 404', async () => {
    const db = makeMockD1([makeDbRow()])
    const env = makeMockEnv(db)
    const token = await makeAccessToken('other-user', 'Other', 'test-secret')

    const req = new Request('https://example.com/api/timelines/server123', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    const res = await app.fetch(req, env)
    expect(res.status).toBe(404)
  })

  it('作者删除成功返回 204', async () => {
    const db = makeMockD1([makeDbRow()])
    const env = makeMockEnv(db)
    const token = await makeAccessToken('user1', 'User1', 'test-secret')

    const req = new Request('https://example.com/api/timelines/server123', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    const res = await app.fetch(req, env)
    expect(res.status).toBe(204)
  })
})

describe('GET /api/timelines（列表）', () => {
  it('未登录时返回 401', async () => {
    const db = makeMockD1()
    const env = makeMockEnv(db)

    const req = new Request('https://example.com/api/my/timelines', { method: 'GET' })
    const res = await app.fetch(req, env)
    expect(res.status).toBe(401)
  })

  it('无记录时返回空数组', async () => {
    const db = makeMockD1()
    const env = makeMockEnv(db)
    const token = await makeAccessToken('user1', 'User1', 'test-secret')

    const req = new Request('https://example.com/api/my/timelines', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    const res = await app.fetch(req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(body).toEqual([])
  })

  it('只返回该用户的时间轴，按 updated_at 倒序', async () => {
    const contentWithComp = JSON.stringify({ c: ['PLD', 'WAR'] })
    const db = makeMockD1([
      makeDbRow({ id: 'a1', updated_at: 100, author_id: 'user1', content: contentWithComp }),
      makeDbRow({ id: 'a2', updated_at: 200, author_id: 'user1', content: contentWithComp }),
      makeDbRow({ id: 'b1', updated_at: 300, author_id: 'user2' }),
    ])
    const env = makeMockEnv(db)
    const token = await makeAccessToken('user1', 'User1', 'test-secret')

    const req = new Request('https://example.com/api/my/timelines', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    const res = await app.fetch(req, env)
    expect(res.status).toBe(200)

    const body = (await res.json()) as Array<{ id: string }>
    expect(body).toHaveLength(2)
    expect(body[0].id).toBe('a2')
    expect(body[1].id).toBe('a1')
  })
})
