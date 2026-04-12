# 导出 Souma 时间轴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Healerbook 编辑器导出菜单新增 "Souma 时间轴..." 项，生成压缩后的 cactbot 风格时间轴字符串，可直接导入 ff14-overlay-vue 的时间轴模块。

**Architecture:** 数据层 FFLogs 查询新增 `gameZone { id }` 并在导入/新建时写入 `Timeline.gameZoneId`；静态表 `RaidEncounter.gameZoneId` 作为存量兜底。导出逻辑拆为纯函数模块 `soumaExporter.ts`（formatTime / buildTimelineText / wrapAsITimeline / compress）易单测；UI 侧新建 `ExportSoumaDialog.tsx` 承载玩家选择 / 技能图标网格 / TTS 开关 / 实时预览 / 复制。

**Tech Stack:** React 19, TypeScript, shadcn/ui (Modal/Select/Switch), Sonner (toast), Zustand, lz-string, Vitest

**Spec:** `design/superpowers/specs/2026-04-13-export-souma-timeline-design.md`

---

## Task 1: 新增 lz-string 依赖

**Files:**

- Modify: `package.json`

- [ ] **Step 1: 安装 lz-string**

Run: `pnpm add lz-string`

Expected: `package.json` 的 `dependencies` 出现 `"lz-string": "^1.x.x"`，`pnpm-lock.yaml` 更新。

- [ ] **Step 2: 验证类型声明可用**

```ts
// 临时验证（不提交）：
import LZString from 'lz-string'
const s = LZString.compressToBase64('hello')
console.log(s, LZString.decompressFromBase64(s))
```

Run: `pnpm exec tsc --noEmit`
Expected: 无 `lz-string` 相关类型错误。

- [ ] **Step 3: 提交**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: 引入 lz-string 用于 Souma 时间轴导出"
```

---

## Task 2: Timeline 接口新增 gameZoneId 字段

**Files:**

- Modify: `src/types/timeline.ts`

- [ ] **Step 1: 在 Timeline 接口中追加字段**

在 `src/types/timeline.ts` 的 `Timeline` 接口内（紧挨 `fflogsSource` 字段后）添加：

```ts
  /** FFXIV 游戏内 ZoneID，用于 Souma 时间轴导出时的自动副本识别。
   *  FFLogs 导入时从 ReportFight.gameZone.id 取值；本地新建时从 raidEncounters.ts 静态表查表写入。
   *  存量时间轴可能无此字段，导出时将回退至静态表或 "0"。 */
  gameZoneId?: number
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/types/timeline.ts
git commit -m "feat(types): Timeline 新增 gameZoneId 字段"
```

---

## Task 2b: Worker timelineSchema 添加 gameZoneId + 漂移保护测试

**Files:**

- Modify: `src/workers/timelineSchema.ts`
- Create: `src/workers/timelineSchema.test.ts`

**背景：** `timelineSchema.ts` 使用 Valibot 的 `v.object()`，未声明的字段在 `safeParse` 时会被**静默剥离**。若不显式添加 `gameZoneId`，已发布时间轴同步到 D1 时字段会丢失。此外要从根本上防止未来类似问题，需要一个 schema 漂移保护测试——`Timeline` 接口任何新增字段都必须显式决定"持久 vs 临时"，否则 TypeScript 编译失败 / 测试失败。

- [ ] **Step 1: 在 TimelineSchema 中追加 gameZoneId**

在 `src/workers/timelineSchema.ts` 的 `TimelineSchema`（约 106–118 行）内，紧挨 `fflogsSource` 之后追加 `gameZoneId`：

```ts
const TimelineSchema = v.object({
  name: v.pipe(v.string(), v.maxLength(TIMELINE_NAME_MAX_LENGTH)),
  description: v.optional(v.pipe(v.string(), v.maxLength(TIMELINE_DESCRIPTION_MAX_LENGTH))),
  fflogsSource: v.optional(FFLogsSourceSchema),
  gameZoneId: v.optional(v.number()),
  encounter: EncounterSchema,
  composition: CompositionSchema,
  damageEvents: v.array(DamageEventSchema),
  castEvents: v.array(CastEventSchema),
  annotations: v.optional(v.array(AnnotationSchema)),
  isReplayMode: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
```

- [ ] **Step 2: 新建 timelineSchema.test.ts**

创建 `src/workers/timelineSchema.test.ts`：

```ts
/**
 * Schema 漂移保护测试
 *
 * 当 Timeline 接口新增字段时：
 *   1. FULL_TIMELINE 的类型注解会让 TypeScript 编译失败（因为不再满足 Required<...>）
 *   2. 开发者必须在 fixture 里补上新字段
 *   3. 再决定该字段是"持久"还是"临时"：
 *      - 持久 → 把字段加到 timelineSchema.ts 的 TimelineSchema 中
 *      - 临时 → 把字段 key 加入本文件的 EPHEMERAL_KEYS
 *   4. 任何一项没做，测试都会失败
 */

import { describe, it, expect } from 'vitest'
import type { Timeline } from '@/types/timeline'
import { validateCreateRequest } from './timelineSchema'

/** 这些字段是客户端临时/派生状态，故意不参与服务端持久化 */
const EPHEMERAL_KEYS: Array<keyof Timeline> = [
  'id', // 服务端另行分配，请求体里被忽略
  'statusEvents', // 编辑模式运行时派生
  'statData', // 客户端计算结果
  'isShared', // 客户端状态
  'everPublished', // 客户端状态
  'hasLocalChanges', // 客户端状态
  'serverVersion', // 服务端下发
  'isReplayMode', // 运行时模式标记（注意：schema 允许它以保持兼容，但不作为持久主字段）
]

/**
 * 穷举 Timeline 的所有字段。
 * 使用 `Required<Omit<Timeline, 所有可选字段>> & Pick<Timeline, 所有可选字段>` 的模式
 * 强制 fixture 包含接口里的每一个属性——无论是必填还是可选。
 * 当 Timeline 新增字段时，TypeScript 会报错要求补齐。
 */
const FULL_TIMELINE: Required<
  Omit<Timeline, 'description' | 'fflogsSource' | 'isReplayMode' | 'statData' | 'gameZoneId'>
> &
  Pick<Timeline, 'description' | 'fflogsSource' | 'isReplayMode' | 'statData' | 'gameZoneId'> = {
  id: 'local-1',
  name: '测试',
  description: 'desc',
  fflogsSource: { reportCode: 'abc', fightId: 1 },
  gameZoneId: 1321,
  encounter: { id: 101, name: 'M9S', displayName: 'M9S', zone: '', damageEvents: [] },
  composition: { players: [{ id: 1, job: 'WHM' }] },
  damageEvents: [],
  castEvents: [],
  statusEvents: [],
  annotations: [],
  statData: undefined,
  isReplayMode: false,
  isShared: true,
  everPublished: true,
  hasLocalChanges: false,
  serverVersion: 1,
  createdAt: 0,
  updatedAt: 0,
}

describe('timelineSchema 漂移保护', () => {
  it('schema 保留所有非临时的 Timeline 字段', () => {
    const result = validateCreateRequest({ timeline: FULL_TIMELINE })
    expect(result.success).toBe(true)
    if (!result.success) return
    const output = result.output.timeline as Record<string, unknown>

    const allKeys = Object.keys(FULL_TIMELINE) as Array<keyof Timeline>
    const persistentKeys = allKeys.filter(k => !EPHEMERAL_KEYS.includes(k))

    const missing = persistentKeys.filter(k => !(k in output))
    expect(missing).toEqual([])
  })

  it('schema 剥离所有临时字段', () => {
    const result = validateCreateRequest({ timeline: FULL_TIMELINE })
    if (!result.success) throw new Error('schema rejected full fixture')
    const output = result.output.timeline as Record<string, unknown>

    const leaked = EPHEMERAL_KEYS.filter(k => k in output)
    expect(leaked).toEqual([])
  })

  it('gameZoneId 在 roundtrip 后等值保留', () => {
    const result = validateCreateRequest({ timeline: FULL_TIMELINE })
    if (!result.success) throw new Error('schema rejected full fixture')
    expect((result.output.timeline as { gameZoneId?: number }).gameZoneId).toBe(1321)
  })
})
```

**说明：** `isReplayMode` 虽然当前 schema 里已有 `v.optional(v.boolean())`，但它本质是运行时标记。这里把它归入 `EPHEMERAL_KEYS`，"剥离临时字段"测试会因此失败——我们选择把它留在 schema 并从 `EPHEMERAL_KEYS` 中**移除**。请在创建文件时使用下方更正版本：

```ts
const EPHEMERAL_KEYS: Array<keyof Timeline> = [
  'id',
  'statusEvents',
  'statData',
  'isShared',
  'everPublished',
  'hasLocalChanges',
  'serverVersion',
]
```

即：`isReplayMode` 是持久的，当前 schema 已正确声明。

- [ ] **Step 3: 运行测试确认通过**

Run: `pnpm test:run timelineSchema`
Expected: 通过（3 个用例）。

- [ ] **Step 4: 负向验证 —— 临时删掉 gameZoneId 确认测试失败**

临时注释掉 schema 里的 `gameZoneId: v.optional(v.number()),` 这行，再跑：

Run: `pnpm test:run timelineSchema`
Expected: FAIL，`missing` 数组包含 `['gameZoneId']`。

验证完毕后恢复这行代码。

- [ ] **Step 5: 运行既有 worker 测试确认未破坏**

Run: `pnpm test:run workers`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add src/workers/timelineSchema.ts src/workers/timelineSchema.test.ts
git commit -m "feat(worker): timelineSchema 新增 gameZoneId + 字段漂移保护测试"
```

---

## Task 3: RaidEncounter 接口新增 gameZoneId 字段并补值

**Files:**

- Modify: `src/data/raidEncounters.ts`

- [ ] **Step 1: 扩展接口并为 6 个条目填入 gameZoneId**

`gameZoneId` 值已经通过 FFLogs GraphQL API（`ReportFight.gameZone.id` 字段）验证。完整替换 `RaidEncounter` 接口和 `RAID_TIERS` 数组：

```ts
export interface RaidEncounter {
  // FFLogs 遭遇战 ID
  id: number
  // 完整名称
  name: string
  // 简称（用于显示）
  shortName: string
  // FFXIV 游戏内 ZoneID（人工维护，用于 Souma 时间轴导出）
  gameZoneId: number
}
```

```ts
export const RAID_TIERS: RaidTier[] = [
  {
    name: '阿卡狄亚零式登天斗技场 重量级',
    zone: 73,
    patch: '7.4',
    encounters: [
      { id: 101, name: '致命美人', shortName: 'M9S', gameZoneId: 1321 },
      { id: 102, name: '极限兄弟', shortName: 'M10S', gameZoneId: 1323 },
      { id: 103, name: '霸王', shortName: 'M11S', gameZoneId: 1325 },
      { id: 104, name: '林德布鲁姆', shortName: 'M12S', gameZoneId: 1327 },
      { id: 105, name: '林德布鲁姆 II', shortName: 'M12S', gameZoneId: 1327 },
    ],
  },
  {
    name: '光暗未来绝境战',
    zone: 65,
    patch: '7.1',
    encounters: [{ id: 1079, name: '光暗未来绝境战', shortName: 'FRU', gameZoneId: 1238 }],
  },
]
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 通过（必填字段全部已赋值）。

- [ ] **Step 3: 运行已有测试确认未破坏**

Run: `pnpm test:run raidEncounters`
Expected: 若无相关测试则跳过；若有则通过。

另外运行 `pnpm test:run top100Sync` 确认 TOP100 同步测试未被接口变更破坏。
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add src/data/raidEncounters.ts
git commit -m "feat(data): RaidEncounter 新增 gameZoneId 字段并补齐现有副本值"
```

---

## Task 4: FFLogsFight / FFLogsV2Fight 类型新增 gameZone

**Files:**

- Modify: `src/types/fflogs.ts`

- [ ] **Step 1: 扩展 FFLogsV2Fight**

在 `src/types/fflogs.ts` 找到 `FFLogsV2Fight`（约 313 行），追加字段：

```ts
export interface FFLogsV2Fight {
  id: number
  name: string
  difficulty: number
  kill?: boolean
  startTime: number
  endTime: number
  encounterID: number
  /** FFXIV 游戏内区域（可为 null，对应某些异常战斗） */
  gameZone?: { id: number } | null
}
```

- [ ] **Step 2: 扩展 FFLogsFight（兼容类型）**

在同文件找到 `FFLogsFight`（约 126 行），追加字段：

```ts
export interface FFLogsFight {
  id: number
  name: string
  difficulty?: number
  kill?: boolean
  startTime: number
  endTime: number
  encounterID?: number
  /** FFXIV 游戏内区域 id（仅 V2 查询包含，V1 回退为 undefined） */
  gameZoneId?: number
}
```

注意：这里用 `gameZoneId?: number` 而不是嵌套 `gameZone { id }`，因为这个兼容类型是给下游消费者（`fflogsImporter`）直接用的扁平结构。

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add src/types/fflogs.ts
git commit -m "feat(types): FFLogs 战斗类型新增 gameZone 字段"
```

---

## Task 5: fflogsClientV2 GraphQL 查询追加 gameZone

**Files:**

- Modify: `src/workers/fflogsClientV2.ts`

- [ ] **Step 1: 修改 `getReport` 查询的 fights 选段**

在 `src/workers/fflogsClientV2.ts` 的 `getReport` 方法（约 220 行）的 GraphQL 查询字符串内，找到 `fights { ... }` 块，追加 `gameZone { id }`：

```graphql
            fights {
              id
              name
              difficulty
              kill
              startTime
              endTime
              encounterID
              gameZone {
                id
              }
            }
```

- [ ] **Step 2: 修改 v1 转换写入 `gameZoneId`**

找到转换段（约 297–312 行）：

```ts
      fights: report.fights.map(fight => ({
        id: fight.id,
        name: fight.name,
        difficulty: fight.difficulty,
        kill: fight.kill || false,
        start_time: fight.startTime,
        end_time: fight.endTime,
        boss: fight.encounterID,
        zoneID: 0,
        zoneName: '',
        size: 8,
        hasEcho: false,
        bossPercentage: 0,
        fightPercentage: 0,
      })),
```

由于 `FFLogsV1Fight` 没有 `gameZoneId`，我们需要走另一条路径：`convertV1ToReport`（位于 `src/utils/fflogsImporter.ts`）会将 v1→`FFLogsReport`，在那里目前 `fight.gameZone` 字段没有传递。但是这里 `getReport` 返回的是 `FFLogsV1Report`，所以 v2 查出来的 `gameZone.id` 会在这个 map 里丢失。

正确做法是**同步扩展 `FFLogsV1Fight`** 再传递：

在 `src/types/fflogs.ts` 找到 `FFLogsV1Fight`（约 60 行），追加：

```ts
  /** FFXIV 游戏内区域 id（V2 查询填充，V1 原生无此字段） */
  gameZoneID?: number
```

然后回到 `fflogsClientV2.ts` 转换段加一行：

```ts
        boss: fight.encounterID,
        zoneID: 0,
        zoneName: '',
        gameZoneID: fight.gameZone?.id != null ? Math.floor(fight.gameZone.id) : undefined,
        size: 8,
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 通过。

- [ ] **Step 4: 运行 worker 测试确认未破坏**

Run: `pnpm test:run workers`
Expected: 通过（现有测试不读取 gameZoneID，不会失败）。

- [ ] **Step 5: 提交**

```bash
git add src/workers/fflogsClientV2.ts src/types/fflogs.ts
git commit -m "feat(fflogs): GraphQL 查询新增 gameZone.id 并向下传递"
```

---

## Task 6: fflogsImporter / convertV1ToReport 传递 gameZoneId 到 FFLogsFight

**Files:**

- Modify: `src/utils/fflogsImporter.ts`

- [ ] **Step 1: 在 convertV1ToReport 中映射 gameZoneId**

在 `src/utils/fflogsImporter.ts`（约 32 行）的 `fights.map` 里添加：

```ts
    fights: v1Report.fights.map(fight => ({
      id: fight.id,
      name: fight.name,
      difficulty: fight.difficulty,
      kill: fight.kill || false,
      startTime: fight.start_time,
      endTime: fight.end_time,
      encounterID: fight.boss,
      gameZoneId: fight.gameZoneID,
    })),
```

这样 `FFLogsReport.fights[i].gameZoneId` 就会从 worker 的 V2 查询一路传到前端导入逻辑。

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/utils/fflogsImporter.ts
git commit -m "feat(fflogs): convertV1ToReport 传递 gameZoneId"
```

---

## Task 7: ImportFFLogsDialog 将 gameZoneId 写入新建 Timeline

**Files:**

- Modify: `src/components/ImportFFLogsDialog.tsx`

- [ ] **Step 1: 在创建 timeline 后写入 gameZoneId**

在 `src/components/ImportFFLogsDialog.tsx` 约第 164 行后（`newTimeline.encounter = { ... }` 之后），添加：

```ts
// 写入 gameZoneId（仅当 FFLogs 返回了该字段时）
if (fight.gameZoneId != null) {
  newTimeline.gameZoneId = fight.gameZoneId
}
```

（位置：紧跟 `newTimeline.encounter = { ... }` 赋值块之后，`// 获取伤害事件` 注释之前）

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/components/ImportFFLogsDialog.tsx
git commit -m "feat(fflogs): 导入时写入 timeline.gameZoneId"
```

---

## Task 8: createNewTimeline 本地新建时从静态表写入 gameZoneId

**Files:**

- Modify: `src/utils/timelineStorage.ts`

- [ ] **Step 1: 修改 createNewTimeline 查表写入**

在 `src/utils/timelineStorage.ts`（约 136 行）修改函数：

```ts
import { getEncounterById } from '@/data/raidEncounters'

// ...

export function createNewTimeline(encounterId: string, name: string): Timeline {
  const now = Math.floor(Date.now() / 1000)
  const encounterIdNum = parseInt(encounterId) || 0
  const staticEncounter = getEncounterById(encounterIdNum)

  return {
    id: generateId(),
    name,
    encounter: {
      id: encounterIdNum,
      name: name,
      displayName: name,
      zone: '',
      damageEvents: [],
    },
    gameZoneId: staticEncounter?.gameZoneId,
    damageEvents: [],
    castEvents: [],
    statusEvents: [],
    annotations: [],
    composition: {
      players: [],
    },
    createdAt: now,
    updatedAt: now,
  }
}
```

注意 `getEncounterById` 已在 `raidEncounters.ts` 中导出，若文件顶部已有 import 则只追加符号；否则新增 import。

- [ ] **Step 2: 运行存量测试**

Run: `pnpm test:run timelineStorage`
Expected: 通过（现有测试不读取 gameZoneId，不会失败）。

- [ ] **Step 3: 手动验证**

```ts
// 临时在控制台或 tsx 中验证（可不提交）：
import { createNewTimeline } from '@/utils/timelineStorage'
const t = createNewTimeline('101', 'test')
console.log(t.gameZoneId) // 应输出 1321
const t2 = createNewTimeline('99999', 'test')
console.log(t2.gameZoneId) // 应输出 undefined
```

- [ ] **Step 4: 提交**

```bash
git add src/utils/timelineStorage.ts
git commit -m "feat(storage): createNewTimeline 从静态表写入 gameZoneId"
```

---

## Task 9: soumaExporter —— formatTime（TDD）

**Files:**

- Create: `src/utils/soumaExporter.ts`
- Create: `src/utils/soumaExporter.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/utils/soumaExporter.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { formatSoumaTime } from './soumaExporter'

describe('formatSoumaTime', () => {
  it('zero → "00:00.0"', () => {
    expect(formatSoumaTime(0)).toBe('00:00.0')
  })

  it('positive < 60 → "00:ss.d"', () => {
    expect(formatSoumaTime(12.34)).toBe('00:12.3')
  })

  it('positive ≥ 60 → "mm:ss.d"', () => {
    expect(formatSoumaTime(125.45)).toBe('02:05.5')
  })

  it('positive carry: 59.95 → "01:00.0"', () => {
    expect(formatSoumaTime(59.95)).toBe('01:00.0')
  })

  it('exact minute: 60.0 → "01:00.0"', () => {
    expect(formatSoumaTime(60)).toBe('01:00.0')
  })

  it('negative integer → "-20.0"', () => {
    expect(formatSoumaTime(-20)).toBe('-20.0')
  })

  it('negative fractional → "-0.5"', () => {
    expect(formatSoumaTime(-0.5)).toBe('-0.5')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run soumaExporter`
Expected: FAIL（`soumaExporter.ts` 不存在）。

- [ ] **Step 3: 实现 formatSoumaTime**

创建 `src/utils/soumaExporter.ts`：

```ts
/**
 * Souma 时间轴导出工具
 *
 * 将 Healerbook 时间轴转换为 cactbot 风格的压缩字符串，
 * 可直接被 ff14-overlay-vue 的时间轴模块导入。
 */

/**
 * 格式化时间为 Souma 时间轴可接受的字符串。
 * - t >= 0：`mm:ss.d`（十分位四舍五入并正确进位）
 * - t < 0：`-X.X`（浮点字符串，保留一位小数）
 */
export function formatSoumaTime(t: number): string {
  if (t < 0) return t.toFixed(1)

  // 先按 0.1s 精度四舍五入，再拆分 mm/ss，避免 59.95 被显示为 00:60.0
  const deciseconds = Math.round(t * 10)
  const totalSeconds = Math.floor(deciseconds / 10)
  const tenths = deciseconds % 10
  const mm = Math.floor(totalSeconds / 60)
  const ss = totalSeconds % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${tenths}`
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run soumaExporter`
Expected: PASS（7 个用例通过）。

- [ ] **Step 5: 提交**

```bash
git add src/utils/soumaExporter.ts src/utils/soumaExporter.test.ts
git commit -m "feat(export): soumaExporter 新增 formatSoumaTime"
```

---

## Task 10: soumaExporter —— buildTimelineText（TDD）

**Files:**

- Modify: `src/utils/soumaExporter.ts`
- Modify: `src/utils/soumaExporter.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `src/utils/soumaExporter.test.ts` 末尾追加：

```ts
import type { Timeline, CastEvent } from '@/types/timeline'
import { buildSoumaTimelineText } from './soumaExporter'

function makeTimeline(overrides: Partial<Timeline> = {}): Timeline {
  return {
    id: 't1',
    name: '测试',
    encounter: { id: 101, name: 'M9S', displayName: 'M9S', zone: '', damageEvents: [] },
    composition: { players: [{ id: 1, job: 'WHM' }] },
    damageEvents: [],
    castEvents: [],
    statusEvents: [],
    annotations: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function makeCast(
  partial: Partial<CastEvent> & Pick<CastEvent, 'actionId' | 'timestamp'>
): CastEvent {
  return {
    id: `c-${partial.actionId}-${partial.timestamp}`,
    actionId: partial.actionId,
    timestamp: partial.timestamp,
    playerId: partial.playerId ?? 1,
    job: partial.job ?? 'WHM',
    ...partial,
  }
}

describe('buildSoumaTimelineText', () => {
  it('按时间升序输出行，使用 <技能名>~ 格式', () => {
    const timeline = makeTimeline({
      castEvents: [
        makeCast({ actionId: 16536, timestamp: 30 }), // 白魔 - 神名
        makeCast({ actionId: 7432, timestamp: 10 }), // 白魔 - 天赐祝福
      ],
    })
    const text = buildSoumaTimelineText(timeline, 1, [16536, 7432], false)
    const lines = text.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^00:10\.0 "<.+>~"$/)
    expect(lines[1]).toMatch(/^00:30\.0 "<.+>~"$/)
  })

  it('TTS 开启时追加裸 tts', () => {
    const timeline = makeTimeline({
      castEvents: [makeCast({ actionId: 16536, timestamp: 30 })],
    })
    const text = buildSoumaTimelineText(timeline, 1, [16536], true)
    expect(text).toMatch(/^00:30\.0 "<.+>~" tts$/)
  })

  it('过滤未选中的技能', () => {
    const timeline = makeTimeline({
      castEvents: [
        makeCast({ actionId: 16536, timestamp: 10 }),
        makeCast({ actionId: 7432, timestamp: 20 }),
      ],
    })
    const text = buildSoumaTimelineText(timeline, 1, [16536], false)
    expect(text.split('\n')).toHaveLength(1)
    expect(text).toContain('00:10.0')
  })

  it('过滤其他玩家的技能', () => {
    const timeline = makeTimeline({
      composition: {
        players: [
          { id: 1, job: 'WHM' },
          { id: 2, job: 'SCH' },
        ],
      },
      castEvents: [
        makeCast({ actionId: 16536, timestamp: 10, playerId: 1, job: 'WHM' }),
        makeCast({ actionId: 7432, timestamp: 20, playerId: 2, job: 'SCH' }),
      ],
    })
    const text = buildSoumaTimelineText(timeline, 1, [16536, 7432], false)
    expect(text.split('\n')).toHaveLength(1)
    expect(text).toContain('00:10.0')
  })

  it('未知 actionId 静默跳过', () => {
    const timeline = makeTimeline({
      castEvents: [
        makeCast({ actionId: 16536, timestamp: 10 }),
        makeCast({ actionId: 999999, timestamp: 20 }),
      ],
    })
    const text = buildSoumaTimelineText(timeline, 1, [16536, 999999], false)
    expect(text.split('\n')).toHaveLength(1)
  })

  it('空选返回空字符串', () => {
    const timeline = makeTimeline({
      castEvents: [makeCast({ actionId: 16536, timestamp: 10 })],
    })
    expect(buildSoumaTimelineText(timeline, 1, [], false)).toBe('')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run soumaExporter`
Expected: FAIL（`buildSoumaTimelineText` 未定义）。

- [ ] **Step 3: 实现 buildSoumaTimelineText**

在 `src/utils/soumaExporter.ts` 追加：

```ts
import type { Timeline } from '@/types/timeline'
import { MITIGATION_DATA } from '@/data/mitigationActions'

/**
 * 将指定玩家在时间轴上使用过的技能转换为 Souma 时间轴文本。
 * 每行格式：`mm:ss.d "<技能名>~"[ tts]`
 */
export function buildSoumaTimelineText(
  timeline: Timeline,
  playerId: number,
  selectedActionIds: number[],
  ttsEnabled: boolean
): string {
  if (selectedActionIds.length === 0) return ''

  const selectedSet = new Set(selectedActionIds)
  const casts = timeline.castEvents
    .filter(c => c.playerId === playerId && selectedSet.has(c.actionId))
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)

  const lines: string[] = []
  for (const cast of casts) {
    const action = MITIGATION_DATA.actions.find(a => a.id === cast.actionId)
    if (!action) continue // 未知 id 静默跳过
    const time = formatSoumaTime(cast.timestamp)
    const tts = ttsEnabled ? ' tts' : ''
    lines.push(`${time} "<${action.name}>~"${tts}`)
  }

  return lines.join('\n')
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run soumaExporter`
Expected: PASS（13 个用例总和）。

- [ ] **Step 5: 提交**

```bash
git add src/utils/soumaExporter.ts src/utils/soumaExporter.test.ts
git commit -m "feat(export): soumaExporter 新增 buildSoumaTimelineText"
```

---

## Task 11: soumaExporter —— wrapAsITimeline（TDD，三级 fallback）

**Files:**

- Modify: `src/utils/soumaExporter.ts`
- Modify: `src/utils/soumaExporter.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `src/utils/soumaExporter.test.ts` 末尾追加：

```ts
import { wrapAsSoumaITimeline } from './soumaExporter'

describe('wrapAsSoumaITimeline', () => {
  it('name 拼接职业 code', () => {
    const timeline = makeTimeline({ name: 'M9S 规划' })
    const wrapped = wrapAsSoumaITimeline(timeline, 1, 'text')
    expect(wrapped.name).toBe('M9S 规划 - WHM')
  })

  it('condition.jobs 填入玩家职业', () => {
    const timeline = makeTimeline({
      composition: { players: [{ id: 1, job: 'SCH' }] },
    })
    const wrapped = wrapAsSoumaITimeline(timeline, 1, 'text')
    expect(wrapped.condition.jobs).toEqual(['SCH'])
  })

  it('timeline.gameZoneId 存在时优先使用', () => {
    const timeline = makeTimeline({ gameZoneId: 9999 })
    const wrapped = wrapAsSoumaITimeline(timeline, 1, 'text')
    expect(wrapped.condition.zoneId).toBe('9999')
  })

  it('timeline.gameZoneId 缺失、encounter.id 命中静态表时回退静态表', () => {
    const timeline = makeTimeline({
      gameZoneId: undefined,
      encounter: { id: 101, name: '', displayName: '', zone: '', damageEvents: [] },
    })
    const wrapped = wrapAsSoumaITimeline(timeline, 1, 'text')
    expect(wrapped.condition.zoneId).toBe('1321') // 来自 raidEncounters.ts
  })

  it('两者均缺失时回退 "0"', () => {
    const timeline = makeTimeline({
      gameZoneId: undefined,
      encounter: { id: 999999, name: '', displayName: '', zone: '', damageEvents: [] },
    })
    const wrapped = wrapAsSoumaITimeline(timeline, 1, 'text')
    expect(wrapped.condition.zoneId).toBe('0')
  })

  it('codeFight / create 固定字段', () => {
    const timeline = makeTimeline()
    const wrapped = wrapAsSoumaITimeline(timeline, 1, 'text')
    expect(wrapped.codeFight).toBe('Healerbook 导出')
    expect(typeof wrapped.create).toBe('string')
    expect(wrapped.create.length).toBeGreaterThan(0)
  })

  it('timeline 内容原样透传', () => {
    const wrapped = wrapAsSoumaITimeline(makeTimeline(), 1, 'abc\ndef')
    expect(wrapped.timeline).toBe('abc\ndef')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run soumaExporter`
Expected: FAIL（`wrapAsSoumaITimeline` 未定义）。

- [ ] **Step 3: 实现 wrapAsSoumaITimeline**

在 `src/utils/soumaExporter.ts` 顶部 import 区追加：

```ts
import { getEncounterById } from '@/data/raidEncounters'
import type { Job } from '@/data/jobs'
```

然后在文件末尾追加：

```ts
/** ff14-overlay-vue 的 ITimeline 最小形态（对齐但不引入外部依赖） */
export interface SoumaITimeline {
  name: string
  condition: { zoneId: string; jobs: Job[] }
  timeline: string
  codeFight: string
  create: string
}

/**
 * 将 timeline + 玩家 + 行文本包装为 Souma 的 ITimeline。
 * zoneId 使用三级 fallback：
 *   1. timeline.gameZoneId
 *   2. 静态表 getEncounterById(timeline.encounter.id)?.gameZoneId
 *   3. "0"
 */
export function wrapAsSoumaITimeline(
  timeline: Timeline,
  playerId: number,
  timelineText: string
): SoumaITimeline {
  const player = timeline.composition.players.find(p => p.id === playerId)
  const jobCode = (player?.job ?? 'NONE') as Job

  const staticZoneId = getEncounterById(timeline.encounter.id)?.gameZoneId
  const zoneId = String(timeline.gameZoneId ?? staticZoneId ?? 0)

  return {
    name: `${timeline.name} - ${jobCode}`,
    condition: { zoneId, jobs: [jobCode] },
    timeline: timelineText,
    codeFight: 'Healerbook 导出',
    create: new Date().toLocaleString(),
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run soumaExporter`
Expected: PASS（20 个用例总和）。

- [ ] **Step 5: 提交**

```bash
git add src/utils/soumaExporter.ts src/utils/soumaExporter.test.ts
git commit -m "feat(export): wrapAsSoumaITimeline 含三级 zoneId fallback"
```

---

## Task 12: soumaExporter —— exportSoumaTimeline（压缩 + roundtrip 测试）

**Files:**

- Modify: `src/utils/soumaExporter.ts`
- Modify: `src/utils/soumaExporter.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `src/utils/soumaExporter.test.ts` 末尾追加：

```ts
import LZString from 'lz-string'
import { exportSoumaTimeline } from './soumaExporter'

describe('exportSoumaTimeline', () => {
  it('roundtrip: 解压后是 ITimeline 数组且字段正确', () => {
    const timeline = makeTimeline({
      name: '测试',
      gameZoneId: 1321,
      castEvents: [makeCast({ actionId: 16536, timestamp: 30 })],
    })
    const compressed = exportSoumaTimeline({
      timeline,
      playerId: 1,
      selectedActionIds: [16536],
      ttsEnabled: true,
    })
    const decompressed = LZString.decompressFromBase64(compressed)
    expect(decompressed).not.toBeNull()
    const parsed = JSON.parse(decompressed!)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('测试 - WHM')
    expect(parsed[0].condition.zoneId).toBe('1321')
    expect(parsed[0].condition.jobs).toEqual(['WHM'])
    expect(parsed[0].timeline).toMatch(/^00:30\.0 "<.+>~" tts$/)
    expect(parsed[0].codeFight).toBe('Healerbook 导出')
  })

  it('空选时 timeline 字段为空字符串', () => {
    const timeline = makeTimeline({ gameZoneId: 1321 })
    const compressed = exportSoumaTimeline({
      timeline,
      playerId: 1,
      selectedActionIds: [],
      ttsEnabled: false,
    })
    const parsed = JSON.parse(LZString.decompressFromBase64(compressed)!)
    expect(parsed[0].timeline).toBe('')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run soumaExporter`
Expected: FAIL（`exportSoumaTimeline` 未定义）。

- [ ] **Step 3: 实现 exportSoumaTimeline**

在 `src/utils/soumaExporter.ts` 顶部 import 区追加：

```ts
import LZString from 'lz-string'
```

在文件末尾追加：

```ts
export interface SoumaExportParams {
  timeline: Timeline
  playerId: number
  selectedActionIds: number[]
  ttsEnabled: boolean
}

/**
 * 将 Healerbook 时间轴导出为 Souma 兼容的压缩字符串。
 * 输出格式：`LZString.compressToBase64(JSON.stringify([ITimeline]))`
 */
export function exportSoumaTimeline(params: SoumaExportParams): string {
  const { timeline, playerId, selectedActionIds, ttsEnabled } = params
  const text = buildSoumaTimelineText(timeline, playerId, selectedActionIds, ttsEnabled)
  const wrapped = wrapAsSoumaITimeline(timeline, playerId, text)
  return LZString.compressToBase64(JSON.stringify([wrapped]))
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run soumaExporter`
Expected: PASS（22 个用例总和）。

- [ ] **Step 5: 提交**

```bash
git add src/utils/soumaExporter.ts src/utils/soumaExporter.test.ts
git commit -m "feat(export): exportSoumaTimeline 完成压缩编排"
```

---

## Task 13: ExportSoumaDialog 组件 —— 骨架与玩家选择

**Files:**

- Create: `src/components/ExportSoumaDialog.tsx`

- [ ] **Step 1: 先查看 ExportExcelDialog 的结构作为参考**

Run: `cat src/components/ExportExcelDialog.tsx | head -60`
目的：确认 Modal / Button / Switch 的 import 风格、props 约定、样式基调与此文件对齐。

- [ ] **Step 2: 创建骨架**

创建 `src/components/ExportSoumaDialog.tsx`：

```tsx
/**
 * 导出 Souma 时间轴对话框
 *
 * 让用户选择玩家、勾选技能、切换 TTS，实时生成可被 ff14-overlay-vue
 * 时间轴模块直接导入的压缩字符串，一键复制。
 */

import { useMemo, useState, useEffect } from 'react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { useTimelineStore } from '@/store/timelineStore'
import { getJobName } from '@/data/jobs'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getIconUrl } from '@/utils/iconUtils'
import { exportSoumaTimeline } from '@/utils/soumaExporter'
import { track } from '@/utils/analytics'
import { cn } from '@/lib/utils'

interface ExportSoumaDialogProps {
  open: boolean
  onClose: () => void
}

export default function ExportSoumaDialog({ open, onClose }: ExportSoumaDialogProps) {
  const timeline = useTimelineStore(s => s.timeline)

  // 玩家下拉选项：若同职业有多人，追加 #n 以区分
  const playerOptions = useMemo(() => {
    if (!timeline) return []
    const jobCounts = new Map<string, number>()
    timeline.composition.players.forEach(p => {
      jobCounts.set(p.job, (jobCounts.get(p.job) ?? 0) + 1)
    })
    const jobSeen = new Map<string, number>()
    return timeline.composition.players.map(p => {
      const total = jobCounts.get(p.job) ?? 1
      const index = (jobSeen.get(p.job) ?? 0) + 1
      jobSeen.set(p.job, index)
      const label = total > 1 ? `${getJobName(p.job)} #${index}` : getJobName(p.job)
      return { id: p.id, job: p.job, label }
    })
  }, [timeline])

  const [playerId, setPlayerId] = useState<number | null>(null)
  const [selectedActionIds, setSelectedActionIds] = useState<Set<number>>(new Set())
  const [ttsEnabled, setTtsEnabled] = useState(false)

  // 对话框打开 / 时间轴切换时：默认选中第一个有 castEvents 的玩家
  useEffect(() => {
    if (!open || !timeline || playerOptions.length === 0) return
    const firstWithCasts = playerOptions.find(p =>
      timeline.castEvents.some(c => c.playerId === p.id)
    )
    setPlayerId(firstWithCasts?.id ?? playerOptions[0]?.id ?? null)
  }, [open, timeline, playerOptions])

  // 玩家切换时：重置技能选中为该玩家用过的所有技能
  useEffect(() => {
    if (!timeline || playerId == null) {
      setSelectedActionIds(new Set())
      return
    }
    const usedIds = new Set(
      timeline.castEvents.filter(c => c.playerId === playerId).map(c => c.actionId)
    )
    setSelectedActionIds(usedIds)
  }, [timeline, playerId])

  if (!timeline) return null

  const hasCasts = timeline.castEvents.length > 0

  return (
    <Modal open={open} onClose={onClose} maxWidth="lg">
      <ModalContent>
        <ModalHeader>
          <ModalTitle>导出 Souma 时间轴</ModalTitle>
        </ModalHeader>

        {!hasCasts ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            当前时间轴无可导出的技能使用事件
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* 玩家选择 */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">玩家</label>
              <Select
                value={playerId?.toString() ?? ''}
                onValueChange={v => setPlayerId(Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择玩家" />
                </SelectTrigger>
                <SelectContent>
                  {playerOptions.map(p => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* 占位：技能网格 / TTS / 预览将在后续 Task 填入 */}
          </div>
        )}

        <ModalFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add src/components/ExportSoumaDialog.tsx
git commit -m "feat(export): ExportSoumaDialog 骨架与玩家选择"
```

---

## Task 14: ExportSoumaDialog —— 技能图标网格

**Files:**

- Modify: `src/components/ExportSoumaDialog.tsx`

- [ ] **Step 1: 增加技能网格 state 与渲染**

在 `ExportSoumaDialog.tsx` 内的"占位"注释位置，替换为技能网格 + TTS 开关：

```tsx
{
  /* 技能图标网格（仅列出该玩家用过的技能） */
}
;<div className="space-y-1.5">
  <label className="text-sm font-medium">技能</label>
  {(() => {
    if (playerId == null) return null
    const usedIds = Array.from(
      new Set(timeline.castEvents.filter(c => c.playerId === playerId).map(c => c.actionId))
    )
    const actions = usedIds
      .map(id => MITIGATION_DATA.actions.find(a => a.id === id))
      .filter((a): a is NonNullable<typeof a> => a != null)

    if (actions.length === 0) {
      return <div className="text-xs text-muted-foreground">该玩家未使用任何技能</div>
    }

    return (
      <div className="flex flex-wrap gap-2">
        {actions.map(action => {
          const selected = selectedActionIds.has(action.id)
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => {
                setSelectedActionIds(prev => {
                  const next = new Set(prev)
                  if (next.has(action.id)) next.delete(action.id)
                  else next.add(action.id)
                  return next
                })
              }}
              className={cn(
                'relative h-10 w-10 overflow-hidden rounded-md border transition',
                selected
                  ? 'border-primary ring-1 ring-primary'
                  : 'border-border opacity-40 grayscale hover:opacity-70'
              )}
              title={action.name}
            >
              <img
                src={getIconUrl(action.icon)}
                alt={action.name}
                className="h-full w-full object-cover"
              />
              {selected && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[10px] font-bold leading-none text-white shadow">
                  ✓
                </span>
              )}
            </button>
          )
        })}
      </div>
    )
  })()}
</div>

{
  /* TTS 开关 */
}
;<div className="flex items-center justify-between pt-1">
  <label htmlFor="souma-tts-switch" className="text-sm font-medium">
    启用 TTS 播报
  </label>
  <Switch id="souma-tts-switch" checked={ttsEnabled} onCheckedChange={setTtsEnabled} />
</div>
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/components/ExportSoumaDialog.tsx
git commit -m "feat(export): ExportSoumaDialog 技能图标网格与 TTS 开关"
```

---

## Task 15: ExportSoumaDialog —— 实时预览文本框与复制按钮

**Files:**

- Modify: `src/components/ExportSoumaDialog.tsx`

- [ ] **Step 1: 追加 textarea 与复制逻辑**

在 TTS 开关后、`</div>` 关闭前（即表单主体的末尾），追加实时预览区域：

```tsx
{
  /* 实时预览 */
}
;<div className="space-y-1.5 pt-1">
  <label className="text-sm font-medium">压缩字符串</label>
  <textarea
    readOnly
    value={exportString}
    className="h-32 w-full resize-none rounded-md border bg-muted/30 p-2 font-mono text-xs"
  />
</div>
```

在 `ExportSoumaDialog` 函数体内（`if (!timeline) return null` 之前），追加派生 state 与 handler：

```tsx
const hasSelection = selectedActionIds.size > 0

const exportString = useMemo(() => {
  if (playerId == null || !timeline) return ''
  if (!hasSelection) return '请至少选择一个技能'
  return exportSoumaTimeline({
    timeline,
    playerId,
    selectedActionIds: Array.from(selectedActionIds),
    ttsEnabled,
  })
}, [timeline, playerId, selectedActionIds, ttsEnabled, hasSelection])

const handleCopy = async () => {
  if (!hasSelection || playerId == null) return
  try {
    await navigator.clipboard.writeText(exportString)
    toast.success('已复制到剪贴板')
    const player = playerOptions.find(p => p.id === playerId)
    track('souma-export-copy', {
      job: player?.job,
      skillCount: selectedActionIds.size,
      ttsEnabled,
    })
  } catch {
    toast.error('复制失败，请手动选中文本')
  }
}
```

然后修改 `ModalFooter`，追加复制按钮：

```tsx
<ModalFooter>
  <Button variant="outline" onClick={onClose}>
    关闭
  </Button>
  {hasCasts && (
    <Button onClick={handleCopy} disabled={!hasSelection}>
      <Copy className="mr-1.5 h-4 w-4" />
      复制
    </Button>
  )}
</ModalFooter>
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 通过。

- [ ] **Step 3: 单文件快速测试（可选 —— 仅类型和未使用变量检查）**

Run: `pnpm lint src/components/ExportSoumaDialog.tsx`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add src/components/ExportSoumaDialog.tsx
git commit -m "feat(export): ExportSoumaDialog 实时预览与复制"
```

---

## Task 16: EditorToolbar —— 新增 Souma 菜单项

**Files:**

- Modify: `src/components/EditorToolbar.tsx`

- [ ] **Step 1: 新增懒加载 import**

在 `src/components/EditorToolbar.tsx` 顶部的 `const ExportExcelDialog = lazy(...)` 行下方追加：

```ts
const ExportSoumaDialog = lazy(() => import('./ExportSoumaDialog'))
```

- [ ] **Step 2: 新增 state**

在 `const [showExportDialog, setShowExportDialog] = useState(false)` 附近（约 99 行）追加：

```ts
const [showSoumaDialog, setShowSoumaDialog] = useState(false)
```

- [ ] **Step 3: 新增菜单项**

在 `DropdownMenuContent` 内的 `Excel 表格...` 菜单项下方（约 380 行）追加：

```tsx
<DropdownMenuItem
  onSelect={() => {
    track('souma-export-start')
    setShowSoumaDialog(true)
  }}
>
  Souma 时间轴...
</DropdownMenuItem>
```

- [ ] **Step 4: 挂载对话框**

在 `<Suspense fallback={null}>` 内的 `ExportExcelDialog` 条件渲染旁边（约 438 行）追加：

```tsx
{
  showSoumaDialog && (
    <ExportSoumaDialog open={showSoumaDialog} onClose={() => setShowSoumaDialog(false)} />
  )
}
```

- [ ] **Step 5: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint src/components/EditorToolbar.tsx`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add src/components/EditorToolbar.tsx
git commit -m "feat(export): 工具栏新增 Souma 时间轴导出菜单项"
```

---

## Task 17: 浏览器手动验证

**Files:** —

- [ ] **Step 1: 启动开发服务器**

Run: `pnpm dev`
Expected: 服务在 http://localhost:5173 启动，无编译错误。

- [ ] **Step 2: 基础 smoke test**

手动步骤（在浏览器内操作）：

1. 打开任一已有时间轴（若无则新建一个 M9S，并通过 FFLogs 导入一份报告以便有 castEvents）。
2. 点击工具栏"导出"图标 → 确认出现 `Excel 表格...` 和 `Souma 时间轴...` 两项。
3. 点击 `Souma 时间轴...` → 对话框打开，默认玩家为第一个有技能使用事件的玩家。
4. 检查技能图标网格渲染正常，默认全选（所有图标均为正常亮度 + 右上角绿色对号）。
5. 点击某个图标 → 图标变暗 + 对号消失；再点击恢复。
6. 切换玩家 → 技能网格刷新且默认全选。
7. 打开 TTS 开关 → textarea 内每行末尾出现 ` tts`。
8. 点击"复制" → 出现 Toast "已复制到剪贴板"，对话框不关闭。
9. 在任意文本编辑器粘贴复制的字符串，在 LZString 解压工具（或浏览器 console）内验证：
   ```js
   const LZString = await import('https://cdn.jsdelivr.net/npm/lz-string@1.5.0/+esm').then(
     m => m.default
   )
   JSON.parse(LZString.decompressFromBase64('<粘贴的字符串>'))
   ```
   应输出含 `name`, `condition`, `timeline`, `codeFight`, `create` 的数组。
10. 清空所有技能选中 → textarea 显示 `请至少选择一个技能`，"复制"按钮置灰。
11. 关闭对话框 → 无 console 警告。

- [ ] **Step 3: 整轮单测与类型检查**

Run: `pnpm test:run && pnpm exec tsc --noEmit && pnpm lint`
Expected: 全部通过。

- [ ] **Step 4: 停止 dev server**

`Ctrl+C` 结束 `pnpm dev`。

---

## 最终校对

- [ ] **Step 1: 提交完整性检查**

Run: `git log --oneline main..HEAD`
Expected: 看到 Task 1–16 的每次提交独立存在，提交信息清晰。

- [ ] **Step 2: 全文件再次 lint / format**

Run: `pnpm lint && pnpm format`
Expected: 无错误、无未格式化文件（若 format 修改了文件，补提 `chore: format`）。

- [ ] **Step 3: 完整测试套件**

Run: `pnpm test:run`
Expected: 所有测试通过（新增 ≈22 个 soumaExporter 用例）。

---

## 附录：关键文件结构速查

| 文件                                    | 作用                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/utils/soumaExporter.ts`            | 导出纯函数模块（formatTime / buildTimelineText / wrapAsITimeline / exportSoumaTimeline）                          |
| `src/utils/soumaExporter.test.ts`       | 单测（7 + 6 + 7 + 2 = 22 用例）                                                                                   |
| `src/components/ExportSoumaDialog.tsx`  | 对话框组件（玩家 Select / 技能网格 / TTS Switch / 预览 textarea / 复制按钮）                                      |
| `src/types/timeline.ts`                 | `Timeline.gameZoneId?: number`                                                                                    |
| `src/data/raidEncounters.ts`            | `RaidEncounter.gameZoneId: number`（必填）                                                                        |
| `src/types/fflogs.ts`                   | `FFLogsV2Fight.gameZone?: { id: number }`、`FFLogsV1Fight.gameZoneID?: number`、`FFLogsFight.gameZoneId?: number` |
| `src/workers/fflogsClientV2.ts`         | GraphQL 查询追加 `gameZone { id }`，v1 转换写入                                                                   |
| `src/utils/fflogsImporter.ts`           | `convertV1ToReport` 映射 `gameZoneID → gameZoneId`                                                                |
| `src/components/ImportFFLogsDialog.tsx` | 导入时写入 `newTimeline.gameZoneId`                                                                               |
| `src/utils/timelineStorage.ts`          | `createNewTimeline` 从静态表查表写入 `gameZoneId`                                                                 |
| `src/components/EditorToolbar.tsx`      | 菜单项 + 懒加载 Dialog                                                                                            |
