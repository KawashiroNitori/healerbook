# 时间轴协同编辑:客户端整合(计划 B)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `EditorPage` / 新建流程 / 发布流程从旧 localStorage 路径整合到「Y.Doc 投影 + Durable Object 远端同步」模型,实现 `local` / `editor` / `viewer` 三模式与 local→cloud 平滑发布。

**Architecture:** 客户端 `SyncEngine` 持有 Y.Doc;新增 `RemoteConnection` 经 WebSocket 连接每条时间轴对应的 Durable Object(计划 A 已交付服务端)。已发布时间轴在引擎上挂一个 remote peer 实现实时双向同步;未发布时间轴引擎纯本地。`EditorPage` 三模式由本地 IndexedDB 元数据与服务端 `GET /api/timelines/:id` 返回的角色推导。发布 = 给一条本地 Y.Doc 挂上 DO remote,Y.Doc 全程连续不重建。

**Tech Stack:** Yjs CRDT、WebSocket、IndexedDB(`fake-indexeddb` 测试)、React 19 + Zustand、TanStack Query、Vitest、Cloudflare Workers(Hono 路由)。

**前置:** 计划 A(服务端,`afb486f..b3d6fdd`)已完成 —— `TimelineDoc` DO、同步协议、发布/公开读/WS 升级路由、D1 `timeline_editors` 表均已就位。本计划对应整合设计 spec `2026-05-16-timeline-collab-server-and-editor-integration-design.md` §4–9、落地顺序 §11 第 4–7 组。Awareness(第 8 组)是后续计划 C。

**关键设计决定(实现者须知):**

1. **单次客户端迁移,不做 v2 补丁。** 整合 spec §9.2 设想阶段 1 可能独立上线、需要 v2 修正双重 seed。但 `feat/collaborative` 是一次性原子上线的分支 —— 阶段 1 从未单独发布,不存在「跑过 v1 但无服务端」的用户。因此直接重写 `migration.ts` 的单次迁移,使其从一开始就正确区分「已发布(丢弃本地 Y.Doc,服务端权威)」与「纯本地(保留 Y.Doc)」,沿用同一个 `MIGRATION_FLAG`。不新增 v2 标志位。

2. **`LocalSyncEngine` 重命名为 `SyncEngine`。** 加上 remote 后「Local」是误名;spec §4/§6 一致称 `SyncEngine`。Task 5 内 `git mv` 并改全部引用。

3. **`Timeline` 类型保留 `isShared` / `everPublished` / `hasLocalChanges` / `serverVersion` 字段。** 这些字段在 `src/types/timeline.ts`、`timelineFormat.ts`、worker `fflogs.ts` 中均有牵连,移除涉及大范围 ripple 且超出本增量收益。`TimelineContent` 已 `Omit` 掉它们,新代码路径不读不写,留作惰性字段无害。本计划不动 `Timeline` 类型定义。

4. **`serializeForServer` 保留。** grep 确认 worker `routes/fflogs.ts` 仍在用,非死代码。仅 `toLocalStored` 在删 `saveTimeline` 后变死,Task 14 移除。

---

## 文件结构

**新建:**

- `src/collab/RemoteConnection.ts` —— 单文档 WebSocket 同步状态机(连接 / auth / load / push / 重连)。
- `src/collab/RemoteConnection.test.ts`
- `src/collab/createLocalTimeline.ts` —— 新建一条本地时间轴(buildYDoc + 写 IndexedDB snapshot + meta 行)。
- `src/collab/createLocalTimeline.test.ts`
- `src/collab/syncProtocol.ts` —— 由 `src/workers/collab/syncProtocol.ts` 移入(共享线格式)。
- `src/collab/syncProtocol.test.ts` —— 随之移入。

**重命名:**

- `src/collab/LocalSyncEngine.ts` → `src/collab/SyncEngine.ts`(类 `LocalSyncEngine` → `SyncEngine`)。
- `src/collab/LocalSyncEngine.test.ts` → `src/collab/SyncEngine.test.ts`。

**修改:**

- `src/collab/constants.ts` —— 加 `REMOTE_ORIGIN`、IDB 版本与 meta store 名。
- `src/collab/types.ts` —— `LocalDocMeta` 扩展为完整元数据形状。
- `src/collab/storage/IndexedDBDocStore.ts` —— IDB 升版 1→2,加 `meta` object store 及 CRUD / `rekey` / `deleteDoc`。
- `src/collab/migration.ts` —— 重写单次迁移(区分已发布 / 纯本地、回填 meta、清旧 key)。
- `src/store/timelineStore.ts` —— `openTimeline` 加 remote;新增 `setViewerSnapshot` / `attachRemote`;`applyPublishResult` 真实现;删 `setTimeline` / `applyUpdateResult` / `applyServerTimeline`;加 `connectionStatus` / `isPublished`;debounced 写 meta。
- `src/pages/EditorPage.tsx` —— 三模式 async 改造。
- `src/pages/HomePage.tsx` —— 本地列表改读 IndexedDB meta。
- `src/components/CreateTimelineDialog.tsx` / `ImportFFLogsDialog.tsx` / `Top100Section.tsx` —— 新建走 `createLocalTimeline`、`buildFFLogsSourceIndex` 改 async。
- `src/components/SharePopover.tsx` —— 重接 local→cloud 发布流程。
- `src/components/EditorToolbar.tsx` —— 移除 `ConflictDialog` 及 `applyUpdateResult`/`applyServerTimeline` 接线。
- `src/api/timelineShareApi.ts` —— `publishTimeline(id,name)`、`fetchSharedTimeline`→`{role,...}`、删版本锁相关。
- `src/utils/timelineStorage.ts` —— 删 `saveTimeline`/`deleteTimeline`/`unpublishTimeline`,`buildFFLogsSourceIndex` 改读 IndexedDB。
- `src/utils/timelineFormat.ts` —— 删死代码 `toLocalStored`。
- `src/workers/routes/timelines.ts` —— `GET /:id` 改返回 `{ role, authorName, snapshot? }`。
- `src/workers/durable/TimelineDoc.ts` —— 更新 `syncProtocol` import 路径。

**删除:**

- `src/components/ConflictDialog.tsx`(+ 其测试,若有)—— CRDT 自动收敛,无版本锁冲突。
- `src/workers/collab/syncProtocol.ts`(移走)。

---

## Task 1: 把 syncProtocol 移入 src/collab(共享线格式)

`syncProtocol.ts` 是客户端与 DO 共享的 WebSocket 线格式,当前在 `src/workers/collab/`。客户端 `RemoteConnection` 要用它,放在 `src/collab/` 更合适(纯模块,无 Cloudflare 依赖)。

**Files:**

- Move: `src/workers/collab/syncProtocol.ts` → `src/collab/syncProtocol.ts`
- Move: `src/workers/collab/syncProtocol.test.ts` → `src/collab/syncProtocol.test.ts`
- Modify: `src/workers/durable/TimelineDoc.ts:5`

- [ ] **Step 1: 移动文件**

```bash
git mv src/workers/collab/syncProtocol.ts src/collab/syncProtocol.ts
git mv src/workers/collab/syncProtocol.test.ts src/collab/syncProtocol.test.ts
```

- [ ] **Step 2: 更新 TimelineDoc 的 import**

`src/workers/durable/TimelineDoc.ts` 第 5 行,把:

```typescript
import { decodeMessage, encodeLoadReply, encodeMessage, MSG } from '../collab/syncProtocol'
```

改为:

```typescript
import { decodeMessage, encodeLoadReply, encodeMessage, MSG } from '@/collab/syncProtocol'
```

- [ ] **Step 3: 检查无其他引用**

Run: `grep -rn "workers/collab/syncProtocol" src` —— 预期无输出。
若 `src/collab/syncProtocol.test.ts` 内有相对 import 不需改(同目录无依赖)。

- [ ] **Step 4: 跑测试与类型检查**

Run: `pnpm test:run syncProtocol` —— 预期 PASS。
Run: `pnpm test:workers` —— 预期 19/19 PASS(`TimelineDoc` 仍能 import)。
Run: `pnpm exec tsc --noEmit` —— 预期 0 error。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(collab): move syncProtocol to shared src/collab"
```

---

## Task 2: GET /api/timelines/:id 返回 { role, authorName, snapshot? }

整合 spec §2/§5:`EditorPage` 靠该端点的 `role` 区分 `editor` / `viewer`。计划 A 当前返回裸 `Timeline` JSON,需改成带角色的包裹形状。

- `role`:请求者已登录且在 `timeline_editors` 白名单 → `'editor'`;否则(含未登录)→ `'viewer'`。
- `editor` 不带 `snapshot`(编辑端连 WS 取全量);`viewer` 带 `snapshot`(投影后的 `Timeline` JSON)。
- `authorName` 两种角色都返回(viewer 头部显示作者名)。

**Files:**

- Modify: `src/workers/routes/timelines.ts:55-71`
- Test: `src/workers/routes/timelines.workers.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/workers/routes/timelines.workers.test.ts` 末尾追加(沿用文件已有的 `SELF` / D1 seed 风格;若已有 publish + editor 的 helper 复用之):

```typescript
describe('GET /api/timelines/:id role', () => {
  it('returns viewer role with snapshot for anonymous request', async () => {
    // 经发布端点建一条时间轴(作者 JWT 见文件已有 helper)
    const id = await publishOne('view-role-1', 'T1')
    const res = await SELF.fetch(`https://x/api/timelines/${id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { role: string; authorName: string; snapshot: unknown }
    expect(body.role).toBe('viewer')
    expect(body).toHaveProperty('authorName')
    expect(body).toHaveProperty('snapshot')
  })

  it('returns editor role without snapshot for whitelisted user', async () => {
    const id = await publishOne('editor-role-1', 'T2')
    // 作者发布时已自动入 timeline_editors,用作者 JWT 请求
    const res = await SELF.fetch(`https://x/api/timelines/${id}`, {
      headers: { Authorization: `Bearer ${authorJwt}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { role: string; snapshot?: unknown }
    expect(body.role).toBe('editor')
    expect(body.snapshot).toBeUndefined()
  })

  it('404 for unknown id', async () => {
    const res = await SELF.fetch('https://x/api/timelines/does-not-exist')
    expect(res.status).toBe(404)
  })
})
```

> 实现者:`publishOne(id,name)` / `authorJwt` 若文件未提供 helper,参照文件内已有的发布测试(`POST /` + 作者 JWT 签发)就地构造。作者 JWT 的 `sub` 必须与发布时的 `auth.userId` 一致,这样它才在 `timeline_editors` 内。

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm test:workers timelines` —— 预期新 3 个用例 FAIL(`editor` 用例失败:当前返回裸 JSON 无 `role`)。

- [ ] **Step 3: 改写 GET /:id**

`src/workers/routes/timelines.ts`,把现有 `app.get('/:id', ...)`(第 56–71 行)整段替换为:

```typescript
// 公开读:返回 { role, authorName, snapshot? }
// role=editor(登录且在白名单)→ 不带 snapshot,编辑端连 WS 取全量
// role=viewer(其余,含未登录)→ 带 snapshot(KV 优先,未命中经 DO RPC)
app.get('/:id', async c => {
  const id = c.req.param('id')

  const row = await c.env.healerbook_timelines
    .prepare('SELECT author_name FROM timelines WHERE id = ?')
    .bind(id)
    .first<{ author_name: string }>()
  if (!row) return c.json({ error: 'Not found' }, 404)

  const user = await tryReadAuth(c)
  let role: 'editor' | 'viewer' = 'viewer'
  if (user) {
    const editorRow = await c.env.healerbook_timelines
      .prepare('SELECT 1 FROM timeline_editors WHERE timeline_id = ? AND user_id = ?')
      .bind(id, user.userId)
      .first()
    if (editorRow) role = 'editor'
  }

  if (role === 'editor') {
    return c.json({ role, authorName: row.author_name })
  }

  // viewer:需要 snapshot
  const cached = await c.env.healerbook_snapshots.get(`tl-snapshot:${id}`)
  const snapshot = cached
    ? (JSON.parse(cached) as object)
    : await docStub(c.env, id).getSnapshotJson()
  if (!snapshot) return c.json({ error: 'Not found' }, 404)
  return c.json({ role, authorName: row.author_name, snapshot }, 200, {
    'Cache-Control': 'public, max-age=60',
  })
})
```

- [ ] **Step 4: 加 tryReadAuth import**

`src/workers/routes/timelines.ts` 顶部 import 区,在 `requireAuth` import 下方加:

```typescript
import { tryReadAuth } from '../middleware/tryReadAuth'
```

- [ ] **Step 5: 跑测试验证通过**

Run: `pnpm test:workers timelines` —— 预期全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(collab): GET timeline returns role-scoped response"
```

---

## Task 3: REMOTE_ORIGIN 常量 + IndexedDBDocStore meta 表

`RemoteConnection` 把远端来的 update 用 `REMOTE_ORIGIN` 应用,以便引擎区分(远端 update 仍落本地缓存,但不被 `UndoManager` 跟踪)。同时 IndexedDB 加一张轻量 `meta` 表支撑 `HomePage` 列表与三模式判定。

**Files:**

- Modify: `src/collab/constants.ts`
- Modify: `src/collab/types.ts`
- Modify: `src/collab/storage/IndexedDBDocStore.ts`
- Test: `src/collab/storage/IndexedDBDocStore.test.ts`

- [ ] **Step 1: 加常量**

`src/collab/constants.ts`,在 `LOCAL_ORIGIN` 定义后加:

```typescript
/**
 * 远端(DO)来的 Y.Doc 事务 origin。
 * 与 `LOCAL_ORIGIN` 区分:`UndoManager` 不跟踪它(不能撤销协作者的编辑),
 * 但引擎仍把它落本地 IndexedDB(离线缓存)。
 */
export const REMOTE_ORIGIN = 'remote'
```

并把 IDB 相关常量改为:

```typescript
/** IndexedDB 数据库名与对象仓库名 */
export const IDB_NAME = 'healerbook_collab'
export const IDB_VERSION = 2
export const IDB_STORE_SNAPSHOTS = 'snapshots'
export const IDB_STORE_UPDATES = 'updates'
export const IDB_STORE_META = 'meta'
```

(`IDB_VERSION` 为新增;`IDB_STORE_META` 为新增。)

- [ ] **Step 2: 扩展 LocalDocMeta 类型**

`src/collab/types.ts`,把现有 `LocalDocMeta` 接口整体替换为:

```typescript
import type { Composition, FFLogsSource } from '@/types/timeline'

/**
 * 本地时间轴元数据 —— 不进 Y.Doc,由 IndexedDB `meta` 表管理。
 * 支撑 HomePage 本地列表与 EditorPage 三模式判定。
 */
export interface LocalDocMeta {
  /** 时间轴 id(外部寻址键,也是 IndexedDB 主键) */
  docId: string
  /** 时间轴名称 */
  name: string
  /** 副本 id(0 表示未知) */
  encounterId: number
  /** 创建时间(Unix 秒) */
  createdAt: number
  /** 最近修改时间(Unix 秒) */
  updatedAt: number
  /** 阵容(用于列表卡片职业图标);无则 null */
  composition: Composition | null
  /** FFLogs 来源(用于导入去重索引);无则 undefined */
  fflogsSource?: FFLogsSource
  /** 是否已发布到云端 */
  published: boolean
}
```

> 实现者:`FFLogsSource` 类型从 `@/types/timeline` 取;若该名不存在,grep `fflogsSource` 在 `src/types/timeline.ts` 的字段类型并用之(必要时改成 `Timeline['fflogsSource']`)。`fflogsSource` 入 meta 是对 spec §7 字段表的有意扩展 —— spec §8 要求 `buildFFLogsSourceIndex` 改读 meta 表,故 meta 须携带该字段。

- [ ] **Step 3: 写失败测试**

`src/collab/storage/IndexedDBDocStore.test.ts` 末尾追加(文件已 import `fake-indexeddb/auto` 或在 setup 中;沿用已有风格):

```typescript
describe('meta store', () => {
  it('puts and gets a meta row', async () => {
    const store = new IndexedDBDocStore()
    await store.open()
    const meta = {
      docId: 'd1',
      name: 'T',
      encounterId: 42,
      createdAt: 1,
      updatedAt: 2,
      composition: null,
      published: false,
    }
    await store.putMeta(meta)
    expect(await store.getMeta('d1')).toEqual(meta)
  })

  it('getAllMeta returns every row', async () => {
    const store = new IndexedDBDocStore()
    await store.open()
    await store.putMeta({
      docId: 'a',
      name: 'A',
      encounterId: 0,
      createdAt: 1,
      updatedAt: 1,
      composition: null,
      published: false,
    })
    await store.putMeta({
      docId: 'b',
      name: 'B',
      encounterId: 0,
      createdAt: 1,
      updatedAt: 1,
      composition: null,
      published: true,
    })
    const all = await store.getAllMeta()
    expect(all.map(m => m.docId).sort()).toEqual(['a', 'b'])
  })

  it('deleteDoc removes snapshot, updates and meta', async () => {
    const store = new IndexedDBDocStore()
    await store.open()
    await store.appendUpdate('x', new Uint8Array([1, 2, 3]))
    await store.putMeta({
      docId: 'x',
      name: 'X',
      encounterId: 0,
      createdAt: 1,
      updatedAt: 1,
      composition: null,
      published: false,
    })
    await store.deleteDoc('x')
    expect(await store.loadDoc('x')).toBeNull()
    expect(await store.getMeta('x')).toBeNull()
  })

  it('rekey moves snapshot, updates and meta to a new docId', async () => {
    const store = new IndexedDBDocStore()
    await store.open()
    await store.appendUpdate('old', new Uint8Array([9]))
    await store.putMeta({
      docId: 'old',
      name: 'O',
      encounterId: 7,
      createdAt: 1,
      updatedAt: 1,
      composition: null,
      published: false,
    })
    await store.rekey('old', 'new')
    expect(await store.loadDoc('old')).toBeNull()
    expect(await store.getMeta('old')).toBeNull()
    expect(await store.loadDoc('new')).not.toBeNull()
    expect((await store.getMeta('new'))?.docId).toBe('new')
    expect((await store.getMeta('new'))?.encounterId).toBe(7)
  })
})
```

- [ ] **Step 2 验证:跑测试看它失败**

Run: `pnpm test:run IndexedDBDocStore` —— 预期新用例 FAIL(`putMeta` 等方法不存在)。

- [ ] **Step 4: 升级 IndexedDBDocStore**

`src/collab/storage/IndexedDBDocStore.ts`:

(a) import 区改为:

```typescript
import * as Y from 'yjs'
import {
  IDB_NAME,
  IDB_VERSION,
  IDB_STORE_SNAPSHOTS,
  IDB_STORE_UPDATES,
  IDB_STORE_META,
  CLIENT_SQUASH_THRESHOLD,
} from '../constants'
import type { LocalDocMeta } from '../types'
```

(b) `open()` 的 `indexedDB.open` 改用 `IDB_VERSION`,并在 `onupgradeneeded` 内补建 `meta` store:

```typescript
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IDB_STORE_SNAPSHOTS)) {
          db.createObjectStore(IDB_STORE_SNAPSHOTS, { keyPath: 'docId' })
        }
        if (!db.objectStoreNames.contains(IDB_STORE_UPDATES)) {
          const us = db.createObjectStore(IDB_STORE_UPDATES, {
            keyPath: ['docId', 'seq'],
          })
          us.createIndex('docId', 'docId', { unique: false })
        }
        if (!db.objectStoreNames.contains(IDB_STORE_META)) {
          db.createObjectStore(IDB_STORE_META, { keyPath: 'docId' })
        }
      }
      req.onsuccess = () => {
        this.db = req.result
        resolve()
      }
      req.onerror = () => reject(req.error)
    })
  }
```

(c) 在 `squash()` 之后追加 meta CRUD 与 `rekey` / `deleteDoc`:

```typescript
  /** 写入(或覆盖)一条 meta */
  async putMeta(meta: LocalDocMeta): Promise<void> {
    const tx = this.tx([IDB_STORE_META], 'readwrite')
    await reqToPromise(tx.objectStore(IDB_STORE_META).put(meta))
  }

  /** 读一条 meta;不存在返回 null */
  async getMeta(docId: string): Promise<LocalDocMeta | null> {
    const tx = this.tx([IDB_STORE_META], 'readonly')
    const row = (await reqToPromise(tx.objectStore(IDB_STORE_META).get(docId))) as
      | LocalDocMeta
      | undefined
    return row ?? null
  }

  /** 读全部 meta */
  async getAllMeta(): Promise<LocalDocMeta[]> {
    const tx = this.tx([IDB_STORE_META], 'readonly')
    return (await reqToPromise(tx.objectStore(IDB_STORE_META).getAll())) as LocalDocMeta[]
  }

  /** 删除一条时间轴的 snapshot + updates + meta */
  async deleteDoc(docId: string): Promise<void> {
    const tx = this.tx(
      [IDB_STORE_SNAPSHOTS, IDB_STORE_UPDATES, IDB_STORE_META],
      'readwrite'
    )
    await reqToPromise(tx.objectStore(IDB_STORE_SNAPSHOTS).delete(docId))
    await reqToPromise(tx.objectStore(IDB_STORE_META).delete(docId))
    const us = tx.objectStore(IDB_STORE_UPDATES)
    const keys = (await reqToPromise(us.index('docId').getAllKeys(docId))) as IDBValidKey[]
    for (const key of keys) await reqToPromise(us.delete(key))
  }

  /**
   * 把一条时间轴的全部本地数据从 oldId 改键到 newId。
   * 发布时 id 被服务端清洗变更后使用。
   */
  async rekey(oldId: string, newId: string): Promise<void> {
    const merged = await this.loadDoc(oldId)
    const meta = await this.getMeta(oldId)
    await this.deleteDoc(oldId)
    if (merged) {
      const tx = this.tx([IDB_STORE_SNAPSHOTS], 'readwrite')
      await reqToPromise(
        tx.objectStore(IDB_STORE_SNAPSHOTS).put({
          docId: newId,
          bin: merged,
          updatedAt: Date.now(),
        })
      )
    }
    if (meta) await this.putMeta({ ...meta, docId: newId })
  }
```

- [ ] **Step 5: 跑测试验证通过**

Run: `pnpm test:run IndexedDBDocStore` —— 预期全部 PASS。
Run: `pnpm exec tsc --noEmit` —— 预期 0 error。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(collab): IndexedDB meta store and remote origin constant"
```

---

## Task 4: RemoteConnection —— WebSocket 同步状态机

单文档的远端连接:连 `/api/timelines/:id/connect`、首消息 `auth`、`load-doc` 握手、本地 update 经 `push` 上送、`broadcast` 应用、断线指数退避重连。

**握手流程**(见整合 spec §6、主 spec §6.2):

1. WS open → 发 `AUTH(jwt)`。
2. 收 `AUTH_OK` → 注册本地 `doc.on('update')`;发 `LOAD(encodeStateVector(doc))`。
3. 收 `LOAD_REPLY{missing, serverStateVector}` → 应用 `missing`;计算 `encodeStateAsUpdate(doc, serverStateVector)` 发 `PUSH`(这步把发布时的全量 seed 一并推给 DO)。
4. 收 `BROADCAST(update)` → 应用到 doc。
5. 本地 update(origin ≠ `REMOTE_ORIGIN`)→ 发 `PUSH`;未连接时不发(引擎已落本地,重连时经 `LOAD` 握手补齐)。

**Files:**

- Create: `src/collab/RemoteConnection.ts`
- Test: `src/collab/RemoteConnection.test.ts`

- [ ] **Step 1: 写失败测试**

测试用一个内存 fake WebSocket(不依赖真实网络)。新建 `src/collab/RemoteConnection.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'
import { RemoteConnection } from './RemoteConnection'
import { MSG, encodeMessage, decodeMessage, encodeLoadReply } from './syncProtocol'

/** 内存 fake WebSocket:记录 client 发出的帧,可手动注入 server 帧 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  static CLOSED = 3
  readyState = 0
  binaryType = ''
  sent: Uint8Array[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: Uint8Array) {
    this.sent.push(new Uint8Array(data))
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }
  // 测试驱动:
  fireOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
  fireMessage(frame: Uint8Array) {
    this.onmessage?.({
      data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength),
    })
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

function lastSocket() {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
}

describe('RemoteConnection', () => {
  it('sends AUTH on open', () => {
    const doc = new Y.Doc()
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      () => 'jwt-abc',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
    const frame = decodeMessage(lastSocket().sent[0])
    expect(frame.type).toBe(MSG.AUTH)
    expect(new TextDecoder().decode(frame.payload)).toBe('jwt-abc')
    conn.destroy()
  })

  it('sends LOAD after AUTH_OK and reports connected', () => {
    const doc = new Y.Doc()
    const statuses: string[] = []
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      () => 'j',
      s => statuses.push(s)
    )
    conn.connect()
    lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    expect(decodeMessage(lastSocket().sent[1]).type).toBe(MSG.LOAD)
    expect(statuses).toContain('connected')
    conn.destroy()
  })

  it('applies LOAD_REPLY missing and pushes server-missing state', () => {
    // server doc 有内容,client doc 为空
    const serverDoc = new Y.Doc()
    serverDoc.getMap('meta').set('name', 'hello')
    const missing = Y.encodeStateAsUpdate(serverDoc)
    const serverSV = Y.encodeStateVector(serverDoc)

    const doc = new Y.Doc()
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      () => 'j',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    lastSocket().fireMessage(encodeMessage(MSG.LOAD_REPLY, encodeLoadReply(missing, serverSV)))

    expect(doc.getMap('meta').get('name')).toBe('hello') // missing 已应用
    const pushFrame = lastSocket().sent.find(f => decodeMessage(f).type === MSG.PUSH)
    expect(pushFrame).toBeDefined() // 给 server 的差量已发(此处为空 diff 也算一帧)
    conn.destroy()
  })

  it('forwards local updates as PUSH once connected', () => {
    const doc = new Y.Doc()
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      () => 'j',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    lastSocket().fireMessage(
      encodeMessage(MSG.LOAD_REPLY, encodeLoadReply(new Uint8Array(), Y.encodeStateVector(doc)))
    )
    const before = lastSocket().sent.length
    doc.getMap('meta').set('k', 'v')
    const pushed = lastSocket().sent.slice(before).map(decodeMessage)
    expect(pushed.some(m => m.type === MSG.PUSH)).toBe(true)
    conn.destroy()
  })

  it('applies BROADCAST without echoing it back as PUSH', () => {
    const doc = new Y.Doc()
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      () => 'j',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    lastSocket().fireMessage(
      encodeMessage(MSG.LOAD_REPLY, encodeLoadReply(new Uint8Array(), Y.encodeStateVector(doc)))
    )
    const before = lastSocket().sent.length

    const remoteDoc = new Y.Doc()
    remoteDoc.getMap('meta').set('fromPeer', 1)
    lastSocket().fireMessage(encodeMessage(MSG.BROADCAST, Y.encodeStateAsUpdate(remoteDoc)))

    expect(doc.getMap('meta').get('fromPeer')).toBe(1)
    const after = lastSocket().sent.slice(before).map(decodeMessage)
    expect(after.some(m => m.type === MSG.PUSH)).toBe(false) // 远端 update 不回推
    conn.destroy()
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm test:run RemoteConnection` —— 预期 FAIL(`RemoteConnection` 不存在)。

- [ ] **Step 3: 实现 RemoteConnection**

新建 `src/collab/RemoteConnection.ts`:

```typescript
import * as Y from 'yjs'
import { MSG, encodeMessage, decodeMessage, decodeLoadReply } from './syncProtocol'
import { REMOTE_ORIGIN } from './constants'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

const MAX_BACKOFF_MS = 30_000

/**
 * 单条时间轴的远端同步连接。
 * 持有一条到对应 Durable Object 的 WebSocket,负责 auth / load 握手、
 * 本地 update 上推、远端 broadcast 应用、断线指数退避重连。
 */
export class RemoteConnection {
  private ws: WebSocket | null = null
  private status: ConnectionStatus = 'disconnected'
  private retry = 0
  private closed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private updateListenerActive = false

  constructor(
    private readonly url: string,
    private readonly doc: Y.Doc,
    private readonly getJwt: () => string | null,
    private readonly onStatus: (status: ConnectionStatus) => void
  ) {}

  /** 开始连接(幂等:已在连接中则忽略) */
  connect(): void {
    if (this.ws) return
    this.closed = false
    this.open()
  }

  /** 永久关闭:停止重连、断开监听 */
  destroy(): void {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.detachUpdateListener()
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.setStatus('disconnected')
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return
    this.status = next
    this.onStatus(next)
  }

  private open(): void {
    this.setStatus('connecting')
    const ws = new WebSocket(this.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      const jwt = this.getJwt()
      if (!jwt) {
        ws.close()
        return
      }
      ws.send(encodeMessage(MSG.AUTH, new TextEncoder().encode(jwt)))
    }
    ws.onmessage = ev => this.onMessage(new Uint8Array(ev.data as ArrayBuffer))
    ws.onclose = () => this.onClose()
    ws.onerror = () => {
      /* onclose 紧随其后,统一在那里处理 */
    }
  }

  private onMessage(frame: Uint8Array): void {
    let msg
    try {
      msg = decodeMessage(frame)
    } catch {
      return
    }
    if (msg.type === MSG.AUTH_OK) {
      this.retry = 0
      this.setStatus('connected')
      this.attachUpdateListener()
      this.ws?.send(encodeMessage(MSG.LOAD, Y.encodeStateVector(this.doc)))
      return
    }
    if (msg.type === MSG.LOAD_REPLY) {
      const { missing, stateVector } = decodeLoadReply(msg.payload)
      if (missing.length > 0) Y.applyUpdate(this.doc, missing, REMOTE_ORIGIN)
      // 把 server 缺的差量推上去(发布时的全量 seed 也由此发出)
      const ours = Y.encodeStateAsUpdate(this.doc, stateVector)
      this.ws?.send(encodeMessage(MSG.PUSH, ours))
      return
    }
    if (msg.type === MSG.BROADCAST) {
      Y.applyUpdate(this.doc, msg.payload, REMOTE_ORIGIN)
      return
    }
    // MSG.AWARENESS —— 计划 C 处理
  }

  private onClose(): void {
    this.detachUpdateListener()
    this.ws = null
    if (this.closed) {
      this.setStatus('disconnected')
      return
    }
    this.setStatus('connecting')
    const delay = Math.min(1000 * 2 ** this.retry, MAX_BACKOFF_MS)
    this.retry++
    this.reconnectTimer = setTimeout(() => {
      if (!this.closed) this.open()
    }, delay)
  }

  private attachUpdateListener(): void {
    if (this.updateListenerActive) return
    this.doc.on('update', this.onLocalUpdate)
    this.updateListenerActive = true
  }

  private detachUpdateListener(): void {
    if (!this.updateListenerActive) return
    this.doc.off('update', this.onLocalUpdate)
    this.updateListenerActive = false
  }

  private onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE_ORIGIN) return // 远端来的,不回推
    if (this.status !== 'connected' || !this.ws) return
    this.ws.send(encodeMessage(MSG.PUSH, update))
  }
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm test:run RemoteConnection` —— 预期全部 PASS。
Run: `pnpm exec tsc --noEmit` —— 预期 0 error。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(collab): RemoteConnection websocket sync state machine"
```

---

## Task 5: LocalSyncEngine → SyncEngine,接入 remote 与 meta

引擎重命名,并新增:挂 remote(`connectRemote`)、meta 读写代理、连接状态回调。

**Files:**

- Rename: `src/collab/LocalSyncEngine.ts` → `src/collab/SyncEngine.ts`
- Rename: `src/collab/LocalSyncEngine.test.ts` → `src/collab/SyncEngine.test.ts`
- Modify: 引用方(`src/store/timelineStore.ts` 等,以 grep 为准)

- [ ] **Step 1: 重命名文件**

```bash
git mv src/collab/LocalSyncEngine.ts src/collab/SyncEngine.ts
git mv src/collab/LocalSyncEngine.test.ts src/collab/SyncEngine.test.ts
```

- [ ] **Step 2: 重写 SyncEngine**

`src/collab/SyncEngine.ts` 整体替换为:

```typescript
import * as Y from 'yjs'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
import { RemoteConnection, type ConnectionStatus } from './RemoteConnection'
import { Y_MAP, LOCAL_ORIGIN } from './constants'
import type { LocalDocMeta } from './types'

/** 构造连到该文档 DO 的 WebSocket URL */
function buildWsUrl(docId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/timelines/${docId}/connect`
}

/**
 * 同步引擎。持有 Y.Doc、本地 IndexedDB 持久化、UndoManager;
 * 已发布时间轴额外挂一个 RemoteConnection 作为 remote peer。
 */
export class SyncEngine {
  readonly docId: string
  readonly doc: Y.Doc
  readonly undoManager: Y.UndoManager
  private readonly store: IndexedDBDocStore
  private remote: RemoteConnection | null = null
  private pending: Promise<void> = Promise.resolve()
  private lastPersistError: unknown = null

  private constructor(docId: string, doc: Y.Doc, store: IndexedDBDocStore) {
    this.docId = docId
    this.doc = doc
    this.store = store
    this.undoManager = new Y.UndoManager(
      [
        Y_MAP.meta,
        Y_MAP.damageEvents,
        Y_MAP.castEvents,
        Y_MAP.annotations,
        Y_MAP.composition,
        Y_MAP.statData,
      ].map(n => doc.getMap(n)),
      { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 400 }
    )
    this.doc.on('update', this.onUpdate)
  }

  /**
   * 打开一条时间轴。
   * @param seed 仅新建时传入(本地无持久化数据时用作初始 Y.Doc)
   */
  static async create(docId: string, seed?: Y.Doc): Promise<SyncEngine> {
    const store = new IndexedDBDocStore()
    await store.open()
    const persisted = await store.loadDoc(docId)
    const doc = new Y.Doc()
    if (persisted) {
      Y.applyUpdate(doc, persisted, 'persisted')
    } else if (seed) {
      const seedUpdate = Y.encodeStateAsUpdate(seed)
      Y.applyUpdate(doc, seedUpdate, 'persisted')
      await store.appendUpdate(docId, seedUpdate)
    }
    return new SyncEngine(docId, doc, store)
  }

  /** 挂上远端连接(发布 / editor 模式)。幂等。 */
  connectRemote(getJwt: () => string | null, onStatus: (status: ConnectionStatus) => void): void {
    if (this.remote) return
    this.remote = new RemoteConnection(buildWsUrl(this.docId), this.doc, getJwt, onStatus)
    this.remote.connect()
  }

  /** 是否已挂 remote */
  get hasRemote(): boolean {
    return this.remote !== null
  }

  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === 'persisted') return // 来自加载,无需再落盘
    this.pending = this.pending
      .then(() => this.store.appendUpdate(this.docId, update))
      .catch(err => {
        this.lastPersistError = err
        console.error('[collab] persist update failed', err)
      })
  }

  /** 等所有待持久化 update 落盘;期间有失败则抛最近一次错误。 */
  flush(): Promise<void> {
    return this.pending.then(() => {
      if (this.lastPersistError !== null) {
        const err = this.lastPersistError
        this.lastPersistError = null
        throw err
      }
    })
  }

  /** 写入本地元数据行 */
  saveMeta(meta: LocalDocMeta): Promise<void> {
    return this.store.putMeta(meta)
  }

  /** 读本地元数据行 */
  loadMeta(): Promise<LocalDocMeta | null> {
    return this.store.getMeta(this.docId)
  }

  destroy(): void {
    this.remote?.destroy()
    this.remote = null
    this.doc.off('update', this.onUpdate)
    this.undoManager.destroy()
  }
}
```

- [ ] **Step 3: 更新全部引用**

Run: `grep -rln "LocalSyncEngine" src` —— 对每个命中文件,把 `LocalSyncEngine` 改为 `SyncEngine`、import 路径 `@/collab/LocalSyncEngine` 改 `@/collab/SyncEngine`。

`src/store/timelineStore.ts` 内会命中类型注解(`engine: LocalSyncEngine | null`)和 import —— 一并改;该文件 Task 7 还会大改,此处只做机械重命名让其可编译。

- [ ] **Step 4: 修 SyncEngine.test.ts**

`src/collab/SyncEngine.test.ts` 内 `LocalSyncEngine` 全部改 `SyncEngine`、import 改 `./SyncEngine`。原有用例(create / appendUpdate / flush)逻辑不变,应继续通过。

- [ ] **Step 5: 跑测试与类型检查**

Run: `pnpm test:run SyncEngine` —— 预期 PASS。
Run: `pnpm exec tsc --noEmit` —— 预期 0 error。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(collab): rename to SyncEngine, add remote and meta"
```

---

## Task 6: createLocalTimeline 辅助函数

新建一条本地(未发布)时间轴:生成 id → `buildYDoc` → 写 IndexedDB snapshot + meta 行 → 返回 id。三个新建入口(CreateTimelineDialog / ImportFFLogsDialog / handleCreateCopy)共用。

**Files:**

- Create: `src/collab/createLocalTimeline.ts`
- Test: `src/collab/createLocalTimeline.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `src/collab/createLocalTimeline.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { createLocalTimeline } from './createLocalTimeline'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
import type { TimelineContent } from './types'

function sampleContent(): TimelineContent {
  return {
    name: '测试轴',
    encounter: { id: 88, name: 'E', displayName: 'E', zone: '', damageEvents: [] },
    composition: { players: [{ id: 0, job: 'WHM' }] },
    damageEvents: [],
    castEvents: [],
    annotations: [],
    createdAt: 100,
  }
}

describe('createLocalTimeline', () => {
  it('persists snapshot and meta, returns the new id', async () => {
    const id = await createLocalTimeline(sampleContent())
    expect(id).toBeTruthy()

    const store = new IndexedDBDocStore()
    await store.open()
    expect(await store.loadDoc(id)).not.toBeNull()

    const meta = await store.getMeta(id)
    expect(meta).not.toBeNull()
    expect(meta?.docId).toBe(id)
    expect(meta?.name).toBe('测试轴')
    expect(meta?.encounterId).toBe(88)
    expect(meta?.published).toBe(false)
  })

  it('generates distinct ids on each call', async () => {
    const a = await createLocalTimeline(sampleContent())
    const b = await createLocalTimeline(sampleContent())
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm test:run createLocalTimeline` —— 预期 FAIL(模块不存在)。

- [ ] **Step 3: 实现 createLocalTimeline**

新建 `src/collab/createLocalTimeline.ts`:

```typescript
import * as Y from 'yjs'
import { generateId } from '@/utils/id'
import { buildYDoc } from './docSchema'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
import type { TimelineContent, LocalDocMeta } from './types'

/**
 * 新建一条本地(未发布)时间轴。
 * 生成 id → buildYDoc → 写 IndexedDB snapshot + meta 行 → 返回 id。
 */
export async function createLocalTimeline(content: TimelineContent): Promise<string> {
  const docId = generateId()
  const doc = buildYDoc(content)

  const store = new IndexedDBDocStore()
  await store.open()
  await store.appendUpdate(docId, Y.encodeStateAsUpdate(doc))

  const now = Math.floor(Date.now() / 1000)
  const meta: LocalDocMeta = {
    docId,
    name: content.name,
    encounterId: content.encounter?.id ?? 0,
    createdAt: content.createdAt ?? now,
    updatedAt: now,
    composition: content.composition ?? null,
    published: false,
  }
  if (content.fflogsSource) meta.fflogsSource = content.fflogsSource
  await store.putMeta(meta)

  return docId
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm test:run createLocalTimeline` —— 预期 PASS。
Run: `pnpm exec tsc --noEmit` —— 预期 0 error。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(collab): createLocalTimeline helper"
```

---

## Task 7: timelineStore 接入 remote / viewer / 发布

`timelineStore` 改造:`openTimeline` 支持挂 remote;新增 `setViewerSnapshot`(viewer 模式,无引擎)、`attachRemote`(原地发布升级);`applyPublishResult` 真实现;删 `setTimeline` / `applyUpdateResult` / `applyServerTimeline`;新增 `connectionStatus` / `isPublished` 字段;reproject 后 debounced 写 meta。

**Files:**

- Modify: `src/store/timelineStore.ts`

- [ ] **Step 1: 改 imports 与接口**

`src/store/timelineStore.ts`:

(a) 删除对 `SharedTimelineResponse` 的 import(第 19 行)。

(b) `SyncEngine` import(Task 5 已改名)下方加:

```typescript
import type { ConnectionStatus } from '@/collab/RemoteConnection'
import { IndexedDBDocStore } from '@/collab/storage/IndexedDBDocStore'
import type { LocalDocMeta } from '@/collab/types'
import { useAuthStore } from '@/store/authStore'
```

(c) `TimelineState` 接口:

- 加字段:`connectionStatus: ConnectionStatus` 与 `isPublished: boolean`。
- `openTimeline` 签名改为:
  ```typescript
  openTimeline: (docId: string, opts?: { seedContent?: TimelineContent; published?: boolean }) =>
    Promise<void>
  ```
- 删除 `setTimeline`、`applyUpdateResult`、`applyServerTimeline` 三个成员声明。
- 新增声明:
  ```typescript
  /** viewer 模式:直接用服务端 snapshot 只读渲染,不建引擎 */
  setViewerSnapshot: (timeline: Timeline) => void
  /** 原地发布升级:给当前引擎挂 remote(同 id 发布用) */
  attachRemote: () => void
  ```
- `applyPublishResult` 签名改为:`applyPublishResult: (newId: string) => Promise<void>`。

- [ ] **Step 2: 改 initialUiState 与默认值**

`initialUiState` 加两项:

```typescript
const initialUiState = {
  partyState: null,
  statistics: null,
  selectedEventId: null,
  selectedCastEventId: null,
  currentTime: 0,
  zoomLevel: 30,
  pendingScrollProgress: null,
  currentScrollLeft: 0,
  currentTimelineWidth: 0,
  currentViewportWidth: 0,
  connectionStatus: 'disconnected' as ConnectionStatus,
  isPublished: false,
}
```

store 初始 return 里 `connectionStatus` / `isPublished` 通过 `...initialUiState` 已带入。

- [ ] **Step 3: 加 meta debounce 写入 + remote 连接 helper**

在 `create<TimelineState>()((set, get) => {` 之后、`reproject` 定义附近,加:

```typescript
/** debounced meta 写入句柄 */
let metaTimer: ReturnType<typeof setTimeout> | null = null

/** 把当前投影写入 IndexedDB meta 表(debounced 1s) */
const scheduleMetaWrite = () => {
  if (metaTimer) clearTimeout(metaTimer)
  metaTimer = setTimeout(() => {
    metaTimer = null
    const { engine, timeline, isPublished } = get()
    if (!engine || !timeline) return
    const meta: LocalDocMeta = {
      docId: engine.docId,
      name: timeline.name,
      encounterId: timeline.encounter?.id ?? 0,
      createdAt: timeline.createdAt,
      updatedAt: timeline.updatedAt,
      composition: timeline.composition ?? null,
      published: isPublished,
    }
    if (timeline.fflogsSource) meta.fflogsSource = timeline.fflogsSource
    void engine.saveMeta(meta)
  }, 1000)
}
```

把 `reproject` 末尾改为在 `set({ timeline: next })` 之后调用 `scheduleMetaWrite()`:

```typescript
const reproject = () => {
  const engine = get().engine
  if (!engine) return
  const prev = get().timeline ?? undefined
  const next = projectTimeline(engine.doc, prev)
  next.id = engine.docId
  next.updatedAt = Math.floor(Date.now() / 1000)
  set({ timeline: next })
  scheduleMetaWrite()
}
```

并加一个挂 remote 的内部 helper:

```typescript
/** 给指定引擎挂 remote;连接状态回流到 store */
const wireRemote = (engine: SyncEngine) => {
  engine.connectRemote(
    () => useAuthStore.getState().accessToken,
    status => set({ connectionStatus: status })
  )
}
```

- [ ] **Step 4: 改 openTimeline**

`openTimeline` 改为(在原实现基础上:新签名、按 `published` 设 `isPublished` 并挂 remote):

```typescript
    openTimeline: async (docId, opts) => {
      const myGeneration = ++openGeneration

      const prevEngine = get().engine
      if (prevEngine) {
        prevEngine.doc.off('update', reproject)
        prevEngine.destroy()
      }
      set({
        engine: null,
        timeline: null,
        selectedEventId: null,
        selectedCastEventId: null,
        canUndo: false,
        canRedo: false,
        connectionStatus: 'disconnected',
        isPublished: !!opts?.published,
      })

      const seedContent = opts?.seedContent
      const seedDoc =
        seedContent !== undefined
          ? buildYDoc(
              seedContent.statData
                ? seedContent
                : { ...seedContent, statData: createEmptyStatData() }
            )
          : undefined

      const engine = await SyncEngine.create(docId, seedDoc)

      if (myGeneration !== openGeneration) {
        engine.destroy()
        return
      }

      engine.doc.on('update', reproject)
      engine.undoManager.on('stack-item-added', syncUndoState)
      engine.undoManager.on('stack-item-popped', syncUndoState)
      engine.undoManager.on('stack-cleared', syncUndoState)
      set({ engine, currentTime: 0 })
      reproject()

      const projected = get().timeline
      if (projected && !projected.statData) {
        engine.doc.transact(() => {
          replaceStatData(engine.doc, createEmptyStatData())
        }, HOUSEKEEPING_ORIGIN)
      }

      const composition = get().timeline?.composition
      if (composition) {
        get().initializePartyState(composition)
      }

      // editor 模式:挂 remote(WS 连接 → load-doc → 双向同步)
      if (opts?.published) {
        wireRemote(engine)
      }
    },
```

- [ ] **Step 5: 加 setViewerSnapshot / attachRemote,改 applyPublishResult,删旧 shim**

把 `setTimeline`(第 275–282 行)整段删除,替换为 `setViewerSnapshot`:

```typescript
    setViewerSnapshot: timeline => {
      // viewer:无引擎,直接用服务端 snapshot 只读渲染
      const engine = get().engine
      if (engine) {
        engine.doc.off('update', reproject)
        engine.destroy()
      }
      set({
        engine: null,
        timeline,
        isPublished: true,
        connectionStatus: 'disconnected',
        canUndo: false,
        canRedo: false,
        selectedEventId: null,
        selectedCastEventId: null,
      })
      if (timeline.composition) get().initializePartyState(timeline.composition)
    },
```

把 `applyPublishResult`(第 522–525 行)替换为:

```typescript
    attachRemote: () => {
      const engine = get().engine
      if (!engine || engine.hasRemote) return
      set({ isPublished: true })
      engine.connectRemote(
        () => useAuthStore.getState().accessToken,
        status => set({ connectionStatus: status })
      )
    },

    applyPublishResult: async newId => {
      // 同 id 发布:原地给当前引擎挂 remote(Y.Doc 全程连续,不重建)。
      // id 被服务端清洗变更:由调用方 rekey IndexedDB 后 navigate 触发 EditorPage
      // 以 editor 模式重新 openTimeline,此处不处理。
      const engine = get().engine
      if (engine && engine.docId === newId) {
        get().attachRemote()
      }
    },
```

删除 `applyUpdateResult`(第 527–529 行)与 `applyServerTimeline`(第 531–538 行)整段。

- [ ] **Step 6: reset 清 debounce + 连接态**

`reset` 改为:

```typescript
    reset: () => {
      if (metaTimer) {
        clearTimeout(metaTimer)
        metaTimer = null
      }
      const engine = get().engine
      if (engine) {
        engine.doc.off('update', reproject)
        engine.destroy()
      }
      set({ engine: null, timeline: null, canUndo: false, canRedo: false, ...initialUiState })
    },
```

- [ ] **Step 7: 类型检查 + 全量测试**

Run: `pnpm exec tsc --noEmit` —— 预期此时 `EditorPage` / `EditorToolbar` 等引用 `setTimeline` 的旧代码会报错,这是预期的(Task 9/13 修)。**本任务只需 `timelineStore.ts` 自身无类型错误。** 用 `pnpm exec tsc --noEmit 2>&1 | grep timelineStore` 确认 store 文件本身干净。
Run: `pnpm test:run timelineStore` —— 若存在 store 测试,按新接口修正(`setTimeline` 用例改 `setViewerSnapshot`)。

> 实现者:本任务后代码库**整体 tsc 不通过**(消费方未改),属计划内中间态;Task 9–13 修复全部消费方。提交本任务时跳过 `tsc` 全量门禁,只保证 `timelineStore.ts` 与其测试自身一致。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(collab): timelineStore remote / viewer / publish wiring"
```

---

## Task 8: 重写客户端迁移(已发布 vs 纯本地)

重写 `migration.ts` 的单次迁移:遍历旧 localStorage 时间轴,**已发布(曾 `isShared`)** 的丢弃本地 Y.Doc、只建 `published=true` 的 meta 行(服务端权威);**纯本地** 的 `buildYDoc` 落 IndexedDB snapshot + `published=false` meta 行。完成后清理旧 localStorage key。沿用同一个 `MIGRATION_FLAG`(见关键设计决定 1)。

**Files:**

- Modify: `src/collab/migration.ts`
- Test: `src/collab/migration.test.ts`

- [ ] **Step 1: 写失败测试**

`src/collab/migration.test.ts` —— 替换为(沿用文件已有的 localStorage / fake-indexeddb 模拟风格):

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { runClientMigration } from './migration'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
import { MIGRATION_FLAG } from './constants'

const STORAGE_KEY = 'healerbook_timelines'

function seedLegacyTimeline(id: string, name: string, isShared: boolean) {
  const meta = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  meta.push({
    id,
    name,
    encounterId: '1',
    createdAt: 1,
    updatedAt: 1,
    ...(isShared && { isShared: true }),
  })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meta))
  localStorage.setItem(
    `${STORAGE_KEY}_${id}`,
    JSON.stringify({
      id,
      name,
      isShared,
      encounter: { id: 1, name: 'E', displayName: 'E', zone: '', damageEvents: [] },
      composition: { players: [] },
      damageEvents: [],
      castEvents: [],
      annotations: [],
      createdAt: 1,
      updatedAt: 1,
    })
  )
}

beforeEach(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('healerbook_collab')
})

describe('runClientMigration', () => {
  it('migrates a pure-local timeline to a Y.Doc with published=false meta', async () => {
    seedLegacyTimeline('local-1', '本地轴', false)
    await runClientMigration()

    const store = new IndexedDBDocStore()
    await store.open()
    expect(await store.loadDoc('local-1')).not.toBeNull()
    const meta = await store.getMeta('local-1')
    expect(meta?.published).toBe(false)
  })

  it('does NOT store a local Y.Doc for a formerly-shared timeline', async () => {
    seedLegacyTimeline('shared-1', '云端轴', true)
    await runClientMigration()

    const store = new IndexedDBDocStore()
    await store.open()
    expect(await store.loadDoc('shared-1')).toBeNull() // 服务端权威,本地不存 Y.Doc
    const meta = await store.getMeta('shared-1')
    expect(meta?.published).toBe(true)
  })

  it('clears legacy localStorage keys and sets the flag', async () => {
    seedLegacyTimeline('x', 'X', false)
    await runClientMigration()
    expect(localStorage.getItem(`${STORAGE_KEY}_x`)).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(MIGRATION_FLAG)).toBe('1')
  })

  it('is idempotent — second run is a no-op', async () => {
    seedLegacyTimeline('y', 'Y', false)
    await runClientMigration()
    seedLegacyTimeline('z', 'Z', false) // 第二次运行前再塞一条
    await runClientMigration()
    const store = new IndexedDBDocStore()
    await store.open()
    expect(await store.getMeta('z')).toBeNull() // flag 已置,不再迁移
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm test:run migration` —— 预期新用例 FAIL(旧迁移不建 meta、不区分 published、不清 key)。

- [ ] **Step 3: 重写 migration.ts**

`src/collab/migration.ts` 整体替换为:

```typescript
import { encodeStateAsUpdate } from 'yjs'
import type { Timeline } from '@/types/timeline'
import { getAllTimelineMetadata, getTimeline } from '@/utils/timelineStorage'
import { buildYDoc } from './docSchema'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
import { MIGRATION_FLAG } from './constants'
import type { TimelineContent, LocalDocMeta } from './types'

const STORAGE_KEY = 'healerbook_timelines'

function toContent(t: Timeline): TimelineContent {
  const content: TimelineContent = {
    name: t.name,
    encounter: t.encounter,
    composition: t.composition,
    damageEvents: t.damageEvents,
    castEvents: t.castEvents,
    annotations: t.annotations,
    createdAt: t.createdAt,
  }
  if (t.description !== undefined) content.description = t.description
  if (t.fflogsSource !== undefined) content.fflogsSource = t.fflogsSource
  if (t.gameZoneId !== undefined) content.gameZoneId = t.gameZoneId
  if (t.syncEvents !== undefined) content.syncEvents = t.syncEvents
  if (t.isReplayMode !== undefined) content.isReplayMode = t.isReplayMode
  if (t.statData !== undefined) content.statData = t.statData
  return content
}

/**
 * 客户端一次性迁移:旧 localStorage 时间轴 → IndexedDB。
 *
 * - 纯本地(从未发布)时间轴 → buildYDoc 落 snapshot,meta.published=false。
 * - 已发布(曾 isShared)时间轴 → 不存本地 Y.Doc(服务端是唯一权威),
 *   只建 meta.published=true 行;首次打开走 editor/viewer 路径从 DO 拉取。
 *
 * 完成后清理旧 localStorage key。幂等 —— 靠 MIGRATION_FLAG 保证只跑一次。
 */
export async function runClientMigration(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG)) return

  const store = new IndexedDBDocStore()
  await store.open()

  const legacyIds: string[] = []

  for (const meta of getAllTimelineMetadata()) {
    legacyIds.push(meta.id)
    try {
      const timeline = getTimeline(meta.id)
      if (!timeline) continue
      const now = Math.floor(Date.now() / 1000)
      const published = !!timeline.isShared
      const docMeta: LocalDocMeta = {
        docId: meta.id,
        name: timeline.name,
        encounterId: timeline.encounter?.id ?? 0,
        createdAt: timeline.createdAt,
        updatedAt: timeline.updatedAt || now,
        composition: timeline.composition ?? null,
        published,
      }
      if (timeline.fflogsSource) docMeta.fflogsSource = timeline.fflogsSource
      await store.putMeta(docMeta)

      if (!published) {
        // 纯本地:落 Y.Doc
        const doc = buildYDoc(toContent(timeline))
        await store.appendUpdate(meta.id, encodeStateAsUpdate(doc))
      }
      // 已发布:不落本地 Y.Doc,首开时从 DO 拉取
    } catch (err) {
      console.error('[collab-migration] 跳过损坏条目', meta.id, err)
    }
  }

  // 清理旧 localStorage 时间轴 key
  for (const id of legacyIds) {
    localStorage.removeItem(`${STORAGE_KEY}_${id}`)
  }
  localStorage.removeItem(STORAGE_KEY)

  localStorage.setItem(MIGRATION_FLAG, '1')
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm test:run migration` —— 预期全部 PASS。
Run: `pnpm exec tsc --noEmit 2>&1 | grep migration` —— 预期 `migration.ts` 自身无错。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(collab): rewrite client migration for published vs local"
```

---

## Task 9: EditorPage 三模式 async 改造

`EditorPage` 改为:`local` / `editor` / `viewer` / `loading` / `not_found` / `network_error` 六态。模式由本地 IndexedDB meta + `GET /api/timelines/:id` 角色 async 推导。删除全部 localStorage(`getTimeline`/`saveTimeline`/`unpublishTimeline`)路径。

**模式推导**(整合 spec §5):

- 本地 meta 存在且 `published=false` → `local`:`openTimeline(id)`。
- 本地 meta 存在且 `published=true` → `editor`:`openTimeline(id, { published:true })`。
- 本地无 meta → `GET /api/timelines/:id`:
  - 抛 `NOT_FOUND` → `not_found`;其他错误 → `network_error`。
  - `role=editor` → `editor`:`openTimeline(id, { published:true })`。
  - `role=viewer` → `viewer`:`setViewerSnapshot(snapshot)`。

**Files:**

- Modify: `src/pages/EditorPage.tsx`
- Test: 无单测(React 组件,沿用 `tsc` + 回归 + 手验,见 spec §10)

- [ ] **Step 1: 重写 EditorPage**

`src/pages/EditorPage.tsx` 整体替换为:

```typescript
/**
 * 编辑器 / 查看页面(统一路由 /timeline/:id)
 *
 * 六种状态:
 *   local         — 本地 IndexedDB 有且未发布:纯本地编辑
 *   editor        — 已发布且当前用户在编辑者白名单:实时协同编辑
 *   viewer        — 已发布、他人时间轴:只读查看(服务端 snapshot)
 *   loading       — 模式推导中
 *   not_found     — 本地无 + 服务端 404
 *   network_error — 服务端请求失败(非 404)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { House } from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { setSyncScrollProgress } from '@/utils/syncScrollProgress'
import { fetchSharedTimeline } from '@/api/timelineShareApi'
import { createLocalTimeline } from '@/collab/createLocalTimeline'
import { IndexedDBDocStore } from '@/collab/storage/IndexedDBDocStore'
import { useEncounterStatistics } from '@/hooks/useEncounterStatistics'
import { useDamageCalculation } from '@/hooks/useDamageCalculation'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { DamageCalculationContext } from '@/contexts/DamageCalculationContext'
import { createPlacementEngine } from '@/utils/placement/engine'
import EditorToolbar from '@/components/EditorToolbar'
import PropertyPanel from '@/components/PropertyPanel'
import TimelineCanvas from '@/components/Timeline'
import TimelineTableView from '@/components/TimelineTable'
import ErrorBoundary from '@/components/ErrorBoundary'
import EditableTitle from '@/components/EditableTitle'
import EditableDescription from '@/components/EditableDescription'
import FullScreenLoader from '@/components/FullScreenLoader'
import { Button } from '@/components/ui/button'
import { APP_NAME } from '@/lib/constants'
import ThemeToggle from '@/components/ThemeToggle'
import { track } from '@/utils/analytics'

type PageMode = 'local' | 'editor' | 'viewer' | 'loading' | 'not_found' | 'network_error'

export default function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const viewMode: 'timeline' | 'table' = searchParams.get('view') === 'table' ? 'table' : 'timeline'
  const handleViewModeChange = (mode: 'timeline' | 'table') => {
    const next = new URLSearchParams(searchParams)
    if (mode === 'table') next.set('view', 'table')
    else next.delete('view')
    setSearchParams(next, { replace: true })
  }

  const timeline = useTimelineStore(s => s.timeline)
  const updateTimelineName = useTimelineStore(s => s.updateTimelineName)
  const updateTimelineDescription = useTimelineStore(s => s.updateTimelineDescription)
  const openTimeline = useTimelineStore(s => s.openTimeline)
  const setViewerSnapshot = useTimelineStore(s => s.setViewerSnapshot)
  const reset = useTimelineStore(s => s.reset)

  const mitigationActions = useMitigationStore(s => s.actions)
  const loadMitigationActions = useMitigationStore(s => s.loadActions)

  const [mode, setMode] = useState<PageMode>('loading')
  const [authorName, setAuthorName] = useState<string>('')

  useEffect(() => {
    if (mitigationActions.length === 0) loadMitigationActions()
  }, [mitigationActions.length, loadMitigationActions])

  // ── 模式推导 + 加载 ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) {
      setMode('not_found')
      return
    }
    let ignore = false
    setMode('loading')
    setAuthorName('')
    useUIStore.setState({ isReadOnly: false })

    ;(async () => {
      try {
        const store = new IndexedDBDocStore()
        await store.open()
        const meta = await store.getMeta(id)
        if (ignore) return

        if (meta) {
          if (meta.published) {
            await openTimeline(id, { published: true })
            if (!ignore) setMode('editor')
          } else {
            await openTimeline(id)
            if (!ignore) setMode('local')
          }
          return
        }

        // 本地无:问服务端
        const res = await fetchSharedTimeline(id)
        if (ignore) return
        setAuthorName(res.authorName)
        if (res.role === 'editor') {
          await openTimeline(id, { published: true })
          if (!ignore) setMode('editor')
        } else {
          setViewerSnapshot(res.snapshot!)
          useUIStore.setState({ isReadOnly: true })
          if (!ignore) setMode('viewer')
          track('timeline-view-shared', { timelineId: id })
        }
      } catch (err) {
        if (ignore) return
        setMode(
          err instanceof Error && err.message === 'NOT_FOUND' ? 'not_found' : 'network_error'
        )
      }
    })()

    return () => {
      ignore = true
    }
  }, [id, openTimeline, setViewerSnapshot])

  // 卸载 / 切 id 时重置 store(断开 WS、销毁引擎)
  useEffect(() => {
    return () => {
      useUIStore.setState({ isReadOnly: false })
      reset()
    }
  }, [id, reset])

  // 发布成功回调:同 id 原地升级 editor;id 变更则 navigate 重挂
  const handlePublished = useCallback(
    (newId: string) => {
      if (newId === id) {
        setMode('editor')
      } else {
        const query = viewMode === 'table' ? '?view=table' : ''
        navigate(`/timeline/${newId}${query}`, { replace: true })
      }
    },
    [id, navigate, viewMode]
  )

  // ── 在本地创建副本(viewer 模式) ─────────────────────────────────────────
  const handleCreateCopy = async () => {
    if (!timeline) return
    const { id: _id, statusEvents, updatedAt, ...rest } = timeline
    void _id
    void statusEvents
    void updatedAt
    const newId = await createLocalTimeline({
      ...rest,
      name: `${timeline.name}(副本)`,
      annotations: timeline.annotations ?? [],
      createdAt: Math.floor(Date.now() / 1000),
    })
    track('timeline-create-copy', { encounterId: timeline.encounter?.id })
    navigate(`/timeline/${newId}`)
  }

  // callback ref
  const [canvasContainer, setCanvasContainer] = useState<HTMLDivElement | null>(null)
  const canvasContainerRef = useCallback((node: HTMLDivElement | null) => {
    setCanvasContainer(node)
  }, [])
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })

  useEncounterStatistics(timeline?.encounter?.id)
  const selectedCastEventId = useTimelineStore(s => s.selectedCastEventId)
  const draggingId = useUIStore(s => s.draggingId)
  const extraExcludeIds = useMemo(
    () => [selectedCastEventId, draggingId].filter((x): x is string => !!x),
    [selectedCastEventId, draggingId]
  )
  const calculationResults = useDamageCalculation(timeline, { extraExcludeIds })
  const isReadOnly = useEditorReadOnly()

  // 跨视图变体自动重分类(逻辑同原实现)
  useEffect(() => {
    if (!timeline || isReadOnly) return
    const engine = createPlacementEngine({
      castEvents: timeline.castEvents,
      actions: new Map(mitigationActions.map(a => [a.id, a])),
      statusTimelineByPlayer: calculationResults.statusTimelineByPlayer,
    })
    const actionById = new Map(mitigationActions.map(a => [a.id, a]))
    const { updateCastEvent } = useTimelineStore.getState()
    for (const ce of timeline.castEvents) {
      const ca = actionById.get(ce.actionId)
      if (!ca) continue
      const groupId = ca.trackGroup ?? ca.id
      let memberCount = 0
      for (const a of mitigationActions) {
        if ((a.trackGroup ?? a.id) === groupId) memberCount++
        if (memberCount >= 2) break
      }
      if (memberCount < 2) continue
      if (engine.canPlaceCastEvent(ca, ce.playerId, ce.timestamp, ce.id).ok) continue
      const member = engine.pickUniqueMember(groupId, ce.playerId, ce.timestamp, ce.id)
      if (member && member.id !== ce.actionId) {
        updateCastEvent(ce.id, { actionId: member.id })
      }
    }
  }, [calculationResults.statusTimelineByPlayer, timeline, mitigationActions, isReadOnly])

  useEffect(() => {
    return () => {
      setSyncScrollProgress(0)
    }
  }, [])

  useEffect(() => {
    const preventZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault()
    }
    const preventGesture = (e: Event) => e.preventDefault()
    document.addEventListener('wheel', preventZoom, { passive: false })
    document.addEventListener('gesturestart', preventGesture)
    document.addEventListener('gesturechange', preventGesture)
    return () => {
      document.removeEventListener('wheel', preventZoom)
      document.removeEventListener('gesturestart', preventGesture)
      document.removeEventListener('gesturechange', preventGesture)
    }
  }, [])

  useEffect(() => {
    if (!canvasContainer) return
    let resizeTimeout: number | null = null
    const updateSize = () => {
      const newWidth = canvasContainer.clientWidth
      const newHeight = canvasContainer.clientHeight
      setCanvasSize(prev =>
        prev.width === newWidth && prev.height === newHeight
          ? prev
          : { width: newWidth, height: newHeight }
      )
    }
    const debouncedUpdateSize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = window.setTimeout(updateSize, 100)
    }
    updateSize()
    window.addEventListener('resize', debouncedUpdateSize)
    const resizeObserver = new ResizeObserver(debouncedUpdateSize)
    resizeObserver.observe(canvasContainer)
    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      window.removeEventListener('resize', debouncedUpdateSize)
      resizeObserver.disconnect()
    }
  }, [canvasContainer])

  // ── 加载 / 错误屏 ─────────────────────────────────────────────────────────
  if (mode === 'loading') return <FullScreenLoader />

  if (mode === 'not_found') {
    return (
      <div className="flex min-h-screen items-center justify-center flex-col gap-4">
        <p className="text-muted-foreground">时间轴不存在或已删除</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          <House className="w-4 h-4 mr-2" />
          返回首页
        </Button>
      </div>
    )
  }

  if (mode === 'network_error') {
    return (
      <div className="flex min-h-screen items-center justify-center flex-col gap-4">
        <p className="text-muted-foreground">加载失败,请检查网络连接</p>
        <Button onClick={() => window.location.reload()}>重试</Button>
        <Button variant="outline" onClick={() => navigate('/')}>
          <House className="w-4 h-4 mr-2" />
          返回首页
        </Button>
      </div>
    )
  }

  const isViewMode = mode === 'viewer'

  return (
    <div
      className="editor-page flex flex-col bg-background overflow-hidden"
      style={{ height: '100dvh' }}
    >
      <title>{timeline?.name ? `${timeline.name} - ${APP_NAME}` : APP_NAME}</title>

      <header className="border-b flex-shrink-0">
        <div className="px-4 py-3 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 hover:bg-accent rounded-md transition-colors"
          >
            <House className="w-5 h-5" />
          </button>

          {isViewMode ? (
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold">{timeline?.name}</h1>
                {authorName && (
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                    By {authorName}
                  </span>
                )}
              </div>
              <EditableDescription
                value={timeline?.description || ''}
                onChange={() => {}}
                readOnly
              />
            </div>
          ) : (
            <div>
              <EditableTitle
                value={timeline?.name || '时间轴编辑器'}
                onChange={updateTimelineName}
                className="text-lg font-bold"
              />
              <EditableDescription
                value={timeline?.description || ''}
                onChange={updateTimelineDescription}
              />
            </div>
          )}

          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <DamageCalculationContext.Provider value={calculationResults}>
        <EditorToolbar
          onCreateCopy={isViewMode ? handleCreateCopy : undefined}
          onPublished={handlePublished}
          forceReadOnly={isViewMode}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
        />

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <div ref={canvasContainerRef} className="h-full">
              {timeline ? (
                <ErrorBoundary>
                  {viewMode === 'table' ? (
                    <TimelineTableView />
                  ) : (
                    <TimelineCanvas width={canvasSize.width} height={canvasSize.height} />
                  )}
                </ErrorBoundary>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-muted-foreground">加载中...</p>
                </div>
              )}
            </div>
          </div>
        </div>
        <PropertyPanel />
      </DamageCalculationContext.Provider>
    </div>
  )
}
```

> 实现者注意:
>
> - `handleCreateCopy` 用解构剔除 `id`/`statusEvents`/`updatedAt` 得到 `TimelineContent` 形状。`timeline` 投影对象还含 `isShared` 等惰性字段 —— `createLocalTimeline` 接 `TimelineContent`,多余字段经 `buildYDoc` 的 `META_KEYS` 白名单自然丢弃,类型上 `TimelineContent` 是 `Omit`,`...rest` 含多余字段会报类型错;若 tsc 报错,改为显式构造 `TimelineContent`(参照 `migration.ts` 的 `toContent`)。
> - `EditorToolbar` 新增 `onPublished` prop —— Task 13 同步加上。本任务后 `EditorToolbar` 会有未知 prop 类型错,Task 13 修。
> - viewer 模式 `EditableDescription` 用 `timeline?.description`(来自 snapshot 投影),不再用 `apiData`。

- [ ] **Step 2: 类型检查(局部)**

Run: `pnpm exec tsc --noEmit 2>&1 | grep EditorPage` —— `EditorPage.tsx` 自身除 `EditorToolbar` 的 `onPublished` prop 外应无错(该 prop 错由 Task 13 消除)。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(collab): EditorPage three-mode async loading"
```

---

## Task 10: 新建流程接 createLocalTimeline

`CreateTimelineDialog` / `ImportFFLogsDialog` 的新建落盘改走 `createLocalTimeline`,不再 `saveTimeline`。

**Files:**

- Modify: `src/components/CreateTimelineDialog.tsx`
- Modify: `src/components/ImportFFLogsDialog.tsx`

- [ ] **Step 1: 改 CreateTimelineDialog**

`src/components/CreateTimelineDialog.tsx`:

(a) import 第 12 行 `import { createNewTimeline, saveTimeline } from '@/utils/timelineStorage'` 改为:

```typescript
import { createNewTimeline } from '@/utils/timelineStorage'
import { createLocalTimeline } from '@/collab/createLocalTimeline'
```

(b) `handleSubmit` 改为 async,落盘段改为:

```typescript
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault()

  if (!name.trim()) {
    toast.error('请输入时间轴名称')
    return
  }

  const encounterIdNum = parseInt(encounterId)
  const cached = queryClient.getQueryData<EncounterTemplateResponse>([
    'encounter-template',
    encounterIdNum,
  ])
  const initialEvents = cached?.events

  const base = createNewTimeline(encounterId, name.trim(), initialEvents)
  const {
    id: _id,
    statusEvents,
    updatedAt,
    isShared,
    everPublished,
    hasLocalChanges,
    serverVersion,
    ...content
  } = base
  void _id
  void statusEvents
  void updatedAt
  void isShared
  void everPublished
  void hasLocalChanges
  void serverVersion
  const newId = await createLocalTimeline({ ...content, annotations: content.annotations ?? [] })
  useUIStore.setState({ isReadOnly: false })
  track('timeline-create', { method: 'manual', encounterId: encounterIdNum })
  onCreated()
  window.open(`/timeline/${newId}`, '_blank')
}
```

> 实现者:`createNewTimeline` 返回完整 `Timeline`;`createLocalTimeline` 接 `TimelineContent`(`Omit` 掉外部寻址 / 派生字段)。上面用解构剔除。若 tsc 对 `...content` 仍有富余字段告警,显式构造 `TimelineContent`。

- [ ] **Step 2: 改 ImportFFLogsDialog**

`src/components/ImportFFLogsDialog.tsx`:

(a) import(第 11 行)`createNewTimeline, saveTimeline, buildFFLogsSourceIndex` 去掉 `saveTimeline`:

```typescript
import { createNewTimeline, buildFFLogsSourceIndex } from '@/utils/timelineStorage'
import { createLocalTimeline } from '@/collab/createLocalTimeline'
```

(b) 两处落盘(约第 108–114 行的服务端解析路径、第 191–292 行的逐步构造路径)把 `saveTimeline(newTimeline)` + `window.open(...)` 改为:

```typescript
// 服务端解析路径(原 ~108 行附近)
const {
  id: _sid,
  statusEvents: _se,
  updatedAt: _su,
  isShared: _sis,
  everPublished: _sep,
  hasLocalChanges: _shl,
  serverVersion: _ssv,
  ...importContent
} = newTimeline
void _sid
void _se
void _su
void _sis
void _sep
void _shl
void _ssv
const newId = await createLocalTimeline({
  ...importContent,
  annotations: importContent.annotations ?? [],
})
track('fflogs-import', { success: true, encounterId: newTimeline.encounter?.id ?? 0 })
window.open(`/timeline/${newId}`, '_blank')
```

对第二处(逐步构造 `newTimeline` 后)同样处理。

> 实现者:两处落盘逻辑结构不同,但模式一致 —— 把 `Timeline` 解构成 `TimelineContent` 再 `createLocalTimeline`。函数需为 async(原已是 async,因有 `await`)。务必保留 `description` / `fflogsSource` / `gameZoneId` / `syncEvents` / `isReplayMode` / `composition` / `damageEvents` / `castEvents` 等内容字段(它们在 `...importContent` 内)。

- [ ] **Step 3: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -E "CreateTimelineDialog|ImportFFLogsDialog"` —— 预期无错。
Run: `pnpm lint` —— 预期相关文件无错(留意未用变量,已用 `void` 消解)。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(collab): new-timeline flows via createLocalTimeline"
```

---

## Task 11: HomePage 本地列表改读 IndexedDB meta

`HomePage` 本地时间轴区改读 IndexedDB `meta` 表;删除改读 localStorage 元数据;删除时间轴改用 `IndexedDBDocStore.deleteDoc`(已发布的再调服务端删除)。

**Files:**

- Modify: `src/pages/HomePage.tsx`

- [ ] **Step 1: 改 HomePage**

`src/pages/HomePage.tsx`:

(a) import:删 `getAllTimelineMetadata, deleteTimeline, type TimelineMetadata`,改为:

```typescript
import { IndexedDBDocStore } from '@/collab/storage/IndexedDBDocStore'
import type { LocalDocMeta } from '@/collab/types'
```

(b) 本地列表 state 改用 async 加载。把 `const [timelines, setTimelines] = useState(...)` 与 `loadTimelines` 改为:

```typescript
const [timelines, setTimelines] = useState<LocalDocMeta[]>([])

const loadTimelines = useCallback(async () => {
  const store = new IndexedDBDocStore()
  await store.open()
  const all = await store.getAllMeta()
  setTimelines(all.sort((a, b) => b.updatedAt - a.updatedAt))
}, [])

useEffect(() => {
  void loadTimelines()
}, [loadTimelines])
```

(并在 React import 加 `useCallback`、`useEffect`。)

(c) 本地列表渲染:`TimelineCard` 的 `timeline` prop 用 `LocalDocMeta` 映射:

```typescript
              {timelines.map(meta => (
                <TimelineCard
                  key={meta.docId}
                  timeline={{
                    id: meta.docId,
                    name: meta.name,
                    encounterId: String(meta.encounterId),
                    createdAt: meta.createdAt,
                    updatedAt: meta.updatedAt,
                    composition: meta.composition,
                  }}
                  onClick={() => {
                    track('timeline-open', { source: 'local' })
                    navigate(`/timeline/${meta.docId}`)
                  }}
                  onDelete={e => {
                    e.stopPropagation()
                    handleDeleteTimeline(meta.docId)
                  }}
                />
              ))}
```

(d) 本地删除确认的 `onConfirm` 改为 async 删 IndexedDB:

```typescript
        onConfirm={async () => {
          if (timelineToDelete) {
            const store = new IndexedDBDocStore()
            await store.open()
            await store.deleteDoc(timelineToDelete)
            await loadTimelines()
            setTimelineToDelete(null)
            toast.success('时间轴已删除')
          }
          setDeleteConfirmOpen(false)
        }}
```

> 实现者:`TimelineCard` 的 `timeline` prop 形状当前是 `TimelineMetadata`。检查 `TimelineCard.tsx` 的 props 类型 —— 它接 `{id,name,encounterId,createdAt,updatedAt,composition?}`。上面映射满足之。若 `TimelineCard` 强依赖 `TimelineMetadata` 类型,放宽其 prop 类型为结构化对象,或新建一个轻量 props 类型。不要改 `TimelineCard` 的渲染逻辑。

- [ ] **Step 2: 类型检查 + lint + build**

Run: `pnpm exec tsc --noEmit 2>&1 | grep HomePage` —— 预期无错。
Run: `pnpm lint` —— 预期相关文件无错。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(collab): HomePage local list from IndexedDB meta"
```

---

## Task 12: timelineShareApi 重写(发布 / 公开读 / 删版本锁)

`timelineShareApi.ts`:`publishTimeline` 重写为 `(id, name)` 形态;`fetchSharedTimeline` 返回 `{ role, authorName, snapshot? }`;删除 `updateTimeline` / `ConflictError` / `PublishResult.version` / `UpdateResult` 等版本锁相关。`fetchMyTimelines` / `deleteSharedTimeline` 保留。

**Files:**

- Modify: `src/api/timelineShareApi.ts`

- [ ] **Step 1: 重写 timelineShareApi.ts**

整体替换为:

```typescript
/**
 * 时间轴共享 API 客户端
 */

import { HTTPError } from 'ky'
import { apiClient } from './apiClient'
import type { Timeline, Composition } from '@/types/timeline'

export interface PublishResult {
  id: string
  publishedAt: number
}

/** GET /api/timelines/:id 的角色化响应 */
export interface SharedTimelineResponse {
  role: 'editor' | 'viewer'
  authorName: string
  /** viewer 角色携带;editor 角色为 undefined(编辑端连 WS 取全量) */
  snapshot?: Timeline
}

/**
 * 发布:把一条本地时间轴注册为云端时间轴。
 * 服务端可能清洗 id(敏感词),返回(可能变更过的)id。
 */
export async function publishTimeline(id: string, name: string): Promise<PublishResult> {
  try {
    return await apiClient.post('timelines', { json: { id, name } }).json<PublishResult>()
  } catch (err) {
    if (err instanceof HTTPError) throw new Error(err.message)
    throw err
  }
}

export interface MyTimelineItem {
  id: string
  name: string
  publishedAt: number
  updatedAt: number
  composition: Composition | null
}

/** 获取当前登录用户的已发布时间轴列表 */
export async function fetchMyTimelines(): Promise<MyTimelineItem[]> {
  try {
    return await apiClient.get('my/timelines').json<MyTimelineItem[]>()
  } catch (err) {
    if (err instanceof HTTPError && err.response.status === 401) return []
    throw err
  }
}

/** 删除已发布的时间轴(仅作者) */
export async function deleteSharedTimeline(id: string): Promise<void> {
  try {
    await apiClient.delete(`timelines/${id}`)
  } catch (err) {
    if (err instanceof HTTPError) throw new Error(err.message)
    throw err
  }
}

interface RawSharedResponse {
  role: 'editor' | 'viewer'
  authorName: string
  snapshot?: Timeline
}

/**
 * 获取共享时间轴的角色与(viewer 的)snapshot。
 * 已登录时 Worker 据 Authorization 头判定 editor / viewer。
 */
export async function fetchSharedTimeline(id: string): Promise<SharedTimelineResponse> {
  try {
    const raw = await apiClient.get(`timelines/${id}`).json<RawSharedResponse>()
    const result: SharedTimelineResponse = { role: raw.role, authorName: raw.authorName }
    if (raw.snapshot) {
      result.snapshot = { ...raw.snapshot, id, statusEvents: [] }
    }
    return result
  } catch (err) {
    if (err instanceof HTTPError && err.response.status === 404) {
      throw new Error('NOT_FOUND')
    }
    if (err instanceof HTTPError) {
      throw new Error(`HTTP ${err.response.status}`)
    }
    throw err
  }
}
```

> 实现者:`MyTimelineItem` 去掉了 `version` 字段。服务端 `my.ts` 当前仍返回 `version`,多返回字段对 `json<MyTimelineItem[]>()` 无害(TS 结构类型,运行时不校验)。无需改 `my.ts`(它对 `content='{}'` 已安全降级为 `composition:null`)。
> `RawSharedResponse.snapshot` 是服务端 `projectTimeline` 的产物 —— 已是 `Timeline` 形状,`id` 为空串、`statusEvents` 为空,此处补 `id` / `statusEvents`。不要再过 `parseFromAny`(那是给序列化格式用的)。

- [ ] **Step 2: 类型检查(局部)**

Run: `pnpm exec tsc --noEmit 2>&1 | grep timelineShareApi` —— `timelineShareApi.ts` 自身应无错。其余消费方(`SharePopover` / `EditorToolbar`)的错由 Task 13 修。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(collab): rewrite timelineShareApi for collab model"
```

---

## Task 13: 发布流程重接 + 旧代码清理(SharePopover / EditorToolbar / ConflictDialog)

`SharePopover` 重接 local→cloud 发布流程;`EditorToolbar` 移除 `ConflictDialog` 与版本锁接线、加 `onPublished` prop;删除 `ConflictDialog.tsx`。

**发布流程**(整合 spec §6):点发布 → `engine.flush()` → `POST /api/timelines {id,name}` → 若 id 变更则 `IndexedDBDocStore.rekey` → 写 `meta.published=true` → `applyPublishResult(newId)`(同 id 原地挂 remote)→ `onPublished(newId)`(同 id 留在本页切 editor,变更则 navigate)。

**Files:**

- Modify: `src/components/SharePopover.tsx`
- Modify: `src/components/EditorToolbar.tsx`
- Delete: `src/components/ConflictDialog.tsx`(及其测试,若有)

- [ ] **Step 1: 重写 SharePopover.tsx**

整体替换为:

```typescript
/**
 * 共享 Popover 组件
 * 三种状态:未登录 / 已登录未发布 / 已发布
 */

import { useState } from 'react'
import { Copy, Check, Loader2, Globe, Upload, CloudUpload, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/authStore'
import { useTimelineStore } from '@/store/timelineStore'
import type { Timeline } from '@/types/timeline'
import { publishTimeline } from '@/api/timelineShareApi'
import { IndexedDBDocStore } from '@/collab/storage/IndexedDBDocStore'
import { track } from '@/utils/analytics'

interface SharePopoverProps {
  timeline: Timeline
  /** 是否已发布(editor 模式) */
  isPublished: boolean
  viewMode: 'timeline' | 'table'
  /** 发布成功(参数为服务端最终 id,可能被清洗变更) */
  onPublished: (newId: string) => void
}

const SHARE_BASE_URL = window.location.origin

export default function SharePopover({
  timeline,
  isPublished,
  viewMode,
  onPublished,
}: SharePopoverProps) {
  const { isLoggedIn, login } = useAuth()
  const accessToken = useAuthStore(s => s.accessToken)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const shareUrl = isPublished
    ? `${SHARE_BASE_URL}/timeline/${timeline.id}${viewMode === 'table' ? '?view=table' : ''}`
    : ''

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('复制失败,请手动复制链接')
    }
  }

  const handlePublish = async () => {
    if (!accessToken) return
    setLoading(true)
    try {
      const engine = useTimelineStore.getState().engine
      if (!engine) throw new Error('引擎未就绪')
      // 1. 确保本地改动已落盘
      await engine.flush()
      // 2. 注册到云端(服务端可能清洗 id)
      const { id: newId } = await publishTimeline(timeline.id, timeline.name)
      // 3. id 变更则改键本地数据;标记 published
      const store = new IndexedDBDocStore()
      await store.open()
      if (newId !== timeline.id) {
        await store.rekey(timeline.id, newId)
      }
      const meta = await store.getMeta(newId)
      if (meta) await store.putMeta({ ...meta, published: true })
      // 4. 同 id:原地给引擎挂 remote(Y.Doc 连续);id 变更:onPublished 触发 navigate 重挂
      await useTimelineStore.getState().applyPublishResult(newId)
      track('timeline-publish', { encounterId: timeline.encounter?.id })
      onPublished(newId)
      toast.success('发布成功')
    } catch (err) {
      toast.error(`发布失败:${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认发布时间轴</AlertDialogTitle>
            <AlertDialogDescription>
              发布后,互联网上获得链接的人都能够访问该时间轴。被加入编辑者名单的人可以协同编辑。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handlePublish}>确认发布</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1 font-normal whitespace-nowrap"
          >
            {isPublished ? <Globe className="w-4 h-4" /> : <CloudUpload className="w-4 h-4" />}
            <span className="hidden lg:inline">共享</span>
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-80" align="end">
          <div className="space-y-3">
            <div>
              <h4 className="font-medium text-sm">共享时间轴</h4>
              <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                {!isLoggedIn ? (
                  <>
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span>需要登录才能共享时间轴</span>
                  </>
                ) : isPublished ? (
                  <>
                    <Globe className="w-3.5 h-3.5 shrink-0" />
                    <span>时间轴已发布,获得链接的人可阅读</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span>时间轴未共享,仅本设备可查看</span>
                  </>
                )}
              </div>
            </div>
            {!isLoggedIn ? (
              <div className="space-y-3">
                <Button className="w-full" onClick={login}>
                  登录 FFLogs
                </Button>
              </div>
            ) : !isPublished ? (
              <div className="space-y-3">
                <Button
                  variant="default"
                  className="w-full"
                  onClick={() => setConfirmOpen(true)}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  发布
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={shareUrl}
                    className="flex-1 px-2 py-1 text-xs border rounded bg-muted font-mono truncate"
                  />
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  改动会实时同步,无需手动保存。
                </p>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
```

- [ ] **Step 2: 改 EditorToolbar.tsx**

`src/components/EditorToolbar.tsx`:

(a) 删 import `ConflictDialog`(第 56 行)、`fetchSharedTimeline, type ConflictError`(第 60 行)。`fetchSharedTimeline` 不再在此用。

(b) props 接口加 `onPublished`:

```typescript
interface EditorToolbarProps {
  onCreateCopy?: () => void
  onPublished?: (newId: string) => void
  forceReadOnly?: boolean
  viewMode: 'timeline' | 'table'
  onViewModeChange: (mode: 'timeline' | 'table') => void
}
```

并在解构形参加 `onPublished`。

(c) 从 `useTimelineStore()` 解构里删 `applyPublishResult, applyUpdateResult, applyServerTimeline`。加 `isPublished`:

```typescript
const isPublished = useTimelineStore(s => s.isPublished)
```

(d) 删 `const [conflict, setConflict] = useState<ConflictError | null>(null)` 与 `accessToken`(若仅 conflict 用)。

(e) `SharePopover` 调用处(第 374–384 行)替换为:

```typescript
                ) : (
                  <SharePopover
                    timeline={timeline}
                    isPublished={isPublished}
                    viewMode={viewMode}
                    onPublished={newId => onPublished?.(newId)}
                  />
                )}
```

(f) 删除文件末尾的 `{conflict && timeline && (<ConflictDialog ... />)}` 整块(第 455–476 行)。

> 实现者:删 `conflict` 后检查 `navigate` 是否还有其他用途 —— 若仅 `onPublished` 老逻辑用,且新逻辑 navigate 移到了 EditorPage,则 `useNavigate` import 可能变死;以 tsc/lint 为准清理。

- [ ] **Step 3: 删除 ConflictDialog**

```bash
git rm src/components/ConflictDialog.tsx
```

Run: `grep -rn "ConflictDialog" src` —— 预期无输出。若有测试文件 `ConflictDialog.test.tsx` 一并 `git rm`。

- [ ] **Step 4: 全量类型检查 + lint**

此时全部消费方已改完,代码库应整体编译通过。

Run: `pnpm exec tsc --noEmit` —— 预期 0 error。
Run: `pnpm lint` —— 预期 0 error。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(collab): rewire publish flow, drop ConflictDialog"
```

---

## Task 14: 清理 timelineStorage / buildFFLogsSourceIndex / 死代码

`timelineStorage.ts` 删除 `saveTimeline` / `deleteTimeline` / `unpublishTimeline`;`buildFFLogsSourceIndex` 改读 IndexedDB meta(async);`Top100Section` / `ImportFFLogsDialog` 适配 async;删 `timelineFormat.ts` 的死代码 `toLocalStored`。

**Files:**

- Modify: `src/utils/timelineStorage.ts`
- Modify: `src/utils/timelineFormat.ts`
- Modify: `src/components/Top100Section.tsx`
- Modify: `src/components/ImportFFLogsDialog.tsx`

- [ ] **Step 1: 改 buildFFLogsSourceIndex 为 async(读 IndexedDB)**

`src/utils/timelineStorage.ts`:

(a) 删除 `saveTimeline`(第 64–95 行)、`unpublishTimeline`(第 100–134 行)、`deleteTimeline`(第 139–152 行)三个函数整体。

(b) `buildFFLogsSourceIndex`(第 161–177 行)整体替换为:

```typescript
/**
 * 构建 FFLogs 来源索引(读 IndexedDB meta 表)。
 *
 * 按 `${reportCode}:${fightId}` 聚合带 fflogsSource 的本地时间轴。
 * 相同 key 多条时保留 updatedAt 最大者。
 */
export async function buildFFLogsSourceIndex(): Promise<Map<string, LocalDocMeta>> {
  const { IndexedDBDocStore } = await import('@/collab/storage/IndexedDBDocStore')
  const store = new IndexedDBDocStore()
  await store.open()
  const index = new Map<string, LocalDocMeta>()
  for (const meta of await store.getAllMeta()) {
    if (!meta.fflogsSource) continue
    const key = `${meta.fflogsSource.reportCode}:${meta.fflogsSource.fightId}`
    const existing = index.get(key)
    if (!existing || meta.updatedAt > existing.updatedAt) {
      index.set(key, meta)
    }
  }
  return index
}
```

(c) 顶部 import 加 `import type { LocalDocMeta } from '@/collab/types'`。`toLocalStored` 若已不再被本文件用(`saveTimeline`/`unpublishTimeline` 删后),从 import 移除。

> 实现者:`getAllTimelineMetadata` / `getTimeline` / `createNewTimeline` 保留(迁移与新建仍需)。`TimelineMetadata` 类型若变死可一并删,以 grep 为准。

- [ ] **Step 2: 删 timelineFormat 死代码 toLocalStored**

Run: `grep -rn "toLocalStored" src` —— 确认仅 `timelineFormat.ts` 定义、无其他引用后,从 `src/utils/timelineFormat.ts` 删除 `toLocalStored` 函数及其未被复用的私有 helper。

> 实现者:`serializeForServer` / `parseFromAny` **保留**(`parseFromAny` 迁移用、`serializeForServer` worker `fflogs.ts` 用)。仅删确认变死的 `toLocalStored`。若 `toLocalStored` 与 `serializeForServer` 共享 helper,保留 helper。

- [ ] **Step 3: 适配 Top100Section(buildFFLogsSourceIndex 转 async)**

`src/components/Top100Section.tsx` 第 372–376 行的 `useMemo` 改为 async 加载。把:

```typescript
const importedSources = useMemo(() => {
  void refreshTick
  return new Set(buildFFLogsSourceIndex().keys())
}, [refreshTick])
```

改为:

```typescript
const [importedSources, setImportedSources] = useState<Set<string>>(new Set())
useEffect(() => {
  let ignore = false
  void buildFFLogsSourceIndex().then(index => {
    if (!ignore) setImportedSources(new Set(index.keys()))
  })
  return () => {
    ignore = true
  }
}, [refreshTick])
```

(确保 `useState` / `useEffect` 已 import。)

- [ ] **Step 4: 适配 ImportFFLogsDialog(buildFFLogsSourceIndex 转 async)**

`src/components/ImportFFLogsDialog.tsx` 第 46–53 行的 `duplicate` `useMemo` 改为 async:

```typescript
const [duplicate, setDuplicate] = useState<LocalDocMeta | null>(null)
useEffect(() => {
  if (!parsed?.reportCode || parsed.isLastFight || parsed.fightId == null) {
    setDuplicate(null)
    return
  }
  let ignore = false
  void buildFFLogsSourceIndex().then(index => {
    if (!ignore) {
      setDuplicate(index.get(`${parsed.reportCode}:${parsed.fightId}`) ?? null)
    }
  })
  return () => {
    ignore = true
  }
}, [parsed?.reportCode, parsed?.fightId, parsed?.isLastFight])
```

(import `LocalDocMeta` from `@/collab/types`;`useState`/`useEffect` 已在。)

> 实现者:`duplicate` 原类型是 `TimelineMetadata`,改 `LocalDocMeta`。后续用 `duplicate` 的地方(第 345 行 `duplicate.id` → `duplicate.docId`,以及展示 `name` 等)按 `LocalDocMeta` 字段名调整。grep `duplicate\.` 全部命中处逐一核对字段名(`id`→`docId`)。

- [ ] **Step 5: 全量类型检查 + lint + 测试 + 构建**

Run: `pnpm exec tsc --noEmit` —— 预期 0 error。
Run: `pnpm lint` —— 预期 0 error。
Run: `pnpm test:run` —— 预期全绿。
Run: `pnpm test:workers` —— 预期全绿。
Run: `pnpm build` —— 预期成功。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(collab): drop localStorage timeline storage, async fflogs index"
```

---

## 收尾

全部 14 个 task 完成后:

- [ ] **手动验证**(`pnpm dev`,设计 spec §10 要求 React 部分手验):
  1. 新建时间轴 → 进编辑器 `local` 模式 → 改动 → 刷新页面数据保留。
  2. 登录 → 发布(同 id)→ 当前页切 `editor` 模式、`SharePopover` 显示链接、不刷新。
  3. 复制链接,另一浏览器(未登录)打开 → `viewer` 只读。
  4. 把该浏览器用户手工加入 D1 `timeline_editors` → 重开 → `editor` 模式,两端实时同步。
  5. HomePage 本地列表显示新建的时间轴;删除生效。
  6. FFLogs 导入 → 回放模式时间轴正常。
- [ ] 跑最终全量门禁:`pnpm test:run && pnpm test:workers && pnpm exec tsc --noEmit && pnpm lint && pnpm build`。
- [ ] 计划 B 结束后转入计划 C(Awareness:`y-protocols/awareness` + 在线昵称 + 选中高亮,整合 spec §11 第 8 组)。

---

## 自查清单(规划者已核)

- **Spec §4 新建流程** → Task 6(`createLocalTimeline`)+ Task 10(三入口接线)。
- **Spec §5 EditorPage 三模式** → Task 9。
- **Spec §6 发布 local→cloud 升级** → Task 13(SharePopover)+ Task 7(`applyPublishResult`/`attachRemote`)。
- **Spec §7 本地元数据表 / HomePage 列表** → Task 3(meta store)+ Task 11(HomePage)。
- **Spec §8 旧代码清理** → Task 13(ConflictDialog/SharePopover)+ Task 14(timelineStorage/timelineFormat)。`useEditorReadOnly` 无需改 —— 它只读 `timeline.isReplayMode` + `uiStore.isReadOnly`,viewer 模式由 EditorPage 设 `isReadOnly=true`,语义自然并入。
- **Spec §9.2 客户端迁移** → Task 8(按关键设计决定 1,合并为单次迁移)。
- **Spec §5/§2 GET 角色化** → Task 2(服务端 `GET /:id`)。
- **SyncEngine remote** → Task 4(`RemoteConnection`)+ Task 5(引擎接入)。
- **类型一致性**:`SyncEngine`(Task 5 起)、`LocalDocMeta`(`docId` 主键,Task 3 起全程一致)、`openTimeline(docId, opts)`(Task 7 起)、`fetchSharedTimeline → {role, authorName, snapshot?}`(Task 2 服务端 / Task 12 客户端一致)。
- **中间态**:Task 7/9/10/12 提交时代码库整体 tsc 可能未通过(消费方分任务改),属计划内;Task 13 Step 4 起恢复整体绿。分支最终态(Task 14 后)干净。
