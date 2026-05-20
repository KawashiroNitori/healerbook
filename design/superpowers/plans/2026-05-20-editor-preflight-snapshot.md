# 编辑器首屏 Snapshot 兜底渲染 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 editor / author 角色首次访问已发布的协同时间轴时，先用 REST KV snapshot 做只读兜底渲染，把 WS 握手 1 RTT 的"空编辑器"窗口变成"内容渐进刷新"。

**Architecture:** 服务端 `GET /api/timelines/:id` 对三种角色都返回 KV snapshot；客户端 `timelineStore` 把 `timeline` 字段拆为 `yDocProjection / snapshot / yDocReady` 三个内部源，外部 `timeline` 字段保留为 `yDocProjection ?? snapshot` 派生值；`SyncEngine` 新增 `hadPersistedData` 只读属性、`connectRemote` 透传 `onLoaded`；`RemoteConnection` 在 LOAD_REPLY 末尾触发 `onLoaded`；`EditorPage` 把 `fetchSharedTimeline` 拿到的 snapshot 透传给 `openTimeline`。三大不变量：snapshot 永不进入 Y.Doc；WS connected 之前编辑器必为只读（由 §4.5 的 offline cause 保证）；本地 IndexedDB 缓存优先级 > snapshot。设计详见 `design/superpowers/specs/2026-05-20-editor-preflight-snapshot-design.md`。

**Tech Stack:** React 19 + TypeScript、Zustand 5、Yjs、Cloudflare Workers + KV、Vitest 4。**包管理器必须用 pnpm。**

**说明：** 本特性涉及 client (`timelineStore` / `SyncEngine` / `RemoteConnection` / `EditorPage`) 与 server (`workers/routes/timelines.ts`) 同步改动。任务按依赖自底向上排序，每完成一个 Task `pnpm exec tsc --noEmit` 与 `pnpm lint` 均应通过。最后一个 Task 跑全量测试 + 手测。

---

### Task 1: Worker `GET /:id` 三角色共用 KV snapshot 查询

服务端先动，因为客户端在 Task 5 要直接消费 `snapshot` 字段。改动是把 KV 查询从 viewer 分支独占抽到 role 判定之外，editor / author 角色响应也带 `snapshot`。Cache-Control 不变（editor / author 仍 `private, no-cache`）。

**Files:**

- Modify: `src/workers/routes/timelines.ts:79-142`
- Test: `src/workers/routes/timelines.workers.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/workers/routes/timelines.workers.test.ts` 的 `describe('GET /api/timelines/:id role', ...)` 块内（紧跟 "returns editor role without snapshot for whitelisted user" 之后）追加两条用例：

```ts
it('editor 角色 KV 命中时响应携带 snapshot', async () => {
  const id = await publishOne('editor-snap-hit-00000001', 'T-edit')
  const snapshotData = { name: 'T-edit', composition: { players: [] }, damageEvents: [] }
  await env.healerbook_snapshots.put(`tl-snapshot:${id}`, JSON.stringify(snapshotData))

  const res = await SELF.fetch(`https://app/api/timelines/${id}`, {
    headers: { Authorization: `Bearer ${await authorJwt()}` },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { role: string; snapshot?: unknown }
  expect(body.role).toBe('editor')
  expect(body.snapshot).toEqual(snapshotData)
  expect(res.headers.get('Cache-Control')).toBe('private, no-cache')
})

it('editor 角色 KV miss 时响应 snapshot 缺省，不报错', async () => {
  const id = await publishOne('editor-snap-miss-0000001', 'T-edit-miss')
  // 不写 KV;DO 也为空（新发布未灌入）→ getSnapshotJson() 返回 null
  const res = await SELF.fetch(`https://app/api/timelines/${id}`, {
    headers: { Authorization: `Bearer ${await authorJwt()}` },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { role: string; snapshot?: unknown }
  expect(body.role).toBe('editor')
  expect(body.snapshot).toBeUndefined()
  expect(res.headers.get('Cache-Control')).toBe('private, no-cache')
})
```

并把现有的 "returns editor role without snapshot for whitelisted user" 用例改为不再断言 `body.snapshot` 为 undefined（KV 命中时它会有值），改为只断言 `role === 'editor'`。具体替换该用例中 `expect(body.snapshot).toBeUndefined()` 为：

```ts
// snapshot 字段是否有值取决于 KV/DO，本用例不关心；详见专门用例
```

- [ ] **Step 2: 跑测试确认前两条新用例失败**

Run: `pnpm test:run src/workers/routes/timelines.workers.test.ts`
Expected: 两条新用例 FAIL —— 第一条因 editor 分支当前直接 return base 不带 snapshot；第二条因要等修改后才返回稳定结构。

- [ ] **Step 3: 改 worker 路由**

把 `src/workers/routes/timelines.ts:79-142` 的 `app.get('/:id', ...)` 中"viewer 才查 KV"的结构改为"先查 KV，再按角色决定 Cache-Control"。完整替换实现：

```ts
// 公开读:返回 { role, authorName, isAuthor, allowEditRequests, hasPendingRequest, pendingRequestCount, snapshot? }
app.get('/:id', async c => {
  const id = c.req.param('id')

  const row = await c.env.healerbook_timelines
    .prepare('SELECT author_id, author_name, allow_edit_requests FROM timelines WHERE id = ?')
    .bind(id)
    .first<{ author_id: string; author_name: string; allow_edit_requests: number }>()
  if (!row) return c.json({ error: 'Not found' }, 404)

  const allowEditRequests = row.allow_edit_requests === 1
  const user = await tryReadAuth(c)
  let role: 'editor' | 'viewer' = 'viewer'
  let isAuthor = false
  let hasPendingRequest = false
  let pendingRequestCount = 0
  if (user) {
    isAuthor = user.userId === row.author_id
    const editorRow = await c.env.healerbook_timelines
      .prepare('SELECT 1 FROM timeline_editors WHERE timeline_id = ? AND user_id = ?')
      .bind(id, user.userId)
      .first()
    if (editorRow) role = 'editor'
    if (role === 'viewer') {
      const reqRow = await c.env.healerbook_timelines
        .prepare('SELECT 1 FROM timeline_edit_requests WHERE timeline_id = ? AND user_id = ?')
        .bind(id, user.userId)
        .first()
      hasPendingRequest = reqRow != null
    }
    if (isAuthor) {
      const countRow = await c.env.healerbook_timelines
        .prepare('SELECT COUNT(*) AS n FROM timeline_edit_requests WHERE timeline_id = ?')
        .bind(id)
        .first<{ n: number }>()
      pendingRequestCount = countRow?.n ?? 0
    }
  }

  const base = {
    role,
    authorName: row.author_name,
    isAuthor,
    allowEditRequests,
    hasPendingRequest,
    pendingRequestCount,
  }

  // 三角色共用 KV snapshot 查询:editor / author 用于首屏兜底,viewer 用于只读渲染
  const cached = await c.env.healerbook_snapshots.get(`tl-snapshot:${id}`)
  const snapshot = cached
    ? (JSON.parse(cached) as object)
    : await docStub(c.env, id).getSnapshotJson()

  // viewer 角色:snapshot 缺失视为时间轴未生成内容快照(DO 空 + KV 空) → 404
  if (role === 'viewer' && !snapshot) return c.json({ error: 'Not found' }, 404)

  // editor / author:始终 private, no-cache(用户相关数据 + snapshot 跟随协同变化)
  // viewer:已登录(可能含 hasPendingRequest)用 private;匿名用 public;统一 no-cache
  const cacheControl =
    role === 'editor' ? 'private, no-cache' : user ? 'private, no-cache' : 'public, no-cache'

  // snapshot 为 undefined 时不写入 body(保持响应字段最小化)
  const body = snapshot ? { ...base, snapshot } : base
  return c.json(body, 200, { 'Cache-Control': cacheControl })
})
```

关键点：

- KV 查询提前到角色判定之后但响应组装之前，三角色共用。
- editor / author 角色 KV miss 时 `snapshot` 不写入响应（不破坏字段最小化）。
- viewer 角色 KV miss 且 DO 也空时仍返回 404（保留原 viewer 语义）。
- editor / author 始终 `private, no-cache`，与 `SharedTimelineResponse.snapshot?: Timeline` 已声明的可选字段对齐。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run src/workers/routes/timelines.workers.test.ts`
Expected: 所有用例 PASS（含两条新用例与现有 viewer / 404 / Cache-Control 用例）。

- [ ] **Step 5: 跑全量 worker 测试 + 类型检查 + lint**

Run: `pnpm test:run src/workers && pnpm exec tsc --noEmit && pnpm lint`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/workers/routes/timelines.ts src/workers/routes/timelines.workers.test.ts
git commit -m "feat(timelines): return KV snapshot to editor/author roles for preflight render"
```

---

### Task 2: `RemoteConnection` 新增 `onLoaded` 回调

让 RemoteConnection 在 LOAD_REPLY 处理末尾触发 `onLoaded`，让上层 store 知道远端 doc 已应用完毕。回调幂等性由 store 端实现，本层每次 LOAD_REPLY 都触发。

**Files:**

- Modify: `src/collab/RemoteConnection.ts:50-66, 146-152`
- Test: `src/collab/RemoteConnection.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/collab/RemoteConnection.test.ts` 的 `describe('RemoteConnection', ...)` 块末尾追加：

```ts
it('triggers onLoaded after LOAD_REPLY with non-empty missing', async () => {
  const serverDoc = new Y.Doc()
  serverDoc.getMap('meta').set('name', 'hello')
  const missing = Y.encodeStateAsUpdate(serverDoc)
  const serverSV = Y.encodeStateVector(serverDoc)

  const doc = new Y.Doc()
  const onLoaded = vi.fn()
  const conn = new RemoteConnection(
    'ws://x/connect',
    doc,
    new Awareness(doc),
    () => Promise.resolve('j'),
    () => {},
    undefined,
    undefined,
    onLoaded
  )
  conn.connect()
  await lastSocket().fireOpen()
  lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
  expect(onLoaded).not.toHaveBeenCalled()
  lastSocket().fireMessage(encodeMessage(MSG.LOAD_REPLY, encodeLoadReply(missing, serverSV)))
  expect(onLoaded).toHaveBeenCalledTimes(1)
  conn.destroy()
})

it('triggers onLoaded even when LOAD_REPLY missing is empty', async () => {
  const doc = new Y.Doc()
  const onLoaded = vi.fn()
  const conn = new RemoteConnection(
    'ws://x/connect',
    doc,
    new Awareness(doc),
    () => Promise.resolve('j'),
    () => {},
    undefined,
    undefined,
    onLoaded
  )
  conn.connect()
  await lastSocket().fireOpen()
  lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
  // missing 为空 + server SV 为空 doc 的 SV
  const serverDoc = new Y.Doc()
  const emptyMissing = new Uint8Array()
  const serverSV = Y.encodeStateVector(serverDoc)
  lastSocket().fireMessage(encodeMessage(MSG.LOAD_REPLY, encodeLoadReply(emptyMissing, serverSV)))
  expect(onLoaded).toHaveBeenCalledTimes(1)
  conn.destroy()
})

it('does not trigger onLoaded on 1008 / 4001 close before LOAD_REPLY', async () => {
  const doc = new Y.Doc()
  const onLoaded = vi.fn()
  const conn = new RemoteConnection(
    'ws://x/connect',
    doc,
    new Awareness(doc),
    () => Promise.resolve('j'),
    () => {},
    undefined,
    undefined,
    onLoaded
  )
  conn.connect()
  await lastSocket().fireOpen()
  lastSocket().fireClose(1008)
  expect(onLoaded).not.toHaveBeenCalled()
  conn.destroy()
})

it('does not trigger onLoaded when auth token missing', async () => {
  const doc = new Y.Doc()
  const onLoaded = vi.fn()
  const conn = new RemoteConnection(
    'ws://x/connect',
    doc,
    new Awareness(doc),
    () => Promise.resolve(null),
    () => {},
    undefined,
    undefined,
    onLoaded
  )
  conn.connect()
  await lastSocket().fireOpen()
  expect(onLoaded).not.toHaveBeenCalled()
  conn.destroy()
})

it('triggers onLoaded again on reconnect LOAD_REPLY (caller handles idempotency)', async () => {
  const serverDoc = new Y.Doc()
  serverDoc.getMap('meta').set('name', 'r')
  const missing = Y.encodeStateAsUpdate(serverDoc)
  const serverSV = Y.encodeStateVector(serverDoc)
  vi.useFakeTimers()

  const doc = new Y.Doc()
  const onLoaded = vi.fn()
  const conn = new RemoteConnection(
    'ws://x/connect',
    doc,
    new Awareness(doc),
    () => Promise.resolve('j'),
    () => {},
    undefined,
    undefined,
    onLoaded
  )
  conn.connect()
  await lastSocket().fireOpen()
  lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
  lastSocket().fireMessage(encodeMessage(MSG.LOAD_REPLY, encodeLoadReply(missing, serverSV)))
  expect(onLoaded).toHaveBeenCalledTimes(1)

  // 模拟断线 → 退避重连 → 再次 LOAD_REPLY
  lastSocket().fireClose(1006)
  vi.advanceTimersByTime(1000)
  await lastSocket().fireOpen()
  lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
  lastSocket().fireMessage(encodeMessage(MSG.LOAD_REPLY, encodeLoadReply(missing, serverSV)))
  expect(onLoaded).toHaveBeenCalledTimes(2)
  conn.destroy()
})
```

注：上述用例假设 test 文件顶部已 import `vi`，`encodeLoadReply` 已 import（确认 `RemoteConnection.test.ts` 顶部 import 列表，若缺则补 `vi`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/collab/RemoteConnection.test.ts`
Expected: 五条新用例 FAIL —— 构造函数还不接受第 8 个参数；TypeScript 编译错。

- [ ] **Step 3: 给 `RemoteConnection` 加 `onLoaded`**

修改 `src/collab/RemoteConnection.ts:28-31`（私有字段声明区），在 `onRevoked` 字段之后追加：

```ts
  /** 远端 doc 应用完成(LOAD_REPLY 处理末尾)触发;每次 LOAD_REPLY 都会触发,幂等性由上层处理 */
  private readonly onLoaded: (() => void) | undefined
```

修改构造函数签名 `src/collab/RemoteConnection.ts:50-66`，在 `onRevoked` 之后追加 `onLoaded`：

```ts
  constructor(
    url: string,
    doc: Y.Doc,
    awareness: Awareness,
    getAuthToken: () => Promise<string | null>,
    onStatus: (status: ConnectionStatus) => void,
    onEditRequest?: (count: number) => void,
    onRevoked?: () => void,
    onLoaded?: () => void
  ) {
    this.url = url
    this.doc = doc
    this.awareness = awareness
    this.getAuthToken = getAuthToken
    this.onStatus = onStatus
    this.onEditRequest = onEditRequest
    this.onRevoked = onRevoked
    this.onLoaded = onLoaded
  }
```

修改 LOAD_REPLY 处理 `src/collab/RemoteConnection.ts:146-152`，在末尾 `return` 之前追加触发：

```ts
if (msg.type === MSG.LOAD_REPLY) {
  const { missing, stateVector } = decodeLoadReply(msg.payload)
  if (missing.length > 0) Y.applyUpdate(this.doc, missing, REMOTE_ORIGIN)
  const ours = Y.encodeStateAsUpdate(this.doc, stateVector)
  this.ws?.send(encodeMessage(MSG.PUSH, ours))
  this.onLoaded?.()
  return
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run src/collab/RemoteConnection.test.ts`
Expected: 全部用例 PASS（含 5 条新用例 + 现有原 13 条左右用例无回归）。

- [ ] **Step 5: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/collab/RemoteConnection.ts src/collab/RemoteConnection.test.ts
git commit -m "feat(collab): add onLoaded callback fired after LOAD_REPLY"
```

---

### Task 3: `SyncEngine` 暴露 `hadPersistedData` + 透传 `onLoaded`

新增只读属性 `hadPersistedData`：构造时由本地 IndexedDB 是否命中决定，对外只读。`connectRemote` 签名追加 `onLoaded` 参数，原样透传给 `RemoteConnection`。

**Files:**

- Modify: `src/collab/SyncEngine.ts:18-84`
- Test: `src/collab/SyncEngine.test.ts`

- [ ] **Step 1: 写失败测试**

读 `src/collab/SyncEngine.test.ts` 顶部 import 区，确认能 import `SyncEngine` 与 `fake-indexeddb/auto`。在文件末尾追加：

```ts
describe('SyncEngine - hadPersistedData', () => {
  it('首次创建无本地数据时 hadPersistedData = false', async () => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    const engine = await SyncEngine.create('no-cache-doc')
    expect(engine.hadPersistedData).toBe(false)
    engine.destroy()
  })

  it('seed 提供时也算作 false(seed 不是持久化数据)', async () => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    const seed = new Y.Doc()
    seed.getMap('meta').set('name', 'fresh')
    const engine = await SyncEngine.create('seed-doc', seed)
    expect(engine.hadPersistedData).toBe(false)
    engine.destroy()
  })

  it('再次打开同 docId 时 hadPersistedData = true', async () => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    const first = await SyncEngine.create('reopen-doc')
    first.doc.getMap('meta').set('name', 'persisted-val')
    await first.flush()
    first.destroy()

    const second = await SyncEngine.create('reopen-doc')
    expect(second.hadPersistedData).toBe(true)
    expect(second.doc.getMap('meta').get('name')).toBe('persisted-val')
    second.destroy()
  })
})
```

确认 import 区有 `import * as Y from 'yjs'`，若无则添加。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/collab/SyncEngine.test.ts`
Expected: 三条新用例 FAIL —— `hadPersistedData` 不是 SyncEngine 属性，TypeScript 编译错。

- [ ] **Step 3: 实现 `hadPersistedData` + `onLoaded` 透传**

修改 `src/collab/SyncEngine.ts`：

1. 在类字段声明区（`src/collab/SyncEngine.ts:19-26`）追加：

```ts
  readonly hadPersistedData: boolean
```

2. 修改私有构造函数 `src/collab/SyncEngine.ts:28-45`，新增 `hadPersistedData` 参数并赋值：

```ts
  private constructor(
    docId: string,
    doc: Y.Doc,
    store: IndexedDBDocStore,
    hadPersistedData: boolean
  ) {
    this.docId = docId
    this.doc = doc
    this.awareness = new Awareness(this.doc)
    this.store = store
    this.hadPersistedData = hadPersistedData
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
```

3. 修改 `static create` `src/collab/SyncEngine.ts:51-64`，把 `persisted !== null` 传给构造函数：

```ts
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
    return new SyncEngine(docId, doc, store, persisted !== null)
  }
```

4. 修改 `connectRemote` 签名 `src/collab/SyncEngine.ts:67-84`，追加 `onLoaded` 参数并透传：

```ts
  connectRemote(
    getAuthToken: () => Promise<string | null>,
    onStatus: (status: ConnectionStatus) => void,
    onEditRequest?: (count: number) => void,
    onRevoked?: () => void,
    onLoaded?: () => void
  ): void {
    if (this.remote) return
    this.remote = new RemoteConnection(
      buildWsUrl(this.docId),
      this.doc,
      this.awareness,
      getAuthToken,
      onStatus,
      onEditRequest,
      onRevoked,
      onLoaded
    )
    this.remote.connect()
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run src/collab/SyncEngine.test.ts`
Expected: 全部用例 PASS（含 3 条新用例 + 现有用例无回归）。

- [ ] **Step 5: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/collab/SyncEngine.ts src/collab/SyncEngine.test.ts
git commit -m "feat(collab): expose hadPersistedData and pass through onLoaded"
```

---

### Task 4: `timelineStore` 拆分数据源 + 接收 snapshot

把 `timeline` 字段拆为内部三源 `yDocProjection / snapshot / yDocReady`，外部 `timeline` 字段保留为 `yDocProjection ?? snapshot` 派生值；`openTimeline` 接收 `snapshot` 选项；引入 `onLoadedHandler` 处理缓存命中和 LOAD_REPLY 两条路径。

**Files:**

- Modify: `src/store/timelineStore.ts`（主要 §56-189 接口与初值、§202-294 helper、§303-413 actions）
- Test: `src/store/timelineStore.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/store/timelineStore.test.ts` 末尾追加新 describe 块：

```ts
describe('timelineStore - snapshot 兜底渲染数据源', () => {
  beforeEach(() => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    useTimelineStore.getState().reset()
  })

  it('selector: yDocProjection 有值时优先于 snapshot', async () => {
    await useTimelineStore
      .getState()
      .openTimeline('selector-yDoc-priority', { role: 'local', seedContent: baseContent })
    // local 角色不挂 remote、本地 build seed 即视为已加载
    const state = useTimelineStore.getState()
    expect(state.yDocProjection?.name).toBe('测试时间轴')
    expect(state.timeline).toBe(state.yDocProjection)
  })

  it('selector: yDocProjection 为 null 时回退到 snapshot', () => {
    const fakeTimeline: import('@/types/timeline').Timeline = {
      id: 'snap-only',
      name: '只读',
      encounter: null,
      composition: { players: [] },
      damageEvents: [],
      castEvents: [],
      annotations: [],
      statusEvents: [],
      createdAt: 0,
      updatedAt: 0,
    } as unknown as import('@/types/timeline').Timeline
    useTimelineStore.getState().setViewerSnapshot(fakeTimeline)
    const state = useTimelineStore.getState()
    expect(state.yDocProjection).toBeNull()
    expect(state.snapshot).toBe(fakeTimeline)
    expect(state.timeline).toBe(fakeTimeline)
  })

  it('selector: 两者皆 null 时 timeline 为 null', () => {
    useTimelineStore.getState().reset()
    const state = useTimelineStore.getState()
    expect(state.yDocProjection).toBeNull()
    expect(state.snapshot).toBeNull()
    expect(state.timeline).toBeNull()
  })

  it('openTimeline (editor) 缓存命中:立即清 snapshot、yDocReady=true、yDocProjection 就位', async () => {
    // 第一次写入持久化数据
    await useTimelineStore
      .getState()
      .openTimeline('cache-hit-doc', { role: 'local', seedContent: baseContent })
    await useTimelineStore.getState().engine!.flush()
    useTimelineStore.getState().reset()

    // 第二次以 editor 模式打开同 doc 并传 snapshot 兜底:本地缓存应优先,snapshot 立即清
    const fallback = {
      ...baseContent,
      id: 'cache-hit-doc',
      updatedAt: 0,
    } as import('@/types/timeline').Timeline
    // 注意:openTimeline 在 editor/author 模式下会尝试连 WS;此处不挂 WS 测试,因此用 'author'
    // 角色构造同样的"非 local"路径(role !== 'local' → wireRemote)。为避免真实 WS,我们 stub WebSocket。
    const oldWS = globalThis.WebSocket
    class StubWS {
      static OPEN = 1
      static CLOSED = 3
      readyState = 0
      binaryType = ''
      onopen: (() => void) | null = null
      onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
      onclose: ((ev: { code: number }) => void) | null = null
      onerror: (() => void) | null = null
      constructor(public url: string) {}
      send() {}
      close() {
        this.readyState = StubWS.CLOSED
      }
    }
    // @ts-expect-error stub
    globalThis.WebSocket = StubWS

    await useTimelineStore
      .getState()
      .openTimeline('cache-hit-doc', { role: 'author', snapshot: fallback })
    const state = useTimelineStore.getState()
    expect(state.yDocReady).toBe(true)
    expect(state.snapshot).toBeNull()
    expect(state.yDocProjection).not.toBeNull()
    expect(state.timeline).toBe(state.yDocProjection)

    globalThis.WebSocket = oldWS
    useTimelineStore.getState().reset()
  })

  it('openTimeline (editor) 缓存 miss:snapshot 保持、yDocProjection null、yDocReady false', async () => {
    const fallback = {
      id: 'cache-miss-doc',
      name: '兜底',
      encounter: null,
      composition: { players: [] },
      damageEvents: [],
      castEvents: [],
      annotations: [],
      statusEvents: [],
      createdAt: 0,
      updatedAt: 0,
    } as unknown as import('@/types/timeline').Timeline

    const oldWS = globalThis.WebSocket
    class StubWS {
      static OPEN = 1
      static CLOSED = 3
      readyState = 0
      binaryType = ''
      onopen: (() => void) | null = null
      onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
      onclose: ((ev: { code: number }) => void) | null = null
      onerror: (() => void) | null = null
      constructor(public url: string) {}
      send() {}
      close() {
        this.readyState = StubWS.CLOSED
      }
    }
    // @ts-expect-error stub
    globalThis.WebSocket = StubWS

    await useTimelineStore
      .getState()
      .openTimeline('cache-miss-doc', { role: 'editor', snapshot: fallback })
    const state = useTimelineStore.getState()
    expect(state.snapshot).toBe(fallback)
    expect(state.yDocProjection).toBeNull()
    expect(state.yDocReady).toBe(false)
    expect(state.timeline).toBe(fallback)

    globalThis.WebSocket = oldWS
    useTimelineStore.getState().reset()
  })

  it('setViewerSnapshot 设置 snapshot 字段、yDocProjection null、yDocReady false', () => {
    const t = {
      id: 'viewer-doc',
      name: 'viewer',
      encounter: null,
      composition: { players: [] },
      damageEvents: [],
      castEvents: [],
      annotations: [],
      statusEvents: [],
      createdAt: 0,
      updatedAt: 0,
    } as unknown as import('@/types/timeline').Timeline
    useTimelineStore.getState().setViewerSnapshot(t)
    const state = useTimelineStore.getState()
    expect(state.snapshot).toBe(t)
    expect(state.yDocProjection).toBeNull()
    expect(state.yDocReady).toBe(false)
    expect(state.sessionRole).toBe('viewer')
  })

  it('reset 清空三源', async () => {
    await useTimelineStore
      .getState()
      .openTimeline('to-reset', { role: 'local', seedContent: baseContent })
    expect(useTimelineStore.getState().yDocProjection).not.toBeNull()
    useTimelineStore.getState().reset()
    const state = useTimelineStore.getState()
    expect(state.yDocProjection).toBeNull()
    expect(state.snapshot).toBeNull()
    expect(state.yDocReady).toBe(false)
    expect(state.timeline).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/store/timelineStore.test.ts`
Expected: 新用例全部 FAIL（`yDocProjection / snapshot / yDocReady` 字段不存在，`openTimeline` 不接受 `snapshot` 选项）。

- [ ] **Step 3: 改 store 接口与初值**

修改 `src/store/timelineStore.ts:56-90` 的 `TimelineState` 接口，把 `timeline: Timeline | null` 改为四字段：

```ts
interface TimelineState {
  /** 同步引擎(持有 Y.Doc 真相源);未打开时间轴时为 null */
  engine: SyncEngine | null
  /** Y.Doc 投影;viewer 永远 null,editor/author 缓存命中或 LOAD_REPLY 后写入 */
  yDocProjection: Timeline | null
  /** REST KV 快照;三角色通用,editor/author 在 yDocReady 后清空 */
  snapshot: Timeline | null
  /** editor/author:Y.Doc 内容是否已就绪(本地缓存命中或 LOAD_REPLY 应用完毕);viewer 永远 false */
  yDocReady: boolean
  /** 派生:yDocProjection ?? snapshot;消费方继续读这里 */
  timeline: Timeline | null
  // ... 以下字段不变(canUndo / canRedo / partyState / ...)
```

修改 `openTimeline` action 签名 `src/store/timelineStore.ts:97-101`：

```ts
openTimeline: (
  docId: string,
  opts: {
    role: 'local' | 'author' | 'editor'
    seedContent?: TimelineContent
    /** REST KV 首屏兜底快照;editor/author 适用,缓存命中后立即清 */
    snapshot?: Timeline
  }
) => Promise<void>
```

修改 `initialUiState` 与默认 state `src/store/timelineStore.ts:172-189, 296-302`，把 `timeline: null` 一项扩展为：

```ts
    engine: null,
    yDocProjection: null,
    snapshot: null,
    yDocReady: false,
    timeline: null,
    canUndo: false,
    canRedo: false,
    ...initialUiState,
```

- [ ] **Step 4: 引入派生 helper + 改 reproject / scheduleMetaWrite**

在 `useTimelineStore` 闭包内、`scheduleMetaWrite` 之后追加：

```ts
/** 把 yDocProjection ?? snapshot 写回派生 timeline 字段 */
const recomputeTimeline = () => {
  const { yDocProjection, snapshot } = get()
  set({ timeline: yDocProjection ?? snapshot })
}
```

修改 `reproject` `src/store/timelineStore.ts:226-235`：

```ts
const reproject = () => {
  const engine = get().engine
  if (!engine) return
  const prev = get().yDocProjection ?? undefined
  const next = projectTimeline(engine.doc, prev)
  next.id = engine.docId
  next.updatedAt = Math.floor(Date.now() / 1000)
  set({ yDocProjection: next })
  recomputeTimeline()
  scheduleMetaWrite()
}
```

`scheduleMetaWrite` 内部读 `get().timeline` 不动（派生值，等同读 yDocProjection ?? snapshot，但 meta 只在 editor 模式下有意义，调用方已通过 `if (!engine || !timeline) return` 兜底）。

- [ ] **Step 5: 引入 `onLoadedHandler`**

在 `wireRemote` 上方追加：

```ts
/** 远端 doc 加载完成回调:缓存命中和 LOAD_REPLY 两条路径共用,幂等 */
const onLoadedHandler = () => {
  if (get().yDocReady) return
  set({ yDocReady: true, snapshot: null })
  recomputeTimeline()
  // LOAD_REPLY 的 missing 可能为空,Y.applyUpdate 不触发 'update' 事件,
  // 自动 reproject 不会跑;手动调用一次保证 yDocProjection 一定写入。
  reproject()
}
```

- [ ] **Step 6: 改 `wireRemote` 注入 onLoaded**

修改 `src/store/timelineStore.ts:264-294`（`wireRemote` 函数）中 `engine.connectRemote(...)` 调用，追加第 5 个参数 `onLoadedHandler`：

```ts
engine.connectRemote(
  () => useAuthStore.getState().getValidToken(),
  status => set({ connectionStatus: status }),
  count => set({ pendingRequestCount: count }),
  () => {
    // 编辑权限被撤销：降级为 viewer，由 viewer cause 接管只读
    peersUnsub?.()
    peersUnsub = null
    set({ sessionRole: 'viewer' })
    toast.error('你的编辑权限已被移除')
  },
  onLoadedHandler
)
```

- [ ] **Step 7: 改 `openTimeline` 接收 snapshot 与缓存命中分支**

把 `src/store/timelineStore.ts:303-376` 的 `openTimeline` action 整体替换为：

```ts
    openTimeline: async (docId, opts) => {
      const myGeneration = ++openGeneration

      const prevEngine = get().engine
      if (prevEngine) {
        prevEngine.doc.off('update', reproject)
        peersUnsub?.()
        peersUnsub = null
        prevEngine.destroy()
      }

      // 重置三源:snapshot 来自 opts(可为 undefined),yDocProjection / yDocReady 清空
      set({
        engine: null,
        yDocProjection: null,
        snapshot: opts.snapshot ?? null,
        yDocReady: false,
        timeline: null,
        selectedEventId: null,
        selectedCastEventId: null,
        canUndo: false,
        canRedo: false,
        connectionStatus: 'disconnected',
        pendingRequestCount: 0,
        isPublished: opts.role !== 'local',
        sessionRole: opts.role,
        peers: [],
      })
      recomputeTimeline()
      useUIStore.setState({ manualLock: false })

      const seedContent = opts.seedContent
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

      // 决定是否立即视为已加载:
      // - local:seed 即真相源,直接视为已加载;
      // - editor/author + 本地缓存命中:IndexedDB 内容即真相源(可能比 KV 更新),
      //   onLoadedHandler 立即清 snapshot、写 yDocReady=true、跑一次 reproject;
      // 否则 yDocReady=false,等 LOAD_REPLY 触发 onLoadedHandler;
      // timeline 派生此期间取 snapshot(若有)。
      if (opts.role === 'local' || engine.hadPersistedData) {
        onLoadedHandler()
      }

      // 持久化数据中可能缺 statData(存量迁移产物)→ 补空结构
      const projected = get().timeline
      if (projected && !projected.statData) {
        engine.doc.transact(() => {
          replaceStatData(engine.doc, createEmptyStatData())
        }, HOUSEKEEPING_ORIGIN)
      }

      // 首帧投影后初始化小队状态
      const composition = get().timeline?.composition
      if (composition) {
        get().initializePartyState(composition)
      }

      // editor / author 模式:挂 remote(WS 连接 → load-doc → 双向同步)
      if (opts.role !== 'local') {
        wireRemote(engine)
      }
    },
```

**关键决策记录：**

- `engine.hadPersistedData === true` 路径调 `onLoadedHandler()`，等效"立即就绪"。
- `engine.hadPersistedData === false`（缓存 miss）路径不调 onLoadedHandler——`yDocReady` 保持 false，`yDocProjection` 保持 null，timeline 派生取 snapshot；doc 的 'update' 监听已挂，LOAD_REPLY 带 missing 时 reproject 会通过 'update' 事件自动跑；missing 为空时由 onLoadedHandler 手动 reproject。所以缓存 miss 分支无需提前 reproject。

- [ ] **Step 8: 改 `setViewerSnapshot`**

修改 `src/store/timelineStore.ts:378-406`：

```ts
    setViewerSnapshot: timeline => {
      if (metaTimer) {
        clearTimeout(metaTimer)
        metaTimer = null
      }
      const engine = get().engine
      if (engine) {
        engine.doc.off('update', reproject)
        peersUnsub?.()
        peersUnsub = null
        engine.destroy()
      }
      set({
        engine: null,
        yDocProjection: null,
        snapshot: timeline,
        yDocReady: false,
        timeline: null,
        isPublished: true,
        sessionRole: 'viewer',
        connectionStatus: 'disconnected',
        pendingRequestCount: 0,
        canUndo: false,
        canRedo: false,
        selectedEventId: null,
        selectedCastEventId: null,
        peers: [],
      })
      recomputeTimeline()
      useUIStore.setState({ manualLock: false })
      if (timeline.composition) get().initializePartyState(timeline.composition)
    },
```

- [ ] **Step 9: 改 `reset`**

修改 `src/store/timelineStore.ts:673-687`：

```ts
    reset: () => {
      if (metaTimer) {
        clearTimeout(metaTimer)
        metaTimer = null
      }
      const engine = get().engine
      if (engine) {
        engine.doc.off('update', reproject)
        peersUnsub?.()
        peersUnsub = null
        engine.destroy()
      }
      set({
        engine: null,
        yDocProjection: null,
        snapshot: null,
        yDocReady: false,
        timeline: null,
        canUndo: false,
        canRedo: false,
        ...initialUiState,
      })
    },
```

- [ ] **Step 10: 跑 store 测试确认通过**

Run: `pnpm test:run src/store/timelineStore.test.ts`
Expected: 新增用例全部 PASS；现有 openTimeline / setViewerSnapshot 相关用例无回归。

如有现有用例失败（比如断言 `state.timeline` 在 reset 后是 null 之类），核对断言含义；store 拆字段后 timeline 派生仍正确，但若某些用例依赖中间状态 set 时序，需要适配。常见适配：把 `state.timeline?.name === 'X'` 这类断言保留不变；把 `state.timeline` 设值的内部 set 测试改为读 `state.yDocProjection`。

- [ ] **Step 11: 全量类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 全部 PASS。注意 `TimelineState` 接口变了，TypeScript 会报出所有消费 `s.timeline` 的地方——这些都是派生字段，无需改动；若有处 cast 到 `Pick<TimelineState, ...>` 之类的代码需要补 `yDocProjection / snapshot / yDocReady`，按错误提示补全。

- [ ] **Step 12: 跑全量前端测试**

Run: `pnpm test:run`
Expected: 全部 PASS。重点关注 `editorOpenDecision.test.ts`、`createLocalTimeline.test.ts`、各 component 的 store 集成测试。

- [ ] **Step 13: 提交**

```bash
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "feat(store): split timeline into yDocProjection/snapshot sources with onLoadedHandler"
```

---

### Task 5: `EditorPage` 把 `fetchSharedTimeline` 的 snapshot 透传给 `openTimeline`

让 editor / author 分支调用 `openTimeline` 时把 `serverRes?.snapshot` 作为兜底快照传入。`mode='ready'` 的语义放宽为"页面外壳可渲染"，由 `timeline ? <Canvas/> : <Loading/>` 现有判定继续兜底。

**Files:**

- Modify: `src/pages/EditorPage.tsx:171-185`

- [ ] **Step 1: 改调用**

定位 `src/pages/EditorPage.tsx:170-185`（注释 `// local / author / editor → openTimeline` 段），把：

```ts
// local / author / editor → openTimeline
await openTimeline(id, { role: decision.kind })
```

改为：

```ts
// local / author / editor → openTimeline;editor/author 透传 KV snapshot 做首屏兜底渲染
await openTimeline(id, {
  role: decision.kind,
  snapshot: serverRes?.snapshot,
})
```

注：`serverRes?.snapshot` 已是 `Timeline | undefined`（`SharedTimelineResponse.snapshot?: Timeline`），与 `openTimeline` 的 `snapshot?: Timeline` 选项类型匹配；local 角色 `serverRes` 为 null 时 `?.snapshot` 自动为 undefined，等同不传。

- [ ] **Step 2: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS。

- [ ] **Step 3: 跑相关测试**

Run: `pnpm test:run src/pages src/store`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add src/pages/EditorPage.tsx
git commit -m "feat(editor): pass server snapshot to openTimeline for preflight render"
```

---

### Task 6: 集成验证 + 手测 + 收尾

确认服务端 / 客户端改动协同工作，跑全量测试 + 类型检查 + lint + build。

**Files:** 无新增改动；仅运行验证命令。

- [ ] **Step 1: 跑全量前端测试**

Run: `pnpm test:run`
Expected: 全部 PASS。

- [ ] **Step 2: 跑全量 worker 测试**

Run: `pnpm test:run src/workers`
Expected: 全部 PASS。

- [ ] **Step 3: 类型检查 + lint + build**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: 全部 PASS。

- [ ] **Step 4: 手测脚本（用户负责执行，agent 列出 checklist）**

提示用户在浏览器执行以下场景验证：

1. **editor 首访 + KV 命中**：
   - 打开 DevTools Network 面板，按住 Shift 刷新清缓存；
   - 用 editor（非作者）账号访问一条已发布、KV 已有 snapshot 的时间轴；
   - 期望：首屏立即看到 snapshot 内容（包含 cast / damage / 阵容），按钮处于只读态（offline cause 锁），1 RTT 后切到 yDocProjection（视觉无空白）。

2. **editor 首访 + KV miss**：
   - 用 editor 账号访问一条新发布、KV 未填充的时间轴；
   - 期望：先看到内联"加载中..."文案，LOAD_REPLY 后切到 yDocProjection。

3. **editor 重访（本地缓存命中）**：
   - 同账号刷新页面；
   - 期望：立即看到内容（来自 IndexedDB），onLoadedHandler 幂等短路，行为与改动前一致。

4. **viewer 路径**：
   - 用未授权账号访问；
   - 期望：行为完全不变，snapshot 立即显示，无 Y.Doc。

5. **撤权流程**：
   - 作者撤销 editor 权限后，editor 端 toast 出现"编辑权限已被移除"，按钮文案切换，画布内容继续显示。

6. **慢网模拟（Chrome DevTools → Slow 3G）**：
   - editor 首访已发布时间轴：观察是否存在"空编辑器"瞬间；
   - 期望：无空窗，snapshot 立即显示，1+ RTT 后内容刷新。

- [ ] **Step 5: 提交 plan 完成标记（可选）**

若整个 plan 在同一分支完成，建议在最终一个 commit 末尾不再额外打标，留待发布走 PR 合并即可。无新增 commit。

---

## 自检（spec → plan 映射）

| Spec 章节                     | 对应 Task                                   | 备注                                         |
| ----------------------------- | ------------------------------------------- | -------------------------------------------- |
| §3.1 缓存命中数据流           | Task 4 Step 7（`engine.hadPersistedData`）  | onLoadedHandler 立即触发                     |
| §3.2 缓存 miss 数据流         | Task 4 Step 7 / Task 2 LOAD_REPLY 触发      | snapshot 兜底 + LOAD_REPLY → onLoaded        |
| §3.3 viewer 不变              | Task 4 Step 8                               | setViewerSnapshot 写 snapshot 字段           |
| §4.1 store 字段拆分           | Task 4 Step 3                               | 接口 + 初值                                  |
| §4.1 selector                 | Task 4 Step 4                               | recomputeTimeline                            |
| §4.1 openTimeline 时序        | Task 4 Step 7                               | 缓存命中分支 vs miss 分支                    |
| §4.1 onLoadedHandler          | Task 4 Step 5                               | 幂等 + 手动 reproject                        |
| §4.1 reset 清三源             | Task 4 Step 9                               |                                              |
| §4.2 SyncEngine               | Task 3                                      | hadPersistedData + onLoaded 透传             |
| §4.3 RemoteConnection         | Task 2                                      | 构造参数 + LOAD_REPLY 末尾触发               |
| §4.4 EditorPage               | Task 5                                      | 透传 serverRes?.snapshot                     |
| §4.5 EditLock 不动            | —                                           | 不引入新 cause；offline cause 自然生效       |
| §5.1 Worker 路由三角色共用 KV | Task 1                                      | KV 查询提前到角色判定后                      |
| §5.2 KV miss 回填             | Task 1（保留 docStub.getSnapshotJson 兜底） | 现有逻辑保留                                 |
| §5.3 Cache-Control 不变       | Task 1（断言 private, no-cache）            | editor/author 不缓存                         |
| §6 边界 case                  | Task 6 Step 4 手测                          | 6 种场景逐一验证                             |
| §7.1 store 测试               | Task 4 Step 1                               | selector × 3 + 缓存命中 / miss + 幂等 + 撤权 |
| §7.2 RemoteConnection 测试    | Task 2 Step 1                               | 5 条用例                                     |
| §7.3 Worker 路由测试          | Task 1 Step 1                               | KV 命中 / miss + Cache-Control               |
| §7.4 集成手测                 | Task 6 Step 4                               |                                              |
