# 时间轴协同编辑:服务端 + 编辑器整合 设计

> 本增量在「阶段 1(纯本地)」(已完成,见 `2026-05-16-timeline-collab-phase1-local.md`)之上,
> 实现协同编辑的服务端与编辑器整合。
> 架构总设计见 `2026-05-16-timeline-collaborative-sync-design.md`(下称**主 spec**)。

**状态**:设计已确认,待转实现规划。
**日期**:2026-05-16

---

## 1. 背景与范围

阶段 1 已交付:`src/collab/` Yjs 同步层(`docSchema` / `IndexedDBDocStore` / `LocalSyncEngine`)、`timelineStore` 改造为 Y.Doc 投影层、客户端一次性迁移。但 `EditorPage` / 新建流程仍走旧 localStorage 路径(经 Task 10 的兼容 shim),发布功能未接入新模型。

**本增量范围(一次做完,不再二次返工 EditorPage):**

- 服务端:Durable Object + WebSocket + 同步协议 + DO SQLite 双表 + squash + 服务端一次性迁移 —— 按**主 spec §6**。
- 鉴权:WS 首消息 `auth`、DO 验 JWT + 查 D1 白名单定角色 —— 按**主 spec §6.2**。
- 公开读 KV 缓存(独立 namespace `healerbook_snapshots`)—— 按**主 spec §7.3**。
- Awareness(在线昵称 + 选中高亮)—— 按**主 spec §6.3、§13 阶段 4**。
- **EditorPage / 新建流程 / 发布(local→cloud 升级)整合** —— 本文档第 4–9 节详述(主 spec 未细化的部分)。

**不在本增量范围(单独后续增量):** 加固 —— ID 长度运行时校验、push 限流/配额、WS 单消息大小上限、`squash` 单事务合一、投影孤儿 GC(主 spec §13 阶段 5)。

服务端 / 鉴权 / KV / awareness 的架构细节**不在本文档重复**,以主 spec §6–9 为准。本文档聚焦编辑器整合。

---

## 2. 总体数据流(整合后)

```
EditorPage 打开 timeline
   │
   ├─ 本地 IndexedDB 有且 published=false → local 模式
   │     openTimeline(id) → 引擎 N=0,纯本地
   │
   └─ published=true(或本地无、来自分享链接)
         GET /api/timelines/:id → { role, snapshot? }
         ├─ role=editor → openTimeline(id) + 引擎挂 DO remote(WS)→ N=1 实时同步
         └─ role=viewer → 用响应 snapshot 只读渲染(不连 WS)
```

发布 = 把一条 `local` 时间轴升级为 `published`:给它的 Y.Doc 挂上 DO 这个 remote peer(主 spec §3)。

---

## 3. 服务端实现要点(摘要,以主 spec §6 为准)

- **`TimelineDoc`(Durable Object)**:`idFromName(timelineId)`。内置 SQLite 双表 `snapshot` / `updates`。WebSocket Hibernation API。
- **WS 鉴权**:Worker 把 `/api/timelines/:id/connect` 的 upgrade 直接转发给 DO;DO 收第一条 `auth { jwt }` → 验签(DO 绑 `JWT_SECRET`)+ 查 D1 `timeline_editors` 定角色 → `serializeAttachment` 钉住;鉴权超时关闭。
- **同步协议**:`auth` / `load-doc { stateVector }` / `push-doc-update { update }`(viewer 角色拒绝)/ `awareness`。push 路径必须有 doc 级写权限 assert(不留主 spec 坑 2)。
- **Squash**:DO 单 alarm 槽 trailing debounce(soft 50 / hard 200),`alarm()` 内合并;按主 spec §6.4 细化版。
- **D1**:`timelines` 表退化为列表元数据(`id, name, author_id, author_name, encounter_id, published_at, updated_at`);新增 `timeline_editors(timeline_id, user_id)` 白名单表。
- **KV**:`healerbook_snapshots`,DO squash 时写投影 JSON;`GET /api/timelines/:id` 先读 KV。
- **DO 类保持极薄**,squash/协议/投影逻辑抽纯模块。

`wrangler.toml`:新增 DO 绑定 `TIMELINE_DOC` + `[[migrations]] new_sqlite_classes`、KV 绑定 `healerbook_snapshots`;`env.ts` 增对应类型;DO 需绑 `JWT_SECRET`、D1。

---

## 4. 新建流程 → 走引擎

三个新建入口都改为经引擎落盘,不再 `saveTimeline`(localStorage):

- `CreateTimelineDialog`、`ImportFFLogsDialog`、`EditorPage.handleCreateCopy`。
- 新增 `src/collab/` 辅助函数 `createLocalTimeline(content: TimelineContent): Promise<string>`:生成 id → `buildYDoc` → 写 IndexedDB(snapshot + 元数据行)→ 返回 id。
- `createNewTimeline`(`timelineStorage.ts` 的内容构造器)保留;`saveTimeline` 弃用。
- 新建出的时间轴 `published=false`,引擎 N=0。

---

## 5. EditorPage:三模式,全走引擎

`PageMode` 改为:`local` / `editor` / `viewer` / `loading` / `not_found` / `network_error`。

- **打开判定**:
  - 本地 IndexedDB 有该 id 且本地元数据 `published=false` → `local`。
  - 本地元数据 `published=true`,或本地无此 id(分享链接打开)→ `GET /api/timelines/:id` 取 `{ role, snapshot? }`。`role=editor` → `editor` 模式;`role=viewer`(含未登录)→ `viewer` 模式。
  - id 不存在(本地无 + 服务端 404)→ `not_found`。
- **`local` / `editor`**:`await store.openTimeline(id)`,引擎从 IndexedDB 加载;`editor` 额外让引擎挂 DO remote(WS 连接)。
- **`viewer`**:用 `GET` 响应里的 `snapshot`(投影后的 `Timeline` JSON)只读渲染,不连 WS、不进引擎写路径。
- `setTimeline` shim **删除**;EditorPage 的加载编排改为 async(`openTimeline` 是 async)。`timeline` 投影就绪前显示加载态。
- 卸载 / 切 id 时 `store.reset()`(断开 WS、销毁引擎)。

---

## 6. 发布:local→cloud 升级流程(本增量新设计核心)

对应 AFFiNE local-workspace→cloud-workspace 升级、主 spec §3。

1. **发布前**:`local` 时间轴,引擎 N=0,id = 本地 nanoid,本地元数据 `published=false`。
2. **用户点发布**(`SharePopover`,需登录)→ 客户端 `POST /api/timelines`:
   - 服务端校验/清洗 id;建 D1 `timelines` 行;**自动把作者 `userId` 插入 `timeline_editors`**(否则作者发布后无法编辑自己的时间轴);返回(可能被清洗过的)`id` 与 `publishedAt`。
3. **id 若被清洗变更**:客户端把 IndexedDB snapshot/updates/元数据条目**改键**(旧 id→新 id),`navigate` 到 `/timeline/<新id>`。Y.Doc 与 timeline id 解耦(主 spec §8、Q1),改键不触碰 Y.Doc 本身。
4. 本地元数据标 `published=true`;`SyncEngine` 把该 timeline 的 DO 作为 remote 接上:开 WS → `auth` → `load-doc`(DO 为空)→ 客户端把完整 Y.Doc 状态 push 上去 → DO 被 seed。
5. **发布后**:引擎 N=1,实时双向同步。**同一个 Y.Doc 全程连续** —— 发布不重建数据,只是新增了一个 remote peer。
6. EditorPage 当前会话从 `local` 切到 `editor` 模式(作者在白名单内)。

`SharePopover` 三态(未登录 / 已登录未发布 / 已发布)保留,接到上述流程。「发布更新」按钮取消 —— CRDT 实时同步,无需手动「保存更新」。

---

## 7. 列表与本地元数据

- **IndexedDB 轻量元数据表**(在 `IndexedDBDocStore` 内新增 `meta` object store):`{ docId, name, encounterId, createdAt, updatedAt, composition, published }`。引擎每次持久化 / 投影变化时更新对应行。
- `HomePage` 本地列表改读此元数据表(替代 `getAllTimelineMetadata` 的 localStorage 读)。
- `HomePage`「已发布」区:保留,仍读 D1 `/api/my/timelines`。
- 删除时间轴:删 IndexedDB snapshot + updates + meta 行;若 `published` 再调服务端删除。

---

## 8. 旧代码清理

- `timelineStore` 的 `applyPublishResult` / `applyUpdateResult` / `applyServerTimeline` / `setTimeline` **shim → 替换为真实现**(`applyPublishResult` 接第 6 节发布流程;`setTimeline` 删除,调用方改 `openTimeline`)。
- `SharePopover`:保留,重接发布流程。
- `ConflictDialog`:**删除** —— CRDT 自动收敛,不再有版本锁 409 冲突。
- `timelineShareApi.ts`:`publishTimeline` 重写为第 6 节流程;`updateTimeline` / `expectedVersion` / `ConflictError` 等版本锁相关删除;`fetchSharedTimeline` 改为返回 `{ role, snapshot? }`(配合第 5 节);`fetchMyTimelines` / `deleteSharedTimeline` 保留。
- `timelineStorage.ts`:`saveTimeline` / `deleteTimeline` / `unpublishTimeline` 删除;`getAllTimelineMetadata` / `getTimeline` 保留(迁移仍需,见第 9 节);`createNewTimeline` 保留;`buildFFLogsSourceIndex` 改读 IndexedDB 元数据表。
- `useEditorReadOnly`:`view` 模式语义并入 `viewer`;保留「回放模式强制只读」。

---

## 9. 迁移

### 9.1 服务端一次性迁移

按主 spec §9.1:`POST /api/internal/migrate`(`SYNC_AUTH_TOKEN` 守卫),遍历 D1 `timelines`,逐条 `content` JSON → `buildYDoc` → 二进制 → DO RPC `seed(bin)` 写初始 snapshot;并为每条把作者写入 `timeline_editors`。幂等。

### 9.2 客户端迁移修正

阶段 1 的 Task 11 客户端迁移在「无服务端」假设下,把**所有**本地 localStorage 时间轴(含曾 `isShared` 的)都迁成了本地 Y.Doc。这会与服务端迁移产生主 spec §9.3 描述的**双重 seed 内容翻倍**。

本增量新增一次客户端迁移修正(标志位 `healerbook_collab_migrated_v2`):

- 读旧 localStorage 元数据,识别曾 `isShared` 的时间轴。
- 对这些「已发布」时间轴:**丢弃 Task 11 迁来的本地 Y.Doc**(从 IndexedDB 删除其 snapshot/updates),并把本地元数据标 `published=true` —— 首次打开时走第 5 节 `editor`/`viewer` 路径,从 DO 拉取。
- 纯本地(从未发布)时间轴:Task 11 已正确迁移,不动。
- 迁移完成后清理旧 localStorage 时间轴 key。

服务端是已发布时间轴的唯一 seed 权威(主 spec §9)。

---

## 10. 测试

- **`src/collab/` 新增**(`createLocalTimeline`、`meta` store、WS 远端连接 / SyncEngine remote 部分、awareness):`fake-indexeddb` 单测 + CRDT 收敛测试。
- **DO + WS + 绑定**:`@cloudflare/vitest-pool-workers`(主 spec §12)—— 测 WS 连接、`auth`、`load-doc`/push/broadcast、squash alarm、角色强制、KV 写入、服务端迁移 `seed`。DO 类极薄,纯逻辑抽出在 node 测。
- **客户端迁移修正**:`fake-indexeddb` + 模拟 localStorage 测「已发布时间轴本地 Y.Doc 被丢弃」。
- **EditorPage / HomePage / SharePopover**:React 组件,沿用项目风格 —— `tsc` + 全量回归 + 手动验证,不强行铺组件测试。

---

## 11. 落地顺序(供实现规划参考)

建议实现计划按此分组(每组可独立测试):

1. 服务端:`TimelineDoc` DO + SQLite 双表 + 同步协议 + squash;`wrangler.toml` / `env.ts` 配置;D1 `timeline_editors` 表与 `timelines` 表调整。
2. 服务端:WS 鉴权 + 角色;`GET /api/timelines/:id` 经 KV / DO RPC;`POST /api/timelines` 发布端点 + 作者入白名单;`/connect` WS 升级转发。
3. 服务端:一次性迁移端点。
4. 客户端:`SyncEngine` remote 部分(WS 连接状态机、`load-doc`/push/重连);`createLocalTimeline` + IndexedDB `meta` store。
5. 客户端:`timelineStore` 接入 remote;`apply*` shim 替换为真实现;客户端迁移修正。
6. 客户端:EditorPage 三模式改造 + 新建流程接 `createLocalTimeline` + HomePage 列表改元数据表。
7. 客户端:发布流程(`SharePopover` 重接);`ConflictDialog` 等旧代码清理。
8. Awareness:`y-protocols/awareness` + 在线昵称 + 选中高亮。

---

## 12. 未来扩展点(本增量不实现)

- 加固增量(主 spec §13 阶段 5)。
- 赋权 API + 在线权限变更广播(主 spec §14)。
- 注释字符级 `Y.Text`、FFLogs 导入合并进已有时间轴、历史版本(主 spec §14)。
