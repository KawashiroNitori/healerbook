# 时间轴协同编辑:Awareness(计划 C)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `editor` 模式的协同编辑者实时看到彼此 —— 在线成员、选中高亮、悬停光标、拖动 ghost。

**Architecture:** 接入 `y-protocols/awareness` 标准 `Awareness`(绑 Y.Doc),经已有的 `MSG.AWARENESS` 帧收发临时态。`SyncEngine` 持 `Awareness`,`RemoteConnection` 收发,`TimelineDoc` DO 把每连接最近一帧 awareness 存进 `serializeAttachment` 并在新连接鉴权后补发快照。`timelineStore` 把他人 awareness 投影成 `peers`,UI 在 header 与 Konva 画布 overlay 层渲染。

**Tech Stack:** `y-protocols/awareness`、Yjs、WebSocket、Cloudflare Durable Objects、React 19 + Zustand、React-Konva、Vitest。

**前置:** 计划 A(服务端)、计划 B(客户端整合)均已完成。本计划对应设计 spec `design/superpowers/specs/2026-05-17-timeline-collab-awareness-design.md`(下称 **awareness spec**),实现其 §7 落地顺序 1–7 组。

**关键事实(实现者须知):**

- 真实类型检查命令是 `pnpm tsc -b --noEmit`(build 模式);`pnpm exec tsc --noEmit` 对本仓库的 solution-style 根 tsconfig 是 no-op,**不要用它**判断类型对错。
- 项目 tsconfig `erasableSyntaxOnly: true`:**禁止** TS 构造函数参数属性、**禁止** enum。
- `MSG.AWARENESS = 6` 已在 `src/collab/syncProtocol.ts` 定义;DO 当前对它做纯转发。
- `RemoteConnection`(`src/collab/RemoteConnection.ts`)当前 `onMessage` 对 `MSG.AWARENESS` 是空注释「计划 C 处理」。
- `SyncEngine`(`src/collab/SyncEngine.ts`)持 `doc` / `undoManager` / `remote`,`connectRemote(getJwt, onStatus)` 创建 `RemoteConnection`。
- `timelineStore`(`src/store/timelineStore.ts`)已有 `connectionStatus`、`isPublished`、`engine`;`reproject`、`scheduleMetaWrite`、`wireRemote` helper。
- `authStore`(`src/store/authStore.ts`)暴露 `username: string | null`、`userId: string | null`。
- Konva 画布见 §C7 开头的「画布坐标速查」。

**Git:** 每个 task 独立 commit(plan-declared,subagent-driven 流程内自主执行)。提交信息 / 作者**不得含 "claude"**(husky `commit-msg` 拒绝),无 `Co-Authored-By`。`git add` 显式列文件,不要 `git add -A`。husky `pre-commit` 跑 lint-staged + `tsc -b --noEmit`。1Password SSH 签名失败时报告,**不得** `--no-gpg-sign` / `--no-verify`。

---

## 文件结构

**新建:**

- `src/collab/awarenessIdentity.ts` —— 调色板 + `colorForUser` + `displayName`。
- `src/collab/awarenessIdentity.test.ts`
- `src/collab/awarenessTypes.ts` —— `AwarenessState` / `PeerState` 类型(供 collab 层与 store / UI 共享)。
- `src/components/PresenceAvatars.tsx` —— header 在线成员头像 + 连接状态点。
- `src/components/Timeline/PeerOverlay.tsx` —— 画布 peer overlay(选中高亮 / 悬停光标 / 拖动 ghost)。

**修改:**

- `src/collab/SyncEngine.ts` —— 持 `Awareness`,`connectRemote` 透传给 `RemoteConnection`,`destroy` 销毁。
- `src/collab/RemoteConnection.ts` —— 构造接收 `Awareness`,收发 `MSG.AWARENESS`,`AUTH_OK` 后首播。
- `src/collab/RemoteConnection.test.ts` —— 补 awareness 用例。
- `src/workers/durable/TimelineDoc.ts` —— `SocketAttachment.lastAwareness`,存储 + 鉴权后快照下发。
- `src/workers/durable/TimelineDoc.workers.test.ts` —— 补快照用例。
- `src/store/timelineStore.ts` —— `peers` 投影、本地 `user`/`cursor`/`dragging`/`selection` 写入器。
- `src/pages/EditorPage.tsx` —— header 挂 `PresenceAvatars`。
- `src/components/Timeline/index.tsx` —— 挂 `PeerOverlay`;`mousemove`/`mouseleave` 接 `setLocalCursor`;拖动回调接 `setLocalDragging`。
- `package.json` —— 新增依赖 `y-protocols`。

---

## Task C1: 依赖 + awarenessIdentity

**Files:**

- `package.json`(加依赖)
- Create: `src/collab/awarenessIdentity.ts`
- Create: `src/collab/awarenessIdentity.test.ts`

- [ ] **Step 1: 安装 y-protocols**

Run: `pnpm add y-protocols`
Expected: `package.json` `dependencies` 出现 `y-protocols`,`pnpm-lock.yaml` 更新。`y-protocols` 与 `yjs` 配套,API:`y-protocols/awareness` 导出 `Awareness` / `encodeAwarenessUpdate` / `applyAwarenessUpdate` / `removeAwarenessStates`。

- [ ] **Step 2: 写失败测试** —— `src/collab/awarenessIdentity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { COLOR_PALETTE, colorForUser, displayName } from './awarenessIdentity'

describe('awarenessIdentity', () => {
  it('palette has enough distinct colors and excludes self-selection blue/green', () => {
    expect(COLOR_PALETTE.length).toBeGreaterThanOrEqual(12)
    expect(new Set(COLOR_PALETTE).size).toBe(COLOR_PALETTE.length)
    // 自身选中态用 #3b82f6(蓝)/ #10b981(绿),peer 调色板须避开
    expect(COLOR_PALETTE).not.toContain('#3b82f6')
    expect(COLOR_PALETTE).not.toContain('#10b981')
  })

  it('colorForUser is deterministic and within the palette', () => {
    const c = colorForUser('user-abc')
    expect(COLOR_PALETTE).toContain(c)
    expect(colorForUser('user-abc')).toBe(c) // 同 id 恒定
  })

  it('colorForUser spreads different ids across the palette', () => {
    const colors = new Set(Array.from({ length: 40 }, (_, i) => colorForUser(`u${i}`)))
    expect(colors.size).toBeGreaterThan(5)
  })

  it('displayName uses username when present', () => {
    expect(displayName('Aldgoat', 'uid-1')).toBe('Aldgoat')
  })

  it('displayName falls back to 用户 + last 4 of userId when username empty', () => {
    expect(displayName('', 'abcdef123456')).toBe('用户3456')
    expect(displayName(null, 'abcdef123456')).toBe('用户3456')
  })
})
```

Run: `pnpm test:run awarenessIdentity` — FAIL(模块不存在)。

- [ ] **Step 3: 实现** —— `src/collab/awarenessIdentity.ts`:

```typescript
/**
 * Awareness 身份:协作者颜色与昵称。
 * 颜色由 userId 确定性哈希到固定调色板 —— 同一用户每次每设备恒定同色,无需协商。
 */

/**
 * 协作者调色板。14 个高区分度色,刻意避开自身选中态的蓝 #3b82f6 / 绿 #10b981。
 */
export const COLOR_PALETTE: readonly string[] = [
  '#a855f7', // purple
  '#ec4899', // pink
  '#f43f5e', // rose
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#84cc16', // lime
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#0ea5e9', // sky
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#d946ef', // fuchsia
]

/** 简单确定性字符串哈希(FNV-1a 变体),返回非负整数 */
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 由 userId 定一个稳定颜色 */
export function colorForUser(userId: string): string {
  return COLOR_PALETTE[hashString(userId) % COLOR_PALETTE.length]
}

/** 协作者昵称:用 FFLogs 账号名;为空时兜底为「用户」+ userId 末 4 位 */
export function displayName(username: string | null | undefined, userId: string): string {
  const name = (username ?? '').trim()
  if (name) return name
  return `用户${userId.slice(-4)}`
}
```

Run: `pnpm test:run awarenessIdentity` — PASS。Run `pnpm tsc -b --noEmit` — 0 error。

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/collab/awarenessIdentity.ts src/collab/awarenessIdentity.test.ts
git commit -m "feat(collab): y-protocols dep and awareness identity"
```

---

## Task C2: AwarenessState 类型 + SyncEngine 持 Awareness

**Files:**

- Create: `src/collab/awarenessTypes.ts`
- Modify: `src/collab/SyncEngine.ts`

- [ ] **Step 1: 写 awarenessTypes.ts**

```typescript
/** 一个协作者的 awareness 临时态 —— 不进 Y.Doc、不持久化。见 awareness spec §2。 */
export interface AwarenessState {
  user: {
    /** 用户 id(FFLogs userId)—— header 头像按它去重 */
    id: string
    /** 昵称 */
    name: string
    /** 颜色(取自 COLOR_PALETTE) */
    color: string
  }
  /** 当前选中的事件;未选中各字段为 null */
  selection: { eventId: string | null; castEventId: string | null }
  /** 鼠标悬停对应的时间轴时间(秒);不在画布上为 null */
  cursorTime: number | null
  /** 正在拖动的对象 ghost;未拖动为 null */
  dragging: {
    id: string
    kind: 'damage' | 'cast' | 'annotation'
    /** ghost 当前时间(秒) */
    time: number
    /** cast 的目标轨道玩家;damage / annotation 恒为 null */
    playerId: number | null
  } | null
}

/** store 投影给 UI 的他人状态(附 Yjs clientID) */
export interface PeerState extends AwarenessState {
  clientId: number
}
```

- [ ] **Step 2: SyncEngine 持 Awareness**

`src/collab/SyncEngine.ts`:

(a) import 区加:

```typescript
import { Awareness } from 'y-protocols/awareness'
```

(b) 类加字段并在构造函数里初始化(注意:`erasableSyntaxOnly` —— 不用参数属性,显式声明):

```typescript
  readonly awareness: Awareness
```

在构造函数体内(`this.doc` 赋值之后)加:

```typescript
this.awareness = new Awareness(this.doc)
```

(c) `connectRemote` 把 `awareness` 透传给 `RemoteConnection`(`RemoteConnection` 构造签名在 Task C3 扩展)。当前:

```typescript
this.remote = new RemoteConnection(buildWsUrl(this.docId), this.doc, getJwt, onStatus)
```

改为:

```typescript
this.remote = new RemoteConnection(
  buildWsUrl(this.docId),
  this.doc,
  this.awareness,
  getJwt,
  onStatus
)
```

(d) `destroy()` 里,在 `this.undoManager.destroy()` 附近加:

```typescript
this.awareness.destroy()
```

- [ ] **Step 3: 类型检查**

Run: `pnpm tsc -b --noEmit`。预期此时 **`RemoteConnection` 构造参数数量不匹配**报错 —— 这是预期的,Task C3 修。本 task 与 C3 类型耦合,**两者合为一个 commit**:本 task 不单独 commit,改动留在工作树,接着做 C3。

> 实现者:C2 + C3 是一个类型耦合单元。完成 C3 后一并提交。本步只需确认 `SyncEngine.ts` / `awarenessTypes.ts` 自身写法无误(除 `RemoteConnection` 参数数那一处预期错误)。

---

## Task C3: RemoteConnection 收发 MSG.AWARENESS

`RemoteConnection` 接管 awareness:构造接收 `Awareness`;本地 awareness 变化 → 编码上送;远端帧 → 应用;`AUTH_OK` 后首播本地状态。

**Files:**

- Modify: `src/collab/RemoteConnection.ts`
- Modify: `src/collab/RemoteConnection.test.ts`

- [ ] **Step 1: 写失败测试** —— 在 `src/collab/RemoteConnection.test.ts` 追加(沿用文件已有的 `FakeWebSocket` / `vi.stubGlobal` / `lastSocket()` 风格;`RemoteConnection` 构造多一个 `Awareness` 参数):

```typescript
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness'

describe('RemoteConnection awareness', () => {
  it('broadcasts local awareness after AUTH_OK', () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    awareness.setLocalStateField('user', { id: 'u1', name: 'A', color: '#a855f7' })
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      awareness,
      () => 'j',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    const awarenessFrame = lastSocket().sent.find(f => decodeMessage(f).type === MSG.AWARENESS)
    expect(awarenessFrame).toBeDefined()
    conn.destroy()
  })

  it('sends MSG.AWARENESS when local awareness changes', () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      awareness,
      () => 'j',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    const before = lastSocket().sent.length
    awareness.setLocalStateField('cursorTime', 42)
    const after = lastSocket().sent.slice(before).map(decodeMessage)
    expect(after.some(m => m.type === MSG.AWARENESS)).toBe(true)
    conn.destroy()
  })

  it('applies a remote MSG.AWARENESS frame into the local Awareness', () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      awareness,
      () => 'j',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))

    // 模拟另一个 peer 的 awareness
    const peerDoc = new Y.Doc()
    const peerAwareness = new Awareness(peerDoc)
    peerAwareness.setLocalStateField('user', { id: 'u2', name: 'B', color: '#06b6d4' })
    const peerFrame = encodeAwarenessUpdate(peerAwareness, [peerAwareness.clientID])
    lastSocket().fireMessage(encodeMessage(MSG.AWARENESS, peerFrame))

    expect(awareness.getStates().get(peerAwareness.clientID)?.user?.name).toBe('B')
    conn.destroy()
  })

  it('does not echo a remote awareness update back out', () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      awareness,
      () => 'j',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    const before = lastSocket().sent.length

    const peerDoc = new Y.Doc()
    const peerAwareness = new Awareness(peerDoc)
    peerAwareness.setLocalStateField('user', { id: 'u3', name: 'C', color: '#f97316' })
    lastSocket().fireMessage(
      encodeMessage(MSG.AWARENESS, encodeAwarenessUpdate(peerAwareness, [peerAwareness.clientID]))
    )

    const after = lastSocket().sent.slice(before).map(decodeMessage)
    expect(after.some(m => m.type === MSG.AWARENESS)).toBe(false)
    conn.destroy()
  })
})
```

Run: `pnpm test:run RemoteConnection` — 新用例 FAIL(构造参数不符 / 未处理 awareness)。

- [ ] **Step 2: 实现** —— `src/collab/RemoteConnection.ts`:

(a) import 区加:

```typescript
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness'
```

(b) 构造函数加 `awareness` 参数(显式字段,不用参数属性)。现有构造形如 `constructor(url, doc, getJwt, onStatus)` —— 改成在 `doc` 之后插入 `awareness`:类体加 `private readonly awareness: Awareness`,构造函数签名 `(url, doc, awareness, getJwt, onStatus)`,函数体 `this.awareness = awareness`。

(c) awareness 本地变化监听 —— 加一个绑定的 handler 字段:

```typescript
  private readonly onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ): void => {
    if (origin === REMOTE_ORIGIN) return // 远端来的,不回推
    if (this.status !== 'connected' || !this.ws) return
    const changed = [...added, ...updated, ...removed]
    if (changed.length === 0) return
    this.ws.send(encodeMessage(MSG.AWARENESS, encodeAwarenessUpdate(this.awareness, changed)))
  }
```

(d) `AUTH_OK` 分支:在原有 `LOAD` 发送之后,注册 awareness 监听并首播本地状态。找到 `onMessage` 里处理 `MSG.AUTH_OK` 的分支,末尾加:

```typescript
this.awareness.on('update', this.onAwarenessUpdate)
// 首播本地 awareness,使已在线者立刻看到自己
this.ws?.send(
  encodeMessage(MSG.AWARENESS, encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]))
)
```

(e) `MSG.AWARENESS` 接收分支 —— 把现有的空注释替换为:

```typescript
if (msg.type === MSG.AWARENESS) {
  applyAwarenessUpdate(this.awareness, msg.payload, REMOTE_ORIGIN)
  return
}
```

(f) 断开 / 销毁时移除 awareness 监听 —— 找到 `onClose`(或重连前的清理)与 `destroy()`,在断开本地 doc `update` 监听的同一处加:

```typescript
this.awareness.off('update', this.onAwarenessUpdate)
```

注意:重连时 `AUTH_OK` 会重新 `on('update')`,故 `onClose` 里必须 `off`,避免重复注册。`destroy()` 同样 `off`。

> 实现者:`y-protocols/awareness` 的 `Awareness` 自带 check interval —— 本端 state 半超时(~15s)自动 `setLocalState` 续期 → 触发 `update` 事件 → 经 (c) 的 handler 自动重广播。**无需手写心跳定时器**(awareness spec §3.2)。

- [ ] **Step 3: 跑测试**

Run: `pnpm test:run RemoteConnection` — 全 PASS(含原有用例 —— 注意原有用例的 `new RemoteConnection(...)` 调用也要补 `awareness` 参数;一并改)。
Run: `pnpm test:run SyncEngine` — PASS。
Run: `pnpm tsc -b --noEmit` — 0 error(C2 的耦合错误此时消除)。
Run: `pnpm test:run` — 全绿。

- [ ] **Step 4: Commit(含 C2)**

```bash
git add src/collab/awarenessTypes.ts src/collab/SyncEngine.ts src/collab/RemoteConnection.ts src/collab/RemoteConnection.test.ts
git commit -m "feat(collab): awareness over websocket in SyncEngine / RemoteConnection"
```

---

## Task C4: DO awareness 快照下发

`TimelineDoc` DO 把每个连接最近一帧 awareness payload 存进 `serializeAttachment`;新连接鉴权后,把其他连接的存量 payload 逐帧补发给它。

**Files:**

- Modify: `src/workers/durable/TimelineDoc.ts`
- Modify: `src/workers/durable/TimelineDoc.workers.test.ts`

- [ ] **Step 1: 读现状** —— `src/workers/durable/TimelineDoc.ts`:确认 `SocketAttachment` 接口(当前形如 `{ authed: boolean; userId?: string }`)、`handleAuth`(鉴权通过后 `serializeAttachment` + 发 `AUTH_OK`)、`dispatch` 里 `MSG.AWARENESS` 分支(当前 `broadcast`)、`broadcast` helper、`getWebSockets()` 用法。

- [ ] **Step 2: 写失败测试** —— 在 `TimelineDoc.workers.test.ts` 追加(沿用文件已有的 WS 连接 + auth 风格 helper):

```typescript
describe('awareness snapshot on join', () => {
  it('relays a peer awareness frame and replays it to a later joiner', async () => {
    // 连接 A,鉴权,发一帧 awareness
    const a = await connectAndAuth(/* 文件已有的 helper */)
    const awarenessPayload = new Uint8Array([1, 2, 3, 4]) // 不透明 payload,DO 不解码
    a.send(encodeMessage(MSG.AWARENESS, awarenessPayload))
    await vi.waitFor(() => {
      /* 给 DO 处理时间 */
    })

    // 连接 B 后鉴权 —— 应收到 A 的 awareness 快照帧
    const b = await connectAndAuth(/* helper */)
    const frames = await b.collectFrames(/* 等若干帧 */)
    const awarenessFrames = frames.filter(f => decodeMessage(f).type === MSG.AWARENESS)
    expect(awarenessFrames.some(f => bytesEqual(decodeMessage(f).payload, awarenessPayload))).toBe(
      true
    )
  })
})
```

> 实现者:`TimelineDoc.workers.test.ts` 已有 WS 连接 + 鉴权的测试与 helper(Plan A Task A10/A11)。复用它们;若没有现成的「收集若干帧」helper,就近实现一个等待 N 帧 / 超时的小工具。DO 处理 awareness 是异步的,用 `vi.waitFor` 等待。`payload` 用任意字节即可 —— DO 把 awareness payload 当**不透明字节**存储转发,不解码。

Run: `pnpm test:workers TimelineDoc` — 新用例 FAIL。

- [ ] **Step 3: 实现** —— `src/workers/durable/TimelineDoc.ts`:

(a) `SocketAttachment` 接口加字段:

```typescript
  /** 该连接最近一帧 awareness payload(不透明字节,存为普通数组以可序列化) */
  lastAwareness?: number[]
```

(b) `dispatch` 里 `MSG.AWARENESS` 分支:在 `broadcast` 之前,把 payload 存进发送方 ws 的 attachment。当前形如:

```typescript
if (type === MSG.AWARENESS) {
  this.broadcast(ws, frame)
  return
}
```

改为:

```typescript
if (type === MSG.AWARENESS) {
  const att = ws.deserializeAttachment() as SocketAttachment
  ws.serializeAttachment({ ...att, lastAwareness: Array.from(payload) })
  this.broadcast(ws, frame)
  return
}
```

> `frame` / `payload` 的取得沿用该分支现有写法(`frame` 是整帧、`payload` 是去掉类型字节的部分)。若现有代码只有 `frame`,用 `decodeMessage` 取 `payload`,或直接 `frame.slice(1)`。

(c) `handleAuth` 里,鉴权通过、发出 `AUTH_OK` 之后,补发其他连接的 awareness 快照:

```typescript
// 把已在线连接的最近 awareness 补发给新连接,使其立刻看到全员
for (const peer of this.ctx.getWebSockets()) {
  if (peer === ws) continue
  const peerAtt = peer.deserializeAttachment() as SocketAttachment | null
  if (peerAtt?.authed && peerAtt.lastAwareness && peerAtt.lastAwareness.length > 0) {
    ws.send(encodeMessage(MSG.AWARENESS, new Uint8Array(peerAtt.lastAwareness)))
  }
}
```

放在 `AUTH_OK` send 之后。`encodeMessage` 已在文件 import。

> 注:`lastAwareness` 存进 `serializeAttachment` → 持久化、扛 hibernation(awareness spec §4)。断开清理不做服务端显式移除 —— 关闭的 ws 不在 `getWebSockets()` 里,不会被补发;对端靠 `y-protocols/awareness` 30s 超时清理(spec §4)。

- [ ] **Step 4: 跑测试**

Run: `pnpm test:workers TimelineDoc` — PASS。Run: `pnpm test:workers` — 全绿。Run: `pnpm tsc -b --noEmit` — 0 error。

- [ ] **Step 5: Commit**

```bash
git add src/workers/durable/TimelineDoc.ts src/workers/durable/TimelineDoc.workers.test.ts
git commit -m "feat(collab): durable object awareness snapshot on join"
```

---

## Task C5: timelineStore —— peers 投影 + 本地写入器

`timelineStore` 把他人 awareness 投影成响应式 `peers`;新增本地写入器设置 `user` / `selection` / `cursorTime` / `dragging`。

**Files:**

- Modify: `src/store/timelineStore.ts`

- [ ] **Step 1: imports 与接口**

(a) import 加:

```typescript
import type { PeerState, AwarenessState } from '@/collab/awarenessTypes'
import { colorForUser, displayName } from '@/collab/awarenessIdentity'
```

(b) `TimelineState` 接口加字段与方法:

```typescript
  /** 其他协作者的 awareness(已排除自身);非 editor 模式恒为空 */
  peers: PeerState[]
  /** 设本地悬停光标时间(秒);离开画布传 null */
  setLocalCursor: (time: number | null) => void
  /** 设本地拖动 ghost;拖动结束传 null */
  setLocalDragging: (dragging: AwarenessState['dragging']) => void
```

`initialUiState` 加 `peers: [] as PeerState[]`。

- [ ] **Step 2: peers 投影 + 本地 user 初始化**

在 `create<TimelineState>()((set, get) => {` 内、`wireRemote` 附近,加投影 helper:

```typescript
/** 把 awareness.getStates() 投影成 peers(排除自身) */
const reprojectPeers = (engine: SyncEngine) => {
  const { awareness } = engine
  const self = awareness.clientID
  const peers: PeerState[] = []
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === self) continue
    const s = state as Partial<AwarenessState>
    if (!s.user) continue // 尚未设 user 的连接跳过
    peers.push({
      clientId,
      user: s.user,
      selection: s.selection ?? { eventId: null, castEventId: null },
      cursorTime: s.cursorTime ?? null,
      dragging: s.dragging ?? null,
    })
  }
  set({ peers })
}
```

`wireRemote(engine)` 里,在 `engine.connectRemote(...)` 之后加:

```typescript
// 设本地 awareness user(昵称 + 颜色),并订阅 peers 变化
const auth = useAuthStore.getState()
const uid = auth.userId ?? ''
engine.awareness.setLocalStateField('user', {
  id: uid,
  name: displayName(auth.username, uid),
  color: colorForUser(uid),
})
engine.awareness.setLocalStateField('selection', { eventId: null, castEventId: null })
engine.awareness.setLocalStateField('cursorTime', null)
engine.awareness.setLocalStateField('dragging', null)
const onPeersChange = () => reprojectPeers(engine)
engine.awareness.on('change', onPeersChange)
reprojectPeers(engine)
```

> `onPeersChange` 需要在引擎销毁时 `off`。最简做法:把它挂到一个模块级 `let peersUnsub: (() => void) | null`,在 `openTimeline` 切换引擎、`reset`、`setViewerSnapshot` 销毁旧引擎处调用并清空。实现者:在现有「销毁旧引擎」的每一处(`openTimeline` 开头、`reset`、`setViewerSnapshot`)补 `peersUnsub?.(); peersUnsub = null`,并在上面注册后 `peersUnsub = () => engine.awareness.off('change', onPeersChange)`。同时这些销毁处 `set({ peers: [] })`。

- [ ] **Step 3: 本地写入器**

store actions 加:

```typescript
    setLocalCursor: time => {
      const engine = get().engine
      if (!engine) return
      engine.awareness.setLocalStateField('cursorTime', time)
    },

    setLocalDragging: dragging => {
      const engine = get().engine
      if (!engine) return
      engine.awareness.setLocalStateField('dragging', dragging)
    },
```

`selectEvent` / `selectCastEvent` —— 在其现有 `set({ ... })` 之后顺带写 awareness。`selectEvent` 现状形如:

```typescript
    selectEvent: eventId => set({ selectedEventId: eventId, selectedCastEventId: null }),
```

改为:

```typescript
    selectEvent: eventId => {
      set({ selectedEventId: eventId, selectedCastEventId: null })
      get().engine?.awareness.setLocalStateField('selection', {
        eventId,
        castEventId: null,
      })
    },
```

`selectCastEvent` 同理(`{ eventId: null, castEventId }`)。

> `viewer`/`local` 模式:`viewer` 无 `engine` → 写入器 no-op、`peers` 空。`local` 模式有 engine + awareness 但无 remote、无 peer → 写入器写本地 awareness 无害,`peers` 恒空(无人连入)。符合 spec §3.3。

- [ ] **Step 4: 类型检查 + 测试**

Run: `pnpm tsc -b --noEmit` — 0 error。
Run: `pnpm test:run timelineStore` — 若有 store 测试,补一个 `peers` 投影用例(构造一个带两个 client state 的 `Awareness`,断言投影排除自身);否则跳过。
Run: `pnpm test:run` — 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/store/timelineStore.ts
git commit -m "feat(collab): timelineStore peers projection and local awareness writers"
```

---

## Task C6: PresenceAvatars —— header 在线成员

**Files:**

- Create: `src/components/PresenceAvatars.tsx`
- Modify: `src/pages/EditorPage.tsx`

- [ ] **Step 1: 实现 PresenceAvatars** —— `src/components/PresenceAvatars.tsx`:

行为(awareness spec §5.1):

- 读 `useTimelineStore` 的 `peers` 与 `connectionStatus`。
- `peers` 按 `user.id` 去重 —— 同一 `user.id` 多个 `clientId` 只显示一个头像(取数组里最后一个,即最新)。
- 每人一个彩色圆形头像:背景 `user.color`,内显昵称首字符(`user.name` 为空兜底已在 `displayName` 处理,正常非空);`title={user.name}`(hover 显示昵称)。
- 连接状态:`connectionStatus !== 'connected'` 时,整个头像组 `opacity-50` 并在末尾显示一个灰点 + 文案「重连中…」;`connected` 时不显示状态文案(可显示一个绿点或不显示)。
- `peers` 为空且 `connected` 时整体不渲染(`return null`)—— `local`/`viewer` 模式自然为空。

```tsx
import { useTimelineStore } from '@/store/timelineStore'
import type { PeerState } from '@/collab/awarenessTypes'

/** 按 user.id 去重,保留最后出现的(最新 clientId) */
function dedupeByUser(peers: PeerState[]): PeerState[] {
  const byUser = new Map<string, PeerState>()
  for (const p of peers) byUser.set(p.user.id, p)
  return [...byUser.values()]
}

export default function PresenceAvatars() {
  const peers = useTimelineStore(s => s.peers)
  const connectionStatus = useTimelineStore(s => s.connectionStatus)
  const isPublished = useTimelineStore(s => s.isPublished)

  // 仅 editor 模式(已发布且有引擎远端)才可能有 peers;非发布态直接不渲染
  if (!isPublished) return null
  const people = dedupeByUser(peers)
  if (people.length === 0 && connectionStatus === 'connected') return null

  const reconnecting = connectionStatus !== 'connected'

  return (
    <div className="flex items-center gap-1.5" title={reconnecting ? '重连中…' : undefined}>
      <div className={`flex -space-x-1.5 ${reconnecting ? 'opacity-50' : ''}`}>
        {people.map(p => (
          <div
            key={p.user.id}
            title={p.user.name}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-background text-[10px] font-medium text-white"
            style={{ backgroundColor: p.user.color }}
          >
            {p.user.name.slice(0, 1)}
          </div>
        ))}
      </div>
      {reconnecting && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          重连中…
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 挂进 EditorPage header**

`src/pages/EditorPage.tsx`:import `PresenceAvatars`,在 header 右侧 `<div className="ml-auto"><ThemeToggle /></div>` 处,把 `PresenceAvatars` 放在 `ThemeToggle` 左侧:

```tsx
<div className="ml-auto flex items-center gap-3">
  <PresenceAvatars />
  <ThemeToggle />
</div>
```

- [ ] **Step 3: 校验**

Run: `pnpm tsc -b --noEmit` — 0 error。Run: `pnpm lint` — 0 error。Run: `pnpm build` — 成功。

- [ ] **Step 4: Commit**

```bash
git add src/components/PresenceAvatars.tsx src/pages/EditorPage.tsx
git commit -m "feat(collab): header presence avatars with connection status"
```

---

## Task C7: 画布 PeerOverlay —— 选中高亮 + 悬停光标

**画布坐标速查(来自画布探查):**

- 时间→x:`x = time * zoomLevel`(画布空间;overlay 层已 `x={-scrollLeft}`,子节点用画布空间坐标)。
- 伤害事件卡:`x = event.time * zoomLevel`,`y = 30 + row*36 + 18`(`row` 来自 `layoutData.damageEventRowMap`)。卡尺寸 150×30,在 **fixed stage** 的 `fixedOverlayLayerRef`。
- cast / skill-track 行:`x = timestamp * zoomLevel`,`y = trackIndex*40 + 20`,在 **main stage** 的 `mainOverlayLayerRef`。`trackIndex` 来自 `skillTracks` 数组下标(按 `playerId` + action 归属)。
- 两个 overlay 层(`fixedOverlayLayerRef` / `mainOverlayLayerRef`)**已存在**、`listening={false}`、已用于 crosshair —— peer overlay 渲染进这两层。
- 自身选中态用蓝 `#3b82f6` / 绿 `#10b981`;peer 用 `COLOR_PALETTE`(已避开)。

**Files:**

- Create: `src/components/Timeline/PeerOverlay.tsx`
- Modify: `src/components/Timeline/index.tsx`

- [ ] **Step 1: 实现 PeerOverlay** —— 一个 React-Konva 组件,渲染一组 `<Group>` 进 overlay 层。它接收定位所需的上下文 props(`zoomLevel`、行/轨道映射、`yOffset` 等),从 `useTimelineStore` 读 `peers`。

`PeerOverlay` 渲染**两个区域**,实际拆成两个导出或一个组件按 `area` prop 渲染 —— 推荐两个具名导出 `PeerOverlayFixed`(伤害区)与 `PeerOverlayMain`(技能轨区),分别挂进对应 overlay 层。每个渲染:

**(a) 选中高亮**:对每个 `peer`,若 `peer.selection.eventId` 命中某伤害事件 → 在该事件卡矩形外画 `<Rect>` 描边(`stroke={peer.user.color}`、`strokeWidth=2`、`listening={false}`、`perfectDrawEnabled={false}`)+ 一个 `<Text>` 名字标签(`peer.user.name`,小字号,`fill={peer.user.color}`)置于卡上方。`castEventId` 命中 cast → 同理在 cast icon 外描边。多 peer 命中同一对象时名字标签按 index 纵向错开(`y - 12*labelIndex`)。

**(b) 悬停光标**:对每个 `peer.cursorTime != null` 的 peer,画一条 `<Line>` 竖线(`x = cursorTime*zoomLevel`,贯穿该区高度,`stroke={peer.user.color}`,`listening={false}`)+ 顶部 `<Text>` 名字标签。

定位用上面的坐标速查。伤害事件 row 用 `index.tsx` 已算好的 `layoutData.damageEventRowMap`;cast 的 `trackIndex` 用 `skillTracks` 查找该 castEvent 所属轨道(`index.tsx` 已有按 castEvent 找轨道的逻辑可复用 / 提取)。

> 实现者:`PeerOverlay` 的精确 props 由 `index.tsx` 现有的 crosshair / 事件渲染上下文决定。原则:**复用 `index.tsx` 已计算的 `layoutData`、`skillTracks`、`zoomLevel`**,以 props 传入,不在 overlay 内重算。overlay 内所有 Konva 节点 `listening={false}`、`perfectDrawEnabled={false}`(项目 Konva 规范)。若某 peer 的 selection 指向的事件已被删除 / 不在当前过滤视图 → 查不到 → 该项不渲染(自愈)。

- [ ] **Step 2: 挂进 index.tsx 的 overlay 层 + 接悬停光标上报**

`src/components/Timeline/index.tsx`:

(a) 在 `fixedOverlayLayerRef` 的 `<Layer>` 内,crosshair 节点旁,渲染 `<PeerOverlayFixed ...props />`;在 `mainOverlayLayerRef` 的 `<Layer>` 内渲染 `<PeerOverlayMain ...props />`。

(b) **悬停光标上报**:画布已有 pointer move 处理(计算 crosshair 的那段,`time = (pointerX + scrollLeft) / zoomLevel`)。在那里**节流 ~50ms**调用 `useTimelineStore.getState().setLocalCursor(time)`。节流用一个 `useRef` 存上次发送时间戳的小工具,或 `lodash`/项目已有节流(查 `src/utils`,无则就近写一个 50ms 节流)。
画布容器 `mouseleave`(及 `window` blur)→ **立即**(取消未决节流)`setLocalCursor(null)`。

> 实现者:`setLocalCursor` 走 `getState()` 直接调用,不要订阅式读取,避免 re-render。节流确保高频 mousemove 不淹没 awareness。

- [ ] **Step 3: 校验**

Run: `pnpm tsc -b --noEmit` — 0 error。Run: `pnpm lint` — 0 error。Run: `pnpm build` — 成功。Run: `pnpm test:run` — 全绿(画布无单测,回归即可)。

- [ ] **Step 4: Commit**

```bash
git add src/components/Timeline/PeerOverlay.tsx src/components/Timeline/index.tsx
git commit -m "feat(collab): canvas peer selection highlight and hover cursor"
```

---

## Task C8: 画布拖动 ghost

**Files:**

- Modify: `src/components/Timeline/PeerOverlay.tsx`
- Modify: `src/components/Timeline/index.tsx`
- (按需)`src/components/Timeline/DamageEventCard.tsx` / `CastEventIcon.tsx` / `AnnotationIcon.tsx`

- [ ] **Step 1: 本地拖动上报 `setLocalDragging`**

`src/components/Timeline/index.tsx` 已有三类拖动回调:

- 伤害事件:`onDragStart(eventId, x)` / `onDragMove(eventId, x)` / `onDragEnd(x)`。
- cast:经 `SkillTracksCanvas` 的 `onDragStart`(`setDraggingId`)+ `CastEventIcon` `onDragEnd(x)`。
- 注释:`AnnotationIcon` `onDragStart` / `onDragEnd(newCenterX)`。

为每类拖动接 `setLocalDragging`:

- **drag start / move**:`useTimelineStore.getState().setLocalDragging({ id, kind, time, playerId })`,其中 `time = x / zoomLevel`(注意 clamp 与既有逻辑一致),`kind` ∈ `'damage'|'cast'|'annotation'`,`playerId`:cast 为目标轨道玩家、damage/annotation 为 `null`。**move 节流 ~50ms**。
- **drag end**:**先**走既有的 `updateDamageEvent`/`updateCastEvent`/`updateAnnotation` 提交(Y.Doc),**再** `setLocalDragging(null)`(awareness spec §5.4 约束 1:先提交 Y.Doc 再清 dragging)。

> 实现者:cast 的拖动 move 中途位置 —— `CastEventIcon` 目前只在 drag-end 报位置;为支持实时 ghost 需要 cast 也在 `onDragMove` 上报。给 `CastEventIcon` 加一个 `onDragMove?` 透传(Konva `onDragMove` 事件 → 取 `e.target.x()` → 回调),`index.tsx` 接它做节流 `setLocalDragging`。伤害事件已有 `onDragMove`,直接接。注释 `AnnotationIcon` 同样按需加 `onDragMove?`。保持各自既有 `dragBoundFunc` / clamp 不变。

- [ ] **Step 2: PeerOverlay 渲染 ghost**

在 `PeerOverlay`(C7 建的)里加拖动 ghost:对每个 `peer.dragging != null` 的 peer:

- 在 `peer.dragging.time * zoomLevel` 处(cast 还要按 `playerId` → `trackIndex` 定 y;damage 用 `dragging.id` 的 row;annotation 用其轨道)渲染一个**半透明**(`opacity≈0.55`)该对象的简化形状 ghost,描边 `peer.user.color` + 名字标签。
  - damage ghost:150×30 圆角 Rect。
  - cast ghost:30×30 图标位 Rect(可不画 CD 条)。
  - annotation ghost:小气泡 Rect / 复用 `AnnotationIcon` 的形状。
    ghost 形状可简化(不必像素级复刻),位置必须准确。
- **ghost 生命周期**:ghost 在 `peer.dragging != null` 时渲染;peer `drop` 时发 `dragging=null` → ghost 撤、原件经 Y.Doc 归位;peer 拖动中途掉线时,ghost 随该 peer 被 `outdatedTimeout`(30s)整体移除而消失。

> **对 spec §5.4 约束 2 的有意简化**:spec 原写「`dragging` 陈旧 >2s 即视为废弃」需要一个渲染定时器周期性重判(awareness `change` 事件不会在「peer 静默」时触发)。本计划简化为:中途掉线的 ghost 最多残留至 30s peer 超时 —— 与 §4「断开后 presence 残留 ≤30s」是同一套容忍度,一致且无需额外定时器。更快的 2s 清理留作未来优化。

- [ ] **Step 3: peer 拖动期间隐藏原件**

被某 peer 拖动(`dragging != null`)的对象,其**原位置实体**要隐藏(spec §5.4:只剩 ghost 在动)。做法:`index.tsx` 渲染伤害事件 / cast / 注释时,算一个 `peerDraggingIds: Set<string>`(由 `peers` 里所有 `dragging.id` 汇成),对 `peerDraggingIds` 命中的对象,渲染时 `visible={false}`(或不渲染)。`drop` 后该 peer `dragging` 清空 → 集合移除 → 实体随 Y.Doc 更新在落点出现。

> 实现者:`peerDraggingIds` 用 `useMemo` 从 `peers` 派生。注意只隐藏**他人正在拖**的;自己正在拖的对象走的是本地拖动逻辑(Konva 原生 draggable),不受此影响。

- [ ] **Step 4: 校验**

Run: `pnpm tsc -b --noEmit` — 0 error。Run: `pnpm lint` — 0 error。Run: `pnpm build` — 成功。Run: `pnpm test:run` + `pnpm test:workers` — 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/components/Timeline/PeerOverlay.tsx src/components/Timeline/index.tsx src/components/Timeline/CastEventIcon.tsx src/components/Timeline/AnnotationIcon.tsx
git commit -m "feat(collab): real-time drag ghost overlay"
```

---

## 收尾

全部 8 个 task 完成后:

- [ ] **最终全量门禁**:`pnpm test:run && pnpm test:workers && pnpm tsc -b --noEmit && pnpm lint && pnpm build` 全绿。
- [ ] **手动验证**(`pnpm dev`,两个浏览器 / 两个账号,同一已发布时间轴,均为白名单 editor):
  1. 双方 header 互见对方头像;一方关标签页,另一方头像 ~30s 后消失。
  2. 一方选中事件,另一方画布上看到彩色描边 + 名字标签。
  3. 一方在画布上移动鼠标,另一方看到彩色竖线光标;移出画布竖线消失。
  4. 一方拖动伤害事件 / cast / 注释,另一方实时看到 ghost 跟随,原件隐藏;松手后 ghost 消失、实体在落点出现。
  5. 断网一方:其 header 显示「重连中…」灰化;恢复后自动重连、双方恢复互见。
- [ ] 计划 C 完成即协同编辑三计划(A 服务端 / B 客户端整合 / C awareness)全部交付。后续仅剩「加固增量」(主 spec §13 阶段 5)与部署运维(KV namespace、`SYNC_AUTH_TOKEN`、D1 migration),均非本系列计划范围。

---

## 自查清单(规划者已核)

- **spec §2 awareness 状态** → C2(`awarenessTypes.ts`)。
- **spec §2.1 身份与颜色** → C1(`awarenessIdentity.ts`,调色板避开自身蓝/绿,昵称兜底)。
- **spec §3.1/§3.2 客户端 awareness 层** → C2(SyncEngine 持 Awareness)+ C3(RemoteConnection 收发 + 首播;自动续期靠 `Awareness` 自带 interval,无手写心跳)。
- **spec §3.3 timelineStore 投影 + 写入器** → C5。
- **spec §4 服务端快照下发** → C4(attachment 存 `lastAwareness` + 鉴权后补发;断开靠 30s 超时)。
- **spec §5.1 header 在线成员 + 连接状态** → C6。
- **spec §5.2 选中高亮 + §5.3 悬停光标** → C7。
- **spec §5.4 拖动 ghost(隐藏原件 + 两约束)** → C8。
- **类型一致性**:`AwarenessState`/`PeerState`(C2 起)、`RemoteConnection` 构造增 `Awareness` 参(C2 声明 / C3 实现,合一 commit)、`setLocalCursor`/`setLocalDragging`/`peers`(C5)。
- **中间态**:C2 单独不可编译(`RemoteConnection` 参数数),与 C3 合为一个 commit;其余每 task 提交时 `tsc -b` 均绿。
