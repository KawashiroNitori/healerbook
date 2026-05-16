# 时间轴协同编辑:Awareness 设计

> 本增量(计划 C)在「服务端 + 编辑器整合」(已完成,见 `2026-05-16-timeline-collab-server-and-editor-integration-design.md`)之上,
> 实现协同编辑的 awareness —— 在线成员、选中高亮、悬停光标、实时拖动 ghost。
> 架构总设计见 `2026-05-16-timeline-collaborative-sync-design.md`(下称**主 spec**)。

**状态**:设计已确认,待转实现规划。
**日期**:2026-05-17

---

## 1. 背景与范围

服务端 + 客户端整合已交付:`editor` 模式下每条已发布时间轴经 WebSocket 连到 `TimelineDoc` Durable Object 实时双向同步。同步协议已预留 `MSG.AWARENESS` 帧,DO 当前对其做纯转发,客户端 `RemoteConnection` 当前忽略它(注释「计划 C 处理」)。

**本增量范围:**

- 客户端接入 `y-protocols/awareness` 标准 `Awareness`,经 `MSG.AWARENESS` 收发。
- 广播并实时展示四类**临时态**信号:**在线成员、选中事件高亮、悬停光标位置、实时拖动 ghost**。
- 服务端 DO:awareness 快照下发(晚加入者立即看到全员)。
- UI:header 在线成员头像 + 连接状态点、画布选中高亮(彩色描边 + 名字标签)、画布悬停光标竖线、画布拖动 ghost。

**不在本增量范围:**

- `viewer` / `local` 模式的 awareness —— awareness 仅 `editor` 模式存在(`viewer` 不连 WS,见整合 spec §5)。
- 服务端显式「断开即时移除」(靠客户端 30s 超时兜底,见 §4)。
- 文本注释的字符级协同光标(主 spec §14,未来扩展)。
- 加固增量(主 spec §13 阶段 5)。

---

## 2. Awareness 状态形态

每个 `editor` 客户端在 `Awareness` 里维护一份**临时态** —— 不进 Y.Doc、不持久化、不计入 undo:

```typescript
interface AwarenessState {
  /** 用户身份 —— 连接后设定一次,之后不变 */
  user: {
    /** 用户 id(FFLogs userId)—— 用于 header 头像按人去重 */
    id: string
    /** 昵称:取自 FFLogs 账号名 */
    name: string
    /** 颜色:由 id 哈希定到固定调色板,同一用户跨会话恒定 */
    color: string
  }
  /** 当前选中的事件;未选中为 null */
  selection: { eventId: string | null; castEventId: string | null }
  /** 鼠标在时间轴上悬停对应的时间(秒);不在画布上为 null */
  cursorTime: number | null
  /** 正在拖动的对象 ghost;未拖动为 null */
  dragging: {
    /** 被拖对象 id */
    id: string
    /** 被拖对象类型 */
    kind: 'damage' | 'cast' | 'annotation'
    /** ghost 当前时间(秒) */
    time: number
    /** ghost 当前所属玩家轨道(cast 才有意义;damage / annotation 恒为 null) */
    playerId: number | null
  } | null
}
```

`y-protocols/awareness` 的 `Awareness` 自带 clientID + clock 的 last-writer-wins 语义与 30s 过期清理。

### 2.1 身份与颜色

- **昵称**:FFLogs 账号名,客户端从 `authStore.username` 取得(`editor` 模式必已登录)。`username` 为空串时兜底:`用户` + `userId` 末 4 位。
- **颜色**:`COLOR_PALETTE`(约 14 个高区分度色 —— 调色板放大以压低小队撞色率)中按 `hash(userId) % palette.length` 取一个 —— 同一用户每次每设备恒定同色,无需协商、无需存储。偶发撞色由各处名字标签消歧(§5)。调色板与哈希函数定义在新文件 `src/collab/awarenessIdentity.ts`。
- **可信度**:`user` 字段由各客户端自报,不经服务端盖章 —— `editor` 是作者手工加入 D1 白名单的可信群体,且 DO 借此保持极薄(不解码 awareness 帧)。

---

## 3. 客户端架构

### 3.1 Awareness 实例

`SyncEngine` 持一个 `Awareness`(`new Awareness(this.doc)`),随引擎创建 / 销毁。`local` 模式下它存在但无 peer、无人收发,无害。

### 3.2 RemoteConnection 接管 MSG.AWARENESS

`RemoteConnection` 构造时额外接收 `Awareness`:

- **本地变化 → 上送**:`awareness.on('update', ({ added, updated, removed }, origin) => …)`,当 `origin !== REMOTE_ORIGIN` 时,`encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed])` → `MSG.AWARENESS` 帧 send。
- **远端帧 → 应用**:收到 `MSG.AWARENESS` → `applyAwarenessUpdate(awareness, payload, REMOTE_ORIGIN)`。
- **连接建立后**:`AUTH_OK` 后(`load-doc` 握手之后)主动广播一次本地 awareness(`encodeAwarenessUpdate(awareness, [awareness.clientID])`),使已在线者立刻看到自己。重连后同样会再触发一次。
- **自动续期(无需手写心跳)**:`y-protocols/awareness` 的 `Awareness` 自带 check interval —— 本端 state 超过 `outdatedTimeout/2`(~15s)未更新时自动 `setLocalState` 续期,触发 `update` 事件 → 经上面「本地变化 → 上送」路径自动重广播;无需额外心跳定时器。该 interval 同时把超过 `outdatedTimeout`(30s)未刷新的远端 peer 从 `getStates()` 剔除。
- **断开 / 销毁**:`SyncEngine.destroy()` 负责销毁 `Awareness` 实例(`awareness.destroy()`);不向服务端发显式「离开」帧 —— 对端靠 30s 超时(见 §4)清理本端。

### 3.3 timelineStore 投影与本地写入

- **`peers` 字段**:`timelineStore` 订阅 `awareness.on('change', …)`,把 `awareness.getStates()` 投影成 `PeerState[]`(排除自身 clientID),写入响应式 `peers`。`PeerState = { clientId, user, selection, cursorTime, dragging }`(`user` 含 `id`/`name`/`color`)。header 头像按 `user.id` 去重(一人一头像,取最新 clientID 的状态),消除「同用户多标签页 / 离开再回来旧 clientID 残留 30s」的重复;画布 overlay(光标 / 选中 / 拖动)按 `clientId` 区分(同一人多连接 = 多条光标,符合事实)。
- **本地写入器**:
  - 选中:`selectEvent` / `selectCastEvent` 在原逻辑后顺带 `awareness.setLocalStateField('selection', …)`。
  - 悬停:`setLocalCursor(time)` —— 画布 `mousemove` **节流 ~50ms** 调用;画布 `mouseleave` 与 `window` blur → `setLocalCursor(null)` **立即**调用(并取消未决的节流帧,防滞后的 `mousemove` 把陈旧 `cursorTime` 重新发出)。peer 的光标竖线随即消失,但该 peer 仍在在线列表(连接未断)。
  - 拖动:`setLocalDragging(info | null)` —— 拖动开始 / 移动(节流 ~50ms)/ 结束(置 null)调用。Konva 拖动是指针捕获的,指针移出画布拖动仍继续,故 `dragging` 不受 `mouseleave` 影响,仅由 drag-end 清空。
- `viewer` / `local` 模式:`peers` 恒为空数组;本地写入器在无 `Awareness` 关联 remote 时是无害 no-op。

---

## 4. 服务端(TimelineDoc DO)

DO 当前对 `MSG.AWARENESS` 做纯转发(`broadcast`)。纯转发的缺陷:**晚加入者在已在线者下次广播前看不到他们**。补充设计 —— **不在 DO 引入 `y-protocols`,保持 DO 极薄**:

- **存储**:每个 WebSocket 的 `serializeAttachment` 增一字段 `lastAwareness?: number[]`(awareness 帧 payload 的字节,存为普通数组)。收到某 ws 的 `MSG.AWARENESS` 时,先把 payload 存进该 ws 的 attachment,再 `broadcast` 给其他连接。attachment 持久化 → **扛 hibernation**。
- **快照下发**:新连接鉴权通过(`AUTH_OK`)后,DO 遍历 `ctx.getWebSockets()`,把每个**其他** ws 的 `lastAwareness`(若有)逐帧 `MSG.AWARENESS` 发给新连接 —— 晚加入者立刻看到全员。
- **断开清理**:**不做**服务端显式移除。靠客户端 `y-protocols/awareness` 的 `outdatedTimeout`(默认 30s)+ `Awareness` 自带的 ~15s 自动续期(见 §3.2):活跃 peer 自动续期不会过期;断开的 peer 在对端 30s 后自动从 `getStates()` 移除。DO 对已关闭 ws 不再持有 attachment,不会把陈旧 payload 发给后续新连接。

> **取舍**:`lastAwareness` 存 attachment 而非服务端 `Awareness` 实例 —— attachment 持久化扛 hibernation,且 DO 无需依赖 `y-protocols` / 不需解码 awareness 帧。代价是断开后对端最多残留 30s。显式即时移除留作未来加固项。
>
> attachment 体积:awareness payload(name+color+selection+cursor+dragging)远小于 DO `serializeAttachment` 的 2KB 上限。

---

## 5. UI

三处渲染,均**仅 `editor` 模式**出现(`peers` 非空才渲染):

### 5.1 Header 在线成员

编辑器顶部 header 右侧、`ThemeToggle` 旁,新组件 `src/components/PresenceAvatars.tsx`:

- **头像堆叠**:`peers` 按 `user.id` 去重后,每人一个彩色圆形头像(昵称首字符;昵称为空则纯色圆点),hover 显示完整昵称。
- **连接状态点**:读 `timelineStore.connectionStatus`。`connected` 显示绿点(或不显示);`connecting` / `disconnected` 显示「重连中…」灰点并把头像列表灰化 —— 让用户明白列表变空是**自己**掉线、而非他人离开(本端掉线 30s 后 `peers` 会被超时清空)。

### 5.2 选中高亮(Konva 画布)

对每个 `peer.selection` 命中的事件,用 `peer.user.color` 在该事件矩形外描边,并在其旁渲染一个小名字标签(`peer.user.name`)。多 peer 选中同一事件时标签纵向错开。渲染逻辑并入时间轴画布的事件层。

### 5.3 悬停光标(Konva 画布)

对每个 `peer.cursorTime != null` 的 peer,在画布对应时间 x 坐标画一条该 peer 颜色的细竖线,顶部一个小名字标签。

### 5.4 拖动 ghost(Konva 画布)

对每个 `peer.dragging != null` 的 peer:在 `peer.dragging.time`(cast 还要 `playerId` 轨道)位置渲染一个该 peer 颜色的**半透明 ghost** + 名字标签 —— 形状取自 Y.Doc 里该对象(`dragging.id` + `kind`)的当前数据,位置用 awareness 的 ghost 坐标。**被拖对象的原位置实体在此期间隐藏**(只剩 ghost 在动,观感等同本地拖动);`drop` 后 ghost 消失、真实位置经 Y.Doc 同步流入、实体在落点出现。

两个实现约束:

1. **drop 时信号顺序**:peer 端松手时**先提交 Y.Doc(`PUSH`)、再清 `dragging`(`AWARENESS`)**。固定此序后,最坏只是 1 帧「实体已到新位 + ghost 未撤」的轻微重叠,绝不出现「原件已隐藏 + Y.Doc 未更新」的空窗。
2. **拖动中途 peer 掉线**:Y.Doc 永远收不到那次 drop。ghost 随该 peer 被 30s `outdatedTimeout` 整体移除而消失、原件归位 —— 与 §4「断开后 presence 残留 ≤30s」同一套容忍度,无需额外定时器。(更快的「`dragging` >2s 未更新即判废弃」清理需一个渲染定时器周期性重判,留作未来优化。)

性能:awareness 高频信号(cursor / dragging)已在客户端节流 ~50ms;画布渲染遵循项目 Konva 规范(`perfectDrawEnabled={false}` 等),peer overlay 控制在既有 Layer 内。

---

## 6. 测试

- **`y-protocols/awareness` 接入**(`src/collab/`):`RemoteConnection` 的 awareness 收发 —— 沿用 Task B4 的 FakeWebSocket 单测,验证本地变化上送 `MSG.AWARENESS`、远端帧 `applyAwarenessUpdate`、`AUTH_OK` 后首播。
- **`awarenessIdentity`**:颜色哈希确定性单测。
- **DO 快照下发**:`@cloudflare/vitest-pool-workers` —— 新连接收到既有连接的 `lastAwareness`、attachment 扛重建。
- **`timelineStore` peers 投影**:单测 `getStates()` → `peers` 投影(排除自身)。
- **UI**(`PresenceAvatars` / 画布 overlay):React + Konva,沿用项目风格 —— `tsc` + 全量回归 + 手动验证,不强行铺组件测试。

---

## 7. 落地顺序(供实现规划参考)

1. 依赖与基础:`pnpm add y-protocols`;`awarenessIdentity.ts`(颜色调色板 + 哈希)。
2. 客户端 awareness 层:`SyncEngine` 持 `Awareness`;`RemoteConnection` 收发 `MSG.AWARENESS` + `AUTH_OK` 后首播。
3. 服务端 DO:`SocketAttachment.lastAwareness` 存储 + 鉴权后快照下发。
4. `timelineStore`:`peers` 投影 + `setLocalCursor` / `setLocalDragging` + `selectEvent`/`selectCastEvent` 写 awareness。
5. UI —— Header 在线成员 `PresenceAvatars`。
6. UI —— 画布选中高亮 + 悬停光标。
7. UI —— 画布拖动 ghost(画布拖动手柄接 `setLocalDragging`)。

---

## 8. 未来扩展点(本增量不实现)

- 服务端显式「断开即时移除」(免 30s 残留)。
- `viewer` 以「正在查看」身份进在线列表(需 viewer 连 awareness-only WS)。
- 文本注释字符级 `Y.Text` + 协同文本光标(主 spec §14)。
- 跟随某协作者视口(follow mode)。
