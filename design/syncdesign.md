# 本地优先协同同步架构设计参考

> 本文从 AFFiNE / BlockSuite 的同步实现中提炼,面向 **Yjs** 技术栈。
> 分两层阅读:**「可直接借鉴的模式」** 与 **「你必须自己决策的点」**。
> AFFiNE 的某些做法有坑,本文在「⚠️ AFFiNE 的坑」处标注,建议你做得更好。

---

## 0. 核心哲学:Local-first

一句话:**所有编辑先写本地,网络是异步的、可选的、可失败的副路径。**

推论:

- UI 永远读写本地存储,不阻塞在网络上。
- 本地存储必须能独立重建完整文档(离线可读)。
- 服务端是「另一个 peer」,不是「唯一真相源」。多设备汇总才需要它。
- 冲突不靠加锁解决,靠 CRDT(Yjs)数学收敛。

如果你的产品**不需要离线编辑、不需要多端实时协同**,这套架构是过度设计 —— 先确认需求再往下看。

---

## 1. 分层架构

```
UI 层(React / Vue / ...)
   ↓  只认内存里的 Y.Doc
同步引擎(Sync Engine)
   ↓                    ↓
本地存储(Local)      远端存储(Remote, 0..N 个)
   ↓                    ↓
IndexedDB / SQLite    WebSocket / HTTP → Server
```

**关键设计:同步引擎接受「1 个 local + N 个 remote」,N 可以是 0。**

- N=0 → 纯本地模式,引擎照常跑,只是没有上下行。
- N=1 → 普通云同步。
- N>1 → 多服务器 / P2P。

这样「离线模式」不是特殊分支,而是 N=0 的退化情形。你的引擎构造函数应长这样:

```ts
new SyncEngine({
  local: LocalStorage,
  remotes: Record<peerId, RemoteStorage>, // {} 即纯本地
})
```

---

## 2. 存储模型:Snapshot + Updates 双表

**两端(本地 + 服务端)各自维护一套相同结构的存储。** 不要让客户端依赖服务端来「读」,也不要让服务端依赖客户端来「读」。

### 表结构

```
snapshots: { docId(PK), bin: Uint8Array, updatedAt }
            -- 文档某个时间点的全量 Yjs 状态(checkpoint)

updates:   { [docId, createdAt](PK), bin: Uint8Array }
            -- 增量更新日志,append-only
```

### 为什么要两张表

- **写路径**:每次编辑只 append 一条 `update`(最快,不阻塞编辑)。
- **读路径**:`getDoc()` 时把 `snapshot + 所有未合并 updates` 做 `Y.mergeUpdates`,
  得到完整状态;达到阈值时把结果写回 `snapshot` 并清空已合并的 `updates`(称为 squash)。
- 没有 snapshot,每次读都要重放整个历史 → O(N) 不可接受。snapshot 是用空间换时间的 checkpoint。

### Snapshot 的真实用途(别以为只是缓存)

1. 冷启动加载文档(否则要扫整张 updates 表)。
2. 计算 state vector 和 diff 的起点。
3. 离线时唯一的完整数据来源。
4. 服务端解析结构化内容(全文搜索、导出、SSR、AI embedding)的入口。
5. 历史版本:squash 出新 snapshot 时,旧 snapshot 存进 `snapshot_histories` 表 → 时间旅行 / 回滚。

### Yjs API 对应

```ts
import { mergeUpdates, encodeStateAsUpdate, encodeStateVectorFromUpdate, diffUpdate } from 'yjs'

// squash:snapshot + updates → 新 snapshot
const merged = mergeUpdates([snapshot.bin, ...updates.map(u => u.bin)])

// 从内存 Y.Doc 生成全量 bin
const bin = encodeStateAsUpdate(ydoc)
```

---

## 3. 同步协议:只交换 diff,不交换 snapshot

线上**只有一种 wire 格式:Yjs 二进制 update**。没有「snapshot 消息」和「update 消息」之分。

### 拉取(pull)

```
客户端 → 服务端:  load-doc { docId, stateVector }   // 我有的状态
服务端 → 客户端:  { missing, state, timestamp }
```

服务端实现:

```ts
const doc = await getDoc(docId) // snapshot + updates 合并后的全量
const missing = stateVector
  ? diffUpdate(doc.bin, stateVector) // 只返回客户端缺的部分
  : doc.bin // 客户端是空的 → 返回全量(此时 missing 实质就是 snapshot)
const state = encodeStateVectorFromUpdate(doc.bin)
```

### 推送(push)

```
客户端 → 服务端:  push-doc-update { docId, update }
服务端:           append 进 updates 表,然后广播给同 room 的其他客户端
服务端 → 其他端:  broadcast-doc-update { docId, update }
```

**注意:服务端广播的是收到的原始 update 二进制,不重新算 snapshot。**

### 双向同步(重连后的核心流程)

```
1. 用本地 doc 算 localStateVector
2. getDocDiff(docId, localStateVector) → { missing, serverStateVector }
3. 把 missing 合并进本地
4. 用 serverStateVector 算出「本地有、服务端没有」的 diff
5. push 这个 diff 上去
6. 更新 clock 元数据
```

CRDT 保证:无论离线多久、两端 snapshot 内容是否完全一致,互补 diff 后最终收敛到同一状态。

---

## 4. 同步引擎:Peer + 任务队列

每个 remote 对应一个 **Sync Peer**,内部是一个**带优先级的异步任务队列**。

### Job 类型

```ts
type Job =
  | { type: 'connect';     docId }            // 首次建连,决定该 doc 要 pull 还是 push
  | { type: 'pull';        docId }            // 只拉
  | { type: 'push';        docId; update }    // 只推
  | { type: 'pullAndPush'; docId }            // 双向
  | { type: 'save';        docId; ... }       // 把远端确认的 clock 落本地
```

### 关键设计点

- **离线时 job 持续堆在队列里**,不丢;重连后逐个消费。
- **同一 docId 的多个 push job 出队时合并**:`mergeUpdates([...])` 压成一条再发,防止 update 风暴。
- **优先级**:用户当前正在看的文档优先同步。
- **catch-all 重试循环**:任何异常 → 标记 `retrying` → 等几秒重启,不丢队列。
- 所有状态(`syncing` / `retrying` / `synced` / `errorMessage`)用 Observable 暴露给 UI。

### 自动重连

连接对象做成状态机(`idle / connecting / connected / error / closed`),
断线自动重连(固定间隔 + 单次连接超时),错误透传到 UI。

### Clock 元数据(增量同步的关键)

每个 (peer, docId) 维护:

```
pushedClock  -- 已推到该 peer 的本地最大时间戳
pulledClock  -- 已从该 peer 拉到的最大时间戳
remoteClock  -- 该 peer 已知的最新时间戳
```

启动 / 重连时只需比较 clock,就知道「哪些 doc 需要 pull、哪些需要 push」,
**不必全量扫描所有文档**。服务端提供一个批量接口
`getSpaceDocTimestamps(after?)` 返回 `{ docId: timestamp }` 让客户端一次性比对。

---

## 5. Yjs 文档结构:两层 Doc + subdocs

不要把整个 workspace 塞进一个 Y.Doc。用 **subdocs**:

```
rootDoc (Y.Doc, guid = workspaceId)
├─ getMap('meta')            -- 工作区元信息:文档列表、名称等
└─ getMap('spaces')          -- 每个文档一个 subdoc
    ├─ [docId-1] → Y.Doc (guid = docId-1)
    └─ [docId-2] → Y.Doc (guid = docId-2)
```

好处:

- **同步粒度 = 单个文档**:每个 subdoc 独立算 state vector、独立 pull/push、独立懒加载。
- 打开 workspace 不必加载所有文档内容,只加载 meta。
- 你的 sync 引擎天然按 docId(= subdoc guid)工作。

文档内部的数据建模(块树、富文本)按你的产品需要设计,
用 `Y.Map` / `Y.Array` / `Y.Text` 组合即可,与同步层解耦。

---

## 6. ID 策略与信任边界

### 原则:本地优先 ⇒ ID 必须前端先生成

离线创建的文档必须立刻有 ID 才能写本地存储,不能等服务端。所以:

| ID 种类           | 谁生成                   | 说明                          |
| ----------------- | ------------------------ | ----------------------------- |
| 文档 ID / 块 ID   | **前端**(nanoid / uuid)  | 服务端当不透明字符串接收      |
| 附件 / Blob ID    | **前端 = SHA-256(内容)** | 内容寻址,自证、可去重、防伪造 |
| Workspace 主键    | **服务端**(UUID)         | 见下,这是唯一不能信前端的 ID  |
| 用户 ID / Session | **服务端**               | 身份层硬边界                  |

### 为什么 Workspace 主键必须服务端生成

Workspace ID 是**权限、成员、计费的主键**。若前端能自选,恶意用户撞库现有 workspace ID 就能造成数据污染或越权。所以:

- 云端 workspace:客户端调 `createWorkspace`,**不传 ID**,服务端用 `uuid()` 生成并返回。
- 纯本地 workspace:可以前端生成(反正不出本机)。

### 信任边界:鉴权落在 workspace,不落在 doc

- 服务端只校验「你是否是这个 workspace 的成员」(join 时)。
- 进了 workspace,对其中任意 doc/block 的操作**默认放行** —— 靠 CRDT 收敛 + 社交关系兜底。
- 如果你需要 doc 级权限(只读分享、部分文档受限),要**显式**在 push/pull 路径加 doc 级 assert。

---

## 7. ⚠️ AFFiNE 踩的坑(你要做得更好)

### 坑 1:ID 没有长度校验

AFFiNE 的同步消息字段全是 TS `interface`(编译期类型,运行时不校验),
没有 `@MaxLength`,数据库主键列用无长度的 `VARCHAR`。

**后果**:伪造超长 docId 的请求 →

- 索引键超过 PostgreSQL B-tree ~2.7KB 上限 → INSERT 失败(请求级,不崩服务)。
- 「长但仍能入索引」的 ID(~2KB)× N → 污染索引、撑爆配额、拖慢全表聚合。

**你应该做**:

```ts
class PushDocUpdateMessage {
  @IsString() @Length(1, 64) docId!: string // nanoid/uuid 64 字符足够
  @IsString() @Length(1, 64) spaceId!: string
  @IsString() @MaxLength(MAX) update!: string
}
```

- 入口 DTO 做运行时校验(class-validator 之类)。
- 数据库列用 `VARCHAR(64)`。
- WebSocket 设单消息大小上限(AFFiNE 默认 100MB,偏大,按你的 update 大小调小)。

### 坑 2:doc 级权限被注释掉了

AFFiNE 的 `push-doc-update` 里有一行 `// await ac.doc(...).assert('Doc.Update')`
**被注释掉**。当前任何 workspace 成员能推任意 docId。
如果你的产品有「文档级权限」需求,从一开始就把这个 assert 写进去,别留 TODO。

### 坑 3:doc push 路径没有配额检查

AFFiNE 只在 blob 上传时检查配额,doc update 的 push 不查 —— 可被刷爆存储。
**你应该**在 push 路径也接入配额 / 速率限制(`@Throttle` 之类)。

### 坑 4:错误依赖数据库报错兜底

超长 ID 是靠 PG 的 B-tree 报错挡下来的,而非业务层主动拒绝。
**你应该**在业务层显式校验并抛业务异常,别让 DB 错误冒到用户面前。

---

## 8. 你必须自己决策的点

| 决策                       | 选项与建议                                                                   |
| -------------------------- | ---------------------------------------------------------------------------- |
| 本地存储                   | Web 用 IndexedDB;桌面 / 移动端用 SQLite。两者实现同一套 Storage 接口。       |
| 远端传输                   | 实时性要求高 → WebSocket(socket.io 省心);否则 HTTP 轮询也行。                |
| Snapshot squash 触发时机   | 客户端:读路径同步触发;服务端:建议异步任务队列(避免阻塞写请求)。              |
| 是否要历史版本             | 要 → 加 `snapshot_histories` 表,squash 时把旧 snapshot 存进去。              |
| 是否要 doc 级权限          | 见坑 2。要就一开始写,不要事后补。                                            |
| Awareness(光标 / 在线状态) | 用 `y-protocols/awareness`,**单独的临时通道**,不持久化、不进 update 流。     |
| 跨标签页                   | 同源多 Tab 用 `BroadcastChannel` 共享;或用 SharedWorker 共享一份引擎和连接。 |
| 多端冲突                   | Yjs 自动解决,你不用写冲突逻辑;但要测「离线很久后重连」的场景。               |

---

## 9. 落地路线(从小到大)

不要一次实现全部。建议顺序:

1. **MVP — 纯本地**:内存 Y.Doc + IndexedDB(snapshot + updates 双表)+ squash。
   先验证「离线编辑、刷新不丢、冷启动能读」。此时同步引擎 N=0。
2. **加单 remote**:WebSocket + 服务端同样的双表 + `load-doc` / `push-doc-update` 协议。
   实现 pull / push / pullAndPush 三个 job。
3. **加健壮性**:任务队列 + 优先级 + 自动重连 + clock 增量同步 + Observable 状态上报。
4. **加安全**:ID 长度校验、workspace 鉴权、doc 级权限(如需)、配额 / 限流。
5. **加高级特性**:历史版本、awareness、跨 Tab、subdocs 拆分、多 remote。

每一步都应可独立测试。第 1 步做完你就已经有一个能用的离线优先编辑器了。

---

## 10. 一句话总结

**内存 Y.Doc 读写 → 本地双表 append-only 持久化 → 带优先级的任务队列异步同步 →
state vector + diff 增量协议 → CRDT 自动收敛。**
离线只是「remote 数量为 0」的退化情形,而不是特殊代码路径 —— 这是整套设计能优雅的根本原因。
