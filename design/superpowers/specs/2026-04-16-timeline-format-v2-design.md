# Timeline 持久化格式 V2 设计

## 背景与目标

当前的 Timeline 持久化格式（V1）存在大量冗余：

- **`PlayerDamageDetail`** 是最大头。每个 DamageEvent 挂 1–8 条 detail，每条 detail 里的 `job`、`skillName`、`abilityId`、`sourceId`、`packetId` 都是全员/全事件重复。
- **`Encounter.damageEvents`** 作为模板数据被写入 schema 但运行时**从未被读取**，所有构造点都写 `[]`。
- **`Encounter.name/displayName/zone`** 同样运行时零读取（显示名走 `timeline.name` 或 `raidEncounters.ts` 静态表查）。
- **`CastEvent.job` / `StatusSnapshot.targetPlayerId` / `CastEvent.targetPlayerId` / `DamageEvent.targetPlayerId` / `DamageEvent.packetId`** 全部是 FFLogs 导入阶段写入但运行时**零业务消费**的死字段。
- **长 JSON key**（`playerDamageDetails`、`unmitigatedDamage`、`targetPlayerId`、`damageType` ……）在几百个事件 × 8 玩家 × 多状态的规模下占比可观。
- **Cast 事件对象数组** 每条都携带 UUID + 4 个长 key，编辑模式下这是持久化体积的主要来源。

本次优化的目标：

1. **D1 存储体积**（按原始字节计费）
2. **网络传输体积**（POST/PUT/GET 和 FFLogs 导入返回）
3. **本地 localStorage 体积**

三处端到端使用同一种压缩格式（V2）。迁移由前端静默处理，Worker 严格只接受 V2 写入。

## 非目标

- 不引入字典表 / 列式 PDD / 二进制编码（方案 B/C 的内容，复杂度过高）
- 不变更内存运行时的 Timeline 类型或业务代码
- 不引入跨时间轴的引用或全局去重
- 不做 Annotation / SyncEvent 的压缩（出现频次低，收益小）
- 不对 `statData` 做压缩（本地 only，体积小）

## 总体架构

V2 是**纯持久化格式**。内存运行时继续使用现有的 `Timeline` 类型。转换只发生在四个边界：

```
              ┌─────────────────────────────────────┐
              │        内存 Timeline (长字段名)      │
              │   id、name、damageEvents、...         │
              └─────────────────────────────────────┘
                  ▲                         │
       hydrateFromV2                 toV2 / serializeForServer
                  │                         ▼
   ┌──────────────┴─────────────────────────┴──────────────┐
   │                    V2 持久化边界                      │
   │                                                       │
   │  localStorage      GET /api/timelines/:id             │
   │       │                  │                            │
   │       │            POST /api/fflogs/import            │
   │       ▼                  ▼                            │
   │  解析入站   →   parseFromAny (V1 → migrate → V2 → hydrate)
   │                                                       │
   │  POST /api/timelines ← toServerPayload                │
   │  PUT  /api/timelines ← toServerPayload                │
   │  localStorage save   ← toLocalStored                  │
   └───────────────────────────────────────────────────────┘
```

- **入站路径**（IndexedDB load / D1 GET / FFLogs import 返回）：`parseFromAny(raw)`
  1. 若 `raw.v === 2`：当作 V2，直接 hydrate
  2. 否则：`migrateV1ToV2(raw)` 升级 → hydrate
- **出站路径**（D1 POST/PUT）：`serializeForServer(timeline)` → 只包含 V2 核心字段（白名单）
- **本地存储**：`toLocalStored(timeline)` → V2 核心字段 + 运行时元数据扁平内联

### 运行时 ID 生成

内存里 `DamageEvent.id`、`CastEvent.id`、`Annotation.id` 依然是稳定字符串，但**不进入持久化格式**。加载时由一个模块级单调计数器生成：

```ts
// src/utils/shortId.ts
let counter = 0
export function nextShortId(): string {
  return `e${counter++}`
}
export function resetIdCounter(): void {
  counter = 0
}
```

`hydrateFromV2` 入口先调 `resetIdCounter()`，再按顺序 DE → CE → Annotation 发号。运行时新建事件继续 `nextShortId()`，因为计数器单调递增，保证同一会话内不冲突。

## V2 数据格式

### 顶层 Timeline

```ts
interface V2Timeline {
  v: 2 // 版本号；parseFromAny 按此字段派发
  n: string // name
  desc?: string // description
  fs?: { rc: string; fi: number } // fflogsSource
  gz?: number // gameZoneId
  e: number // encounterId（由 raidEncounters.ts 反查元数据）
  c: string[] // composition job 数组；见下
  de: V2DamageEvent[] // 伤害事件对象数组（短 key）
  ce: V2CastEvents // 技能使用事件列式存储
  an?: V2Annotation[] // 注释
  se?: V2SyncEvent[] // Souma sync 锚点
  r?: 1 // isReplayMode；false 时整字段缺席
  ca: number // createdAt
  ua: number // updatedAt
}
```

**说明**：

- `v: 2` 作为版本哨兵。`parseFromAny` 通过 `raw.v === 2` 判断是否需要迁移。
- `e` 坍缩为数字。`name/displayName/zone` 通过 `getEncounterById(e)` 在运行时反查；不在静态表里的 FFLogs 副本走 `gz` 回退（和现有 `soumaExporter.ts:123` 逻辑一致）。
- `fflogsSource` 运行时字段有 2 个（`reportCode`、`fightId`），短 key `rc` / `fi`。
- `r?: 1` 使用"存在即 true，缺席即 false"的编码惯例，进一步省空间。

### composition（`c`）

```ts
c: string[]   // 长度 ≤ 8，每个元素是 Job code 或空串 ""
```

**固定 8 槽稀疏数组**，下标 = `playerId`。

- 空槽用空字符串 `""` 占位
- **允许尾部 truncate**：`['PLD','WAR','WHM','SCH']` 被反序列化成长度 8 的数组（后 4 位补 `""`）
- 删除玩家时留空槽，其余槽位**不滑动**，保证 `CastEvent.playerId` 引用稳定
- 新增玩家填入第一个空槽，`playerId` 即该下标
- **显示顺序**和存储顺序无关，运行时用 `sortJobsByOrder()` 按职业排

### damageEvents（`de`）

```ts
interface V2DamageEvent {
  n: string // name
  t: number // time（秒）
  d: number // damage
  ty: 0 | 1 // 0=aoe, 1=tankbuster
  dt: 0 | 1 | 2 // 0=physical, 1=magical, 2=darkness
  st?: number // snapshotTime（DOT 快照，编辑/replay 通用）
  pdd?: V2PlayerDamageDetail[] // replay 模式专属
}
```

**从 V1 移除的字段**（运行时零消费，已验证）：

- `id` —— 运行时由 `nextShortId()` 生成
- `packetId` —— 只有 fflogsImporter 构造去重 key 时使用，改为局部变量
- `targetPlayerId` —— 仅 `TableDataRow.tsx:56-60` 用于定位 tankbuster detail，fallback `pdd[0]` 已覆盖所有场景
- `abilityId` —— V1 schema 已 strip，无需持久化

### playerDamageDetails（`pdd`）

```ts
interface V2PlayerDamageDetail {
  ts: number // timestamp（毫秒）
  p: number // playerId
  u: number // unmitigatedDamage
  f: number // finalDamage
  o?: number // overkill
  m?: number // multiplier
  hp?: number // hitPoints
  mhp?: number // maxHitPoints
  ss: V2StatusSnapshot[] // statuses
}

interface V2StatusSnapshot {
  s: number // statusId
  ab?: number // absorb（仅盾值类状态）
}
```

**从 V1 移除的字段**（运行时零消费，已验证）：

- `job` —— 可由 `composition[playerId]` 反查
- `skillName` —— 可由父级 `DamageEvent.n` 反查
- `abilityId` / `sourceId` / `packetId` —— 仅 fflogsImporter 构造去重 key 时使用，改为局部变量
- `StatusSnapshot.targetPlayerId` —— 运行时零消费，语义冗余（detail 的 `p` 已经是状态归属玩家）

### castEvents（`ce`）

```ts
interface V2CastEvents {
  a: number[] // actionId 列
  t: number[] // timestamp 列
  p: number[] // playerId 列
}
```

**列式存储**（3 个平行数组，长度相同）。和 DE 不同，CE 的字段全是简单数字，没有 optional，列式是纯收益：

- Key 重复从 `N × 3` 降到 `3`
- 持久化前按 `t` 升序排一次，反序列化无需再排
- **空 CE** 用空数组 `{a:[],t:[],p:[]}` 而非字段缺席（避免 `parseFromAny` 多一条分支）

**从 V1 移除的字段**：

- `id` —— 同 DamageEvent
- `job` —— 运行时可由 `composition[p]` 反查
- `targetPlayerId` —— `useDamageCalculation.ts:130-144` 构造 executor context 时完全没有传 target，运行时零消费

### annotations（`an`）

```ts
interface V2Annotation {
  x: string // text
  t: number // time
  k: 0 | [number, number] // 0=damageTrack, [playerId, actionId]=skillTrack
}
```

Annotation 出现频次低，不做列式也不做字典。只做短 key 和 anchor 压缩。

**从 V1 移除的字段**：`id` —— 同上

### syncEvents（`se`）

```ts
interface V2SyncEvent {
  t: number // time
  ty: 0 | 1 // 0=begincast, 1=cast
  a: number // actionId
  nm?: string // actionName（仅当 abilityMap 查不到时存入）
  w: [number, number] // window
  so?: 1 // syncOnce；false 时缺席
}
```

**从 V1 优化的字段**：

- `actionName` 默认由 `a`（actionId）反查 abilityMap，只在查不到时存 `nm` 作为 fallback

## 内存层面的变动

字段审计在实施阶段发现 3 处遗漏：`PlayerDamageDetail.job`（被 `PlayerDamageDetails.tsx` 和 `Timeline/index.tsx` 渲染）、`DamageEvent.packetId` 和 `PlayerDamageDetail.abilityId`（被 `top100Sync.ts` 消费——它是 Worker 里的独立管道，从 `parseDamageEvents` 直接拿内存 Timeline，不走 V2 反序列化路径）。这 3 个字段因此采用**"内存保留 / V2 剥离 / hydrate 重推"**的不对称处理。

### 类型字段删除清单

从 `src/types/timeline.ts` 内存类型里**真正删除**的字段：

- `DamageEvent.targetPlayerId`、`DamageEvent.abilityId`（后者 V1 schema 已 strip）
- `PlayerDamageDetail.sourceId`、`PlayerDamageDetail.packetId`、`PlayerDamageDetail.skillName`
- `CastEvent.job`、`CastEvent.targetPlayerId`
- `StatusSnapshot.targetPlayerId`
- 死接口 `TimelineExport`

`src/utils/fflogsImporter.ts` 里这些字段的写入改为局部变量，因为它们仍然在构造 key / DOT 关联 / 交叉验证里需要。

### 内存保留但 V2 不持久化的 3 个字段

这 3 个字段**继续存在于内存 `Timeline` 类型里**（不改类型），但**不进入 V2 格式**，并通过以下策略保证数据可用：

| 字段                           | 内存来源            | V2 处理     | hydrate 策略                                                                   |
| ------------------------------ | ------------------- | ----------- | ------------------------------------------------------------------------------ |
| `PlayerDamageDetail.job`       | fflogsImporter 写入 | 不出现在 V2 | 从 `composition.players[detail.playerId].job` 反查填入                         |
| `DamageEvent.packetId`         | fflogsImporter 写入 | 不出现在 V2 | 保持 `undefined` —— 只有 top100Sync 消费，top100Sync 永远看的是 fresh 内存对象 |
| `PlayerDamageDetail.abilityId` | fflogsImporter 写入 | 不出现在 V2 | 保持 `undefined` —— 同上                                                       |

**抽象漏洞**：从 V2 hydrate 的 Timeline 里，`DamageEvent.packetId` 和 `PlayerDamageDetail.abilityId` 为 `undefined`。此路径不存在消费方——top100Sync 处理的是 FFLogs import 新鲜产出的内存 Timeline，不是 V2 反序列化的。`hydrateFromV2` 的 JSDoc 会显式标注该边界。

**检索结果保障**：上述字段枚举在实施阶段通过 `top100Sync.ts`、`PlayerDamageDetails.tsx`、`Timeline/index.tsx`、`fflogsImporter.ts` 的完整 grep 审计得出。

**`TableDataRow.tsx:54-60`** 的 `getTankbusterDetail` 简化为：

```ts
function getTankbusterDetail(event: DamageEvent) {
  if (!event.playerDamageDetails || event.playerDamageDetails.length === 0) return undefined
  return event.playerDamageDetails[0]
}
```

## 边界行为

### 入站

| 入口                      | 处理                                                      |
| ------------------------- | --------------------------------------------------------- |
| `localStorage` load       | `parseFromAny(JSON.parse(raw))`                           |
| `GET /api/timelines/:id`  | Worker pass-through raw JSON；客户端 `parseFromAny`       |
| `POST /api/fflogs/import` | Worker 直接构造 V2 返回；客户端 `parseFromAny`（V2 分支） |
| `createEmptyTimeline`     | 直接构造内存 `Timeline`，不经过 V2                        |

**`parseFromAny` 流程**：

```ts
function parseFromAny(raw: unknown, runtimeFields: {...}): Timeline {
  if (!isPlainObject(raw)) throw new Error('invalid timeline')
  const v2 = (raw as { v?: unknown }).v === 2
    ? (raw as V2Timeline)
    : migrateV1ToV2(raw as V1Timeline)
  return hydrateFromV2(v2, runtimeFields)
}
```

### 出站

| 出口                     | 处理                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| `localStorage` save      | `toLocalStored(timeline)` → V2 核心 + 运行时元数据扁平合并       |
| `POST /api/timelines`    | `serializeForServer(timeline)` → 纯 V2（白名单，剥离运行时字段） |
| `PUT /api/timelines/:id` | 同上                                                             |

**`toLocalStored` / `serializeForServer` 的区别**：前者包含运行时字段（`id`、`isShared`、`serverVersion`、`hasLocalChanges`、`everPublished`、`statData`），后者不包含。两者都通过白名单**显式列出字段**，不使用 `...rest`。

## Worker 侧修改

### `src/workers/timelineSchema.ts` 整体替换

`TimelineSchema` 改写为 V2 shape：

```ts
import * as v from 'valibot'

const V2DamageEventSchema = v.object({
  n: v.pipe(v.string(), v.maxLength(DAMAGE_EVENT_NAME_MAX_LENGTH)),
  t: v.number(),
  d: v.number(),
  ty: v.picklist([0, 1]),
  dt: v.picklist([0, 1, 2]),
  st: v.optional(v.number()),
  pdd: v.optional(v.array(V2PlayerDamageDetailSchema)),
})

// ... 其余 schema 同理

export const V2TimelineSchema = v.object({
  v: v.literal(2),
  n: v.pipe(v.string(), v.maxLength(TIMELINE_NAME_MAX_LENGTH)),
  desc: v.optional(v.pipe(v.string(), v.maxLength(TIMELINE_DESCRIPTION_MAX_LENGTH))),
  fs: v.optional(V2FFLogsSourceSchema),
  gz: v.optional(v.number()),
  e: v.number(),
  c: v.array(v.string()),
  de: v.array(V2DamageEventSchema),
  ce: V2CastEventsSchema,
  an: v.optional(v.array(V2AnnotationSchema)),
  se: v.optional(v.array(V2SyncEventSchema)),
  r: v.optional(v.literal(1)),
  ca: v.number(),
  ua: v.number(),
})

export const CreateTimelineRequestSchema = v.object({
  timeline: V2TimelineSchema,
})
export const UpdateTimelineRequestSchema = v.object({
  timeline: V2TimelineSchema,
  expectedVersion: v.optional(v.number()),
})
```

**方案 α 严格拒绝 V1**：`v.literal(2)` 确保缺少 `v` 字段或值不是 2 的请求都会被 valibot 打回 400。

### `src/workers/timelines.ts` 路由

POST/PUT 路径只需继续调用 `validateCreateRequest` / `validateUpdateRequest`（已被替换为 V2 版本），无需其他改动。

GET 路径保持 **pass-through**：从 D1 读出 raw JSON text（可能是 V1 或 V2），直接返回给客户端，不走任何 schema 校验，由客户端 `parseFromAny` 处理。

### `src/workers/fflogsImportHandler.ts`

返回值改为 V2 格式：

```ts
const v2 = serializeForServer({
  ...内存构造的 Timeline,
})
return jsonResponse({ ...v2, v: 2 })
```

（实际实现可能共享 `serializeForServer` 或另写一个直接构造 V2 的工厂，取决于实施阶段的代码复用度。）

## 文件布局

### 新增文件

- `src/types/timelineV2.ts` —— V2 TypeScript 类型定义（纯类型，无 valibot）
- `src/utils/timelineFormat.ts` —— 转换函数入口：
  - `toV2(timeline: Timeline): V2Timeline`
  - `toLocalStored(timeline: Timeline): LocalStored`
  - `serializeForServer(timeline: Timeline): V2Timeline`
  - `hydrateFromV2(v2: V2Timeline, runtime: RuntimeFields): Timeline`
  - `parseFromAny(raw: unknown, runtime: RuntimeFields): Timeline`
  - `migrateV1ToV2(v1: V1Timeline): V2Timeline`
  - 以及 V1 的旧类型定义（`V1Timeline` / `V1DamageEvent` / ...），带 `// TODO(v2-sunset): ...` 注释
- `src/utils/timelineFormat.test.ts` —— 转换/迁移的单元测试
- `src/utils/shortId.ts` —— `nextShortId()` + `resetIdCounter()`

### 修改的文件

- `src/workers/timelineSchema.ts` —— 整体替换为 V2 valibot schema
- `src/workers/timelineSchema.test.ts` —— fixture 改为 V2 shape
- `src/workers/timelines.test.ts` —— POST/PUT fixture 改为 V2
- `src/workers/timelines.ts` —— GET 改为 pass-through（如现状非 pass-through）
- `src/workers/fflogsImportHandler.ts` —— 返回 V2 格式
- `src/utils/timelineStorage.ts` —— load 走 `parseFromAny`，save 走 `toLocalStored`
- `src/api/timelineShareApi.ts` —— POST/PUT 前调 `serializeForServer`；GET 后调 `parseFromAny`
- `src/types/timeline.ts` —— 删除死字段（`TimelineExport` 接口；`DamageEvent.packetId` / `targetPlayerId`；`PlayerDamageDetail.job/abilityId/sourceId/packetId`；`CastEvent.job/targetPlayerId`；`StatusSnapshot.targetPlayerId`）
- `src/components/TimelineTable/TableDataRow.tsx` —— 简化 `getTankbusterDetail`
- `src/utils/fflogsImporter.ts` —— 9 个死字段改为局部变量

### 不动的文件

- `src/store/timelineStore.ts` —— 内存操作对 V2 完全无感知
- `src/store/timelineStore.test.ts`
- `src/utils/exportExcel.ts` / `src/utils/soumaExporter.ts` —— 消费内存 Timeline
- `src/utils/exportExcel.test.ts` / `src/utils/soumaExporter.test.ts`
- `src/components/*`（除 `TableDataRow.tsx` 外）

## 测试策略

### 既有测试

| 文件                             | 处理                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers/timelineSchema.test.ts` | fixture 改 V2 shape                                                                                                                                                                           |
| `workers/timelines.test.ts`      | POST/PUT fixture 改 V2 shape                                                                                                                                                                  |
| `store/timelineStore.test.ts`    | 不动（测内存形态）                                                                                                                                                                            |
| `utils/exportExcel.test.ts`      | 不动                                                                                                                                                                                          |
| `utils/soumaExporter.test.ts`    | 不动                                                                                                                                                                                          |
| `utils/fflogsImporter.test.ts`   | 删除对 9 个死字段（`PlayerDamageDetail.abilityId/sourceId/packetId/job`、`DamageEvent.packetId/targetPlayerId`、`CastEvent.job/targetPlayerId`、`StatusSnapshot.targetPlayerId`）的 assertion |

### 新增测试 `src/utils/timelineFormat.test.ts`

必须覆盖的场景：

- V1 editor 模式 → migrate → hydrate → 内存 Timeline 的 roundtrip
- V1 replay 模式 → migrate → hydrate → 内存 Timeline 的 roundtrip
- V2 editor 模式 → hydrate → serialize → V2 的 identity roundtrip
- V2 replay 模式 → hydrate → serialize → V2 的 identity roundtrip
- Composition 稀疏槽的正确处理（删除中间玩家后尾部 truncate / 中间空槽保留）
- Composition 尾部 truncate 反序列化补足到 8
- CE 列式的双向转换，包括空 CE（`{a:[],t:[],p:[]}`）
- 空 `annotations`、`syncEvents`、`pdd` 的 optional 行为
- `parseFromAny` 对 `v === 2` vs 缺失 / `v === 1` 的分派
- `serializeForServer` 不泄漏运行时字段（`id`、`isShared`、`serverVersion`、...）
- `toLocalStored` 正确携带运行时字段
- `hydrateFromV2` 为 DE/CE/Annotation 发号后的 id 互不冲突
- `DamageEvent.targetPlayerId` 删除后的 `getTankbusterDetail` 在单 detail / 多 detail 情况下的回归

## 短 key 汇总表

| 位置               | Key    | 含义                | 类型                      |
| ------------------ | ------ | ------------------- | ------------------------- |
| Timeline           | `v`    | 版本号              | `2`                       |
| Timeline           | `n`    | name                | string                    |
| Timeline           | `desc` | description         | string?                   |
| Timeline           | `fs`   | fflogsSource        | `{rc, fi}`?               |
| Timeline           | `gz`   | gameZoneId          | number?                   |
| Timeline           | `e`    | encounterId         | number                    |
| Timeline           | `c`    | composition         | string[]                  |
| Timeline           | `de`   | damageEvents        | V2DamageEvent[]           |
| Timeline           | `ce`   | castEvents          | V2CastEvents              |
| Timeline           | `an`   | annotations         | V2Annotation[]?           |
| Timeline           | `se`   | syncEvents          | V2SyncEvent[]?            |
| Timeline           | `r`    | isReplayMode        | `1`?                      |
| Timeline           | `ca`   | createdAt           | number                    |
| Timeline           | `ua`   | updatedAt           | number                    |
| fflogsSource       | `rc`   | reportCode          | string                    |
| fflogsSource       | `fi`   | fightId             | number                    |
| DamageEvent        | `n`    | name                | string                    |
| DamageEvent        | `t`    | time                | number                    |
| DamageEvent        | `d`    | damage              | number                    |
| DamageEvent        | `ty`   | type                | 0\|1                      |
| DamageEvent        | `dt`   | damageType          | 0\|1\|2                   |
| DamageEvent        | `st`   | snapshotTime        | number?                   |
| DamageEvent        | `pdd`  | playerDamageDetails | PDD[]?                    |
| CastEvents         | `a`    | actionId 列         | number[]                  |
| CastEvents         | `t`    | timestamp 列        | number[]                  |
| CastEvents         | `p`    | playerId 列         | number[]                  |
| PlayerDamageDetail | `ts`   | timestamp           | number                    |
| PlayerDamageDetail | `p`    | playerId            | number                    |
| PlayerDamageDetail | `u`    | unmitigatedDamage   | number                    |
| PlayerDamageDetail | `f`    | finalDamage         | number                    |
| PlayerDamageDetail | `o`    | overkill            | number?                   |
| PlayerDamageDetail | `m`    | multiplier          | number?                   |
| PlayerDamageDetail | `hp`   | hitPoints           | number?                   |
| PlayerDamageDetail | `mhp`  | maxHitPoints        | number?                   |
| PlayerDamageDetail | `ss`   | statuses            | StatusSnapshot[]          |
| StatusSnapshot     | `s`    | statusId            | number                    |
| StatusSnapshot     | `ab`   | absorb              | number?                   |
| Annotation         | `x`    | text                | string                    |
| Annotation         | `t`    | time                | number                    |
| Annotation         | `k`    | anchor              | `0` \| `[number, number]` |
| SyncEvent          | `t`    | time                | number                    |
| SyncEvent          | `ty`   | type                | 0\|1                      |
| SyncEvent          | `a`    | actionId            | number                    |
| SyncEvent          | `nm`   | actionName          | string?                   |
| SyncEvent          | `w`    | window              | `[number, number]`        |
| SyncEvent          | `so`   | syncOnce            | `1`?                      |

## Follow-up（本次不做）

按"方案 ② sunset 计划"，本次只做 Step 1：

- **Step 2**（部署后 2-4 周观察）
- **Step 3**（D1 批量迁移脚本）：
  - 写一次性 Worker endpoint `/admin/migrate-v2`（需 auth），扫描 `timelines` 表 `data NOT LIKE '%"v":2%'` 的行，`migrate → serialize → UPDATE`
  - 或使用 `wrangler d1 execute` + 外部 Node 脚本批量处理
- **Step 4**（几个月后）：删除客户端 `src/utils/timelineFormat.ts` 中的 `V1Timeline` 类型和 `migrateV1ToV2` 函数。届时 IndexedDB 存量也基本通过自然使用完成升级。

## 风险与权衡

1. **GET pass-through 意味着 Worker 不对出站 JSON 做 schema 校验。** 如果 D1 里存了脏数据（理论上不该发生，因为所有入口都过 schema），客户端 `parseFromAny` 会抛错，需要有顶层 try/catch + 用户提示。
2. **方案 α 的窗口期中断。** 部署后到所有老客户端刷新之间，用户在旧 tab 上保存会得到 400。可接受——用户刷新即可恢复；发布 changelog 提示有感知即可。
3. **`e: number` 在 encounterId 查不到静态表时丢失元数据。** 由 `gz` 字段（FFLogs 导入时写入）回退覆盖，和现有 `soumaExporter.ts` 的容错逻辑一致。未来从 `raidEncounters.ts` 删除条目会让老时间轴丢失 `name`，但这种删除本来就不该发生（append-only 约定）。
4. **运行时 ID 计数器是进程级状态。** 单 store 单 timeline 的前提下没问题；如果未来引入多 timeline 并存，需要改为每个 Timeline 实例持有自己的计数器。不在本次范围。
5. **V1 类型污染了 `timelineFormat.ts`**。Sunset Step 4 完成后可清理。

## 预期收益

相对 V1 原始 JSON：

- **Editor 模式**（50 DE + 200 CE，无 pdd）：约 **40–55%** 缩减
  - CE 列式：3 key × 200 → 3 key total
  - DE 短 key + 去死字段：每条节省 50% 左右字节
  - Composition 紧凑
- **Replay 模式**（50 DE × 8 pdd × ~4 status，带 pdd）：约 **45–60%** 缩减
  - PDD 的 `job/skillName/abilityId/sourceId/packetId` 完全去除
  - PDD 短 key
  - DE / CE 同编辑模式收益

Worker `POST /api/fflogs/import` 的返回值由此从几百 KB 量级下降到几十 KB 量级，是本次优化的最大单点收益。
