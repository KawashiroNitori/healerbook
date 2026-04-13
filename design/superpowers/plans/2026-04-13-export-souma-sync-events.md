# Souma 时间轴 Sync 行导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **执行回顾（2026-04-13 完成）**：本计划已实施，执行过程中产生两处偏离：
>
> 1. **Task 2**：原计划直接 `import { factory } from '@ff14-overlay/resources/timelineSpecialRules'`，但在 `tsc -b --noEmit` 下会经由 `types/fflogs.d.ts → types/timeline.ts` 触发 submodule 的 TS enum + 缺失 cactbot 依赖错误（与本仓 `erasableSyntaxOnly: true` 冲突）。决定放弃调用 submodule 的 `factory`，改为在 `src/data/soumaSyncRules.ts` 自有一份规则表（初始种子来自 submodule，后续独立演进）。
> 2. **Task 3**：原计划只接入 `ImportFFLogsDialog.tsx`（客户端路径），遗漏了服务端 Worker 路径 `src/workers/fflogsImportHandler.ts`。已补充同步写入，否则服务端导入的 timeline 将静默缺失 `syncEvents`。

**Goal:** 在 Healerbook 时间轴数据结构中引入 `syncEvents` 字段，并在导出 Souma 时间轴时把 boss 关键技能渲染为 cactbot `sync` 行，让导出的时间轴在 ff14-overlay-vue 运行时具备战斗自动同步能力。

**Architecture:**

- FFLogs 导入时，扫描 events 流里的 boss `cast`/`begincast`，通过调用 submodule 里已导出的 `factory()` 原地打标，筛出命中规则的事件并在导入期就消解 `battleOnce` 去重，最终产出 `SyncEvent[]` 存入 `Timeline.syncEvents`
- 导出阶段 `buildSoumaTimelineText` 把 `syncEvents` 作为第三类条目（`order=2`）与注释行 / 技能行统一按时间排序，同秒撞车时排在技能之后（sync 行用户不可见，先后顺序无实际影响）
- Worker schema 加 `SyncEventSchema` 保护字段漂移；本地存储依赖 JSON 序列化天然兼容 optional 字段

**Tech Stack:** React 19 + TypeScript，Vitest，valibot schema，`lz-string`，ff14-overlay-vue submodule（`@ff14-overlay/*` 路径别名）

---

## 文件结构

本次改动只修改 `src/` 下 6 个文件，不新增文件。规则表直接调用 submodule 的 `factory` 函数，不 patch、不 codegen。

| 文件                                    | 用途                                             | 操作   |
| --------------------------------------- | ------------------------------------------------ | ------ |
| `src/types/timeline.ts`                 | `Timeline`/`SyncEvent` 类型定义                  | Modify |
| `src/workers/timelineSchema.ts`         | valibot 服务端 schema                            | Modify |
| `src/workers/timelineSchema.test.ts`    | 字段漂移保护测试                                 | Modify |
| `src/utils/fflogsImporter.ts`           | 新增 `parseSyncEvents()` 函数                    | Modify |
| `src/utils/fflogsImporter.test.ts`      | `parseSyncEvents` 单元测试                       | Modify |
| `src/components/ImportFFLogsDialog.tsx` | 导入流程中调用 `parseSyncEvents` 并写入 timeline | Modify |
| `src/utils/soumaExporter.ts`            | `buildSoumaTimelineText` 输出 sync 行            | Modify |
| `src/utils/soumaExporter.test.ts`       | sync 行 golden 测试                              | Modify |

---

## 背景知识（实施前必读）

### 1. Souma sync 行文本格式

cactbot/netregex 风格，单行：

```
<time> "<actionName>" <StartsUsing|Ability> { id: "<HEX>" } window <before>,<after>[ once]
```

- `time` 用 `formatSoumaTime()` 输出 `mm:ss.d`（`src/utils/soumaExporter.ts:19`，已存在，复用）
- `begincast` → `StartsUsing`；`cast` → `Ability`
- HEX 是 `actionId.toString(16).toUpperCase()`（**不加** `0x` 前缀）
- `window` 和数字之间有空格，两个数字之间 `,` 无空格
- `syncOnce === true` 时追加 ` once`（前有一个空格），否则**不加任何尾缀**（不要留尾部空格）

示例：

```
00:24.3 "空间斩" StartsUsing { id: "A3DA" } window 10,10
08:36.5 "空间灭斩" StartsUsing { id: "A3F1" } window 20,20 once
```

### 2. `factory` 的契约

`3rdparty/ff14-overlay-vue/src/resources/timelineSpecialRules.ts:134-144`：

```ts
export function factory(events: FFlogsStance): FFlogsStance {
  for (const event of events) {
    const w = windowAction.get(event.actionId)
    if (w?.type === event.type) {
      event.window = w?.window
      event.syncOnce = Boolean(w?.syncOnce)
      event.battleOnce = Boolean(w?.battleOnce)
    }
  }
  return events
}
```

- **只读** `event.actionId` 和 `event.type`
- **只写** `event.window` / `event.syncOnce` / `event.battleOnce`
- `FFlogsStance` 类型还有 `url`/`sourceIsFriendly`/`sourceID`/`actionName`/`time` 等字段，但 `factory` 完全不碰。因此我们构造的"候选数组"只需要填 `actionId` 和 `type` 即可，其它字段随意，用 `as unknown as FFlogsStance` 一次性穿透类型。

### 3. `battleOnce` 的语义

- 规则表的 `battleOnce: true` 表示"该 action 全场只触发一次"
- Souma 原生在导入期对同 `actionId` 的后续事件做去重（把后续同 id 从 sync 降级为纯注释行）
- 我们的 `parseSyncEvents` 也在导入期消解：**保留首条同 id 事件，后续同 id 事件直接丢弃（连注释行都不输出）**
- `battleOnce` 字段**不写入** `SyncEvent`，它只是导入期的 preprocessor flag

### 4. `syncOnce` 的语义

- 规则表的 `syncOnce: true` 控制 sync 行尾的 `once` 关键字输出
- cactbot 运行时看到 `once` 表示该 sync 行匹配一次后就不再监听
- **写入** `SyncEvent.syncOnce`，每条 sync 行独立可编辑

### 5. `FFLogsEvent.type` 的字符串值

- Healerbook 代码库从未出现 `'begincast'` 字符串（之前只消费 `'cast'`），但 V2 Worker `fflogsClientV2.ts:459-460` 已经拉了 `dataType: 'Casts'` + `hostilityType: 'Enemies'`，所以 events 流里 **已经包含 boss 的 begincast + cast 事件**，无需改 Worker GraphQL
- 字符串值与 Souma 的 `FFlogsType = "begincast" | "cast"` 字节级一致，无需映射层

### 6. 排序规则（**这点容易误读**）

现有 `buildSoumaTimelineText`：

```ts
entries.sort((a, b) => a.time - b.time || a.order - b.order)
```

**第一优先级是 time 升序**，`order` 只在同一 `time` 内作 tie-breaker。也就是说 sync 行**按时间散落穿插**在技能行和注释行之间，不是集中输出到文件末尾。`order=2` 只决定"同秒撞车时，sync 排在注释(0)和技能(1)之后"。

---

## Task 1: 类型定义 + Worker schema + 漂移保护测试

**Files:**

- Modify: `src/types/timeline.ts`
- Modify: `src/workers/timelineSchema.ts`
- Modify: `src/workers/timelineSchema.test.ts`

类型添加会让 `timelineSchema.test.ts` 的 `FULL_TIMELINE` 类型检查失败（因为它用了 `Required<Omit<...>> & Pick<...>` 模式强制列出所有字段），所以三处改动**必须一次提交**。

- [ ] **Step 1.1: 在 `src/types/timeline.ts` 添加 `SyncEvent` 接口和 `syncEvents?` 字段**

在文件末尾现有 interface 之后追加：

```ts
/**
 * Souma 时间轴 sync 锚点
 *
 * 来自 FFLogs 导入期对 ff14-overlay-vue 规则表（timelineSpecialRules.ts）的命中结果。
 * 导入时 battleOnce 去重已消解，这里存的都是"会渲染到 sync 行的"独立事件。
 * 导出时由 buildSoumaTimelineText 渲染为 cactbot netregex 风格的 sync 行。
 */
export interface SyncEvent {
  /** 相对战斗起点的秒，与 CastEvent.timestamp 口径一致，可为负 */
  time: number
  /** 'begincast' → StartsUsing；'cast' → Ability */
  type: 'begincast' | 'cast'
  /** FFXIV action id（十进制存储，导出时转十六进制） */
  actionId: number
  /** 中文名优先，回退 abilityMap 英文名，最后 fallback unknown_<hex> */
  actionName: string
  /** 来自规则表，[before, after] 秒 */
  window: [number, number]
  /** 来自规则表，控制输出行是否带 `once` 关键字 */
  syncOnce: boolean
}
```

并修改 `Timeline` interface，在 `gameZoneId` 字段之后追加 `syncEvents` 字段：

```ts
  /** FFXIV 游戏内 ZoneID，用于 Souma 时间轴导出时的自动副本识别。
   *  FFLogs 导入时从 ReportFight.gameZone.id 取值；本地新建时从 raidEncounters.ts 静态表查表写入。
   *  存量时间轴可能无此字段，导出时将回退至静态表或 "0"。 */
  gameZoneId?: number
  /** Souma 导出用的 boss 关键技能 sync 锚点。
   *  FFLogs 导入时由 parseSyncEvents 生成，本地新建时间轴为 undefined。
   *  存量时间轴可能无此字段，导出时不产出 sync 行即可。 */
  syncEvents?: SyncEvent[]
```

- [ ] **Step 1.2: 更新 `src/workers/timelineSchema.ts` 添加 `SyncEventSchema` 并扩展 `TimelineSchema`**

在 `AnnotationSchema` 定义之后、`TimelineSchema` 之前，追加：

```ts
const SyncEventSchema = v.object({
  time: v.number(),
  type: v.picklist(['begincast', 'cast']),
  actionId: v.number(),
  actionName: v.string(),
  window: v.tuple([v.number(), v.number()]),
  syncOnce: v.boolean(),
})
```

然后在 `TimelineSchema` 里，`annotations` 行之后追加 `syncEvents`：

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
  syncEvents: v.optional(v.array(SyncEventSchema)),
  isReplayMode: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
```

- [ ] **Step 1.3: 更新 `src/workers/timelineSchema.test.ts` 的 `FULL_TIMELINE` fixture**

当前文件 34-59 行的 `FULL_TIMELINE` 类型定义中，把 `syncEvents` 加入 optional 字段列表（`Omit` 的 `|` 链和 `Pick` 的 `|` 链都要加）：

```ts
const FULL_TIMELINE: Required<
  Omit<
    Timeline,
    | 'description'
    | 'fflogsSource'
    | 'isReplayMode'
    | 'statData'
    | 'gameZoneId'
    | 'syncEvents'
    | 'isShared'
    | 'everPublished'
    | 'hasLocalChanges'
    | 'serverVersion'
  >
> &
  Pick<
    Timeline,
    | 'description'
    | 'fflogsSource'
    | 'isReplayMode'
    | 'statData'
    | 'gameZoneId'
    | 'syncEvents'
    | 'isShared'
    | 'everPublished'
    | 'hasLocalChanges'
    | 'serverVersion'
  > = {
```

在 fixture 对象里（大约 65 行附近 `gameZoneId: 1321,` 之后），追加一条 `syncEvents`：

```ts
  gameZoneId: 1321,
  syncEvents: [
    {
      time: 24.3,
      type: 'begincast',
      actionId: 0xa3da,
      actionName: '空间斩',
      window: [10, 10],
      syncOnce: false,
    },
  ],
```

在 `describe('timelineSchema 漂移保护', ...)` 块末尾，追加一条 `syncEvents` 的 roundtrip 测试（仿照既有 `gameZoneId` 测试，位于第 104-108 行）：

```ts
it('syncEvents 在 roundtrip 后等值保留', () => {
  const result = validateCreateRequest({ timeline: FULL_TIMELINE })
  if (!result.success) throw new Error('schema rejected full fixture')
  const output = result.output.timeline as { syncEvents?: Array<Record<string, unknown>> }
  expect(output.syncEvents).toHaveLength(1)
  expect(output.syncEvents?.[0]).toEqual({
    time: 24.3,
    type: 'begincast',
    actionId: 0xa3da,
    actionName: '空间斩',
    window: [10, 10],
    syncOnce: false,
  })
})
```

- [ ] **Step 1.4: 运行测试和类型检查**

```bash
pnpm exec tsc --noEmit
pnpm test:run src/workers/timelineSchema.test.ts
```

预期：类型检查通过，三条测试全部绿色（包括既有的两条 + 新加的一条）。

- [ ] **Step 1.5: 提交**

```bash
git add src/types/timeline.ts src/workers/timelineSchema.ts src/workers/timelineSchema.test.ts
git commit -m "feat(types): Timeline 新增 syncEvents 字段 + Worker schema 与漂移测试"
```

---

## Task 2: 实现 `parseSyncEvents`（测试先行）

**Files:**

- Modify: `src/utils/fflogsImporter.ts`
- Modify: `src/utils/fflogsImporter.test.ts`

`parseSyncEvents` 独立函数、独立遍历 events。依赖 submodule 的 `factory`（已导出）和 `@ff14-overlay/types/fflogs` 里的 `FFlogsStance` 类型。

本任务采用 TDD：先写全部失败测试，再实现函数，再逐条跑通。

- [ ] **Step 2.1: 在 `src/utils/fflogsImporter.test.ts` 末尾追加 `parseSyncEvents` 测试块**

文件顶部 import 行改成：

```ts
import { parseCastEvents, parseDamageEvents, parseSyncEvents } from './fflogsImporter'
```

在文件末尾追加：

```ts
describe('parseSyncEvents', () => {
  const fightStartTime = 1000000
  const mockPlayerMap = new Map<number, V2Actor>([
    [1, { id: 1, name: 'Tank', type: 'Paladin' }],
    [2, { id: 2, name: 'Healer', type: 'WhiteMage' }],
  ])

  // 0xA3DA 空间斩 = begincast, window [10,10]，无 battleOnce，无 syncOnce
  // 0xA749 风尘光狼斩 = begincast, window [60,60]，syncOnce + battleOnce
  // 0xA3F1 空间灭斩 = begincast, window [20,20]，syncOnce=true
  const BOSS_SOURCE_ID = 100

  it('boss 的 begincast 命中规则表时产出 SyncEvent', () => {
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0xa3da,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 24300,
      },
    ]
    const result = parseSyncEvents(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      time: 24.3,
      type: 'begincast',
      actionId: 0xa3da,
      actionName: expect.any(String),
      window: [10, 10],
      syncOnce: false,
    })
  })

  it('boss 的 cast 事件若规则表只配置了 begincast 则不命中', () => {
    // 0xA3DA 在规则表里只有 begincast 一条记录
    const events = [
      {
        type: 'cast',
        abilityGameID: 0xa3da,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 5000,
      },
    ]
    expect(parseSyncEvents(events, fightStartTime, mockPlayerMap)).toHaveLength(0)
  })

  it('未命中规则表的 boss 事件被丢弃', () => {
    const events = [
      {
        type: 'cast',
        abilityGameID: 0xdeadbeef,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 5000,
      },
    ]
    expect(parseSyncEvents(events, fightStartTime, mockPlayerMap)).toHaveLength(0)
  })

  it('友方（sourceID 在 playerMap）事件被过滤', () => {
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0xa3da,
        sourceID: 1, // 在 mockPlayerMap 里
        timestamp: fightStartTime + 24300,
      },
    ]
    expect(parseSyncEvents(events, fightStartTime, mockPlayerMap)).toHaveLength(0)
  })

  it('缺 abilityGameID 的事件被过滤', () => {
    const events = [
      { type: 'begincast', sourceID: BOSS_SOURCE_ID, timestamp: fightStartTime + 5000 },
    ]
    expect(parseSyncEvents(events, fightStartTime, mockPlayerMap)).toHaveLength(0)
  })

  it('cast/begincast 之外的事件被过滤', () => {
    const events = [
      {
        type: 'damage',
        abilityGameID: 0xa3da,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 5000,
      },
    ]
    expect(parseSyncEvents(events, fightStartTime, mockPlayerMap)).toHaveLength(0)
  })

  it('battleOnce 规则首条保留后续同 id 丢弃', () => {
    // 0xA749 风尘光狼斩：begincast + battleOnce + syncOnce
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0xa749,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 60000,
      },
      {
        type: 'begincast',
        abilityGameID: 0xa749,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 180000,
      },
      {
        type: 'begincast',
        abilityGameID: 0xa749,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 300000,
      },
    ]
    const result = parseSyncEvents(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(1)
    expect(result[0].time).toBe(60)
    expect(result[0].syncOnce).toBe(true) // 0xA749 的 syncOnce 是 true
  })

  it('非 battleOnce 的规则不对后续同 id 去重', () => {
    // 0xA3DA 空间斩：begincast，既无 battleOnce 也无 syncOnce
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0xa3da,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 10000,
      },
      {
        type: 'begincast',
        abilityGameID: 0xa3da,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 30000,
      },
    ]
    const result = parseSyncEvents(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(2)
    expect(result[0].time).toBe(10)
    expect(result[1].time).toBe(30)
  })

  it('syncOnce=true 的规则写入 SyncEvent.syncOnce', () => {
    // 0xA3F1 空间灭斩：begincast, window [20,20], syncOnce=true
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0xa3f1,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 45000,
      },
    ]
    const result = parseSyncEvents(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(1)
    expect(result[0].syncOnce).toBe(true)
    expect(result[0].window).toEqual([20, 20])
  })

  it('actionName 优先使用中文名（通过 abilityMap fallback 英文名）', () => {
    const abilityMap = new Map<number, FFLogsAbility>([
      [0xa3da, { gameID: 0xa3da, name: 'Spatial Rend', type: 1 }],
    ])
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0xa3da,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 10000,
      },
    ]
    const result = parseSyncEvents(events, fightStartTime, mockPlayerMap, abilityMap)
    // actionChinese 里若存在 0xA3DA 翻译则用中文，否则 fallback 到 "Spatial Rend"
    expect(result[0].actionName).toBeTruthy()
    expect(typeof result[0].actionName).toBe('string')
  })

  it('actionName 在无中文无 abilityMap 时 fallback 为 unknown_<hex>', () => {
    // 使用一个几乎肯定不在 actionChinese 里的 id，但又要命中规则表 —— 用 0x2B87 魔导核爆
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0x2b87,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 60000,
      },
    ]
    const result = parseSyncEvents(events, fightStartTime, mockPlayerMap)
    // 不 assert 确切字符串，但要求有内容（可能是中文或 unknown_2b87）
    expect(result[0].actionName.length).toBeGreaterThan(0)
  })

  it('time < 0（pre-pull 读条）保留不过滤', () => {
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0xa3da,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime - 2300,
      },
    ]
    const result = parseSyncEvents(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(1)
    expect(result[0].time).toBeCloseTo(-2.3, 3)
  })
})
```

- [ ] **Step 2.2: 跑新测试确认全部失败**

```bash
pnpm test:run src/utils/fflogsImporter.test.ts -t parseSyncEvents
```

预期：所有测试 FAIL，原因是 `parseSyncEvents` 未导出。

- [ ] **Step 2.3: 在 `src/utils/fflogsImporter.ts` 实现 `parseSyncEvents`**

在文件顶部 import 块追加（注意这两个 import 来自 submodule 别名）：

```ts
import { factory } from '@ff14-overlay/resources/timelineSpecialRules'
import type { FFlogsStance } from '@ff14-overlay/types/fflogs'
import type { SyncEvent } from '@/types/timeline'
```

在文件末尾追加函数：

```ts
/**
 * 解析 boss 的关键技能 sync 锚点
 *
 * 扫描 events 流里的 boss cast/begincast，通过 ff14-overlay-vue 规则表
 * (timelineSpecialRules.ts) 匹配 window/syncOnce/battleOnce，消解 battleOnce
 * 去重后产出 SyncEvent[]。
 *
 * 设计说明：
 * - 直接调用 submodule 已导出的 factory() 原地打标，不重复维护规则表镜像
 * - factory 只读 actionId/type，只写 window/syncOnce/battleOnce，其它 FFlogsStance
 *   字段我们不必提供 —— 用 `as unknown as FFlogsStance` 穿透类型即可
 * - battleOnce 是 "import 期 preprocessor flag"，不进 SyncEvent 存储层；与 Souma
 *   原生 FflogsImport.vue 的行为一致（它也从不把 battleOnce 写进 timeline 数据）
 * - syncOnce 是 "运行期匹配策略 flag"，每条 SyncEvent 独立存储（Souma 也这样）
 */
export function parseSyncEvents(
  events: FFLogsEvent[],
  fightStartTime: number,
  playerMap: Map<number, { id: number; name: string; type: string }>,
  abilityMap?: Map<number, FFLogsAbility>
): SyncEvent[] {
  // Step 1: 过滤候选 —— boss 的 cast/begincast，有 abilityGameID
  type Candidate = {
    actionId: number
    type: 'begincast' | 'cast'
    time: number
    actionName: string
    window?: [number, number]
    syncOnce: boolean
    battleOnce: boolean
  }

  const candidates: Candidate[] = []
  for (const event of events) {
    if (event.type !== 'cast' && event.type !== 'begincast') continue
    const actionId = event.abilityGameID
    if (!actionId) continue
    // 友方（包含召唤物/宠物）事件排除；非友方即 boss/NPC，命中规则表的才会保留
    if (event.sourceID != null && playerMap.has(event.sourceID)) continue

    const chineseName = getActionChinese(actionId)
    const abilityName = abilityMap?.get(actionId)?.name
    const actionName = chineseName ?? abilityName ?? `unknown_${actionId.toString(16)}`

    candidates.push({
      actionId,
      type: event.type as 'cast' | 'begincast',
      time: (event.timestamp - fightStartTime) / 1000,
      actionName,
      window: undefined,
      syncOnce: false,
      battleOnce: false,
    })
  }

  // Step 2: 让 factory 原地给命中规则的候选打标
  // factory 只访问 actionId/type 并写 window/syncOnce/battleOnce，其它 FFlogsStance
  // 字段都不碰 —— 用 as unknown as FFlogsStance 是安全的，有意为之
  factory(candidates as unknown as FFlogsStance)

  // Step 3: 过滤未命中 + battleOnce 去重
  const battleOnceSeen = new Set<number>()
  const syncEvents: SyncEvent[] = []
  for (const c of candidates) {
    if (!c.window) continue // 未命中规则
    if (c.battleOnce) {
      if (battleOnceSeen.has(c.actionId)) continue
      battleOnceSeen.add(c.actionId)
    }
    syncEvents.push({
      time: c.time,
      type: c.type,
      actionId: c.actionId,
      actionName: c.actionName,
      window: c.window,
      syncOnce: c.syncOnce,
    })
  }
  return syncEvents
}
```

- [ ] **Step 2.4: 跑测试确认全部通过**

```bash
pnpm test:run src/utils/fflogsImporter.test.ts -t parseSyncEvents
```

预期：12 条测试全部 PASS。

- [ ] **Step 2.5: 跑类型检查**

```bash
pnpm exec tsc --noEmit
```

预期：无错误。特别是 `as unknown as FFlogsStance` 不应产生警告（这是有意的类型穿透）。

- [ ] **Step 2.6: 提交**

```bash
git add src/utils/fflogsImporter.ts src/utils/fflogsImporter.test.ts
git commit -m "feat(fflogs): 新增 parseSyncEvents 解析 boss 关键技能 sync 锚点"
```

---

## Task 3: 在 `ImportFFLogsDialog` 接入 `parseSyncEvents`

**Files:**

- Modify: `src/components/ImportFFLogsDialog.tsx`

这是一步纯接线：在导入流程里紧跟 `parseCastEvents` 之后调用 `parseSyncEvents`，把结果写入 `newTimeline.syncEvents`。

- [ ] **Step 3.1: 顶部 import 行追加 `parseSyncEvents`**

找到现有 `parseCastEvents` / `parseDamageEvents` 的 import 行，改为：

```ts
import {
  parseDamageEvents,
  parseCastEvents,
  parseSyncEvents,
  parseComposition,
  findFirstDamageTimestamp,
  convertV1ToReport,
} from '@/utils/fflogsImporter'
```

（保留原有顺序，只在合适位置插入 `parseSyncEvents`）

- [ ] **Step 3.2: 在 `parseCastEvents` 调用之后写入 `syncEvents`**

在 `src/components/ImportFFLogsDialog.tsx:231`（`const castEvents = parseCastEvents(...)` 这一行）之后、`newTimeline.castEvents = castEvents` 之前，插入：

```ts
// 解析 sync 事件（boss 关键技能锚点，用于 Souma 导出）
newTimeline.syncEvents = parseSyncEvents(
  eventsData.events || [],
  fightStartTime,
  playerMap,
  abilityMap
)
```

- [ ] **Step 3.3: 跑类型检查**

```bash
pnpm exec tsc --noEmit
```

预期：无错误。注意 `playerMap` 在这里类型是 `Map<number, { id, name, type }>`，`parseSyncEvents` 签名应接受该类型（Task 2 里定义的签名已经匹配）。

- [ ] **Step 3.4: 跑全量测试确认没有回归**

```bash
pnpm test:run
```

预期：全部通过。

- [ ] **Step 3.5: 提交**

```bash
git add src/components/ImportFFLogsDialog.tsx
git commit -m "feat(fflogs): 导入流程写入 syncEvents 到 timeline"
```

---

## Task 4: `buildSoumaTimelineText` 输出 sync 行（测试先行）

**Files:**

- Modify: `src/utils/soumaExporter.ts`
- Modify: `src/utils/soumaExporter.test.ts`

在现有注释 (`order=0`) 和技能 (`order=1`) 的条目生成之间（或之后）新增 sync 行条目生成 (`order=2`)，共享既有的 `entries.sort` 逻辑。

- [ ] **Step 4.1: 在 `soumaExporter.test.ts` 的 `describe('buildSoumaTimelineText', ...)` 块末尾追加 sync 行测试**

在现有 `'skillTrack 多行注释每行都带 icon 前缀'` 测试之后、`describe` 块的 `})` 之前，追加：

```ts
it('syncEvents 输出 cactbot 风格 sync 行', () => {
  const timeline = makeTimeline({
    syncEvents: [
      {
        time: 24.3,
        type: 'begincast',
        actionId: 0xa3da,
        actionName: '空间斩',
        window: [10, 10],
        syncOnce: false,
      },
    ],
  })
  const text = buildSoumaTimelineText(timeline, 1, [], false)
  expect(text).toBe('00:24.3 "空间斩" StartsUsing { id: "A3DA" } window 10,10')
})

it('cast 类型 sync 行使用 Ability', () => {
  const timeline = makeTimeline({
    syncEvents: [
      {
        time: 10,
        type: 'cast',
        actionId: 0xa770,
        actionName: '在这停顿！',
        window: [30, 30],
        syncOnce: false,
      },
    ],
  })
  const text = buildSoumaTimelineText(timeline, 1, [], false)
  expect(text).toBe('00:10.0 "在这停顿！" Ability { id: "A770" } window 30,30')
})

it('syncOnce=true 追加 once 关键字', () => {
  const timeline = makeTimeline({
    syncEvents: [
      {
        time: 45,
        type: 'begincast',
        actionId: 0xa3f1,
        actionName: '空间灭斩',
        window: [20, 20],
        syncOnce: true,
      },
    ],
  })
  const text = buildSoumaTimelineText(timeline, 1, [], false)
  expect(text).toBe('00:45.0 "空间灭斩" StartsUsing { id: "A3F1" } window 20,20 once')
})

it('sync 行与技能行按时间穿插排序', () => {
  const timeline = makeTimeline({
    castEvents: [
      makeCast({ actionId: 16536, timestamp: 15 }),
      makeCast({ actionId: 7433, timestamp: 35 }),
    ],
    syncEvents: [
      {
        time: 10,
        type: 'begincast',
        actionId: 0xa3da,
        actionName: '空间斩',
        window: [10, 10],
        syncOnce: false,
      },
      {
        time: 25,
        type: 'cast',
        actionId: 0xa770,
        actionName: '在这停顿',
        window: [30, 30],
        syncOnce: false,
      },
    ],
  })
  const lines = buildSoumaTimelineText(timeline, 1, [16536, 7433], false).split('\n')
  expect(lines).toHaveLength(4)
  expect(lines[0]).toContain('00:10.0') // sync
  expect(lines[0]).toContain('StartsUsing')
  expect(lines[1]).toMatch(/^00:15\.0 "<.+>~"$/) // 技能
  expect(lines[2]).toContain('00:25.0') // sync
  expect(lines[2]).toContain('Ability')
  expect(lines[3]).toMatch(/^00:35\.0 "<.+>~"$/) // 技能
})

it('同秒撞车时 sync 排在注释和技能之后', () => {
  const timeline = makeTimeline({
    castEvents: [makeCast({ actionId: 16536, timestamp: 20 })],
    annotations: [{ id: 'a1', text: '提示', time: 20, anchor: { type: 'damageTrack' } }],
    syncEvents: [
      {
        time: 20,
        type: 'begincast',
        actionId: 0xa3da,
        actionName: '空间斩',
        window: [10, 10],
        syncOnce: false,
      },
    ],
  })
  const lines = buildSoumaTimelineText(timeline, 1, [16536], false).split('\n')
  expect(lines[0]).toBe('# 00:20.0 提示')
  expect(lines[1]).toMatch(/^00:20\.0 "<.+>~"$/)
  expect(lines[2]).toContain('StartsUsing')
})

it('syncEvents 为空时不产出任何 sync 行', () => {
  const timeline = makeTimeline({
    castEvents: [makeCast({ actionId: 16536, timestamp: 10 })],
    syncEvents: [],
  })
  const text = buildSoumaTimelineText(timeline, 1, [16536], false)
  expect(text.split('\n')).toHaveLength(1)
  expect(text).not.toContain('StartsUsing')
  expect(text).not.toContain('Ability')
})

it('syncEvents 未定义（存量 timeline）时不产出任何 sync 行', () => {
  const timeline = makeTimeline({
    castEvents: [makeCast({ actionId: 16536, timestamp: 10 })],
    // syncEvents 故意不设置
  })
  const text = buildSoumaTimelineText(timeline, 1, [16536], false)
  expect(text.split('\n')).toHaveLength(1)
})

it('负时间 sync 行用 formatSoumaTime 的 -X.X 格式', () => {
  const timeline = makeTimeline({
    syncEvents: [
      {
        time: -2.3,
        type: 'begincast',
        actionId: 0xa3da,
        actionName: '空间斩',
        window: [10, 10],
        syncOnce: false,
      },
    ],
  })
  const text = buildSoumaTimelineText(timeline, 1, [], false)
  expect(text).toBe('-2.3 "空间斩" StartsUsing { id: "A3DA" } window 10,10')
})
```

**注意**：测试会用到 `syncEvents` 字段，`makeTimeline` 通过 `...overrides` 透传 partial Timeline，无需改 helper。

- [ ] **Step 4.2: 跑新测试确认全部失败**

```bash
pnpm test:run src/utils/soumaExporter.test.ts
```

预期：8 条新测试 FAIL（现有测试继续 PASS）。

- [ ] **Step 4.3: 在 `src/utils/soumaExporter.ts` 的 `buildSoumaTimelineText` 里追加 sync 行生成**

定位到 `buildSoumaTimelineText` 函数内部第 76 行附近（`// 技能` 注释下方的 for 循环结束之后），在 `if (entries.length === 0) return ''` 之前追加：

```ts
// sync 事件（boss 关键技能锚点）
for (const sync of timeline.syncEvents ?? []) {
  const time = formatSoumaTime(sync.time)
  const regexType = sync.type === 'begincast' ? 'StartsUsing' : 'Ability'
  const hex = sync.actionId.toString(16).toUpperCase()
  const once = sync.syncOnce ? ' once' : ''
  entries.push({
    time: sync.time,
    order: 2,
    text: `${time} "${sync.actionName}" ${regexType} { id: "${hex}" } window ${sync.window[0]},${sync.window[1]}${once}`,
  })
}
```

- [ ] **Step 4.4: 跑测试确认全部通过**

```bash
pnpm test:run src/utils/soumaExporter.test.ts
```

预期：所有 soumaExporter 测试（既有 + 新增共 ~30 条）全部 PASS。

- [ ] **Step 4.5: 跑类型检查和全量测试**

```bash
pnpm exec tsc --noEmit && pnpm test:run
```

预期：全部通过。

- [ ] **Step 4.6: 提交**

```bash
git add src/utils/soumaExporter.ts src/utils/soumaExporter.test.ts
git commit -m "feat(export): buildSoumaTimelineText 输出 boss sync 锚点行"
```

---

## Task 5: 端到端验证

**Files:** 无改动

走一遍构建和手动回归。

- [ ] **Step 5.1: 跑 lint**

```bash
pnpm lint
```

预期：无错误。

- [ ] **Step 5.2: 跑全量测试**

```bash
pnpm test:run
```

预期：全部通过。

- [ ] **Step 5.3: 跑构建**

```bash
pnpm build
```

预期：构建成功。注意 `@ff14-overlay/resources/timelineSpecialRules` 在产物里会被 Vite 打包，确认 bundle 中包含 `windowAction.set` 相关代码（不是被 tree-shake 掉 —— 因为我们引用的是 `factory` 函数，`factory` 闭包里引用了 `windowAction`，不会被摇掉）。

- [ ] **Step 5.4: 手动冒烟测试（浏览器）**

前提：用户已在运行 `pnpm dev`。

1. 打开浏览器至 `http://localhost:5173`（或现有端口）
2. 从 FFLogs 导入一场包含 boss 关键技能的战斗（例如 M8S / FRU，规则表里有条目的副本）
3. 在 DevTools 里 `JSON.parse(localStorage.getItem('healerbook_timelines')!)[0].syncEvents` 确认字段存在且非空
4. 打开 Souma 时间轴导出对话框，选择玩家 + 勾选若干技能，点"复制"
5. `atob` + LZString 解压复制的字符串，JSON parse 后查 `[0].timeline` 字段，确认包含 `StartsUsing { id: "XXXX" }` / `Ability { id: "XXXX" }` 格式的 sync 行
6. 将复制的字符串粘贴到 ff14-overlay-vue 时间轴导入对话框，确认导入后时间轴中的 sync 行存在且可触发运行时匹配（可选：开启 demo 数据验证运行时行为）

**如果无法打开浏览器**：跳过 Step 5.4 并明确在任务总结里声明 "UI 未手动验证"（按 CLAUDE.md 规则）。

- [ ] **Step 5.5: 总结提交（可选）**

如果全部通过，本任务只改了之前 commit 的内容，不需要新 commit。如果有补漏则：

```bash
git add -u
git commit -m "chore: 补充 syncEvents 实施总结"
```

---

## 回滚策略

如果任一任务出问题，回滚方式按 git commit 粒度倒推：

- Task 4 出问题：`git reset --hard HEAD~1` 丢弃 Task 4 commit，类型和解析层保留
- Task 3 出问题：同上，保留 Task 1、2 commit
- Task 2 出问题：同上
- Task 1 出问题：会级联导致其它任务测试失败，建议先跳过 Task 1 的 schema 改动、只加类型，重跑看哪一步破

字段 `syncEvents?` 是 optional，任何中间状态都能正常序列化/反序列化，存量 timeline 也不会因此失败。

---

## 自检（writing-plans skill 要求）

**Spec 覆盖**：

- ✅ `syncEvents` 持久化字段 → Task 1（类型 + schema + 漂移测试）
- ✅ `parseSyncEvents` 函数 → Task 2
- ✅ 规则表命中（方案 ε，直接用 factory）→ Task 2 Step 2.3
- ✅ `battleOnce` 在导入期消解不存储 → Task 2 Step 2.3 Step 3 + Task 2.1 相关测试
- ✅ `syncOnce` 存储每条 SyncEvent → Task 2 字段定义 + 测试
- ✅ 导出时 sync 行插入 → Task 4
- ✅ sync 行按时间穿插 order=2 tie-breaker → Task 4 相关测试
- ✅ `mm:ss.d` 时间格式（复用 formatSoumaTime）→ Task 4 Step 4.3
- ✅ 负时间保留不过滤 → Task 2 + Task 4 相关测试
- ✅ 集成到 ImportFFLogsDialog → Task 3

**Placeholder 扫描**：所有步骤都有具体代码、具体文件路径、具体命令和预期输出。无 TBD / "类似 Task N" 占位。

**类型一致性**：`SyncEvent` 字段在 Task 1 / Task 2 / Task 4 的引用完全一致（`time: number`, `type: 'begincast' | 'cast'`, `actionId: number`, `actionName: string`, `window: [number, number]`, `syncOnce: boolean`）。`parseSyncEvents` 签名在 Task 2（定义）和 Task 3（调用）参数顺序一致：`(events, fightStartTime, playerMap, abilityMap?)`。
