# 时间轴阶段（Phase）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在编辑器的时间轴视图、缩略图、表格视图中显示阶段边界，工具栏提供阶段跳转入口，阶段可手动增删改并参与协作与撤销；FFLogs 导入与副本模板自动带入阶段，阶段名按导入者语言查表翻译。

**Architecture:** 阶段是 `Timeline.phases?: TimelinePhase[]`（`{ id, name, time }`），纯展示 / 导航，不进任何计算。持久化走 V2 可选字段 `ph`，协作走独立 `Y.Map`（同 annotations 做法）并纳入 UndoManager。排序、配色、短标签、当前阶段判定、时间钳制、导入去重等全部收口在纯函数模块 `src/utils/timelinePhases.ts`。FFLogs 导入与 TOP100 采样共用 `parseFightPhases` 产出未翻译的 `RawPhase[]`；翻译在 Worker（导入，按请求 `lang`）与前端（模板建轴，按当前 locale）两处调用同一个纯函数 `translatePhaseName`，对照表是 Crowdin 维护的 `encounter.json`。

**Tech Stack:** React 19 + TypeScript 5.9、Zustand 5、Yjs、React-Konva、Hono（Workers）、Vitest 4、Tailwind v3 + shadcn/ui、i18next + Crowdin

**Spec:** `design/superpowers/specs/2026-10-20-timeline-phases-design.md`（下文以「设计 §x」引用）
**交互原型：** `design/superpowers/specs/2026-10-20-timeline-phases-prototype/phase-edit.html`（像素值、阈值、交互细节以它为准；配色以设计 §6.1 为准）

## Global Constraints

- 包管理器必须用 `pnpm`。
- 提交信息、作者、Co-Authored-By 中**禁止**出现 "Claude" 字样（`.husky/commit-msg` 会拒绝，大小写不敏感）。提交信息用 conventional commits（`feat(phase): 描述`），描述用中文；多行信息写入临时文件后用 `git commit -F <文件>`。
- 测试文件与源文件同目录，命名 `*.test.ts(x)`。
- 状态更新必须不可变；Y.Doc 写入必须走 `src/collab/docSchema.ts` 的 mutator，事务 origin 为 `LOCAL_ORIGIN`（可撤销）。
- 阶段**不参与任何计算**：不得修改 `mitigationCalculator`、`simulate`、placement、资源模型等计算路径；移动 / 增删阶段不得连带改动伤害事件、cast、备注（设计 §2 反目标）。
- 不为阶段新增 PropertyPanel（设计 §2 反目标）。
- i18n：新增 UI 文案 key **只写入 `src/i18n/locales/zh-CN/`**，其余语言由 Crowdin 回流。唯一例外见 Task 4：为了让静态 import 能编译，需为每种语言建一个**空的** `encounter.json`（`{}`），不写任何译文。插值一律 ICU 单花括号 `{name}`。
- 阶段名对照表**本计划只建机制和空表**，不填任何游戏内译名（`AGENTS.md`：游戏数据须先在 ffxiv-datamining-mixed 核实，不可凭记忆）。
- Konva：`shadowEnabled={false}`、`perfectDrawEnabled={false}`；**不新增 Layer**（固定区 Stage 现有 2 个、技能轨 Stage 现有 3 个，均已到约定上限附近）。
- 编辑文档后运行 `node scripts/enforce-docs-paths.mjs <文件...>` 与 `node scripts/check-local-paths.mjs <文件...>`。
- 每个 task 结束前跑 `pnpm exec tsc --noEmit` 与该 task 涉及的测试；声称完成前跑 `pnpm test:run`、`pnpm lint`、`pnpm build`。

---

## File Structure

**新建：**

| 文件                                        | 职责                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/constants/timeline.ts`                 | 无依赖的 `TIMELINE_START_TIME`（供 Worker / 纯函数引用，原 Timeline/constants 改为转出） |
| `src/utils/timelinePhases.ts`               | 阶段纯逻辑：排序、配色、短标签、当前阶段、钳制、默认名、导入去重、刻度遮挡判定           |
| `src/utils/timelinePhases.test.ts`          | 上述纯逻辑单测                                                                           |
| `src/utils/phaseNames.ts`                   | 阶段名翻译纯函数 + `RawPhase[] → TimelinePhase[]`，前端与 Worker 共用                    |
| `src/utils/phaseNames.test.ts`              | 翻译命中 / 未命中 / 空串回退                                                             |
| `src/i18n/locales/*/encounter.json`         | 阶段名对照表（zh-CN 源；其余语言为空 `{}` 占位）                                         |
| `src/components/Timeline/PhaseBands.tsx`    | Konva：阶段竖线 + 200px 渐变（无交互，多处复用）                                         |
| `src/components/Timeline/PhaseLabels.tsx`   | Konva：标尺上的阶段名 / 选中标签、悬停、拖动、双击、右键                                 |
| `src/components/PhaseDeleteConfirm.tsx`     | 删除确认 Popover（锚定任意屏幕矩形，三个视图共用）                                       |
| `src/components/PhaseNavigator.tsx`         | 工具栏最右端的阶段跳转入口 + 下拉菜单                                                    |
| `src/components/TimelineTable/PhaseRow.tsx` | 表格阶段分隔行（吸顶、改时间、改名、右键）                                               |
| `docs/howto/timeline-phases.md`             | 公开文档：阶段用法                                                                       |

**修改（按 Task 顺序）：**

| 文件                                                                                                                                                      | 改动                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/components/Timeline/constants.ts`                                                                                                                    | `TIMELINE_START_TIME` 改为从 `@/constants/timeline` 转出                 |
| `src/constants/limits.ts`                                                                                                                                 | `PHASE_NAME_MAX_LENGTH = 50`                                             |
| `src/types/timeline.ts`                                                                                                                                   | `TimelinePhase`、`RawPhase`、`Timeline.phases?`                          |
| `src/types/timelineV2.ts` / `src/utils/timelineFormat.ts`                                                                                                 | `V2Phase`、`V2Timeline.ph?`，`toV2` / `hydrateFromV2`                    |
| `src/collab/constants.ts` / `docSchema.ts` / `SyncEngine.ts`                                                                                              | `Y_MAP.phases`、buildYDoc / projectTimeline / mutators、UndoManager 跟踪 |
| `src/collab/migration.ts` / `timelineToLocalInit.ts`                                                                                                      | 搬运 phases                                                              |
| `src/workers/routes/internalMigrate.ts`                                                                                                                   | 投影带 phases                                                            |
| `src/store/timelineStore.ts`                                                                                                                              | 阶段 CRUD、选中互斥、视口锚点时间、滚动请求                              |
| `src/i18n/index.ts`                                                                                                                                       | lazy glob 排除 `encounter.json`                                          |
| `src/types/fflogs.ts` / `src/workers/fflogsClientV2.ts`                                                                                                   | GraphQL 追加 phaseTransitions / phases，类型与映射                       |
| `src/utils/fflogsImporter.ts` / `src/workers/routes/fflogs.ts`                                                                                            | `parseFightPhases`；导入写 `timeline.phases`                             |
| `src/workers/top100Sync.ts` / `encounterTemplate.ts` / `routes/encounterTemplates.ts`                                                                     | 采样带阶段、模板存阶段、覆盖规则、响应带阶段                             |
| `src/types/apiContracts.ts`                                                                                                                               | `EncounterTemplateResponse.phases`                                       |
| `src/utils/timelineStorage.ts` / `src/components/CreateTimelineDialog.tsx`                                                                                | 模板建轴时翻译并写入 phases                                              |
| `src/components/Timeline/index.tsx` / `TimeRuler.tsx` / `DamageEventTrack.tsx` / `HpCurveTrack.tsx` / `SkillTracksCanvas.tsx` / `TimelineContextMenu.tsx` | 主时间轴显示与编辑                                                       |
| `src/components/Timeline/TimelineMinimap.tsx`                                                                                                             | 缩略图阶段渐变 + 短标签                                                  |
| `src/components/EditorToolbar.tsx`                                                                                                                        | 左侧按钮区独立滚动 + 渐隐，右端挂 PhaseNavigator                         |
| `src/utils/tableRows.ts` / `src/components/TimelineTable/index.tsx` / `TableDataRow.tsx`                                                                  | 阶段行、伤害行右键「在此行前添加阶段」、阅读位置上报、跳转               |
| `src/i18n/locales/zh-CN/editor.json`                                                                                                                      | 全部新增 UI 文案                                                         |
| `docs/tutorial.md`、`docs/howto/index.md`、`docs/.vitepress/config.*`                                                                                     | 文档入口                                                                 |

---

## Task 1: 阶段类型与纯逻辑模块

**Files:**

- Create: `src/constants/timeline.ts`
- Modify: `src/components/Timeline/constants.ts`
- Modify: `src/constants/limits.ts`
- Modify: `src/types/timeline.ts`
- Create: `src/utils/timelinePhases.ts`
- Test: `src/utils/timelinePhases.test.ts`

**Interfaces:**

- Produces:
  - `TIMELINE_START_TIME`（`@/constants/timeline`，值 `-30`；`@/components/Timeline/constants` 继续转出同名常量，现有引用不变）
  - `PHASE_NAME_MAX_LENGTH = 50`（`@/constants/limits`）
  - `interface TimelinePhase { id: string; name: string; time: number }`、`interface RawPhase { fflogsPhaseId: number; name: string; time: number }`、`Timeline.phases?: TimelinePhase[]`（`@/types/timeline`）
  - `@/utils/timelinePhases`：`PHASE_COLORS`、`PHASE_MIN_GAP`、`PHASE_VIEW_OFFSET_PX`、`sortPhases`、`phaseColor`、`shortPhaseLabel`、`currentPhaseIndex`、`clampPhaseTime`、`defaultPhaseName`、`normalizeRawPhases`、`rangesOverlap`

- [ ] **Step 1: 抽出无依赖的时间轴起点常量**

`src/components/Timeline/constants.ts` 顶部 import 了 `useUIStore`，Worker 与纯函数不能引用它。新建 `src/constants/timeline.ts`：

```ts
/** 时间轴起点（秒），允许展示战斗开始前的 prepull 阶段 */
export const TIMELINE_START_TIME = -30
```

`src/components/Timeline/constants.ts` 中删除原定义，改为：

```ts
export { TIMELINE_START_TIME } from '@/constants/timeline'
```

（`src/utils/timelineClipboard.ts` 等现有引用不改。）

`src/constants/limits.ts` 末尾追加：

```ts
export const PHASE_NAME_MAX_LENGTH = 50
```

- [ ] **Step 2: 定义类型**

`src/types/timeline.ts`：在 `Timeline` 接口的 `annotations` 之后追加：

```ts
  /** 阶段标记（纯展示 / 导航，不参与计算）；存量时间轴无此字段 = 无阶段 */
  phases?: TimelinePhase[]
```

在 `Annotation` 定义之后追加：

```ts
/**
 * 时间轴阶段标记（纯展示 / 导航用，不参与计算）。
 * 无序号字段：P1、P2 等完全由 name 承载；颜色与顺序按 time 排序后的位置推导，不存储。
 */
export interface TimelinePhase {
  id: string
  /** 自由文本，完整显示名，如 "P3: Exdeath and Chaos"、"P4.5"、"转场" */
  name: string
  /** 开始时间（秒），与 DamageEvent.time 同口径（相对 resolveFightStartTime 零点，可为负） */
  time: number
}

/**
 * 未翻译的 FFLogs 阶段数据。导入解析与副本模板（KV）共用；
 * 翻译推迟到写入时间轴那一刻（见 utils/phaseNames.ts）。
 */
export interface RawPhase {
  /** FFLogs report.phases[].phases[].id */
  fflogsPhaseId: number
  /** FFLogs 原文（只有英文） */
  name: string
  /** 开始时间（秒），与 DamageEvent.time 同口径 */
  time: number
}
```

- [ ] **Step 3: 写纯逻辑单测（先红）**

`src/utils/timelinePhases.test.ts` 覆盖下列用例（用 `describe` 按函数分组）：

- `sortPhases`：按 `time` 升序；同 `time` 按 `id` 字典序（结果确定）；不修改入参。
- `phaseColor`：下标 0..6 依次为 `#6b7280 #22c55e #3b82f6 #a855f7 #f97316 #ec4899 #ca8a04`，下标 7 回到 `#6b7280`。
- `shortPhaseLabel`：`'P3: Exdeath and Chaos'` → `'P3'`；`'P3：艾克斯迪司'` → `'P3'`（全角冒号）；`'Garuda'` → `'Garuda'`；`'Intermission'`（无冒号、12 字）→ `'Interm…'`；`': abc'`（冒号在首位）按无冒号处理；含代理对的名字按字符而非 UTF-16 单元截断。
- `currentPhaseIndex`：空数组 → `-1`；时间早于第一阶段 → `-1`；恰等于某阶段开始 → 该阶段；两阶段之间 → 前一个。
- `clampPhaseTime`：
  - 移动已有阶段：下限 `prev.time + 1`（无 prev 时 `TIMELINE_START_TIME`），上限 `next.time - 1`（无 next 时不限）；结果四舍五入到 0.1；返回 `{ time, clamped }`，越界时 `clamped: true`。
  - 新增（`phaseId` 传 `null`）：按插入位置找相邻阶段，同样钳制。落在某阶段之后 1 秒内（含恰好相等）→ 钳到该阶段 +1；落在某阶段之前 1 秒内 → 钳到该阶段 −1。
  - 相邻两阶段间距 < 2 秒、无合法位置时返回 `null`。
- `defaultPhaseName`：已有 `[P1@0, P2@100]`，在 50 处插入 → `'P2'`；在 200 处 → `'P3'`；空数组 → `'P1'`。
- `normalizeRawPhases`：按时间排序；时间差 < 1 秒的相邻项只留**后一个**（DSR 样本：P1/P2 都在 0.0 → 只留 P2）；早于 `-30` 的钳到 `-30`（先钳制后去重）；空数组 → 空数组。
- `rangesOverlap`：`[0,10]` 与 `[10,20]` 不重叠（端点相接不算），`[0,10]` 与 `[9,20]` 重叠。

- [ ] **Step 4: 实现 `src/utils/timelinePhases.ts`**

```ts
/**
 * 时间轴阶段纯逻辑。
 *
 * 阶段只是时间标记：本模块不读写 store、不依赖 React / Konva，Worker 与前端共用。
 * 颜色、顺序都不存储，统一由「按 time 排序后的位置」推导（设计 §4.1、§6.1）。
 */

import type { RawPhase, TimelinePhase } from '@/types/timeline'
import { TIMELINE_START_TIME } from '@/constants/timeline'

/** 7 色循环：灰、绿、蓝、紫、橙、粉、金（设计 §6.1） */
export const PHASE_COLORS = [
  '#6b7280',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#f97316',
  '#ec4899',
  '#ca8a04',
] as const

/** 相邻阶段的最小间隔（秒）；导入去重也用此阈值 */
export const PHASE_MIN_GAP = 1

/** 跳转后阶段起点距视口左缘的偏移（px），也是「当前所在阶段」的判定点（设计 §6.4） */
export const PHASE_VIEW_OFFSET_PX = 40

const SHORT_LABEL_MAX_CHARS = 6

const round1 = (t: number) => Math.round(t * 10) / 10

export function sortPhases(phases: readonly TimelinePhase[]): TimelinePhase[] {
  return [...phases].sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function phaseColor(sortedIndex: number): string {
  return PHASE_COLORS[sortedIndex % PHASE_COLORS.length]
}

/** 缩略图 / 窄工具栏用的短标签：有冒号取冒号前，否则取前 6 个字符 */
export function shortPhaseLabel(name: string): string {
  const idx = name.search(/[:：]/)
  if (idx > 0) return name.slice(0, idx).trim()
  const chars = Array.from(name)
  return chars.length > SHORT_LABEL_MAX_CHARS
    ? chars.slice(0, SHORT_LABEL_MAX_CHARS).join('') + '…'
    : name
}

/** 开始时间 ≤ time 的最后一个阶段下标；早于第一个阶段（或无阶段）返回 -1 */
export function currentPhaseIndex(sorted: readonly TimelinePhase[], time: number): number {
  let result = -1
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].time <= time) result = i
    else break
  }
  return result
}

/**
 * 把阶段时间钳到相邻阶段之间（至少相隔 PHASE_MIN_GAP），下限 TIMELINE_START_TIME。
 * phaseId 为 null 表示「新增」，按插入位置找相邻阶段。无合法位置返回 null。
 */
export function clampPhaseTime(
  sorted: readonly TimelinePhase[],
  phaseId: string | null,
  time: number
): { time: number; clamped: boolean } | null {
  const others = sorted.filter(p => p.id !== phaseId)
  const prev = [...others].reverse().find(p => p.time <= time)
  const next = others.find(p => p.time > time)
  const lower = prev ? prev.time + PHASE_MIN_GAP : TIMELINE_START_TIME
  const upper = next ? next.time - PHASE_MIN_GAP : Infinity
  // 两侧相邻阶段间距不足 2 × PHASE_MIN_GAP：无合法位置，由调用方提示
  if (lower > upper) return null
  const clampedTime = round1(Math.min(upper, Math.max(lower, time)))
  return { time: clampedTime, clamped: clampedTime !== round1(time) }
}

/** 新增阶段的默认名：P{插入后的序号}（设计 §7） */
export function defaultPhaseName(sorted: readonly TimelinePhase[], time: number): string {
  return `P${sorted.filter(p => p.time < time).length + 1}`
}

/**
 * 导入数据规整（设计 §5.1 第 3、4 条）：
 * 先把早于时间轴起点的钳到起点，再按时间排序，相邻差 < PHASE_MIN_GAP 的只留后一个
 * （同一时刻多个 transition 时，较晚出现的才是实际生效的阶段）。
 */
export function normalizeRawPhases(raw: readonly RawPhase[]): RawPhase[] {
  const sorted = raw
    .map(p => ({ ...p, time: Math.max(TIMELINE_START_TIME, p.time) }))
    .sort((a, b) => a.time - b.time) // Array.prototype.sort 稳定：同时刻保持 FFLogs 给出的先后
  const out: RawPhase[] = []
  for (const p of sorted) {
    const last = out[out.length - 1]
    if (last && p.time - last.time < PHASE_MIN_GAP) out[out.length - 1] = p
    else out.push(p)
  }
  return out
}

/** 开区间重叠判定（端点相接不算重叠），用于标尺刻度遮挡 */
export function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1]
}
```

- [ ] **Step 5: 运行测试**

Run: `pnpm test:run src/utils/timelinePhases.test.ts`
Expected: PASS

- [ ] **Step 6: 类型检查并提交**

Run: `pnpm exec tsc --noEmit`

```bash
git add src/constants/timeline.ts src/components/Timeline/constants.ts src/constants/limits.ts src/types/timeline.ts src/utils/timelinePhases.ts src/utils/timelinePhases.test.ts
git commit -m "feat(phase): 新增阶段类型与纯逻辑模块"
```

---

## Task 2: 持久化与协作文档

**Files:**

- Modify: `src/types/timelineV2.ts`、`src/utils/timelineFormat.ts`
- Modify: `src/collab/constants.ts`、`src/collab/docSchema.ts`、`src/collab/SyncEngine.ts`
- Modify: `src/collab/migration.ts`、`src/collab/timelineToLocalInit.ts`、`src/workers/routes/internalMigrate.ts`
- Test: `src/utils/timelineFormat.test.ts`、`src/collab/docSchema.test.ts`、`src/collab/SyncEngine.test.ts`、`src/collab/timelineToLocalInit.test.ts`

**Interfaces:**

- Consumes: `TimelinePhase`（Task 1）
- Produces:
  - `interface V2Phase { n: string; t: number }`、`V2Timeline.ph?: V2Phase[]`
  - `Y_MAP.phases = 'phases'`
  - `yAddPhase(doc, phase)`、`yUpdatePhase(doc, id, patch: Partial<Pick<TimelinePhase, 'name' | 'time'>>)`、`yRemovePhase(doc, id)`（`@/collab/docSchema`）
  - `projectTimeline` 产出 `phases`（按 time 排序，无阶段时为 `[]`）

- [ ] **Step 1: 写失败测试**

- `timelineFormat.test.ts`：
  - 带 `phases: [{ id:'a', name:'P1', time:-5 }, { id:'b', name:'P2: X', time:120.5 }]` 的 timeline 经 `toV2` 得到 `ph: [{ n:'P1', t:-5 }, { n:'P2: X', t:120.5 }]`（按时间排序输出）；`hydrateFromV2` 回来 name / time 一致、id 为新生成的非空字符串。
  - `phases` 缺席或为空数组时 `toV2` 不产出 `ph` 字段。
  - 无 `ph` 的 V2 hydrate 后 `phases` 为 `[]`。
  - V1 迁移（`migrateV1ToV2`）不产出 `ph`。
- `docSchema.test.ts`：
  - `buildYDoc` 带 phases → `projectTimeline` 投影出等值 phases（按 time 排序）。
  - `yAddPhase` / `yUpdatePhase`（只改 name、只改 time）/ `yRemovePhase` 的投影结果。
  - `yUpdatePhase` 对不存在的 id 是 no-op。
  - 投影的引用保持：未变化的 phase 复用 prev 对象（与 annotations 同测法）。
- `SyncEngine.test.ts`：`yAddPhase` 后 `undo` 投影回无阶段；`redo` 恢复。
- `timelineToLocalInit.test.ts`：phases 被搬运。

Run: `pnpm test:run src/utils/timelineFormat.test.ts src/collab`
Expected: FAIL

- [ ] **Step 2: V2 格式**

`src/types/timelineV2.ts`：在 `V2SyncEvent` 之后追加：

```ts
/** 阶段标记；id 不持久化，读入时重生成（同 V2Annotation） */
export interface V2Phase {
  /** name */
  n: string
  /** time（秒） */
  t: number
}
```

`V2Timeline` 中 `se?` 之后追加：

```ts
  /** phases（阶段标记）；缺席 = 无阶段 */
  ph?: V2Phase[]
```

`src/utils/timelineFormat.ts`：

- `toV2` 中 `se` 之后：

```ts
const ph = sortPhases(timeline.phases ?? []).map((p): V2Phase => ({ n: p.name, t: p.time }))
if (ph.length > 0) out.ph = ph
```

- `hydrateFromV2` 的 `base` 中 `annotations` 之后：

```ts
    phases: (v2.ph ?? []).map((p): TimelinePhase => ({ id: generateObjectId(), name: p.n, time: p.t })),
```

- 补齐 import（`TimelinePhase`、`V2Phase`、`sortPhases`）。`migrateV1ToV2` 不改。

- [ ] **Step 3: Y.Doc 结构与 mutator**

`src/collab/constants.ts` 的 `Y_MAP` 中 `annotations` 之后追加 `phases: 'phases',`。

`src/collab/docSchema.ts`：

- `buildYDoc` 中 annotations 之后：

```ts
const ph = doc.getMap<Y.Map<unknown>>(Y_MAP.phases)
for (const p of content.phases ?? []) {
  ph.set(p.id, entryToYMap(p as unknown as Record<string, unknown>))
}
```

- 在 Annotation mutators 之后新增：

```ts
// Phase mutators（阶段只挪自己：不得级联改动其他集合）

export function yAddPhase(doc: Y.Doc, phase: TimelinePhase): void {
  doc.transact(() => {
    mapOf(doc, Y_MAP.phases).set(phase.id, entryToYMap(phase as unknown as Record<string, unknown>))
  }, LOCAL_ORIGIN)
}

export function yUpdatePhase(
  doc: Y.Doc,
  id: string,
  patch: Partial<Pick<TimelinePhase, 'name' | 'time'>>
): void {
  doc.transact(() => {
    const ymap = mapOf(doc, Y_MAP.phases).get(id)
    if (!ymap) return
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) ymap.set(k, v)
    }
  }, LOCAL_ORIGIN)
}

export function yRemovePhase(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    mapOf(doc, Y_MAP.phases).delete(id)
  }, LOCAL_ORIGIN)
}
```

- `projectTimeline` 中 annotations 之后：

```ts
const phases = sortPhases(
  projectCollection<TimelinePhase>(
    doc.getMap<Y.Map<unknown>>(Y_MAP.phases).values(),
    indexById(prev?.phases)
  )
)
```

返回对象中 `annotations,` 之后加 `phases,`。补齐 import。

`src/collab/SyncEngine.ts`：UndoManager 跟踪列表中 `Y_MAP.annotations` 之后加 `Y_MAP.phases`。

- [ ] **Step 4: 搬运路径**

- `src/collab/migration.ts`：`content` 构造处在 `annotations: t.annotations,` 之后加 `...(t.phases !== undefined ? { phases: t.phases } : {}),`（或与该文件现有可选字段写法保持一致）。
- `src/collab/timelineToLocalInit.ts`：`annotations` 之后加 `phases: timeline.phases ?? [],`。
- `src/workers/routes/internalMigrate.ts`：投影中加 `...(timeline.phases !== undefined ? { phases: timeline.phases } : {}),`。
- 用 `Grep` 搜 `annotations:` 与 `syncEvents` 在 `src/` 非测试文件中的出现点，逐一确认是否还有「整体搬运时间轴字段」却漏了 phases 的位置（`src/api/timelineShareApi.ts` 的 snapshot 读取因 phases 为可选字段可不改；若该处显式列字段则补上）。**不要**改 `timelineClipboard`、`exportExcel`、`soumaExporter`、`ImportIntoTimelineDialog`（设计 §2 非目标）。

- [ ] **Step 5: 运行测试**

Run: `pnpm test:run src/utils/timelineFormat.test.ts src/collab src/workers/routes`
Expected: PASS

- [ ] **Step 6: 类型检查并提交**

Run: `pnpm exec tsc --noEmit`

```bash
git add src/types/timelineV2.ts src/utils/timelineFormat.ts src/utils/timelineFormat.test.ts src/collab src/workers/routes/internalMigrate.ts
git commit -m "feat(phase): 阶段接入 V2 持久化与协作文档"
```

---

## Task 3: Store 阶段操作、选中互斥、视口锚点与滚动请求

**Files:**

- Modify: `src/store/timelineStore.ts`
- Test: `src/store/timelineStore.test.ts`

**Interfaces:**

- Consumes: `yAddPhase` / `yUpdatePhase` / `yRemovePhase`（Task 2）
- Produces（`useTimelineStore`）：
  - `selectedPhaseId: string | null`；`selectPhase(id: string | null): void`
  - `addPhase(phase: TimelinePhase): void`、`updatePhase(id, patch: Partial<Pick<TimelinePhase,'name'|'time'>>): void`、`removePhase(id): void`
  - `viewAnchorTime: number | null`；`setViewAnchorTime(time: number | null): void` —— 当前活动视图的「阅读位置」时间（秒），由时间轴视图 / 表格视图写入，工具栏据此判定当前阶段
  - `scrollToTimeRequest: { time: number; seq: number } | null`；`requestScrollToTime(time: number): void` —— 跳转请求，`seq` 自增保证同一时间重复点击也能触发

- [ ] **Step 1: 写失败测试**

在 `timelineStore.test.ts` 新增 `describe('phases')`（沿用该文件已有的 engine 初始化 helper）：

- `addPhase` 后 `timeline.phases` 含该阶段；`updatePhase` 改名 / 改时间生效；`removePhase` 后消失。
- `removePhase` 删除当前选中阶段时 `selectedPhaseId` 归 `null`。
- 选中互斥：`selectPhase('x')` 会清空 `selectedEventIds / selectedCastEventIds / selectedAnnotationIds`；之后 `setSelection({ eventIds: ['e'] })` 会把 `selectedPhaseId` 置 `null`；`clearSelection()` 同样置 `null`。
- `addPhase` 不改动 damageEvents / castEvents / annotations（取前后快照比较）。
- `requestScrollToTime(10)` 两次，`seq` 递增。
- `reset()` / 切文档后 `selectedPhaseId` 归 `null`（加入该文件现有的「文档级状态重置」对象）。

Run: `pnpm test:run src/store/timelineStore.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现**

- 在 state 接口与初始值中加入上述字段；`selectedPhaseId: null` 同时加进「切文档要重置的状态」对象（第 260 行附近，与 `selectedAnnotationIds` 并列）。`viewAnchorTime` / `scrollToTimeRequest` 属于视口态，**不**加入该重置对象（与 zoomLevel 一致：切文档保留视口）。
- `setSelection` 的 `set({...})` 中加 `selectedPhaseId: null`。
- `selectPhase`：

```ts
    selectPhase: id => {
      // 阶段选中与事件 / 技能 / 框选互斥（设计 §7）：先清空其他选中，再单独记录阶段
      get().setSelection({})
      set({ selectedPhaseId: id })
    },
```

- `addPhase` / `updatePhase` / `removePhase` 仿照 `addAnnotation` 系列（`const engine = get().engine; if (!engine) return; y...`）；`removePhase` 在删除选中阶段时 `set({ selectedPhaseId: null })`。
- `requestScrollToTime: time => set(s => ({ scrollToTimeRequest: { time, seq: (s.scrollToTimeRequest?.seq ?? 0) + 1 } }))`。

- [ ] **Step 3: 运行测试、类型检查、提交**

Run: `pnpm test:run src/store/timelineStore.test.ts` → PASS；`pnpm exec tsc --noEmit`

```bash
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "feat(phase): store 新增阶段增删改、选中互斥与跳转请求"
```

---

## Task 4: 阶段名对照表与翻译函数

**Files:**

- Create: `src/i18n/locales/{zh-CN,zh-TW,ja,en,de,fr}/encounter.json`
- Modify: `src/i18n/index.ts`
- Create: `src/utils/phaseNames.ts`
- Test: `src/utils/phaseNames.test.ts`

**Interfaces:**

- Consumes: `RawPhase`、`TimelinePhase`（Task 1），`AppLanguage`（`@/types/i18n`）
- Produces（`@/utils/phaseNames`）：
  - `translatePhaseName(encounterId: number, fflogsPhaseId: number, rawName: string, lang: AppLanguage): string`
  - `rawPhasesToTimelinePhases(raw: readonly RawPhase[], encounterId: number, lang: AppLanguage, genId: () => string): TimelinePhase[]`

**说明（设计 §5.3 的实施选择）：**

- 对照表 key：命名空间 `encounter`，key `phase.e{encounterId}.p{fflogsPhaseId}`；因 `keySeparator: '.'`，JSON 为嵌套结构 `{ "phase": { "e1085": { "p3": "…" } } }`。
- **不经过 i18next 运行时查表**：i18next 在当前语言值为空时会回退 zh-CN（`fallbackLng`），而设计要求「查不到或空串 → 保留 FFLogs 原文」——英文用户看到英文原文比看到中文译名更合理。所以用纯函数直接读 JSON。
- 前端与 Worker 都静态 import 6 份 JSON（目前全为空表，体积可忽略；表变大后再评估拆分）。
- 只为 `AppLanguage` 的 6 种语言建文件；`ko-KR` 目录不在 `AppLanguage` 内，不建。

- [ ] **Step 1: 建对照表文件**

六个文件内容都为：

```json
{}
```

在 `src/i18n/index.ts` 的 `lazyCatalogs` glob 中追加排除项，避免同一文件既被静态 import 又被拆成懒加载 chunk：

```ts
const lazyCatalogs = import.meta.glob<{ default: Record<string, unknown> }>([
  './locales/*/*.json',
  '!./locales/zh-CN/*.json',
  // 阶段名对照表由 utils/phaseNames.ts 静态引入，不走 i18next 懒加载
  '!./locales/*/encounter.json',
])
```

确认 `crowdin.yml`（`/src/i18n/locales/zh-CN/*.json`）会自动收录新文件，无需改配置。

- [ ] **Step 2: 写失败测试**

`src/utils/phaseNames.test.ts`：用 `vi.mock` 替换 JSON 模块内容（或把查表数据源做成可注入参数，见 Step 3 的内部函数），覆盖：

- 命中：zh-CN 表有 `phase.e1085.p3 = 'P3：测试名'` → 返回该值（测试数据用明显的占位字符串，**不要**写真实游戏译名）。
- 未命中 key → 返回 `rawName`。
- 值为空串或纯空白 → 返回 `rawName`。
- 当前语言为空、zh-CN 有值 → 仍返回 `rawName`（不回退到 zh-CN）。
- `rawPhasesToTimelinePhases`：逐个翻译、用 `genId` 生成 id、保持输入顺序与 time。

- [ ] **Step 3: 实现 `src/utils/phaseNames.ts`**

```ts
/**
 * 阶段名翻译（设计 §5.3）：导入 / 建轴那一刻按导入者语言查表，结果作为普通文本存入时间轴。
 *
 * 对照表是 Crowdin 维护的 encounter 命名空间（key: phase.e{encounterId}.p{fflogsPhaseId}）。
 * 不走 i18next：它会把空值回退到 zh-CN，而这里要求查不到 / 空串时保留 FFLogs 原文。
 * 前端（模板建轴）与 Worker（FFLogs 导入）共用本模块，保证两条路径结果一致。
 */

import type { AppLanguage } from '@/types/i18n'
import type { RawPhase, TimelinePhase } from '@/types/timeline'
import zhCN from '@/i18n/locales/zh-CN/encounter.json'
import zhTW from '@/i18n/locales/zh-TW/encounter.json'
import ja from '@/i18n/locales/ja/encounter.json'
import en from '@/i18n/locales/en/encounter.json'
import de from '@/i18n/locales/de/encounter.json'
import fr from '@/i18n/locales/fr/encounter.json'

interface EncounterTable {
  phase?: Record<string, Record<string, string> | undefined>
}

const TABLES: Record<AppLanguage, EncounterTable> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ja,
  en,
  de,
  fr,
}

export function translatePhaseName(
  encounterId: number,
  fflogsPhaseId: number,
  rawName: string,
  lang: AppLanguage
): string {
  const value = TABLES[lang]?.phase?.[`e${encounterId}`]?.[`p${fflogsPhaseId}`]
  return typeof value === 'string' && value.trim() !== '' ? value : rawName
}

export function rawPhasesToTimelinePhases(
  raw: readonly RawPhase[],
  encounterId: number,
  lang: AppLanguage,
  genId: () => string
): TimelinePhase[] {
  return raw.map(p => ({
    id: genId(),
    name: translatePhaseName(encounterId, p.fflogsPhaseId, p.name, lang),
    time: p.time,
  }))
}
```

（空 JSON `{}` 的推断类型与 `EncounterTable` 兼容；若 tsc 报错，在 import 处断言为 `EncounterTable`。）

- [ ] **Step 4: 验证 Worker 打包能处理 JSON import**

Run: `pnpm exec wrangler deploy --dry-run --outdir "<scratchpad>/wrangler-dry-run" --config wrangler.toml --env production`
Expected: 打包成功（此时 Worker 还未引用 phaseNames，Task 5 完成后需再跑一次）。

- [ ] **Step 5: 测试、类型检查、提交**

Run: `pnpm test:run src/utils/phaseNames.test.ts src/i18n` → PASS；`pnpm exec tsc --noEmit`

```bash
git add src/i18n src/utils/phaseNames.ts src/utils/phaseNames.test.ts
git commit -m "feat(phase): 新增阶段名对照表与翻译函数"
```

---

## Task 5: FFLogs 导入带入阶段

**Files:**

- Modify: `src/types/fflogs.ts`、`src/workers/fflogsClientV2.ts`
- Modify: `src/utils/fflogsImporter.ts`
- Modify: `src/workers/routes/fflogs.ts`
- Test: `src/workers/fflogsClientV2.test.ts`、`src/utils/fflogsImporter.test.ts`、`src/workers/fflogsImportRoute.test.ts`

**Interfaces:**

- Produces:
  - `FFLogsFight.phaseTransitions?: { id: number; startTime: number }[]`
  - `FFLogsReport.phases?: { encounterID: number; phases: { id: number; name: string; isIntermission?: boolean }[] }[]`
  - `parseFightPhases(report: FFLogsReport, fight: FFLogsFight, fightStartTime: number): RawPhase[]`（`@/utils/fflogsImporter`，已规整：排序、去重、钳制）
  - `FightImportResult.phases: RawPhase[]`

- [ ] **Step 1: 写失败测试**

- `fflogsClientV2.test.ts`：`mapV2ReportToReport` 把 payload 中的 `fights[].phaseTransitions` 与 `phases` 映射到 `FFLogsReport`；payload 缺这两个字段时输出也缺（`undefined`），不抛错。
- `fflogsImporter.test.ts` 新增 `describe('parseFightPhases')`：
  - transition `startTime` 按 `(startTime - fightStartTime) / 1000` 换算成秒。
  - 只取 `encounterID === fight.encounterID` 的名称表；其他 encounter 的同 id 名称不被使用。
  - 名称表查不到该 id → 跳过该 transition。
  - DSR 形态：两个 transition 同为 fight 开始 → 只留后一个。
  - 无 `phaseTransitions` 或无 `phases` → 返回 `[]`。
  - `parseFightImport` 的结果含 `phases`，且与伤害事件同零点（构造一个 limitbreakupdate 早于 fight.startTime 的样例，断言阶段时间随 `resolveFightStartTime` 平移）。
- `fflogsImportRoute.test.ts`：mock 的 report 带阶段时，响应 V2 带 `ph`，且 name 走 `translatePhaseName`（空表下等于原文）；无阶段时响应无 `ph`。

Run: `pnpm test:run src/workers/fflogsClientV2.test.ts src/utils/fflogsImporter.test.ts src/workers/fflogsImportRoute.test.ts`
Expected: FAIL

- [ ] **Step 2: GraphQL 与类型**

`src/types/fflogs.ts`：

```ts
// FFLogsFight 末尾
  /** 阶段切换点（startTime 为报告相对毫秒，与事件同基准）；单阶段副本缺席 */
  phaseTransitions?: { id: number; startTime: number }[]
```

```ts
// FFLogsReport 末尾
  /** 各 encounter 的阶段名称表（只有英文） */
  phases?: {
    encounterID: number
    phases: { id: number; name: string; isIntermission?: boolean }[]
  }[]
```

`src/workers/fflogsClientV2.ts`：

- `getReport` 的查询中 `fights { … gameZone { id } }` 内追加 `phaseTransitions { id startTime }`；与 `fights` 同级追加：

```graphql
            phases {
              encounterID
              phases {
                id
                name
                isIntermission
              }
            }
```

- `FFLogsV2Fight` 类型与 `V2ReportPayload` 同步加可选字段；`mapV2ReportToReport` 透传：fight 映射中 `...(fight.phaseTransitions ? { phaseTransitions: fight.phaseTransitions } : {})`，report 级 `...(report.phases ? { phases: report.phases } : {})`。
- 注意：`getReport` 也被 `/api/fflogs/report/:code`（前端导入对话框）与 TOP100 采样复用，新增字段为可选，对它们无副作用。

- [ ] **Step 3: 解析**

`src/utils/fflogsImporter.ts` 新增（放在 `parseSyncEvents` 之后）：

```ts
/**
 * 解析单场 fight 的阶段切换为未翻译的 RawPhase（设计 §5.1）。
 * 时间零点与伤害事件相同（fightStartTime 由调用方用 resolveFightStartTime 求得）。
 * 名称表按 encounterID 匹配；查不到名称的 transition 跳过。
 */
export function parseFightPhases(
  report: FFLogsReport,
  fight: FFLogsFight,
  fightStartTime: number
): RawPhase[] {
  const transitions = fight.phaseTransitions ?? []
  if (transitions.length === 0) return []
  const names = new Map(
    (report.phases ?? [])
      .find(g => g.encounterID === fight.encounterID)
      ?.phases.map(p => [p.id, p.name] as const) ?? []
  )
  const raw: RawPhase[] = []
  for (const tr of transitions) {
    const name = names.get(tr.id)
    if (name === undefined) continue
    raw.push({ fflogsPhaseId: tr.id, name, time: (tr.startTime - fightStartTime) / 1000 })
  }
  return normalizeRawPhases(raw)
}
```

`FightImportResult` 加 `phases: RawPhase[]`；`parseFightImport` 末尾计算 `const phases = parseFightPhases(report, fight, fightStartTime)` 并返回。`src/utils/devClientImport.ts`（dev-only 前端直连路径）解构处不用 phases，保持不变即可（其前端 report 查询不含阶段字段，结果为空）。

- [ ] **Step 4: 导入路由写入 phases**

`src/workers/routes/fflogs.ts`：

```ts
    const { composition, playerMap, damageEvents, castEvents, syncEvents, phases } =
      parseFightImport(report, fight, events)
    // …
    const timelinePhases = rawPhasesToTimelinePhases(
      phases,
      fight.encounterID || 0,
      c.get('lang'),
      generateObjectId
    )
    // timeline 对象中 annotations 之后：
      ...(timelinePhases.length > 0 ? { phases: timelinePhases } : {}),
```

（`generateObjectId` from `@/utils/shortId`；id 在 V2 序列化时本就丢弃，这里只为满足类型。）

- [ ] **Step 5: 测试、Worker 打包、类型检查、提交**

Run: `pnpm test:run src/workers src/utils/fflogsImporter.test.ts` → PASS
Run: Task 4 Step 4 的 wrangler dry-run → 打包成功
Run: `pnpm exec tsc --noEmit`

```bash
git add src/types/fflogs.ts src/workers/fflogsClientV2.ts src/workers/fflogsClientV2.test.ts src/utils/fflogsImporter.ts src/utils/fflogsImporter.test.ts src/workers/routes/fflogs.ts src/workers/fflogsImportRoute.test.ts
git commit -m "feat(phase): FFLogs 导入解析阶段并按请求语言翻译"
```

---

## Task 6: 副本模板存阶段并在建轴时带入

**Files:**

- Modify: `src/workers/top100Sync.ts`、`src/workers/encounterTemplate.ts`、`src/workers/routes/encounterTemplates.ts`
- Modify: `src/types/apiContracts.ts`
- Modify: `src/utils/timelineStorage.ts`、`src/components/CreateTimelineDialog.tsx`
- Test: `src/workers/encounterTemplate.test.ts`、`src/workers/top100Sync.test.ts`、`src/workers/routes/encounterTemplates.test.ts`、`src/utils/timelineStorage.test.ts`

**Interfaces:**

- Produces:
  - `ExtractedFightData.phases: RawPhase[]`
  - `EncounterTemplate.phases?: RawPhase[]`（缺席 = 存量模板；`[]` = 确认无阶段）
  - `BuildEncounterTemplateInput.fightPhases: RawPhase[]`；`buildEncounterTemplate` 返回值加 `phases: RawPhase[]`
  - `EncounterTemplateResponse.phases: RawPhase[]`（无模板或存量模板时 `[]`）
  - `createNewTimeline(encounterId, name, initialEvents?, initialPhases?)`

- [ ] **Step 1: 写失败测试**

- `encounterTemplate.test.ts`（`shouldReplaceTemplate` 经 `buildEncounterTemplate` 间接测）：
  - 旧 kill 模板**无 `phases` 字段**，新 kill 更短 → 覆盖，产出带 phases。
  - 旧 kill 模板 `phases: []`，新 kill 更短 → 不覆盖（原规则）。
  - 旧 kill 模板有 phases，新 kill 更短 → 不覆盖（原规则）。
  - 旧 wipe 模板无 `phases` 字段，新 wipe 更短 → 不覆盖（新规则不作用于 wipe）。
  - 新 wipe vs 旧 kill（无 phases）→ 不覆盖。
  - 覆盖时 `phases` 原样写入；`fightPhases` 为 `[]` 时产出 `phases: []`。
- `top100Sync.test.ts`：`extractFightStats` 产出 `phases`（与 damageEvents 同 `resolveFightStartTime` 零点）；`processOneSample` 写入的模板含 `phases`。
- `encounterTemplates.test.ts`：KV 模板带 phases → 响应带 `phases`；存量模板无字段 → 响应 `phases: []`；无模板 → `phases: []`。
- `timelineStorage.test.ts`：`createNewTimeline` 传 `initialPhases` 时写入；不传时无 `phases` 字段（或空数组，与该函数对 annotations 的处理一致即可，测试按实现约定写）。

Run: `pnpm test:run src/workers src/utils/timelineStorage.test.ts`
Expected: FAIL

- [ ] **Step 2: 采样与模板构建**

- `top100Sync.ts` 的 `extractFightStats`：把 `resolveFightStartTime(events, fight.startTime)` 提为局部变量 `fightStartTime`，`parseDamageEvents` 与 `parseFightPhases(report, fight, fightStartTime)` 共用；返回值加 `phases`。`ExtractedFightData` 加字段。
- `encounterTemplate.ts`：
  - `EncounterTemplate` 加：

```ts
  /**
   * 阶段（未翻译的 FFLogs 原文），与 events 同源同零点，随模板整体替换。
   * 字段缺席 = 存量模板（阶段功能上线前写入）；[] = 来源战斗确认无阶段。
   */
  phases?: RawPhase[]
```

- `shouldReplaceTemplate` 改为：

```ts
function shouldReplaceTemplate(
  oldTemplate: EncounterTemplate,
  newDurationMs: number,
  newKill: boolean
): boolean {
  const oldKill = oldTemplate.kill ?? false
  if (newKill !== oldKill) return newKill
  // 存量 kill 模板缺 phases 字段：任意新 kill 都覆盖，借下一次采样自动补上阶段。
  // 不作用于 wipe（避免短 wipe 顶掉长 wipe）；phases: [] 不触发（避免单阶段副本每次被覆盖）。
  if (newKill && oldTemplate.phases === undefined) return true
  return newDurationMs > oldTemplate.templateSourceDurationMs
}
```

- 同步更新函数头注释里的覆盖规则说明；`BuildEncounterTemplateInput` 加 `fightPhases: RawPhase[]`，返回值加 `phases: input.fightPhases`。
- `processOneSample`：`buildEncounterTemplate({ …, fightPhases: extracted.phases })`；`newTemplate` 加 `phases: built.phases`。
- `routes/encounterTemplates.ts`：空响应与正常响应都加 `phases`（`template.phases ?? []`）。
- `apiContracts.ts` 的 `EncounterTemplateResponse` 加：

```ts
  /** 模板阶段（FFLogs 原文，前端建轴时按当前语言翻译）；无模板 / 存量模板为 [] */
  phases: RawPhase[]
```

- [ ] **Step 3: 建轴写入**

- `timelineStorage.ts` 的 `createNewTimeline` 加可选参数 `initialPhases?: TimelinePhase[]`，有值且非空时写入 `phases`。
- `CreateTimelineDialog.tsx` 的 `handleSubmit`：

```ts
const initialPhases = cached
  ? rawPhasesToTimelinePhases(
      cached.phases ?? [],
      encounterIdNum,
      useUIStore.getState().locale,
      generateObjectId
    )
  : undefined
const base = createNewTimeline(String(encounterIdNum), name.trim(), initialEvents, initialPhases)
```

（`cached.phases ?? []` 兼容浏览器里尚未过期的旧响应缓存。）

- `ImportIntoTimelineDialog`、`Top100Section` 不改（设计 §2 非目标）。

- [ ] **Step 4: 测试、Worker 打包、类型检查、提交**

Run: `pnpm test:run src/workers src/utils` → PASS；wrangler dry-run → 成功；`pnpm exec tsc --noEmit`

```bash
git add src/workers src/types/apiContracts.ts src/utils/timelineStorage.ts src/utils/timelineStorage.test.ts src/components/CreateTimelineDialog.tsx
git commit -m "feat(phase): 副本模板存储阶段并在建轴时翻译带入"
```

---

## Task 7: 主时间轴显示阶段（只读部分）

**Files:**

- Create: `src/components/Timeline/PhaseBands.tsx`
- Create: `src/components/Timeline/PhaseLabels.tsx`（本 task 只做显示 + 选中，交互在 Task 8）
- Modify: `src/components/Timeline/TimeRuler.tsx`、`DamageEventTrack.tsx`、`HpCurveTrack.tsx`、`SkillTracksCanvas.tsx`、`index.tsx`

**Interfaces:**

- Consumes: `sortPhases`、`phaseColor`、`rangesOverlap`（Task 1），`selectedPhaseId` / `selectPhase`（Task 3）
- Produces:
  - `<PhaseBands phases={sorted} zoomLevel y height />`：每个阶段一条 2px 竖线 + 向右固定 200px、从该色到透明的线性渐变；`listening={false}`
  - `<PhaseLabels … />`：标尺上的阶段名（未选中：无底色彩色粗体；选中：该色实底标签「名称　mm:ss.f　✎　🗑」）
  - `TimeRuler` 新增 prop `hiddenTickRanges: [number, number][]`（画布 x 坐标区间），与之重叠的刻度**线与文字一起**不画

**实现要点：**

- [ ] **Step 1: PhaseBands**

Konva `Group listening={false}`，每阶段：`Line`（`x = time * zoomLevel`，2px，该色）+ `Rect`（`width = 200`，`fillLinearGradientStartPoint {x:0,y:0}` → `EndPoint {x:200,y:0}`，`fillLinearGradientColorStops [0, 色 with α, 1, 色 with α=0]`）。α：浅色模式取原型值；深色模式适当提高（从 `useUIStore` 的 `theme` 读取；色值转 rgba 的工具函数放在本文件内）。`perfectDrawEnabled={false}`、`shadowEnabled={false}`。宽度**不随缩放和阶段长度变化**（设计 §6.2）。

- [ ] **Step 2: 挂到四处背景之上**

不新增 Layer：在每处「轨道背景 Rect 之后、内容之前」渲染一次 `PhaseBands`，保证渐变在背景之上、事件 / 卡片 / 刻度之下：

- `TimeRuler.tsx`：背景 `Rect` 之后、刻度之前（`y=0`、`height=标尺高`）。
- `DamageEventTrack.tsx`：第 159 行附近的背景 `Rect` 之后（`y` / `height` 与该背景一致）。
- `HpCurveTrack.tsx`：第 115 行附近的背景 `Rect` 之后。
- `SkillTracksCanvas.tsx`：`bgLayer` 中所有轨道背景 `Rect` 渲染完之后（`y=0`、`height=全部轨道总高`）。

各组件新增可选 prop `phases?: TimelinePhase[]`（已排序），由 `Timeline/index.tsx` 用 `useMemo(() => sortPhases(timeline.phases ?? []), [timeline.phases])` 统一下发。

- [ ] **Step 3: PhaseLabels 与刻度遮挡**

- 放在固定区 Stage 的 `fixedLayer` 中、`DamageEventTrack` 之后（最上层，可交互）。
- 文字：12px 粗体、该色加深（原型 `color-mix(var(--pc) 72%, #000)`；Konva 不支持 color-mix，按同比例在 JS 里混色）。位于竖线右侧、标尺垂直居中。
- 用 `Konva.Text` 的 `measureSize` 或 canvas `measureText` 计算每个标签的 x 区间（选中态用实底标签的整体宽度），汇成 `hiddenTickRanges` 传给 `TimeRuler`。`TimeRuler` 对每个刻度计算 `[x, x + 4 + 刻度文字宽]`，与任一区间 `rangesOverlap` 则整组不画。
- 单击标签 → `selectPhase(id)`；点击时间轴空白（现有清空选中的路径）因 Task 3 的 `setSelection` 改动会自动清掉阶段选中，确认无需额外代码。
- 选中标签内 ✎ / 🗑 本 task 先渲染图形，点击行为在 Task 8 接入。

- [ ] **Step 4: 手动验证**

用户通常已启动 `pnpm dev`（不要主动启动）。在浏览器打开一条带阶段的时间轴（可在 devtools 里对 store 调 `addPhase` 造数据）：

- 竖线 + 200px 渐变贯穿标尺、伤害轨、HP 轨、全部技能轨，缩放时宽度不变。
- 阶段名与刻度重叠时，重叠刻度的线和文字都隐藏；选中后标签变宽，被挡的刻度同步隐藏。
- 浅色 / 深色模式对比度可接受。

- [ ] **Step 5: 类型检查、相关测试、提交**

Run: `pnpm exec tsc --noEmit`；`pnpm test:run src/components/Timeline`

```bash
git add src/components/Timeline
git commit -m "feat(phase): 主时间轴显示阶段渐变与标尺阶段名"
```

---

## Task 8: 主时间轴编辑交互

**Files:**

- Create: `src/components/PhaseDeleteConfirm.tsx`
- Modify: `src/components/Timeline/PhaseLabels.tsx`、`src/components/Timeline/index.tsx`、`src/components/Timeline/TimelineContextMenu.tsx`
- Modify: `src/i18n/locales/zh-CN/editor.json`

**Interfaces:**

- Consumes: `clampPhaseTime`、`defaultPhaseName`、`PHASE_NAME_MAX_LENGTH`、store 阶段操作
- Produces:
  - `<PhaseDeleteConfirm open anchorRect phaseName onConfirm onOpenChange />`：Popover 锚定在任意屏幕矩形（用 `fixed` 定位的 1×1 透明触发器，同 `TimelineTable` 中 castMenu 的写法），下方右对齐；内容沿用 `src/components/FilterMenu/SortablePresetRow.tsx` 样式：标题「确认删除？」+ 灰色小字阶段名 +「取消」（outline）/「删除」（destructive）；焦点默认在「删除」，Enter 确认、Esc / 点外部取消
  - `ContextMenuState` 新增 `{ type: 'phase'; phaseId: string; x; y; time }`
  - `TimelineContextMenu` 新增 props：`onAddPhase(time)`、`onRenamePhase(phaseId)`、`onEditPhaseTime?`（时间轴视图无此项）、`onDeletePhase(phaseId, anchor)`

**实现要点（逐条对照设计 §6.2、§7、§8 与原型 `phase-edit.html`）：**

- [ ] **Step 1: 文案**

`src/i18n/locales/zh-CN/editor.json` 新增 `phase` 分组（key 名可按实现微调，但须全部放在该分组下）：

```json
"phase": {
  "addHere": "在此处添加阶段",
  "addAtCurrent": "在当前位置添加阶段",
  "addEmpty": "阶段",
  "beforeFirst": "开场前",
  "none": "无阶段",
  "rename": "重命名",
  "renameDblClick": "双击",
  "renameDblClickName": "双击名称",
  "editTime": "修改开始时间",
  "editTimeClick": "单击时间",
  "delete": "删除阶段",
  "confirmDelete": "确认删除？",
  "hoverHintTimeline": "拖动调整时间 · 双击重命名 · 右键更多",
  "dragToAdjust": "拖动调整开始时间",
  "renameTooltip": "重命名（双击）",
  "deleteTooltip": "删除（{key}）",
  "hoverHintTableTime": "单击修改开始时间",
  "hoverHintTableName": "双击重命名 · 右键更多",
  "addBeforeRow": "在此行前添加阶段",
  "timeClamped": "已调整到相邻阶段之间（至少相隔 1 秒）",
  "noRoom": "相邻阶段之间没有空间"
}
```

- [ ] **Step 2: 悬停、拖动、改名（PhaseLabels）**

- 只读（`isReadOnly`）时：无悬停底色 / 提示 / ✎🗑，不可拖动、改名、删除，单击仍可选中（便于看开始时间）。
- 悬停：淡底色 + `ew-resize` 光标；停留约 450ms 后在标签下方显示 HTML 提示 `phase.hoverHintTimeline`（复用 `AnnotationBubble` 的「CSS 变量跟随滚动」定位方式，或简单的绝对定位 div；`pointer-events: none`）。
- 选中标签：悬停提示 `phase.dragToAdjust`；✎ / 🗑 各自 tooltip（`renameTooltip` / `deleteTooltip`，`key` 传 `deleteKeyLabel`）。
- 拖动：标签 `draggable`，`dragBoundFunc` 锁定 y；拖动中本地预览时间 = `clampPhaseTime(sorted, id, x / zoomLevel)`，竖线与渐变跟随预览（PhaseLabels 把 `{ id, time }` 预览上抛给 index，index 把预览合并进下发给 `PhaseBands` 的 phases）；`dragEnd` 时 `updatePhase(id, { time })`——**只在松开时写一次**，保证一次拖动一步撤销；若最终被钳制则 `toast(t('editor:phase.timeClamped'))`。
- 双击名称 / 点 ✎ / 右键「重命名」→ 在标签位置叠一个 HTML `<input maxLength={PHASE_NAME_MAX_LENGTH}>`（屏幕坐标换算同 `AnnotationPopover` 的 `screenX/screenY`）：Enter 确认、Esc 取消、失焦确认；trim 后为空视为取消。
- 拖动、双击都要避开现有画布平移 / 框选手势：在标签的 `mousedown` 上 `e.cancelBubble = true`，并参考 `DamageEventTrack` 的拖动写法处理 `isDraggingRef`。

- [ ] **Step 3: 添加（右键菜单）**

- `TimelineContextMenu` 在 `damageTrackEmpty` 与 `skillTrackEmpty` 两种菜单里，与「添加」「添加备注」并列加一项「在此处添加阶段」，右侧 `DropdownMenuShortcut` 显示 `mm:ss.f`（`formatTimeWithDecimal`）；只读时不显示。标尺空白处右键也需要弹出该菜单：给 `TimeRuler` 背景 `Rect` 接 `onContextMenu`，复用 `handleContextMenu` 以 `damageTrackEmpty` 类型打开（或新增 `rulerEmpty` 类型，只含添加阶段一项——二选一，取实现更简单者）。
- `onAddPhase(time)`：`const r = clampPhaseTime(sorted, null, time)`；`r === null` → `toast.error(t('editor:phase.noRoom'))`；否则 `addPhase({ id: generateObjectId(), name: defaultPhaseName(sorted, r.time), time: r.time })`，随即 `selectPhase(id)` 并进入改名状态（其他阶段名不变）。

- [ ] **Step 4: 阶段右键菜单与删除**

- 右键阶段标签 → `ContextMenuState { type: 'phase' }`：「重命名　双击」「删除阶段　{deleteKeyLabel}」。
- 所有删除入口（选中标签 🗑、右键删除、选中后按 `Del` / `Backspace`）都先打开 `PhaseDeleteConfirm`，锚定触发元素（🗑 / 标签）的屏幕矩形；确认后 `removePhase(id)`。
- `index.tsx` 现有 `useHotkeys('delete, backspace', …)`：在函数开头加分支——`selectedPhaseId` 非空时只打开阶段删除确认并 `return`，不走 `bulkDeleteSelection`（Task 3 已保证此时其他选中为空）。

- [ ] **Step 5: 手动验证**

在已启动的 dev server 上逐条走设计 §7 时间轴视图一列：添加（标尺 / 伤害轨 / 技能轨空白右键）、改名（双击 / ✎ / 右键）、改时间（拖动名称 / 选中标签，越界被钳制并提示）、删除（🗑 / 右键 / Del，均先确认）；`Ctrl+Z` 一步撤销一次拖动；选中阶段后点伤害事件，阶段选中消失，反之亦然；框选不选中阶段；只读 / 回放模式下无任何编辑入口但可选中、可跳转。

- [ ] **Step 6: 类型检查、lint、提交**

Run: `pnpm exec tsc --noEmit`；`pnpm lint`

```bash
git add src/components/PhaseDeleteConfirm.tsx src/components/Timeline src/i18n/locales/zh-CN/editor.json
git commit -m "feat(phase): 主时间轴支持阶段的添加、拖动、改名与删除"
```

---

## Task 9: 缩略图显示阶段

**Files:**

- Modify: `src/components/Timeline/TimelineMinimap.tsx`、`src/components/Timeline/index.tsx`

- [ ] **Step 1: 绘制**

- `TimelineMinimap` 新增 prop `phases: TimelinePhase[]`（已排序），在背景 / 网格绘制之后、伤害柱之前，为每个阶段在 `x = (time - TIMELINE_START_TIME) * zoomLevel * minimapScale` 处（与该组件现有的时间→x 换算保持一致）画一段**固定 64px 宽、铺满整个高度**的线性渐变（`ctx.createLinearGradient`），左上角写 `shortPhaseLabel(name)`（10–11px 粗体、该色加深）。
- 把 `phases` 加入触发重绘的依赖。
- **不改**点击 / 拖动行为（设计 §6.3：缩略图只显示，按下 / 拖动仍按位置定位视口）。

- [ ] **Step 2: 手动验证、类型检查、提交**

肉眼确认渐变与短标签位置正确、与缩略图上的伤害柱 / 视口框叠放顺序合理；点击与拖动行为与改动前一致。

Run: `pnpm exec tsc --noEmit`

```bash
git add src/components/Timeline/TimelineMinimap.tsx src/components/Timeline/index.tsx
git commit -m "feat(phase): 缩略图显示阶段渐变与短标签"
```

---

## Task 10: 工具栏阶段跳转入口与时间轴视图跳转

**Files:**

- Create: `src/components/PhaseNavigator.tsx`
- Modify: `src/components/EditorToolbar.tsx`、`src/components/Timeline/index.tsx`
- Modify: `src/i18n/locales/zh-CN/editor.json`（如需补充文案）

**Interfaces:**

- Consumes: `viewAnchorTime`、`requestScrollToTime`、阶段 CRUD（Task 3），`currentPhaseIndex` / `shortPhaseLabel` / `phaseColor` / `clampPhaseTime` / `defaultPhaseName`（Task 1），`PhaseDeleteConfirm`（Task 8）
- Produces: `<PhaseNavigator width={toolbarWidth} />`

- [ ] **Step 1: 时间轴视图上报阅读位置并响应跳转**

`Timeline/index.tsx`：

- 在现有「同步滚动状态到 store」的 effect（第 699 行附近）里追加 `setViewAnchorTime((clampedScrollLeft + PHASE_VIEW_OFFSET_PX) / zoomLevel)`。
- 新增 effect 订阅 `scrollToTimeRequest`：目标 `scrollLeft = time * zoomLevel - PHASE_VIEW_OFFSET_PX`，夹到 `[minScrollLeft, maxScrollLeft]`，用 `requestAnimationFrame` 在约 250ms 内 ease-out 过渡调用 `setScrollLeft`（只处理比上次大的 `seq`，用 ref 记录）。
- 组件卸载时 `setViewAnchorTime(null)`。

- [ ] **Step 2: 工具栏布局**

`EditorToolbar.tsx` 外层改为 `flex`：

- 左侧：现有按钮区放入 `flex-1 min-w-0 overflow-x-auto scrollbar-hide` 容器，单独横向滚动。
- 左侧容器右边缘叠一个 `pointer-events-none` 的 96px 渐隐层（`linear-gradient(to right, transparent, var(--background))`），仅当「内容溢出且未滚到最右」时显示（监听 `scroll` + `ResizeObserver` 计算）。**不画分隔竖线**。
- 右侧：`shrink-0` 的 `PhaseNavigator`，不参与滚动。用 `ResizeObserver` 量工具栏总宽传入 `width`。

- [ ] **Step 3: PhaseNavigator**

逐条对照设计 §6.4 与原型：

- 当前阶段：`currentPhaseIndex(sorted, viewAnchorTime ?? -Infinity)`；`-1` 时显示 `phase.beforeFirst`（中性灰）。
- 入口三档：`width ≥ 900` 显示「完整名称 + 开始时间 mm:ss ▾」；`≥ 520` 显示「短标签 + 时间 ▾」；更窄「短标签 ▾」。边框 / 文字跟随当前阶段颜色。
- 无阶段：可编辑时显示虚线边框「＋ 阶段」，点击即在 `viewAnchorTime` 处添加（走 Task 8 的添加逻辑：钳制、默认名；添加后打开下拉并让新项进入改名）；只读时显示 `phase.none`，不可点。
- 下拉（`DropdownMenu`）：每项「色块 + 名称 …… 开始时间」，当前阶段高亮。悬停某项时右侧时间被 ✎ / 🗑 顶替（固定宽度容器，避免跳动）；✎ 原地改名（项内换成 input，Enter 确认、Esc 取消，输入时阻止 DropdownMenu 的 typeahead 与关闭）；🗑 打开 `PhaseDeleteConfirm`，删除后菜单保持展开。分隔线下方「＋ 在当前位置添加阶段　mm:ss」，样式与普通项一致。只读时不显示 ✎🗑 与添加项。
- 选择某项 → `requestScrollToTime(phase.time)`。
- 抽出「添加阶段」逻辑为 Task 8 中可复用的函数（例如 `src/components/Timeline/phaseActions.ts` 的 `addPhaseAt(time, t)`，返回新 id 或 null），时间轴右键、工具栏、表格三处共用，避免三份钳制 / 默认名 / 提示代码。

- [ ] **Step 4: 手动验证、类型检查、lint、提交**

拖动时间轴，入口文字与颜色随「视口左缘 + 40px」所在阶段变化；选择阶段后平滑滚动到起点在视口左缘偏右 40px；拖窄窗口，三档切换、按钮区出现 96px 渐隐、滚到最右渐隐消失。

Run: `pnpm exec tsc --noEmit`；`pnpm lint`

```bash
git add src/components/PhaseNavigator.tsx src/components/EditorToolbar.tsx src/components/Timeline src/i18n/locales/zh-CN/editor.json
git commit -m "feat(phase): 工具栏新增阶段跳转入口"
```

---

## Task 11: 表格视图阶段行

**Files:**

- Create: `src/components/TimelineTable/PhaseRow.tsx`
- Modify: `src/utils/tableRows.ts`、`src/utils/tableRows.test.ts`
- Modify: `src/components/TimelineTable/index.tsx`、`src/components/TimelineTable/TableDataRow.tsx`

**Interfaces:**

- Produces:
  - `TableRow` 新增 `{ kind: 'phase'; id: string; time: number; phase: TimelinePhase; colorIndex: number }`
  - `mergeAndSortRows(damageEvents, annotations, phases?)`：同一时刻排序为 **phase(0) < annotation(1) < damage(2)**（设计 §7「同一时刻时阶段行在前」）

- [ ] **Step 1: 行排序（TDD）**

先在 `tableRows.test.ts` 写：阶段行插在开始时间 ≥ 其时间的第一条事件 / 备注行之前；同一时刻阶段行最前；`colorIndex` 为排序后位置；不传 phases 时行为与现在完全一致。再改实现。

Run: `pnpm test:run src/utils/tableRows.test.ts` → 先 FAIL 后 PASS

- [ ] **Step 2: PhaseRow**

逐条对照设计 §6.5、§7 表格一列与原型 `phase-edit.html` 的表格部分：

- 高 30px；时间列显示 `formatTimeWithDecimal(time)`，其后是阶段名。
- `<tr>` 的单元格 `position: sticky; top: HEADER_HEIGHT`（z-index 低于表头、高于普通行），垫实底色，后出现的阶段行滚到顶时自然覆盖前一个。
- 背景从时间列开始、该色渐变到透明，铺到表格最右；阶段名像 `AnnotationRow` 一样用内部 sticky div 固定在可视区左侧（参考其 `leadingWidth` / `textWidth` 算法）。
- 上下边线用该色浅色；上一行的下边线也需改色（在 `index.tsx` 渲染行时，若下一行是阶段行，给当前行传 `borderBottomColor`）。
- 悬停：时间格出现描边 + 虚线下划线 + 提示 `phase.hoverHintTableTime`；名称出现淡底色 + 提示 `phase.hoverHintTableName`；整行悬停时名称后露出 ✎ / 🗑。只读时以上全部不显示。
- 单击时间 → 原地换成 `TimeInput`（`src/components/ui/time-input.tsx`）；确认后 `clampPhaseTime`，越界钳制并提示，`updatePhase`。
- 双击名称 / ✎ / 右键「重命名」→ 原地 input（规则同 Task 8）。
- 右键阶段行：「重命名　双击名称」「修改开始时间　单击时间」「删除阶段」；删除走 `PhaseDeleteConfirm`。
- 表格外层 `onContextMenu` 现在一律 `preventDefault`，阶段行与伤害行的自定义菜单需 `stopPropagation` 后自行弹出（同 cast marker 的做法）。

- [ ] **Step 3: 伤害行右键「在此行前添加阶段」**

`TableDataRow` 的非 marker 区域右键（可编辑时）弹出单项菜单「在此行前添加阶段」，时间 = 该伤害事件 `time`，走共用的 `addPhaseAt`；新增的阶段行进入改名状态。

- [ ] **Step 4: 阅读位置与跳转**

- 在现有 `handleScroll` 中（用 `requestAnimationFrame` 节流）找出表头下方第一条可见行：给每个 `<tr>` 加 `data-row-time`，按 `offsetTop` 二分查找第一条 `offsetTop + offsetHeight > scrollTop + HEADER_HEIGHT` 的行，`setViewAnchorTime(该行 time)`。挂载时与切换过滤器后也上报一次；卸载时置 `null`。
- 订阅 `scrollToTimeRequest`：找到 `time` 对应的阶段行（同时刻的第一行），`wrapper.scrollTo({ top: row.offsetTop - HEADER_HEIGHT, behavior: 'smooth' })`，使其贴住表头。

- [ ] **Step 5: 手动验证、测试、类型检查、lint、提交**

在表格视图逐条走设计 §6.5 与 §7 表格一列；工具栏入口在表格视图下正确显示当前阶段、选择后滚到阶段行贴住表头；只读时无编辑入口。

Run: `pnpm test:run src/utils/tableRows.test.ts src/components/TimelineTable`；`pnpm exec tsc --noEmit`；`pnpm lint`

```bash
git add src/utils/tableRows.ts src/utils/tableRows.test.ts src/components/TimelineTable src/i18n/locales/zh-CN/editor.json
git commit -m "feat(phase): 表格视图显示与编辑阶段行"
```

---

## Task 12: 公开文档

**Files:**

- Create: `docs/howto/timeline-phases.md`
- Modify: `docs/howto/index.md`、`docs/tutorial.md`、`docs/.vitepress/config.ts`（侧边栏）

- [ ] **Step 1: 写文档**

参考 `docs/howto/annotations.md` 的结构与语气，说明：阶段从哪来（FFLogs 导入、副本模板、手动添加；回放模式需先退出才能编辑）、在哪看（时间轴、缩略图、表格、工具栏入口）、怎么跳转、怎么添加 / 改名 / 改时间 / 删除（三个视图各自的入口与快捷方式，含 Del 与撤销）、阶段不影响任何伤害计算。不写具体游戏内阶段名举例以外的游戏数据；如需举例，只用 FFLogs 原文格式（如 `P1: …`）而不写译名。

在 `docs/tutorial.md` 相关段落补一句指向该页；`howto/index.md` 与 VitePress 侧边栏加入口。

**不要**改 `docs/changelog.md`：它按日期分节，新增一节会触发站内「更新提示」（`useChangelogToast`），属于发布决策，由用户在发布时决定是否添加。

- [ ] **Step 2: 文档检查并提交**

Run:

```bash
node scripts/enforce-docs-paths.mjs docs/howto/timeline-phases.md docs/howto/index.md docs/tutorial.md
node scripts/check-local-paths.mjs docs/howto/timeline-phases.md docs/howto/index.md docs/tutorial.md
pnpm docs:build
```

```bash
git add docs
git commit -m "docs: 新增时间轴阶段使用说明"
```

---

## Task 13: 全量验证

- [ ] **Step 1: 自动检查**

Run（全部必须通过）：

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test:run
pnpm test:workers
pnpm build
```

以及 Task 4 Step 4 的 wrangler dry-run。

- [ ] **Step 2: 端到端手动验收（人工步骤，进入此步后恢复「每次 Git 操作须用户授权」）**

由用户在浏览器中确认：

1. 从 FFLogs 导入一个多阶段绝境战报告（设计 §3 的 DMU 样本 `nQFXVpAH2cWkd8RZ#12`）：P2 ≈ 3:29.2、P3 ≈ 7:09.0、P4 ≈ 12:19.0、P5 ≈ 15:03.1 与伤害事件对齐；回放模式下只读。
2. 导入 DSR 样本：开场同时刻两个阶段只留后一个。
3. 导入单阶段副本：无阶段，工具栏显示「＋ 阶段」（退出回放后）。
4. 用副本模板新建（需要该副本已有带 phases 的模板；可用 `pnpm kv:pull-encounter` 观察 KV 实际状态）：阶段带入。
5. 两个浏览器协作编辑同一已发布时间轴：阶段增删改实时同步；各自撤销只撤自己的操作。
6. 发布 → 他人只读打开：阶段显示、可跳转、不可编辑。
7. 存量时间轴（无 phases 字段）打开正常，无报错。

---

## 附：实施注意

- **Y.Doc 新顶层 Map 的兼容性**：旧客户端不认识 `phases` map，会忽略它（Yjs 顶层类型按名懒创建），新旧客户端协作时旧客户端看不到阶段但不会破坏数据。上线后无需迁移。
- **TimelineDoc（DO）服务端投影**：`src/workers/durable/TimelineDoc.ts` 直接调用 `projectTimeline(doc)`（已核对，非测试代码中只有它和 `timelineStore` 两处调用），Task 2 改完即自动带上 phases；实施时确认其后续序列化走 `toV2` / `serializeForServer`。
- **PeerOverlay（协作者感知）** 不显示他人对阶段的选中 / 拖动，本次不做。
