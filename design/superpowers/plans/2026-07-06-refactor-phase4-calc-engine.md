# 结构重构第四期：计算引擎拆分 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 拆分 `mitigationCalculator.ts`（1296 行）与 `fflogsImporter.parseDamageEvents`（307 行）：类型上移、假 class 改自由函数、`simulate()` 三单元渐进抽取、status 时间窗口径参数化统一、executor 工厂收敛、resource 回充分段函数单源、导入器 ImportContext/ImportDetail 化。

**Architecture:** **本期零行为变更**——全部是内部结构调整，`mitigationCalculator.test.ts`（2926 行 / 93 用例）与 `fflogsImporter.test.ts`（2477 行 / 38 处调用）是等价性的黑盒锚，**测试断言一行不许改**（仅允许两类机械改动：class 删除后的调用方式替换、ImportContext 签名的调用形式替换）。`simulate()` 拆分按「最独立先行」顺序：statusIntervalRecorder → hpPipeline → timeAdvancer，每步一个 commit 一次全量测试。

**Tech Stack:** TypeScript 5.9、Vitest 4；无新依赖。

## Global Constraints

- **零声明行为变更**。每个任务提交前：`pnpm test:run`、`pnpm exec tsc -b --noEmit`（必须带 `-b`）、`pnpm lint`；触碰 `src/workers/` 的任务（Task 12/13 改 top100Sync 调用点）加 `pnpm test:workers`；最后一个任务加 `pnpm build` 兜底。
- **测试文件纪律**：`mitigationCalculator.test.ts` / `fflogsImporter.test.ts` 的断言（expect 内容）零改动；仅允许 Task 6 的 `new MitigationCalculator()` 调用方式机械替换与 Task 12 的 ImportContext 调用形式机械替换。新增测试只增不改。
- **提交信息不得包含 "claude" 字样**（大小写不敏感，"CLAUDE.md" 也命中——用「项目指南」指代）。不加 Co-Authored-By。
- plan 内声明的 `git commit` / `git rm` 可自主执行且必须执行（不要停在 staged）；`git push` 与破坏性 Git 操作禁止；`git add <具体文件>`。
- **明确不做**（保持现状/留后续期）：`isStatusActiveAt` 两种边界口径**不统一**（参数化共存——calculator 系闭区间与 healMath 系半开区间均为有意设计，统一属行为变更留后续独立决策）；`top100Sync.extractFightStats` 对 `parseDamageEvents` 的 7 参调用差异（不传 bossIds/targetability/bossCasts、fightStartTime 不经 resolve）是**有意的口径差异，禁止"顺手补全"**；`scripts/fetch-events.ts` 越权 import 私有函数的既有 bug 不修（不在 tsconfig include 内）；`parseStatData`/`extractShieldData` 等独立纯函数不动；`StatusSnapshot` 补 performance 字段（第三期备忘）不做。
- 文中行号为 2026-07-06 研究快照，执行时以实际代码为准。
- **同文件串行**：多个任务触碰 `mitigationCalculator.ts`（Task 2/3/5/6/7/8/9）与 `fflogsImporter.ts`（Task 12/13），必须严格按编号串行执行。

---

### Task 1: placement 纯类型上移 src/types/placement.ts + 删除 types/index.ts barrel

**Files:**

- Create: `src/types/placement.ts`
- Modify: `src/utils/placement/types.ts`（搬空类型，只留 `TIME_EPS` 常量与文件头注释更新）
- Modify: `src/types/mitigation.ts:135`（消除唯一 types→utils 反向依赖）
- Modify: 约 20 个消费文件的 import 路径（见 Step 2 清单）
- Delete: `src/types/index.ts`（barrel，全仓零消费者）

**Interfaces:**

- Produces: `@/types/placement` 导出 `Interval` / `PlacementContext` / `Placement` / `InvalidReason` / `InvalidCastEvent` / `InvalidCastEventSummary` / `PlacementEngine` / `StatusTimelineByPlayer`（8 个纯类型，定义原文迁移）；`TIME_EPS` 仍从 `@/utils/placement/types` 导出（运行时常量不进 types/）。

- [ ] **Step 1: 迁移类型**

`src/utils/placement/types.ts` 中除 `TIME_EPS`（含其注释）外的 8 个纯类型（`Interval` L22-25 / `PlacementContext` L30-40 / `Placement` L42-44 / `InvalidReason` L46 / `InvalidCastEvent` L48-56 / `InvalidCastEventSummary` L62-65 / `PlacementEngine` L67-110 / `StatusTimelineByPlayer` L112）连同各自注释**原文迁移**到新建的 `src/types/placement.ts`。新文件头：

```ts
/**
 * Placement 架构公共类型：合法区间、放置上下文、引擎接口。
 * 纯类型自 utils/placement/types.ts 上移（TIME_EPS 运行时常量留在原处）。
 */
import type { CastEvent } from './timeline'
import type { MitigationAction } from './mitigation'
import type { StatusInterval } from './status'
```

`src/utils/placement/types.ts` 瘦身为：`TIME_EPS` 常量（含注释）+ 文件头注释改为「Placement 时间容差常量；类型定义见 @/types/placement」。**不做 re-export**（消费者直接改路径，避免留转发层）。

- [ ] **Step 2: 全部消费者改 import 路径**

机械替换 `from '@/utils/placement/types'` / `from './types'`（placement 目录内）中的**类型部分**为 `from '@/types/placement'`；`TIME_EPS` 的 import 不动。清单（以 grep 实际为准）：

- 外部纯类型 15 条：`tableCellHitTest.ts`、`importAdapter.ts`、`autoMitigation/candidates.ts`（类型部分，`TIME_EPS` 留原路径）、`autoMitigation/candidates.test.ts`、`autoMitigation/optimizer.gcd.test.ts`、`optimizer.phase1/2/3.test.ts`、`autoMitigation/types.ts`、`resource/legalIntervals.ts`、`resource/validator.ts`、`Timeline/index.tsx`、`Timeline/CastEventIcon.tsx`、`TimelineTable/index.tsx`、`SkillTracksCanvas.tsx`（类型部分）
- 混合 1 条：`resource/compute.ts:15` 拆成 `import { TIME_EPS } from '@/utils/placement/types'` + `import type { StatusTimelineByPlayer } from '@/types/placement'`
- placement 目录内 6 个文件：`engine.ts` / `combinators.ts` / `combinators.test.ts` / `resolveVariant.ts` / `intervals.ts` / `engine.test.ts` 的类型 import 改 `@/types/placement`
- `src/types/mitigation.ts:135`：`placement?: import('@/utils/placement/types').Placement` 改为文件顶部 `import type { Placement } from './placement'` + 字段 `placement?: Placement`

Run: `grep -rn "placement/types'" src/ | grep -v "TIME_EPS"`
Expected: 仅剩纯 `TIME_EPS` import 行命中（每行都含 TIME_EPS）。

- [ ] **Step 3: 删除 barrel**

```bash
git rm src/types/index.ts
```

（全仓 `grep -rn "from '@/types'" src/` 已确认零命中，删除零风险。）

- [ ] **Step 4: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。

```bash
git add -A src/types src/utils src/components
git commit -m "refactor(types): placement 纯类型上移消除 types→utils 反向依赖，删除零消费 barrel"
```

---

### Task 2: 计算结果类型上移 src/types/calculation.ts

**Files:**

- Create: `src/types/calculation.ts`
- Modify: `src/utils/mitigationCalculator.ts`（删除 6 个类型定义，改 import + re-export type）
- Modify: 消费者 import（`contexts/DamageCalculationContext.ts`、`utils/exportExcel.ts`、`utils/exportExcel.test.ts`、`components/TimelineTable/TableDataRow.tsx`、`hooks/useDamageCalculation.ts`、`utils/lethalDanger.ts`、`utils/lethalDanger.test.ts`、`components/PropertyPanel.tsx`、`web-workers/calculator/types.ts`、`web-workers/calculator/client.ts`、`web-workers/calculator/index.ts`）

**Interfaces:**

- Produces: `@/types/calculation` 导出 `PerTankResult` / `HpSimulationSnapshot` / `CalculationResult` / `CalculateOptions` / `SimulateInput` / `SimulateOutput`（定义与注释原文迁移自 `mitigationCalculator.ts` L47-216）。

- [ ] **Step 1: 迁移**

6 个 interface（含注释）原文迁入 `src/types/calculation.ts`（文件头注释说明「计算引擎的输入/输出契约类型；实现见 utils/mitigationCalculator」；import 其依赖的 `PartyState`/`MitigationStatus`/`DamageEvent`/`HealSnapshot`/`HpTimelinePoint` 等，以实际类型引用为准从 `./partyState` `./status` `./timeline` `./healSnapshot` `./hpTimeline` 引入）。`mitigationCalculator.ts` 顶部 `import type { ... } from '@/types/calculation'` 并 `export type { PerTankResult, HpSimulationSnapshot, CalculationResult, CalculateOptions, SimulateInput, SimulateOutput }`（保住既有消费者路径，本任务不强制改全部消费者——但 Step 2 仍统一改掉，re-export 仅作过渡兜底防漏网）。

- [ ] **Step 2: 消费者改 import**

上述 11 个文件的 `import type { X } from '@/utils/mitigationCalculator'`（或 `'./mitigationCalculator'`）中**纯类型部分**改为 `from '@/types/calculation'`；值 import（`MitigationCalculator`/`createMitigationCalculator`）不动（Task 6 处理）。

Run: `grep -rn "import type {.*} from.*mitigationCalculator" src/ | grep -v calculation`
Expected: 零命中（类型 import 全部改走 @/types/calculation）。

- [ ] **Step 3: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`

```bash
git add src/types/calculation.ts src/utils/mitigationCalculator.ts src/contexts/DamageCalculationContext.ts src/utils/exportExcel.ts src/utils/exportExcel.test.ts src/components/TimelineTable/TableDataRow.tsx src/hooks/useDamageCalculation.ts src/utils/lethalDanger.ts src/utils/lethalDanger.test.ts src/components/PropertyPanel.tsx src/web-workers/calculator/types.ts src/web-workers/calculator/client.ts src/web-workers/calculator/index.ts
git commit -m "refactor(types): 计算引擎输入输出契约上移 types/calculation.ts"
```

---

### Task 3: isStatusActiveAt 参数化统一（口径不变）

**Files:**

- Create: `src/utils/statusWindow.ts`、`src/utils/statusWindow.test.ts`
- Modify: `src/utils/mitigationCalculator.ts`（6 处内联比较替换，行号快照 673/934/1022/1084/1113/1142）
- Modify: `src/executors/healMath.ts`（2 处替换，L38/L67）

**Interfaces:**

- Produces:

```ts
export type StatusWindowBoundary = 'closed' | 'excludeEnd'
export function isStatusActiveAt(
  status: { startTime: number; endTime: number },
  time: number,
  boundary: StatusWindowBoundary
): boolean
```

**口径纪律（本任务核心）**：calculator 6 处全部传 `'closed'`（`t ∈ [start, end]`），healMath 2 处全部传 `'excludeEnd'`（`t ∈ [start, end)`）——**逐处保持原口径，任何一处传错都是行为变更**。两种口径均为有意设计（healMath.test.ts 有 endTime 边界专测锚定），本期不统一。

- [ ] **Step 1: 失败测试**

```ts
// src/utils/statusWindow.test.ts
import { describe, it, expect } from 'vitest'
import { isStatusActiveAt } from './statusWindow'

const s = { startTime: 10, endTime: 20 }

describe('isStatusActiveAt', () => {
  it('closed：endTime 那一刻仍 active', () => {
    expect(isStatusActiveAt(s, 10, 'closed')).toBe(true)
    expect(isStatusActiveAt(s, 20, 'closed')).toBe(true)
    expect(isStatusActiveAt(s, 9.999, 'closed')).toBe(false)
    expect(isStatusActiveAt(s, 20.001, 'closed')).toBe(false)
  })
  it('excludeEnd：endTime 那一刻已失效', () => {
    expect(isStatusActiveAt(s, 10, 'excludeEnd')).toBe(true)
    expect(isStatusActiveAt(s, 20, 'excludeEnd')).toBe(false)
    expect(isStatusActiveAt(s, 19.999, 'excludeEnd')).toBe(true)
  })
})
```

Run: `pnpm test:run statusWindow` → FAIL。

- [ ] **Step 2: 实现**

```ts
// src/utils/statusWindow.ts
/**
 * status 生效窗判定的单一定义点。
 * 两种边界口径并存且均为有意设计（本期不统一，统一属行为变更须单独决策）：
 * - 'closed'：t ∈ [startTime, endTime]。mitigationCalculator 全系采用
 *   （减伤/盾/参考HP/钩子派发/tick 判定，endTime 那一刻 buff 仍生效）。
 * - 'excludeEnd'：t ∈ [startTime, endTime)。healMath 系采用
 *   （治疗/HP池视角，endTime 那一刻已失效；healMath.test.ts 边界用例锚定）。
 */
export type StatusWindowBoundary = 'closed' | 'excludeEnd'

export function isStatusActiveAt(
  status: { startTime: number; endTime: number },
  time: number,
  boundary: StatusWindowBoundary
): boolean {
  if (time < status.startTime) return false
  return boundary === 'closed' ? time <= status.endTime : time < status.endTime
}
```

Run: `pnpm test:run statusWindow` → PASS。

- [ ] **Step 3: 替换 8 处**

逐处把内联比较改为调用（`continue`/`if` 的分支结构保持，仅条件表达式替换；注意有的写法是"不 active 则 continue"要取反）：

- calculator 6 处 → `if (!isStatusActiveAt(status, t, 'closed')) continue`（或肯定形式，以各处原结构为准）；变量名 `status`/`s`、时间变量 `t`/`time`/`mitigationTime`/`event.time` 按实际。
- healMath 2 处 → `if (!isStatusActiveAt(status, castTime, 'excludeEnd')) continue` 等。
- **不碰** `advanceToTime` 内的过期裁剪比较（L744/761 的 `s.endTime < cur` 是"裁剪已过期"语义不是"是否 active"判定，留在 Task 9 随 timeAdvancer 原样迁移）。

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿（93 + 12 个 calculator/healMath 用例锁定 8 处口径逐一未变）。

- [ ] **Step 4: Commit**

```bash
git add src/utils/statusWindow.ts src/utils/statusWindow.test.ts src/utils/mitigationCalculator.ts src/executors/healMath.ts
git commit -m "refactor(utils): isStatusActiveAt 单一定义点，闭/半开两口径参数化共存"
```

---

### Task 4: healMath 注入 getMeta 断开 statusRegistry 静态环

**Files:**

- Modify: `src/executors/healMath.ts`（两函数追加 `getMeta` 形参，删除 statusRegistry import）
- Modify: `src/executors/applyDirectHeal.ts`（追加形参并透传）
- Modify: 调用方：`src/executors/createHealExecutor.ts`、`createShieldExecutor.ts`、`createRegenExecutor.ts`（import getStatusById 硬编码传入——叶子模块无环风险）、`src/data/statusExtras.ts`（5 处调用：spawnRegenChild 1 处 computeFinalHeal + triggerStatusHeal 与 3 处 onExpire 的 applyDirectHeal，新增 getStatusById import——statusExtras→statusRegistry 是既有正向边）、`src/utils/mitigationCalculator.ts:461`（computeMaxHpMultiplier 调用点追加）
- Modify: `src/executors/healMath.test.ts`（删除 `vi.mock('@/utils/statusRegistry')`，改为直接传假 `getMeta`——测试简化，断言不变）

**Interfaces:**

- Produces: `export type GetStatusMeta = (statusId: number) => MitigationStatusMetadata | undefined`（`@/executors/healMath`）；`computeFinalHeal(baseAmount, partyState, castSourcePlayerId, castTime, getMeta)`、`computeMaxHpMultiplier(statuses, time, getMeta)`、`applyDirectHeal(partyState, baseAmount, meta, getMeta, recordHeal?)`（getMeta 插在 recordHeal 前，以实际参数序为准并在报告注明最终签名）。

**环的现状**（改造动机）：`statusRegistry.ts → statusExtras.ts → healMath.ts → statusRegistry.ts`，靠 getStatusById 懒初始化脆弱地跑通（`regenStatusExecutor.ts` 文件头注释佐证作者已知）。改后 healMath 不再 import statusRegistry，环变单向 DAG。

- [ ] **Step 1: healMath 两函数追加 getMeta 形参**（函数体内 `getStatusById(...)` → `getMeta(...)`，删除顶部 import，新增 `GetStatusMeta` 类型导出与 JSDoc）
- [ ] **Step 2: applyDirectHeal 级联**（追加形参透传给 computeFinalHeal）
- [ ] **Step 3: 全部调用方追加实参 `getStatusById`**（三工厂 + statusExtras 5 处 + mitigationCalculator 1 处；各文件按需新增 `import { getStatusById } from '@/utils/statusRegistry'`）
- [ ] **Step 4: healMath.test.ts 去 mock 改传参**（12 用例断言不变；`vi.mock` 块删除，构造 `const getMeta = (id: number) => metaTable[id]` 直传）
- [ ] **Step 5: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`；`grep -n "statusRegistry" src/executors/healMath.ts` 零命中。

```bash
git add src/executors/healMath.ts src/executors/applyDirectHeal.ts src/executors/createHealExecutor.ts src/executors/createShieldExecutor.ts src/executors/createRegenExecutor.ts src/data/statusExtras.ts src/utils/mitigationCalculator.ts src/executors/healMath.test.ts
git commit -m "refactor(executors): healMath 注入 getMeta 断开 statusRegistry 静态环"
```

---

### Task 5: computeReferenceMaxHP / computeMaxHpMultiplier 合并（谓词 + 口径参数化）

**Files:**

- Modify: `src/executors/healMath.ts`（新增 `computeMaxHpMultiplierFiltered`，`computeMaxHpMultiplier` 变薄包装）
- Modify: `src/utils/mitigationCalculator.ts`（private `computeReferenceMaxHP` 方法体改调新函数）
- Test: `src/executors/healMath.test.ts`（追加 filtered 版 describe）

**Interfaces:**

- Produces（`@/executors/healMath`）:

```ts
export function computeMaxHpMultiplierFiltered(
  statuses: MitigationStatus[],
  time: number,
  boundary: StatusWindowBoundary,
  getMeta: GetStatusMeta,
  filter: (meta: MitigationStatusMetadata, status: MitigationStatus) => boolean
): number
```

**口径纪律**：`computeMaxHpMultiplier` 包装传 `'excludeEnd'` + `meta => !meta.isTankOnly`（原半开区间语义）；`computeReferenceMaxHP` 包装传 `'closed'` + 调用方 filter + `base <= 0` 短路 + `Math.round(base * m)`（原闭区间语义）。**两包装的既有行为逐字保持**——这是 Task 3 参数化的直接收益：合并重复循环而不改任何边界行为。

- [ ] **Step 1: 失败测试**（filtered 版：boundary 两口径在 `t === endTime` 的分叉断言 + filter 生效断言，各 1-2 用例）
- [ ] **Step 2: 实现 filtered 核心 + 两个薄包装**（核心循环用 `isStatusActiveAt(status, time, boundary)`；`computeReferenceMaxHP` 保持 private 方法形态、方法体一行调用——Task 6 改自由函数时随迁）
- [ ] **Step 3: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`

```bash
git add src/executors/healMath.ts src/executors/healMath.test.ts src/utils/mitigationCalculator.ts
git commit -m "refactor(executors): maxHP 倍率循环合并 computeMaxHpMultiplierFiltered，谓词与口径参数化"
```

---

### Task 6: MitigationCalculator 假 class 改自由函数

**Files:**

- Modify: `src/utils/mitigationCalculator.ts`（class 壳删除；6 方法转模块级函数；`createMitigationCalculator` 删除）
- Modify: 生产调用方：`src/web-workers/calculator/index.ts`（`new MitigationCalculator()` → 直接 import `simulate`）、`src/utils/autoMitigation/evaluate.ts`（`createMitigationCalculator()` → 直接 import；顺带更新其"实例复用"注释为"纯函数直接调用"）
- Modify: 测试调用方（机械替换，断言零改动）：`mitigationCalculator.test.ts`（41 处）、`hooks/useDamageCalculation.test.ts`（1 处）、`utils/placement/integration.test.ts`（1 处）

**Interfaces:**

- Produces（`@/utils/mitigationCalculator`）: `export function calculate(event, partyState, opts?): CalculationResult`、`export function simulate(input: SimulateInput): SimulateOutput`；`applyDamageToHp` / `recomputeHpMax` / `computeReferenceMaxHP` / `runSingleBranch` 转模块私有函数（**加 `export` 供后续 Task 7-9 的 simulation/ 兄弟模块 import**——导出但不视为公共 API，JSDoc 注明 internal）。

**前提确认**（研究已证实）：class 无构造函数、无实例字段，6 处 `this.` 全为方法互调；`evaluate.ts` 注释明确佐证跨调用无状态。改造为纯语法变换：方法提为函数、`this.` 前缀删除。

- [ ] **Step 1: class → 函数**（保持函数体逐字不动，仅提层级与去 this；`export class MitigationCalculator` 与 `createMitigationCalculator` 删除）
- [ ] **Step 2: 生产调用方（2 文件）**
- [ ] **Step 3: 测试机械替换**（`const calculator = new MitigationCalculator()` 行删除、`calculator.calculate(` → `calculate(`、`calculator.simulate(` → `simulate(`，import 行同步；43 处纯机械，断言零改动——replace 后 `grep -n "MitigationCalculator" src/` 应零命中）
- [ ] **Step 4: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 93 用例全绿且断言未变（`git diff --stat` 中测试文件应只有调用行变化——reviewer 会核）。

```bash
git add src/utils/mitigationCalculator.ts src/web-workers/calculator/index.ts src/utils/autoMitigation/evaluate.ts src/utils/mitigationCalculator.test.ts src/hooks/useDamageCalculation.test.ts src/utils/placement/integration.test.ts
git commit -m "refactor(calc): MitigationCalculator 假 class 改自由函数，消除无状态实例仪式"
```

---

### Task 7: simulate 拆分 I —— statusIntervalRecorder 抽取

**Files:**

- Create: `src/utils/simulation/statusIntervalRecorder.ts`
- Create: `src/utils/simulation/statusIntervalRecorder.test.ts`
- Modify: `src/utils/mitigationCalculator.ts`（simulate 内 L572-650 + 收尾 L971-984 的 recorder 相关段替换为模块调用）

**Interfaces:**

- Produces:

```ts
/** status 生效区间记录器：对比相邻 PartyState 快照的 statuses 差异，产出 StatusInterval 时间线。 */
export interface StatusIntervalRecorder {
  /** 对比 prev/next 的 statuses（按 instanceId diff），维护 open 表并落已闭区间 */
  captureTransition(prev: PartyState, next: PartyState, time: number): void
  /** 收尾：把仍 open 的记录以 endTime 落表，返回最终产物 */
  finish(): {
    statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
    castEndEntries: CastEndEntry[]
  }
}
export function createStatusIntervalRecorder(): StatusIntervalRecorder
```

（`CastEndEntry` 若原为 simulate 内部类型则随迁并导出；`finish()` 内含既有的按 `from` 排序逻辑；`reduceCastEffectiveEnds` 的调用留在 simulate 收尾——它消费 `castEndEntries`，以实际代码为准决定是否一并进 `finish()` 返回 `castEffectiveEndByCastEventId`，取改动更小者并在报告注明。）

**迁移纪律**：`OpenRecord`/`open` Map/`pushInterval`/`captureTransition` 的函数体**逐字迁移**为 recorder 闭包内部实现，仅把对外层局部变量（`statusTimelineByPlayer`/`castEndEntries`/`open`）的引用改为工厂闭包内状态。simulate 内 6 个 `captureTransition(...)` 调用点改为 `recorder.captureTransition(...)`。**instanceId diff 语义（CLAUDE.md Executor 规范的底座）一字不动。**

- [ ] **Step 1: 新模块 + 单测**（先写针对 recorder 的独立单测：attach/persist/consume 三态、跨 capture 的 open 维护、finish 落表排序——用最小 PartyState 夹具；这是**新增**保护，2926 行黑盒锚继续兜底）
- [ ] **Step 2: simulate 接线**（声明段与收尾段替换；`pnpm test:run mitigationCalculator` 全绿）
- [ ] **Step 3: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`

```bash
git add src/utils/simulation/statusIntervalRecorder.ts src/utils/simulation/statusIntervalRecorder.test.ts src/utils/mitigationCalculator.ts
git commit -m "refactor(calc): simulate 拆分——statusIntervalRecorder 抽取 simulation/ 模块"
```

---

### Task 8: simulate 拆分 II —— hpPipeline 抽取

**Files:**

- Create: `src/utils/simulation/hpPipeline.ts`
- Create: `src/utils/simulation/hpPipeline.test.ts`
- Modify: `src/utils/mitigationCalculator.ts`（`applyDamageToHp` L369-453 / `recomputeHpMax` L459-473 两个模块私有函数整体迁出；simulate 内 `recomputeAndTrack`/`recordHeal` 闭包与 `lastKnownHp/lastKnownHpMax/hpTimeline/healSnapshots` 影子状态封装迁出）

**Interfaces:**

- Produces:

```ts
/** HP 池演算管道：封装 hp.max 同步、伤害扣减、治疗/tick 记录与 hpTimeline/healSnapshots 影子状态。 */
export interface HpPipeline {
  /** recomputeHpMax + max 变化时记 hpTimeline（原 recomputeAndTrack） */
  recomputeAndTrack(state: PartyState, time: number): PartyState
  /** 治疗快照回调（原 recordHeal 闭包）；供 SimulateInput 的钩子链使用 */
  recordHeal(snap: HealSnapshot): void
  /** 伤害落 HP 池（原 applyDamageToHp），返回新 state 与快照 */
  applyDamage(
    state: PartyState,
    ev: DamageEvent,
    finalDamage: number,
    candidateDamage: number
  ): {
    nextState: PartyState
    snapshot: HpSimulationSnapshot | undefined
  }
  /** timeAdvancer 的 regen tick 记录入口（原 advanceToTime 内直写 hpTimeline 的耦合点，改为显式方法） */
  recordTimelinePoint(point: HpTimelinePoint): void
  /** 收尾：排序并返回 hpTimeline/healSnapshots（skipHpPipeline 时返回空） */
  finish(): { hpTimeline: HpTimelinePoint[]; healSnapshots: HealSnapshot[] }
}
export function createHpPipeline(opts: {
  skipHpPipeline: boolean
  initialState: PartyState
}): HpPipeline
```

（方法名/参数以实际迁移时最小改动为准微调，但**影子状态 `lastKnownHp/lastKnownHpMax` 必须封装在工厂闭包内**、`advanceToTime` 内 regen 段对 `hpTimeline` 的直写必须改走 `recordTimelinePoint`——这是研究标记的职责边界模糊点，本任务将其显式化但不改写入内容。`recomputeHpMax`/`applyDamageToHp` 函数体逐字迁移。）

- [ ] **Step 1: 新模块 + 单测**（applyDamage 的盾扣减/overkill/partial 段行为最小夹具单测；recomputeAndTrack 的 max 变化记录单测）
- [ ] **Step 2: simulate 接线**（`this.`/局部闭包引用改 `hp.xxx` 调用；`calculate()` 内对 `applyDamageToHp` 无引用——它是 simulate 专用，核实后迁移）
- [ ] **Step 3: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`

```bash
git add src/utils/simulation/hpPipeline.ts src/utils/simulation/hpPipeline.test.ts src/utils/mitigationCalculator.ts
git commit -m "refactor(calc): simulate 拆分——hpPipeline 抽取，影子 HP 状态显式封装"
```

---

### Task 9: simulate 拆分 III —— timeAdvancer 抽取 + simulate 瘦身为编排

**Files:**

- Create: `src/utils/simulation/timeAdvancer.ts`
- Modify: `src/utils/mitigationCalculator.ts`（`advanceToTime` L652-771 与 `processCast` L813-848 迁出；simulate 主体收敛为「初始化 → 主循环编排 → 汇总」约百行）

**Interfaces:**

- Produces:

```ts
/** 时间推进器：tick 触发、status 过期裁剪、cast 执行编排。 */
export interface TimeAdvancer {
  /** 把世界推进到 target 时刻（tick/expire 交替），返回新 state；过期 status 追加进内部 pastStatuses */
  advanceTo(state: PartyState, from: number, target: number): PartyState
  /** 处理单个 cast：advance → captureTransition → resolveVariant → executor → recompute（原 processCast） */
  processCast(state: PartyState, cast: CastEvent, advanceTarget: number): PartyState
  /** timeAdvancer 产出、calculate 消费的历史 status（DOT 快照找回用） */
  getPastStatuses(): MitigationStatus[]
  getResolvedVariants(): Map<string, number>
}
export function createTimeAdvancer(deps: {
  statistics: TimelineStatData | undefined
  variantMembers: Map<number, MitigationAction[]>
  recorder: StatusIntervalRecorder
  hp: HpPipeline
  recordHeal: (snap: HealSnapshot) => void
}): TimeAdvancer
```

（签名细节以迁移时实际闭包捕获为准——`deps` 必须显式列全原闭包依赖，禁止残留对 simulate 局部变量的隐式引用；`lastAdvanceTime`/`castIdx` 游标留在 simulate 主循环（编排层职责）还是收进 advancer，取改动更小者并在报告注明。`fireTick` 内 regen 逻辑经 Task 8 的 `hp.recordTimelinePoint` 写入。`pastStatuses` 经 `getPastStatuses()` 显式暴露给主循环传 `calculate()`。）

- [ ] **Step 1: 迁移 + 接线**（函数体逐字迁移；simulate 主循环改为调用 advancer 方法）
- [ ] **Step 2: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 93 用例全绿；`mitigationCalculator.ts` 行数显著下降（报告给出前后行数）。

```bash
git add src/utils/simulation/timeAdvancer.ts src/utils/mitigationCalculator.ts
git commit -m "refactor(calc): simulate 拆分——timeAdvancer 抽取，simulate 收敛为编排层"
```

---

### Task 10: executor 工厂收敛 statusHelpers.addStatus（互斥语义参数化）

**Files:**

- Modify: `src/executors/executors.test.ts`（**先补盲区测试**：buff/shield 的 uniqueGroup 互斥替换、`uniqueGroup: []` 关闭互斥多实例共存——现有测试对这两条是零覆盖）
- Modify: `src/executors/statusHelpers.ts`（`AddStatusInput` 加 `replaces?: (existing: MitigationStatus) => boolean`）
- Modify: `src/executors/statusHelpers.test.ts`（replaces 行为用例：过滤匹配/保留不匹配/不传纯追加/新旧 instanceId 不同）
- Modify: `src/executors/createBuffExecutor.ts`、`createShieldExecutor.ts`、`createRegenExecutor.ts`（改用 addStatus）

**Interfaces:**

- Produces: `AddStatusInput.replaces?`——不传 = 纯追加（现契约不变）；传入 = 加入前过滤满足谓词的旧状态。三工厂改造后：buff/shield 传 `uniqueGroup.length > 0 ? s => uniqueGroup.includes(s.statusId) : undefined`；regen 传 `s => s.statusId === statusId && s.sourcePlayerId === ctx.sourcePlayerId`。

**instanceId 契约纪律**（CLAUDE.md）：`replaces` 仅用于「新 cast 互斥替换旧 buff」（新实例新 instanceId 是正确语义）；**不得**用于「延长/变身既有 status」（那必须走 `updateStatus` 保持 instanceId）。在 `replaces` 的 JSDoc 里写明此边界。

- [ ] **Step 1: 补盲区测试并确认现状全绿**（新增用例先跑一遍锁定当前行为——这些用例在收敛前后都必须绿）

```ts
// executors.test.ts 追加（以实际夹具风格为准）
it('createBuffExecutor: 新 buff 加入后同 uniqueGroup 旧 buff 被移除', () => {
  /* 断言旧 statusId 消失、新 status 存在且 instanceId 不同 */
})
it('createBuffExecutor: uniqueGroup 为空数组时多实例共存', () => {
  /* 连续两次执行，断言 statuses 含两条同 statusId */
})
it('createShieldExecutor: 同 uniqueGroup 旧盾被替换', () => {
  /* 同上 */
})
```

- [ ] **Step 2: addStatus 加 replaces + statusHelpers 测试**（实现见研究结论：`const baseStatuses = replaces ? state.statuses.filter(s => !replaces(s)) : state.statuses`）
- [ ] **Step 3: 三工厂改造**（各自的 statistics 读取/computeFinalHeal 快照/特有字段留在工厂内，仅「filter + 字面量拼装 + splice」段收敛为一次 addStatus 调用；`createRegenExecutor.test.ts` 既有的同玩家替换/跨玩家共存用例为回归护栏）
- [ ] **Step 4: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`

```bash
git add src/executors/statusHelpers.ts src/executors/statusHelpers.test.ts src/executors/executors.test.ts src/executors/createBuffExecutor.ts src/executors/createShieldExecutor.ts src/executors/createRegenExecutor.ts
git commit -m "refactor(executors): 三工厂收敛 addStatus，互斥语义 replaces 谓词参数化"
```

---

### Task 11: resource 回充分段函数单源 computeAmountTransitions

**Files:**

- Modify: `src/utils/resource/compute.ts`（新增 `AmountBreakpoint` + `computeAmountTransitions`）
- Modify: `src/utils/resource/compute.test.ts`（transitions 专属用例：断点完整性、kind/eventIndex、事件后回充展开到回满）
- Modify: `src/utils/resource/cdBar.ts`（自建交错扫描循环改为 transitions 线性扫描）
- Modify: `src/utils/resource/legalIntervals.ts`（自建 (t,amount) 构造段改为调用 transitions；下游透支段的 `computeResourceTrace` 调用保留）
- Modify: `src/utils/resource/cdBar.test.ts`、`legalIntervals.test.ts`（补「三档连续消耗」共享 fixture 用例，两文件断言同一组输入——研究指出的互证盲区）

**Interfaces:**

- Produces（`@/utils/resource/compute`）:

```ts
export interface AmountBreakpoint {
  t: number // 断点时刻；首个固定 -Infinity（initial 段）
  amount: number // [t, next.t) 区间内的恒定 amount
  kind: 'initial' | 'event' | 'refill'
  eventIndex?: number // kind==='event' 时对应 events 下标
}
export function computeAmountTransitions(
  def: ResourceDefinition,
  events: ResourceEvent[]
): AmountBreakpoint[]
```

实现以研究给出的骨架为准（内部复用 `applyResourceEvent` 原语 + 与 `advanceRefills` 同款的逐档展开，事件耗尽后继续展开未来回充直到回满——cdBar 场景需要扫到底）；`computeResourceTrace`/`computeResourceStateAt`/`futureRefills` 等既有导出**不动**（validator/hoverSnapshot 依赖它们且无重复问题）。

**行为等价锚**：`compute.test.ts` 的"顺序 vs 平行"回归用例（t=45→105、双 cast 60→120）、`cdBar.test.ts` 的献奉 1/2/3 连发、`legalIntervals.test.ts` 的 ULP 边界——全部必须原样通过。

- [ ] **Step 1: transitions 失败测试 → 实现 → PASS**
- [ ] **Step 2: cdBar 改造**（`computeCdBarEnd` 改为 transitions 扫描——研究给了目标代码；「还有库存不画」「Infinity=时间轴内无恢复」语义逐字保持）
- [ ] **Step 3: legalIntervals 改造**（自耗尽段改 transitions；下游透支段不动）
- [ ] **Step 4: 补三档连续消耗共享 fixture 用例**（cdBar 与 legalIntervals 各 1 条，同一组 def/events 数值，互证）
- [ ] **Step 5: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`

```bash
git add src/utils/resource/compute.ts src/utils/resource/compute.test.ts src/utils/resource/cdBar.ts src/utils/resource/cdBar.test.ts src/utils/resource/legalIntervals.ts src/utils/resource/legalIntervals.test.ts
git commit -m "refactor(resource): 回充 amount 分段函数 computeAmountTransitions 单源，cdBar/legalIntervals 改为断点扫描"
```

---

### Task 12: fflogsImporter —— bossCasts 盲区测试 + ImportContext + ImportDetail

**Files:**

- Modify: `src/utils/fflogsImporter.test.ts`（**先补** bossCasts 分支 smoke test 锁行为——现测试 38 处调用无一传第 9 参；然后 38 处调用改对象形式）
- Modify: `src/utils/fflogsImporter.ts`（`parseDamageEvents` 签名改 `(ctx: ImportContext)`；6 个并行 Map 合并为 `ImportDetail`）
- Modify: `src/workers/top100Sync.ts:101-109`（调用点改对象形式——**7 参差异原样保留**，缺的字段就是不传）
- Modify: `scripts/fetch-events.ts:122`（调用点改对象形式——该脚本不在 tsconfig 内，改完跑不了 tsc，肉眼核对）

**Interfaces:**

- Produces（`@/utils/fflogsImporter`）:

```ts
export interface ImportContext {
  events: FFLogsEvent[]
  fightStartTime: number
  playerMap: PlayerMap
  abilityMap?: Map<number, FFLogsAbility>
  composition?: Composition
  bossIds?: Set<number>
  sourceNames?: Map<number, string>
  targetability?: TargetabilityIntervals
  bossCasts?: FFLogsEvent[]
}
export function parseDamageEvents(ctx: ImportContext): DamageEvent[]
```

模块私有中间类型（不导出）：

```ts
/** 导入期临时明细：PlayerDamageDetail 超集，聚合结束即丢弃，不进持久化。 */
interface ImportDetail extends PlayerDamageDetail {
  damageTimestamp?: number // 仅 calculateddamage 无 damage 时缺省
  skillName: string
  sourceId: number
  packetId?: number
  snapshotTimestamp?: number
  isAutoAttack: boolean
}
```

- [ ] **Step 1: bossCasts smoke test（先行锁行为）**

在 `fflogsImporter.test.ts` 的 parseDamageEvents describe 内新增（**用当前位置参数签名写**，随 Step 3 一起改对象形式）：构造最小 boss begincast/cast 对 + 同名 damage 事件，断言产出事件的 `castStartTime`/`castEndTime` 被回填。跑绿。

- [ ] **Step 2: ImportDetail 合并 6 Map**

`damageTimestamps`/`detailSkillNames`/`detailSourceIds`/`detailPacketIds`/`detailSnapshotTimestamps`/`detailIsAutoAttack` 六个以 detail 身份为 key 的并行 Map 删除；创建 detail 处（L318-329）一次性构造 `ImportDetail` 字面量；全部 `map.get(detail)` 读取点改 `detail.xxx`。**阶段内部脚手架**（`dotDebuffMap`/`detailByPacketAndTarget`/`detailByDamageTs`）保留 Map 形态（value 类型改 `ImportDetail`）。`damageTimestamp` 可选语义保持（Step3 的 fallback `?? detail.timestamp` 不变）。

Run: `pnpm test:run fflogsImporter` → 全绿（此时仍是位置参数签名）。

- [ ] **Step 3: ImportContext 签名切换**

- 签名改 `parseDamageEvents(ctx: ImportContext)`，函数体首行解构。
- 生产 2 处调用改对象形式（`parseFightImport` 传 9 字段；`top100Sync` 传 7 字段——**禁止补全缺省字段**）。
- 测试 38 处批量改：31 处 4 参 → `{ events, fightStartTime, playerMap, abilityMap }`；其余 7 处按各自实参对应字段名。断言零改动。
- `scripts/fetch-events.ts` 调用同步改（报告注明该脚本无类型检查）。

Run: `grep -c "parseDamageEvents(" src/utils/fflogsImporter.test.ts` 数量不变；`pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint` 全绿。

- [ ] **Step 4: Commit**

```bash
git add src/utils/fflogsImporter.ts src/utils/fflogsImporter.test.ts src/workers/top100Sync.ts scripts/fetch-events.ts
git commit -m "refactor(import): parseDamageEvents 改 ImportContext 对象参数，6 并行 Map 合并 ImportDetail"
```

---

### Task 13: fflogsImporter —— 四步函数拆分 + postProcessors 显式 pipeline

**Files:**

- Modify: `src/utils/fflogsImporter.ts`（parseDamageEvents 函数体拆 4 个模块私有函数 + 尾部 pipeline 数组化）

**Interfaces:**

- Produces: 无新导出（4 个子函数模块私有；`parseDamageEvents(ctx)` 签名与行为不变）。子函数边界（以实际代码为准微调，函数体逐字迁移）：

```ts
/** Step 1&2：单次遍历 events——DOT 快照记录 + calculateddamage/damage 创建与填充 ImportDetail */
function collectDamageDetails(ctx: ImportContext, ...): { details: ImportDetail[]; dotDebuffMap: ... }
/** Step 3：absorbed 事件回填盾值明细 */
function attachAbsorbedShields(details: ImportDetail[], events: FFLogsEvent[], ...): void
/** Step 4：0.9s 窗口 + 技能名分组聚合，产出 DamageEvent[] */
function aggregateIntoDamageEvents(details: ImportDetail[], ctx: ImportContext, ...): DamageEvent[]
/** 后处理 pipeline（顺序即依赖：tankbuster 降级 → 普攻补捞 → partial AOE 细分 → override 权威覆盖 → final AOE 时移 → castWindow 回填） */
function buildPostProcessors(ctx: ImportContext): Array<(events: DamageEvent[]) => void>
```

**纪律**：Step 1&2 保持**单次遍历**（不拆成两次遍历——保持物理行为与性能特征不变）；pipeline 数组顺序 = 现有调用顺序（`refineTankbusterClassification` → `refineAutoAttackClassification(TANK_JOBS)` → `classifyPartialAOE(composition)` → `applyActionTypeOverride` → `shiftPartialFinalAoeTime` → 条件 `attachCastWindows`），每个元素上方一行注释写明其顺序依赖前提；`shiftPartialFinalAoeTime` 内部自行 sort 的现状保持，pipeline 外层不加全局排序。

- [ ] **Step 1: 拆分 + 数组化**（逐字迁移；`parseDamageEvents` 本体收敛为 ~20 行编排）
- [ ] **Step 2: 验证 + Commit**

Run: `pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿（38+1 处调用与全部断言不变）。

```bash
git add src/utils/fflogsImporter.ts
git commit -m "refactor(import): parseDamageEvents 拆四步子函数，后处理链显式 pipeline 数组化"
```

---

### Task 14: 文档同步

**Files:**

- Modify: `CLAUDE.md`
- Modify: `src/workers/README.md`（仅当受影响，预计不受）

写文档前逐项以实际代码为准核对：

- 「关键文件说明」表：`src/utils/mitigationCalculator.ts` 的说明更新为「减伤计算引擎（calculate/simulate 自由函数，simulate 编排 simulation/ 三模块）」；视需要补 `src/utils/simulation/` 一行。
- 「核心概念」如提及 `MitigationCalculator` 类的措辞改为函数式表述（grep `MitigationCalculator` 在 CLAUDE.md 的出现处）。
- 资源模型一节可补一句：回充 amount 分段函数 `computeAmountTransitions` 为 cdBar/legalIntervals 共用单源。
- `**最后更新**` 改为执行当日日期。

- [ ] **Step 1: 更新 + 验证 + Commit**

Run: `pnpm test:run && pnpm lint && pnpm build`
Expected: 全绿（build 为全期收尾兜底）。

```bash
git add CLAUDE.md
git commit -m "docs: 项目指南同步第四期计算引擎拆分结构"
```

（提交信息用「项目指南」，不得出现 "CLAUDE.md"。）

---

## 任务依赖

- 严格按编号串行（`mitigationCalculator.ts` 被 2/3/4/5/6/7/8/9 连续触碰；`healMath.ts` 被 3/4/5 触碰；`fflogsImporter.ts` 被 12/13 触碰）。
- Task 3（isStatusActiveAt）是 Task 5（合并需要 boundary 参数）的前置；Task 4（getMeta）是 Task 5（filtered 版需要 getMeta 形参）的前置；Task 6（class→函数）在 7-9（simulate 拆分）之前（去 this 后迁移更干净）。
- Task 10/11 与 calculator 系任务无共享文件，但仍按编号执行避免并发。

## 验收

- 全部验证命令绿；`mitigationCalculator.test.ts` 与 `fflogsImporter.test.ts` 的断言 diff 为零（仅调用形式变化）。
- `grep -rn "MitigationCalculator" src/` 零命中；`grep -rn "from '@/types'" src/` 零命中；healMath 不再 import statusRegistry；`mitigationCalculator.ts` 与 `parseDamageEvents` 函数体行数显著收敛（报告给出前后对比）。
- 零行为变更：无任何声明的行为变更条目，任何测试断言的改动都是缺陷。
