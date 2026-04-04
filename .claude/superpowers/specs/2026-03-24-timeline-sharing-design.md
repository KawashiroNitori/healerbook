# 时间轴分享功能设计文档

**日期**: 2026-03-24
**分支**: feat/share-timeline
**状态**: 已确认

---

## 概述

允许用户将本地时间轴发布到服务器，生成公开分享链接。其他人可通过链接查看只读时间轴或在本地创建副本。只有作者（通过 FFLogs OAuth 认证）才能编辑和更新已发布的时间轴。

---

## 一、数据格式与服务端存储

### 上传内容

上传到服务器的数据为完整 `Timeline` 对象（不含 `statusEvents`、`isShared`、`hasLocalChanges`、`serverVersion`、`isReplayMode`），加上服务端附加元数据：

```typescript
type SharedTimeline = Omit<
  Timeline,
  'statusEvents' | 'isShared' | 'hasLocalChanges' | 'serverVersion' | 'isReplayMode'
> & {
  // 服务端附加元数据（authorId 不对外暴露，由 Worker 服务端计算 isAuthor 后返回）
  authorId: string // FFLogs 用户 ID（从 JWT sub 字段解析，仅存于 KV，不随 GET 响应返回）
  authorName: string // FFLogs 用户名（每次 PUT 时用当前 JWT name 覆盖）
  publishedAt: number // 首次发布时间（Unix timestamp，秒）
  updatedAt: number // 最新发布时间（Unix timestamp，秒）
  version: number // 从 1 开始，每次保存递增（内部用，不对用户展示）
}
```

GET 响应的公开类型（客户端可见）：

```typescript
type PublicSharedTimeline = Omit<SharedTimeline, 'authorId'> & {
  isAuthor: boolean // Worker 服务端比对 JWT sub 与 authorId 后计算，无 token 时为 false
}
```

### 本地 Timeline 类型变更

```typescript
interface Timeline {
  // 时间类型从 ISO string 改为 Unix timestamp（breaking change，不做旧数据迁移）
  createdAt: number // Unix timestamp（秒）
  updatedAt: number // Unix timestamp（秒），由客户端时钟写入

  // 新增分享状态字段（新建时间轴初始值：isShared=false，hasLocalChanges=false，serverVersion 不存在）
  isShared: boolean // 是否已发布到服务器
  hasLocalChanges: boolean // 发布后是否有本地未发布的修改；发布成功后重置为 false
  serverVersion?: number // 最后一次与服务器同步的版本号（用于冲突检测）

  isReplayMode?: boolean // 保留字段，分享时不上传
}
```

> **Breaking change**：`createdAt` / `updatedAt` 从 ISO string 改为 Unix timestamp number，`timelineStorage.ts` 中所有生成时间戳的地方统一改为 `Math.floor(Date.now() / 1000)`，`TimelineMetadata` 接口同步更新，首页排序改为数字比较，`saveTimeline` 中的 `updatedAt` 直接使用 `timeline.updatedAt` 而非独立生成。不做旧数据迁移，旧数据排序结果不确定，属于可接受限制。

### authStore 变更

`authStore` 新增 `userId` 字段，`setTokens` 签名同步更新：

```typescript
interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  username: string | null
  userId: string | null // 新增：FFLogs 用户 ID（与 JWT sub 一致）
  setTokens: (accessToken: string, refreshToken: string, username: string, userId: string) => void
  clearTokens: () => void // 一并清除 userId
}
```

`auth.ts` 的 `handleAuthCallback` 响应同步新增 `user_id` 字段：

```json
{ "access_token": "...", "refresh_token": "...", "name": "...", "user_id": "123456" }
```

### KV 存储键

```
timeline:{id}  → SharedTimeline JSON（含 authorId，单一 key，公开查看和权限检查均使用此 key）
```

> 使用单一 KV key，避免免费计划下双写消耗两次写操作配额。KV 单条 value 上限为 25MB，本期不做上传大小校验。

---

## 二、API 接口

### 新增 Worker 端点

| 方法 | 路径                 | 鉴权            | 说明                   |
| ---- | -------------------- | --------------- | ---------------------- |
| POST | `/api/timelines`     | Bearer JWT      | 首次发布时间轴         |
| PUT  | `/api/timelines/:id` | Bearer JWT      | 更新已发布时间轴       |
| GET  | `/api/timelines/:id` | 可选 Bearer JWT | 获取分享时间轴（公开） |

### POST /api/timelines

- 请求体：本地 `Timeline` 对象（不含 `statusEvents`、`isShared`、`hasLocalChanges`、`serverVersion`、`isReplayMode`）
- Worker 从 JWT `sub` 取 `authorId`，`name` 取 `authorName`，生成新 nanoid 作为 ID
- 写入 `timeline:{id}`
- 响应：
  ```json
  { "id": "<服务器颁发的nanoid>", "publishedAt": 1742780000, "version": 1 }
  ```
- 客户端收到响应后（顺序重要，避免重复发布）：
  1. 更新元数据列表中的条目 ID 为新 ID，设 `isShared=true`、`hasLocalChanges=false`、`serverVersion=1`
  2. 以新 ID 写入 `healerbook_timelines_<newId>`
  3. 删除旧 `healerbook_timelines_<oldId>`
  - 步骤 1 先执行，确保首页看到的始终是新 ID；若后续步骤崩溃，旧 key 残留为可接受的冗余数据

### PUT /api/timelines/:id

- 请求体：同 POST，另附 `expectedVersion` 字段（可选，不传则为强制覆写）：
  ```json
  { ...timeline数据, "expectedVersion": 1 }
  ```
- Worker 鉴权：读取 `timeline:{id}.authorId`，与 JWT `sub` 不符返回 403
- Worker 冲突检测（乐观锁）：若 `expectedVersion` 存在且 `timeline.version !== expectedVersion`，返回 409：
  ```json
  { "error": "conflict", "serverVersion": 2, "serverUpdatedAt": 1742780100 }
  ```
- 正常响应（无冲突或强制覆写）：
  ```json
  { "id": "<id>", "updatedAt": 1742780000, "version": 2 }
  ```
- 客户端成功后：`hasLocalChanges=false`，`serverVersion` 更新为响应中的 `version`

### GET /api/timelines/:id

- 可选接受 Bearer JWT；若 token 有效，Worker 比对 `sub` 与 `authorId`，计算 `isAuthor`
- 返回 `PublicSharedTimeline`（不含 `authorId`，含 `isAuthor: boolean`）
- 不存在返回 404；网络/5xx 错误由客户端显示通用错误提示 + 重试按钮

---

## 三、客户端交互

### hasLocalChanges 生命周期

- **置为 true**：任何编辑操作触发自动保存时（在 `triggerAutoSave` 中设置）
- **置为 false**：POST 或 PUT 成功响应后

### "分享"按钮状态

编辑器工具栏新增"分享"按钮：

| 场景                      | 按钮样式                             |
| ------------------------- | ------------------------------------ |
| 未发布                    | "分享"（普通）                       |
| 已发布 + 无本地变更       | "分享"（普通）                       |
| 已发布 + 有本地变更       | "分享 ●"（带标记，提示有未同步变更） |
| 非作者 / 未登录访问编辑器 | 不显示"分享"按钮                     |

**判断"有本地变更"**：`timeline.isShared && timeline.hasLocalChanges`

### "分享" Popover 三种状态

**状态 1：未登录**

```
┌─────────────────────────────┐
│ 需要登录才能分享时间轴        │
│                             │
│      [登录 FFLogs]          │
└─────────────────────────────┘
```

**状态 2：已登录，未发布**

```
┌─────────────────────────────┐
│ 分享后任何人可通过链接查看    │
│ 仅你可以编辑和更新           │
│                             │
│         [发布分享]          │  ← 点击后进入 loading 态，禁止重复点击
└─────────────────────────────┘
```

**状态 3：已登录，已发布（作者）**

```
┌──────────────────────────────────┐
│ xivhealer.com/timeline/xxx  [复制]│
│                                  │
│ ● 有未发布的本地修改（有变更时显示）│
│         [保存更新]               │  ← hasLocalChanges=true 时高亮；点击后进入 loading 态，禁止重复点击；无变更时禁用
└──────────────────────────────────┘
```

> **发布分享** 和 **保存更新** 按钮点击后立即进入 loading 态（显示加载指示器），在请求完成（成功、失败或冲突）之前禁止点击，防止重复提交。

### 冲突解决对话框（PUT 返回 409 时弹出）

```
┌──────────────────────────────────────┐
│ 服务器上的版本已被更新（另一设备）    │
│                                      │
│ 本地版本：最后编辑于 xx:xx           │
│ 服务器版本：更新于 xx:xx             │
│                                      │
│  [保留本地版本]    [使用服务器版本]   │
└──────────────────────────────────────┘
```

- 本地版本时间取 `timeline.updatedAt`，服务器版本时间取 409 响应体中的 `serverUpdatedAt`
- **保留本地版本**：不带 `expectedVersion` 重新发起 PUT（强制覆写），成功后 `hasLocalChanges=false`
- **使用服务器版本**：GET 最新服务器数据，覆盖本地，`hasLocalChanges=false`，`serverVersion` 更新
- 两个选项点击后同样进入 loading 态，禁止重复点击

---

## 四、路由与页面

### 路由结构

```
/                    首页（时间轴列表，本地数据）
/editor/:id          编辑器（本地时间轴）
/timeline/:id        只读查看页（从服务器加载）
```

### `/timeline/:id` 页面逻辑

**"是作者"判断**：使用 GET 响应中的 `isAuthor` 字段（由 Worker 服务端计算）

```
加载时
  └─ GET /api/timelines/:id（携带 Bearer JWT，若已登录）
       ├─ 404         → 显示"时间轴不存在或已删除"
       ├─ 网络/5xx错误 → 显示通用错误提示 + 重试按钮
       └─ 成功
            ├─ isAuthor=true
            │    ├─ 本地有此 ID → 直接跳转 /editor/:id
            │    └─ 本地无此 ID → 写入 localStorage（保留原 ID，isShared=true，hasLocalChanges=false，
            │                      serverVersion=sharedTimeline.version）
            │                    → 显示 toast "已从服务器恢复此时间轴"
            │                    → 跳转 /editor/:id
            └─ isAuthor=false → 渲染只读时间轴 + "在本地创建副本"按钮
```

**Token 过期处理**：token 有效性校验下沉到 PUT 请求，失效时由现有 token 刷新机制处理。

### 只读时间轴页面

- Canvas 禁用拖拽和编辑操作，不进入回放模式（忽略 `isReplayMode` 字段）
- 标题和 description 字段禁止编辑
- 显示作者名、发布时间

### "在本地创建副本"流程（非作者）

1. 写入 localStorage，生成新的本地 nanoid，`updatedAt = Math.floor(Date.now() / 1000)`
2. `isShared = false`，`hasLocalChanges = false`，不继承 `serverVersion`
3. 副本名称默认为原名称 + `（副本）`
4. 跳转 `/editor/:newId`

---

## 五、约束与边界

- `statusEvents`、`isShared`、`hasLocalChanges`、`serverVersion`、`isReplayMode` 不上传服务器
- `authorId` 仅存于 KV，不随 GET 响应暴露；客户端通过 `isAuthor` 字段判断身份
- 时间类型统一使用 Unix timestamp（秒级 number），不做旧数据迁移；旧数据排序结果不确定，属于可接受限制
- 服务器颁发的 ID 格式与本地 nanoid 一致（21位字母数字）
- 分享链接始终指向最新发布版本，无历史版本
- 分享链接永久有效，撤销分享功能不在本期范围内
- `version` 字段内部追踪，不对用户展示；KV 无原子 CAS，并发写入可能导致 version 不严格单调，属于可接受的已知限制
- 作者通过分享链接进入编辑器（本地有此 ID）时，不检查服务器版本是否更新，可能编辑过时数据；点击"保存更新"时 409 冲突对话框会介入修正，属于已知体验限制
- 首页时间轴卡片不展示分享状态徽标（不在本期范围内）
