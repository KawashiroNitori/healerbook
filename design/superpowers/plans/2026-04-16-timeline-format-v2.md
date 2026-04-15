# Timeline 持久化格式 V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Timeline 的持久化格式（localStorage / D1 / FFLogs import 返回）从 V1 长字段名、含冗余死字段的对象形态，切换到 V2 短字段名、列式 CE、去冗余的紧凑形态，内存形态保持不变。

**Architecture:** V2 只存在于持久化边界。内存继续使用现有 `Timeline` 类型。一个集中模块（`src/utils/timelineFormat.ts`）提供 `toV2` / `hydrateFromV2` / `parseFromAny` / `migrateV1ToV2` / `serializeForServer` / `toLocalStored`。Worker 的 POST/PUT 严格接受 V2（`v.literal(2)` 校验），GET 保持 pass-through。前端在所有入站点调 `parseFromAny` 检测 V1 并静默升级。

**Tech Stack:** TypeScript 5.9, Vitest 4, valibot, Cloudflare Workers（D1 + KV），Zustand 5, nanoid, Tailwind v3, React 19。

**Spec 链接:** `design/superpowers/specs/2026-04-16-timeline-format-v2-design.md`

---

## 文件清单

### 新增

- `src/utils/shortId.ts` —— 模块级单调 id 生成器
- `src/utils/shortId.test.ts`
- `src/types/timelineV2.ts` —— V2 TypeScript 类型（纯类型，无逻辑）
- `src/utils/timelineFormat.ts` —— 所有版本转换逻辑（含 V1 旧类型 + migrate）
- `src/utils/timelineFormat.test.ts`

### 修改

- `src/types/timeline.ts` —— 删除死字段与死接口
- `src/components/TimelineTable/TableDataRow.tsx` —— 简化 `getTankbusterDetail`
- `src/utils/fflogsImporter.ts` —— 9 个死字段改为局部变量
- `src/utils/fflogsImporter.test.ts` —— 删除对死字段的 assertion
- `src/workers/timelineSchema.ts` —— 整体替换为 V2 valibot schema
- `src/workers/timelineSchema.test.ts` —— fixture 改为 V2 shape
- `src/workers/timelines.test.ts` —— POST/PUT fixture 改为 V2 shape
- `src/workers/fflogsImportHandler.ts` —— 构造 V2 返回
- `src/utils/timelineStorage.ts` —— load/save 走 `parseFromAny` / `toLocalStored`
- `src/api/timelineShareApi.ts` —— POST/PUT 走 `serializeForServer`；GET 走 `parseFromAny`
- `src/components/ImportFFLogsDialog.tsx` —— 导入返回走 `parseFromAny`

### 不动

- `src/workers/timelines.ts` —— GET 已经是 pass-through（`rowToSharedTimeline` 不做 schema 校验）
- `src/store/timelineStore.ts` —— 内存操作对 V2 无感知；`applyServerTimeline` 消费的是已解析的 Timeline
- `src/store/timelineStore.test.ts`
- `src/utils/exportExcel.ts` / `src/utils/soumaExporter.ts` 及其测试 —— 消费内存 Timeline
- `src/pages/EditorPage.tsx` —— 消费 `fetchSharedTimeline` 的结果类型不变（内部已由 API 层解析）

---

## 短 key 对照表（参考）

| V1 字段                                                                                                                    | V2 短 key                                |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `name`                                                                                                                     | `n`                                      |
| `description`                                                                                                              | `desc`                                   |
| `fflogsSource.reportCode` / `fightId`                                                                                      | `fs.rc` / `fs.fi`                        |
| `gameZoneId`                                                                                                               | `gz`                                     |
| `encounter.id`                                                                                                             | `e`                                      |
| `composition.players[i].job`                                                                                               | `c[i]`                                   |
| `damageEvents`                                                                                                             | `de`                                     |
| `castEvents`                                                                                                               | `ce`                                     |
| `annotations`                                                                                                              | `an`                                     |
| `syncEvents`                                                                                                               | `se`                                     |
| `isReplayMode: true`                                                                                                       | `r: 1`                                   |
| `createdAt` / `updatedAt`                                                                                                  | `ca` / `ua`                              |
| DE `name`/`time`/`damage`/`type`/`damageType`/`snapshotTime`/`playerDamageDetails`                                         | `n`/`t`/`d`/`ty`/`dt`/`st`/`pdd`         |
| DE `type: 'aoe'/'tankbuster'`                                                                                              | `ty: 0/1`                                |
| DE `damageType: 'physical'/'magical'/'darkness'`                                                                           | `dt: 0/1/2`                              |
| PDD `timestamp`/`playerId`/`unmitigatedDamage`/`finalDamage`/`overkill`/`multiplier`/`hitPoints`/`maxHitPoints`/`statuses` | `ts`/`p`/`u`/`f`/`o`/`m`/`hp`/`mhp`/`ss` |
| StatusSnapshot `statusId`/`absorb`                                                                                         | `s`/`ab`                                 |
| CE（列式）                                                                                                                 | `{a:number[], t:number[], p:number[]}`   |
| Annotation `text`/`time`/`anchor`                                                                                          | `x`/`t`/`k`（`0` or `[p, a]`）           |
| SyncEvent `time`/`type`/`actionId`/`actionName`/`window`/`syncOnce`                                                        | `t`/`ty`/`a`/`nm`/`w`/`so`               |
| SyncEvent `type: 'begincast'/'cast'`                                                                                       | `ty: 0/1`                                |

---

## Task 1: 短 ID 生成器

**Files:**

- Create: `src/utils/shortId.ts`
- Create: `src/utils/shortId.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/shortId.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { nextShortId, resetIdCounter } from './shortId'

describe('shortId', () => {
  beforeEach(() => {
    resetIdCounter()
  })

  it('nextShortId 连续调用返回递增唯一 id', () => {
    const ids = [nextShortId(), nextShortId(), nextShortId()]
    expect(ids).toEqual(['e0', 'e1', 'e2'])
    expect(new Set(ids).size).toBe(3)
  })

  it('resetIdCounter 将计数器清零', () => {
    nextShortId()
    nextShortId()
    resetIdCounter()
    expect(nextShortId()).toBe('e0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/utils/shortId.test.ts`
Expected: FAIL — `Cannot find module './shortId'`

- [ ] **Step 3: Implement shortId**

```ts
// src/utils/shortId.ts
/**
 * 模块级单调 id 生成器，用于 Timeline 内部对象（DamageEvent / CastEvent / Annotation）
 * 的运行时 id。这些 id 不进入持久化格式，每次反序列化时重新生成。
 */
let counter = 0

export function nextShortId(): string {
  return `e${counter++}`
}

export function resetIdCounter(): void {
  counter = 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/utils/shortId.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/shortId.ts src/utils/shortId.test.ts
git commit -m "feat(timeline): 引入模块级单调 id 生成器 shortId"
```

---

## Task 2: V2 类型定义

**Files:**

- Create: `src/types/timelineV2.ts`

- [ ] **Step 1: Create the V2 types file**

```ts
// src/types/timelineV2.ts
/**
 * Timeline 持久化格式 V2 类型定义
 *
 * 本文件只包含纯类型，不含运行逻辑。所有转换函数位于
 * `src/utils/timelineFormat.ts`。
 *
 * 设计文档：design/superpowers/specs/2026-04-16-timeline-format-v2-design.md
 */

export interface V2FFLogsSource {
  /** reportCode */
  rc: string
  /** fightId */
  fi: number
}

export interface V2StatusSnapshot {
  /** statusId */
  s: number
  /** absorb（盾值类状态专用） */
  ab?: number
}

export interface V2PlayerDamageDetail {
  /** timestamp（毫秒） */
  ts: number
  /** playerId */
  p: number
  /** unmitigatedDamage */
  u: number
  /** finalDamage */
  f: number
  /** overkill */
  o?: number
  /** multiplier */
  m?: number
  /** hitPoints */
  hp?: number
  /** maxHitPoints */
  mhp?: number
  /** statuses */
  ss: V2StatusSnapshot[]
}

export interface V2DamageEvent {
  /** name */
  n: string
  /** time（秒） */
  t: number
  /** damage */
  d: number
  /** type: 0=aoe, 1=tankbuster */
  ty: 0 | 1
  /** damageType: 0=physical, 1=magical, 2=darkness */
  dt: 0 | 1 | 2
  /** snapshotTime（DOT 快照） */
  st?: number
  /** playerDamageDetails（replay 模式专用） */
  pdd?: V2PlayerDamageDetail[]
}

export interface V2CastEvents {
  /** actionId 列 */
  a: number[]
  /** timestamp 列 */
  t: number[]
  /** playerId 列 */
  p: number[]
}

/** Annotation anchor：0=damageTrack，[playerId, actionId]=skillTrack */
export type V2AnnotationAnchor = 0 | [number, number]

export interface V2Annotation {
  /** text */
  x: string
  /** time（秒） */
  t: number
  /** anchor */
  k: V2AnnotationAnchor
}

export interface V2SyncEvent {
  /** time */
  t: number
  /** type: 0=begincast, 1=cast */
  ty: 0 | 1
  /** actionId */
  a: number
  /** actionName；仅在 abilityMap 查不到时作为 fallback 存入 */
  nm?: string
  /** window [before, after] */
  w: [number, number]
  /** syncOnce；false 时字段缺席 */
  so?: 1
}

export interface V2Timeline {
  v: 2
  /** name */
  n: string
  /** description */
  desc?: string
  /** fflogsSource */
  fs?: V2FFLogsSource
  /** gameZoneId */
  gz?: number
  /** encounterId（由 raidEncounters.ts 反查元数据） */
  e: number
  /** composition：固定 8 槽稀疏数组，下标 = playerId，空槽用 ""，允许尾部 truncate */
  c: string[]
  /** damageEvents */
  de: V2DamageEvent[]
  /** castEvents（列式） */
  ce: V2CastEvents
  /** annotations */
  an?: V2Annotation[]
  /** syncEvents */
  se?: V2SyncEvent[]
  /** isReplayMode；false 时字段缺席 */
  r?: 1
  /** createdAt */
  ca: number
  /** updatedAt */
  ua: number
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/timelineV2.ts
git commit -m "feat(timeline): 添加 V2 持久化格式类型定义"
```

---

## Task 3: 清理 Timeline 内存类型中的死字段

**Files:**

- Modify: `src/types/timeline.ts`
- Modify: `src/components/TimelineTable/TableDataRow.tsx:54-60`

这一步**纯类型清理**，目的是把 runtime 零消费的字段从类型里去掉，让后续的 V2 转换更干净。由于这些字段本就没有消费路径，删除后 `pnpm exec tsc --noEmit` 和业务测试应全部通过。

删除以下字段：

| 类型                 | 字段                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `DamageEvent`        | `packetId`、`targetPlayerId`、`abilityId`（`abilityId` 当前已被 schema strip，但类型上还保留作为 "采集阶段"字段，也可一起删） |
| `PlayerDamageDetail` | `job`、`abilityId`、`sourceId`、`packetId`                                                                                    |
| `StatusSnapshot`     | `targetPlayerId`                                                                                                              |
| `CastEvent`          | `job`、`targetPlayerId`                                                                                                       |
| 整个死接口           | `TimelineExport`（全仓零引用）                                                                                                |

- [ ] **Step 1: Remove dead fields from `src/types/timeline.ts`**

Open `src/types/timeline.ts`，按下述清单删除对应字段与相关 JSDoc。保留其他字段原样。

```ts
// StatusSnapshot
export interface StatusSnapshot {
  statusId: number
  absorb?: number
}

// PlayerDamageDetail
export interface PlayerDamageDetail {
  timestamp: number
  playerId: number
  unmitigatedDamage: number
  finalDamage: number
  overkill?: number
  multiplier?: number
  statuses: StatusSnapshot[]
  hitPoints?: number
  maxHitPoints?: number
  snapshotTimestamp?: number
}

// DamageEvent
export interface DamageEvent {
  id: string
  name: string
  time: number
  damage: number
  type: DamageEventType
  damageType: DamageType
  playerDamageDetails?: PlayerDamageDetail[]
  snapshotTime?: number
}

// CastEvent
export interface CastEvent {
  id: string
  actionId: number
  timestamp: number
  playerId: number
}
```

同时删除 `TimelineExport` 接口（`src/types/timeline.ts:257-264` 附近）。

- [ ] **Step 2: Simplify `getTankbusterDetail` in `TableDataRow.tsx`**

Replace `src/components/TimelineTable/TableDataRow.tsx:54-60`:

```ts
/**
 * 提取死刑行的目标坦克伤害详情（仅回放模式下可用）
 */
function getTankbusterDetail(event: DamageEvent) {
  if (!event.playerDamageDetails || event.playerDamageDetails.length === 0) return undefined
  return event.playerDamageDetails[0]
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: may fail with errors in `src/utils/fflogsImporter.ts` pointing to the deleted fields (e.g. `packetId` / `sourceId` / `abilityId` / `job` not assignable）——下一个 task 处理。

如果错误只在 `fflogsImporter.ts`、`fflogsImporter.test.ts` 或 `top100Sync.ts` 中，这是预期的；继续下一步。如果有别处的错误，需要排查是否漏了消费点。

- [ ] **Step 4: Commit (even with transient fflogsImporter typeerrors)**

提交这一步需要先把下一步也做完一起提交，因为 tsc 会失败。**把 Task 3 + Task 4 合并为一次提交**。

跳到 Task 4，完成后统一提交。

---

## Task 4: 清理 `fflogsImporter.ts` 的死字段写入

**Files:**

- Modify: `src/utils/fflogsImporter.ts`
- Modify: `src/utils/fflogsImporter.test.ts`

- [ ] **Step 1: 改 `fflogsImporter.ts` 中的写入点**

定位以下位置（行号可能因前一次 task 编辑略有偏移，使用函数名/字符串搜索）：

1. **`parseDamageEvents` 循环内构造 detail 的地方**（约 `src/utils/fflogsImporter.ts:160-175`）：

原代码类似：

```ts
const detail: PlayerDamageDetail = {
  timestamp: event.timestamp,
  packetId: event.packetID,
  sourceId: event.sourceID || 0,
  playerId: ...,
  job: ...,
  abilityId,
  skillName: ...,
  ...
}
```

改为：

```ts
const detail: PlayerDamageDetail = {
  timestamp: event.timestamp,
  playerId: ...,
  unmitigatedDamage: ...,
  finalDamage: ...,
  statuses: [],
  // ... 其他仍保留在 PlayerDamageDetail 类型中的字段
}
```

**但保留局部变量** `packetId`, `sourceId`, `abilityId`, `job`, `skillName` 因为它们还要用于构造去重 key、DOT 关联、交叉验证：

```ts
const packetId = event.packetID
const sourceId = event.sourceID || 0
const abilityId = event.abilityGameID ?? 0
const skillName = getActionChinese(abilityId) || abilityMap?.get(abilityId)?.name || ''
```

这些变量继续在其出现的 key 构造（`${ts}-${detail.playerId}-${sourceId}-${abilityId}`、`${abilityId}-${playerId}`、`event-${timestamp}-${abilityId}` 等）中使用，但**不写入 Timeline**。

2. **`DamageEvent` 构造**（约 `src/utils/fflogsImporter.ts:326-335`）：

原代码类似：

```ts
const event: DamageEvent = {
  id: `event-${firstDetail.timestamp}-${firstDetail.abilityId}`,
  name: ...,
  time: ...,
  damage: ...,
  type: ...,
  damageType: ...,
  targetPlayerId: ...,
  packetId: firstDetail.packetId,
  playerDamageDetails: details,
}
```

改为：

```ts
const event: DamageEvent = {
  id: `event-${firstDetail.timestamp}-${abilityId}`,  // abilityId 来自局部变量
  name: ...,
  time: ...,
  damage: ...,
  type: ...,
  damageType: ...,
  playerDamageDetails: details,
}
```

删除 `targetPlayerId` 和 `packetId` 两行。

3. **`StatusSnapshot` 构造**（约 `src/utils/fflogsImporter.ts:204-212`）：

```ts
detail.statuses.push({
  statusId,
  absorb: undefined, // 或具体的 absorb 值
})
```

删除 `targetPlayerId` 一行。

4. **`CastEvent` 构造**（约 `src/utils/fflogsImporter.ts:469-476`）：

```ts
castEventsResult.push({
  id: `cast-${castEventsResult.length}`,
  actionId: effectiveAbilityId,
  timestamp: (event.timestamp - fightStartTime) / 1000,
  playerId: event.sourceID,
})
```

删除 `job` 和 `targetPlayerId` 两行。

5. **aoe/tankbuster 交叉验证函数**（约 `src/utils/fflogsImporter.ts:390-410`）：

现在代码从 `event.playerDamageDetails?.[0]?.abilityId` 取值。改为在 `parseDamageEvents` 内部把 abilityId 作为一个独立的、和 `DamageEvent` 平行的结构记录下来，比如在返回值上挂 `events: DamageEvent[]` 和 `abilityIdByEventId: Map<string, number>`。

更简单的做法：把 `classifyEventTypes` 挪到 `parseDamageEvents` 内部，让它在 `DamageEvent` 对象还没被最终 push 之前就做分类，此时 `abilityId` 还在局部变量作用域里。

选最小改动：在 `parseDamageEvents` 生成 `DamageEvent` 时同时 push 一个 `[event, abilityId]` pair 到一个内部数组，分类完成后再把纯 `DamageEvent[]` 返回。

具体：

```ts
// 在 parseDamageEvents 内部
const eventsWithAbility: Array<{ event: DamageEvent; abilityId: number }> = []

// 构造 event 的地方：
const damageEvent: DamageEvent = {
  /* no abilityId */
}
eventsWithAbility.push({ event: damageEvent, abilityId })

// 在原 classifyEventTypes(events) 之前：
classifyEventTypesWithAbility(eventsWithAbility)
return eventsWithAbility.map(x => x.event)
```

然后 `classifyEventTypesWithAbility` 签名改为 `(items: Array<{event, abilityId}>)`，内部用 `item.abilityId` 而不是 `item.event.playerDamageDetails?.[0]?.abilityId`。

- [ ] **Step 2: 改 `fflogsImporter.test.ts`**

在测试文件里搜索 `abilityId`、`sourceId`、`packetId`、`job`（PlayerDamageDetail 上下文）、`targetPlayerId`（DamageEvent/CastEvent/StatusSnapshot 上下文），删除对这些字段的 assertion。

特别关注 `fflogsImporter.test.ts:880-881`：

```ts
expect(tankDetail?.statuses[0].statusId).toBe(1362)
expect(tankDetail?.statuses[0].absorb).toBe(500)
```

这两行**保留**（测的是还在的字段）。

- [ ] **Step 3: Run typecheck and tests**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Run: `pnpm test:run src/utils/fflogsImporter.test.ts`
Expected: PASS.

Run: `pnpm test:run`（全量）
Expected: PASS，或仅 `timelineSchema.test.ts` / `timelines.test.ts` 有与 V1→V2 schema 无关的失败（如果有，说明遗漏了消费点，需要排查）。

- [ ] **Step 4: Commit（合并 Task 3 + Task 4）**

```bash
git add src/types/timeline.ts src/components/TimelineTable/TableDataRow.tsx src/utils/fflogsImporter.ts src/utils/fflogsImporter.test.ts
git commit -m "refactor(timeline): 移除 runtime 零消费的 9 个死字段"
```

---

## Task 5: V2 转换函数：`toV2` + `hydrateFromV2` + `serializeForServer` + `toLocalStored`

**Files:**

- Create: `src/utils/timelineFormat.ts`
- Create: `src/utils/timelineFormat.test.ts`

这一步实现"内存 → V2"和"V2 → 内存"的双向转换，暂不包含 V1 迁移。V1 迁移在下一个 task。

- [ ] **Step 1: Write failing tests for `toV2` + `hydrateFromV2` roundtrip**

```ts
// src/utils/timelineFormat.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { Timeline } from '@/types/timeline'
import { toV2, hydrateFromV2, serializeForServer, toLocalStored } from './timelineFormat'
import { resetIdCounter } from './shortId'

function makeEditorTimeline(): Timeline {
  return {
    id: 'tl_xxx',
    name: 'M9S 进度轴',
    description: '治疗分配',
    encounter: {
      id: 101,
      name: 'M9S',
      displayName: '致命美人',
      zone: '',
      damageEvents: [],
    },
    gameZoneId: 1321,
    composition: {
      players: [
        { id: 0, job: 'PLD' },
        { id: 1, job: 'WAR' },
        { id: 2, job: 'WHM' },
        { id: 3, job: 'SCH' },
        { id: 4, job: 'DRG' },
        { id: 5, job: 'NIN' },
        { id: 6, job: 'BRD' },
        { id: 7, job: 'BLM' },
      ],
    },
    damageEvents: [
      {
        id: 'e0',
        name: '死刑',
        time: 10,
        damage: 120000,
        type: 'tankbuster',
        damageType: 'physical',
      },
      {
        id: 'e1',
        name: '分摊',
        time: 15,
        damage: 80000,
        type: 'aoe',
        damageType: 'magical',
        snapshotTime: 14.5,
      },
    ],
    castEvents: [
      { id: 'e2', actionId: 7432, timestamp: 5, playerId: 2 },
      { id: 'e3', actionId: 7433, timestamp: 8, playerId: 3 },
    ],
    statusEvents: [],
    annotations: [
      { id: 'e4', text: 'remind', time: 20, anchor: { type: 'damageTrack' } },
      {
        id: 'e5',
        text: 'WHM 礼仪',
        time: 25,
        anchor: { type: 'skillTrack', playerId: 2, actionId: 7432 },
      },
    ],
    createdAt: 1000,
    updatedAt: 2000,
  }
}

describe('toV2 / hydrateFromV2 (editor mode)', () => {
  beforeEach(() => resetIdCounter())

  it('editor timeline roundtrip 保留所有用户可见信息', () => {
    const tl = makeEditorTimeline()
    const v2 = toV2(tl)
    expect(v2.v).toBe(2)
    expect(v2.n).toBe('M9S 进度轴')
    expect(v2.desc).toBe('治疗分配')
    expect(v2.e).toBe(101)
    expect(v2.gz).toBe(1321)
    expect(v2.c).toEqual(['PLD', 'WAR', 'WHM', 'SCH', 'DRG', 'NIN', 'BRD', 'BLM'])
    expect(v2.de.length).toBe(2)
    expect(v2.de[0]).toMatchObject({ n: '死刑', t: 10, d: 120000, ty: 1, dt: 0 })
    expect(v2.de[1]).toMatchObject({ n: '分摊', t: 15, d: 80000, ty: 0, dt: 1, st: 14.5 })
    expect(v2.ce).toEqual({
      a: [7432, 7433],
      t: [5, 8],
      p: [2, 3],
    })
    expect(v2.an).toHaveLength(2)
    expect(v2.an?.[0]).toMatchObject({ x: 'remind', t: 20, k: 0 })
    expect(v2.an?.[1]).toMatchObject({ x: 'WHM 礼仪', t: 25, k: [2, 7432] })
    expect(v2.r).toBeUndefined()
    expect(v2.ca).toBe(1000)
    expect(v2.ua).toBe(2000)

    const back = hydrateFromV2(v2, { id: 'tl_xxx' })
    expect(back.id).toBe('tl_xxx')
    expect(back.name).toBe('M9S 进度轴')
    expect(back.description).toBe('治疗分配')
    expect(back.encounter.id).toBe(101)
    expect(back.gameZoneId).toBe(1321)
    expect(back.composition.players).toHaveLength(8)
    expect(back.composition.players[2]).toEqual({ id: 2, job: 'WHM' })
    expect(back.damageEvents).toHaveLength(2)
    expect(back.damageEvents[0]).toMatchObject({
      name: '死刑',
      time: 10,
      damage: 120000,
      type: 'tankbuster',
      damageType: 'physical',
    })
    expect(back.damageEvents[1].snapshotTime).toBe(14.5)
    expect(back.castEvents).toHaveLength(2)
    expect(back.castEvents[0]).toMatchObject({ actionId: 7432, timestamp: 5, playerId: 2 })
    expect(back.annotations).toHaveLength(2)
    expect(back.annotations[0].anchor).toEqual({ type: 'damageTrack' })
    expect(back.annotations[1].anchor).toEqual({
      type: 'skillTrack',
      playerId: 2,
      actionId: 7432,
    })
  })

  it('hydrate 时为 DE/CE/Annotation 发号不冲突', () => {
    const tl = makeEditorTimeline()
    const v2 = toV2(tl)
    const back = hydrateFromV2(v2, { id: 'tl_xxx' })
    const ids = [
      ...back.damageEvents.map(e => e.id),
      ...back.castEvents.map(e => e.id),
      ...(back.annotations ?? []).map(a => a.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('composition 中间空槽在 roundtrip 后保留空位', () => {
    const tl = makeEditorTimeline()
    tl.composition.players = [
      { id: 0, job: 'PLD' },
      { id: 2, job: 'WHM' },
      { id: 4, job: 'DRG' },
    ]
    const v2 = toV2(tl)
    expect(v2.c).toEqual(['PLD', '', 'WHM', '', 'DRG'])
    const back = hydrateFromV2(v2, { id: 'tl_xxx' })
    expect(back.composition.players).toEqual([
      { id: 0, job: 'PLD' },
      { id: 2, job: 'WHM' },
      { id: 4, job: 'DRG' },
    ])
  })

  it('composition 尾部 truncate 反序列化补足到 8', () => {
    const v2Base = toV2(makeEditorTimeline())
    const v2 = { ...v2Base, c: ['PLD', 'WAR', 'WHM'] }
    const back = hydrateFromV2(v2, { id: 'tl_xxx' })
    expect(back.composition.players).toEqual([
      { id: 0, job: 'PLD' },
      { id: 1, job: 'WAR' },
      { id: 2, job: 'WHM' },
    ])
  })

  it('空 CE / 空 annotations / 无 syncEvents 正常处理', () => {
    const tl: Timeline = {
      ...makeEditorTimeline(),
      castEvents: [],
      annotations: [],
    }
    const v2 = toV2(tl)
    expect(v2.ce).toEqual({ a: [], t: [], p: [] })
    expect(v2.an).toBeUndefined()
    const back = hydrateFromV2(v2, { id: 'tl_xxx' })
    expect(back.castEvents).toEqual([])
    expect(back.annotations).toEqual([])
  })
})

describe('toV2 / hydrateFromV2 (replay mode)', () => {
  beforeEach(() => resetIdCounter())

  it('replay timeline 保留 pdd 与 status 数据', () => {
    const tl: Timeline = {
      ...makeEditorTimeline(),
      isReplayMode: true,
      damageEvents: [
        {
          id: 'd1',
          name: '死刑',
          time: 10,
          damage: 120000,
          type: 'tankbuster',
          damageType: 'physical',
          playerDamageDetails: [
            {
              timestamp: 123456,
              playerId: 0,
              unmitigatedDamage: 120000,
              finalDamage: 60000,
              statuses: [{ statusId: 1001 }, { statusId: 1002, absorb: 5000 }],
              hitPoints: 50000,
              maxHitPoints: 80000,
            },
          ],
        },
      ],
    }
    const v2 = toV2(tl)
    expect(v2.r).toBe(1)
    expect(v2.de[0].pdd).toHaveLength(1)
    expect(v2.de[0].pdd?.[0]).toEqual({
      ts: 123456,
      p: 0,
      u: 120000,
      f: 60000,
      hp: 50000,
      mhp: 80000,
      ss: [{ s: 1001 }, { s: 1002, ab: 5000 }],
    })

    const back = hydrateFromV2(v2, { id: 'tl_xxx' })
    expect(back.isReplayMode).toBe(true)
    const detail = back.damageEvents[0].playerDamageDetails![0]
    expect(detail.timestamp).toBe(123456)
    expect(detail.playerId).toBe(0)
    expect(detail.unmitigatedDamage).toBe(120000)
    expect(detail.finalDamage).toBe(60000)
    expect(detail.hitPoints).toBe(50000)
    expect(detail.maxHitPoints).toBe(80000)
    expect(detail.statuses).toEqual([{ statusId: 1001 }, { statusId: 1002, absorb: 5000 }])
  })
})

describe('serializeForServer / toLocalStored', () => {
  beforeEach(() => resetIdCounter())

  it('serializeForServer 不包含运行时字段', () => {
    const tl: Timeline = {
      ...makeEditorTimeline(),
      isShared: true,
      serverVersion: 3,
      hasLocalChanges: false,
      everPublished: true,
    }
    const v2 = serializeForServer(tl)
    expect(v2).not.toHaveProperty('id')
    expect(v2).not.toHaveProperty('isShared')
    expect(v2).not.toHaveProperty('serverVersion')
    expect(v2).not.toHaveProperty('hasLocalChanges')
    expect(v2).not.toHaveProperty('everPublished')
    expect(v2).not.toHaveProperty('statData')
  })

  it('toLocalStored 携带运行时字段', () => {
    const tl: Timeline = {
      ...makeEditorTimeline(),
      isShared: true,
      serverVersion: 3,
      hasLocalChanges: false,
      everPublished: true,
    }
    const stored = toLocalStored(tl)
    expect(stored.v).toBe(2)
    expect(stored.id).toBe('tl_xxx')
    expect(stored.isShared).toBe(true)
    expect(stored.serverVersion).toBe(3)
    expect(stored.hasLocalChanges).toBe(false)
    expect(stored.everPublished).toBe(true)
    // V2 核心字段也在
    expect(stored.n).toBe('M9S 进度轴')
    expect(stored.de).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run src/utils/timelineFormat.test.ts`
Expected: FAIL — `Cannot find module './timelineFormat'`

- [ ] **Step 3: Implement `timelineFormat.ts`（V2 部分，不含 V1 migrate）**

```ts
// src/utils/timelineFormat.ts
/**
 * Timeline 持久化格式转换层。
 *
 * 职责：
 * - toV2 / hydrateFromV2：内存 Timeline ↔ V2
 * - serializeForServer：内存 Timeline → V2（不含运行时字段，用于 POST/PUT）
 * - toLocalStored：内存 Timeline → V2 + 运行时字段扁平合并（用于 localStorage）
 * - migrateV1ToV2：旧格式升级到 V2（在后续 task 中补充）
 * - parseFromAny：入站万能入口（在后续 task 中补充）
 *
 * 设计：design/superpowers/specs/2026-04-16-timeline-format-v2-design.md
 */

import type {
  Annotation,
  CastEvent,
  Composition,
  DamageEvent,
  PlayerDamageDetail,
  StatusSnapshot,
  SyncEvent,
  Timeline,
  DamageType,
  DamageEventType,
  Job,
} from '@/types/timeline'
import type { TimelineStatData } from '@/types/statData'
import type {
  V2Annotation,
  V2CastEvents,
  V2DamageEvent,
  V2PlayerDamageDetail,
  V2StatusSnapshot,
  V2SyncEvent,
  V2Timeline,
} from '@/types/timelineV2'
import { DAMAGE_TYPES, DAMAGE_EVENT_TYPES, MAX_PARTY_SIZE } from '@/types/timeline'
import { getEncounterById } from '@/data/raidEncounters'
import { generateId } from '@/utils/id'
import { nextShortId, resetIdCounter } from '@/utils/shortId'

// ──────────────────────────────────────────────────────────────────
// 枚举映射
// ──────────────────────────────────────────────────────────────────

const DAMAGE_EVENT_TYPE_TO_NUM: Record<DamageEventType, 0 | 1> = {
  aoe: 0,
  tankbuster: 1,
}
const NUM_TO_DAMAGE_EVENT_TYPE: Record<0 | 1, DamageEventType> = ['aoe', 'tankbuster']

const DAMAGE_TYPE_TO_NUM: Record<DamageType, 0 | 1 | 2> = {
  physical: 0,
  magical: 1,
  darkness: 2,
}
const NUM_TO_DAMAGE_TYPE: Record<0 | 1 | 2, DamageType> = ['physical', 'magical', 'darkness']

const SYNC_TYPE_TO_NUM: Record<'begincast' | 'cast', 0 | 1> = {
  begincast: 0,
  cast: 1,
}
const NUM_TO_SYNC_TYPE: Record<0 | 1, 'begincast' | 'cast'> = ['begincast', 'cast']

// ──────────────────────────────────────────────────────────────────
// 内存 → V2
// ──────────────────────────────────────────────────────────────────

function toV2StatusSnapshot(s: StatusSnapshot): V2StatusSnapshot {
  const out: V2StatusSnapshot = { s: s.statusId }
  if (s.absorb !== undefined) out.ab = s.absorb
  return out
}

function toV2PlayerDamageDetail(d: PlayerDamageDetail): V2PlayerDamageDetail {
  const out: V2PlayerDamageDetail = {
    ts: d.timestamp,
    p: d.playerId,
    u: d.unmitigatedDamage,
    f: d.finalDamage,
    ss: d.statuses.map(toV2StatusSnapshot),
  }
  if (d.overkill !== undefined) out.o = d.overkill
  if (d.multiplier !== undefined) out.m = d.multiplier
  if (d.hitPoints !== undefined) out.hp = d.hitPoints
  if (d.maxHitPoints !== undefined) out.mhp = d.maxHitPoints
  return out
}

function toV2DamageEvent(e: DamageEvent): V2DamageEvent {
  const out: V2DamageEvent = {
    n: e.name,
    t: e.time,
    d: e.damage,
    ty: DAMAGE_EVENT_TYPE_TO_NUM[e.type],
    dt: DAMAGE_TYPE_TO_NUM[e.damageType],
  }
  if (e.snapshotTime !== undefined) out.st = e.snapshotTime
  if (e.playerDamageDetails && e.playerDamageDetails.length > 0) {
    out.pdd = e.playerDamageDetails.map(toV2PlayerDamageDetail)
  }
  return out
}

function toV2CastEvents(events: CastEvent[]): V2CastEvents {
  // 排序保证列式持久化的稳定性
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
  return {
    a: sorted.map(e => e.actionId),
    t: sorted.map(e => e.timestamp),
    p: sorted.map(e => e.playerId),
  }
}

function toV2Annotation(a: Annotation): V2Annotation {
  return {
    x: a.text,
    t: a.time,
    k: a.anchor.type === 'damageTrack' ? 0 : [a.anchor.playerId, a.anchor.actionId],
  }
}

function toV2SyncEvent(e: SyncEvent): V2SyncEvent {
  const out: V2SyncEvent = {
    t: e.time,
    ty: SYNC_TYPE_TO_NUM[e.type],
    a: e.actionId,
    w: e.window,
  }
  if (e.actionName && !e.actionName.startsWith('unknown_')) {
    // 可查 abilityMap 时省略，反序列化时回填
    // 简化：全部存入，成本可忽略
    out.nm = e.actionName
  } else if (e.actionName) {
    out.nm = e.actionName
  }
  if (e.syncOnce) out.so = 1
  return out
}

function compositionToV2(c: Composition): string[] {
  const slots = Array<string>(MAX_PARTY_SIZE).fill('')
  for (const p of c.players) {
    if (p.id >= 0 && p.id < MAX_PARTY_SIZE) {
      slots[p.id] = p.job
    }
  }
  // 尾部 truncate
  let lastNonEmpty = slots.length - 1
  while (lastNonEmpty >= 0 && slots[lastNonEmpty] === '') lastNonEmpty--
  return slots.slice(0, lastNonEmpty + 1)
}

export function toV2(timeline: Timeline): V2Timeline {
  const out: V2Timeline = {
    v: 2,
    n: timeline.name,
    e: timeline.encounter.id,
    c: compositionToV2(timeline.composition),
    de: timeline.damageEvents.map(toV2DamageEvent),
    ce: toV2CastEvents(timeline.castEvents),
    ca: timeline.createdAt,
    ua: timeline.updatedAt,
  }
  if (timeline.description !== undefined) out.desc = timeline.description
  if (timeline.fflogsSource) {
    out.fs = {
      rc: timeline.fflogsSource.reportCode,
      fi: timeline.fflogsSource.fightId,
    }
  }
  if (timeline.gameZoneId !== undefined) out.gz = timeline.gameZoneId
  const an = (timeline.annotations ?? []).map(toV2Annotation)
  if (an.length > 0) out.an = an
  const se = (timeline.syncEvents ?? []).map(toV2SyncEvent)
  if (se.length > 0) out.se = se
  if (timeline.isReplayMode) out.r = 1
  return out
}

export const serializeForServer = toV2

// ──────────────────────────────────────────────────────────────────
// 本地存储形态
// ──────────────────────────────────────────────────────────────────

export interface LocalStored extends V2Timeline {
  id: string
  isShared?: boolean
  serverVersion?: number
  hasLocalChanges?: boolean
  everPublished?: boolean
  statData?: TimelineStatData
}

export function toLocalStored(timeline: Timeline): LocalStored {
  const out: LocalStored = { ...toV2(timeline), id: timeline.id }
  if (timeline.isShared !== undefined) out.isShared = timeline.isShared
  if (timeline.serverVersion !== undefined) out.serverVersion = timeline.serverVersion
  if (timeline.hasLocalChanges !== undefined) out.hasLocalChanges = timeline.hasLocalChanges
  if (timeline.everPublished !== undefined) out.everPublished = timeline.everPublished
  if (timeline.statData !== undefined) out.statData = timeline.statData
  return out
}

// ──────────────────────────────────────────────────────────────────
// V2 → 内存
// ──────────────────────────────────────────────────────────────────

function fromV2StatusSnapshot(s: V2StatusSnapshot): StatusSnapshot {
  const out: StatusSnapshot = { statusId: s.s }
  if (s.ab !== undefined) out.absorb = s.ab
  return out
}

function fromV2PlayerDamageDetail(d: V2PlayerDamageDetail): PlayerDamageDetail {
  const out: PlayerDamageDetail = {
    timestamp: d.ts,
    playerId: d.p,
    unmitigatedDamage: d.u,
    finalDamage: d.f,
    statuses: d.ss.map(fromV2StatusSnapshot),
  }
  if (d.o !== undefined) out.overkill = d.o
  if (d.m !== undefined) out.multiplier = d.m
  if (d.hp !== undefined) out.hitPoints = d.hp
  if (d.mhp !== undefined) out.maxHitPoints = d.mhp
  return out
}

function fromV2DamageEvent(e: V2DamageEvent): DamageEvent {
  const out: DamageEvent = {
    id: nextShortId(),
    name: e.n,
    time: e.t,
    damage: e.d,
    type: NUM_TO_DAMAGE_EVENT_TYPE[e.ty],
    damageType: NUM_TO_DAMAGE_TYPE[e.dt],
  }
  if (e.st !== undefined) out.snapshotTime = e.st
  if (e.pdd && e.pdd.length > 0) {
    out.playerDamageDetails = e.pdd.map(fromV2PlayerDamageDetail)
  }
  return out
}

function fromV2CastEvents(ce: V2CastEvents): CastEvent[] {
  const len = ce.a.length
  const out: CastEvent[] = new Array(len)
  for (let i = 0; i < len; i++) {
    out[i] = {
      id: nextShortId(),
      actionId: ce.a[i],
      timestamp: ce.t[i],
      playerId: ce.p[i],
    }
  }
  return out
}

function fromV2Annotation(a: V2Annotation): Annotation {
  const anchor =
    a.k === 0
      ? { type: 'damageTrack' as const }
      : { type: 'skillTrack' as const, playerId: a.k[0], actionId: a.k[1] }
  return {
    id: nextShortId(),
    text: a.x,
    time: a.t,
    anchor,
  }
}

function fromV2SyncEvent(e: V2SyncEvent): SyncEvent {
  return {
    time: e.t,
    type: NUM_TO_SYNC_TYPE[e.ty],
    actionId: e.a,
    actionName: e.nm ?? `unknown_${e.a.toString(16)}`,
    window: e.w,
    syncOnce: e.so === 1,
  }
}

function compositionFromSlots(c: string[]): Composition {
  const players: Composition['players'] = []
  for (let i = 0; i < c.length; i++) {
    const job = c[i]
    if (job && job !== '') {
      players.push({ id: i, job: job as Job })
    }
  }
  return { players }
}

export function hydrateFromV2(v2: V2Timeline, overrides: Partial<Timeline> = {}): Timeline {
  resetIdCounter()
  const composition = compositionFromSlots(v2.c)
  const staticEncounter = getEncounterById(v2.e)

  const base: Timeline = {
    id: overrides.id ?? generateId(),
    name: v2.n,
    encounter: {
      id: v2.e,
      name: staticEncounter?.shortName ?? v2.n,
      displayName: staticEncounter?.name ?? v2.n,
      zone: '',
      damageEvents: [],
    },
    composition,
    damageEvents: v2.de.map(fromV2DamageEvent),
    castEvents: fromV2CastEvents(v2.ce),
    statusEvents: [],
    annotations: v2.an ? v2.an.map(fromV2Annotation) : [],
    createdAt: v2.ca,
    updatedAt: v2.ua,
  }

  if (v2.desc !== undefined) base.description = v2.desc
  if (v2.fs) base.fflogsSource = { reportCode: v2.fs.rc, fightId: v2.fs.fi }
  if (v2.gz !== undefined) base.gameZoneId = v2.gz
  if (v2.se) base.syncEvents = v2.se.map(fromV2SyncEvent)
  if (v2.r === 1) base.isReplayMode = true

  return { ...base, ...overrides }
}
```

同时需要在 `src/types/timeline.ts` 中确认 `MAX_PARTY_SIZE` 已 export（现有代码应该已经导出；如果没有，加上）。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/utils/timelineFormat.test.ts`
Expected: PASS — 7 tests.

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/timelineFormat.ts src/utils/timelineFormat.test.ts
git commit -m "feat(timeline): 实现 toV2 / hydrateFromV2 / serializeForServer / toLocalStored"
```

---

## Task 6: V1 迁移 + `parseFromAny`

**Files:**

- Modify: `src/utils/timelineFormat.ts`
- Modify: `src/utils/timelineFormat.test.ts`

- [ ] **Step 1: Write failing tests for migration**

Append to `src/utils/timelineFormat.test.ts`:

```ts
import { migrateV1ToV2, parseFromAny } from './timelineFormat'

describe('migrateV1ToV2', () => {
  it('V1 editor 模式 → V2', () => {
    const v1 = {
      name: 'M9S',
      description: 'desc',
      encounter: {
        id: 101,
        name: 'M9S',
        displayName: '致命美人',
        zone: '',
        damageEvents: [],
      },
      gameZoneId: 1321,
      composition: {
        players: [
          { id: 2, job: 'WHM' },
          { id: 3, job: 'SCH' },
        ],
      },
      damageEvents: [
        {
          id: 'old-uuid-1',
          name: '死刑',
          time: 10,
          damage: 120000,
          type: 'tankbuster',
          damageType: 'physical',
          targetPlayerId: 0,
        },
      ],
      castEvents: [
        {
          id: 'old-uuid-2',
          actionId: 7432,
          timestamp: 5,
          playerId: 2,
          job: 'WHM',
          targetPlayerId: 0,
        },
      ],
      annotations: [
        {
          id: 'old-uuid-3',
          text: 'hi',
          time: 20,
          anchor: { type: 'damageTrack' },
        },
        {
          id: 'old-uuid-4',
          text: 'WHM 礼仪',
          time: 25,
          anchor: { type: 'skillTrack', playerId: 2, actionId: 7432 },
        },
      ],
      createdAt: 1000,
      updatedAt: 2000,
    }
    const v2 = migrateV1ToV2(v1)
    expect(v2.v).toBe(2)
    expect(v2.n).toBe('M9S')
    expect(v2.desc).toBe('desc')
    expect(v2.e).toBe(101)
    expect(v2.gz).toBe(1321)
    expect(v2.c).toEqual(['', '', 'WHM', 'SCH'])
    expect(v2.de).toEqual([{ n: '死刑', t: 10, d: 120000, ty: 1, dt: 0 }])
    expect(v2.ce).toEqual({ a: [7432], t: [5], p: [2] })
    expect(v2.an?.[0]).toEqual({ x: 'hi', t: 20, k: 0 })
    expect(v2.an?.[1]).toEqual({ x: 'WHM 礼仪', t: 25, k: [2, 7432] })
  })

  it('V1 replay 模式 → V2 去除 9 个死字段', () => {
    const v1 = {
      name: 'M9S replay',
      encounter: { id: 101, name: 'M9S', displayName: '致命美人', zone: '', damageEvents: [] },
      composition: { players: [{ id: 0, job: 'PLD' }] },
      damageEvents: [
        {
          id: 'old',
          name: '死刑',
          time: 10,
          damage: 120000,
          type: 'tankbuster',
          damageType: 'physical',
          targetPlayerId: 0,
          packetId: 999,
          playerDamageDetails: [
            {
              timestamp: 123456,
              packetId: 999,
              sourceId: 6000,
              playerId: 0,
              job: 'PLD',
              abilityId: 40000,
              skillName: '死刑',
              unmitigatedDamage: 120000,
              finalDamage: 60000,
              statuses: [{ statusId: 1001, targetPlayerId: 0, absorb: 5000 }],
              hitPoints: 50000,
              maxHitPoints: 80000,
            },
          ],
        },
      ],
      castEvents: [],
      annotations: [],
      isReplayMode: true,
      createdAt: 1000,
      updatedAt: 2000,
    }
    const v2 = migrateV1ToV2(v1)
    const detail = v2.de[0].pdd?.[0]
    expect(detail).toEqual({
      ts: 123456,
      p: 0,
      u: 120000,
      f: 60000,
      hp: 50000,
      mhp: 80000,
      ss: [{ s: 1001, ab: 5000 }],
    })
    // 死字段不存在
    expect(detail).not.toHaveProperty('sourceId')
    expect(detail).not.toHaveProperty('packetId')
    expect(detail).not.toHaveProperty('abilityId')
    expect(detail).not.toHaveProperty('job')
    expect(detail).not.toHaveProperty('skillName')
    expect(v2.de[0]).not.toHaveProperty('packetId')
    expect(v2.de[0]).not.toHaveProperty('targetPlayerId')
    expect(v2.r).toBe(1)
  })
})

describe('parseFromAny', () => {
  it('v === 2 走 V2 分支', () => {
    const v2: V2Timeline = {
      v: 2,
      n: 'test',
      e: 101,
      c: ['PLD'],
      de: [],
      ce: { a: [], t: [], p: [] },
      ca: 1,
      ua: 1,
    }
    const tl = parseFromAny(v2, { id: 'x' })
    expect(tl.id).toBe('x')
    expect(tl.name).toBe('test')
  })

  it('无 v 字段走 V1 迁移分支', () => {
    const v1 = {
      name: 'legacy',
      encounter: { id: 101, name: '', displayName: '', zone: '', damageEvents: [] },
      composition: { players: [] },
      damageEvents: [],
      castEvents: [],
      createdAt: 1,
      updatedAt: 1,
    }
    const tl = parseFromAny(v1, { id: 'y' })
    expect(tl.id).toBe('y')
    expect(tl.name).toBe('legacy')
  })

  it('非对象抛错', () => {
    expect(() => parseFromAny(null)).toThrow()
    expect(() => parseFromAny(42)).toThrow()
  })
})
```

`V2Timeline` 需要 import：

```ts
import type { V2Timeline } from '@/types/timelineV2'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run src/utils/timelineFormat.test.ts`
Expected: FAIL — `migrateV1ToV2` / `parseFromAny` not exported.

- [ ] **Step 3: Add migration + parseFromAny to `timelineFormat.ts`**

Append to `src/utils/timelineFormat.ts`:

```ts
// ──────────────────────────────────────────────────────────────────
// V1 类型（仅用于迁移，TODO(v2-sunset): sunset Step 4 后删除）
// ──────────────────────────────────────────────────────────────────

interface V1StatusSnapshot {
  statusId: number
  targetPlayerId?: number
  absorb?: number
}
interface V1PlayerDamageDetail {
  timestamp: number
  packetId?: number
  sourceId?: number
  playerId: number
  job?: string
  abilityId?: number
  skillName?: string
  unmitigatedDamage: number
  finalDamage: number
  overkill?: number
  multiplier?: number
  statuses: V1StatusSnapshot[]
  hitPoints?: number
  maxHitPoints?: number
  snapshotTimestamp?: number
}
interface V1DamageEvent {
  id?: string
  name: string
  time: number
  damage: number
  type: DamageEventType
  damageType: DamageType
  targetPlayerId?: number
  playerDamageDetails?: V1PlayerDamageDetail[]
  packetId?: number
  snapshotTime?: number
}
interface V1CastEvent {
  id?: string
  actionId: number
  timestamp: number
  playerId: number
  job?: string
  targetPlayerId?: number
}
interface V1Annotation {
  id?: string
  text: string
  time: number
  anchor: { type: 'damageTrack' } | { type: 'skillTrack'; playerId: number; actionId: number }
}
interface V1SyncEvent {
  time: number
  type: 'begincast' | 'cast'
  actionId: number
  actionName: string
  window: [number, number]
  syncOnce: boolean
}
interface V1Composition {
  players: Array<{ id: number; job: string }>
}
interface V1Encounter {
  id: number
  name?: string
  displayName?: string
  zone?: string
  damageEvents?: unknown[]
}
interface V1Timeline {
  name: string
  description?: string
  fflogsSource?: { reportCode: string; fightId: number }
  gameZoneId?: number
  encounter: V1Encounter
  composition: V1Composition
  damageEvents: V1DamageEvent[]
  castEvents: V1CastEvent[]
  annotations?: V1Annotation[]
  syncEvents?: V1SyncEvent[]
  isReplayMode?: boolean
  createdAt: number
  updatedAt: number
}

// ──────────────────────────────────────────────────────────────────
// V1 → V2 迁移
// TODO(v2-sunset): 部署 v2 后观察 2-4 周 → 跑一次 D1 批量迁移 → 几个月后删除本段
// ──────────────────────────────────────────────────────────────────

function migrateV1StatusSnapshot(s: V1StatusSnapshot): V2StatusSnapshot {
  const out: V2StatusSnapshot = { s: s.statusId }
  if (s.absorb !== undefined) out.ab = s.absorb
  return out
}

function migrateV1PlayerDamageDetail(d: V1PlayerDamageDetail): V2PlayerDamageDetail {
  const out: V2PlayerDamageDetail = {
    ts: d.timestamp,
    p: d.playerId,
    u: d.unmitigatedDamage,
    f: d.finalDamage,
    ss: d.statuses.map(migrateV1StatusSnapshot),
  }
  if (d.overkill !== undefined) out.o = d.overkill
  if (d.multiplier !== undefined) out.m = d.multiplier
  if (d.hitPoints !== undefined) out.hp = d.hitPoints
  if (d.maxHitPoints !== undefined) out.mhp = d.maxHitPoints
  return out
}

function migrateV1DamageEvent(e: V1DamageEvent): V2DamageEvent {
  const out: V2DamageEvent = {
    n: e.name,
    t: e.time,
    d: e.damage,
    ty: DAMAGE_EVENT_TYPE_TO_NUM[e.type],
    dt: DAMAGE_TYPE_TO_NUM[e.damageType],
  }
  if (e.snapshotTime !== undefined) out.st = e.snapshotTime
  if (e.playerDamageDetails && e.playerDamageDetails.length > 0) {
    out.pdd = e.playerDamageDetails.map(migrateV1PlayerDamageDetail)
  }
  return out
}

function migrateV1CastEvents(events: V1CastEvent[]): V2CastEvents {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
  return {
    a: sorted.map(e => e.actionId),
    t: sorted.map(e => e.timestamp),
    p: sorted.map(e => e.playerId),
  }
}

function migrateV1Annotation(a: V1Annotation): V2Annotation {
  return {
    x: a.text,
    t: a.time,
    k: a.anchor.type === 'damageTrack' ? 0 : [a.anchor.playerId, a.anchor.actionId],
  }
}

function migrateV1SyncEvent(e: V1SyncEvent): V2SyncEvent {
  const out: V2SyncEvent = {
    t: e.time,
    ty: SYNC_TYPE_TO_NUM[e.type],
    a: e.actionId,
    w: e.window,
  }
  if (e.actionName) out.nm = e.actionName
  if (e.syncOnce) out.so = 1
  return out
}

function migrateV1Composition(c: V1Composition): string[] {
  const slots = Array<string>(MAX_PARTY_SIZE).fill('')
  for (const p of c.players) {
    if (p.id >= 0 && p.id < MAX_PARTY_SIZE) {
      slots[p.id] = p.job
    }
  }
  let lastNonEmpty = slots.length - 1
  while (lastNonEmpty >= 0 && slots[lastNonEmpty] === '') lastNonEmpty--
  return slots.slice(0, lastNonEmpty + 1)
}

export function migrateV1ToV2(v1: V1Timeline): V2Timeline {
  const out: V2Timeline = {
    v: 2,
    n: v1.name,
    e: v1.encounter.id,
    c: migrateV1Composition(v1.composition),
    de: v1.damageEvents.map(migrateV1DamageEvent),
    ce: migrateV1CastEvents(v1.castEvents),
    ca: v1.createdAt,
    ua: v1.updatedAt,
  }
  if (v1.description !== undefined) out.desc = v1.description
  if (v1.fflogsSource) {
    out.fs = { rc: v1.fflogsSource.reportCode, fi: v1.fflogsSource.fightId }
  }
  if (v1.gameZoneId !== undefined) out.gz = v1.gameZoneId
  const an = (v1.annotations ?? []).map(migrateV1Annotation)
  if (an.length > 0) out.an = an
  const se = (v1.syncEvents ?? []).map(migrateV1SyncEvent)
  if (se.length > 0) out.se = se
  if (v1.isReplayMode) out.r = 1
  return out
}

// ──────────────────────────────────────────────────────────────────
// 入站万能入口
// ──────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseFromAny(raw: unknown, overrides: Partial<Timeline> = {}): Timeline {
  if (!isPlainObject(raw)) throw new Error('Invalid timeline: not a plain object')
  const v2 =
    raw.v === 2 ? (raw as unknown as V2Timeline) : migrateV1ToV2(raw as unknown as V1Timeline)
  return hydrateFromV2(v2, overrides)
}
```

注意 import 补全：如果 `DamageType` / `DamageEventType` 还没在文件头 import，加进去。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/utils/timelineFormat.test.ts`
Expected: PASS — 所有测试通过。

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/timelineFormat.ts src/utils/timelineFormat.test.ts
git commit -m "feat(timeline): 添加 V1→V2 迁移与 parseFromAny 入站入口"
```

---

## Task 7: 重写 Worker 侧 V2 valibot schema

**Files:**

- Modify: `src/workers/timelineSchema.ts`（整体替换）
- Modify: `src/workers/timelineSchema.test.ts`（fixture 改为 V2 shape）

- [ ] **Step 1: Replace `timelineSchema.ts` with V2 schema**

```ts
// src/workers/timelineSchema.ts
/**
 * Timeline V2 持久化格式 valibot schema。
 * 用于 POST /api/timelines 和 PUT /api/timelines/:id 的写入校验。
 *
 * GET 路径不经过 schema，由 rowToSharedTimeline pass-through。
 *
 * 设计：design/superpowers/specs/2026-04-16-timeline-format-v2-design.md
 */

import * as v from 'valibot'
import { JOB_METADATA } from '@/data/jobs'
import {
  TIMELINE_NAME_MAX_LENGTH,
  TIMELINE_DESCRIPTION_MAX_LENGTH,
  DAMAGE_EVENT_NAME_MAX_LENGTH,
  ANNOTATION_TEXT_MAX_LENGTH,
} from '@/constants/limits'

const JobOrEmptySchema = v.union([
  v.picklist(Object.keys(JOB_METADATA) as [string, ...string[]]),
  v.literal(''),
])

const V2StatusSnapshotSchema = v.object({
  s: v.number(),
  ab: v.optional(v.number()),
})

const V2PlayerDamageDetailSchema = v.object({
  ts: v.number(),
  p: v.number(),
  u: v.number(),
  f: v.number(),
  o: v.optional(v.number()),
  m: v.optional(v.number()),
  hp: v.optional(v.number()),
  mhp: v.optional(v.number()),
  ss: v.array(V2StatusSnapshotSchema),
})

const V2DamageEventSchema = v.object({
  n: v.pipe(v.string(), v.maxLength(DAMAGE_EVENT_NAME_MAX_LENGTH)),
  t: v.number(),
  d: v.number(),
  ty: v.union([v.literal(0), v.literal(1)]),
  dt: v.union([v.literal(0), v.literal(1), v.literal(2)]),
  st: v.optional(v.number()),
  pdd: v.optional(v.array(V2PlayerDamageDetailSchema)),
})

const V2CastEventsSchema = v.object({
  a: v.array(v.number()),
  t: v.array(v.number()),
  p: v.array(v.number()),
})

const V2AnnotationSchema = v.object({
  x: v.pipe(v.string(), v.maxLength(ANNOTATION_TEXT_MAX_LENGTH)),
  t: v.number(),
  k: v.union([v.literal(0), v.tuple([v.number(), v.number()])]),
})

const V2SyncEventSchema = v.object({
  t: v.number(),
  ty: v.union([v.literal(0), v.literal(1)]),
  a: v.number(),
  nm: v.optional(v.string()),
  w: v.tuple([v.number(), v.number()]),
  so: v.optional(v.literal(1)),
})

const V2FFLogsSourceSchema = v.object({
  rc: v.string(),
  fi: v.number(),
})

export const V2TimelineSchema = v.object({
  v: v.literal(2),
  n: v.pipe(v.string(), v.maxLength(TIMELINE_NAME_MAX_LENGTH)),
  desc: v.optional(v.pipe(v.string(), v.maxLength(TIMELINE_DESCRIPTION_MAX_LENGTH))),
  fs: v.optional(V2FFLogsSourceSchema),
  gz: v.optional(v.number()),
  e: v.number(),
  c: v.array(JobOrEmptySchema),
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

export function validateCreateRequest(
  input: unknown
): v.SafeParseResult<typeof CreateTimelineRequestSchema> {
  return v.safeParse(CreateTimelineRequestSchema, input)
}

export function validateUpdateRequest(
  input: unknown
): v.SafeParseResult<typeof UpdateTimelineRequestSchema> {
  return v.safeParse(UpdateTimelineRequestSchema, input)
}
```

- [ ] **Step 2: Rewrite `timelineSchema.test.ts` fixtures to V2**

Read `src/workers/timelineSchema.test.ts` 查看现有测试结构，把所有 fixture 改为 V2 形态。核心改动：

```ts
// MINIMAL_V2_TIMELINE
const MINIMAL_V2: unknown = {
  timeline: {
    v: 2,
    n: '最小时间轴',
    e: 101,
    c: [],
    de: [],
    ce: { a: [], t: [], p: [] },
    ca: 1000,
    ua: 1000,
  },
}
```

保留测试的**语义覆盖**（roundtrip、long-string 截断、`gameZoneId` 保留、无效 job 拒绝、等等），但所有字段名都换到 V2 短 key。严格校验版本号：

```ts
it('缺少 v 字段的 payload 被拒绝', () => {
  const result = validateCreateRequest({
    timeline: { n: 'x', e: 101, c: [], de: [], ce: { a: [], t: [], p: [] }, ca: 1, ua: 1 },
  })
  expect(result.success).toBe(false)
})

it('v !== 2 的 payload 被拒绝', () => {
  const result = validateCreateRequest({
    timeline: { v: 1, n: 'x', e: 101, c: [], de: [], ce: { a: [], t: [], p: [] }, ca: 1, ua: 1 },
  })
  expect(result.success).toBe(false)
})
```

- [ ] **Step 3: Run tests**

Run: `pnpm test:run src/workers/timelineSchema.test.ts`
Expected: PASS.

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/workers/timelineSchema.ts src/workers/timelineSchema.test.ts
git commit -m "refactor(worker): timelineSchema 迁移到 V2 valibot schema"
```

---

## Task 8: `timelineStorage.ts` load/save 走 V2

**Files:**

- Modify: `src/utils/timelineStorage.ts`

- [ ] **Step 1: Update load/save**

在 `src/utils/timelineStorage.ts` 的顶部 import：

```ts
import { parseFromAny, toLocalStored } from './timelineFormat'
```

替换 `getTimeline`：

```ts
export function getTimeline(id: string): Timeline | null {
  try {
    const data = localStorage.getItem(`${STORAGE_KEY}_${id}`)
    if (!data) return null
    const raw = JSON.parse(data)
    // parseFromAny 负责识别 V1 / V2 并返回完整内存 Timeline
    return parseFromAny(raw, {
      id: raw.id ?? id,
      isShared: raw.isShared,
      serverVersion: raw.serverVersion,
      hasLocalChanges: raw.hasLocalChanges,
      everPublished: raw.everPublished,
      statData: raw.statData,
    })
  } catch (error) {
    console.error('Failed to load timeline:', error)
    return null
  }
}
```

替换 `saveTimeline` 中的实际存储动作：

```ts
export function saveTimeline(timeline: Timeline): void {
  try {
    localStorage.setItem(`${STORAGE_KEY}_${timeline.id}`, JSON.stringify(toLocalStored(timeline)))

    // metadata 列表保持不变
    const metadata = getAllTimelineMetadata()
    // ... 其余代码原样
  } catch (error) {
    console.error('Failed to save timeline:', error)
    throw new Error('保存时间轴失败')
  }
}
```

`unpublishTimeline` 也使用 `toLocalStored`：

```ts
export function unpublishTimeline(id: string): void {
  try {
    const data = localStorage.getItem(`${STORAGE_KEY}_${id}`)
    if (!data) return
    const timeline = parseFromAny(JSON.parse(data), { id })
    const updated: Timeline = {
      ...timeline,
      isShared: false,
      hasLocalChanges: false,
      serverVersion: undefined,
    }
    localStorage.setItem(`${STORAGE_KEY}_${id}`, JSON.stringify(toLocalStored(updated)))
    // ... metadata 同步原样
  } catch (error) {
    console.error('Failed to unpublish timeline:', error)
  }
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm test:run`
Expected: PASS. 如果 `timelineStore.test.ts` 有使用 localStorage 的回归错误，需排查。

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/utils/timelineStorage.ts
git commit -m "refactor(storage): timelineStorage 使用 V2 格式读写本地"
```

---

## Task 9: `timelineShareApi.ts` 使用 V2

**Files:**

- Modify: `src/api/timelineShareApi.ts`

- [ ] **Step 1: Rewrite publish/update/fetch**

替换整个 `buildPayload` 与三个主要导出函数（保留 `fetchMyTimelines` / `deleteSharedTimeline` 不变）：

```ts
// src/api/timelineShareApi.ts
import { HTTPError } from 'ky'
import { apiClient } from './apiClient'
import type { Timeline, Composition } from '@/types/timeline'
import { parseFromAny, serializeForServer } from '@/utils/timelineFormat'

// 发布/更新返回服务器生成的最小元数据
export interface PublishResult {
  id: string
  publishedAt: number
  version: number
}
export interface UpdateResult {
  id: string
  updatedAt: number
  version: number
}
export interface ConflictError {
  type: 'conflict'
  serverVersion: number
  serverUpdatedAt: number
}

// 获取共享时间轴时的完整响应（timeline 已解析为内存 Timeline）
export interface SharedTimelineResponse {
  timeline: Timeline
  authorName: string
  publishedAt: number
  version: number
  isAuthor: boolean
}

export async function publishTimeline(timeline: Timeline): Promise<PublishResult> {
  try {
    return await apiClient
      .post('timelines', { json: { timeline: serializeForServer(timeline) } })
      .json<PublishResult>()
  } catch (err) {
    if (err instanceof HTTPError) {
      const body = await err.response.json<{ error?: string }>().catch(() => ({ error: undefined }))
      throw new Error(body.error ?? `HTTP ${err.response.status}`)
    }
    throw err
  }
}

export async function updateTimeline(
  id: string,
  timeline: Timeline,
  expectedVersion?: number
): Promise<UpdateResult | ConflictError> {
  const payload = {
    timeline: serializeForServer(timeline),
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  }
  try {
    return await apiClient.put(`timelines/${id}`, { json: payload }).json<UpdateResult>()
  } catch (err) {
    if (err instanceof HTTPError && err.response.status === 409) {
      const body = await err.response.json<{ serverVersion: number; serverUpdatedAt: number }>()
      return {
        type: 'conflict',
        serverVersion: body.serverVersion,
        serverUpdatedAt: body.serverUpdatedAt,
      }
    }
    if (err instanceof HTTPError) {
      const body = await err.response.json<{ error?: string }>().catch(() => ({ error: undefined }))
      throw new Error(body.error ?? `HTTP ${err.response.status}`)
    }
    throw err
  }
}

export interface MyTimelineItem {
  id: string
  name: string
  publishedAt: number
  updatedAt: number
  version: number
  composition: Composition | null
}

export async function fetchMyTimelines(): Promise<MyTimelineItem[]> {
  try {
    return await apiClient.get('my/timelines').json<MyTimelineItem[]>()
  } catch (err) {
    if (err instanceof HTTPError && err.response.status === 401) return []
    throw err
  }
}

export async function deleteSharedTimeline(id: string): Promise<void> {
  try {
    await apiClient.delete(`timelines/${id}`)
  } catch (err) {
    if (err instanceof HTTPError) {
      const body = await err.response.json<{ error?: string }>().catch(() => ({ error: undefined }))
      throw new Error(body.error ?? `HTTP ${err.response.status}`)
    }
    throw err
  }
}

// Worker 返回的原始 shape（用于内部解析）
interface RawSharedTimelineResponse {
  timeline: unknown
  authorName: string
  publishedAt: number
  version: number
  isAuthor: boolean
}

export async function fetchSharedTimeline(id: string): Promise<SharedTimelineResponse> {
  try {
    const raw = await apiClient.get(`timelines/${id}`).json<RawSharedTimelineResponse>()
    return {
      timeline: parseFromAny(raw.timeline, { id }),
      authorName: raw.authorName,
      publishedAt: raw.publishedAt,
      version: raw.version,
      isAuthor: raw.isAuthor,
    }
  } catch (err) {
    if (err instanceof HTTPError && err.response.status === 404) {
      throw new Error('NOT_FOUND')
    }
    if (err instanceof HTTPError) {
      throw new Error(`HTTP ${err.response.status}`)
    }
    throw err
  }
}
```

注意两个重要变化：

1. **`SharedTimelineResponse.timeline` 类型从 `UploadPayload` 改为 `Timeline`**。这影响 `EditorPage.tsx` 和 `timelineStore.ts` 的 `applyServerTimeline`——但由于它们消费的是长字段名的 Timeline 字段，接口完全兼容。
2. **原 `UploadPayload` 接口被删除**。如有其他地方 import 它，编译会报错。搜索 `UploadPayload` 删除对应 import。

- [ ] **Step 2: Remove unused imports referencing UploadPayload**

Run: `pnpm exec tsc --noEmit`
Expected: 若报错，定位到使用 `UploadPayload` 的文件，删除无用 import。预期没有其他消费点。

- [ ] **Step 3: Run tests**

Run: `pnpm test:run`
Expected: PASS（非 worker 测试）。Worker 集成测试可能依赖 V2，留到 Task 12 处理。

- [ ] **Step 4: Commit**

```bash
git add src/api/timelineShareApi.ts
git commit -m "refactor(api): timelineShareApi 使用 V2 序列化与 parseFromAny"
```

---

## Task 10: Worker 的 `fflogsImportHandler` 返回 V2

**Files:**

- Modify: `src/workers/fflogsImportHandler.ts`
- Modify: `src/components/ImportFFLogsDialog.tsx`

- [ ] **Step 1: 更新 `fflogsImportHandler.ts` 返回 V2**

替换原来的 timeline 构造和返回：

```ts
// 7. 组装完整 Timeline（内存形态）
const now = Math.floor(Date.now() / 1000)
const timeline: Timeline = {
  id: generateId(),
  name: timelineName,
  encounter: {
    id: fight.encounterID || 0,
    name: fight.name,
    displayName: fight.name,
    zone: report.title || '',
    damageEvents: [],
  },
  gameZoneId: fight.gameZone?.id != null ? Math.floor(fight.gameZone.id) : undefined,
  composition,
  damageEvents,
  castEvents,
  syncEvents,
  statusEvents: [],
  annotations: [],
  isReplayMode: true,
  fflogsSource: { reportCode, fightId },
  createdAt: now,
  updatedAt: now,
}

// 8. 序列化为 V2 返回
return jsonResponse(serializeForServer(timeline))
```

文件顶部新增 import：

```ts
import { serializeForServer } from '@/utils/timelineFormat'
```

注意：由于上一步已经删除了 `encounter.name/displayName/zone` 在 V2 中的持久化（它们全走 `e: number` + `raidEncounters.ts`），这里的 `encounter` 构造只是占位满足内存 `Timeline` 类型，`serializeForServer` 会自动只取 `encounter.id`。

- [ ] **Step 2: 更新 `ImportFFLogsDialog.tsx` 入站走 parseFromAny**

修改 `handleServerSubmit` 中的响应处理（约 `src/components/ImportFFLogsDialog.tsx:98`）：

```ts
const raw = await response.json()
const newTimeline = parseFromAny(raw, { id: generateId() })
newTimeline.description = `导入自 ${url}`

saveTimeline(newTimeline)
track('fflogs-import', { success: true, encounterId: newTimeline.encounter?.id ?? 0 })

window.open(`/timeline/${newTimeline.id}`, '_blank')
onImported()
onClose()
```

文件顶部新增 import：

```ts
import { parseFromAny } from '@/utils/timelineFormat'
import { generateId } from '@/utils/id'
```

如果文件中还有另一个"客户端解析"的代码分支（`handleClientSubmit`，约 `src/components/ImportFFLogsDialog.tsx:123+`）使用 `fflogsImporter`，它返回的是内存形态 Timeline，**不需要经过 V2 转换**，保持原样。

- [ ] **Step 3: Run tests**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Run: `pnpm test:run`
Expected: 业务测试通过；Worker 测试可能仍失败（留到 Task 11）。

- [ ] **Step 4: Commit**

```bash
git add src/workers/fflogsImportHandler.ts src/components/ImportFFLogsDialog.tsx
git commit -m "refactor(fflogs-import): Worker 返回 V2，客户端走 parseFromAny"
```

---

## Task 11: 修复 Worker 集成测试

**Files:**

- Modify: `src/workers/timelines.test.ts`

POST/PUT 的 fixture 需要改为 V2 shape。GET 测试保持 pass-through 语义（D1 里存的可以是 V2，客户端自行解析）。

- [ ] **Step 1: Update fixtures**

打开 `src/workers/timelines.test.ts`，找到所有类似下面的 fixture：

```ts
const MINIMAL_TIMELINE: Timeline = {
  id: '...',
  name: '...',
  encounter: { id: 1001, name: '副本', displayName: '副本', zone: '', damageEvents: [] },
  composition: { players: [] },
  damageEvents: [],
  castEvents: [],
  ...
}
```

替换为 V2 shape：

```ts
const MINIMAL_V2_TIMELINE = {
  v: 2 as const,
  n: '副本',
  e: 1001,
  c: [],
  de: [],
  ce: { a: [], t: [], p: [] },
  ca: 1000,
  ua: 1000,
}

function postV2(body: unknown) {
  return new Request('https://localhost/api/timelines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer VALID' },
    body: JSON.stringify({ timeline: body }),
  })
}
```

所有 POST/PUT 的 `{ timeline: ... }` 都使用 V2 shape。具体 assertion（如 `body.timeline.encounter`）需要改为 V2 字段（如 `body.timeline.e`）。

GET 测试的 assertion：如果测的是 Worker 原样返回 D1 内容，保持语义不变，但存入 D1 的 fixture（`content` 列）改为 V2 JSON。

`expectedVersion` 冲突测试的 fixture 同样改 V2。

- [ ] **Step 2: Run worker tests**

Run: `pnpm test:run src/workers/`
Expected: PASS（全部 Worker 测试）。

- [ ] **Step 3: Full test suite**

Run: `pnpm test:run`
Expected: PASS（所有测试）。

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/workers/timelines.test.ts
git commit -m "test(worker): timelines 集成测试 fixture 迁移到 V2 shape"
```

---

## Task 12: 端到端手动烟测 + 构建验证

**Files:** 无（仅验证）

Spec 的验证必须 `pnpm build` 通过、dev server 跑起来、UI 烟测。

- [ ] **Step 1: Build**

Run: `pnpm build`
Expected: PASS，无 TypeScript / vite 错误。

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS。

- [ ] **Step 3: Full test**

Run: `pnpm test:run`
Expected: PASS。

- [ ] **Step 4: Dev server 烟测**

启动 dev server（如果用户没已启动的话）：

Run: `pnpm dev`（长时间运行，另开一个 shell 继续）

在浏览器里：

1. **本地新建时间轴**：首页 → 选副本 → 创建 → 进入 editor → 添加几个 cast → 刷新页面 → 数据应完整保留。
2. **旧数据读取**：在 DevTools Console 手写一个 V1 shape 到 `localStorage['healerbook_timelines_test']`：
   ```js
   localStorage.setItem(
     'healerbook_timelines_test',
     JSON.stringify({
       id: 'test',
       name: 'legacy',
       createdAt: 1,
       updatedAt: 1,
       encounter: { id: 101, name: 'M9S', displayName: '致命美人', zone: '', damageEvents: [] },
       composition: { players: [{ id: 0, job: 'PLD' }] },
       damageEvents: [],
       castEvents: [],
     })
   )
   ```
   然后 `localStorage['healerbook_timelines']` 里追加一条 metadata，访问 `/timeline/test`。应正常加载并以 V2 shape 重新保存（下次 `localStorage.getItem('healerbook_timelines_test')` 能看到 `"v":2`）。
3. **FFLogs 导入**：粘贴一个 FFLogs 链接 → 服务器解析 → 成功打开新 tab。打开 DevTools Network，检查 `/api/fflogs/import` 响应 body 应是 V2 shape（短 key）。
4. **发布 / 更新 / 取消发布 / 再读取**：登录 → 发布时间轴 → Network 里看 POST body 为 V2 → 刷新 → 数据完整 → 修改 → 更新 → 再读 D1 时也应该是 V2。
5. **阵容编辑**：删除中间玩家 → 追加新玩家 → 确认 cast 引用正确、没有继承前玩家技能。

在这一步不写自动化脚本；烟测结果由执行者确认后在 commit message 中简要记录。

- [ ] **Step 5: Smoke test results + final commit**

如果烟测过程中发现问题，回到对应 task 修复；否则不产生新 commit。

---

## Self-review checklist（计划完成后由写作者自检）

- [ ] Spec 的 14 条决策在 plan 中都有对应任务覆盖
- [ ] 无 "TODO"、"implement later"、"similar to"、"add error handling" 等占位
- [ ] 每一 step 都有具体代码或具体命令
- [ ] 跨任务的函数/类型名一致（`toV2` / `hydrateFromV2` / `parseFromAny` / `serializeForServer` / `toLocalStored` / `migrateV1ToV2` / `nextShortId` / `resetIdCounter`）
- [ ] commit 粒度合适（约 12 次提交），每次提交后代码编译通过 + 测试通过（Task 3+4 合并为一次提交的理由在文中说明）
- [ ] Follow-up（sunset Step 2-4）在 spec 中单独列出，plan 不包含它们

---

## Follow-up（本次不做，记录到后续 issue）

- D1 批量迁移脚本：部署 Step 1 后 2-4 周观察无回归 → 写一次性 Worker endpoint `/admin/migrate-v2` 或 `wrangler d1 execute` 外部脚本，把 `timelines` 表中 `content NOT LIKE '%"v":2%'` 的行读出 → `migrateV1ToV2` → UPDATE 回去
- 几个月后：删除 `src/utils/timelineFormat.ts` 中的 `V1*` 类型、`migrateV1ToV2`、以及 `parseFromAny` 中的 V1 分支（保留 `parseFromAny` 本身为 "只接受 V2" 的纯入口）
