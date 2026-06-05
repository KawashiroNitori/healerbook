# 目标减开关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为单个伤害事件新增「目标减是否生效」开关（默认生效），关闭时计算跳过 boss 减伤（雪仇/牵制/武装解除/昏乱）并隐藏其 icon，且 FFLogs 导入时按伤害来源是否为 boss 自动判定初值。

**Architecture:** 用 `MitigationCategory` 新枚举 `'boss'` 在状态层标识目标减（数据落在 `statusExtras.ts`）；`DamageEvent.targetMitigationDisabled?: boolean` 承载事件级开关；计算器在 `runSingleBranch` Phase 1 据此跳过 boss 状态；导入期用 `buildBossIds` + 来源判定写初值；V2/剪贴板持久化新字段；PropertyPanel 加 Switch。

**Tech Stack:** TypeScript、Vitest、Zustand、React、shadcn/ui。

参考 spec：`design/superpowers/specs/2026-06-05-target-mitigation-toggle-design.md`

---

## 设计单元（文件职责）

- `src/types/mitigation.ts` — `MitigationCategory` 增加 `'boss'`。
- `src/types/timeline.ts` — `DamageEvent.targetMitigationDisabled` 字段。
- `src/data/statusExtras.ts` — 给状态 1193/1195/860/1203 补 `'boss'` category（**计算识别来源**）。
- `src/data/mitigationActions.ts` — 可选给 4 个 action category 对齐 `'boss'`。
- `src/utils/mitigationCalculator.ts` — `runSingleBranch` Phase 1 跳过逻辑。
- `src/utils/fflogsImporter.ts` — `buildBossIds` + `parseDamageEvents` 接 `bossIds`。
- `src/components/ImportFFLogsDialog.tsx` — 调用方接线。
- `src/types/timelineV2.ts` + `src/utils/timelineFormat.ts` + `src/utils/timelineClipboard.ts` — 持久化 `tmd`。
- `src/components/PropertyPanel.tsx` — Switch UI。

---

### Task 1: 数据模型与状态标注

**Files:**

- Modify: `src/types/mitigation.ts:27`
- Modify: `src/types/timeline.ts`（`DamageEvent` 接口）
- Modify: `src/data/statusExtras.ts`（新增 4 条 entry）
- Modify: `src/data/mitigationActions.ts`（可选，4 个 action category）

- [ ] **Step 1: `MitigationCategory` 增加 `'boss'`**

`src/types/mitigation.ts`，把 union 末尾加 `'boss'`，并补注释：

```ts
/**
 * 减伤类别（UI 过滤用）
 * - boss: 降低 boss 输出的 debuff（目标减，如雪仇/牵制/武装解除/昏乱）；
 *         与 'target'（坦克定向）正交
 * ...既有注释...
 */
export type MitigationCategory =
  | 'shield'
  | 'percentage'
  | 'heal'
  | 'partywide'
  | 'self'
  | 'target'
  | 'boss'
```

- [ ] **Step 2: `DamageEvent` 增加字段**

`src/types/timeline.ts` 的 `DamageEvent` 接口末尾加：

```ts
  /**
   * 目标减是否对本事件无效。省略/false = 目标减正常生效（默认）；
   * true = 本事件无视目标减，计算时跳过所有 category 含 'boss' 的状态。
   * 仅在关闭时存 true，存量事件无此字段。
   */
  targetMitigationDisabled?: boolean
```

- [ ] **Step 3: `statusExtras.ts` 新增 4 条 boss 状态 entry**

`src/data/statusExtras.ts`，在 extras 表里加入（放在文件内现有 entry 区域，紧邻同类即可）：

```ts
  1193: { category: ['partywide', 'percentage', 'boss'] }, // 雪仇（目标减）
  1195: { category: ['partywide', 'percentage', 'boss'] }, // 牵制（目标减）
  860: { category: ['partywide', 'percentage', 'boss'] }, // 武装解除（目标减）
  1203: { category: ['partywide', 'percentage', 'boss'] }, // 昏乱（目标减）
```

> 这 4 个状态原无 entry（category 为 undefined）。新增 `partywide` 不改既有坦克过滤
> （undefined 与 partywide 都默认放行），关键是 `'boss'` 供计算识别。

- [ ] **Step 4（可选）: action category 对齐**

`src/data/mitigationActions.ts`，给雪仇(7535)/牵制(7549)/武装解除(2887)/昏乱(7560) 的
`category: ['partywide', 'percentage']` 改为 `['partywide', 'percentage', 'boss']`。仅为分类一致性，计算不依赖。

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 通过，无错误（新增 union 成员与可选字段不破坏既有代码）。

- [ ] **Step 6: Commit**

```bash
git add src/types/mitigation.ts src/types/timeline.ts src/data/statusExtras.ts src/data/mitigationActions.ts
git commit -m "feat(calc): add 'boss' category and DamageEvent.targetMitigationDisabled"
```

---

### Task 2: 计算引擎跳过目标减

**Files:**

- Test: `src/utils/mitigationCalculator.test.ts`
- Modify: `src/utils/mitigationCalculator.ts`（`runSingleBranch` Phase 1，约 `:1034-1048`）

- [ ] **Step 1: 写失败测试**

在 `src/utils/mitigationCalculator.test.ts` 的 `describe('MitigationCalculator', ...)` 内新增：

```ts
describe('目标减开关 (targetMitigationDisabled)', () => {
  it('关闭目标减时跳过 boss 状态（雪仇 1193），不计入 appliedStatuses 且伤害更高', () => {
    const partyState: PartyState = {
      ...basePartyState,
      players: [{ id: 1, job: 'WHM', maxHP: 100000 }],
      statuses: [
        { instanceId: 'reprisal', statusId: 1193, startTime: 0, endTime: 15, sourcePlayerId: 2 },
      ],
    }
    const on = calculator.calculate(makeEvent(100000, 10, 'magical', 'aoe'), partyState)
    const off = calculator.calculate(
      { ...makeEvent(100000, 10, 'magical', 'aoe'), targetMitigationDisabled: true },
      partyState
    )
    expect(on.appliedStatuses.some(s => s.statusId === 1193)).toBe(true)
    expect(off.appliedStatuses.some(s => s.statusId === 1193)).toBe(false)
    expect(off.finalDamage).toBeGreaterThan(on.finalDamage)
  })

  it('开关只抑制 boss 状态，不影响其它 partywide 百分比减伤（节制 1873）', () => {
    const partyState: PartyState = {
      ...basePartyState,
      players: [{ id: 1, job: 'WHM', maxHP: 100000 }],
      statuses: [
        { instanceId: 'reprisal', statusId: 1193, startTime: 0, endTime: 15, sourcePlayerId: 2 },
        {
          instanceId: 'temperance',
          statusId: 1873,
          startTime: 0,
          endTime: 25,
          sourceActionId: 16536,
          sourcePlayerId: 2,
        },
      ],
    }
    const off = calculator.calculate(
      { ...makeEvent(100000, 10, 'magical', 'aoe'), targetMitigationDisabled: true },
      partyState
    )
    expect(off.appliedStatuses.some(s => s.statusId === 1873)).toBe(true)
    expect(off.appliedStatuses.some(s => s.statusId === 1193)).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run mitigationCalculator -t "目标减开关"`
Expected: FAIL —— 关闭时 1193 仍出现在 appliedStatuses（跳过逻辑未实现）。

- [ ] **Step 3: 实现跳过逻辑**

`src/utils/mitigationCalculator.ts`，`runSingleBranch` 的 Phase 1 循环（`if (!multiplierFilter(...)) continue` 之后、`if (meta.type === 'multiplier')` 之前）插入：

```ts
// 目标减开关：本事件关闭目标减时，跳过所有 boss debuff（不乘、不计入 appliedStatuses）
if (event.targetMitigationDisabled && meta.category?.includes('boss')) continue
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run mitigationCalculator -t "目标减开关"`
Expected: PASS（两条用例）。

- [ ] **Step 5: 跑全量计算器测试防回归**

Run: `pnpm test:run mitigationCalculator`
Expected: PASS（既有用例不受影响）。

- [ ] **Step 6: Commit**

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "feat(calc): skip boss mitigations when targetMitigationDisabled"
```

---

### Task 3: FFLogs 导入期自动判定

**Files:**

- Test: `src/utils/fflogsImporter.test.ts`
- Modify: `src/utils/fflogsImporter.ts`（新增 `buildBossIds`，`parseDamageEvents` 加参数与置位）
- Modify: `src/components/ImportFFLogsDialog.tsx:278`（接线）

- [ ] **Step 1: 写失败测试**

`src/utils/fflogsImporter.test.ts` 顶部 import 处加入 `buildBossIds`：

```ts
import {
  parseCastEvents,
  parseDamageEvents,
  parseSyncEvents,
  extractShieldData,
  extractHealData,
  extractMaxHPData,
  parseStatData,
  buildBossIds,
} from './fflogsImporter'
```

文件末尾新增：

```ts
describe('buildBossIds', () => {
  it('type==="Boss" 为主信号', () => {
    const enemies = [
      { id: 100, guid: 1, name: 'Boss A', type: 'Boss' },
      { id: 101, guid: 2, name: 'Add', type: 'NPC' },
    ]
    expect([...buildBossIds(enemies, 'Boss A')]).toEqual([100])
  })

  it('无 Boss 类型时按名匹配 fightName', () => {
    const enemies = [
      { id: 100, guid: 1, name: 'Golbez', type: 'NPC' },
      { id: 101, guid: 2, name: 'Shadow', type: 'NPC' },
    ]
    expect([...buildBossIds(enemies, 'Golbez')]).toEqual([100])
  })

  it('仅一个敌人时回退取它', () => {
    const enemies = [{ id: 100, guid: 1, name: 'X', type: 'NPC' }]
    expect([...buildBossIds(enemies, 'Y')]).toEqual([100])
  })

  it('按名扩展同名实体（分身/转场）', () => {
    const enemies = [
      { id: 100, guid: 1, name: 'Boss A', type: 'Boss' },
      { id: 200, guid: 1, name: 'Boss A', type: 'NPC' },
      { id: 300, guid: 2, name: 'Add', type: 'NPC' },
    ]
    expect([...buildBossIds(enemies, 'Boss A')].sort((a, b) => a - b)).toEqual([100, 200])
  })

  it('空 enemies 返回空集', () => {
    expect(buildBossIds(undefined, 'X').size).toBe(0)
    expect(buildBossIds([], 'X').size).toBe(0)
  })
})

describe('parseDamageEvents 目标减自动判定', () => {
  const fightStartTime = 1000000
  const withCalc = (evs: Record<string, unknown>[]) => [
    ...evs.filter(e => e.type === 'damage').map(e => ({ ...e, type: 'calculateddamage' })),
    ...evs,
  ]
  const playerMap = new Map<number, V2Actor>([[1, { id: 1, name: 'T', type: 'Paladin' }]])
  const abilityMap = new Map<number, FFLogsAbility>([
    [999999, { gameID: 999999, name: 'Atk', type: 1024 }],
  ])
  const events = [
    {
      type: 'damage',
      packetID: 1,
      abilityGameID: 999999,
      targetID: 1,
      unmitigatedAmount: 10000,
      absorbed: 0,
      amount: 10000,
      timestamp: fightStartTime + 5000,
      sourceID: 500, // boss
    },
    {
      type: 'damage',
      packetID: 2,
      abilityGameID: 999999,
      targetID: 1,
      unmitigatedAmount: 8000,
      absorbed: 0,
      amount: 8000,
      timestamp: fightStartTime + 9000,
      sourceID: 700, // 小怪
    },
  ]

  it('非 boss 来源标记 disabled，boss 来源不标记', () => {
    const result = parseDamageEvents(
      withCalc(events),
      fightStartTime,
      playerMap,
      abilityMap,
      undefined,
      new Set([500])
    )
    const fromBoss = result.find(e => Math.abs(e.time - 5) < 0.6)
    const fromAdd = result.find(e => Math.abs(e.time - 9) < 0.6)
    expect(fromBoss?.targetMitigationDisabled).toBeUndefined()
    expect(fromAdd?.targetMitigationDisabled).toBe(true)
  })

  it('未传 bossIds 时全部默认生效（回归）', () => {
    const result = parseDamageEvents(withCalc(events), fightStartTime, playerMap, abilityMap)
    expect(result.every(e => e.targetMitigationDisabled === undefined)).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run fflogsImporter -t "buildBossIds"`
Expected: FAIL —— `buildBossIds` is not a function（未导出/未实现）。

- [ ] **Step 3: 实现 `buildBossIds` 并接入 `parseDamageEvents`**

`src/utils/fflogsImporter.ts`：

1）import 处补类型：

```ts
import type {
  FFLogsReport,
  FFLogsV1Report,
  FFLogsAbility,
  FFLogsEvent,
  FFLogsV1Actor,
} from '@/types/fflogs'
```

2）新增导出函数（放在 `parseComposition` 附近）：

```ts
/**
 * 构建 boss 实体 id 集合（用于目标减自动判定）。逐级 fallback：
 * type==='Boss' → 名称等于战斗名 → 仅一个敌人 → 按名扩展同名实体（分身/转场）。
 * 检测失败返回空集，调用方据此降级为不判定。
 */
export function buildBossIds(enemies: FFLogsV1Actor[] | undefined, fightName: string): Set<number> {
  const ids = new Set<number>()
  if (!enemies?.length) return ids
  for (const e of enemies) if (e.type === 'Boss') ids.add(e.id)
  if (ids.size === 0) for (const e of enemies) if (e.name === fightName) ids.add(e.id)
  if (ids.size === 0 && enemies.length === 1) ids.add(enemies[0].id)
  const bossNames = new Set([...ids].map(id => enemies.find(e => e.id === id)?.name))
  for (const e of enemies) if (bossNames.has(e.name)) ids.add(e.id)
  return ids
}
```

3）`parseDamageEvents` 签名末尾加可选参数：

```ts
export function parseDamageEvents(
  events: FFLogsEvent[],
  fightStartTime: number,
  playerMap: Map<number, { id: number; name: string; type: string }>,
  abilityMap?: Map<number, FFLogsAbility>,
  composition?: Composition,
  bossIds?: Set<number>
): DamageEvent[] {
```

4）在 Step 4 聚合循环 `damageEvents.push({ ... })` 之前计算并展开字段（`firstDetail`、`detailSourceIds` 在作用域内）：

```ts
const sourceId = detailSourceIds.get(firstDetail) ?? 0
const targetMitigationDisabled =
  bossIds && bossIds.size > 0 && sourceId !== 0 && !bossIds.has(sourceId) ? true : undefined
```

并在 push 的对象字面量末尾加：

```ts
      ...(targetMitigationDisabled && { targetMitigationDisabled }),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run fflogsImporter -t "buildBossIds"` 与 `pnpm test:run fflogsImporter -t "目标减自动判定"`
Expected: PASS。

- [ ] **Step 5: 接线 ImportFFLogsDialog**

`src/components/ImportFFLogsDialog.tsx`，import 处加 `buildBossIds`，并在调用 `parseDamageEvents` 前后改为：

```ts
const bossIds = buildBossIds(report.enemies, fight.name)
const damageEvents = parseDamageEvents(
  eventsData.events || [],
  fightStartTime,
  playerMap,
  abilityMap,
  composition,
  bossIds
)
```

- [ ] **Step 6: 类型检查 + 全量导入测试**

Run: `pnpm exec tsc --noEmit && pnpm test:run fflogsImporter`
Expected: 均 PASS（既有用例不受影响）。

- [ ] **Step 7: Commit**

```bash
git add src/utils/fflogsImporter.ts src/utils/fflogsImporter.test.ts src/components/ImportFFLogsDialog.tsx
git commit -m "feat(import): auto-flag targetMitigationDisabled for non-boss sources"
```

---

### Task 4: 持久化（V2 + 剪贴板）

**Files:**

- Test: `src/utils/timelineFormat.test.ts`
- Modify: `src/types/timelineV2.ts`（`V2DamageEvent`）
- Modify: `src/utils/timelineFormat.ts:109` 与 `:259`
- Modify: `src/utils/timelineClipboard.ts:99`

- [ ] **Step 1: 写失败测试**

`src/utils/timelineFormat.test.ts`，在 `describe('toV2 / hydrateFromV2 (editor mode)', ...)` 内新增：

```ts
it('targetMitigationDisabled round-trip', () => {
  const tl = makeEditorTimeline()
  tl.damageEvents[0].targetMitigationDisabled = true
  const restored = hydrateFromV2(toV2(tl))
  expect(restored.damageEvents[0].targetMitigationDisabled).toBe(true)
  // 未设置的事件保持省略（不被写成 false）
  expect(restored.damageEvents[1].targetMitigationDisabled).toBeUndefined()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run timelineFormat -t "targetMitigationDisabled"`
Expected: FAIL —— `restored.damageEvents[0].targetMitigationDisabled` 为 `undefined`（未序列化）。

- [ ] **Step 3: 实现序列化**

1）`src/types/timelineV2.ts` 的 `V2DamageEvent` 接口加：

```ts
  /** 目标减无效（省略=生效） */
  tmd?: boolean
```

2）`src/utils/timelineFormat.ts` `toV2DamageEvent`（约 `:109`），在 `return out` 前加：

```ts
if (e.targetMitigationDisabled) out.tmd = true
```

3）同文件 `fromV2DamageEvent`（约 `:259`），在 `return out` 前加：

```ts
if (e.tmd) out.targetMitigationDisabled = true
```

4）`src/utils/timelineClipboard.ts`（约 `:99`，与 `packetId`/`tempMitigations` 同段），加：

```ts
    ...(e.targetMitigationDisabled !== undefined && {
      targetMitigationDisabled: e.targetMitigationDisabled,
    }),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run timelineFormat -t "targetMitigationDisabled"`
Expected: PASS。

- [ ] **Step 5: 全量格式测试防回归**

Run: `pnpm test:run timelineFormat`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/types/timelineV2.ts src/utils/timelineFormat.ts src/utils/timelineClipboard.ts src/utils/timelineFormat.test.ts
git commit -m "feat(timeline): persist targetMitigationDisabled via V2 tmd and clipboard"
```

---

### Task 5: PropertyPanel 开关 UI

**Files:**

- Modify: `src/components/PropertyPanel.tsx`（DoT 快照 Switch 之后，约 `:617` 后）

- [ ] **Step 1: 新增「目标减生效」Switch 行**

`src/components/PropertyPanel.tsx`，在 DoT 快照设置那个 `<div>`（`:590-617`）之后插入（`Switch`、`updateDamageEvent`、`isReadOnly`、`event` 均已在作用域内）：

```tsx
{
  /* 目标减是否生效 */
}
;<div className="flex items-center gap-2 h-8">
  <Switch
    checked={!event.targetMitigationDisabled}
    onCheckedChange={checked =>
      updateDamageEvent(event.id, {
        targetMitigationDisabled: checked ? undefined : true,
      })
    }
    disabled={isReadOnly}
  />
  <span className="text-xs text-muted-foreground shrink-0">目标减生效</span>
</div>
```

- [ ] **Step 2: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 均通过。

- [ ] **Step 3: 手动验证（开发服已由用户启动）**

在编辑器选中一个伤害事件，确认：开关默认开；关掉后该事件「预估减伤效果」里若原有雪仇/牵制等 boss 状态，icon 消失、`-X%` 下降、最终伤害上升；再打开恢复。view 模式下开关禁用。

- [ ] **Step 4: Commit**

```bash
git add src/components/PropertyPanel.tsx
git commit -m "feat(ui): add target-mitigation toggle switch to PropertyPanel"
```

---

### Task 6: 全量验证

- [ ] **Step 1: 全量测试 + lint + 类型检查**

Run: `pnpm test:run && pnpm lint && pnpm exec tsc --noEmit`
Expected: 全部 PASS。

- [ ] **Step 2: 若 Task 1-5 已分别提交则无需再提交**

如有遗留改动：

```bash
git status
# 若有未提交改动，按所属 Task 归类提交
```

---

### Task 7: 修复导入空转——抓取敌方 actor + 服务端接线（实现期发现）

**背景**：Task 3 接了 `buildBossIds(report.enemies, ...)`，但 `fflogsClientV2.getReport` 的
GraphQL 查询只取 `actors(type: "Player")`，**从不返回 enemies** → `report.enemies` 永远
undefined → 自动判定在生产环境完全空转。且服务端 `/import`（`routes/fflogs.ts`）未接 buildBossIds。

**真实 API 验证**（report `Mk1Jwzx4v9jyYKCR`）：`actors(type:"NPC")` 过滤有效；别名查询合法；
boss 实体为 `type:"NPC"` + `subType:"Boss"`（字面 "Boss"），普通小怪 `subType:"NPC"`。

**Files:**

- Modify: `src/workers/fflogsClientV2.ts`（查询补 `enemyActors: actors(type:"NPC")`；抽出导出纯函数
  `mapV2ReportToV1Report`，映射 `enemies`，actor 用 `subType || type` 派生 type）
- Modify: `src/workers/routes/fflogs.ts`（`/import` 接 `buildBossIds(report.enemies, fight.name)` 并传第 6 参）
- Test: `src/workers/fflogsClientV2.test.ts`（新增：mapper 把 NPC→enemies、boss type 派生为 'Boss'、
  且 buildBossIds 能据此识别 boss/排除小怪）
- Test: `src/workers/fflogsImportHandler.test.ts`（新增：服务端 `/import` 端到端——boss 来源不标记、
  小怪来源标 `tmd`）

**验证**：`pnpm test:run` 973 passed、`pnpm lint`、`pnpm exec tsc --noEmit` 均通过。

## Self-Review（作者自检结论）

- **Spec 覆盖**：`'boss'` 枚举(Task1)、statusExtras 标注(Task1)、DamageEvent 字段(Task1)、计算跳过(Task2)、导入自动判定+buildBossIds(Task3)、V2/剪贴板持久化(Task4)、PropertyPanel Switch(Task5)、测试(Task2/3/4)、实现顺序(Task1→6) 均有对应任务。
- **占位扫描**：无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致**：`targetMitigationDisabled`(timeline) / `tmd`(V2) / `buildBossIds(enemies, fightName): Set<number>` / `parseDamageEvents(..., composition?, bossIds?)` 在各任务间命名与签名一致。
