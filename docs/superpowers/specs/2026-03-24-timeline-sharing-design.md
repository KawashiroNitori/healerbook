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

上传到服务器的数据为完整 `Timeline` 对象（不含 `statusEvents`），加上服务端附加元数据：

```typescript
interface SharedTimeline {
  // 来自本地 Timeline 的字段
  id: string // 服务器颁发的 nanoid（21位字母数字）
  name: string
  description?: string
  fflogsSource?: { reportCode: string; fightId: number }
  encounter: Encounter
  composition: Composition
  phases: Phase[]
  damageEvents: DamageEvent[]
  castEvents: CastEvent[]
  // statusEvents 不上传（编辑器运行时状态，对只读查看者无意义）

  // 服务端附加元数据
  authorId: string // FFLogs 用户 ID（从 OAuth token 解析）
  authorName: string // FFLogs 用户名（用于页面展示）
  publishedAt: number // 首次发布时间（Unix timestamp，秒）
  updatedAt: number // 最新发布时间（Unix timestamp，秒）
  version: number // 从 1 开始，每次保存递增（不对用户展示）
}
```

### 本地 Timeline 类型变更

```typescript
interface Timeline {
  // 原有字段（时间类型从 ISO string 改为 Unix timestamp）
  createdAt: number // Unix timestamp（秒）
  updatedAt: number // Unix timestamp（秒）

  // 新增分享状态字段
  isShared: boolean // 是否已发布到服务器
  sharedAt?: number // 上次发布到服务器的时间（Unix timestamp，秒）
}
```

> 注：`createdAt` / `updatedAt` 从 ISO string 改为 Unix timestamp number，不做旧数据迁移。

### KV 存储键

```
timeline:{id}       → SharedTimeline JSON（完整数据，公开查看用）
timeline-meta:{id}  → 轻量元数据（权限检查用）
```

---

## 二、API 接口

### 新增 Worker 端点

| 方法 | 路径                 | 鉴权         | 说明                   |
| ---- | -------------------- | ------------ | ---------------------- |
| POST | `/api/timelines`     | FFLogs token | 首次发布时间轴         |
| PUT  | `/api/timelines/:id` | FFLogs token | 更新已发布时间轴       |
| GET  | `/api/timelines/:id` | 无需         | 获取分享时间轴（公开） |

### POST /api/timelines

- 请求体：本地 `Timeline` 对象（不含 `statusEvents`）
- 服务器生成新 nanoid 作为 ID，记录 `authorId`（来自 token）
- 响应：
  ```json
  { "id": "<服务器颁发的nanoid>", "publishedAt": 1742780000, "version": 1 }
  ```
- 客户端收到后：将本地时间轴 ID 替换为服务器 ID，更新 localStorage key

### PUT /api/timelines/:id

- 服务器验证 token 中用户 ID 与 `timeline-meta:{id}.authorId` 一致，否则返回 403
- 请求体：同 POST
- 响应：
  ```json
  { "id": "<id>", "updatedAt": 1742780000, "version": 2 }
  ```

### GET /api/timelines/:id

- 无需鉴权，返回完整 `SharedTimeline`
- 不存在返回 404

---

## 三、客户端交互

### "分享"按钮状态

编辑器工具栏新增"分享"按钮：

| 场景                      | 按钮样式                             |
| ------------------------- | ------------------------------------ |
| 未发布                    | "分享"（普通）                       |
| 已发布 + 无本地变更       | "分享"（普通）                       |
| 已发布 + 有本地变更       | "分享 ●"（带标记，提示有未同步变更） |
| 非作者 / 未登录访问编辑器 | 不显示"分享"按钮                     |

**判断"有本地变更"**：`timeline.updatedAt > timeline.sharedAt`

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
│         [发布分享]          │
└─────────────────────────────┘
```

**状态 3：已登录，已发布（作者）**

```
┌──────────────────────────────────┐
│ xivhealer.com/timeline/xxx  [复制]│
│                                  │
│ ● 有未发布的本地修改（有变更时显示）│
│         [保存更新]               │  ← 有变更时高亮，无变更时禁用
└──────────────────────────────────┘
```

---

## 四、路由与页面

### 路由结构

```
/                    首页（时间轴列表，本地数据）
/editor/:id          编辑器（本地时间轴）
/timeline/:id        只读查看页（从服务器加载）
```

### `/timeline/:id` 页面逻辑

```
加载时
  └─ GET /api/timelines/:id
       ├─ 404  → 显示"时间轴不存在或已删除"
       └─ 成功
            ├─ 是作者（已登录且 authorId 匹配）
            │    ├─ 本地有此 ID → 直接跳转 /editor/:id
            │    └─ 本地无此 ID → 静默写入 localStorage（保留原 ID，isShared=true，sharedAt=publishedAt）
            │                    → 跳转 /editor/:id
            └─ 非作者 / 未登录 → 渲染只读时间轴 + "在本地创建副本"按钮
```

### 只读时间轴页面

- Canvas 禁用拖拽和编辑操作
- 标题和 description 字段禁止编辑
- 显示作者名、发布时间

### "在本地创建副本"流程（非作者）

1. 写入 localStorage，生成新的本地 nanoid（不继承服务器 ID）
2. `isShared = false`，不继承 `sharedAt`
3. 副本名称默认为原名称 + `（副本）`
4. 跳转 `/editor/:newId`

---

## 五、约束与边界

- `statusEvents` 不上传服务器（编辑器运行时状态）
- 时间类型统一使用 Unix timestamp（秒级 number），不做旧数据迁移
- 服务器颁发的 ID 格式与本地 nanoid 一致（21位字母数字）
- 分享链接始终指向最新发布版本，无历史版本
- 撤销分享功能不在本期范围内
