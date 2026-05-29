# 用户体系与凭据表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入独立的 `users` 用户主体与通用 `user_credentials` 凭据表，把 FFLogs OAuth 降级为挂在用户身下的一种认证方式，并把 FFLogs 颁发的 access_token 落库（本期只到「可被取出」为止）。

**Architecture:** 新增 D1 迁移 `0005` 建 `users` / `user_credentials` 两表并回填存量用户；新建 `src/workers/userCredentials.ts` 收拢所有凭据 SQL（register / login / get / parse）；`auth.ts` 的 callback 改为调 `loginWithOAuth`，JWT `sub` 由 fflogs id 切换为 my-user-id。任一落库失败一律返回 HTTP 500、不签发 JWT（fail-fast）。

**Tech Stack:** Cloudflare Workers + D1（SQLite）、Hono、jose（JWT）、Vitest 4 workers pool（`@cloudflare/vitest-pool-workers`，`cloudflare:test`）。

**设计依据:** `design/superpowers/specs/2026-05-29-user-credentials-design.md`

---

## File Structure

- **Create** `migrations/0005_create_user_credentials.sql` — 建 `users`、`user_credentials` 表与索引、seed 自增起点、回填存量用户。
- **Create** `src/workers/userCredentials.ts` — 凭据数据访问模块：类型、`serializeOAuthData` / `parseOAuthData` / `isOAuthExpired`、`findCredential`、`registerWithOAuth`、`loginWithOAuth`、`getCredential`。
- **Create** `src/workers/userCredentials.test.ts` — 纯函数单测（serialize/parse/expiry）。
- **Create** `src/workers/userCredentials.workers.test.ts` — D1 支撑的集成单测（find/register/login/get、唯一约束）。
- **Modify** `src/workers/routes/auth.ts` — callback 接入 `loginWithOAuth`，`sub` 改 my-user-id，落库失败 500。
- **Create** `src/workers/routes/auth.callback.workers.test.ts` — callback 集成测试（stub fflogs fetch）。
- **Modify** `src/workers/jwt.ts` — `AccessTokenPayload.sub` 注释语义由 fflogs id 改为 my-user-id（仅注释，签名不变）。

> 前端 `CallbackPage.tsx` / `authStore` 已消费返回的 `user_id` 字段，my-user-id 与 fflogs id 同为字符串化整数，**无需改动前端代码**（设计 §7）。

---

## Task 1: 迁移 0005 — 建表、索引、seed、回填

**Files:**

- Create: `migrations/0005_create_user_credentials.sql`
- Test: `src/workers/userCredentials.workers.test.ts`（本任务先建立「schema 已就绪」断言）

- [ ] **Step 1: 写迁移文件**

`migrations/0005_create_user_credentials.sql`：

```sql
-- 用户主体 + 通用凭据表(本期 oauth/fflogs;预留 passkey/password)
-- 详见 design/superpowers/specs/2026-05-29-user-credentials-design.md

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,  -- 存量复用 fflogs id(<1e6);新用户 ≥1000001
  name       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_credentials (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  type       TEXT    NOT NULL,                    -- 'oauth' | 'passkey' | 'password'
  provider   TEXT    NOT NULL,                    -- 稳定来源键: 'fflogs' | ...
  identifier TEXT    NOT NULL,                    -- oauth: fflogs id
  data       TEXT    NOT NULL,                    -- JSON: { access_token, refresh_token, expires_at }
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CONSTRAINT json_check_data CHECK (json_valid(data))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_credentials_provider_identifier
  ON user_credentials (provider, identifier);
CREATE INDEX IF NOT EXISTS idx_user_credentials_user ON user_credentials (user_id);

-- seed 自增起点:新用户从 1000001 起。必须在回填之前执行——
-- 此时 sqlite_sequence 尚无 'users' 行,可直接 INSERT;之后回填的显式 id 均 < 1e6,
-- 不会下调 seq(SQLite 取 max(seq, rowid))。
INSERT INTO sqlite_sequence (name, seq) VALUES ('users', 1000000);

-- 回填存量用户:汇总 timelines/editors/edit_requests 的 distinct id(取任一非空 name)
INSERT OR IGNORE INTO users (id, name, created_at, updated_at)
SELECT id, MIN(name), unixepoch(), unixepoch() FROM (
  SELECT CAST(author_id AS INTEGER) AS id, author_name AS name FROM timelines
  UNION ALL
  SELECT CAST(user_id AS INTEGER),         user_name        FROM timeline_editors
  UNION ALL
  SELECT CAST(user_id AS INTEGER),         user_name        FROM timeline_edit_requests
) GROUP BY id;

-- 为每个存量用户建占位 oauth 凭据(token 历史未存,留空,待其下次登录 UPSERT 填入)
INSERT OR IGNORE INTO user_credentials
  (user_id, type, provider, identifier, data, created_at, updated_at)
SELECT id, 'oauth', 'fflogs', CAST(id AS TEXT),
       json_object('access_token','', 'refresh_token','', 'expires_at', 0),
       unixepoch(), unixepoch()
FROM users;
```

- [ ] **Step 2: 写 schema 断言测试（先失败）**

`src/workers/userCredentials.workers.test.ts`（新建，先只放此用例）：

```ts
import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

const db = () => env.healerbook_timelines

describe('migration 0005 schema', () => {
  it('users 与 user_credentials 表存在', async () => {
    const rows = await db()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','user_credentials')"
      )
      .all<{ name: string }>()
    const names = rows.results.map(r => r.name).sort()
    expect(names).toEqual(['user_credentials', 'users'])
  })

  it('seed 后 users 自增下一个值为 1000001', async () => {
    const seq = await db()
      .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'users'")
      .first<{ seq: number }>()
    expect(seq?.seq).toBe(1000000)
  })

  it('UNIQUE(provider, identifier) 拒重复', async () => {
    const now = 1
    await db()
      .prepare('INSERT INTO users (name, created_at, updated_at) VALUES (?, ?, ?)')
      .bind('u', now, now)
      .run()
    const uid = (await db().prepare('SELECT last_insert_rowid() AS id').first<{ id: number }>())!.id
    const ins = (id: string) =>
      db()
        .prepare(
          "INSERT INTO user_credentials (user_id, type, provider, identifier, data, created_at, updated_at) VALUES (?, 'oauth', 'dupprov', ?, '{}', ?, ?)"
        )
        .bind(uid, id, now, now)
        .run()
    await ins('dup-1')
    await expect(ins('dup-1')).rejects.toThrow()
  })
})
```

- [ ] **Step 3: 运行测试确认通过**

Run: `pnpm vitest run --config vitest.workers.config.ts userCredentials.workers`
Expected: PASS（迁移由 `readD1Migrations` 自动加载并在 `beforeAll` 应用）。

- [ ] **Step 4: Commit**

```bash
git add migrations/0005_create_user_credentials.sql src/workers/userCredentials.workers.test.ts
git commit -m "feat(auth): add 0005 migration for users + user_credentials"
```

---

## Task 2: userCredentials 纯函数（serialize / parse / expiry）

**Files:**

- Create: `src/workers/userCredentials.ts`
- Test: `src/workers/userCredentials.test.ts`

- [ ] **Step 1: 写失败测试**

`src/workers/userCredentials.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  serializeOAuthData,
  parseOAuthData,
  isOAuthExpired,
  type OAuthData,
} from './userCredentials'

const sample: OAuthData = { access_token: 'tok', refresh_token: '', expires_at: 1000 }

describe('OAuth data 读写', () => {
  it('serialize → parse 往返一致', () => {
    const json = serializeOAuthData(sample)
    expect(parseOAuthData({ data: json })).toEqual(sample)
  })

  it('parse 缺字段时回退为安全默认', () => {
    expect(parseOAuthData({ data: '{}' })).toEqual({
      access_token: '',
      refresh_token: '',
      expires_at: 0,
    })
  })
})

describe('isOAuthExpired', () => {
  it('now 超过 expires_at 判过期', () => {
    expect(isOAuthExpired(sample, 1001)).toBe(true)
  })
  it('now 等于或早于 expires_at 不算过期', () => {
    expect(isOAuthExpired(sample, 1000)).toBe(false)
    expect(isOAuthExpired(sample, 999)).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run userCredentials.test`
Expected: FAIL（`./userCredentials` 不存在 / 未导出这些符号）。

- [ ] **Step 3: 写最小实现**

`src/workers/userCredentials.ts`：

```ts
/// <reference types="@cloudflare/workers-types" />

export interface OAuthData {
  access_token: string
  refresh_token: string
  /** unix 秒;0 表示占位/未知 */
  expires_at: number
}

export function serializeOAuthData(d: OAuthData): string {
  return JSON.stringify({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: d.expires_at,
  })
}

export function parseOAuthData(row: { data: string }): OAuthData {
  const raw = JSON.parse(row.data) as Partial<OAuthData>
  return {
    access_token: raw.access_token ?? '',
    refresh_token: raw.refresh_token ?? '',
    expires_at: raw.expires_at ?? 0,
  }
}

/** now(秒) 严格大于 expires_at 即视为过期 */
export function isOAuthExpired(d: OAuthData, nowSec: number): boolean {
  return nowSec > d.expires_at
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run userCredentials.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workers/userCredentials.ts src/workers/userCredentials.test.ts
git commit -m "feat(auth): add OAuth data serialize/parse/expiry helpers"
```

---

## Task 3: findCredential + registerWithOAuth（D1）

**Files:**

- Modify: `src/workers/userCredentials.ts`
- Test: `src/workers/userCredentials.workers.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `src/workers/userCredentials.workers.test.ts` 顶部补充 import，并追加 describe：

```ts
import { findCredential, registerWithOAuth } from './userCredentials'

describe('registerWithOAuth + findCredential', () => {
  const input = {
    provider: 'fflogs',
    providerUserId: 'reg-100',
    name: 'Reg',
    accessToken: 'a-tok',
    refreshToken: '',
    expiresAt: 5000,
  }

  it('注册分配自增 user_id ≥1000001 并写入凭据', async () => {
    const { userId } = await registerWithOAuth(env.healerbook_timelines, input)
    expect(userId).toBeGreaterThanOrEqual(1000001)

    const cred = await findCredential(env.healerbook_timelines, 'fflogs', 'reg-100')
    expect(cred).not.toBeNull()
    expect(cred!.user_id).toBe(userId)
    expect(cred!.type).toBe('oauth')
    expect(JSON.parse(cred!.data).access_token).toBe('a-tok')
  })

  it('users.name 取 register 传入的 name', async () => {
    const { userId } = await registerWithOAuth(env.healerbook_timelines, {
      ...input,
      providerUserId: 'reg-101',
      name: 'NameCheck',
    })
    const u = await env.healerbook_timelines
      .prepare('SELECT name FROM users WHERE id = ?')
      .bind(userId)
      .first<{ name: string }>()
    expect(u?.name).toBe('NameCheck')
  })

  it('findCredential 未命中返回 null', async () => {
    expect(await findCredential(env.healerbook_timelines, 'fflogs', 'no-such')).toBeNull()
  })

  it('重复注册同一 (provider, identifier) 抛错（唯一约束）', async () => {
    await registerWithOAuth(env.healerbook_timelines, { ...input, providerUserId: 'reg-dup' })
    await expect(
      registerWithOAuth(env.healerbook_timelines, { ...input, providerUserId: 'reg-dup' })
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run --config vitest.workers.config.ts userCredentials.workers`
Expected: FAIL（`findCredential` / `registerWithOAuth` 未导出）。

- [ ] **Step 3: 写实现（追加到 userCredentials.ts）**

```ts
export interface CredentialRow {
  id: number
  user_id: number
  type: string
  provider: string
  identifier: string
  data: string
  created_at: number
  updated_at: number
}

export interface OAuthLoginInput {
  provider: string
  providerUserId: string
  name: string
  accessToken: string
  refreshToken: string
  /** unix 秒 */
  expiresAt: number
}

export async function findCredential(
  db: D1Database,
  provider: string,
  identifier: string
): Promise<CredentialRow | null> {
  return db
    .prepare(
      'SELECT id, user_id, type, provider, identifier, data, created_at, updated_at FROM user_credentials WHERE provider = ? AND identifier = ?'
    )
    .bind(provider, identifier)
    .first<CredentialRow>()
}

/**
 * register 流程:单条 batch(隐式事务)内 INSERT users + INSERT user_credentials。
 * 第二条用 last_insert_rowid() 引用刚建的 users.id(同一连接顺序执行)。
 * 唯一约束冲突或写库失败时整批回滚并抛错。
 */
export async function registerWithOAuth(
  db: D1Database,
  input: OAuthLoginInput
): Promise<{ userId: number }> {
  const now = Math.floor(Date.now() / 1000)
  const data = serializeOAuthData({
    access_token: input.accessToken,
    refresh_token: input.refreshToken,
    expires_at: input.expiresAt,
  })
  const [usersRes] = await db.batch([
    db
      .prepare('INSERT INTO users (name, created_at, updated_at) VALUES (?, ?, ?)')
      .bind(input.name, now, now),
    db
      .prepare(
        "INSERT INTO user_credentials (user_id, type, provider, identifier, data, created_at, updated_at) VALUES (last_insert_rowid(), 'oauth', ?, ?, ?, ?, ?)"
      )
      .bind(input.provider, input.providerUserId, data, now, now),
  ])
  return { userId: usersRes.meta.last_row_id }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run --config vitest.workers.config.ts userCredentials.workers`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workers/userCredentials.ts src/workers/userCredentials.workers.test.ts
git commit -m "feat(auth): add findCredential + registerWithOAuth"
```

---

## Task 4: loginWithOAuth 编排（命中 UPSERT / 未命中 register）

**Files:**

- Modify: `src/workers/userCredentials.ts`
- Test: `src/workers/userCredentials.workers.test.ts`

- [ ] **Step 1: 追加失败测试**

import 补 `loginWithOAuth`，追加 describe：

```ts
import { loginWithOAuth } from './userCredentials'

describe('loginWithOAuth', () => {
  const base = {
    provider: 'fflogs',
    providerUserId: 'login-1',
    name: 'First',
    accessToken: 'tok-1',
    refreshToken: '',
    expiresAt: 1000,
  }

  it('首次登录 isNew=true 并新建用户(≥1000001)', async () => {
    const r = await loginWithOAuth(env.healerbook_timelines, base)
    expect(r.isNew).toBe(true)
    expect(r.userId).toBeGreaterThanOrEqual(1000001)
  })

  it('再次登录 isNew=false、userId 不变、token 与 name 被更新', async () => {
    const r2 = await loginWithOAuth(env.healerbook_timelines, {
      ...base,
      name: 'Renamed',
      accessToken: 'tok-2',
      expiresAt: 2000,
    })
    expect(r2.isNew).toBe(false)

    const cred = await findCredential(env.healerbook_timelines, 'fflogs', 'login-1')
    expect(JSON.parse(cred!.data).access_token).toBe('tok-2')
    expect(JSON.parse(cred!.data).expires_at).toBe(2000)
    const u = await env.healerbook_timelines
      .prepare('SELECT name FROM users WHERE id = ?')
      .bind(r2.userId)
      .first<{ name: string }>()
    expect(u?.name).toBe('Renamed')
  })

  it('命中存量占位凭据(空 token)时补写 token，复用其 user_id', async () => {
    // 模拟回填产生的存量:user_id=42 + 空 token 占位凭据
    const now = 1
    await env.healerbook_timelines
      .prepare('INSERT INTO users (id, name, created_at, updated_at) VALUES (42, ?, ?, ?)')
      .bind('Legacy', now, now)
      .run()
    await env.healerbook_timelines
      .prepare(
        "INSERT INTO user_credentials (user_id, type, provider, identifier, data, created_at, updated_at) VALUES (42, 'oauth', 'fflogs', '42', json_object('access_token','','refresh_token','','expires_at',0), ?, ?)"
      )
      .bind(now, now)
      .run()

    const r = await loginWithOAuth(env.healerbook_timelines, {
      ...base,
      providerUserId: '42',
      name: 'Legacy2',
      accessToken: 'filled',
      expiresAt: 9999,
    })
    expect(r).toEqual({ userId: 42, isNew: false })
    const cred = await findCredential(env.healerbook_timelines, 'fflogs', '42')
    expect(JSON.parse(cred!.data).access_token).toBe('filled')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run --config vitest.workers.config.ts userCredentials.workers`
Expected: FAIL（`loginWithOAuth` 未导出）。

- [ ] **Step 3: 写实现（追加到 userCredentials.ts）**

```ts
/**
 * 登录编排:findCredential 命中→UPSERT token/name(isNew=false);
 * 未命中→registerWithOAuth(isNew=true)。命中分支用 batch 保证两条 UPDATE 原子。
 * 任一写库失败抛错,由调用方(auth callback)转 HTTP 500。
 */
export async function loginWithOAuth(
  db: D1Database,
  input: OAuthLoginInput
): Promise<{ userId: number; isNew: boolean }> {
  const cred = await findCredential(db, input.provider, input.providerUserId)
  if (cred) {
    const now = Math.floor(Date.now() / 1000)
    const data = serializeOAuthData({
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
      expires_at: input.expiresAt,
    })
    await db.batch([
      db
        .prepare('UPDATE user_credentials SET data = ?, updated_at = ? WHERE id = ?')
        .bind(data, now, cred.id),
      db
        .prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?')
        .bind(input.name, now, cred.user_id),
    ])
    return { userId: cred.user_id, isNew: false }
  }
  const { userId } = await registerWithOAuth(db, input)
  return { userId, isNew: true }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run --config vitest.workers.config.ts userCredentials.workers`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workers/userCredentials.ts src/workers/userCredentials.workers.test.ts
git commit -m "feat(auth): add loginWithOAuth orchestration"
```

---

## Task 5: getCredential（供未来代调 API 取 token）

**Files:**

- Modify: `src/workers/userCredentials.ts`
- Test: `src/workers/userCredentials.workers.test.ts`

- [ ] **Step 1: 追加失败测试**

import 补 `getCredential`，追加 describe：

```ts
import { getCredential } from './userCredentials'

describe('getCredential', () => {
  it('按 (userId, provider) 取回该用户的凭据', async () => {
    const { userId } = await registerWithOAuth(env.healerbook_timelines, {
      provider: 'fflogs',
      providerUserId: 'get-1',
      name: 'G',
      accessToken: 'g-tok',
      refreshToken: '',
      expiresAt: 1,
    })
    const cred = await getCredential(env.healerbook_timelines, userId, 'fflogs')
    expect(cred?.identifier).toBe('get-1')
    expect(JSON.parse(cred!.data).access_token).toBe('g-tok')
  })

  it('无匹配返回 null', async () => {
    expect(await getCredential(env.healerbook_timelines, 999999999, 'fflogs')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run --config vitest.workers.config.ts userCredentials.workers`
Expected: FAIL（`getCredential` 未导出）。

- [ ] **Step 3: 写实现（追加到 userCredentials.ts）**

```ts
export async function getCredential(
  db: D1Database,
  userId: number,
  provider: string
): Promise<CredentialRow | null> {
  return db
    .prepare(
      'SELECT id, user_id, type, provider, identifier, data, created_at, updated_at FROM user_credentials WHERE user_id = ? AND provider = ?'
    )
    .bind(userId, provider)
    .first<CredentialRow>()
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run --config vitest.workers.config.ts userCredentials.workers`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workers/userCredentials.ts src/workers/userCredentials.workers.test.ts
git commit -m "feat(auth): add getCredential lookup"
```

---

## Task 6: auth callback 接入 loginWithOAuth（sub=my-user-id，落库失败 500）

**Files:**

- Modify: `src/workers/routes/auth.ts:111-128`
- Modify: `src/workers/jwt.ts:16`
- Test: `src/workers/routes/auth.callback.workers.test.ts`

- [ ] **Step 1: 写失败的集成测试**

`src/workers/routes/auth.callback.workers.test.ts`（新建）。stub 全局 `fetch` 拦截 fflogs 的 token 与 user 端点；`SELF.fetch` 走 worker，不受影响：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import { verifyToken } from '@/workers/jwt'

// 让 worker 内部对 fflogs 的两次 fetch 返回可控结果
function stubFFLogs(userId: number, name: string, expiresIn = 3600) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'ff-access',
            token_type: 'Bearer',
            expires_in: expiresIn,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (url.includes('/api/v2/user')) {
        return new Response(
          JSON.stringify({ data: { userData: { currentUser: { id: userId, name } } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
  )
}

async function callback(code: string) {
  return SELF.fetch('https://app/api/auth/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ code }),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('POST /api/auth/callback', () => {
  it('全新 fflogs 用户:建用户、sub=my-user-id(≥1000001)、token 落库', async () => {
    stubFFLogs(777001, 'Newbie')
    const res = await callback('any-code')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user_id: string; name: string; access_token: string }

    const myId = Number(body.user_id)
    expect(myId).toBeGreaterThanOrEqual(1000001)
    expect(body.name).toBe('Newbie')

    // JWT sub 等于 my-user-id(不是 fflogs id 777001)
    const verified = await verifyToken(body.access_token, 'test-secret')
    expect(verified.ok && verified.payload.sub).toBe(body.user_id)

    // 凭据按 fflogs id 落库,user_id=my-user-id,access_token 已写入
    const cred = await env.healerbook_timelines
      .prepare(
        "SELECT user_id, data FROM user_credentials WHERE provider='fflogs' AND identifier='777001'"
      )
      .first<{ user_id: number; data: string }>()
    expect(cred?.user_id).toBe(myId)
    expect(JSON.parse(cred!.data).access_token).toBe('ff-access')
  })

  it('同一 fflogs 账号再次登录:复用 my-user-id', async () => {
    stubFFLogs(777002, 'Repeat')
    const first = (await (await callback('c1')).json()) as { user_id: string }
    stubFFLogs(777002, 'Repeat2')
    const second = (await (await callback('c2')).json()) as { user_id: string; name: string }
    expect(second.user_id).toBe(first.user_id)
    expect(second.name).toBe('Repeat2')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run --config vitest.workers.config.ts auth.callback.workers`
Expected: FAIL（当前 callback `sub`=fflogs id，且无 `user_credentials` 落库 → 凭据查询为空、user_id < 1000001）。

- [ ] **Step 3: 改 jwt.ts 注释**

`src/workers/jwt.ts:16`，把 `AccessTokenPayload.sub` 注释由 fflogs 语义改为 my-user-id：

```ts
export interface AccessTokenPayload extends JWTPayload {
  sub: string // my-user-id（字符串化整数;存量用户 == fflogs id）
  name: string // 显示名（初始取 fflogs name）
  jti: string
}
```

- [ ] **Step 4: 改 auth.ts callback**

`src/workers/routes/auth.ts`，把 `app.post('/callback', ...)` 内 `try { ... } catch { 400 }`（111-128 行）替换为：fflogs 交互失败仍 400，落库失败单独 500：

```ts
const { code } = c.req.valid('json')
let user: { id: number; name: string }
let tokenResponse: FFLogsTokenResponse
try {
  tokenResponse = await exchangeCodeForToken(code, redirectUri, c.env)
  user = await fetchFFLogsUser(tokenResponse.access_token)
} catch (error) {
  console.error('[Auth] callback error:', error)
  return c.json({ error: 'OAuth callback failed' }, 400)
}

const expiresAt = Math.floor(Date.now() / 1000) + tokenResponse.expires_in
let userId: number
try {
  const result = await loginWithOAuth(c.env.healerbook_timelines, {
    provider: 'fflogs',
    providerUserId: String(user.id),
    name: user.name,
    accessToken: tokenResponse.access_token,
    refreshToken: '', // fflogs 授权码流程不下发 refresh_token
    expiresAt,
  })
  userId = result.userId
} catch (error) {
  console.error('[Auth] persist error:', error)
  return c.json({ error: 'Login persistence failed' }, 500)
}

const sub = String(userId)
const [accessToken, refreshToken] = await Promise.all([
  signAccessToken(sub, user.name, c.env.JWT_SECRET),
  signRefreshToken(sub, user.name, c.env.JWT_SECRET),
])
return c.json({
  access_token: accessToken,
  refresh_token: refreshToken,
  name: user.name,
  user_id: sub,
})
```

并在文件顶部 import 处补上：

```ts
import { loginWithOAuth } from '../userCredentials'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm vitest run --config vitest.workers.config.ts auth.callback.workers`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/workers/routes/auth.ts src/workers/jwt.ts src/workers/routes/auth.callback.workers.test.ts
git commit -m "feat(auth): persist user+token on callback, sub=my-user-id"
```

---

## Task 7: 全量门禁

**Files:** 无新增改动，仅验证。

- [ ] **Step 1: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: 无错误。

- [ ] **Step 3: 全量测试（含 workers pool）**

Run: `pnpm test:run`
Expected: 全绿。

- [ ] **Step 4: 构建兜底**

Run: `pnpm build`
Expected: 成功。

---

## Self-Review 记录

- **Spec 覆盖**：§3 表结构→Task1；§4 迁移 seed+回填→Task1；§5 登录/注册流程+落库失败 500→Task6；§6 数据访问模块(find/register/login/get/parse/expiry)→Task2-5；§7 JWT sub 语义→Task6 Step3，前端无需改→已在 File Structure 说明；§9 测试→各任务 TDD + Task7 门禁；§10 风险(D1 失败→500)→Task6。
- **回填验证**：按设计 §4/§9 已删除行数核验要求，故不为回填写集成测试（workers 测试在空库上跑迁移，回填插 0 行）；迁移本身的可应用性由 Task1 schema 测试覆盖。
- **类型一致性**：`OAuthLoginInput` / `CredentialRow` / `OAuthData` 在 Task2-5 间一致；`loginWithOAuth` 返回 `{userId:number, isNew:boolean}`，`auth.ts` 用 `String(userId)` 转 `sub`，与 jwt `sub:string` 一致。
- **占位符扫描**：无 TBD/TODO；每个 code step 含完整代码与确切命令。
