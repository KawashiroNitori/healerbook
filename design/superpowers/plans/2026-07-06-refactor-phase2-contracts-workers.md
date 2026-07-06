# 结构重构第二期：前后端契约收敛 + workers 边界整形 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消灭前后端手写类型副本（新建 `src/types/apiContracts.ts` 单源）、收敛前端/Worker 错误处理与 auth 样板、抽取 editors 数据访问层、拆分 top100Sync 杂物间、归并双份测试基建。

**Architecture:** 契约类型集中到 `src/types/apiContracts.ts` 由前后端共同 import（同仓 TS 源码直连，无 codegen）；workers 侧按「路由 → DAL(`db/`) → 纯计算模块」分层；测试以 workers pool（真实 D1 + migrations）为准，删除手写 D1 mock 套件。

**Tech Stack:** React 19 + TypeScript 5.9、ky、Hono、Cloudflare Workers/D1/KV/DO、Vitest 4（node 套件 + `@cloudflare/vitest-pool-workers` 双轨）。

## Global Constraints

- **验证命令**（每个任务提交前）：`pnpm test:run`、`pnpm test:workers`（凡触碰 `src/workers/` 的任务必跑）、`pnpm exec tsc -b --noEmit`（必须带 `-b`，不带是空检查）、`pnpm lint`；最后一个任务前兜底跑一次 `pnpm build`。
- **提交信息不得包含 "claude" 字样**（大小写不敏感，`.husky/commit-msg` hook 会拒绝）。注意 **"CLAUDE.md" 也命中**——文档提交里用「项目指南」指代。不加 Co-Authored-By。
- 本 plan 内声明的 `git commit` / `git mv` / `git rm` 可自主执行；`git push` 与破坏性 Git 操作（reset --hard 等）任何时候禁止。
- **行为等价**，除以下三处声明的行为变更：
  1. `GET /api/my/timelines` 响应不再返回 `version` 字段（D1 化石字段，恒为 1，前端类型与代码零消费）。
  2. `DELETE /api/timelines/:id` 现在同时清理 `timeline_edit_requests` 孤儿行（原实现遗漏）。
  3. `GET /api/encounter-templates/:encounterId` 响应的 events 不再携带内部字段 `abilityId`（前端类型从未声明、零消费）。
- **明确不改**的现状（重构时保持）：`/api/fflogs/import` 的 502 状态码与外层 try/catch；`/import` 内 statData 提取的容错 try/catch（业务降级逻辑）；`fetchSharedTimeline` 的 `'NOT_FOUND'` 字符串哨兵（`EditorPage.tsx` 精确匹配）与非 404 的 `HTTP ${status}` 文案；`timeline_editors` INSERT 的 `user_name` 语义差异（发布/迁移写空串、approve 写真实名，参数化保留）；`requireSyncToken` 不并入 JWT auth 抽象（机制不同）。
- 文中行号是 2026-07-06 的快照，执行时以实际代码为准。
- 每个任务改动后如涉及类型引用变化，用 grep 验证零残留（各任务内给出具体命令）。

---

### Task 1: workers 测试基建归并（timelines 手写 D1 mock → workers pool）

**Files:**

- Modify: `src/workers/routes/timelines.workers.test.ts`（补 7 个缺口用例）
- Create: `src/workers/routes/my.workers.test.ts`
- Modify: `src/workers/routes/timelines.ts`（仅当敏感词 spy 方案失败时：`export` `generateCleanId`）
- Create: `src/workers/routes/generateCleanId.test.ts`（仅 fallback 分支）
- Delete: `src/workers/timelines.test.ts`（479 行，含私有 makeMockD1 等辅助函数，无其他消费者）

**Interfaces:**

- Consumes: `signAccessToken`（`@/workers/jwt`）、`env`/`SELF`（`cloudflare:test`）、现有 `publishOne` helper 模式
- Produces: 无对外接口；后续任务改 `timelines.ts`/`my.ts` 的 SQL 时不再受手写 mock 的 SQL 文本分派约束

**背景**：`src/workers/timelines.test.ts` 用「按 SQL 文本前缀分派」的手写 D1 mock，任何 SQL 改写都会 `Unhandled SQL in mock`，阻碍后续任务改 SQL。归并以 workers pool（真实 D1 + migrations，`pnpm test:workers`）为准。该文件中「GET /api/timelines（列表）」describe 实际测的是 `my.ts` 路由，需归入新建的 `my.workers.test.ts`。

- [ ] **Step 1: 在 `timelines.workers.test.ts` 补 5 个直接迁移用例**

参考文件内既有的 `publishOne`/`authorJwt` helper，新增一个 describe：

```ts
describe('POST/DELETE 校验与鉴权（自手写 mock 套件迁移）', () => {
  it('POST 无 Authorization 头返回 401', async () => {
    const res = await SELF.fetch('https://app/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'no-auth-post', name: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  it('POST id 为空字符串返回 400', async () => {
    const res = await SELF.fetch('https://app/api/timelines', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await authorJwt()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '', name: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST id 超过 64 字符返回 400', async () => {
    const res = await SELF.fetch('https://app/api/timelines', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await authorJwt()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x'.repeat(65), name: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST id 已存在返回 409 id_taken', async () => {
    await publishOne('dup-id-409', 'first')
    const res = await SELF.fetch('https://app/api/timelines', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await authorJwt()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'dup-id-409', name: 'second' }),
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('id_taken')
  })

  it('DELETE 未登录返回 401', async () => {
    await publishOne('del-noauth', 'x')
    const res = await SELF.fetch('https://app/api/timelines/del-noauth', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: 敏感词换发两用例——先试 spy 方案**

workers pool 测试环境未配置 `SENSITIVE_WORDS_HMAC_KEY` binding，真实过滤器恒返回 false，无法自然触发换发分支。先尝试模块 spy + Hono 直接派发（同 isolate，绕过 SELF 的 fetch 边界）：

```ts
import { app } from '@/workers/index'
import * as sensitiveWordFilter from '@/workers/sensitiveWordFilter'
import { vi } from 'vitest'

describe('POST 敏感词 id 换发', () => {
  it('客户端 id 命中敏感词时服务端换发干净 id', async () => {
    const spy = vi
      .spyOn(sensitiveWordFilter, 'containsBannedSubstring')
      .mockResolvedValueOnce(true) // 请求的 id 命中
      .mockResolvedValue(false) // 后续候选全部干净
    try {
      const res = await app.request(
        'https://app/api/timelines',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await authorJwt()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: 'banned-id', name: 'x' }),
        },
        env
      )
      expect(res.status).toBe(201)
      const body = (await res.json()) as { id: string }
      expect(body.id).not.toBe('banned-id')
    } finally {
      spy.mockRestore()
    }
  })

  it('重生成 32 次仍全命中时返回 500 id_generation_failed', async () => {
    const spy = vi.spyOn(sensitiveWordFilter, 'containsBannedSubstring').mockResolvedValue(true)
    try {
      const res = await app.request(
        'https://app/api/timelines',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await authorJwt()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: 'always-banned', name: 'x' }),
        },
        env
      )
      expect(res.status).toBe(500)
      expect(((await res.json()) as { error: string }).error).toBe('id_generation_failed')
    } finally {
      spy.mockRestore()
    }
  })
})
```

跑 `pnpm test:workers`。若 `vi.spyOn` 在 workers pool 下对 ESM namespace 报错（如 "not extensible" / spy 未生效），**转 Step 2b fallback**，删除上面两个用例。

- [ ] **Step 2b（仅 spy 失败时）: fallback——node 侧单测 `generateCleanId`**

`src/workers/routes/timelines.ts` 中把 `async function generateCleanId(...)` 改为 `export async function generateCleanId(...)`。新建 `src/workers/routes/generateCleanId.test.ts`（node 套件，`vitest.config.ts` 的 alias stub 使 workers 模块可在 node 下 import）：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../sensitiveWordFilter', () => ({
  containsBannedSubstring: vi.fn(),
}))

import { generateCleanId } from './timelines'
import * as sensitiveWordFilter from '../sensitiveWordFilter'

const mockContains = vi.mocked(sensitiveWordFilter.containsBannedSubstring)
const fakeEnv = {} as Parameters<typeof generateCleanId>[0]

describe('generateCleanId', () => {
  beforeEach(() => mockContains.mockReset())

  it('候选命中敏感词时继续重试，返回第一个干净 id', async () => {
    mockContains.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false)
    const id = await generateCleanId(fakeEnv)
    expect(id).toBeTruthy()
    expect(mockContains).toHaveBeenCalledTimes(3)
  })

  it('连续 32 次全命中时抛 id_generation_failed', async () => {
    mockContains.mockResolvedValue(true)
    await expect(generateCleanId(fakeEnv)).rejects.toThrow('id_generation_failed')
    expect(mockContains).toHaveBeenCalledTimes(32)
  })
})
```

并在任务报告中注明：路由层「换发后 201 + 不同 id」的端到端断言因 workers pool mock 限制降级为函数级覆盖。

- [ ] **Step 3: 新建 `src/workers/routes/my.workers.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@/workers/jwt'

const JWT_SECRET = 'test-secret'

async function jwtFor(userId: string, name: string): Promise<string> {
  return signAccessToken(userId, name, JWT_SECRET)
}

async function publishAs(userId: string, name: string, id: string): Promise<void> {
  const res = await SELF.fetch('https://app/api/timelines', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await jwtFor(userId, name)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id, name: `tl-${id}` }),
  })
  if (res.status !== 201) throw new Error(`publishAs failed: ${res.status}`)
}

describe('GET /api/my/timelines', () => {
  it('未登录返回 401', async () => {
    const res = await SELF.fetch('https://app/api/my/timelines')
    expect(res.status).toBe(401)
  })

  it('无记录返回空数组', async () => {
    const res = await SELF.fetch('https://app/api/my/timelines', {
      headers: { Authorization: `Bearer ${await jwtFor('nobody-1', 'Nobody')}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('只返回该用户的时间轴，按 updated_at 倒序', async () => {
    await publishAs('u1', 'User1', 'my-a1')
    await publishAs('u1', 'User1', 'my-a2')
    await publishAs('u2', 'User2', 'my-b1')
    // 发布在同一秒内 updated_at 相同，直接改 D1 制造确定顺序
    await env.healerbook_timelines
      .prepare('UPDATE timelines SET updated_at = ? WHERE id = ?')
      .bind(1000, 'my-a1')
      .run()
    await env.healerbook_timelines
      .prepare('UPDATE timelines SET updated_at = ? WHERE id = ?')
      .bind(2000, 'my-a2')
      .run()

    const res = await SELF.fetch('https://app/api/my/timelines', {
      headers: { Authorization: `Bearer ${await jwtFor('u1', 'User1')}` },
    })
    const items = (await res.json()) as { id: string }[]
    expect(items.map(i => i.id)).toEqual(['my-a2', 'my-a1'])
  })

  it('阵容优先读 content.composition，回退旧格式 content.c 并过滤空槽位', async () => {
    await publishAs('u3', 'User3', 'my-comp-new')
    await publishAs('u3', 'User3', 'my-comp-old')
    await env.healerbook_timelines
      .prepare('UPDATE timelines SET content = ? WHERE id = ?')
      .bind(JSON.stringify({ composition: { players: [{ id: 0, job: 'WHM' }] } }), 'my-comp-new')
      .run()
    await env.healerbook_timelines
      .prepare('UPDATE timelines SET content = ? WHERE id = ?')
      .bind(JSON.stringify({ c: ['SCH', '', 'AST'] }), 'my-comp-old')
      .run()

    const res = await SELF.fetch('https://app/api/my/timelines', {
      headers: { Authorization: `Bearer ${await jwtFor('u3', 'User3')}` },
    })
    const items = (await res.json()) as {
      id: string
      composition: { players: { id: number; job: string }[] } | null
    }[]
    const byId = new Map(items.map(i => [i.id, i]))
    expect(byId.get('my-comp-new')!.composition).toEqual({ players: [{ id: 0, job: 'WHM' }] })
    expect(byId.get('my-comp-old')!.composition).toEqual({
      players: [
        { id: 0, job: 'SCH' },
        { id: 2, job: 'AST' },
      ],
    })
  })
})
```

注意：不断言 `version` 字段的存在与否（Task 2 会移除它，届时补断言）。

- [ ] **Step 4: 运行 workers 测试确认全绿**

Run: `pnpm test:workers`
Expected: 全部通过，含新增用例。

- [ ] **Step 5: 删除手写 mock 套件**

```bash
git rm src/workers/timelines.test.ts
```

`makeMockD1` 等辅助函数是该文件私有的，`samplesQueue.test.ts` / `top100Sync.test.ts` 各自维护独立 mock，不受影响。**不要**改动 `vitest.config.ts` 的 `**/*.workers.test.ts` exclude。

- [ ] **Step 6: 验证 + Commit**

Run: `pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。

```bash
git add -A
git commit -m "test(workers): timelines 手写 D1 mock 套件归并到 workers pool，补 my 路由缺口"
```

---

### Task 2: 新建 apiContracts.ts —— 我的列表契约单源 + 停止返回 version

**Files:**

- Create: `src/types/apiContracts.ts`
- Modify: `src/workers/routes/my.ts`
- Modify: `src/api/timelineShareApi.ts`（删除 `MyTimelineItem`）
- Modify: `src/pages/homeTimelineList.ts`、`src/pages/homeTimelineList.test.ts`（import 改指向）
- Modify: `src/workers/routes/my.workers.test.ts`（补 version 缺席断言）

**Interfaces:**

- Consumes: `Composition`（`@/types/timeline`）
- Produces: `MyTimelineListItem`（后续任务与前端消费方使用；`export interface MyTimelineListItem { id: string; name: string; publishedAt: number; updatedAt: number; composition: Composition | null }`）

**声明的行为变更**：响应不再含 `version` 字段（恒为 1、前端零消费，见 Global Constraints）。

- [ ] **Step 1: 创建 `src/types/apiContracts.ts`**

```ts
/**
 * 前后端共享的 API 契约类型 —— 各端点请求/响应形状的唯一来源。
 *
 * Workers 路由构造响应时显式标注这些类型，前端 api 客户端以同一类型解析，
 * 使两端字段漂移在编译期暴露。D1 行影子类型（snake_case）与 KV 持久化结构
 * 不属于契约，留在各自模块内部。
 */

import type { Composition } from './timeline'

/** GET /api/my/timelines 的列表项 */
export interface MyTimelineListItem {
  id: string
  name: string
  publishedAt: number
  updatedAt: number
  /** 服务端已对旧格式 content.c 做归一化 */
  composition: Composition | null
}
```

- [ ] **Step 2: `src/workers/routes/my.ts` 改用契约类型并去掉 version**

- 删除本地 `interface TimelineListItem`，改 `import type { MyTimelineListItem } from '@/types/apiContracts'`。
- `DbListRow` 保留在文件内（D1 行影子类型），但删除其 `version: number` 字段。
- SELECT 语句去掉 `version` 列：`'SELECT id, name, published_at, updated_at, content FROM timelines WHERE author_id = ? ORDER BY updated_at DESC'`。
- map 回调中删除 `version: r.version,` 一行，`items` 类型标注改为 `MyTimelineListItem[]`。
- `composition` 归一化结果目前推导为宽类型，赋给 `Composition | null` 需要断言：在 map 返回对象上写 `composition: composition as MyTimelineListItem['composition'],`（服务端不校验 content 内容，维持现状的信任边界）。

- [ ] **Step 3: 前端消费方改指向**

- `src/api/timelineShareApi.ts`：删除 `export interface MyTimelineItem {...}`，顶部 `import type { MyTimelineListItem } from '@/types/apiContracts'`，`fetchMyTimelines` 签名与 `.json<...>()` 泛型改用 `MyTimelineListItem`。
- `src/pages/homeTimelineList.ts` 与 `homeTimelineList.test.ts`：`import type { MyTimelineItem } from '@/api/timelineShareApi'` 改为 `import type { MyTimelineListItem } from '@/types/apiContracts'`，文件内引用同步改名。

Run: `grep -rn "MyTimelineItem" src/`
Expected: 零命中。

- [ ] **Step 4: workers 测试补断言**

`my.workers.test.ts` 的「只返回该用户」用例中，对第一个 item 增加：

```ts
expect('version' in items[0]).toBe(false)
```

- [ ] **Step 5: 验证 + Commit**

Run: `pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。

```bash
git add -A
git commit -m "refactor(contracts): 新建 apiContracts.ts，我的列表契约单源并停止返回 version 化石字段"
```

---

### Task 3: SharedTimelineResponse / ShareRoleInfo 收敛（消灭 5 份手写副本）

**Files:**

- Modify: `src/types/apiContracts.ts`（追加两个类型）
- Modify: `src/workers/routes/timelines.ts`（GET /:id 响应显式标注）
- Modify: `src/api/timelineShareApi.ts`（删除 `RawSharedResponse` 与本地 `SharedTimelineResponse`）
- Modify: `src/pages/EditorPage.tsx`（内联 shareRole 类型 → `ShareRoleInfo`）
- Modify: `src/components/EditorToolbar.tsx`（本地 `ShareRole` → `ShareRoleInfo`）

**Interfaces:**

- Consumes: `Timeline`（`@/types/timeline`）
- Produces:
  - `ShareRoleInfo`：`{ role: 'editor' | 'viewer'; isAuthor: boolean; allowEditRequests: boolean; hasPendingRequest: boolean }`
  - `SharedTimelineResponse extends ShareRoleInfo`：`{ authorName: string; pendingRequestCount: number; snapshot?: Timeline }`

- [ ] **Step 1: `apiContracts.ts` 追加类型**

```ts
/** GET /api/timelines/:id 的角色子集（EditorPage/EditorToolbar 透传用） */
export interface ShareRoleInfo {
  role: 'editor' | 'viewer'
  isAuthor: boolean
  allowEditRequests: boolean
  hasPendingRequest: boolean
}

/** GET /api/timelines/:id 的完整角色化响应 */
export interface SharedTimelineResponse extends ShareRoleInfo {
  authorName: string
  /** 作者视角:当前待处理的申请数;非作者恒 0 */
  pendingRequestCount: number
  /** KV snapshot;三角色通用。editor/author 用于首屏兜底渲染,KV miss 时为 undefined */
  snapshot?: Timeline
}
```

文件顶部 import 追加 `Timeline`：`import type { Composition, Timeline } from './timeline'`。

- [ ] **Step 2: workers 侧 GET /:id 显式标注**

`src/workers/routes/timelines.ts` 的 GET `/:id` handler 内（以实际代码为准）：

- 顶部 `import type { SharedTimelineResponse } from '@/types/apiContracts'`，并 `import type { Timeline } from '@/types/timeline'`。
- `const base = {...}` 改为 `const base: Omit<SharedTimelineResponse, 'snapshot'> = {...}`（字段不变）。
- `const body = snapshot ? { ...base, snapshot } : base` 改为：

```ts
const body: SharedTimelineResponse = snapshot ? { ...base, snapshot: snapshot as Timeline } : base
```

（snapshot 来自 KV JSON / DO 投影，运行时形状由写入方保证，此处 as 是把「隐式无类型」显式化，不引入新的信任假设。）

- [ ] **Step 3: 前端 `timelineShareApi.ts` 去副本**

- 删除本地 `export interface SharedTimelineResponse {...}` 与 `interface RawSharedResponse {...}` 两个定义。
- `import type { SharedTimelineResponse } from '@/types/apiContracts'` 并 re-export 供既有消费者：`export type { SharedTimelineResponse }`。
- `fetchSharedTimeline` 内 `.json<RawSharedResponse>()` 改为 `.json<SharedTimelineResponse>()`；raw → result 的逐字段映射体保留（`pendingRequestCount ?? 0` 的运行时兜底继续保留——KV 里可能存有旧格式 envelope；`snapshot` 补 `id/statusEvents/annotations` 的逻辑不变）。`raw.pendingRequestCount ?? 0` 在类型上 `number ?? 0` 合法，保留即可。

- [ ] **Step 4: EditorPage / EditorToolbar 改用 `ShareRoleInfo`**

- `src/pages/EditorPage.tsx`：`import type { ShareRoleInfo } from '@/types/apiContracts'`；`useState<{ role: ...; isAuthor: ...; allowEditRequests: ...; hasPendingRequest: ... }>` 的内联对象类型改为 `useState<ShareRoleInfo>(...)`（初始值字面量不变）。
- `src/components/EditorToolbar.tsx`：删除本地 `interface ShareRole {...}`，`import type { ShareRoleInfo } from '@/types/apiContracts'`，`EditorToolbarProps.shareRole: ShareRoleInfo`；文件内其余 `ShareRole` 引用同步改名。

Run: `grep -rn "RawSharedResponse\|interface ShareRole\b" src/`
Expected: 零命中。

- [ ] **Step 5: 验证 + Commit**

Run: `pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。

```bash
git add -A
git commit -m "refactor(contracts): GET timelines/:id 契约收敛 SharedTimelineResponse/ShareRoleInfo，消灭 5 份手写副本"
```

---

### Task 4: Top100 契约收敛 + 裸 fetch 抽取 src/api/top100.ts

**Files:**

- Modify: `src/types/apiContracts.ts`（追加 `RankingEntry` / `Top100Data` / `Top100AllResponse`）
- Modify: `src/workers/fflogsClientV2.ts`（`RankingEntry` 定义迁出）
- Modify: `src/workers/top100Sync.ts`（`Top100Data` 定义迁出）
- Modify: `src/workers/routes/top100.ts`、`src/workers/samplesQueue.ts`、`src/workers/top100Sync.test.ts` 等（import 改指向，按 grep 结果为准）
- Create: `src/api/top100.ts`
- Modify: `src/components/Top100Section.tsx`（删除本地类型 + 裸 fetch）

**Interfaces:**

- Consumes: `apiClient`（`@/api/apiClient`，prefixUrl `/api`）
- Produces:
  - `RankingEntry`（14 字段，原文迁移自 `fflogsClientV2.ts`）、`Top100Data`（4 字段，原文迁移自 `top100Sync.ts`）
  - `Top100AllResponse = Record<number, Top100Data | null>`
  - `fetchTop100All(): Promise<Top100AllResponse>`（`src/api/top100.ts`）

- [ ] **Step 1: `apiContracts.ts` 追加类型**

把 `src/workers/fflogsClientV2.ts` 的 `export interface RankingEntry {...}`（含注释原文）与 `src/workers/top100Sync.ts` 的 `export interface Top100Data {...}`（含注释原文）整体迁入 `apiContracts.ts`，并追加：

```ts
/** GET /api/top100 的响应体：encounterId → 数据；KV 未同步时为 null。
 *  JSON 序列化后对象 key 实为字符串，Record<number, ...> 是语义标注，结构兼容。 */
export type Top100AllResponse = Record<number, Top100Data | null>
```

- [ ] **Step 2: workers 侧 import 改指向**

- `fflogsClientV2.ts`：删除本地 `RankingEntry` 定义，`import type { RankingEntry } from '@/types/apiContracts'`；若文件内有基于它的其他导出保持不变。
- `top100Sync.ts`：删除本地 `Top100Data` 定义，import 自 `@/types/apiContracts`。
- 全仓 grep 修复其余引用（`routes/top100.ts` 的 `type Top100Data` import、`samplesQueue.ts`、`top100Sync.test.ts` 等）：

Run: `grep -rn "RankingEntry\|Top100Data" src/ | grep -v apiContracts`
Expected: 所有命中处的 import 均来自 `@/types/apiContracts`（直接或经由仍然合法的转手模块——不允许留下重复定义）。

- [ ] **Step 3: 新建 `src/api/top100.ts`**

```ts
import { apiClient } from './apiClient'
import type { Top100AllResponse } from '@/types/apiContracts'

/** 获取全部副本的 TOP100 榜单（公开端点） */
export async function fetchTop100All(): Promise<Top100AllResponse> {
  return apiClient.get('top100').json<Top100AllResponse>()
}
```

- [ ] **Step 4: `Top100Section.tsx` 去内联类型与裸 fetch**

- 删除本地 `interface RankingEntry` / `interface Top100Data`（`// ---- 类型定义 ----` 注释一并删）、`const API_BASE = ...` 与本地 `async function fetchTop100All(...)`。
- 顶部：`import { fetchTop100All } from '@/api/top100'`、`import type { Top100Data, RankingEntry } from '@/types/apiContracts'`（按文件内实际引用保留需要的）。
- `useQuery` 的 `queryFn: fetchTop100All` 不变；原返回类型 `Record<string, Top100Data | null>` 处如有显式标注改为 `Top100AllResponse`，索引访问 `data[encounter.id]` 不需要改（number 索引 Record<number,...> 合法）。

Run: `grep -rn "VITE_API_BASE_URL" src/components/Top100Section.tsx`
Expected: 零命中。

- [ ] **Step 5: 验证 + Commit**

Run: `pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。

```bash
git add -A
git commit -m "refactor(contracts): Top100 契约单源，Top100Section 裸 fetch 收敛到 apiClient"
```

---

### Task 5: EncounterTemplateResponse 契约收敛

**Files:**

- Modify: `src/types/apiContracts.ts`（追加 `EncounterTemplateResponse`）
- Modify: `src/api/encounterTemplate.ts`（删除本地定义）
- Modify: `src/components/CreateTimelineDialog.tsx`（type import 改指向）
- Modify: `src/workers/top100Sync.ts`（`handleGetEncounterTemplate` 响应显式标注 + 裁掉 `abilityId`）

**Interfaces:**

- Consumes: `DamageEvent`（`@/types/timeline`）
- Produces: `EncounterTemplateResponse`：`{ events: DamageEvent[]; updatedAt: string | null; templateSourceDurationMs: number | null; kill: boolean }`

**声明的行为变更**：响应 events 不再携带内部字段 `abilityId`（见 Global Constraints）。

- [ ] **Step 1: `apiContracts.ts` 追加**

```ts
/** GET /api/encounter-templates/:encounterId 的响应体（不含 encounterId，由调用方自行持有） */
export interface EncounterTemplateResponse {
  events: DamageEvent[]
  updatedAt: string | null
  /** 模板来源战斗的时长（毫秒），即当前进度最长那次；无模板时为 null */
  templateSourceDurationMs: number | null
  /** 模板来源战斗是否为击杀；为 true 时前端显示"已更新完成"而非时长进度条 */
  kill: boolean
}
```

顶部 import 追加 `DamageEvent`。

- [ ] **Step 2: 前端改指向**

- `src/api/encounterTemplate.ts`：删除本地 `export interface EncounterTemplateResponse {...}`，改为 `import type { EncounterTemplateResponse } from '@/types/apiContracts'` + `export type { EncounterTemplateResponse }`（保持 `CreateTimelineDialog.tsx` 的既有 import 路径可用，或直接改 CreateTimelineDialog 的 import 指向 apiContracts——二选一，取 diff 更小者）。

- [ ] **Step 3: workers 侧显式标注 + 裁字段**

`src/workers/top100Sync.ts` 的 `handleGetEncounterTemplate`：

```ts
import type { EncounterTemplateResponse } from '@/types/apiContracts'

// 无数据分支
const empty: EncounterTemplateResponse = {
  events: [],
  updatedAt: null,
  templateSourceDurationMs: null,
  kill: false,
}
// 有数据分支：裁掉内部字段 abilityId，使线上响应与契约一致
const body: EncounterTemplateResponse = {
  events: template.events.map(({ abilityId: _abilityId, ...e }) => e),
  updatedAt: template.updatedAt,
  templateSourceDurationMs: template.templateSourceDurationMs,
  kill: template.kill ?? false,
}
```

两个分支的 `JSON.stringify(...)` 参数改为上述具名变量，headers 不变。`EncounterTemplate`（KV 持久化结构，含 `encounterId`/`abilityId`）保留在 workers 模块内部，**不进契约**。

- [ ] **Step 4: 验证 + Commit**

Run: `pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿（`top100Sync.test.ts` 若断言了响应含 abilityId 需同步更新——以测试实际内容为准，裁剪是本任务声明的行为变更）。

```bash
git add -A
git commit -m "refactor(contracts): encounter template 契约单源，响应裁掉内部字段 abilityId"
```

---

### Task 6: 抽取 unwrapApiError，收敛前端 HTTPError 样板

**Files:**

- Create: `src/api/unwrapApiError.ts`
- Create: `src/api/unwrapApiError.test.ts`
- Modify: `src/api/timelineShareApi.ts`（9 处 catch 收敛）
- Modify: `src/api/statistics.ts`（1 处收敛）

**Interfaces:**

- Consumes: `HTTPError`（`ky`）；`apiClient` 的 `beforeError` hook 已把 `err.message` 解析为可读文案
- Produces: `unwrapApiError<T>(fn, options?)`，签名见 Step 1

**硬约束**：`fetchSharedTimeline` 的 `'NOT_FOUND'` 哨兵（`EditorPage.tsx` 用 `err.message === 'NOT_FOUND'` 精确匹配）与非 404 的 `HTTP ${status}` 文案逐字保留；`fetchMyTimelines` 401→`[]`；`statistics.ts` 非 404 rethrow **原始 HTTPError**（不转普通 Error）。

- [ ] **Step 1: 写失败测试 `src/api/unwrapApiError.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { HTTPError } from 'ky'
import { unwrapApiError } from './unwrapApiError'

function makeHttpError(status: number, message: string): HTTPError {
  const err = Object.create(HTTPError.prototype) as HTTPError
  Object.defineProperty(err, 'response', { value: { status } })
  Object.defineProperty(err, 'message', { value: message, writable: true })
  return err
}

describe('unwrapApiError', () => {
  it('成功时透传返回值', async () => {
    await expect(unwrapApiError(async () => 42)).resolves.toBe(42)
  })

  it('HTTPError 默认转 new Error(err.message)', async () => {
    const p = unwrapApiError(async () => {
      throw makeHttpError(500, 'server exploded')
    })
    await expect(p).rejects.toThrow('server exploded')
    await expect(p).rejects.not.toBeInstanceOf(HTTPError)
  })

  it('非 HTTPError 原样 rethrow', async () => {
    const raw = new TypeError('network down')
    await expect(
      unwrapApiError(async () => {
        throw raw
      })
    ).rejects.toBe(raw)
  })

  it('onStatus 命中时返回替代值而不抛错', async () => {
    const result = await unwrapApiError<number[]>(
      async () => {
        throw makeHttpError(401, 'unauthorized')
      },
      { onStatus: { 401: () => [] } }
    )
    expect(result).toEqual([])
  })

  it('mapMessage 定制抛出的文案', async () => {
    const p = unwrapApiError(
      async () => {
        throw makeHttpError(404, 'ignored')
      },
      {
        mapMessage: err =>
          err.response.status === 404 ? 'NOT_FOUND' : `HTTP ${err.response.status}`,
      }
    )
    await expect(p).rejects.toThrow('NOT_FOUND')
  })

  it('rethrowOriginal 时保留原始 HTTPError', async () => {
    const raw = makeHttpError(500, 'boom')
    await expect(
      unwrapApiError(
        async () => {
          throw raw
        },
        { onStatus: { 404: () => null }, rethrowOriginal: true }
      )
    ).rejects.toBe(raw)
  })
})
```

Run: `pnpm test:run unwrapApiError`
Expected: FAIL（模块不存在）。

- [ ] **Step 2: 实现 `src/api/unwrapApiError.ts`**

```ts
import { HTTPError } from 'ky'

interface UnwrapOptions<T> {
  /** 状态码 → 返回替代值（不抛错），如 401 时返回空列表 */
  onStatus?: Record<number, () => T>
  /** 定制 HTTPError 转出的 message；默认沿用 err.message（apiClient beforeError 已解析为可读文案） */
  mapMessage?: (err: HTTPError) => string
  /** true 时把未被 onStatus 消化的 HTTPError 原样 rethrow，而不是转 new Error */
  rethrowOriginal?: boolean
}

/**
 * 统一处理 ky 请求错误：非 HTTPError（网络/超时）一律原样 rethrow；
 * HTTPError 按 onStatus → rethrowOriginal → mapMessage/err.message 的顺序处理。
 * 抛出普通 Error 是刻意为之：调用方（组件/toast）只消费 message，不需要 response 细节。
 */
export async function unwrapApiError<T>(
  fn: () => Promise<T>,
  options?: UnwrapOptions<T>
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (!(err instanceof HTTPError)) throw err
    const handler = options?.onStatus?.[err.response.status]
    if (handler) return handler()
    if (options?.rethrowOriginal) throw err
    throw new Error(options?.mapMessage ? options.mapMessage(err) : err.message)
  }
}
```

Run: `pnpm test:run unwrapApiError`
Expected: PASS。

- [ ] **Step 3: 替换 `timelineShareApi.ts` 全部 9 处**

逐函数改写（保持导出签名与语义不变）：

- 7 处字面重复（`publishTimeline` / `deleteSharedTimeline` / `fetchShareState` / `setAllowEditRequests` / `requestEditPermission` / `approveEditRequest` / `rejectEditRequest` / `removeEditor`——以实际为准，共 7-8 个函数）：删除 try/catch，函数体包一层。示例：

```ts
export async function publishTimeline(
  id: string,
  name: string,
  content?: string
): Promise<PublishResult> {
  return unwrapApiError(() =>
    apiClient
      .post('timelines', { json: content ? { id, name, content } : { id, name } })
      .json<PublishResult>()
  )
}
```

- `fetchMyTimelines`：

```ts
export async function fetchMyTimelines(): Promise<MyTimelineListItem[]> {
  return unwrapApiError(() => apiClient.get('my/timelines').json<MyTimelineListItem[]>(), {
    onStatus: { 401: () => [] },
  })
}
```

- `fetchSharedTimeline`：raw→result 映射体整体挪进 `unwrapApiError` 的 fn 内，catch 分支删除，用：

```ts
return unwrapApiError(
  async () => {
    const raw = await apiClient.get(`timelines/${id}`).json<SharedTimelineResponse>()
    /* ...既有映射逻辑原样保留... */
    return result
  },
  {
    mapMessage: err => (err.response.status === 404 ? 'NOT_FOUND' : `HTTP ${err.response.status}`),
  }
)
```

- 顶部删除不再使用的 `HTTPError` import（若已无引用）。

- [ ] **Step 4: 替换 `statistics.ts`**

```ts
export async function getEncounterStatistics(
  encounterId: number
): Promise<EncounterStatistics | null> {
  return unwrapApiError<EncounterStatistics | null>(
    () => apiClient.get(`statistics/${encounterId}`).json<EncounterStatistics>(),
    { onStatus: { 404: () => null }, rethrowOriginal: true }
  )
}
```

Run: `grep -rn "instanceof HTTPError" src/api/`
Expected: 仅 `apiClient.ts`（beforeError hook）、`unwrapApiError.ts` 与 `fflogsClient.ts`（不同模式，本期不动，见路线图）可命中。

- [ ] **Step 5: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。

```bash
git add -A
git commit -m "refactor(api): 抽取 unwrapApiError，收敛 timelineShareApi/statistics 的 HTTPError 样板"
```

---

### Task 7: 抽取 readAuthFromHeader，去重 auth 中间件

**Files:**

- Create: `src/workers/middleware/readAuthFromHeader.ts`
- Modify: `src/workers/middleware/requireAuth.ts`
- Delete: `src/workers/middleware/tryReadAuth.ts`
- Modify: `src/workers/routes/timelines.ts`（唯一 tryReadAuth 调用方改 import）

**Interfaces:**

- Consumes: `verifyToken`（`../jwt`）、`Context<AppEnv>`（hono）
- Produces: `readAuthFromHeader(c: Context<AppEnv>): Promise<{ userId: string; username: string } | null>`

- [ ] **Step 1: 新建 `src/workers/middleware/readAuthFromHeader.ts`**

```ts
import type { Context } from 'hono'
import type { AppEnv } from '../env'
import { verifyToken } from '../jwt'

/**
 * 从 Authorization 头解析并校验 JWT，返回身份信息或 null。
 * 无响应/context 副作用——失败时如何处理由调用方决定：
 * requireAuth 转 401；公开路由（如 GET timelines/:id）降级为匿名 viewer。
 */
export async function readAuthFromHeader(
  c: Context<AppEnv>
): Promise<{ userId: string; username: string } | null> {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ') || !c.env.JWT_SECRET) return null
  const token = header.slice(7)
  const result = await verifyToken(token, c.env.JWT_SECRET)
  if (!result.ok || !result.payload.sub) return null
  const name = (result.payload as { name?: string }).name ?? ''
  return { userId: result.payload.sub, username: name }
}
```

- [ ] **Step 2: 改写 `requireAuth.ts`**

```ts
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'
import { readAuthFromHeader } from './readAuthFromHeader'

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = await readAuthFromHeader(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  c.set('auth', auth)
  await next()
}
```

- [ ] **Step 3: 迁移唯一调用方并删除 tryReadAuth.ts**

- `src/workers/routes/timelines.ts`：`import { tryReadAuth } from '../middleware/tryReadAuth'` 改为 `import { readAuthFromHeader } from '../middleware/readAuthFromHeader'`，调用点 `await tryReadAuth(c)` 改 `await readAuthFromHeader(c)`。
- `git rm src/workers/middleware/tryReadAuth.ts`

Run: `grep -rn "tryReadAuth" src/`
Expected: 零命中（文档引用在 Task 12 统一处理，src 内必须为零）。

- [ ] **Step 4: 验证 + Commit**

Run: `pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿（requireAuth 行为由 timelines/share/my 的 workers 测试覆盖：401 用例 + 正常带 token 用例）。

```bash
git add -A
git commit -m "refactor(workers): 抽取 readAuthFromHeader，requireAuth/tryReadAuth 共用 JWT 解析"
```

---

### Task 8: fflogs.ts 冗余 try/catch 清理（仅两处）

**Files:**

- Modify: `src/workers/routes/fflogs.ts`

**Interfaces:**

- Consumes: `index.ts` 的全局 `app.onError`（500 + `{ error: err.message }`）
- Produces: 无

**范围纪律**：只删 `GET /report/:reportCode` 与 `GET /events/:reportCode` 两处 try/catch（删除后行为等价：两端点错误来源均为 `throw new Error(...)`，onError 同样产出 500 + `{error: message}`；`'Unknown error'`→`'Internal Server Error'` 的兜底文案差异仅在抛非 Error 值时可观察，实践不可达）。**`GET /import` 的外层 try/catch（502 语义）与内层 statData try/catch（容错降级）禁止触碰**；其他 routes 文件的 try/catch 均承载业务语义，不在本任务范围。

- [ ] **Step 1: 改写两个 handler**

```ts
app.get('/report/:reportCode', async c => {
  const reportCode = c.req.param('reportCode')
  const client = createClient(c.env)
  const data = await client.getReport({ reportCode })
  return c.json(data)
})

app.get('/events/:reportCode', async c => {
  const reportCode = c.req.param('reportCode')
  const start = c.req.query('start')
  const end = c.req.query('end')

  if (!start || !end) {
    return c.json({ error: 'Missing start or end parameter' }, 400)
  }

  const client = createClient(c.env)
  const data = await client.getEvents({
    reportCode,
    start: parseFloat(start),
    end: parseFloat(end),
  })
  return c.json(data)
})
```

- [ ] **Step 2: 验证 + Commit**

Run: `pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。

```bash
git add src/workers/routes/fflogs.ts
git commit -m "refactor(workers): fflogs report/events 冗余 try/catch 交给全局 onError"
```

---

### Task 9: 抽取 editors 数据访问层 src/workers/db/editors.ts

**Files:**

- Create: `src/workers/db/editors.ts`
- Modify: `src/workers/routes/timelines.ts`（3 处 + DELETE 补清理）
- Modify: `src/workers/routes/share.ts`（6 处）
- Modify: `src/workers/durable/TimelineDoc.ts`（2 处）
- Modify: `src/workers/routes/internalMigrate.ts`（1 处）
- Modify: `src/workers/routes/timelines.workers.test.ts`（DELETE 清理申请行的新断言）

**Interfaces:**

- Consumes: `D1Database` / `D1PreparedStatement`（workers-types）
- Produces（后续任务与全部调用方依赖的精确签名）:
  - `isEditor(db: D1Database, timelineId: string, userId: string): Promise<boolean>`
  - `listEditors(db: D1Database, timelineId: string, excludeUserId?: string): Promise<{ userId: string; userName: string }[]>`
  - `insertEditorStatement(db: D1Database, timelineId: string, userId: string, userName?: string): D1PreparedStatement`
  - `deleteAllEditors(db: D1Database, timelineId: string): Promise<void>`
  - `removeEditor(db: D1Database, timelineId: string, userId: string): Promise<void>`
  - `hasPendingEditRequest(db: D1Database, timelineId: string, userId: string): Promise<boolean>`
  - `countPendingEditRequests(db: D1Database, timelineId: string): Promise<number>`
  - `listEditRequests(db: D1Database, timelineId: string): Promise<{ userId: string; userName: string; createdAt: number }[]>`
  - `findEditRequest(db: D1Database, timelineId: string, userId: string): Promise<{ userName: string } | null>`
  - `insertEditRequestStatement(db: D1Database, timelineId: string, userId: string, userName: string): D1PreparedStatement`
  - `deleteEditRequestStatement(db: D1Database, timelineId: string, userId: string): D1PreparedStatement`
  - `deleteAllEditRequests(db: D1Database, timelineId: string): Promise<void>`

**设计要点**：写操作凡参与 `db.batch([...])` 事务的（approve 场景「删申请+加编辑者」必须原子）提供返回 `D1PreparedStatement` 的 `xxxStatement` 变体，由调用方决定 `.run()` 或拼 batch。参数收窄为 `D1Database`（路由传 `c.env.healerbook_timelines`，DO 传 `this.env.healerbook_timelines`，与既有 `samplesQueue.ts` 的 DAL 先例一致）。

**声明的行为变更**：`DELETE /api/timelines/:id` 同时清理 `timeline_edit_requests`（原实现遗漏孤儿行）。

- [ ] **Step 1: 先写失败测试（DELETE 清理申请行）**

`timelines.workers.test.ts` 的 DELETE describe 内新增：

```ts
it('删除时间轴时一并清理待处理的编辑申请', async () => {
  await publishOne('del-cleanup-req', 'x')
  await env.healerbook_timelines
    .prepare(
      'INSERT INTO timeline_edit_requests (timeline_id, user_id, user_name, created_at) VALUES (?,?,?,?)'
    )
    .bind('del-cleanup-req', 'viewer-9', 'V9', Date.now())
    .run()

  const res = await SELF.fetch('https://app/api/timelines/del-cleanup-req', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${await authorJwt()}` },
  })
  expect(res.status).toBe(204)

  const left = await env.healerbook_timelines
    .prepare('SELECT COUNT(*) AS n FROM timeline_edit_requests WHERE timeline_id = ?')
    .bind('del-cleanup-req')
    .first<{ n: number }>()
  expect(left?.n).toBe(0)
})
```

Run: `pnpm test:workers`
Expected: 新用例 FAIL（申请行残留 n=1），其余通过。

- [ ] **Step 2: 创建 `src/workers/db/editors.ts`**

```ts
/// <reference types="@cloudflare/workers-types" />

/**
 * timeline_editors / timeline_edit_requests 数据访问层。
 *
 * 参数收窄为 D1Database：Hono 路由传 c.env.healerbook_timelines，
 * Durable Object 传 this.env.healerbook_timelines，两侧零差异。
 * 需要参与 db.batch() 事务的写操作提供 xxxStatement 变体
 * （approve 场景「删申请 + 加编辑者」必须原子），由调用方决定 run 或 batch。
 */

export async function isEditor(
  db: D1Database,
  timelineId: string,
  userId: string
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM timeline_editors WHERE timeline_id = ? AND user_id = ?')
    .bind(timelineId, userId)
    .first()
  return row != null
}

export async function listEditors(
  db: D1Database,
  timelineId: string,
  excludeUserId?: string
): Promise<{ userId: string; userName: string }[]> {
  const result = excludeUserId
    ? await db
        .prepare(
          'SELECT user_id, user_name FROM timeline_editors WHERE timeline_id = ? AND user_id != ? ORDER BY created_at'
        )
        .bind(timelineId, excludeUserId)
        .all<{ user_id: string; user_name: string }>()
    : await db
        .prepare(
          'SELECT user_id, user_name FROM timeline_editors WHERE timeline_id = ? ORDER BY created_at'
        )
        .bind(timelineId)
        .all<{ user_id: string; user_name: string }>()
  return result.results.map(r => ({ userId: r.user_id, userName: r.user_name }))
}

/** userName 缺省写空串（发布/迁移场景，吃列 DEFAULT '' 的旧语义）；approve 场景显式传真实名 */
export function insertEditorStatement(
  db: D1Database,
  timelineId: string,
  userId: string,
  userName = ''
): D1PreparedStatement {
  return db
    .prepare(
      'INSERT OR IGNORE INTO timeline_editors (timeline_id, user_id, user_name, created_at) VALUES (?,?,?,?)'
    )
    .bind(timelineId, userId, userName, Date.now())
}

export async function deleteAllEditors(db: D1Database, timelineId: string): Promise<void> {
  await db.prepare('DELETE FROM timeline_editors WHERE timeline_id = ?').bind(timelineId).run()
}

export async function removeEditor(
  db: D1Database,
  timelineId: string,
  userId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM timeline_editors WHERE timeline_id = ? AND user_id = ?')
    .bind(timelineId, userId)
    .run()
}

export async function hasPendingEditRequest(
  db: D1Database,
  timelineId: string,
  userId: string
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM timeline_edit_requests WHERE timeline_id = ? AND user_id = ?')
    .bind(timelineId, userId)
    .first()
  return row != null
}

export async function countPendingEditRequests(
  db: D1Database,
  timelineId: string
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM timeline_edit_requests WHERE timeline_id = ?')
    .bind(timelineId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

export async function listEditRequests(
  db: D1Database,
  timelineId: string
): Promise<{ userId: string; userName: string; createdAt: number }[]> {
  const result = await db
    .prepare(
      'SELECT user_id, user_name, created_at FROM timeline_edit_requests WHERE timeline_id = ? ORDER BY created_at'
    )
    .bind(timelineId)
    .all<{ user_id: string; user_name: string; created_at: number }>()
  return result.results.map(r => ({
    userId: r.user_id,
    userName: r.user_name,
    createdAt: r.created_at,
  }))
}

export async function findEditRequest(
  db: D1Database,
  timelineId: string,
  userId: string
): Promise<{ userName: string } | null> {
  const row = await db
    .prepare('SELECT user_name FROM timeline_edit_requests WHERE timeline_id = ? AND user_id = ?')
    .bind(timelineId, userId)
    .first<{ user_name: string }>()
  return row ? { userName: row.user_name } : null
}

export function insertEditRequestStatement(
  db: D1Database,
  timelineId: string,
  userId: string,
  userName: string
): D1PreparedStatement {
  return db
    .prepare(
      'INSERT OR IGNORE INTO timeline_edit_requests (timeline_id, user_id, user_name, created_at) VALUES (?,?,?,?)'
    )
    .bind(timelineId, userId, userName, Date.now())
}

export function deleteEditRequestStatement(
  db: D1Database,
  timelineId: string,
  userId: string
): D1PreparedStatement {
  return db
    .prepare('DELETE FROM timeline_edit_requests WHERE timeline_id = ? AND user_id = ?')
    .bind(timelineId, userId)
}

export async function deleteAllEditRequests(db: D1Database, timelineId: string): Promise<void> {
  await db
    .prepare('DELETE FROM timeline_edit_requests WHERE timeline_id = ?')
    .bind(timelineId)
    .run()
}
```

**注意**：`listEditors` / `listEditRequests` / `findEditRequest` / `insertEditRequestStatement` / `deleteEditRequestStatement` 的既有 SQL 在 `share.ts` 中（本 plan 引用的行号是快照），落地时**以 `share.ts` 实际 SQL 文本为准**逐条核对（列名、ORDER BY、OR IGNORE、reject 场景是否检查 `meta.changes`）——DAL 必须复刻实际语义而不是本 plan 的记忆版本；发现差异时以实际代码为准修改上面的实现并在报告中注明。

- [ ] **Step 3: 替换全部调用点**

逐文件（保持行为等价，reject 场景若原代码检查 `meta.changes` 判 404，则该处继续用 `deleteEditRequestStatement(...).run()` 的返回值判断）：

- `timelines.ts`：发布时 `await insertEditorStatement(c.env.healerbook_timelines, id, auth.userId).run()`；GET /:id 的 editor 判定改 `if (await isEditor(c.env.healerbook_timelines, id, user.userId)) role = 'editor'`；`hasPendingRequest` / `pendingRequestCount` 分别改 `hasPendingEditRequest` / `countPendingEditRequests`；DELETE 中 `deleteAllEditors` + **新增** `deleteAllEditRequests`（Step 1 的失败测试转绿）。
- `share.ts`：列编辑者 `listEditors(db, id, author.author_id)`（响应字段组装保持原样）；申请前幂等检查 `isEditor`；提交申请 `insertEditRequestStatement(...).run()`；approve 的 batch 改为 `await db.batch([deleteEditRequestStatement(db, id, targetUserId), insertEditorStatement(db, id, targetUserId, reqRow.userName)])`；reject 用 `deleteEditRequestStatement(...).run()`；移除编辑者 `removeEditor`；`findEditRequest` 替换取 user_name 的查询。
- `TimelineDoc.ts`：WS 鉴权改 `if (!(await isEditor(this.env.healerbook_timelines, this.docId(), userId)))`；`notifyEditRequest` 内计数改 `countPendingEditRequests`。
- `internalMigrate.ts`：`await insertEditorStatement(c.env.healerbook_timelines, row.id, row.author_id).run()`（以实际参数为准）。

Run: `grep -rn "timeline_editors\|timeline_edit_requests" src/workers --include="*.ts" | grep -v "db/editors.ts" | grep -v ".test.ts" | grep -v migrations`
Expected: 零命中（SQL 全部收敛进 DAL；测试文件里直接操作 D1 的 setup 语句允许保留）。

- [ ] **Step 4: 验证 + Commit**

Run: `pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿，含 Step 1 新用例。

```bash
git add -A
git commit -m "refactor(workers): 抽取 db/editors.ts 数据访问层，DELETE 补清理孤儿编辑申请"
```

---

### Task 10: docStub 移到 durable/stub.ts，消除路由横向 import

**Files:**

- Create: `src/workers/durable/stub.ts`
- Modify: `src/workers/routes/timelines.ts`（删除定义，改 import）
- Modify: `src/workers/routes/share.ts`（import 改指向）
- Modify: `src/workers/routes/internalMigrate.ts`（内联重复 cast 改用 docStub）

**Interfaces:**

- Consumes: `TimelineDoc`（`./TimelineDoc`）、`AppEnv`（`../env`）
- Produces: `docStub(env: AppEnv['Bindings'], id: string): TimelineDoc`（签名与现状完全一致）

- [ ] **Step 1: 新建 `src/workers/durable/stub.ts`**

把 `timelines.ts` 中的 `docStub` 函数（含 JSDoc 注释）原样移入：

```ts
import type { AppEnv } from '../env'
import type { TimelineDoc } from './TimelineDoc'

/**
 * 取该 timeline 的 DO stub。
 * DurableObjectNamespace binding 在 env.ts 中无具体类型，故 cast 为 TimelineDoc
 * 以调用其 RPC 方法（getSnapshotJson）及 fetch。
 */
export function docStub(env: AppEnv['Bindings'], id: string): TimelineDoc {
  return env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(id)) as unknown as TimelineDoc
}
```

- [ ] **Step 2: 三个调用方改造**

- `timelines.ts`：删除本地 `docStub` 定义与（若不再被其他代码使用的）`import type { TimelineDoc }`，新增 `import { docStub } from '../durable/stub'`；4 处调用点不变。
- `share.ts`：`import { docStub } from './timelines'` 改 `import { docStub } from '../durable/stub'`。
- `internalMigrate.ts`：删除内联的 `c.env.TIMELINE_DOC.get(c.env.TIMELINE_DOC.idFromName(row.id)) as unknown as TimelineDoc` 写法与对应 `TimelineDoc` type import，改 `import { docStub } from '../durable/stub'` 后 `const stub = docStub(c.env, row.id)`。

Run: `grep -rn "TIMELINE_DOC.get" src/workers | grep -v durable/stub.ts`
Expected: 零命中。

- [ ] **Step 3: 验证 + Commit**

Run: `pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。

```bash
git add -A
git commit -m "refactor(workers): docStub 移入 durable/stub.ts，消除路由横向依赖与内联重复"
```

---

### Task 11: top100Sync.ts 拆分（kvKeys / encounterStats / encounterTemplate / 路由吸收 Response 组装）

**Files:**

- Create: `src/workers/kvKeys.ts`
- Create: `src/workers/encounterStats.ts`
- Create: `src/workers/encounterTemplate.ts`
- Modify: `src/workers/top100Sync.ts`（瘦身为「同步编排 + FFLogs 提取」）
- Modify: `src/workers/routes/encounterTemplates.ts`（吸收 Response 组装）
- Modify: `src/workers/routes/top100.ts`、`src/workers/routes/statistics.ts`、`src/workers/routes/fflogs.ts`（import 改指向；`scheduled.ts` 不变）
- Create: `src/workers/encounterStats.test.ts`、`src/workers/encounterTemplate.test.ts`（自 `top100Sync.test.ts` 拆出对应用例）
- Modify: `src/workers/top100Sync.test.ts`（保留编排相关用例，import 改指向）

**Interfaces:**

- Consumes: 现 `top100Sync.ts` 各函数（行号为快照，以实际为准）
- Produces（迁移后各模块导出，签名不变）:
  - `kvKeys.ts`: `getTop100KVKey` / `getStatisticsKVKey` / `getSamplesKVKey` / `getEncounterTemplateKVKey`（均 `(encounterId: number) => string`）
  - `encounterStats.ts`: `EncounterSamples`（interface）、`mergeWithReservoirSampling` / `calculatePercentiles` / `mergeRecord`（原私有函数改导出）、`MAX_SAMPLES`
  - `encounterTemplate.ts`: `EncounterTemplateEvent` / `EncounterTemplate` / `buildEncounterTemplate`（`shouldReplaceTemplate` 保持模块私有）
  - `top100Sync.ts` 保留: `Top100Data` re-export 不需要（已在 apiContracts）、`StoredDamageEvent` / `slimDamageEvents` / `ExtractedFightData` / `extractFightStats` / `syncEncounter` / `makeDefaultFetchExtracted` / `defaultLookupEncounterName` / `processOneSample` / `syncAllTop100`

**纯移动纪律**：函数体逐字搬移，不顺手改逻辑。`extractDamageData`（`extractFightStats` 的私有依赖）留在 `top100Sync.ts`。

- [ ] **Step 1: 新建 `kvKeys.ts`**

把 4 个 `getXxxKVKey` 函数（含注释）从 `top100Sync.ts` 原样移入新文件（文件头加一行说明：`// KV key 构造单源：避免 'top100:encounter:' 等前缀魔法字符串散落`）。`top100Sync.ts` 内改为 `import { ... } from './kvKeys'`。

- [ ] **Step 2: 新建 `encounterStats.ts`**

移入 `EncounterSamples`、`MAX_SAMPLES`、`mergeWithReservoirSampling`、`calculatePercentiles`、`mergeRecord`（原私有，改 `export`，供 `top100Sync.ts` 的 `processOneSample` import）。

- [ ] **Step 3: 新建 `encounterTemplate.ts`**

移入 `EncounterTemplateEvent`、`EncounterTemplate`、`BuildEncounterTemplateInput`（保持私有）、`shouldReplaceTemplate`（保持私有）、`buildEncounterTemplate`。import `getEncounterTemplateKVKey` 的地方不在此模块（key 归 kvKeys）。

- [ ] **Step 4: 路由吸收 `handleGetEncounterTemplate`**

- 从 `top100Sync.ts` 删除 `handleGetEncounterTemplate`。
- `src/workers/routes/encounterTemplates.ts` 改为：

```ts
/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import type { AppEnv } from '../env'
import type { EncounterTemplateResponse } from '@/types/apiContracts'
import type { EncounterTemplate } from '../encounterTemplate'
import { getEncounterTemplateKVKey } from '../kvKeys'

const app = new Hono<AppEnv>()

// 返回副本模板（含预填充伤害事件）；KV 无数据时返回空列表
app.get('/:encounterId', async c => {
  const encounterId = parseInt(c.req.param('encounterId'), 10)
  if (isNaN(encounterId)) {
    return c.json({ error: 'Invalid encounter ID' }, 400)
  }

  const headers = { 'Cache-Control': 'public, max-age=3600' }
  const data = await c.env.healerbook.get(getEncounterTemplateKVKey(encounterId), 'json')
  if (!data) {
    const empty: EncounterTemplateResponse = {
      events: [],
      updatedAt: null,
      templateSourceDurationMs: null,
      kill: false,
    }
    return c.json(empty, 200, headers)
  }
  const template = data as EncounterTemplate
  const body: EncounterTemplateResponse = {
    events: template.events.map(({ abilityId: _abilityId, ...e }) => e),
    updatedAt: template.updatedAt,
    templateSourceDurationMs: template.templateSourceDurationMs,
    kill: template.kill ?? false,
  }
  return c.json(body, 200, headers)
})

export { app as encounterTemplatesRoutes }
```

（`c.json` 自动置 `Content-Type: application/json`，与原 `new Response` 手写 headers 行为等价；abilityId 裁剪逻辑随 Task 5 已存在，此处随函数体一起搬入。）

- [ ] **Step 5: 消费方 import 改指向**

- `routes/top100.ts`：`getTop100KVKey` 改自 `'../kvKeys'`；`syncAllTop100` 仍自 `'../top100Sync'`；`Top100Data` 自 `'@/types/apiContracts'`（Task 4 已改，核对即可）。
- `routes/statistics.ts`、`routes/fflogs.ts`：`getStatisticsKVKey` 改自 `'../kvKeys'`。
- `top100Sync.ts` 内部：import kvKeys/encounterStats/encounterTemplate 的迁出符号；`scheduled.ts` 的四个 import 全部仍在 `top100Sync.ts`，零改动。

Run: `grep -rn "from '../top100Sync'\|from './top100Sync'" src/workers`
Expected: 命中处只 import 仍保留在 top100Sync.ts 的符号（syncAllTop100 / processOneSample / makeDefaultFetchExtracted / defaultLookupEncounterName / extractFightStats / slimDamageEvents / StoredDamageEvent / ExtractedFightData / syncEncounter）。

- [ ] **Step 6: 测试拆分**

`top100Sync.test.ts` 中按被测函数归属拆出：

- `encounterStats.test.ts`：`mergeWithReservoirSampling` / `calculatePercentiles`（及 mergeRecord 若有）相关 describe，import 改自 `'./encounterStats'`。
- `encounterTemplate.test.ts`：`buildEncounterTemplate` / 覆盖策略相关 describe，import 改自 `'./encounterTemplate'`。
- `handleGetEncounterTemplate` 的既有用例（若存在）改写为对 `routes/encounterTemplates.ts` 的断言或迁移进 workers pool 路由测试——以用例实际依赖为准，优先最小改动：若原用例只调函数并断言 Response body，可改为直接构造 `app.request`（node 套件下 Hono app 可运行，KV 用测试内 stub）；改动过大时保留原断言意图重写。
- `top100Sync.test.ts` 保留 `extractFightStats` / `slimDamageEvents` / `processOneSample` / `syncEncounter` / `syncAllTop100` 等编排用例，kvKeys 断言（如有）就地改 import。

- [ ] **Step 7: 验证 + Commit**

Run: `pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint && pnpm build`
Expected: 全绿（`pnpm build` 兜底确认 workers 打包不受模块拆分影响）。

```bash
git add -A
git commit -m "refactor(workers): top100Sync 拆分 kvKeys/encounterStats/encounterTemplate，路由吸收模板响应组装"
```

---

### Task 12: 文档同步

**Files:**

- Modify: `CLAUDE.md`
- Modify: `src/workers/README.md`

**Interfaces:** 无（纯文档）。写文档前**逐项以实际代码为准核对**，不照抄本 plan 的描述。

- [ ] **Step 1: 更新 CLAUDE.md**

- 「Workers 路由结构」一节：中间件描述里 `tryReadAuth`（可选读取）改为 `readAuthFromHeader`（可选读取，无副作用解析）；目录说明补 `src/workers/db/`（D1 数据访问层）与 `kvKeys.ts / encounterStats.ts / encounterTemplate.ts`（以实际落地文件为准）。
- 「关键文件说明」表：若 `src/workers/timelines.ts` 行的说明仍写「含版本冲突检测」等过时描述，按现状修正为 `src/workers/routes/timelines.ts`（发布 / 公开读 / 删除）；确认表中路径全部存在。
- 「技术栈」或相关小节如提到前端类型组织，补一句 `src/types/apiContracts.ts`（前后端 API 契约单源）。
- 文档末尾 `**最后更新**` 改为执行当日日期。

- [ ] **Step 2: 更新 `src/workers/README.md`**

目录总览补 `db/`（editors DAL）、`kvKeys.ts`、`encounterStats.ts`、`encounterTemplate.ts`、`durable/stub.ts`；middleware 清单更新（`requireAuth` / `readAuthFromHeader` / `requireSyncToken`）；`top100Sync.ts` 的职责一句话改为「TOP100 同步编排 + FFLogs 数据提取」。

- [ ] **Step 3: 验证 + Commit**

Run: `pnpm test:run && pnpm lint`
Expected: 全绿。

```bash
git add CLAUDE.md src/workers/README.md
git commit -m "docs: 项目指南与 workers README 同步第二期契约与分层结构"
```

（提交信息不得出现 "CLAUDE.md"——用「项目指南」指代，见 Global Constraints。）

---

## 任务依赖

- Task 1 必须最先（删掉按 SQL 文本分派的手写 mock，后续任务才能自由改 SQL/响应）。
- Task 2 → 3 → 4 → 5 顺序执行（共同追加 `apiContracts.ts`，避免并发冲突）；Task 5 在 Task 11 之前（模板响应标注先落地，拆分时随函数体搬移）。
- Task 6（纯前端）与 Task 7/8（workers 样板）无相互依赖，但按编号顺序执行即可。
- Task 9（DAL）在 Task 1 之后（依赖 workers pool 测试保护）；Task 10 与 Task 9 都改 `timelines.ts`/`share.ts`，按编号顺序执行避免冲突。
- Task 12 最后。

## 验收

- 全部验证命令绿：`pnpm test:run` / `pnpm test:workers` / `pnpm exec tsc -b --noEmit` / `pnpm lint` / `pnpm build`。
- `grep -rn "MyTimelineItem\|RawSharedResponse" src/` 零命中；`timeline_editors` SQL 只存在于 `db/editors.ts` 与 migrations/测试 setup；`top100Sync.ts` 不再包含 KV key 构造 / 百分位计算 / 模板构建 / Response 组装。
- 三处声明的行为变更（version 字段、DELETE 清理申请、模板响应裁 abilityId）之外无行为变化。
