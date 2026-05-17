# 协作编辑加固增量 — 设计

> 日期：2026-05-17
> 状态：已批准，待写实现 plan

## 背景

实时协作编辑（Plan A 服务端 / Plan B 客户端集成 / Plan C awareness）已完整落地。
本增量收口三处在 review / 设计阶段识别出的健壮性与代码质量缺口，**不引入新功能**。

加固候选共 5 项，本次经确认仅纳入 3 项：

| 候选项                       | 本次纳入 | 说明                            |
| ---------------------------- | -------- | ------------------------------- |
| WS token 过期续期            | ✅       | 见 §1                           |
| 鉴权失败终态断开             | ✅       | 见 §2                           |
| PeerOverlay 冗余强转清理     | ✅       | 见 §3                           |
| PUSH 限流                    | ❌       | 暂不做                          |
| 服务端断连显式移除 awareness | ❌       | 暂不做，依赖客户端 30s 超时即可 |

## 1. WS token 过期续期

### 问题

`RemoteConnection` 的构造参数 `getJwt: () => string | null` 同步读取
`authStore.accessToken` 原值。accessToken 仅 15 分钟有效；用户挂机后 WS 断线重连时，
`ws.onopen` 拿到的是已过期 token → 服务端以 close code 1008 拒绝 → `onClose`
指数退避重连 → 再次拿到同一个过期 token → **无限失败循环**。

已建立的连接不受影响——服务端只在 AUTH 握手时校验一次 token，连接存续期间不再二次校验。
因此问题面**仅限 (重)连接握手时刻**，无需会话内定时续期。

### 方案

`authStore` 已有 `getValidToken(): Promise<string | null>`——token 有效则返回原值，
过期或即将过期（30s buffer）则用 refreshToken 续期，续期失败返回 `null` 并清空 token。
将 `RemoteConnection` 的取 token 回调改成异步，直接复用它：

- 构造参数 `getJwt: () => string | null` → `getAuthToken: () => Promise<string | null>`。
- `SyncEngine.connectRemote` 的形参类型同步改为异步签名。
- `timelineStore.wireRemote` 中
  `() => useAuthStore.getState().accessToken`
  → `() => useAuthStore.getState().getValidToken()`。
- `RemoteConnection.open()` 里 `ws.onopen` 改为 `async`：
  `await this.getAuthToken()` 拿到（可能刚续期过的）token 后再发 `MSG.AUTH`。

### await 竞态防护

`ws.onopen` 变异步后，`await` 期间连接可能已被 `destroy()` 关闭或被重连流程替换。
await 返回后必须校验：`this.ws === ws && !this.closed`，否则放弃后续（不发 AUTH、不改状态）。

## 2. 鉴权失败终态断开

### 问题

即使 §1 修好续期，仍有两类「鉴权性」失败应当**停止重连**，而非静默无限重连：

1. `getAuthToken()` 返回 `null`——refreshToken 也已失效 / 未登录，连 AUTH 都发不出。
2. 服务端以 **close code 1008** 拒绝——`invalid token` / `not an editor` / `auth required`，
   这些场景重连无意义（详见服务端 `TimelineDoc.handleAuth` 与 `dispatch`）。

现状对这两类失败都会无限退避重连。

### 方案

- `ws.onclose` 回调接收事件对象，把 `ev.code` 传入 `onClose(code?: number)`。
- `onClose` 中分流：
  - `code === 1008` → **终态**：设 `this.closed = true`、`setStatus('disconnected')`、
    **不**调度重连。
  - 其他 close code（`1006` 网络异常、`1001`、`1011` 等）→ 维持现有指数退避重连。
- `ws.onopen` 中 `getAuthToken()` 返回 `null` → 同样走终态：
  设 `this.closed = true`、`setStatus('disconnected')`、`ws.close()`。
  （随后触发的 `onClose` 因 `this.closed` 已置位，不会重连。）
- 复用现有 `closed` 字段，语义扩展为「永久停止重连」——
  原本仅由 `destroy()` 置位，现在 terminal 鉴权失败也置位。
- `connectionStatus` 保持现有三态 `disconnected | connecting | connected`，
  终态失败归入 `disconnected`（`PresenceAvatars` 的灰色连接点已能表达该状态）。

### 权衡

终态断开后，用户需刷新页面 / 重新登录才能恢复连接。对「不是 editor」与「登录态彻底失效」
这两种情况这是正确行为。**不**引入手动重连按钮——属 scope 蔓延。

## 3. PeerOverlay 冗余强转清理

### 问题

`PeerOverlay.tsx` 的 `PeerOverlayMain` 中（约 403 行），在
`annotation.anchor.type === 'skillTrack'` 类型收窄之后，又写了一个
`annotation.anchor as { type: 'skillTrack'; playerId: number; actionId: number }`。

`AnnotationAnchor`（`src/types/timeline.ts:218`）本就是合法的判别联合：

```ts
export type AnnotationAnchor =
  | { type: 'damageTrack' }
  | { type: 'skillTrack'; playerId: number; actionId: number }
```

`type === 'skillTrack'` 已使 TypeScript 把 `annotation.anchor` 收窄到 `skillTrack` 变体，
该 `as` 纯属冗余。

### 方案

删除 `as` 强转，直接使用收窄后的 `annotation.anchor`。纯局部清理，无行为变化。

## 不纳入：PeerOverlay 渲染拆分

设计阶段曾考虑把 `PeerOverlayFixed` / `PeerOverlayMain` 按 peer 拆分成子组件，
以避免「任一 peer 动光标 → overlay 全量重渲染」。**经核对后决定不做**，理由：

- awareness 数据规模小（并发通常仅数人），全量重建 `nodes[]` 成本可接受。
- 关键顾虑「重渲染会不会带着时间轴本体一起重渲」**已被现有架构隔离**：
  - `useTimelineStore(s => s.peers)` 的订阅仅存在于 `PeerOverlay.tsx` 与
    `PresenceAvatars.tsx`；`Timeline/index.tsx`（本体父组件）不订阅 `s.peers`。
  - React 重渲染只向下传播。`PeerOverlay*` 因自身 Zustand 订阅触发重渲染时只重渲染自己，
    不冒泡到父组件，不波及时间轴本体。
  - `PeerOverlayMain` 虽作为 `overlayChildren` prop 传入 `SkillTracksCanvas`，
    但 peers 变化时父组件不重渲染 → 该 JSX 元素引用不变 → `SkillTracksCanvas` 不重渲染。

因此 overlay 重渲染天然隔离，拆分仅为防御性优化，本次不做。

## 影响面

| 文件                                      | 改动                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `src/collab/RemoteConnection.ts`          | 构造参数改异步；`onopen` 异步化 + 竞态防护；`onClose` 接收 close code 并分流终态 |
| `src/collab/RemoteConnection.test.ts`     | mock 取 token 回调改异步；新增续期 / 终态断开用例                                |
| `src/collab/SyncEngine.ts`                | `connectRemote` 形参类型改异步签名                                               |
| `src/store/timelineStore.ts`              | `wireRemote` 改用 `getValidToken()`                                              |
| `src/components/Timeline/PeerOverlay.tsx` | 删除冗余 `as` 强转                                                               |

**不触碰**：同步协议（`syncProtocol.ts`）、服务端 `TimelineDoc`、awareness 写入侧、
PeerOverlay 渲染结构。

## 验证

- `pnpm tsc -b --noEmit` — 0 error（注意：必须 `tsc -b`，`tsc --noEmit` 对根 solution tsconfig 是 no-op）
- `pnpm lint` — 0 error
- `pnpm test:run` — 全绿，含 `RemoteConnection.test.ts` 新增的续期与终态断开用例
- `pnpm build` — 成功
