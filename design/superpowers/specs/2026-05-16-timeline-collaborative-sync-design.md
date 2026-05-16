# 时间轴协同编辑架构设计

> 给 Healerbook 时间轴实现本地优先 + 实时多人协同编辑。
> 技术栈:Yjs(CRDT)+ Cloudflare Durable Object + D1 + KV。
> 参考:`design/syncdesign.md`(从 AFFiNE 提炼的同步架构)与 AFFiNE 源码。

**状态**:设计已确认,待转实现规划。
**日期**:2026-05-16

---

## 1. 背景与目标

Healerbook 现有的时间轴云端模型是「整块 JSON `PUT` + 整数 `version` 乐观锁」,冲突时返回 409、由用户手动选服务器/本地版本。本设计将其整体替换为本地优先的 CRDT 协同架构,目标:

- **实时多人协同**:白名单内的多个编辑者同时编辑同一条时间轴,实时看到彼此改动。
- **本地优先**:所有编辑先写本地,网络是异步、可选、可失败的副路径;离线可编辑,刷新不丢,冷启动可读。
- **无冲突合并**:不靠加锁,靠 Yjs CRDT 数学收敛。

产品层的邀请/权限逻辑**不在本期范围** —— 编辑者白名单先用一张**手工填充**的 D1 表表达。

---

## 2. 核心决策摘要

| #   | 决策           | 结论                                                                                                                                                                                          |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | 时间轴 id      | 服务端发布时仍清洗 id(可能换发一次)。**Y.Doc 与 timeline id 解耦**:Y.Doc 用 Yjs 自分配的随机 guid;timeline id 仅作外部寻址键(IndexedDB key / DO 名 / URL)。换发降级为一次存储 key 改名,无害。 |
| Q2  | 迁移 seed 权威 | **服务端是已发布时间轴的唯一 seed 权威**。客户端迁移脚本只迁纯本地时间轴;已发布的丢弃本地副本、首次打开从 DO 拉。                                                                             |
| Q3  | 跨集合不变量   | **投影期 sanitizer**:CRDT 容忍瞬时孤儿,`projectTimeline()` 读路径强制跨集合引用一致。                                                                                                         |
| Q4  | 投影开销       | `projectTimeline()` 必须**保持未变 entity 的对象引用**(与当前 store `.map` 行为持平,否则退化)。                                                                                               |
| Q5  | WS 鉴权        | 连接后第一条 `auth { jwt }` 消息鉴权;DO 验签 + 查 D1 白名单定角色、`serializeAttachment` 钉住;鉴权超时关闭;重连前先续期。                                                                     |
| Q6  | Squash         | 度量 = update 条数;DO 端用单 alarm 槽做 trailing debounce + 硬顶;客户端惰性 squash。不做历史版本表。                                                                                          |
| Q7  | 公开读取缓存   | 独立 KV namespace `healerbook_snapshots`;DO squash 时写入投影 JSON;`GET` 先读 KV,命中则 DO 不唤醒。                                                                                           |
| Q8  | 回放模式       | 回放时间轴照常协同;`playerDamageDetails` 为不可变 plain 值;`exitReplayMode` 是收敛的共享结构事务、排除出 undo。                                                                               |
| Q9  | 数据模型清理   | `serverVersion` / `hasLocalChanges` 删除;`isShared`/`everPublished` 收敛为本地元数据;撤销改用 `Y.UndoManager`。                                                                               |
| Q10 | 测试           | 纯逻辑核心在 node 测;DO/WS 集成用 `@cloudflare/vitest-pool-workers`;DO 类保持极薄。                                                                                                           |

---

## 3. 总体架构与分层

```
React 组件(Timeline Canvas / Table)
   │  读:store.timeline(纯 JS 投影,引用稳定)
   │  写:store.addDamageEvent() 等
   ▼
timelineStore(Zustand)── 投影层(等价于 AFFiNE 里 BlockSuite 的角色)
   │  mutation action → 一次 Y.Doc transaction(origin='local')
   │  Y.Doc.observeDeep → 外科式 patch 投影 → React 渲染
   ▼
src/collab/ —— 同步层(等价于 AFFiNE 的 nbstore;全程只碰 Y.Doc + 二进制,不 import Zustand)
   │
   ├─ Y.Doc(内存唯一真相源)
   │
   ├─ IndexedDBDocStore ── 本地 snapshot + updates 双表
   │
   └─ RemoteConnection ── WebSocket → 该时间轴的 Durable Object
```

设计原则:

- **Y.Doc 是唯一真相源**,`timelineStore` 降级为它的只读投影。本地编辑和远端编辑走**完全相同**的下游路径(都经 `observeDeep` → 投影)。
- **两层解耦**:`src/collab/` 不知道 Zustand 存在,`timelineStore` 不知道 WebSocket 存在,二者只在 `Y.Doc.observeDeep` 这一个点相接。
- **一条时间轴 = 一个 Y.Doc = 一个 Durable Object**。Healerbook 没有 workspace,不需要 AFFiNE 的 rootDoc + subdocs 两层结构。
- **离线 = remote 数量为 0 / WebSocket 断开的退化情形**,不是特殊代码路径。纯本地时间轴也是 Y.Doc,只是不连 DO。

### 投影层为什么保留

AFFiNE 的同步层(`nbstore`)全程只碰裸 `YDoc` + 二进制,没有投影 store;投影发生在 BlockSuite —— 一套从零围绕 Yjs 自造的反应式模型框架。Healerbook 不复刻这套,因为:

1. **减伤计算器跑在 Web Worker**,导出(Souma)、V2 序列化也都需要一份**普通可序列化的 `Timeline` 快照** —— 这份快照无论如何都必须存在。
2. 现有 UI / 计算 / 导出全部建立在普通 `Timeline` + Zustand 上;保留投影 = 改动最小。

投影层不是「为分层而分层」,它**同时就是 Web Worker 边界那份快照**。

---

## 4. Y.Doc 文档结构

```
Y.Doc(guid 由 Yjs 自分配,不绑 timeline id)
├─ getMap('meta')          标量字段,每个 key 独立 LWW
│    name, description, encounter, fflogsSource,
│    gameZoneId, syncEvents, isReplayMode, createdAt
├─ getMap('damageEvents')  Y.Map<id, Y.Map>
├─ getMap('castEvents')    Y.Map<id, Y.Map>
├─ getMap('annotations')   Y.Map<id, Y.Map>
├─ getMap('composition')   Y.Map<playerIdStr, Y.Map{ job }>
└─ getMap('statData')      Y.Map(嵌套,镜像 TimelineStatData)
```

建模规则:

- **三大集合按 id 索引**(`Y.Map<id, Y.Map>`)。时间轴元素靠 `time` 字段排序,数组下标无意义 → 渲染顺序由投影 sort 推导,无并发下标冲突。两人同时增删不同事件、或改同一事件的不同字段,都干净合并。
- **每个 entry 是嵌套 `Y.Map`**,所以 per-field 合并(A 改 `time`、B 改 `damage`)也成立。
- **`playerDamageDetails`** 作为 **plain JSON 值**存在所属 damageEvent 的 `Y.Map` 里 —— 导入后不可变,无需 CRDT 子结构。
- **`annotation.text`** 用 plain string(LWW 整段覆盖)。字符级 `Y.Text` 合并暂不做(见第 14 节)。
- **`composition` 的级联**(删玩家连带删其 castEvents / skillTrack 注释 / 清理 statData)由 app 逻辑在**单个 Y.Doc transaction** 内完成。并发漏网由投影 sanitizer 兜底(第 5.2 节)。
- **不进 Y.Doc 的内容**:`partyState`、`statistics`、`statusEvents`(派生)、`currentTime` / 缩放 / 选中项(UI 态);`updatedAt`(由 Yjs 变更日志和 D1 元数据表达)。

`statusEvents` 说明:V2 持久化格式本就不含它。编辑模式由 executor 计算,回放模式从 `playerDamageDetails.statuses` 重建 —— 它是投影的产物,不是源数据。

---

## 5. 客户端:`src/collab/` 模块

镜像 AFFiNE `nbstore` 的内部结构:

```
src/collab/
├── index.ts
├── docSchema.ts          Y.Doc ⇄ Timeline 纯函数(buildYDoc / projectTimeline / sanitizer / 迁移共用)
├── connection/           WS 连接状态机
├── storage/              IndexedDBDocStore(本地 snapshot + updates 双表)
├── sync/                 SyncEngine(连接 + 离线缓冲 + 重连重试)
├── awareness/            y-protocols/awareness 封装
├── frontend/             对外门面:connect(ydoc) / 状态 Observable
└── migration.ts          客户端一次性迁移
```

`docSchema.ts` 中的纯函数同时被**客户端、Worker/DO**使用(`buildYDoc`、`projectTimeline`、迁移)。

### 5.1 投影层与 `timelineStore`

- `timelineStore` 的 `timeline` 字段是 Y.Doc 的**只读纯 JS 投影**。
- UI 组件**几乎不动**:仍读 `store.timeline.damageEvents`,仍调 `store.addDamageEvent()` 等。
- mutation action 不再做 immutable set,而是发起一次 Y.Doc transaction(`origin='local'`)。
- 一个 `Y.Doc.observeDeep` handler 把变更投影回 `store.timeline`。

**Q4 —— 投影必须保持对象引用**:当前 store 的 `damageEvents.map(e => e.id===id ? {...e,...patch} : e)` 天然让未变元素按原引用返回,React memo 据此跳过重渲。`projectTimeline()` 换掉 `.map` 后,**必须有意复现这个性质**:observer 读 `YMapEvent.keysChanged` 精确得知哪些 entity 变了,只重建变动的 entry,其余条目保持上一次投影的对象引用。做不到 = 相对今天退化(一次编辑导致整块 Konva 画布重渲)。

派生计算(`partyState` executor 重放 / `statistics`)继续 debounce(trailing,约一帧),跑最新投影一次。重连追帧时,把一帧内多次投影 patch 合并一趟。

### 5.2 投影 sanitizer(Q3)

CRDT 保证每个集合各自收敛,但保证不了集合**之间**的引用一致性。典型:A 删玩家 3(级联删其 castEvents),B 并发给玩家 3 加了一个 castEvent → 合并后出现孤儿 castEvent。

解决:`projectTimeline()` 统一强制所有跨集合不变量 —— 丢弃 `playerId` 不在 `composition` 内的 castEvent、玩家已不在的 skillTrack 注释、阵容外的 statData 键。**Y.Doc 允许暂存孤儿,投影永远干净。**

可选(phase 5):投影发现孤儿时 debounce 调度一个 `origin='local'` 的 GC 事务物理删除;多端同时 GC 无害(删除幂等)。核心阶段不做。

### 5.3 SyncEngine 与本地存储

- **`IndexedDBDocStore`**:本地 `snapshots` + `updates` 双表,一个 DB 容纳多条时间轴、按 timelineId 分键。
  - 写路径:每次 Y.Doc 本地 update → append 一条 `update`(廉价,无需防抖;现有 2s 自动保存防抖**移除**)。
  - 读路径:doc 加载时 `mergeUpdates(snapshot, ...updates)`;若该 doc 的 updates 条数 > **100**,**惰性 squash**(合并写回 snapshot、清空 updates)。
- **`SyncEngine`**:持有 Y.Doc + 本地存储 + 一个可选 remote。
  - 本地 update(`origin='local'`)→ append 本地 updates 表 +(若连接)推送。
  - 远端广播 update → `applyUpdate(origin='remote')` → 同一个 observer 投影。
  - 因为「一引擎 = 一 doc」,AFFiNE 的 `getSpaceDocTimestamps` 批量 clock 比对**不需要**;离线缓冲就是 IndexedDB updates 表本身,重连时按 state vector diff 推送。
- **`RemoteConnection`**:WS 状态机(`idle/connecting/connected/error/closed`)+ 固定间隔自动重连 + 单次连接超时。
- 同步状态(`syncing/retrying/synced/errorMessage`)用 Observable 暴露给 UI(替代被删除的 `hasLocalChanges`)。

### 5.4 撤销(Q9)

`zundo temporal` 整体换成 `Y.UndoManager`:

- 跟踪 5 个顶层 Map,**按 `origin='local'` 过滤** —— 只撤自己的改动,不误撤协作者的。
- `captureTimeout` ~300–500ms,把一次手势内的连续改动归并为一个撤销项。
- `exitReplayMode` 事务**不纳入跟踪**(与现状「不可撤销」一致)。
- 现有 store 里所有 `temporal.pause()/resume()/clear()` **整体删除**:换 doc = 换 Y.Doc = 换 `UndoManager`,撤销历史天然清空。

---

## 6. 服务端:Durable Object

**`TimelineDoc`(DO 类)** —— 同时是实时同步房间和服务端存储。DO 实例由 `idFromName(timelineId)` 定位。

### 6.1 DO 内 SQLite 双表

```
snapshot(rowid=1, bin BLOB, updated_at)
updates(seq INTEGER PRIMARY KEY AUTOINCREMENT, bin BLOB, created_at)
```

`getDoc()` = `mergeUpdates(snapshot.bin, ...updates ORDER BY seq)`。

### 6.2 WebSocket 鉴权(Q5)

DO 用 **WebSocket Hibernation API**(`state.acceptWebSocket`)—— 无人编辑时 DO 休眠不计费。

鉴权流程:

1. 浏览器 `GET /api/timelines/:id/connect`(upgrade 请求)→ Worker **不鉴权,直接转发** upgrade 给 DO。
2. DO `acceptWebSocket` 后,把 socket 挂在「未鉴权」态。
3. 客户端发的**第一条消息必须是 `auth { jwt }`**。token 不进 URL、不进 header。
4. DO 验 JWT 签名(DO 绑定 `JWT_SECRET`)+ 查 D1 `timeline_editors` 算角色 `editor` / `viewer`(DO 绑定 D1)。
5. 角色用 `serializeAttachment` 钉在 socket 上(扛 hibernation)。
6. **未鉴权期防护**:`auth` 到达前,DO 拒绝/忽略一切其他消息;设**鉴权超时**(几秒没发 `auth` 即关闭),防未鉴权连接空占。
7. DO **只在 `auth` 时验一次**,之后每条消息不再验。一条已建立连接的 JWT 中途过期无害。
8. 角色按连接固定。权限变更(白名单增删)**下次连接(重连/刷新)才生效**,与 AFFiNE 一致。

### 6.3 同步协议

线上只有一种 wire 格式:Yjs 二进制 update。

- `auth { jwt }` → 见 6.2。
- `load-doc { stateVector }` → DO 回 `{ missing: diffUpdate(getDoc(), sv), serverStateVector }`。
- `push-doc-update { update }` → `viewer` 角色**直接拒绝**;`editor` 则 **先 append 到 `updates` 表(保证持久),再广播原始 update 二进制给同房其他 socket**,然后 ack。
  - append-then-broadcast 顺序:若两步间崩溃,update 已持久,漏掉的只是一次 live 广播,对端下次 `load-doc`/重连 diff 补回。
  - ⚠️ doc 级写权限 assert **必须真的写进 push 路径**,不留 AFFiNE 那个被注释掉的坑(`syncdesign.md` 坑 2)。
- `awareness { payload }` → 仅转发给同房其他 socket,**不落库**。

### 6.4 Squash(Q6,基于 DO 特性细化)

| DO 特性                                                  | 对 squash 的推论                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| 单线程单实例;SQLite 同步 API                             | squash 与 push **绝不并发**,无需锁;一次 invocation 内多条 SQL 原子提交。 |
| Hibernation / 驱逐清空内存,SQLite 持久                   | 触发计数**不放内存**,每次 append 后 `SELECT COUNT(*) FROM updates`。     |
| 每 DO 一个 alarm 槽,`setAlarm` 覆盖前值,alarm 跨驱逐存活 | alarm 做 debounce 定时器。                                               |
| alarm 失败自动重试                                       | squash 必须幂等 —— 它本就幂等。                                          |

**触发逻辑(每次 push append 后):**

1. `count = COUNT(*) FROM updates`
2. `count >= 200`(硬顶)→ `setAlarm(Date.now())`,排独立 invocation 立即 squash,不拖慢这条 push 的 ack。
3. `50 <= count < 200` → `setAlarm(Date.now() + 10s)`,每条 push 重置 → trailing debounce(编辑停顿 10s 后 squash;持续编辑由硬顶兜底)。
4. `count < 50` → 不动 alarm。

**`alarm()` 处理**:重新 `COUNT(*)`,>1 才 squash。squash = 读 snapshot + 按 `seq` 升序读 updates → `mergeUpdates` → 同 invocation 内 `UPDATE snapshot` + `DELETE FROM updates WHERE seq <= maxMergedSeq`,原子。

**squash 对客户端完全不可见**:只重写 storage,不碰 socket / awareness;广播在 push 时已发生。squash 后顺手把投影 JSON 写入 KV(见 7.3)。

回放时间轴 snapshot 可能数 MB(`playerDamageDetails` 全进 Y.Doc),`mergeUpdates` 对 MB 级是几十 ms 量级,在 DO CPU 限额内无忧;另设字节上限兜底超大单个 update。

**客户端 squash**:见 5.3,doc 加载时惰性 squash,阈值 100 条。

### 6.5 DO 类保持极薄

squash、同步协议编解码、投影逻辑全部抽进**纯模块**(node 可测);`TimelineDoc` 类只留 WebSocket 生命周期 + 调用纯模块这层薄胶水。

---

## 7. 服务端:D1 与 Worker 路由

### 7.1 D1 表

- **`timelines`** —— 退化为**列表元数据**:`id, name, author_id, author_name, encounter_id, published_at, updated_at`(可含 `composition` 供列表展示)。删除 `content`、`version` 列(真相源转移到 DO)。`name` / `updated_at` 等由 DO 在 squash 时写回,供 `/api/my/timelines` 不唤醒 DO 即可列出。
- **`timeline_editors`(新)** —— `(timeline_id, user_id)` 主键,编辑者白名单,**手工填充**。作者也插一行。

### 7.2 Worker 路由变化(`routes/timelines.ts`)

- `POST /` 创建 —— 创建 D1 列表行;DO 由客户端首次 WS push 完整状态来 seed。
- `GET /:id` —— 公开只读:先读 KV,未命中再唤醒 DO(见 7.3)。供 `viewer` / 未登录 / SSR / 链接预览。
- `GET /:id/connect` —— WebSocket 升级,Worker 直接转发给 DO(不鉴权)。
- `PUT /:id` —— **删除**(不再有整块 JSON 更新)。
- `DELETE /:id` —— 删 D1 行 + 删 KV 条目 + 通知 DO `storage.deleteAll()` + 清 `timeline_editors` 对应行。
- `POST /api/internal/migrate` —— 一次性迁移端点(见第 9 节),`SYNC_AUTH_TOKEN` 守卫。

### 7.3 公开读取 + KV 缓存(Q7)

**新增独立 KV namespace `healerbook_snapshots`**(与现有 `healerbook` 分开,dev + prod 各配)。

- DO 每次 squash 后,把投影出的 `Timeline` JSON 写入 `healerbook_snapshots`,key = `tl-snapshot:<id>`。
- `GET /api/timelines/:id`:Worker **先读 KV**。命中 → 直接返回,**DO 不唤醒**。未命中(新发布、从未 squash)→ 唤醒 DO 取 `getSnapshotJson()`(RPC),返回并回填 KV。
- 新鲜度:KV 在 squash 时刷新,squash 在编辑停顿 ~10s 后触发 → 时间轴空闲后缓存 ~10s 内收敛。对 viewer(读成稿)无感。
- 投影用 `docSchema.ts` 的共享 `projectTimeline`(含 sanitizer),viewer 永不见孤儿。
- GET 响应设 `Cache-Control: public, max-age=60`,同浏览器重复浏览连 Worker 都不碰。

`editor` 走 WS 拿实时数据、不读 KV;只有 `viewer` 读 KV。时间轴空闲时整个公开读路径**零 DO 唤醒、零 mergeUpdates**。

### 7.4 编辑器模式

| 模式     | 触发                                 | 通道                           |
| -------- | ------------------------------------ | ------------------------------ |
| `local`  | 纯本地、未发布                       | 无 DO,N=0,Y.Doc 仅在 IndexedDB |
| `editor` | 已发布且在 `timeline_editors` 白名单 | WebSocket → DO,可读写          |
| `viewer` | 已发布、不在白名单 / 未登录          | HTTP `GET`(KV 快照),只读       |

`GET /api/timelines/:id` 同时返回调用者 `role`(JWT + D1 白名单算出,只查 D1):`editor` → 客户端开 WS;`viewer` → 用响应内附带的快照只读渲染。中途权限变更 = 下次该请求重新解析。

---

## 8. id 策略(Q1)

- timeline id 由前端 `generateId()`(21 位定长 nanoid)在创建时生成。
- **Y.Doc 与 timeline id 解耦**:Y.Doc 用 Yjs 自分配的随机 `guid`;timeline id 只是外部寻址键(IndexedDB key / DO 名 / URL)。
- 发布时服务端仍清洗 id(敏感词过滤 —— 目的是让分享链接不被第三方平台过滤器吞掉)。若 id 被换发:
  - 全程**只有一个 Y.Doc**(内存里那个),不重建、不 fork。
  - 客户端把本地 IndexedDB 条目改键(旧 id → 新 id),更新外部 URL,连上 DO(新 id)推送同一个 Y.Doc 当 seed。
  - 发布前时间轴无可分享 URL,旧 id 从未外泄 → 换发零外部影响。
- ID 长度运行时校验(`syncdesign.md` 坑 1):入口 DTO 校验 `1..64`,DB 列 `VARCHAR(64)`,WS 单消息设大小上限。

---

## 9. 迁移(Q2)

**预先全量迁移,不做懒加载 seed。**

### 9.1 服务端一次性脚本

- HTTP 端点 `POST /api/internal/migrate`,`SYNC_AUTH_TOKEN` 守卫,逻辑直接在 Worker 层运行,跑完即弃。
- 遍历 D1 `timelines`,逐条 `content` JSON → `buildYDoc()` → 二进制 → 调对应 DO 的 **RPC 方法 `seed(bin)`** 写入初始 snapshot。
- `seed()` 幂等(DO 已有 snapshot 则跳过)。失败可整体重跑。
- DO 对外只暴露 WS `/connect` 一个口;`seed()` / `getSnapshotJson()` 都是 Worker→DO 的 RPC 方法,不是 DO 的公开 HTTP 路由。

### 9.2 客户端一次性脚本

- App 启动时检查 `localStorage` 标志位 `healerbook_collab_migrated_v1`。
- 未迁移 → 遍历所有旧 `healerbook_timelines_*` 条目:
  - **纯本地(从未发布)的时间轴** → `Timeline JSON → buildYDoc() → 写入 IndexedDBDocStore`。
  - **已发布的时间轴** → **不**本地 seed:丢弃本地 JSON 副本,首次打开时从服务端 DO 拉 Y.Doc(服务端是唯一 seed 权威)。
- 置标志位、清掉旧 key。本地数据量小,迁移期一个 loading 态即可。

### 9.3 为什么不双边各自 seed

`buildYDoc()` 内容相同但 Yjs 给每个插入分配的 struct id 含 `(clientID, clock)`;两次独立构造产出**无共同祖先**的两个 Y.Doc,首次 merge 时 CRDT 取并集 → **内容全部翻倍**。所以已发布时间轴只能由服务端单边 seed。

**已知代价**:已发布时间轴若有未推送的本地改动,在切换那一刻丢失(打日志 + 一次性 toast)。受影响集合很小,且旧模型冲突解决本就是「选一边」的有损语义。

---

## 10. 数据模型清理(Q9)

`Timeline` 类型**一拆为二**:

- **协同内容**(进 Y.Doc 投影):见第 4 节字段。
- **本地元数据**(不进 Y.Doc、不进投影,由本地存储层管理):`published` 布尔、本地 `updatedAt` 等。

废弃字段:

| 字段                         | 去向                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| `serverVersion`              | 删 —— 无版本乐观锁                                                    |
| `hasLocalChanges`            | 删 —— 同步状态改由 SyncEngine Observable 表达                         |
| `isShared` / `everPublished` | 收敛为本地元数据 `published`;EditorPage mode 推导用它 + GET 的 `role` |
| `isReplayMode`               | 保留,是协同内容,在 Y.Doc `meta` 里                                    |
| `updatedAt`                  | 不进 Y.Doc;D1 列表行维护,本地从最近 update 时间取                     |

废弃的 store action(`applyPublishResult` / `applyUpdateResult` / `applyServerTimeline`)由 SyncEngine 的发布/同步流程取代。

---

## 11. 回放模式与结构性操作(Q8)

- 回放时间轴照常进 DO、可多人编辑;`playerDamageDetails`、回放期 status 快照是**导入后不可变的 plain JSON 值**,永不产生合并冲突。
- `exitReplayMode`:置 `meta.isReplayMode=false`(LWW)+ 从每个 damageEvent 删 `playerDamageDetails`。是**收敛的共享单向结构事务**(字段删除幂等且胜过并发陈旧存在);**排除出 undo**;建议加确认弹窗(UI 细节)。
- FFLogs 导入**当前总是创建新时间轴**(新 id / 新 Y.Doc / 本地),不原地改写已协同的 doc。

---

## 12. 测试策略(Q10)

**纯逻辑核心(plain Vitest / node,快)** —— 绝大多数覆盖率:

- `docSchema.ts`:`buildYDoc` / `projectTimeline` / sanitizer / 迁移。round-trip 等价、迁移确定性、sanitizer 丢孤儿。
- **CRDT 收敛测试**:从共同基线造两个 Y.Doc,分叉编辑,双向 `mergeUpdates`,断言投影一致 —— 专测 Q3 跨集合、并发同事件不同字段。
- 同步协议编解码、squash 合并逻辑(从 DO 类抽出的纯模块)。
- 投影引用保持(Q4):断言未变 entity 跨 patch 对象引用不变。

**本地存储层** —— `fake-indexeddb`,测离线 append、squash 阈值、重连 diff。

**DO + WS + 绑定集成** —— `@cloudflare/vitest-pool-workers`(新增依赖 + 第二个 vitest project 配置)。测 WS 连接、`auth` 消息、`load-doc`/push/broadcast、squash alarm、角色强制(viewer push 被拒)、KV 缓存写入。

纪律:DO 类极薄,workers pool 测试少而精。

---

## 13. 落地路线(分阶段,每阶段可独立测试)

1. **纯本地**:Y.Doc schema + `docSchema.ts` + 投影改造 `timelineStore` + `Y.UndoManager` + `IndexedDBDocStore` 双表 + 惰性 squash + 客户端一次性迁移。验证离线编辑、刷新不丢、冷启动可读、撤销重做。引擎 N=0。
2. **加单 remote**:`TimelineDoc` + DO SQLite 双表 + WebSocket + `auth`/`load-doc`/`push`/`broadcast` 协议 + `RemoteConnection` + SyncEngine 重连 + 服务端一次性迁移脚本。验证双端实时同步、断线重连。
3. **加鉴权**:JWT 验签 + D1 `timeline_editors` 白名单 + `viewer` 只读 + 公开 `GET` + `healerbook_snapshots` KV 缓存。
4. **加 Awareness**:`y-protocols/awareness`,presence = `{ userId, name, color }`(`color` 按 `userId` 哈希,无头像)。UI:在线昵称列表 + Konva 画布上他人选中项的彩色高亮(不做浮动光标)。
5. **加固**:DO 端 squash 写回 D1 列表 + 投影 GC、ID 长度运行时校验、push 路径限流/配额、WS 单消息大小上限(`syncdesign.md` 坑 1/3/4)。

每一步独立可测。第 1 步完成即得到一个可用的离线优先编辑器。

---

## 14. 未来扩展点(本期不实现,架构预留)

- **赋权 API**:若未来做真正的邀请/权限 API,该 API 写完 D1 后可调 `doStub.broadcastPermissionChanged()` → DO 给在线 socket 推信号 → 客户端提示「权限已变更,点此刷新」,实现近实时的角色升降级。
- **注释富文本**:`annotation.text` 从 LWW string 升级为 `Y.Text`,支持字符级协同合并。
- **FFLogs 导入合并进已有时间轴**:目前导入只创建新时间轴;未来若支持「重导入到已协同时间轴」,这是一次「整体替换内容」的大事务,需专门设计。
- **历史版本 / 时间旅行**:加 `snapshot_histories` 表,squash 时把旧 snapshot 存进去。

---

## 15. 配置与基础设施改动

- **`wrangler.toml`**:
  - 新增 Durable Object 绑定 `TIMELINE_DOC` → 类 `TimelineDoc`。
  - 新增 DO migration:`[[migrations]] new_sqlite_classes = ["TimelineDoc"]`。
  - 新增 KV namespace 绑定 `healerbook_snapshots`(dev + prod)。
- **`env.ts`**:`Env` 增加 `TIMELINE_DOC: DurableObjectNamespace`、`healerbook_snapshots: KVNamespace`;DO 需可读 `JWT_SECRET` 和 D1 binding。
- **D1 迁移 SQL**:新建 `timeline_editors` 表;`timelines` 表删 `content` / `version` 列。
- **新增依赖**:`yjs`、`y-protocols`、`@cloudflare/vitest-pool-workers`(devDep)。
- **package / vitest**:新增第二个 vitest project 配置用于 workers pool 测试。
