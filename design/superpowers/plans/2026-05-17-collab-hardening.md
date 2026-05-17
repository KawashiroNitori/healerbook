# 协作编辑加固增量 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 WS 重连时使用过期 token 导致的无限失败循环，并清理 PeerOverlay 一处冗余类型强转。

**Architecture:** `RemoteConnection` 的取 token 回调从同步改为异步，握手时复用 `authStore.getValidToken()` 自动续期；对「拿不到有效 token」与「服务端 1008 拒绝」两类鉴权失败改为终态断开、不再重连；其余 close code 维持指数退避重连。

**Tech Stack:** TypeScript、Yjs、y-protocols/awareness、Zustand、Vitest。

**设计依据：** `design/superpowers/specs/2026-05-17-collab-hardening-design.md`

---

## 文件结构

| 文件                                      | 责任                            | 本计划改动                                                                              |
| ----------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| `src/collab/RemoteConnection.ts`          | 单条时间轴的远端 WS 同步连接    | 构造参数改异步；`onopen` 抽出异步 `authenticate`；`onClose` 接收 close code 并分流终态  |
| `src/collab/RemoteConnection.test.ts`     | 上者的单测                      | FakeWebSocket 支持异步 open / 带 code 的 close；存量用例适配异步；新增 3 个鉴权失败用例 |
| `src/collab/SyncEngine.ts`                | 同步引擎，挂 `RemoteConnection` | `connectRemote` 形参类型改异步签名                                                      |
| `src/store/timelineStore.ts`              | 时间轴 Zustand store            | `wireRemote` 改用 `getValidToken()`                                                     |
| `src/components/Timeline/PeerOverlay.tsx` | 协作者感知叠加层                | 删除 `PeerOverlayMain` 中冗余的 `anchor as {...}` 强转                                  |

**关键约束：** husky `pre-commit` 对整个工程跑 `pnpm tsc -b --noEmit`。`RemoteConnection` 构造签名一改，`SyncEngine` 与 `timelineStore` 的调用点会立刻类型不符——因此 Task 1 必须把这四个文件 + 测试文件**一次性原子提交**，不存在可单独提交的中间态。

> **类型检查务必用 `pnpm tsc -b --noEmit`（build 模式）。** `pnpm exec tsc --noEmit` 对根 solution 风格 tsconfig 是 no-op，不会报错。
> **提交信息/作者禁止包含 "claude"（大小写不敏感）**，`.husky/commit-msg` 会拒绝。不要加 `Co-Authored-By`。
> `git add` 只显式列出本计划涉及的文件路径，**不要用 `git add -A`**。

---

## Task 1: WS token 续期 + 鉴权失败终态断开

**Files:**

- Modify: `src/collab/RemoteConnection.ts`
- Modify: `src/collab/RemoteConnection.test.ts`
- Modify: `src/collab/SyncEngine.ts:67-76`
- Modify: `src/store/timelineStore.ts:256-259`

### 背景

`RemoteConnection` 当前构造参数 `getJwt: () => string | null` 同步读取 `authStore.accessToken` 原值。accessToken 仅 15 分钟有效，挂机后 WS 断线重连时握手拿到的是过期 token → 服务端以 close code `1008` 拒绝 → 退避重连 → 再次拿到同一过期 token → 无限失败循环。

`authStore` 已有 `getValidToken(): Promise<string | null>`（有效则返回原值、过期则用 refreshToken 续期、续期失败返回 `null`）。本任务把取 token 回调改异步并复用它；同时对鉴权失败改为终态断开。

- [ ] **Step 1: 改写测试文件 `RemoteConnection.test.ts`**

测试文件做四类改动。

**(1) 替换 `FakeWebSocket` 类**（第 8-38 行整块）为下面版本——`onopen` 可返回 Promise、`fireOpen` 改异步、`onclose` 携带 `code`、新增 `fireClose(code)`：

```typescript
/** 内存 fake WebSocket:记录 client 发出的帧,可手动注入 server 帧 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  static CLOSED = 3
  readyState = 0
  binaryType = ''
  sent: Uint8Array[] = []
  onopen: (() => void | Promise<void>) | null = null
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: Uint8Array) {
    this.sent.push(new Uint8Array(data))
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1000 })
  }
  async fireOpen() {
    this.readyState = FakeWebSocket.OPEN
    await this.onopen?.()
  }
  fireMessage(frame: Uint8Array) {
    this.onmessage?.({
      data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength),
    })
  }
  fireClose(code: number) {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code })
  }
}
```

**(2) 适配全部 11 个存量 `it(...)` 用例**——纯机械转换，逐条套用以下三条规则，用例断言逻辑一律不变：

- 回调签名 `() => {` 改为 `async () => {`。
- 取 token 实参 `() => 'jwt-abc'` / `() => 'j'` 改为 `() => Promise.resolve('jwt-abc')` / `() => Promise.resolve('j')`。
- 每一处 `lastSocket().fireOpen()` 改为 `await lastSocket().fireOpen()`。

转换后第一个用例应长这样（作为样板，其余 10 个同理套用）：

```typescript
it('sends AUTH on open', async () => {
  const doc = new Y.Doc()
  const conn = new RemoteConnection(
    'ws://x/connect',
    doc,
    new Awareness(doc),
    () => Promise.resolve('jwt-abc'),
    () => {}
  )
  conn.connect()
  await lastSocket().fireOpen()
  const frame = decodeMessage(lastSocket().sent[0])
  expect(frame.type).toBe(MSG.AUTH)
  expect(new TextDecoder().decode(frame.payload)).toBe('jwt-abc')
  conn.destroy()
})
```

**(3) 顶部 import 增加 `afterEach`**——把第 1 行改为：

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
```

并在 `beforeEach(...)` 块之后新增一个 `afterEach`，兜底重置可能被用例切换的计时器：

```typescript
afterEach(() => {
  vi.useRealTimers()
})
```

**(4) 在 `describe('RemoteConnection awareness', ...)` 块结束的 `})` 之后**，追加一个新 describe 块（含 3 个鉴权失败用例）：

```typescript
describe('RemoteConnection auth hardening', () => {
  it('closes terminally and does not reconnect when getAuthToken returns null', async () => {
    const doc = new Y.Doc()
    const statuses: string[] = []
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => Promise.resolve(null),
      s => statuses.push(s)
    )
    conn.connect()
    await lastSocket().fireOpen()
    // 拿不到 token:不发 AUTH 帧
    expect(lastSocket().sent.length).toBe(0)
    // 终态:状态回到 disconnected,且不再创建新连接
    expect(statuses[statuses.length - 1]).toBe('disconnected')
    expect(FakeWebSocket.instances.length).toBe(1)
    conn.destroy()
  })

  it('treats a server close with code 1008 as terminal and does not reconnect', async () => {
    const doc = new Y.Doc()
    const statuses: string[] = []
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => Promise.resolve('j'),
      s => statuses.push(s)
    )
    conn.connect()
    await lastSocket().fireOpen()
    lastSocket().fireClose(1008)
    expect(statuses[statuses.length - 1]).toBe('disconnected')
    expect(FakeWebSocket.instances.length).toBe(1)
    conn.destroy()
  })

  it('reconnects after a non-1008 close and fetches a fresh token', async () => {
    vi.useFakeTimers()
    const doc = new Y.Doc()
    let calls = 0
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => Promise.resolve(`tok${++calls}`),
      () => {}
    )
    conn.connect()
    await lastSocket().fireOpen()
    expect(new TextDecoder().decode(decodeMessage(lastSocket().sent[0]).payload)).toBe('tok1')
    // 非 1008 关闭 → 指数退避重连(首个退避 1000ms)
    lastSocket().fireClose(1006)
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeWebSocket.instances.length).toBe(2)
    // 重连握手取到新鲜 token
    await lastSocket().fireOpen()
    expect(new TextDecoder().decode(decodeMessage(lastSocket().sent[0]).payload)).toBe('tok2')
    conn.destroy()
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm test:run RemoteConnection`
Expected: FAIL。新用例与改造后的存量用例失败——当前 `RemoteConnection` 仍是同步 `getJwt`，把 `Promise` 当 token 用，`encodeMessage(MSG.AUTH, new TextEncoder().encode(promise))` 行为错误；且新增的终态/重连用例所断言的行为尚未实现。

- [ ] **Step 3: 改写 `RemoteConnection.ts`**

**(3a) 字段与构造函数**——把第 19 行 `getJwt` 字段及第 40-52 行构造函数改为：

```typescript
  private readonly getAuthToken: () => Promise<string | null>
```

```typescript
  constructor(
    url: string,
    doc: Y.Doc,
    awareness: Awareness,
    getAuthToken: () => Promise<string | null>,
    onStatus: (status: ConnectionStatus) => void
  ) {
    this.url = url
    this.doc = doc
    this.awareness = awareness
    this.getAuthToken = getAuthToken
    this.onStatus = onStatus
  }
```

（即把原 `getJwt` 字段声明、构造形参、`this.getJwt = getJwt` 一并重命名为 `getAuthToken` 并改类型。）

**(3b) `open()` 方法**——把第 80-98 行整段替换为下面版本：`onopen` 不再内联取 token，改为委托给异步 `authenticate`；`onclose` 透传 `ev.code`：

```typescript
  private open(): void {
    this.setStatus('connecting')
    const ws = new WebSocket(this.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    // 故意把 authenticate 的 Promise 作为返回值交回:浏览器忽略 onopen 返回值,
    // 而单测的 FakeWebSocket.fireOpen 靠 await 它来等握手完成。勿改成 `() => { void ... }`。
    ws.onopen = () => this.authenticate(ws)
    ws.onmessage = ev => this.onMessage(new Uint8Array(ev.data as ArrayBuffer))
    ws.onclose = ev => this.onClose(ev.code)
    ws.onerror = () => {
      /* onclose 紧随其后,统一在那里处理 */
    }
  }

  /**
   * onopen 后异步取 token 并发 AUTH。
   * 取不到有效 token 视为终态鉴权失败:置 closed、关闭连接、不再重连。
   */
  private async authenticate(ws: WebSocket): Promise<void> {
    const jwt = await this.getAuthToken()
    // await 期间连接可能已被 destroy() 关闭或被重连流程替换
    if (this.ws !== ws || this.closed) return
    if (!jwt) {
      this.closed = true
      ws.close()
      return
    }
    ws.send(encodeMessage(MSG.AUTH, new TextEncoder().encode(jwt)))
  }
```

**(3c) `onClose()` 方法**——把第 139-153 行整段替换为下面版本：接收 close `code`，`1008` 视为终态：

```typescript
  private onClose(code?: number): void {
    this.detachUpdateListener()
    this.awareness.off('update', this.onAwarenessUpdate)
    this.ws = null
    if (this.closed) {
      this.setStatus('disconnected')
      return
    }
    // 服务端以 1008 拒绝(invalid token / not an editor / auth required):
    // 重连无意义,转入终态
    if (code === 1008) {
      this.closed = true
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
```

- [ ] **Step 4: 更新 `SyncEngine.ts` 的 `connectRemote` 签名**

把 `src/collab/SyncEngine.ts:67` 的形参类型改为异步签名（形参名同时由 `getJwt` 改为 `getAuthToken`，函数体里传给 `new RemoteConnection(...)` 的实参随之改名）：

```typescript
  /** 挂上远端连接(发布 / editor 模式)。幂等。 */
  connectRemote(
    getAuthToken: () => Promise<string | null>,
    onStatus: (status: ConnectionStatus) => void
  ): void {
    if (this.remote) return
    this.remote = new RemoteConnection(
      buildWsUrl(this.docId),
      this.doc,
      this.awareness,
      getAuthToken,
      onStatus
    )
    this.remote.connect()
  }
```

- [ ] **Step 5: 更新 `timelineStore.ts` 的 `wireRemote`**

把 `src/store/timelineStore.ts:256-259` 的 `connectRemote` 调用，第一个实参由读取原始 `accessToken` 改为调用自动续期的 `getValidToken()`：

```typescript
engine.connectRemote(
  () => useAuthStore.getState().getValidToken(),
  status => set({ connectionStatus: status })
)
```

- [ ] **Step 6: 全量校验**

Run: `pnpm tsc -b --noEmit`
Expected: 0 error

Run: `pnpm lint`
Expected: 0 error / 0 warning

Run: `pnpm test:run RemoteConnection`
Expected: PASS，全部用例（含 3 个新增鉴权失败用例）通过

Run: `pnpm test:run`
Expected: 全量 PASS，无其他模块回归

- [ ] **Step 7: 提交**

```bash
git add src/collab/RemoteConnection.ts src/collab/RemoteConnection.test.ts src/collab/SyncEngine.ts src/store/timelineStore.ts
git commit -m "fix(collab): refresh WS token on reconnect, terminal disconnect on auth failure"
```

---

## Task 2: 清理 PeerOverlay 冗余类型强转

**Files:**

- Modify: `src/components/Timeline/PeerOverlay.tsx:402-410`

### 背景

`PeerOverlayMain` 在 `annotation.anchor.type === 'skillTrack'` 类型收窄之后，又写了一个 `annotation.anchor as { type: 'skillTrack'; playerId: number; actionId: number }`。`AnnotationAnchor`（`src/types/timeline.ts:218`）本就是合法判别联合，`type` 判等已使 TypeScript 把 `annotation.anchor` 收窄到 `skillTrack` 变体，该 `as` 纯属冗余。删除它，无行为变化——回归由 `tsc -b` 与既有测试套件兜底。

- [ ] **Step 1: 删除冗余强转**

在 `src/components/Timeline/PeerOverlay.tsx` 中，把下面这段（约第 402-410 行）：

```typescript
      if (annotation?.anchor.type === 'skillTrack') {
        const anchor = annotation.anchor as {
          type: 'skillTrack'
          playerId: number
          actionId: number
        }
        const trackIndex = skillTracks.findIndex(
          t => t.playerId === anchor.playerId && t.actionId === anchor.actionId
        )
```

改为直接使用收窄后的 `annotation.anchor`：

```typescript
      if (annotation?.anchor.type === 'skillTrack') {
        const anchor = annotation.anchor
        const trackIndex = skillTracks.findIndex(
          t => t.playerId === anchor.playerId && t.actionId === anchor.actionId
        )
```

- [ ] **Step 2: 校验**

Run: `pnpm tsc -b --noEmit`
Expected: 0 error（`anchor` 已被收窄为 `skillTrack` 变体，`anchor.playerId` / `anchor.actionId` 类型合法）

Run: `pnpm lint`
Expected: 0 error / 0 warning

- [ ] **Step 3: 提交**

```bash
git add src/components/Timeline/PeerOverlay.tsx
git commit -m "refactor(collab): drop redundant anchor cast in PeerOverlay"
```

---

## 收尾验证

两个任务完成后，跑一遍完整门禁确认无回归：

- [ ] `pnpm tsc -b --noEmit` — 0 error
- [ ] `pnpm lint` — 0 error / 0 warning
- [ ] `pnpm test:run` — 全量 PASS
- [ ] `pnpm build` — 成功
