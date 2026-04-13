/// <reference types="@cloudflare/workers-types" />

import { describe, it, expect } from 'vitest'
import * as v from 'valibot'
import { handleTimelines } from './timelines'
import { TimelineSchema } from './timelineSchema'
import type { Env } from './fflogs-proxy'

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

/**
 * 内存 D1 mock，模拟 prepare().bind().first()/run() 链式调用。
 *
 * 支持的 SQL 操作（通过 SQL 字符串前缀识别）：
 *   SELECT * FROM timelines WHERE id = ?
 *   INSERT INTO timelines (...) VALUES (...)
 *   UPDATE timelines SET ... WHERE id = ? [AND version = ?]
 *
 * INSERT 幂等性：与真实 D1 不同，mock 会静默覆盖主键重复的行（nanoid 碰撞概率极低，不影响测试语义）。
 */
function makeMockD1(initialRows: DbRow[] = []): D1Database {
  const store = new Map<string, DbRow>(initialRows.map(r => [r.id, r]))

  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        if (sql.startsWith('SELECT')) {
          // SELECT ... WHERE author_id = ? → .all()
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
          // SELECT * WHERE id = ? → .first()
          return {
            first: async <T>(): Promise<T | null> => {
              const id = args[0] as string
              return (store.get(id) ?? null) as T | null
            },
          }
        }

        if (sql.startsWith('INSERT')) {
          return {
            run: async () => {
              const [id, name, author_id, author_name, published_at, updated_at, version, content] =
                args
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

        if (sql.startsWith('UPDATE')) {
          return {
            run: async () => {
              // args: [name, author_name, updated_at, content, id, expectedVersion?]
              const [name, author_name, updated_at, content, id, expectedVersion] = args
              const row = store.get(id as string)
              if (!row) return { meta: { changes: 0 } }
              if (expectedVersion !== undefined && row.version !== expectedVersion) {
                return { meta: { changes: 0 } }
              }
              store.set(id as string, {
                ...row,
                name: name as string,
                author_name: author_name as string,
                updated_at: updated_at as number,
                version: row.version + 1,
                content: content as string,
              })
              return { meta: { changes: 1 } }
            },
          }
        }

        if (sql.startsWith('DELETE')) {
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

        throw new Error(`Unhandled SQL in mock: ${sql}`)
      },
    }),
  } as unknown as D1Database
}

function makeMockEnv(db: D1Database, jwtSecret = 'test-secret'): Env {
  return {
    healerbook_timelines: db,
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
  damageEvents: [],
  castEvents: [],
  createdAt: 1742780000,
  updatedAt: 1742780000,
}

// 用于预填 D1 mock 的初始行（content 排除 id 和 name，与 buildContent 行为一致）
function makeDbRow(overrides: Partial<DbRow> = {}): DbRow {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { name, id: _id, ...content } = MINIMAL_TIMELINE
  return {
    id: 'server123',
    name,
    author_id: 'user1',
    author_name: 'User1',
    published_at: 1742780000,
    updated_at: 1742780000,
    version: 1,
    content: JSON.stringify(content),
    ...overrides,
  }
}

describe('POST /api/timelines', () => {
  it('无 Authorization 头时返回 401', async () => {
    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeline: MINIMAL_TIMELINE }),
    })
    const res = await handleTimelines(req, makeMockEnv(makeMockD1()))
    expect(res.status).toBe(401)
  })

  it('有效 token 发布成功，返回 { id, publishedAt, version: 1 }', async () => {
    const db = makeMockD1()
    const env = makeMockEnv(db)
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')

    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ timeline: MINIMAL_TIMELINE }),
    })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(201)

    const body = (await res.json()) as { id: string; publishedAt: number; version: number }
    expect(body.version).toBe(1)
    expect(typeof body.id).toBe('string')
    expect(body.id).toMatch(/^[0-9A-Za-z]{21}$/)
    expect(typeof body.publishedAt).toBe('number')
  })

  it('请求体缺少 encounter 时返回 400', async () => {
    const env = makeMockEnv(makeMockD1())
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')

    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ timeline: { name: '没有 encounter', createdAt: 1742780000 } }),
    })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(400)
  })

  it('请求体缺少 createdAt 时返回 400', async () => {
    const env = makeMockEnv(makeMockD1())
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')

    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ timeline: { name: '没有 createdAt', encounter: { id: 1 } } }),
    })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/timelines/:id', () => {
  it('不存在的 ID 返回 404', async () => {
    const env = makeMockEnv(makeMockD1())
    const token = await makeAccessToken('user1', 'User1', 'test-secret')

    const req = new Request('https://example.com/api/timelines/notexist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ timeline: MINIMAL_TIMELINE }),
    })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(404)
  })

  it('非作者尝试更新时返回 403', async () => {
    const db = makeMockD1([makeDbRow()])
    const env = makeMockEnv(db)
    const token = await makeAccessToken('user2', 'OtherUser', 'test-secret')

    const req = new Request('https://example.com/api/timelines/server123', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        timeline: { ...MINIMAL_TIMELINE, id: 'server123' },
        expectedVersion: 1,
      }),
    })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(403)
  })

  it('版本冲突时返回 409 并携带 serverVersion 和 serverUpdatedAt', async () => {
    const db = makeMockD1([makeDbRow({ version: 2 })])
    const env = makeMockEnv(db)
    const token = await makeAccessToken('user1', 'User1', 'test-secret')

    const req = new Request('https://example.com/api/timelines/server123', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        timeline: { ...MINIMAL_TIMELINE, id: 'server123' },
        expectedVersion: 1,
      }),
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
    const db = makeMockD1([makeDbRow()])
    const env = makeMockEnv(db)
    const token = await makeAccessToken('user1', 'User1', 'test-secret')

    const req = new Request('https://example.com/api/timelines/server123', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        timeline: { ...MINIMAL_TIMELINE, id: 'server123' },
        expectedVersion: 1,
      }),
    })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { id: string; updatedAt: number; version: number }
    expect(body.version).toBe(2)
  })
})

describe('GET /api/timelines/:id', () => {
  it('不存在的 ID 返回 404', async () => {
    const req = new Request('https://example.com/api/timelines/notexist', { method: 'GET' })
    const res = await handleTimelines(req, makeMockEnv(makeMockD1()))
    expect(res.status).toBe(404)
  })

  it('无 token 时 isAuthor 为 false，不暴露 authorId', async () => {
    const db = makeMockD1([makeDbRow()])
    const env = makeMockEnv(db)

    const req = new Request('https://example.com/api/timelines/server123', { method: 'GET' })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(200)

    const body = (await res.json()) as Record<string, unknown>
    expect(body.isAuthor).toBe(false)
    expect(body.authorName).toBeDefined()
    expect((body as { timeline?: Record<string, unknown> }).timeline).toBeDefined()
    // authorId 不应出现在任何层级
    expect((body as { timeline?: Record<string, unknown> }).timeline?.authorId).toBeUndefined()
  })

  it('作者携带有效 token 时 isAuthor 为 true', async () => {
    const db = makeMockD1([makeDbRow()])
    const env = makeMockEnv(db)
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

  it('GET 返回的 timeline 字段包含 encounter 等内容', async () => {
    const db = makeMockD1([makeDbRow()])
    const env = makeMockEnv(db)

    const req = new Request('https://example.com/api/timelines/server123', { method: 'GET' })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      timeline: Record<string, unknown>
      version: number
      authorName: string
    }
    expect(body.timeline.encounter).toBeDefined()
    expect(body.timeline.damageEvents).toBeDefined()
    expect(body.timeline.name).toBe('测试时间轴')
    expect(body.version).toBe(1)
    expect(body.authorName).toBe('User1')
  })
})

describe('GET /api/timelines（列表）', () => {
  it('未登录时返回 401', async () => {
    const db = makeMockD1()
    const env = makeMockEnv(db)

    const req = new Request('https://example.com/api/my/timelines', { method: 'GET' })
    const res = await handleTimelines(req, env)
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
    const res = await handleTimelines(req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(body).toEqual([])
  })

  it('只返回该用户的时间轴，按 updated_at 倒序', async () => {
    const db = makeMockD1([
      makeDbRow({ id: 'a1', updated_at: 100, author_id: 'user1' }),
      makeDbRow({ id: 'a2', updated_at: 200, author_id: 'user1' }),
      makeDbRow({ id: 'b1', updated_at: 300, author_id: 'user2' }),
    ])
    const env = makeMockEnv(db)
    const token = await makeAccessToken('user1', 'User1', 'test-secret')

    const req = new Request('https://example.com/api/my/timelines', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    const res = await handleTimelines(req, env)
    expect(res.status).toBe(200)

    const body = (await res.json()) as Array<{
      id: string
      name: string
      publishedAt: number
      updatedAt: number
      version: number
    }>
    expect(body).toHaveLength(2)
    expect(body[0].id).toBe('a2')
    expect(body[1].id).toBe('a1')
    expect(
      body.every(item => 'publishedAt' in item && 'updatedAt' in item && 'version' in item)
    ).toBe(true)
    expect(body.every(item => !('authorId' in item) && !('content' in item))).toBe(true)
  })
})

describe('POST /api/timelines 数据校验', () => {
  async function postTimeline(timeline: unknown) {
    const db = makeMockD1()
    const env = makeMockEnv(db)
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')
    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ timeline }),
    })
    return handleTimelines(req, env)
  }

  it('剥离不在 schema 中的多余字段', async () => {
    const res = await postTimeline({
      ...MINIMAL_TIMELINE,
      statusEvents: [{ statusId: 1 }],
      isShared: true,
      hasLocalChanges: false,
      serverVersion: 5,
      __proto_hack__: 'evil',
    })
    expect(res.status).toBe(201)
  })

  it('name 类型错误时返回 400', async () => {
    const res = await postTimeline({ ...MINIMAL_TIMELINE, name: 12345 })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; details: string }
    expect(body.error).toBe('Validation failed')
  })

  it('encounter 结构不完整时返回 400', async () => {
    const res = await postTimeline({ ...MINIMAL_TIMELINE, encounter: { id: 'not-a-number' } })
    expect(res.status).toBe(400)
  })

  it('damageEvents 包含无效 type 时返回 400', async () => {
    const res = await postTimeline({
      ...MINIMAL_TIMELINE,
      damageEvents: [
        { id: '1', name: 'test', time: 10, damage: 100, type: 'invalid', damageType: 'physical' },
      ],
    })
    expect(res.status).toBe(400)
  })

  it('castEvents 包含无效 job 时返回 400', async () => {
    const res = await postTimeline({
      ...MINIMAL_TIMELINE,
      castEvents: [{ id: '1', actionId: 1, timestamp: 10, playerId: 1, job: 'INVALID_JOB' }],
    })
    expect(res.status).toBe(400)
  })

  it('composition.players 包含无效 job 时返回 400', async () => {
    const res = await postTimeline({
      ...MINIMAL_TIMELINE,
      composition: { players: [{ id: 1, job: 'FAKE' }] },
    })
    expect(res.status).toBe(400)
  })

  it('有效的完整数据通过校验', async () => {
    const res = await postTimeline({
      ...MINIMAL_TIMELINE,
      composition: {
        players: [
          { id: 1, job: 'WAR' },
          { id: 2, job: 'WHM' },
        ],
      },
      damageEvents: [
        { id: 'd1', name: 'AOE', time: 30, damage: 50000, type: 'aoe', damageType: 'magical' },
      ],
      castEvents: [{ id: 'c1', actionId: 100, timestamp: 25, playerId: 2, job: 'WHM' }],
    })
    expect(res.status).toBe(201)
  })

  it('包含合法 annotations 时通过校验', async () => {
    const res = await postTimeline({
      ...MINIMAL_TIMELINE,
      annotations: [
        {
          id: 'ann1',
          text: '注意减伤',
          time: 30,
          anchor: { type: 'damageTrack' },
        },
        {
          id: 'ann2',
          text: '铁壁在这里',
          time: 45,
          anchor: { type: 'skillTrack', playerId: 1, actionId: 100 },
        },
      ],
    })
    expect(res.status).toBe(201)
  })

  it('annotations 中 text 超过 200 字符时返回 400', async () => {
    const res = await postTimeline({
      ...MINIMAL_TIMELINE,
      annotations: [
        {
          id: 'ann1',
          text: 'a'.repeat(201),
          time: 30,
          anchor: { type: 'damageTrack' },
        },
      ],
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })
})

describe('PUT /api/timelines/:id 数据校验', () => {
  async function putTimeline(timeline: unknown, expectedVersion?: number) {
    const db = makeMockD1([makeDbRow()])
    const env = makeMockEnv(db)
    const token = await makeAccessToken('user1', 'User1', 'test-secret')
    const req = new Request('https://example.com/api/timelines/server123', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        timeline,
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      }),
    })
    return handleTimelines(req, env)
  }

  it('剥离多余字段后正常更新', async () => {
    const res = await putTimeline(
      {
        ...MINIMAL_TIMELINE,
        statusEvents: [],
        isShared: true,
        randomField: 'should be stripped',
      },
      1
    )
    expect(res.status).toBe(200)
  })

  it('name 类型错误时返回 400', async () => {
    const res = await putTimeline({ ...MINIMAL_TIMELINE, name: { nested: true } }, 1)
    expect(res.status).toBe(400)
  })

  it('damageType 值不在枚举中时返回 400', async () => {
    const res = await putTimeline(
      {
        ...MINIMAL_TIMELINE,
        damageEvents: [
          { id: '1', name: 'test', time: 10, damage: 100, type: 'aoe', damageType: 'holy' },
        ],
      },
      1
    )
    expect(res.status).toBe(400)
  })
})

describe('TimelineSchema — abilityId strip 回归', () => {
  it('parse 时 DamageEvent.abilityId 应被自动忽略（不写入 D1）', () => {
    const payload = {
      ...MINIMAL_TIMELINE,
      damageEvents: [
        {
          id: 'e1',
          name: '死刑',
          time: 10,
          damage: 80000,
          type: 'tankbuster',
          damageType: 'physical',
          abilityId: 40000, // 未在 schema 中声明
        },
      ],
    }

    const parsed = v.parse(TimelineSchema, payload)
    const eventOut = parsed.damageEvents[0] as Record<string, unknown>
    expect(eventOut.id).toBe('e1')
    expect(eventOut.abilityId).toBeUndefined()
  })
})

describe('DELETE /api/timelines/:id', () => {
  it('未登录时返回 401', async () => {
    const db = makeMockD1([makeDbRow()])
    const env = makeMockEnv(db)

    const req = new Request('https://example.com/api/timelines/server123', { method: 'DELETE' })
    const res = await handleTimelines(req, env)
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
    const res = await handleTimelines(req, env)
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
    const res = await handleTimelines(req, env)
    expect(res.status).toBe(204)
  })
})
