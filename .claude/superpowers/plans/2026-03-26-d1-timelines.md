# D1 Timelines Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Cloudflare Workers 中共享时间轴的存储从 KV 迁移到 D1，外部 API 接口和前端代码零改动。

**Architecture:** Worker 端新增 D1 数据库，`timelines` 表使用混合结构——结构化元数据列（id、name、author_id 等）+ `content` JSON blob 存储时间轴主体数据。`timelines.ts` 中三处 KV 读写替换为 D1 SQL，`Env` 接口新增 `DB: D1Database`。

**Tech Stack:** Cloudflare Workers, Cloudflare D1 (SQLite), TypeScript, Vitest

---

## 文件清单

| 操作 | 文件                                   | 说明                                 |
| ---- | -------------------------------------- | ------------------------------------ |
| 新建 | `migrations/0001_create_timelines.sql` | 建表 DDL                             |
| 修改 | `wrangler.toml`                        | 新增 D1 binding（顶层 + dev + prod） |
| 修改 | `src/workers/fflogs-proxy.ts`          | `Env` 接口新增 `DB: D1Database`      |
| 修改 | `src/workers/timelines.ts`             | 将 KV 读写替换为 D1 SQL              |
| 修改 | `src/workers/timelines.test.ts`        | KV mock → D1 mock                    |

---

## ⚠️ 前置手动步骤（编码前必须完成）

在开始任何代码修改之前，**手动执行**以下 wrangler 命令创建 D1 数据库，并记录返回的 `database_id`：

```bash
# 创建开发数据库
pnpm wrangler d1 create healerbook

# 创建生产数据库
pnpm wrangler d1 create healerbook-prod
```

两条命令均会输出类似：

```
✅ Successfully created DB 'healerbook' in region APAC
Created your new D1 database.
{
  "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  ...
  "name": "healerbook"
}
```

记录两个 `uuid`，Task 3 中填入 `wrangler.toml`。

---

## Task 1: 提交设计文档

- [ ] **Step 1: Commit spec 和 plan 文档**

```bash
git add docs/superpowers/
git commit -m "docs: add D1 timelines migration spec and plan"
```

---

## Task 2: 创建 Migration SQL

**Files:**

- Create: `migrations/0001_create_timelines.sql`

- [ ] **Step 1: 创建文件**

```sql
-- migrations/0001_create_timelines.sql
CREATE TABLE timelines (
  id           TEXT    PRIMARY KEY,       -- nanoid 21 chars
  name         TEXT    NOT NULL,
  author_id    TEXT    NOT NULL,
  author_name  TEXT    NOT NULL,
  published_at INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  content      TEXT    NOT NULL           -- JSON blob，存储 encounter/damageEvents 等
);
```

- [ ] **Step 2: Commit**

```bash
git add migrations/0001_create_timelines.sql
git commit -m "chore: add D1 migration for timelines table"
```

---

## Task 3: 更新 Env 接口

**Files:**

- Modify: `src/workers/fflogs-proxy.ts:34-52`

- [ ] **Step 1: 在 `Env` 接口中新增 `DB: D1Database`**

找到 `src/workers/fflogs-proxy.ts` 中的 `Env` 接口，在 `healerbook: KVNamespace` 一行后新增：

```typescript
export interface Env {
  FFLOGS_CLIENT_ID?: string
  FFLOGS_CLIENT_SECRET?: string
  SYNC_AUTH_TOKEN?: string
  // KV 命名空间（对应 wrangler.toml 中 binding = "healerbook"）
  healerbook: KVNamespace
  // D1 数据库（共享时间轴存储）
  DB: D1Database
  // Queue 绑定
  TOP100_SYNC_QUEUE: Queue
  STATISTICS_EXTRACT_QUEUE: Queue
  FFLOGS_OAUTH_REDIRECT_URI?: string
  JWT_SECRET?: string
  ALLOWED_ORIGIN?: string
}
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
pnpm tsc --noEmit
```

Expected: 无新增错误（`D1Database` 由 `@cloudflare/workers-types` 提供，已在文件顶部 `/// <reference types="@cloudflare/workers-types" />` 引入）

- [ ] **Step 3: Commit**

```bash
git add src/workers/fflogs-proxy.ts
git commit -m "feat: add DB D1Database binding to Env interface"
```

---

## Task 4: 更新 wrangler.toml

**Files:**

- Modify: `wrangler.toml`

> 将前置步骤中记录的 `database_id` 填入下方 `<dev-database-id>` 和 `<prod-database-id>`。

- [ ] **Step 1: 在顶层（`[[kv_namespaces]]` 之后）添加**

```toml
[[d1_databases]]
binding = "DB"
database_name = "healerbook"
database_id = "<dev-database-id>"
```

- [ ] **Step 2: 在 `[env.development]` 块中添加**

```toml
[[env.development.d1_databases]]
binding = "DB"
database_name = "healerbook"
database_id = "<dev-database-id>"
```

- [ ] **Step 3: 在 `[env.production]` 块中添加**

```toml
[[env.production.d1_databases]]
binding = "DB"
database_name = "healerbook-prod"
database_id = "<prod-database-id>"
```

> 顶层块与 `env.development` 块 ID 相同是有意为之——`wrangler dev`（不加 `--env`）走顶层，`--env development` 走 env 块，两块均需存在。

- [ ] **Step 4: Commit**

```bash
git add wrangler.toml
git commit -m "chore: add D1 binding to wrangler.toml"
```

---

## Task 5: 用 D1 mock 重写测试文件

**Files:**

- Modify: `src/workers/timelines.test.ts`

测试用例**覆盖范围不变**，只替换 mock 基础设施。

- [ ] **Step 1: 将文件内容替换为以下内容**

```typescript
/// <reference types="@cloudflare/workers-types" />

import { describe, it, expect } from 'vitest'
import { handleTimelines } from './timelines'
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

        throw new Error(`Unhandled SQL in mock: ${sql}`)
      },
    }),
  } as unknown as D1Database
}

function makeMockEnv(db: D1Database, jwtSecret = 'test-secret'): Env {
  return {
    DB: db,
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
      body: JSON.stringify(MINIMAL_TIMELINE),
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

  it('请求体缺少 encounter 时返回 400', async () => {
    const env = makeMockEnv(makeMockD1())
    const token = await makeAccessToken('user1', 'TestUser', 'test-secret')

    const req = new Request('https://example.com/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: '没有 encounter', createdAt: 1742780000 }),
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
      body: JSON.stringify({ name: '没有 createdAt', encounter: { id: 1 } }),
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
      body: JSON.stringify({ ...MINIMAL_TIMELINE }),
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
      body: JSON.stringify({ ...MINIMAL_TIMELINE, id: 'server123', expectedVersion: 1 }),
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
    const db = makeMockD1([makeDbRow()])
    const env = makeMockEnv(db)
    const token = await makeAccessToken('user1', 'User1', 'test-secret')

    const req = new Request('https://example.com/api/timelines/server123', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
    expect(body.authorId).toBeUndefined()
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

  it('GET 返回的数据包含 encounter 等 content 字段', async () => {
    const db = makeMockD1([makeDbRow()])
    const env = makeMockEnv(db)

    const req = new Request('https://example.com/api/timelines/server123', { method: 'GET' })

    const res = await handleTimelines(req, env)
    expect(res.status).toBe(200)

    const body = (await res.json()) as Record<string, unknown>
    expect(body.encounter).toBeDefined()
    expect(body.damageEvents).toBeDefined()
    expect(body.name).toBe('测试时间轴')
  })
})
```

- [ ] **Step 2: 运行测试，确认全部失败**

```bash
pnpm test:run src/workers/timelines.test.ts
```

Expected: 所有测试 **FAIL**——此时 `timelines.ts` 仍调用 `env.healerbook.get/put`，但新 mock 的 `Env` 只提供 `DB`，`env.healerbook` 为 `undefined`，会抛出 `TypeError`

- [ ] **Step 3: Commit**

```bash
git add src/workers/timelines.test.ts
git commit -m "test: replace KV mock with D1 mock in timelines tests"
```

---

## Task 6: 重写 timelines.ts 使用 D1

**Files:**

- Modify: `src/workers/timelines.ts`

- [ ] **Step 1: 将文件内容替换为以下实现**

```typescript
/// <reference types="@cloudflare/workers-types" />

import type { Env } from './fflogs-proxy'
import { verifyToken } from './jwt'
import { customAlphabet } from 'nanoid'

const generateId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21
)

// 不存入数据库的字段
const EXCLUDED_FIELDS = [
  'statusEvents',
  'isShared',
  'hasLocalChanges',
  'serverVersion',
  'isReplayMode',
]

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

  const now = Math.floor(Date.now() / 1000)
  const newId = generateId()
  const content = buildContent(body)

  await env.DB.prepare(
    'INSERT INTO timelines (id, name, author_id, author_name, published_at, updated_at, version, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(newId, body.name as string, auth.userId, auth.username, now, now, 1, content)
    .run()

  return jsonRes({ id: newId, publishedAt: now, version: 1 }, 201, env.ALLOWED_ORIGIN)
}

async function handlePut(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await getAuthUserId(request, env)
  if (!auth) return jsonRes({ error: 'Unauthorized' }, 401, env.ALLOWED_ORIGIN)

  const row = await env.DB.prepare('SELECT * FROM timelines WHERE id = ?').bind(id).first<DbRow>()

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
  const content = buildContent(newBody)

  let result: { meta: { changes: number } }

  if (expectedVersion !== undefined) {
    result = await env.DB.prepare(
      'UPDATE timelines SET name=?, author_name=?, updated_at=?, version=version+1, content=? WHERE id=? AND version=?'
    )
      .bind(newName, auth.username, now, content, id, expectedVersion)
      .run()
  } else {
    result = await env.DB.prepare(
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
  const row = await env.DB.prepare('SELECT * FROM timelines WHERE id = ?').bind(id).first<DbRow>()

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

/**
 * 处理 /api/timelines/* 路由
 */
export async function handleTimelines(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  if (path === '/api/timelines' && request.method === 'POST') {
    return handlePost(request, env)
  }

  const putMatch = path.match(/^\/api\/timelines\/([0-9A-Za-z]+)$/)
  if (putMatch && request.method === 'PUT') {
    return handlePut(request, env, putMatch[1])
  }

  const getMatch = path.match(/^\/api\/timelines\/([0-9A-Za-z]+)$/)
  if (getMatch && request.method === 'GET') {
    return handleGet(request, env, getMatch[1])
  }

  return jsonRes({ error: 'Not Found' }, 404, env.ALLOWED_ORIGIN)
}
```

- [ ] **Step 2: 运行测试，确认全部通过**

```bash
pnpm test:run src/workers/timelines.test.ts
```

Expected: 所有 **12 个测试通过**（原有 8 个 + 新增 content 字段测试 + PUT 404 + 两个 POST 400 变体）

- [ ] **Step 3: 运行全量测试，确认无回归**

```bash
pnpm test:run
```

Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
git add src/workers/timelines.ts
git commit -m "feat: migrate shared timelines storage from KV to D1"
```

---

## Task 7: 应用 Migration（手动步骤）

> 此步骤需要已完成前置步骤（`wrangler d1 create`）和 Task 3（填入 database_id）。

- [ ] **Step 1: 应用开发环境 migration**

```bash
pnpm wrangler d1 migrations apply healerbook --env development
```

Expected:

```
Migrations to be applied:
  - 0001_create_timelines.sql
✅ Applied 1 migration(s)
```

- [ ] **Step 2: 应用生产环境 migration**

```bash
pnpm wrangler d1 migrations apply healerbook-prod --env production
```

- [ ] **Step 3: 本地启动 Worker 验证**

```bash
pnpm workers:dev
```

用 curl 或浏览器开发者工具测试 POST `/api/timelines`，确认返回 201。

---
