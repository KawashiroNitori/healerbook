/// <reference types="@cloudflare/workers-types" />

import { describe, it, expect, vi } from 'vitest'
import * as v from 'valibot'
import { handleTimelines } from './timelines'
import { V2TimelineSchema } from './timelineSchema'
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
  v: 2 as const,
  n: '测试时间轴',
  e: 1001,
  c: [] as string[],
  de: [] as unknown[],
  ce: { a: [] as number[], t: [] as number[], p: [] as number[] },
  ca: 1742780000,
  ua: 1742780000,
}

// 用于预填 D1 mock 的初始行（content 排除 n，与 handlePost 行为一致）
function makeDbRow(overrides: Partial<DbRow> = {}): DbRow {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { n: _name, ...content } = MINIMAL_TIMELINE
  return {
    id: 'server123',
    name: MINIMAL_TIMELINE.n,
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

  it('请求体缺少 e (encounter) 时返回 400', async () => {
    const env = makeMockEnv(makeMockD1())
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')

    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        timeline: {
          v: 2,
          n: '没有 encounter',
          c: [],
          de: [],
          ce: { a: [], t: [], p: [] },
          ca: 1000,
          ua: 1000,
        },
      }),
    })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(400)
  })

  it('过滤器命中前 3 次后第 4 次过审，仍返回 201', async () => {
    const filterModule = await import('./sensitiveWordFilter')
    const spy = vi.spyOn(filterModule, 'containsBannedSubstring')
    spy
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false)

    const env = makeMockEnv(makeMockD1())
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')
    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ timeline: MINIMAL_TIMELINE }),
    })
    const res = await handleTimelines(req, env)
    expect(res.status).toBe(201)
    expect(spy).toHaveBeenCalledTimes(4)

    spy.mockRestore()
  })

  it('过滤器连续 32 次命中后返回 500 id_generation_failed', async () => {
    const filterModule = await import('./sensitiveWordFilter')
    const spy = vi.spyOn(filterModule, 'containsBannedSubstring')
    spy.mockResolvedValue(true)

    const env = makeMockEnv(makeMockD1())
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')
    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ timeline: MINIMAL_TIMELINE }),
    })
    const res = await handleTimelines(req, env)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('id_generation_failed')
    expect(spy).toHaveBeenCalledTimes(32)

    spy.mockRestore()
  })

  it('过滤器从不命中（默认空表）时与既有路径一致：201 + 21 位 ID', async () => {
    // 不 spy；用真实 filter，generated 模块当前空表 → no-op → 总返 false
    // 注意：实际 generated.ts 此刻已有真实词表，但 21 位 ID 命中真实词概率约 0；
    // 若你的本机 generated.ts 跑出来恰好命中，可以临时改用 spy 强制 false
    const env = makeMockEnv(makeMockD1())
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')
    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ timeline: MINIMAL_TIMELINE }),
    })
    const res = await handleTimelines(req, env)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    expect(body.id).toMatch(/^[0-9A-Za-z]{21}$/)
  })

  it('请求体缺少 ca (createdAt) 时返回 400', async () => {
    const env = makeMockEnv(makeMockD1())
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')

    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        timeline: {
          v: 2,
          n: '没有 createdAt',
          e: 1,
          c: [],
          de: [],
          ce: { a: [], t: [], p: [] },
          ua: 1000,
        },
      }),
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

  it('GET 返回的 timeline 字段包含 V2 短键内容', async () => {
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
    // content 中存的是 V2 短键（n 被提取到 D1 name 列，content 中无 n）
    expect(body.timeline.de).toBeDefined()
    expect(body.timeline.ce).toBeDefined()
    // name 从 D1 列覆盖到 timeline 上（长 key + V2 短 key 都存在）
    expect(body.timeline.name).toBe('测试时间轴')
    expect(body.timeline.n).toBe('测试时间轴')
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

  it('只返回该用户的时间轴，按 updated_at 倒序，composition 为对象格式', async () => {
    // content 中的 c 字段是 V2 string[]，handleList 应转为 Composition 对象
    const contentWithComp = JSON.stringify({
      ...JSON.parse(makeDbRow().content),
      c: ['PLD', 'WAR'],
    })
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
    const res = await handleTimelines(req, env)
    expect(res.status).toBe(200)

    const body = (await res.json()) as Array<{
      id: string
      name: string
      publishedAt: number
      updatedAt: number
      version: number
      composition: unknown
    }>
    expect(body).toHaveLength(2)
    expect(body[0].id).toBe('a2')
    expect(body[1].id).toBe('a1')
    expect(
      body.every(item => 'publishedAt' in item && 'updatedAt' in item && 'version' in item)
    ).toBe(true)
    expect(body.every(item => !('authorId' in item) && !('content' in item))).toBe(true)
    // composition 应为 Composition 对象格式，非 V2 的 string[]
    expect(body[0].composition).toEqual({
      players: [
        { id: 0, job: 'PLD' },
        { id: 1, job: 'WAR' },
      ],
    })
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

  it('n 类型错误时返回 400', async () => {
    const res = await postTimeline({ ...MINIMAL_TIMELINE, n: 12345 })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; details: string }
    expect(body.error).toBe('Validation failed')
  })

  it('e 类型不是 number 时返回 400', async () => {
    const res = await postTimeline({ ...MINIMAL_TIMELINE, e: 'not-a-number' })
    expect(res.status).toBe(400)
  })

  it('de 包含无效 ty (type) 时返回 400', async () => {
    const res = await postTimeline({
      ...MINIMAL_TIMELINE,
      de: [{ n: 'test', t: 10, d: 100, ty: 99, dt: 0 }],
    })
    expect(res.status).toBe(400)
  })

  it('ce 结构无效时返回 400', async () => {
    const res = await postTimeline({
      ...MINIMAL_TIMELINE,
      ce: { a: [1], t: [10], p: ['not-a-number'] },
    })
    expect(res.status).toBe(400)
  })

  it('c 包含无效 job 时返回 400', async () => {
    const res = await postTimeline({
      ...MINIMAL_TIMELINE,
      c: ['FAKE'],
    })
    expect(res.status).toBe(400)
  })

  it('有效的完整数据通过校验', async () => {
    const res = await postTimeline({
      ...MINIMAL_TIMELINE,
      c: ['WAR', 'WHM'],
      de: [{ n: 'AOE', t: 30, d: 50000, ty: 0, dt: 1 }],
      ce: { a: [100], t: [25], p: [2] },
    })
    expect(res.status).toBe(201)
  })

  it('包含合法 an (annotations) 时通过校验', async () => {
    const res = await postTimeline({
      ...MINIMAL_TIMELINE,
      an: [
        { x: '注意减伤', t: 30, k: 0 },
        { x: '铁壁在这里', t: 45, k: [1, 100] },
      ],
    })
    expect(res.status).toBe(201)
  })

  it('an 中 x 超过 200 字符时返回 400', async () => {
    const res = await postTimeline({
      ...MINIMAL_TIMELINE,
      an: [{ x: 'a'.repeat(201), t: 30, k: 0 }],
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

  it('n 类型错误时返回 400', async () => {
    const res = await putTimeline({ ...MINIMAL_TIMELINE, n: { nested: true } }, 1)
    expect(res.status).toBe(400)
  })

  it('dt 值不在枚举中时返回 400', async () => {
    const res = await putTimeline(
      {
        ...MINIMAL_TIMELINE,
        de: [{ n: 'test', t: 10, d: 100, ty: 0, dt: 99 }],
      },
      1
    )
    expect(res.status).toBe(400)
  })
})

describe('V2TimelineSchema — 多余字段 strip 回归', () => {
  it('parse 时 DamageEvent 中的多余字段应被自动忽略（不写入 D1）', () => {
    const payload = {
      ...MINIMAL_TIMELINE,
      de: [
        {
          n: '死刑',
          t: 10,
          d: 80000,
          ty: 1 as const,
          dt: 0 as const,
          abilityId: 40000, // 未在 schema 中声明
        },
      ],
    }

    const parsed = v.parse(V2TimelineSchema, payload)
    const eventOut = parsed.de[0] as Record<string, unknown>
    expect(eventOut.n).toBe('死刑')
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
