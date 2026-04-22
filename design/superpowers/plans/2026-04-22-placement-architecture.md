# 按键组 + 放置约束架构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git 授权提醒**：项目规则"未经用户明确要求不得自行 Git 操作"。每个 Task 的 commit step 执行前必须等用户在**最新**消息中明确授权；不得携带 `Co-Authored-By: Claude`。

**Spec:** `design/superpowers/specs/2026-04-22-placement-architecture-design.md`

**Goal:** 用声明式 `trackGroup + placement` 体系取代现有两处变身/合并的硬编码：`fflogsImporter` 的 `37016→37013` 归并，以及 `Timeline/index.tsx` 的炽天附体窗口 `displayActionOverrides`。

**范围说明：** 本次**只迁移 37013/37016**（外观-变身型）。spec 里涵盖的 16536/37011（节制 ↔ 神爱抚 follow-up）架构上已兼容，但**本次不迁移**——不新增 `DIVINE_CARESS_READY` 状态、不改 16536/37011 的 executor、不加 placement 或 trackGroup。该 follow-up 数据迁移由后续独立 plan 实施。

### 范围决策理由（回应评审"为什么在不迁移 follow-up 的情况下仍然实现完整框架"）

本次改动在定位上是**框架实现**，不是"仅针对 37013/37016 的局部修补"。以下三条决策都来自这个定位：

1. **`MitigationCalculator.simulate()` 纯函数 + 产出 `statusTimelineByPlayer` / `excludeCastEventId` 重放 + 缓存（Task 4 / 5 / 8）必须一次到位**
   - follow-up 场景（16536 attach / 37011 consume `DIVINE_CARESS_READY`）**必然会在后续独立 plan 实施**；它对 excludeId 语义的要求是"按 sourceCastEventId 过滤冻结 timeline"无法等价还原的——已在 Codex 首轮对抗性评审第一轮 [high] 锁定。
   - 如果本次先用简化方案（按 `sourceCastEventId` 过滤冻结 timeline）实现 excludeId，follow-up 阶段必须同时做两件事：推翻现有实现 + 引入重放。这个过渡期内 `MitigationCalculator` / `useDamageCalculation` 会经历两次核心重构，回滚面和 bug surface 都更大。
   - 反之，本次把重放机制一次性落地，follow-up plan 只需在 data 层加字段（executor consume + placement + trackGroup），不再动核心计算器。
   - 代价：本次 `MitigationCalculator` 要多承担一次"walk 提纯 + pre/post diff 记录 interval"的改造，但这是增量提取而非算法重写——既有全部 damage 测试作为 1:1 等价护栏（Task 4.4 / 5.5 强制通过）。
2. **`PlacementEngine` 完整接口（`pickUniqueMember` / `findInvalidCastEvents` 含 `reason` 分类 / `computeTrackShadow` / excludeId 支持）（Task 6 / 7 / 8）必须一次到位**
   - 理由同上：UI 层的双击/拖拽/红边框/阴影回路全部走 engine API，一次性切换比"先做阉割版再替换"更安全。
   - follow-up plan 不需要再动引擎代码，只需新增 combinator（若需要新语义）和 data。
3. **本次**不**做**的事\*\*（明确豁免 Codex 评审质疑）
   - **legacy 数据迁移**（已在 D1 或本地持久化的 `actionId=37013` 且位于炽天附体窗口内的 cast）：按项目所有者明确立场"**可以容忍不兼容数据上线**"，不加迁移任务。受影响的老时间轴会以红边框提示，由用户自行调整——已在 spec Section 6.5 风险条目中记录。
   - **16536/37011 的 executor / placement / trackGroup 改动**：framework 已支持，data 层迁移延后独立 plan 实施。本次动了会让 review 范围与回滚粒度劣化。
   - **37013 executor 内判 Buff 3885 / 秘策 1896 的硬编码**：spec Section 1 非目标，属执行语义层，与放置架构正交；follow-up 或独立 executor 重构时再清理。

**Architecture:** 新增 `src/utils/placement/` 模块（types / intervals / combinators / engine / validate）。`MitigationAction` 加 `trackGroup?: number` + `placement?: Placement`。`MitigationCalculator` 暴露 `simulate({ castEvents, damageEvents, initialState, statistics? })` 纯函数，同时产出 `damageResults` 和 `statusTimelineByPlayer`（通过 pre/post diff 捕获 attach/expire/consume 并记录 `sourceCastEventId`）。`PlacementEngine` 由 `createPlacementEngine({ castEvents, actions, simulate })` 构造，`excludeCastEventId` 通过过滤 castEvents 后重跑 simulate 实现"假设该 cast 不存在"，按 excludeId 缓存。`Timeline/index.tsx` 把引擎挂到 `useMemo`，双击/拖拽/红边框走 engine API。

**Tech Stack:** TypeScript 5.9, Vitest 4, React 19, Zustand 5, Konva / React-Konva。

---

## File 映射

| 动作   | 文件                                             | 作用                                                                                              |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Create | `src/utils/placement/types.ts`                   | `Placement` / `Interval` / `PlacementContext` / `StatusInterval` 类型                             |
| Create | `src/utils/placement/intervals.ts`               | `sortIntervals` / `mergeOverlapping` / `complement` / `intersect` / `subtractIntervals`           |
| Create | `src/utils/placement/intervals.test.ts`          | 区间运算不变量测试                                                                                |
| Create | `src/utils/placement/combinators.ts`             | `whileStatus` / `anyOf` / `allOf` / `not` / `difference`                                          |
| Create | `src/utils/placement/combinators.test.ts`        | combinator 行为测试                                                                               |
| Create | `src/utils/placement/engine.ts`                  | `createPlacementEngine` + `PlacementEngine` 接口实现                                              |
| Create | `src/utils/placement/engine.test.ts`             | engine 端到端测试（含 excludeId 重放）                                                            |
| Create | `src/utils/placement/validate.ts`                | `validateActions` 启动期 lint                                                                     |
| Create | `src/utils/placement/validate.test.ts`           | validate 规则测试                                                                                 |
| Modify | `src/types/mitigation.ts`                        | `MitigationAction.trackGroup` + `placement`；`effectiveTrackGroup` helper                         |
| Modify | `src/types/status.ts`                            | 新增 `StatusInterval` 类型                                                                        |
| Modify | `src/utils/mitigationCalculator.ts`              | 暴露 `simulate()` 纯函数；从 diff 产出 `statusTimelineByPlayer`                                   |
| Modify | `src/utils/mitigationCalculator.test.ts`         | 补 `simulate` + `statusTimelineByPlayer` 测试                                                     |
| Modify | `src/hooks/useDamageCalculation.ts`              | 走 `calculator.simulate()`；同时暴露 `statusTimelineByPlayer` 供上游消费                          |
| Modify | `src/data/mitigationActions.ts`                  | 37013 加 `placement`；37016 去 `hidden`、加 `trackGroup: 37013` + `placement`（不动 16536/37011） |
| Modify | `src/utils/skillTracks.ts`                       | 过滤规则：`!a.hidden` → `!a.trackGroup \|\| a.trackGroup === a.id`                                |
| Modify | `src/store/mitigationStore.ts`                   | `getFilteredActions` 过滤规则同上                                                                 |
| Modify | `src/components/FilterMenu/EditPresetDialog.tsx` | `visibleActions` 过滤规则同上（否则 37016 会泄漏到预设对话框）                                    |
| Modify | `src/utils/fflogsImporter.ts`                    | 删除 `abilityGameID === 37016 ? 37013` 归并                                                       |
| Modify | `src/components/Timeline/index.tsx`              | 删 `displayActionOverrides`；接入 `engine` + `draggingId` + `invalidCastEventMap`                 |
| Modify | `src/components/Timeline/SkillTracksCanvas.tsx`  | 废弃 `castEventBoundaries` 与 CD 阴影独立计算，改调 `engine`                                      |
| Modify | `src/components/Timeline/CastEventIcon.tsx`      | `dragBoundFunc` 读 `dragBoundsRef`；红边框 + reason tooltip；删 `displayAction` 分支              |

---

## Task 1: Placement 类型 + Interval 基础运算

**Files:**

- Create: `src/utils/placement/types.ts`
- Create: `src/utils/placement/intervals.ts`
- Create: `src/utils/placement/intervals.test.ts`
- Modify: `src/types/status.ts`

- [ ] **Step 1.1：`src/types/status.ts` 加 `StatusInterval` 类型**

在文件末尾（`StatusExecutor` 定义之后）追加：

```ts
/**
 * 状态时间线区间（由 MitigationCalculator.simulate 产出）
 *
 * 半开区间 [from, to)。`sourcePlayerId` = 施放者；`sourceCastEventId` = 触发该状态
 * attach 的 cast event 的 id（Healerbook UUID）。同一个 status instance 可能因
 * executor consume 而提前结束，`to` 反映实际收束时刻；未 consume 的 interval 的
 * `to` 取 endTime。
 */
export interface StatusInterval {
  from: number
  to: number
  stacks: number
  sourcePlayerId: number
  sourceCastEventId: string
}
```

- [ ] **Step 1.2：新建 `src/utils/placement/types.ts`**

```ts
/**
 * Placement 架构公共类型：合法区间、放置上下文、引擎接口。
 */

import type { CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { StatusInterval } from '@/types/status'

/**
 * 半开区间 [from, to)，单位秒。按 `from` 升序、互不重叠。
 * 空数组表示永不可放。
 */
export interface Interval {
  from: number
  to: number
}

/**
 * 放置约束上下文。由 engine 在查询时构造并传给 `Placement.validIntervals`。
 */
export interface PlacementContext {
  action: MitigationAction
  playerId: number
  /** 拖拽/回溯场景提供；新建时 undefined */
  castEvent?: CastEvent
  /** 整条时间轴；若查询带 excludeId，已过滤掉该 cast */
  castEvents: CastEvent[]
  actions: Map<number, MitigationAction>
  /** playerId → statusId → StatusInterval[]（若 excludeId 已触发重放，这里是重放结果） */
  statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
}

export interface Placement {
  validIntervals: (ctx: PlacementContext) => Interval[]
}

export type InvalidReason = 'placement_lost' | 'cooldown_conflict' | 'both'

export interface InvalidCastEvent {
  castEvent: CastEvent
  reason: InvalidReason
}

export interface PlacementEngine {
  getValidIntervals(
    action: MitigationAction,
    playerId: number,
    excludeCastEventId?: string
  ): Interval[]
  computeTrackShadow(trackGroup: number, playerId: number, excludeCastEventId?: string): Interval[]
  pickUniqueMember(
    trackGroup: number,
    playerId: number,
    t: number,
    excludeCastEventId?: string
  ): MitigationAction | null
  canPlaceCastEvent(
    action: MitigationAction,
    playerId: number,
    t: number,
    excludeCastEventId?: string
  ): { ok: true } | { ok: false; reason: string }
  findInvalidCastEvents(excludeCastEventId?: string): InvalidCastEvent[]
}

export type StatusTimelineByPlayer = Map<number, Map<number, StatusInterval[]>>
```

- [ ] **Step 1.3：写失败测试 `src/utils/placement/intervals.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  sortIntervals,
  mergeOverlapping,
  complement,
  intersect,
  subtractIntervals,
} from './intervals'

describe('intervals', () => {
  it('sortIntervals: 按 from 升序', () => {
    expect(
      sortIntervals([
        { from: 5, to: 10 },
        { from: 0, to: 3 },
      ])
    ).toEqual([
      { from: 0, to: 3 },
      { from: 5, to: 10 },
    ])
  })

  it('mergeOverlapping: 合并相邻/重叠', () => {
    expect(
      mergeOverlapping([
        { from: 0, to: 5 },
        { from: 3, to: 7 },
        { from: 7, to: 10 },
        { from: 20, to: 25 },
      ])
    ).toEqual([
      { from: 0, to: 10 },
      { from: 20, to: 25 },
    ])
  })

  it('complement: [0, +∞) 减去并集', () => {
    const INF = Number.POSITIVE_INFINITY
    expect(
      complement([
        { from: 0, to: 5 },
        { from: 10, to: 15 },
      ])
    ).toEqual([
      { from: 5, to: 10 },
      { from: 15, to: INF },
    ])
    expect(complement([])).toEqual([{ from: 0, to: INF }])
  })

  it('intersect: 求交', () => {
    expect(
      intersect(
        [
          { from: 0, to: 10 },
          { from: 20, to: 30 },
        ],
        [{ from: 5, to: 25 }]
      )
    ).toEqual([
      { from: 5, to: 10 },
      { from: 20, to: 25 },
    ])
    expect(intersect([{ from: 0, to: 10 }], [])).toEqual([])
  })

  it('subtractIntervals: A - B 等价于 intersect(A, complement(B))', () => {
    expect(subtractIntervals([{ from: 0, to: 10 }], [{ from: 3, to: 7 }])).toEqual([
      { from: 0, to: 3 },
      { from: 7, to: 10 },
    ])
  })
})
```

- [ ] **Step 1.4：跑失败测试**

Run: `pnpm test:run src/utils/placement/intervals.test.ts`
Expected: FAIL（`Cannot find module './intervals'`）。

- [ ] **Step 1.5：最小实现 `src/utils/placement/intervals.ts`**

```ts
import type { Interval } from './types'

export function sortIntervals(intervals: Interval[]): Interval[] {
  return [...intervals].sort((a, b) => a.from - b.from)
}

/** 合并重叠或相邻（含 to === from）的区间。输入无需预排序。 */
export function mergeOverlapping(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return []
  const sorted = sortIntervals(intervals)
  const out: Interval[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    const cur = sorted[i]
    if (cur.from <= last.to) {
      last.to = Math.max(last.to, cur.to)
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

/** [0, +∞) - union(intervals)。输入已排序/未合并都可。 */
export function complement(intervals: Interval[]): Interval[] {
  const INF = Number.POSITIVE_INFINITY
  const merged = mergeOverlapping(intervals)
  if (merged.length === 0) return [{ from: 0, to: INF }]
  const out: Interval[] = []
  if (merged[0].from > 0) out.push({ from: 0, to: merged[0].from })
  for (let i = 0; i < merged.length - 1; i++) {
    out.push({ from: merged[i].to, to: merged[i + 1].from })
  }
  const last = merged[merged.length - 1]
  if (last.to < INF) out.push({ from: last.to, to: INF })
  return out
}

/** 两个有序无重叠列表求交。O(n+m)。 */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const aa = mergeOverlapping(a)
  const bb = mergeOverlapping(b)
  const out: Interval[] = []
  let i = 0
  let j = 0
  while (i < aa.length && j < bb.length) {
    const from = Math.max(aa[i].from, bb[j].from)
    const to = Math.min(aa[i].to, bb[j].to)
    if (from < to) out.push({ from, to })
    if (aa[i].to < bb[j].to) i++
    else j++
  }
  return out
}

export function subtractIntervals(a: Interval[], b: Interval[]): Interval[] {
  return intersect(a, complement(b))
}
```

- [ ] **Step 1.6：测试通过**

Run: `pnpm test:run src/utils/placement/intervals.test.ts`
Expected: PASS。

- [ ] **Step 1.7：类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 1.8：Commit（等用户授权）**

```bash
git add src/types/status.ts src/utils/placement/types.ts src/utils/placement/intervals.ts src/utils/placement/intervals.test.ts
git commit -m "feat(placement): 新增 placement 模块类型与 interval 运算"
```

---

## Task 2: Placement combinators

**Files:**

- Create: `src/utils/placement/combinators.ts`
- Create: `src/utils/placement/combinators.test.ts`

- [ ] **Step 2.1：写失败测试 `src/utils/placement/combinators.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { whileStatus, anyOf, allOf, not, difference } from './combinators'
import type { PlacementContext, StatusTimelineByPlayer } from './types'

function buildCtx(overrides: Partial<PlacementContext> = {}): PlacementContext {
  const timeline: StatusTimelineByPlayer = overrides.statusTimelineByPlayer ?? new Map()
  return {
    action: { id: 0 } as any,
    playerId: 1,
    castEvents: [],
    actions: new Map(),
    statusTimelineByPlayer: timeline,
    ...overrides,
  }
}

describe('whileStatus', () => {
  it('只保留 target = source = ctx.playerId 的 interval', () => {
    const timeline: StatusTimelineByPlayer = new Map([
      [
        1,
        new Map([
          [
            3885,
            [
              { from: 0, to: 30, stacks: 1, sourcePlayerId: 1, sourceCastEventId: 'a' },
              { from: 50, to: 60, stacks: 1, sourcePlayerId: 2, sourceCastEventId: 'b' },
            ],
          ],
        ]),
      ],
    ])
    const ctx = buildCtx({ statusTimelineByPlayer: timeline, playerId: 1 })
    expect(whileStatus(3885).validIntervals(ctx)).toEqual([{ from: 0, to: 30 }])
  })

  it('无匹配条目返回空数组', () => {
    expect(whileStatus(9999).validIntervals(buildCtx())).toEqual([])
  })
})

describe('anyOf / allOf / not / difference', () => {
  const a = { validIntervals: () => [{ from: 0, to: 10 }] }
  const b = { validIntervals: () => [{ from: 5, to: 15 }] }

  it('anyOf: union', () => {
    expect(anyOf(a, b).validIntervals(buildCtx())).toEqual([{ from: 0, to: 15 }])
  })

  it('allOf: intersection', () => {
    expect(allOf(a, b).validIntervals(buildCtx())).toEqual([{ from: 5, to: 10 }])
  })

  it('not: complement', () => {
    const INF = Number.POSITIVE_INFINITY
    expect(not(a).validIntervals(buildCtx())).toEqual([{ from: 10, to: INF }])
  })

  it('difference: A - B', () => {
    expect(difference(a, b).validIntervals(buildCtx())).toEqual([{ from: 0, to: 5 }])
  })
})
```

- [ ] **Step 2.2：跑失败测试**

Run: `pnpm test:run src/utils/placement/combinators.test.ts`
Expected: FAIL。

- [ ] **Step 2.3：实现 `src/utils/placement/combinators.ts`**

```ts
import type { Placement, PlacementContext } from './types'
import { complement, intersect, mergeOverlapping, subtractIntervals } from './intervals'

/**
 * 玩家自己身上、自己施放的某个 status 的区间集。
 * 同时按 target playerId（statusTimelineByPlayer 的外层 key）与 sourcePlayerId
 * 过滤为 ctx.playerId——MVP 只覆盖"个人 buff"语义，raidwide 放到后续扩展。
 */
export function whileStatus(statusId: number): Placement {
  return {
    validIntervals: (ctx: PlacementContext) => {
      const byStatus = ctx.statusTimelineByPlayer.get(ctx.playerId)
      const raw = byStatus?.get(statusId) ?? []
      const filtered = raw.filter(si => si.sourcePlayerId === ctx.playerId)
      return mergeOverlapping(filtered.map(si => ({ from: si.from, to: si.to })))
    },
  }
}

export function anyOf(...rules: Placement[]): Placement {
  return {
    validIntervals: ctx => mergeOverlapping(rules.flatMap(r => r.validIntervals(ctx))),
  }
}

export function allOf(...rules: Placement[]): Placement {
  return {
    validIntervals: ctx => {
      if (rules.length === 0) {
        return [{ from: 0, to: Number.POSITIVE_INFINITY }]
      }
      return rules.map(r => r.validIntervals(ctx)).reduce((acc, next) => intersect(acc, next))
    },
  }
}

export function not(rule: Placement): Placement {
  return {
    validIntervals: ctx => complement(rule.validIntervals(ctx)),
  }
}

export function difference(a: Placement, b: Placement): Placement {
  return {
    validIntervals: ctx => subtractIntervals(a.validIntervals(ctx), b.validIntervals(ctx)),
  }
}
```

- [ ] **Step 2.4：测试通过**

Run: `pnpm test:run src/utils/placement/combinators.test.ts`
Expected: PASS。

- [ ] **Step 2.5：Commit（等用户授权）**

```bash
git add src/utils/placement/combinators.ts src/utils/placement/combinators.test.ts
git commit -m "feat(placement): 新增 whileStatus/anyOf/allOf/not/difference combinator"
```

---

## Task 3: `MitigationAction` 扩 `trackGroup` + `placement`；effective helper

**Files:**

- Modify: `src/types/mitigation.ts`

- [ ] **Step 3.1：`MitigationAction` 加字段**

在 `MitigationAction` interface 内、`statDataEntries` 之后追加：

```ts
  /**
   * 渲染轨道归属。默认 = id（独立成轨）。
   * 设置后，本 action 的 castEvent 渲染到 trackGroup 指向的 action 轨道上。
   * 约束：trackGroup 指向的 action 本身 `trackGroup` 必须是 undefined（禁止链式挂载）。
   */
  trackGroup?: number
  /**
   * 额外放置约束。未声明时仅受基础 CD 冲突检测。
   * 共用轨道（同 trackGroup）的所有成员必须都声明 placement，
   * 且成员间的 validIntervals 必须两两互斥、并集覆盖全时间轴。
   */
  placement?: import('@/utils/placement/types').Placement
```

- [ ] **Step 3.2：同文件底部追加 `effectiveTrackGroup` helper**

```ts
/**
 * 技能的有效轨道归属。未声明 trackGroup 时自成一组，返回自身 id。
 */
export function effectiveTrackGroup(action: MitigationAction): number {
  return action.trackGroup ?? action.id
}

/**
 * 两个 action 是否属于同一渲染轨道。
 */
export function sameTrack(a: MitigationAction, b: MitigationAction): boolean {
  return effectiveTrackGroup(a) === effectiveTrackGroup(b)
}
```

- [ ] **Step 3.3：类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 3.4：Commit（等用户授权）**

```bash
git add src/types/mitigation.ts
git commit -m "feat(mitigation): MitigationAction 加 trackGroup/placement 字段"
```

---

## Task 4: `MitigationCalculator.simulate()` 基础骨架（无 statusTimelineByPlayer）

**思路**：先把 `useDamageCalculation` 里的 walk 逻辑平移到 `MitigationCalculator.simulate()` 成纯函数，暂不产出 timeline；这一步保证行为 1:1 等价，能跑通现有测试。下一 task 再补 timeline 产出。

**Files:**

- Modify: `src/utils/mitigationCalculator.ts`
- Modify: `src/utils/mitigationCalculator.test.ts`
- Modify: `src/hooks/useDamageCalculation.ts`

- [ ] **Step 4.1：在 `mitigationCalculator.ts` 顶部新增 `SimulateInput/Output` 类型**

在 `CalculateOptions` 之后、`MitigationCalculator` class 之前插入：

```ts
import type { CastEvent, TimelineStatData } from '@/types/timeline'
import type { StatusInterval } from '@/types/status'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getJobRole } from '@/data/jobs'

export interface SimulateInput {
  castEvents: CastEvent[]
  damageEvents: DamageEvent[]
  initialState: PartyState
  statistics?: TimelineStatData
  /**
   * composition 中的坦克 playerId 列表，按 composition 自然序。
   * 提供时坦专事件走多坦路径；不提供时单路径。由 hook 从 timeline.composition 派生后传入。
   */
  tankPlayerIds?: number[]
  /**
   * 用于多坦路径的基线 max HP（tankReferenceMaxHP，来自 resolveStatData）；
   * 亦透传给 calculator.calculate 的 baseReferenceMaxHP。
   */
  baseReferenceMaxHPForTank?: number
  /**
   * 非坦事件的基线 max HP（referenceMaxHP，来自 resolveStatData），
   * 用于 calculator.calculate 的 baseReferenceMaxHP（单路径路径）。
   */
  baseReferenceMaxHPForAoe?: number
}

export interface SimulateOutput {
  damageResults: Map<string, CalculationResult>
  /** playerId → statusId → StatusInterval[]；task 5 才填充，本 task 返回空 Map */
  statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
}
```

- [ ] **Step 4.2：把 `useDamageCalculation` 里编辑模式 walk 搬进 `MitigationCalculator.simulate`**

在 `MitigationCalculator` class 内、`calculate` 方法之后追加：

```ts
  /**
   * 纯函数版全时间轴模拟。产出每个 damageEvent 的计算结果与
   * （下一 task 起）statusTimelineByPlayer。编辑模式专用，不走回放路径。
   *
   * PlacementEngine 在处理 excludeCastEventId 时会以过滤后的 castEvents 重新调用，
   * 因此本方法必须是纯函数，不读/写调用方状态。
   */
  simulate(input: SimulateInput): SimulateOutput {
    const TICK_INTERVAL = 3
    const {
      castEvents,
      damageEvents,
      initialState,
      statistics,
      tankPlayerIds = [],
      baseReferenceMaxHPForTank = 0,
      baseReferenceMaxHPForAoe = 0,
    } = input

    const damageResults = new Map<string, CalculationResult>()
    const statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>> = new Map()

    const advanceToTime = (state: PartyState, prev: number, cur: number): PartyState => {
      let next = state
      const firstTick = Math.floor(prev / TICK_INTERVAL) * TICK_INTERVAL + TICK_INTERVAL
      for (let t = firstTick; t <= cur; t += TICK_INTERVAL) {
        for (const status of next.statuses) {
          if (status.startTime > t || status.endTime < t) continue
          const meta = getStatusById(status.statusId)
          if (!meta?.executor?.onTick) continue
          const result = meta.executor.onTick({ status, tickTime: t, partyState: next })
          if (result) next = result
        }
      }
      for (const status of next.statuses) {
        if (status.endTime >= cur) continue
        const meta = getStatusById(status.statusId)
        if (!meta?.executor?.onExpire) continue
        const result = meta.executor.onExpire({ status, expireTime: cur, partyState: next })
        if (result) next = result
      }
      return { ...next, statuses: next.statuses.filter(s => s.endTime >= cur) }
    }

    const sortedDamage = [...damageEvents].sort((a, b) => a.time - b.time)
    const sortedCasts = [...castEvents].sort((a, b) => a.timestamp - b.timestamp)

    let currentState: PartyState = {
      statuses: [...initialState.statuses],
      timestamp: initialState.timestamp,
    }
    let lastAdvanceTime = 0
    let castIdx = 0

    for (const event of sortedDamage) {
      const filterTime = event.snapshotTime ?? event.time
      while (castIdx < sortedCasts.length && sortedCasts[castIdx].timestamp <= event.time) {
        const castEvent = sortedCasts[castIdx]
        const action = MITIGATION_DATA.actions.find(a => a.id === castEvent.actionId)
        if (action) {
          const castAdvanceTarget = Math.min(castEvent.timestamp, filterTime)
          currentState = advanceToTime(currentState, lastAdvanceTime, castAdvanceTarget)
          lastAdvanceTime = castAdvanceTarget
          const ctx = {
            actionId: castEvent.actionId,
            useTime: castEvent.timestamp,
            partyState: currentState,
            sourcePlayerId: castEvent.playerId,
            statistics,
          }
          if (action.executor) currentState = action.executor(ctx)
        }
        castIdx++
      }

      currentState = advanceToTime(currentState, lastAdvanceTime, filterTime)
      lastAdvanceTime = filterTime

      const includeTankOnly = event.type === 'tankbuster' || event.type === 'auto'
      const baseReferenceMaxHP = includeTankOnly
        ? baseReferenceMaxHPForTank
        : baseReferenceMaxHPForAoe
      const tankIds = includeTankOnly ? tankPlayerIds : []

      const result = this.calculate(event, currentState, {
        baseReferenceMaxHP,
        tankPlayerIds: tankIds,
      })
      damageResults.set(event.id, result)
      if (result.updatedPartyState) currentState = result.updatedPartyState
    }

    return { damageResults, statusTimelineByPlayer }
  }
```

- [ ] **Step 4.3：`useDamageCalculation` 编辑模式改用 `calculator.simulate`**

替换 hook 里 `if (!partyState) { ... }` 之后到 `return results` 之前的整段编辑模式代码为：

```ts
const resolved = resolveStatData(timeline.statData, statistics, timeline.composition)
const tankPlayerIds = timeline.composition.players
  .filter(p => getJobRole(p.job) === 'tank')
  .map(p => p.id)

const { damageResults } = calculator.simulate({
  castEvents: timeline.castEvents || [],
  damageEvents: timeline.damageEvents,
  initialState: partyState,
  statistics: resolved,
  tankPlayerIds,
  baseReferenceMaxHPForTank: resolved.tankReferenceMaxHP!,
  baseReferenceMaxHPForAoe: resolved.referenceMaxHP!,
})
for (const [id, result] of damageResults) results.set(id, result)
return results
```

同时清理 hook 顶部不再用到的 import（`getJobRole` 保留；`ActionExecutionContext` 若无其它引用可删；`MITIGATION_DATA` 若无其它引用可删；`getStatusById` 若无其它引用可删）。

- [ ] **Step 4.4：跑原有测试验证 1:1 等价**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts src/hooks/useDamageCalculation.test.ts`
Expected: 全部通过（行为等价）。

- [ ] **Step 4.5：类型检查 + lint**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm lint`
Expected: 全绿。

- [ ] **Step 4.6：Commit（等用户授权）**

```bash
git add src/utils/mitigationCalculator.ts src/hooks/useDamageCalculation.ts
git commit -m "refactor(mitigation): 抽 MitigationCalculator.simulate 为纯函数"
```

---

## Task 5: `simulate` 产出 `statusTimelineByPlayer`

**思路**：在 `simulate` 的 walk 循环里，每次 state 转移后对 `statuses` 做 instanceId diff —— 新出现的 status 记为 attach（开区间），消失的记为 consume/clear（闭区间）。walk 结束后剩余开区间用 `endTime` 收束。每次 attach 记录触发该 attach 的 `castEvent.id` 作为 `sourceCastEventId`。

**Files:**

- Modify: `src/utils/mitigationCalculator.ts`
- Modify: `src/utils/mitigationCalculator.test.ts`

- [ ] **Step 5.1：写失败测试 —— simulate 输出 timeline**

在 `src/utils/mitigationCalculator.test.ts` 的顶层 `describe` 内新增：

```ts
describe('simulate → statusTimelineByPlayer', () => {
  it('记录 cast executor attach 的 status interval（from = cast 时间，to = endTime）', () => {
    // 节制 16536：executor 会 attach 1873，duration 25s（不改 executor，仅用作 attach 验证样本）
    const castEvents = [{ id: 'c1', actionId: 16536, playerId: 1, timestamp: 10 } as any]
    const calc = new MitigationCalculator()
    const { statusTimelineByPlayer } = calc.simulate({
      castEvents,
      damageEvents: [{ id: 'd1', time: 100, damage: 100000, type: 'aoe' } as any],
      initialState: { statuses: [], timestamp: 0 },
    })
    const list = statusTimelineByPlayer.get(1)?.get(1873) ?? []
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      from: 10,
      to: 35,
      sourcePlayerId: 1,
      sourceCastEventId: 'c1',
    })
  })

  it('炽天附体 37014 attach 3885，interval from = cast 时间、to = endTime', () => {
    const castEvents = [{ id: 'c-seraph', actionId: 37014, playerId: 1, timestamp: 5 } as any]
    const calc = new MitigationCalculator()
    const { statusTimelineByPlayer } = calc.simulate({
      castEvents,
      damageEvents: [{ id: 'd1', time: 100, damage: 100000, type: 'aoe' } as any],
      initialState: { statuses: [], timestamp: 0 },
    })
    const list = statusTimelineByPlayer.get(1)?.get(3885) ?? []
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ from: 5, to: 35, sourceCastEventId: 'c-seraph' })
  })

  it('同一技能二次施放：旧 instance 被 createBuffExecutor 移除 → 旧 interval 在二次施放点收束，新 interval 自二次施放点开', () => {
    // 证明 simulate diff 机制对"status instance 从 statuses 列表消失"的处理
    // 覆盖未来 follow-up 中 consume 场景走的同一条 diff 路径：simulate 只看 instanceId 差异，
    // 不区分消失原因（refresh 覆盖 / consume / 自然过期），因此这里用 createBuffExecutor 现成的
    // "移除同 id 旧实例再 attach 新实例"行为作为 consume 语义的同构单元验证。
    const castEvents = [
      { id: 'first', actionId: 16536, playerId: 1, timestamp: 10 } as any,
      { id: 'second', actionId: 16536, playerId: 1, timestamp: 20 } as any,
    ]
    const calc = new MitigationCalculator()
    const { statusTimelineByPlayer } = calc.simulate({
      castEvents,
      damageEvents: [{ id: 'd1', time: 100, damage: 100000, type: 'aoe' } as any],
      initialState: { statuses: [], timestamp: 0 },
    })
    const list = statusTimelineByPlayer.get(1)?.get(1873) ?? []
    expect(list).toHaveLength(2)
    // 旧 interval：[10, 20)（二次施放时 createBuffExecutor 移除旧 instance → diff 关闭）
    expect(list[0]).toMatchObject({ from: 10, to: 20, sourceCastEventId: 'first' })
    // 新 interval：[20, 45)（二次施放 attach 新 instance）
    expect(list[1]).toMatchObject({ from: 20, to: 45, sourceCastEventId: 'second' })
  })
})
```

- [ ] **Step 5.2：跑失败测试**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts -t "statusTimelineByPlayer"`
Expected: FAIL（长度 0）。

- [ ] **Step 5.3：在 `simulate` 方法内实现 diff 记录**

替换 `simulate` 方法体：用下面的 diff 逻辑包装原 walk。关键改动：

1. 顶部新增 `openIntervals` 与 `closeInterval` / `recordAttach` helper
2. 在 `advanceToTime` 前后、`action.executor` 前后、`calculate` 前后分别调用 `captureTransition(prevState, nextState, { at, castEventId? })`
3. 最后 finalize 所有 openIntervals（用 status.endTime 收束）

具体替换：把 Task 4.2 的整个 `simulate` 方法替换为：

```ts
  simulate(input: SimulateInput): SimulateOutput {
    const TICK_INTERVAL = 3
    const {
      castEvents,
      damageEvents,
      initialState,
      statistics,
      tankPlayerIds = [],
      baseReferenceMaxHPForTank = 0,
      baseReferenceMaxHPForAoe = 0,
    } = input

    const damageResults = new Map<string, CalculationResult>()
    const statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>> = new Map()

    // 记录所有当前活跃的状态 instance：instanceId → partial StatusInterval（尚未关 to）
    interface OpenRecord {
      statusId: number
      /** 归属 target 的玩家 id。MVP 等同于 sourcePlayerId（个人 buff 语义） */
      targetPlayerId: number
      sourcePlayerId: number
      sourceCastEventId: string
      from: number
      stacks: number
      /** 最近快照里看到的 endTime，finalize 时用作 to 的上限 */
      endTime: number
    }
    const open = new Map<string, OpenRecord>()

    const pushInterval = (rec: OpenRecord, to: number) => {
      const byStatus = statusTimelineByPlayer.get(rec.targetPlayerId) ?? new Map()
      const arr = byStatus.get(rec.statusId) ?? []
      arr.push({
        from: rec.from,
        to,
        stacks: rec.stacks,
        sourcePlayerId: rec.sourcePlayerId,
        sourceCastEventId: rec.sourceCastEventId,
      })
      byStatus.set(rec.statusId, arr)
      statusTimelineByPlayer.set(rec.targetPlayerId, byStatus)
    }

    /**
     * 把 state → state' 的 status instance 差异落到 open / statusTimelineByPlayer：
     *   新出现的 instance：open 一条，from = at；sourceCastEventId 取 castEventIdHint 或
     *     instance.sourceActionId 对应的"最近该玩家刚出手的 cast"（降级用 at）
     *   消失的 instance：pushInterval(rec, to = at)
     *   仍存在的 instance：更新 open 里的 endTime 快照
     */
    const captureTransition = (
      prev: PartyState,
      next: PartyState,
      at: number,
      castEventIdHint?: string,
      castPlayerIdHint?: number
    ) => {
      const prevIds = new Set(prev.statuses.map(s => s.instanceId))
      const nextIds = new Set(next.statuses.map(s => s.instanceId))

      // 消失：关区间
      for (const id of prevIds) {
        if (nextIds.has(id)) continue
        const rec = open.get(id)
        if (rec) {
          pushInterval(rec, at)
          open.delete(id)
        }
      }

      // 新增：开区间
      for (const s of next.statuses) {
        if (prevIds.has(s.instanceId)) continue
        const target = s.sourcePlayerId ?? castPlayerIdHint ?? 0
        open.set(s.instanceId, {
          statusId: s.statusId,
          targetPlayerId: target,
          sourcePlayerId: s.sourcePlayerId ?? castPlayerIdHint ?? target,
          sourceCastEventId: castEventIdHint ?? '',
          from: at,
          stacks: s.stack ?? 1,
          endTime: s.endTime,
        })
      }

      // 仍在场：刷新 endTime 快照（供 finalize 用）
      for (const s of next.statuses) {
        const rec = open.get(s.instanceId)
        if (!rec) continue
        rec.endTime = s.endTime
        rec.stacks = s.stack ?? rec.stacks
      }
    }

    const advanceToTime = (state: PartyState, prev: number, cur: number): PartyState => {
      let next = state
      const firstTick = Math.floor(prev / TICK_INTERVAL) * TICK_INTERVAL + TICK_INTERVAL
      for (let t = firstTick; t <= cur; t += TICK_INTERVAL) {
        for (const status of next.statuses) {
          if (status.startTime > t || status.endTime < t) continue
          const meta = getStatusById(status.statusId)
          if (!meta?.executor?.onTick) continue
          const result = meta.executor.onTick({ status, tickTime: t, partyState: next })
          if (result) next = result
        }
      }
      for (const status of next.statuses) {
        if (status.endTime >= cur) continue
        const meta = getStatusById(status.statusId)
        if (!meta?.executor?.onExpire) continue
        const result = meta.executor.onExpire({ status, expireTime: cur, partyState: next })
        if (result) next = result
      }
      return { ...next, statuses: next.statuses.filter(s => s.endTime >= cur) }
    }

    const sortedDamage = [...damageEvents].sort((a, b) => a.time - b.time)
    const sortedCasts = [...castEvents].sort((a, b) => a.timestamp - b.timestamp)

    let currentState: PartyState = {
      statuses: [...initialState.statuses],
      timestamp: initialState.timestamp,
    }
    // 初始状态的 open 区间（用户 seeded buff 等）：with castEventId ''（空字符串）
    captureTransition({ statuses: [], timestamp: 0 }, currentState, 0)

    let lastAdvanceTime = 0
    let castIdx = 0

    for (const event of sortedDamage) {
      const filterTime = event.snapshotTime ?? event.time
      while (castIdx < sortedCasts.length && sortedCasts[castIdx].timestamp <= event.time) {
        const castEvent = sortedCasts[castIdx]
        const action = MITIGATION_DATA.actions.find(a => a.id === castEvent.actionId)
        if (action) {
          const castAdvanceTarget = Math.min(castEvent.timestamp, filterTime)
          const prevState = currentState
          currentState = advanceToTime(currentState, lastAdvanceTime, castAdvanceTarget)
          captureTransition(prevState, currentState, castAdvanceTarget)
          lastAdvanceTime = castAdvanceTarget

          if (action.executor) {
            const before = currentState
            const ctx = {
              actionId: castEvent.actionId,
              useTime: castEvent.timestamp,
              partyState: currentState,
              sourcePlayerId: castEvent.playerId,
              statistics,
            }
            currentState = action.executor(ctx)
            captureTransition(
              before,
              currentState,
              castEvent.timestamp,
              castEvent.id,
              castEvent.playerId
            )
          }
        }
        castIdx++
      }

      const beforeAdvance = currentState
      currentState = advanceToTime(currentState, lastAdvanceTime, filterTime)
      captureTransition(beforeAdvance, currentState, filterTime)
      lastAdvanceTime = filterTime

      const includeTankOnly = event.type === 'tankbuster' || event.type === 'auto'
      const baseReferenceMaxHP = includeTankOnly
        ? baseReferenceMaxHPForTank
        : baseReferenceMaxHPForAoe
      const tankIds = includeTankOnly ? tankPlayerIds : []

      const beforeCalc = currentState
      const result = this.calculate(event, currentState, {
        baseReferenceMaxHP,
        tankPlayerIds: tankIds,
      })
      damageResults.set(event.id, result)
      if (result.updatedPartyState) {
        currentState = result.updatedPartyState
        captureTransition(beforeCalc, currentState, filterTime)
      }
    }

    // finalize：所有仍开着的区间用 endTime 收束
    for (const [, rec] of open) {
      pushInterval(rec, rec.endTime)
    }
    open.clear()

    // 每条 status 列表按 from 排序
    for (const byStatus of statusTimelineByPlayer.values()) {
      for (const list of byStatus.values()) {
        list.sort((a, b) => a.from - b.from)
      }
    }

    return { damageResults, statusTimelineByPlayer }
  }
```

- [ ] **Step 5.4：测试通过**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts -t "statusTimelineByPlayer"`
Expected: PASS。

- [ ] **Step 5.5：同时确保旧的 damage 测试不受影响**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts src/hooks/useDamageCalculation.test.ts`
Expected: 全部通过。

- [ ] **Step 5.6：Commit（等用户授权）**

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "feat(mitigation): simulate 产出 statusTimelineByPlayer（按 cast diff 记录）"
```

---

## Task 6: `createPlacementEngine` 骨架 —— cooldown + getValidIntervals（无 excludeId）

**Files:**

- Create: `src/utils/placement/engine.ts`
- Create: `src/utils/placement/engine.test.ts`

- [ ] **Step 6.1：写失败测试 engine.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { createPlacementEngine } from './engine'
import { whileStatus, not } from './combinators'
import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { StatusInterval } from '@/types/status'

const INF = Number.POSITIVE_INFINITY

function makeAction(partial: Partial<MitigationAction> & { id: number }): MitigationAction {
  return {
    name: 'A',
    icon: '',
    jobs: [] as any,
    category: ['partywide'],
    duration: 30,
    cooldown: 60,
    ...partial,
  } as MitigationAction
}

describe('createPlacementEngine — 基础查询', () => {
  it('无 placement，无 cast → getValidIntervals = [[0, +∞)]', () => {
    const action = makeAction({ id: 1 })
    const engine = createPlacementEngine({
      castEvents: [],
      actions: new Map([[1, action]]),
      simulate: () => ({ statusTimelineByPlayer: new Map() }),
    })
    expect(engine.getValidIntervals(action, 10)).toEqual([{ from: 0, to: INF }])
  })

  it('一次 cast 产生 CD 禁区', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const castEvents: CastEvent[] = [{ id: 'c1', actionId: 1, playerId: 10, timestamp: 30 } as any]
    const engine = createPlacementEngine({
      castEvents,
      actions: new Map([[1, action]]),
      simulate: () => ({ statusTimelineByPlayer: new Map() }),
    })
    expect(engine.getValidIntervals(action, 10)).toEqual([
      { from: 0, to: 30 },
      { from: 90, to: INF },
    ])
  })

  it('placement ∩ CD', () => {
    const BUFF = 3885
    const timeline = new Map([
      [
        10,
        new Map([
          [
            BUFF,
            [
              {
                from: 20,
                to: 50,
                stacks: 1,
                sourcePlayerId: 10,
                sourceCastEventId: 'a',
              } as StatusInterval,
            ],
          ],
        ]),
      ],
    ])
    const action = makeAction({
      id: 1,
      cooldown: 60,
      placement: { validIntervals: ctx => whileStatus(BUFF).validIntervals(ctx) },
    })
    const engine = createPlacementEngine({
      castEvents: [{ id: 'c1', actionId: 1, playerId: 10, timestamp: 25 } as any],
      actions: new Map([[1, action]]),
      simulate: () => ({ statusTimelineByPlayer: timeline }),
    })
    // placement = [20, 50)，CD = [0, 25) ∪ [85, ∞)；交集 = [20, 25)
    expect(engine.getValidIntervals(action, 10)).toEqual([{ from: 20, to: 25 }])
  })
})
```

- [ ] **Step 6.2：跑失败测试**

Run: `pnpm test:run src/utils/placement/engine.test.ts`
Expected: FAIL（`Cannot find module './engine'`）。

- [ ] **Step 6.3：实现 `src/utils/placement/engine.ts`（仅本 task 范围）**

```ts
import type { CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import { effectiveTrackGroup } from '@/types/mitigation'
import type { Interval, PlacementContext, PlacementEngine, StatusTimelineByPlayer } from './types'
import { complement, intersect, mergeOverlapping, sortIntervals } from './intervals'

export interface PlacementEngineInput {
  castEvents: CastEvent[]
  actions: Map<number, MitigationAction>
  simulate: (castEvents: CastEvent[]) => { statusTimelineByPlayer: StatusTimelineByPlayer }
}

export function createPlacementEngine(input: PlacementEngineInput): PlacementEngine {
  const { castEvents, actions, simulate } = input
  const defaultTimeline = simulate(castEvents).statusTimelineByPlayer

  // task 7 补齐 trackGroupMembers / excludedTimelineCache / shadow / unique / findInvalid
  function timelineFor(_excludeId?: string): StatusTimelineByPlayer {
    return defaultTimeline
  }

  function effectiveCastEvents(_excludeId?: string): CastEvent[] {
    return castEvents
  }

  function buildContext(
    action: MitigationAction,
    playerId: number,
    excludeId: string | undefined,
    castEvent?: CastEvent
  ): PlacementContext {
    return {
      action,
      playerId,
      castEvent,
      castEvents: effectiveCastEvents(excludeId),
      actions,
      statusTimelineByPlayer: timelineFor(excludeId),
    }
  }

  function cooldownAvailable(
    action: MitigationAction,
    playerId: number,
    ctxEvents: CastEvent[]
  ): Interval[] {
    const groupId = effectiveTrackGroup(action)
    const forbidden: Interval[] = []
    for (const e of ctxEvents) {
      if (e.playerId !== playerId) continue
      const other = actions.get(e.actionId)
      if (!other) continue
      if (effectiveTrackGroup(other) !== groupId) continue
      forbidden.push({ from: e.timestamp, to: e.timestamp + other.cooldown })
    }
    return complement(mergeOverlapping(sortIntervals(forbidden)))
  }

  function getValidIntervals(
    action: MitigationAction,
    playerId: number,
    excludeId?: string
  ): Interval[] {
    const ctx = buildContext(action, playerId, excludeId)
    const placementIntervals = action.placement
      ? action.placement.validIntervals(ctx)
      : [{ from: 0, to: Number.POSITIVE_INFINITY }]
    const cd = cooldownAvailable(action, playerId, ctx.castEvents)
    return intersect(placementIntervals, cd)
  }

  return {
    getValidIntervals,
    // 下列三个在 task 7 实现
    computeTrackShadow: () => {
      throw new Error('computeTrackShadow not implemented yet')
    },
    pickUniqueMember: () => {
      throw new Error('pickUniqueMember not implemented yet')
    },
    canPlaceCastEvent: () => {
      throw new Error('canPlaceCastEvent not implemented yet')
    },
    findInvalidCastEvents: () => {
      throw new Error('findInvalidCastEvents not implemented yet')
    },
  }
}
```

- [ ] **Step 6.4：测试通过**

Run: `pnpm test:run src/utils/placement/engine.test.ts`
Expected: PASS。

- [ ] **Step 6.5：Commit（等用户授权）**

```bash
git add src/utils/placement/engine.ts src/utils/placement/engine.test.ts
git commit -m "feat(placement): engine 骨架 + getValidIntervals"
```

---

## Task 7: Engine shadow / unique / canPlace / findInvalid

**Files:**

- Modify: `src/utils/placement/engine.ts`
- Modify: `src/utils/placement/engine.test.ts`

- [ ] **Step 7.1：测试 `computeTrackShadow` / `pickUniqueMember` / `canPlaceCastEvent` / `findInvalidCastEvents`**

在 engine.test.ts 追加：

```ts
describe('createPlacementEngine — shadow / unique / findInvalid', () => {
  const BUFF = 3885
  const timeline = new Map([
    [
      10,
      new Map([
        [
          BUFF,
          [
            {
              from: 20,
              to: 50,
              stacks: 1,
              sourcePlayerId: 10,
              sourceCastEventId: 'a',
            } as StatusInterval,
          ],
        ],
      ]),
    ],
  ])

  const primary = makeAction({
    id: 1,
    cooldown: 10,
    placement: {
      validIntervals: ctx =>
        whileStatus(BUFF).validIntervals(ctx).length === 0
          ? [{ from: 0, to: Number.POSITIVE_INFINITY }]
          : not(whileStatus(BUFF)).validIntervals(ctx),
    },
  })
  const variant = makeAction({
    id: 2,
    trackGroup: 1,
    cooldown: 10,
    placement: whileStatus(BUFF),
  })

  const engine = createPlacementEngine({
    castEvents: [],
    actions: new Map([
      [1, primary],
      [2, variant],
    ]),
    simulate: () => ({ statusTimelineByPlayer: timeline }),
  })

  it('computeTrackShadow: 两成员 union 的补集', () => {
    // primary 合法 = !whileStatus = [0,20) ∪ [50,∞)，variant 合法 = [20,50)
    // union 覆盖全时间轴 → shadow 为空
    expect(engine.computeTrackShadow(1, 10)).toEqual([])
  })

  it('pickUniqueMember: buff 期间唯一解 = variant', () => {
    expect(engine.pickUniqueMember(1, 10, 30)?.id).toBe(2)
    expect(engine.pickUniqueMember(1, 10, 10)?.id).toBe(1)
  })

  it('canPlaceCastEvent: buff 期间 primary 非法', () => {
    const r = engine.canPlaceCastEvent(primary, 10, 30)
    expect(r.ok).toBe(false)
  })

  it('findInvalidCastEvents: 区分 placement_lost / cooldown_conflict / both', () => {
    const castEvents: CastEvent[] = [
      // buff 期间放了 primary → placement_lost
      { id: 'bad1', actionId: 1, playerId: 10, timestamp: 30 } as any,
      // CD 冲突（两次相距 < 10）
      { id: 'bad2', actionId: 2, playerId: 10, timestamp: 25 } as any,
      { id: 'bad3', actionId: 2, playerId: 10, timestamp: 28 } as any,
    ]
    const e = createPlacementEngine({
      castEvents,
      actions: new Map([
        [1, primary],
        [2, variant],
      ]),
      simulate: () => ({ statusTimelineByPlayer: timeline }),
    })
    const invalid = e.findInvalidCastEvents()
    const byId = new Map(invalid.map(r => [r.castEvent.id, r.reason]))
    expect(byId.get('bad1')).toBe('placement_lost')
    // bad3 距 bad2 只差 3s，variant CD=10 → 互斥。bad3 在 buff 期间 placement 合法 → 仅 cooldown_conflict
    expect(byId.get('bad3')).toBe('cooldown_conflict')
  })

  it('findInvalidCastEvents: 单个合法 cast 不会因自身 CD 把自己挡掉（自冲突防御）', () => {
    // 回归测试：cooldownAvailable 遍历同轨 castEvents 时必须排除"正在回溯的 cast"自己，
    // 否则 cast 自身的 [timestamp, timestamp + cooldown) 会包含其 timestamp，
    // 导致 cooldownOk=false 产生假阳性。
    const SOLO: CastEvent = { id: 'solo', actionId: 2, playerId: 10, timestamp: 30 } as any
    const e = createPlacementEngine({
      castEvents: [SOLO],
      actions: new Map([
        [1, primary],
        [2, variant],
      ]),
      simulate: () => ({ statusTimelineByPlayer: timeline }),
    })
    expect(e.findInvalidCastEvents()).toEqual([])
  })
})
```

- [ ] **Step 7.2：跑失败测试**

Run: `pnpm test:run src/utils/placement/engine.test.ts`
Expected: FAIL（`not implemented yet`）。

- [ ] **Step 7.3：替换 engine.ts 的 stub 返回对象**

把 `createPlacementEngine` return 前加上实现，并替换 return：

```ts
const trackGroupMembers = new Map<number, MitigationAction[]>()
for (const action of actions.values()) {
  const gid = effectiveTrackGroup(action)
  const arr = trackGroupMembers.get(gid) ?? []
  arr.push(action)
  trackGroupMembers.set(gid, arr)
}

function computeTrackShadow(groupId: number, playerId: number, excludeId?: string): Interval[] {
  const members = trackGroupMembers.get(groupId) ?? []
  const legal = members.flatMap(m => getValidIntervals(m, playerId, excludeId))
  return complement(mergeOverlapping(sortIntervals(legal)))
}

function canPlaceCastEvent(
  action: MitigationAction,
  playerId: number,
  t: number,
  excludeId?: string
): { ok: true } | { ok: false; reason: string } {
  const intervals = getValidIntervals(action, playerId, excludeId)
  if (intervals.some(i => i.from <= t && t < i.to)) return { ok: true }
  return { ok: false, reason: 'not_available' }
}

function pickUniqueMember(
  groupId: number,
  playerId: number,
  t: number,
  excludeId?: string
): MitigationAction | null {
  const members = trackGroupMembers.get(groupId) ?? []
  const legal = members.filter(m => canPlaceCastEvent(m, playerId, t, excludeId).ok)
  return legal.length === 1 ? legal[0] : null
}

function findInvalidCastEvents(excludeId?: string) {
  const result: import('./types').InvalidCastEvent[] = []
  const events = effectiveCastEvents(excludeId).filter(e => e.id !== excludeId)
  for (const castEvent of events) {
    const action = actions.get(castEvent.actionId)
    if (!action) continue
    const t = castEvent.timestamp
    const ctx = buildContext(action, castEvent.playerId, excludeId, castEvent)
    const placementOk =
      !action.placement || action.placement.validIntervals(ctx).some(i => i.from <= t && t < i.to)
    const cooldownOk = cooldownAvailable(
      action,
      castEvent.playerId,
      // castEvent 自己一定在 ctx.castEvents 中；要排除它自己避免自我 CD 冲突
      ctx.castEvents.filter(e => e.id !== castEvent.id)
    ).some(i => i.from <= t && t < i.to)
    if (placementOk && cooldownOk) continue
    const reason =
      !placementOk && !cooldownOk
        ? ('both' as const)
        : !placementOk
          ? ('placement_lost' as const)
          : ('cooldown_conflict' as const)
    result.push({ castEvent, reason })
  }
  return result
}

return {
  getValidIntervals,
  computeTrackShadow,
  pickUniqueMember,
  canPlaceCastEvent,
  findInvalidCastEvents,
}
```

- [ ] **Step 7.4：测试通过**

Run: `pnpm test:run src/utils/placement/engine.test.ts`
Expected: 全部 PASS。

- [ ] **Step 7.5：Commit（等用户授权）**

```bash
git add src/utils/placement/engine.ts src/utils/placement/engine.test.ts
git commit -m "feat(placement): engine shadow/unique/findInvalid（含 reason 分类）"
```

---

## Task 8: `excludeCastEventId` 重放 + 缓存

**Files:**

- Modify: `src/utils/placement/engine.ts`
- Modify: `src/utils/placement/engine.test.ts`

- [ ] **Step 8.1：失败测试 —— excludeId 重放语义**

在 engine.test.ts 追加：

```ts
describe('createPlacementEngine — excludeCastEventId 重放', () => {
  it('排除 consume 型 cast 后，状态 interval 应恢复到原时长', () => {
    // 模拟：节制 16536 在 t=10 附加 status 1873（duration 25）→ [10, 35)
    //       神爱抚 37011 在 t=20 consume 1873 → [10, 20)
    // 排除神爱抚 cast 后应看到 [10, 35)
    let called = 0
    const simulate = (events: CastEvent[]) => {
      called++
      const has16536 = events.some(e => e.actionId === 16536)
      const has37011 = events.some(e => e.actionId === 37011)
      if (has16536 && has37011) {
        return {
          statusTimelineByPlayer: new Map([
            [
              10,
              new Map([
                [
                  1873,
                  [
                    {
                      from: 10,
                      to: 20,
                      stacks: 1,
                      sourcePlayerId: 10,
                      sourceCastEventId: 'c16536',
                    } as StatusInterval,
                  ],
                ],
              ]),
            ],
          ]),
        }
      }
      if (has16536) {
        return {
          statusTimelineByPlayer: new Map([
            [
              10,
              new Map([
                [
                  1873,
                  [
                    {
                      from: 10,
                      to: 35,
                      stacks: 1,
                      sourcePlayerId: 10,
                      sourceCastEventId: 'c16536',
                    } as StatusInterval,
                  ],
                ],
              ]),
            ],
          ]),
        }
      }
      return { statusTimelineByPlayer: new Map() }
    }

    const temperance = makeAction({ id: 16536, cooldown: 120 })
    const grace = makeAction({
      id: 37011,
      cooldown: 1,
      placement: whileStatus(1873),
    })
    const castEvents: CastEvent[] = [
      { id: 'c16536', actionId: 16536, playerId: 10, timestamp: 10 } as any,
      { id: 'c37011', actionId: 37011, playerId: 10, timestamp: 20 } as any,
    ]
    const engine = createPlacementEngine({
      castEvents,
      actions: new Map([
        [16536, temperance],
        [37011, grace],
      ]),
      simulate,
    })

    // 默认：grace 合法区间 = [10, 20)
    expect(engine.getValidIntervals(grace, 10)).toEqual([{ from: 10, to: 20 }])

    // 排除 c37011：grace 合法区间应恢复为 [10, 35)（CD=1 不再自我阻塞）
    const withExclude = engine.getValidIntervals(grace, 10, 'c37011')
    expect(withExclude).toEqual([{ from: 10, to: 35 }])
  })

  it('同一 excludeId 多次查询只触发 1 次 simulate（缓存命中）', () => {
    let calls = 0
    const simulate = () => {
      calls++
      return { statusTimelineByPlayer: new Map() }
    }
    const action = makeAction({ id: 1 })
    const engine = createPlacementEngine({
      castEvents: [{ id: 'c1', actionId: 1, playerId: 10, timestamp: 0 } as any],
      actions: new Map([[1, action]]),
      simulate,
    })
    // 构造时 1 次
    expect(calls).toBe(1)
    engine.getValidIntervals(action, 10, 'c1')
    engine.getValidIntervals(action, 10, 'c1')
    engine.findInvalidCastEvents('c1')
    // excludeId 命中缓存，应只再增加 1
    expect(calls).toBe(2)
  })
})
```

- [ ] **Step 8.2：跑失败测试**

Run: `pnpm test:run src/utils/placement/engine.test.ts -t "excludeCastEventId"`
Expected: FAIL。

- [ ] **Step 8.3：在 engine.ts 接入重放 + 缓存**

把 `timelineFor` / `effectiveCastEvents` 两个 helper 替换为：

```ts
const excludedTimelineCache = new Map<string, StatusTimelineByPlayer>()

function timelineFor(excludeId?: string): StatusTimelineByPlayer {
  if (!excludeId) return defaultTimeline
  const cached = excludedTimelineCache.get(excludeId)
  if (cached) return cached
  const filtered = castEvents.filter(e => e.id !== excludeId)
  const next = simulate(filtered).statusTimelineByPlayer
  excludedTimelineCache.set(excludeId, next)
  return next
}

function effectiveCastEvents(excludeId?: string): CastEvent[] {
  return excludeId ? castEvents.filter(e => e.id !== excludeId) : castEvents
}
```

- [ ] **Step 8.4：测试通过**

Run: `pnpm test:run src/utils/placement/engine.test.ts`
Expected: 全部 PASS。

- [ ] **Step 8.5：Commit（等用户授权）**

```bash
git add src/utils/placement/engine.ts src/utils/placement/engine.test.ts
git commit -m "feat(placement): engine excludeCastEventId 走 simulate 重放 + 缓存"
```

---

## Task 9: `validateActions` dev-only lint

**Files:**

- Create: `src/utils/placement/validate.ts`
- Create: `src/utils/placement/validate.test.ts`

- [ ] **Step 9.1：失败测试 validate.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { validateActions } from './validate'
import type { MitigationAction } from '@/types/mitigation'

function a(p: Partial<MitigationAction> & { id: number }): MitigationAction {
  return {
    name: 'x',
    icon: '',
    jobs: [] as any,
    category: ['partywide'],
    duration: 1,
    cooldown: 1,
    ...p,
  } as MitigationAction
}

describe('validateActions', () => {
  it('trackGroup 指向不存在的 id → error', () => {
    const issues = validateActions([a({ id: 1, trackGroup: 999 })])
    expect(issues.some(i => i.level === 'error' && i.rule === 'trackgroup-missing')).toBe(true)
  })

  it('trackGroup 链式（指向的 action 自己也有 trackGroup）→ error', () => {
    const issues = validateActions([
      a({ id: 1, trackGroup: 2 }),
      a({ id: 2, trackGroup: 3 }),
      a({ id: 3 }),
    ])
    expect(issues.some(i => i.rule === 'trackgroup-chain')).toBe(true)
  })

  it('同轨组成员必须都有 placement → error', () => {
    const issues = validateActions([
      a({ id: 1, placement: { validIntervals: () => [] } }),
      a({ id: 2, trackGroup: 1 }), // 缺 placement
    ])
    expect(issues.some(i => i.rule === 'trackgroup-placement-missing')).toBe(true)
  })

  it('同轨组 cooldown 不一致 → warn', () => {
    const issues = validateActions([
      a({ id: 1, cooldown: 60, placement: { validIntervals: () => [] } }),
      a({ id: 2, trackGroup: 1, cooldown: 1, placement: { validIntervals: () => [] } }),
    ])
    expect(issues.some(i => i.level === 'warn' && i.rule === 'trackgroup-cooldown-mismatch')).toBe(
      true
    )
  })
})
```

- [ ] **Step 9.2：跑失败测试**

Run: `pnpm test:run src/utils/placement/validate.test.ts`
Expected: FAIL。

- [ ] **Step 9.3：实现 validate.ts**

```ts
import type { MitigationAction } from '@/types/mitigation'
import { effectiveTrackGroup } from '@/types/mitigation'

export type IssueLevel = 'error' | 'warn'
export type IssueRule =
  | 'trackgroup-missing'
  | 'trackgroup-chain'
  | 'trackgroup-placement-missing'
  | 'trackgroup-cooldown-mismatch'

export interface ValidationIssue {
  level: IssueLevel
  rule: IssueRule
  actionId: number
  message: string
}

export function validateActions(actions: MitigationAction[]): ValidationIssue[] {
  const byId = new Map(actions.map(a => [a.id, a]))
  const issues: ValidationIssue[] = []

  for (const action of actions) {
    if (action.trackGroup !== undefined && action.trackGroup !== action.id) {
      const parent = byId.get(action.trackGroup)
      if (!parent) {
        issues.push({
          level: 'error',
          rule: 'trackgroup-missing',
          actionId: action.id,
          message: `trackGroup=${action.trackGroup} 指向不存在的 action`,
        })
        continue
      }
      if (parent.trackGroup !== undefined && parent.trackGroup !== parent.id) {
        issues.push({
          level: 'error',
          rule: 'trackgroup-chain',
          actionId: action.id,
          message: `trackGroup 链式：指向的 ${parent.id} 自己也有 trackGroup=${parent.trackGroup}`,
        })
      }
    }
  }

  const byGroup = new Map<number, MitigationAction[]>()
  for (const action of actions) {
    const gid = effectiveTrackGroup(action)
    const arr = byGroup.get(gid) ?? []
    arr.push(action)
    byGroup.set(gid, arr)
  }

  for (const [gid, members] of byGroup) {
    if (members.length < 2) continue
    const anyHasPlacement = members.some(m => m.placement)
    if (anyHasPlacement) {
      for (const m of members) {
        if (!m.placement) {
          issues.push({
            level: 'error',
            rule: 'trackgroup-placement-missing',
            actionId: m.id,
            message: `同轨组 ${gid} 成员必须都声明 placement`,
          })
        }
      }
    }
    const cds = new Set(members.map(m => m.cooldown))
    if (cds.size > 1) {
      for (const m of members) {
        issues.push({
          level: 'warn',
          rule: 'trackgroup-cooldown-mismatch',
          actionId: m.id,
          message: `同轨组 ${gid} cooldown 不一致：${Array.from(cds).join(', ')}`,
        })
      }
    }
  }

  return issues
}
```

- [ ] **Step 9.4：测试通过**

Run: `pnpm test:run src/utils/placement/validate.test.ts`
Expected: PASS。

- [ ] **Step 9.5：挂到 DEV-only 启动钩子**

在 `src/data/mitigationActions.ts` 文件底部（`MITIGATION_DATA` 之后）追加：

```ts
if (import.meta.env.DEV) {
  // 异步导入避免生产打包时保留 validate 代码路径
  void import('@/utils/placement/validate').then(({ validateActions }) => {
    const issues = validateActions(MITIGATION_DATA.actions)
    for (const issue of issues) {
      const msg = `[mitigationActions] ${issue.rule} on action ${issue.actionId}: ${issue.message}`
      if (issue.level === 'error') console.error(msg)
      else console.warn(msg)
    }
  })
}
```

- [ ] **Step 9.6：tsc + lint**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm lint`
Expected: 全绿。

- [ ] **Step 9.7：Commit（等用户授权）**

```bash
git add src/utils/placement/validate.ts src/utils/placement/validate.test.ts src/data/mitigationActions.ts
git commit -m "feat(placement): validateActions 启动期 lint（DEV-only）"
```

---

## Task 10: 数据迁移 —— 37013/37016（炽天附体变身）

**Files:**

- Modify: `src/data/mitigationActions.ts`

- [ ] **Step 10.1：在文件顶部（imports 之后）加常量**

```ts
import { whileStatus, not } from '@/utils/placement/combinators'

const SERAPHISM_BUFF_ID = 3885 // 炽天附体
```

- [ ] **Step 10.2：37013（意气轩昂之策）加 placement**

在 `id: 37013` 条目内 `statDataEntries` 字段之前插入：

```ts
      placement: not(whileStatus(SERAPHISM_BUFF_ID)),
```

- [ ] **Step 10.3：37016（降临之章）改为同轨变体**

把 `id: 37016` 条目的 `hidden: true,` 删除，在 `executor` 字段之前插入：

```ts
      trackGroup: 37013,
      placement: whileStatus(SERAPHISM_BUFF_ID),
```

- [ ] **Step 10.4：类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 10.5：Commit（等用户授权）**

```bash
git add src/data/mitigationActions.ts
git commit -m "feat(data): 37013/37016 改为 placement + trackGroup 声明"
```

---

## Task 11: UI 过滤层 —— hidden → trackGroup

**Files:**

- Modify: `src/utils/skillTracks.ts`
- Modify: `src/store/mitigationStore.ts`
- Modify: `src/components/FilterMenu/EditPresetDialog.tsx`

**先决扫描**：本任务开始前确认 `!a.hidden` / `!action.hidden` 的全部消费点。当前已知：

```
src/store/mitigationStore.ts:62
src/components/FilterMenu/EditPresetDialog.tsx:48
src/utils/skillTracks.ts:34
```

本 task 三处一起改。Step 11.4 用 `rg` 做最终兜底——**不是 best-effort 人工扫，而是必须 0 匹配**。

- [ ] **Step 11.1：`skillTracks.ts` 过滤规则**

把 `src/utils/skillTracks.ts:34` 的 `!a.hidden` 替换为：

```ts
const jobActions = actions.filter(
  a => a.jobs.includes(player.job) && (!a.trackGroup || a.trackGroup === a.id)
)
```

- [ ] **Step 11.2：`mitigationStore.ts` getFilteredActions**

把 `src/store/mitigationStore.ts:62` 的 `!action.hidden` 替换为：

```ts
const visible = actions.filter(action => !action.trackGroup || action.trackGroup === action.id)
```

- [ ] **Step 11.3：`EditPresetDialog.tsx` visibleActions**

把 `src/components/FilterMenu/EditPresetDialog.tsx:48` 的：

```tsx
const visibleActions = useMemo(() => allActions.filter(a => !a.hidden), [allActions])
```

替换为：

```tsx
const visibleActions = useMemo(
  () => allActions.filter(a => !a.trackGroup || a.trackGroup === a.id),
  [allActions]
)
```

说明：37016 删除 `hidden: true` 后，若这里不改，预设对话框会把"降临之章"当成独立可选 action 列出来——违反"只有 primary 成员可被用户选"的不变量。

- [ ] **Step 11.4：确认全局 `hidden` 读取点已清零**

Run: `pnpm exec rg -n "\.hidden" src --glob '*.ts' --glob '*.tsx'`
Expected: **0 匹配**。若仍有未清理的读取点（例如测试 fixture 造了 `hidden: true`），在本 task 内一并切换为 `trackGroup: <parentId>`，不允许遗留。

- [ ] **Step 11.5：跑现有 `useSkillTracks` / store / FilterMenu 测试**

Run: `pnpm test:run src/hooks/useSkillTracks.test.ts src/store src/components/FilterMenu`
Expected: 通过；若因测试里造了 `hidden: true` 假数据而报错，把对应夹具改为 `trackGroup: <parentId>`。

- [ ] **Step 11.6：Commit（等用户授权）**

```bash
git add src/utils/skillTracks.ts src/store/mitigationStore.ts src/components/FilterMenu/EditPresetDialog.tsx
git commit -m "refactor(ui): 技能可见性统一改用 trackGroup（取代 hidden）"
```

---

## Task 12: 删 `fflogsImporter` 的 37016→37013 归并

**Files:**

- Modify: `src/utils/fflogsImporter.ts`

- [ ] **Step 12.1：替换 534 行附近的归并逻辑**

把 `src/utils/fflogsImporter.ts:534-537` 的以下内容：

```ts
// 降临之章（37016）是意气轩昂之策（37013）在炽天附体激活时的变体，导入时统一归并为 37013
const effectiveAbilityId = abilityGameID === 37016 ? 37013 : abilityGameID

if (!validActionIds.has(effectiveAbilityId)) continue
```

替换为：

```ts
if (!validActionIds.has(abilityGameID)) continue
```

并把同文件 548 行 `actionId: effectiveAbilityId,` 改为 `actionId: abilityGameID,`。

- [ ] **Step 12.2：跑 importer 相关测试**

Run: `pnpm test:run src/utils/fflogsImporter`
Expected: 通过。若测试里 mock 了 37016 事件并断言 `actionId === 37013`，更新期望为 `37016`。

- [ ] **Step 12.3：Commit（等用户授权）**

```bash
git add src/utils/fflogsImporter.ts
git commit -m "refactor(importer): 删除 37016→37013 归并（改由 trackGroup 表达）"
```

---

## Task 13: Timeline 接入 engine —— 删 displayOverrides，加 draggingId/engine

**Files:**

- Modify: `src/components/Timeline/index.tsx`
- Modify: `src/hooks/useDamageCalculation.ts`

- [ ] **Step 13.1：useDamageCalculation 暴露 statusTimelineByPlayer 与 simulate 回调**

把 hook 返回类型从 `Map<string, CalculationResult>` 改为：

```ts
import type { CastEvent } from '@/types/timeline'
import type { StatusInterval } from '@/types/status'

export interface DamageCalculationResult {
  results: Map<string, CalculationResult>
  statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
  /**
   * 与主路径共享 input（initialState/damageEvents/statistics/tankPlayerIds/baseRefMaxHP）的
   * simulate 回调。PlacementEngine 在处理 excludeCastEventId 时用它以过滤后的 castEvents 重放。
   * partyState 未就绪时为 null。
   */
  simulate: ((castEvents: CastEvent[]) => {
    statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
  }) | null
}

export function useDamageCalculation(timeline: Timeline | null): DamageCalculationResult { ... }
```

- 编辑模式：在 `calculator.simulate` 调用之前，先构造一次共享 input 对象（排除 `castEvents`），然后把完整路径的结果作为 default，同时暴露一个 `simulate = (evs) => calc.simulate({ ...sharedInput, castEvents: evs })`
- 其它路径（回放 / 空 timeline / 无 partyState）：`return { results, statusTimelineByPlayer: new Map(), simulate: null }`

调整完后更新所有消费点。先看有哪些：

```bash
pnpm exec rg -n "useDamageCalculation\(" src --glob '*.ts' --glob '*.tsx'
```

对每个消费点，把 `const results = useDamageCalculation(tl)` 改为 `const { results } = useDamageCalculation(tl)`。

- [ ] **Step 13.2：Timeline/index.tsx —— 停止填充 `displayActionOverrides`（保留 prop 管道）**

删除 `src/components/Timeline/index.tsx:298-322` 的**整段内容块**（`displayActionOverrides = new Map(...) ... 直到 `if (active) displayActionOverrides.set(...)` 的闭合大括号`），但在 `return { ... }` 里把该字段改为：

```ts
        displayActionOverrides: new Map<string, MitigationAction>(),
```

这样 SkillTracksCanvas / CastEventIcon 的 prop 管道仍可编译，它们在 Task 14/15 才会清理类型签名与读取点。本步骤的效果：buff 期间的 37013 不再被覆盖为 37016 图标（后续数据用 trackGroup 自然表达）。

- [ ] **Step 13.3：构造 engine + draggingId 状态**

在 `Timeline/index.tsx` 合适位置（紧邻 useDamageCalculation 调用之后）新增：

```ts
import { createPlacementEngine } from '@/utils/placement/engine'
import type { InvalidReason } from '@/utils/placement/types'

// ...

const { results: damageResults, simulate } = useDamageCalculation(timeline)

const actionMap = useMemo(() => new Map(actions.map(a => [a.id, a])), [actions])

const engine = useMemo(() => {
  if (!timeline || !simulate) return null
  return createPlacementEngine({
    castEvents: timeline.castEvents,
    actions: actionMap,
    simulate,
  })
}, [timeline, simulate, actionMap])

const [draggingId, setDraggingId] = useState<string | null>(null)

const invalidCastEventMap = useMemo(() => {
  if (!engine) return new Map<string, InvalidReason>()
  const invalid = engine.findInvalidCastEvents(draggingId ?? undefined)
  return new Map(invalid.map(r => [r.castEvent.id, r.reason]))
}, [engine, draggingId])
```

注：engine 的 input castEvents 是 `timeline.castEvents`（未过滤）；真正的"假设不存在"场景只由 excludeId 触发，`simulate` 回调里已经以 `castEvents: evs` 覆写，不会重复计算。

- [ ] **Step 13.4：把 engine / invalidCastEventMap / setDraggingId 传给 SkillTracksCanvas**

在 `<SkillTracksCanvas .../>` 的 props 里新增：

```tsx
engine = { engine }
invalidCastEventMap = { invalidCastEventMap }
draggingId = { draggingId }
setDraggingId = { setDraggingId }
actionMap = { actionMap }
```

保留现有 `displayActionOverrides={<...>}` 不动（Task 14 清理）。

- [ ] **Step 13.5：tsc + lint + 旧测试**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm lint`
Run: `pnpm test:run`
Expected: 全绿；SkillTracksCanvas 的新 prop 若尚未定义会 TS 报错，在 SkillTracksCanvas 里先给这四个 prop 一个临时 `?:` optional 类型声明（Task 14 会填充实现）。

- [ ] **Step 13.6：Commit（等用户授权）**

```bash
git add src/hooks/useDamageCalculation.ts src/components/Timeline/index.tsx src/contexts/DamageCalculationContext.ts src/components/Timeline/SkillTracksCanvas.tsx
git commit -m "feat(timeline): 接入 PlacementEngine + draggingId + invalidCastEventMap"
```

---

## Task 14: `SkillTracksCanvas` —— 用 engine 阴影取代独立 CD 阴影

**Files:**

- Modify: `src/components/Timeline/SkillTracksCanvas.tsx`

- [ ] **Step 14.1：删 `castEventBoundaries` 预计算（110-132 行）**

删除 `SkillTracksCanvas.tsx:110-132` 的整个 `const castEventBoundaries = useMemo(...)` 块与所有下游引用。拖拽边界后续由 engine.getValidIntervals 实时产出。

- [ ] **Step 14.2：删 CD 阴影独立计算（183-243 行）**

删除 `SkillTracksCanvas.tsx:183-243` 的"技能冷却阴影"渲染块。

- [ ] **Step 14.3：新增基于 engine 的阴影渲染**

替换 Step 14.2 删除的位置为：

```tsx
{
  !isReadOnly &&
    engine &&
    skillTracks.map((track, trackIndex) => {
      const shadow = engine.computeTrackShadow(
        actionMap.get(track.actionId)?.trackGroup ?? track.actionId,
        track.playerId,
        draggingId ?? undefined
      )
      return shadow.map((interval, idx) => {
        const left = Math.max(interval.from, TIMELINE_START_TIME) * zoomLevel
        const right = Math.min(interval.to, maxTime) * zoomLevel
        const width = right - left
        if (width <= 0) return null
        if (right < visibleMinX || left > visibleMaxX) return null
        return (
          <Shape
            key={`track-shadow-${track.playerId}-${track.actionId}-${idx}`}
            x={left}
            y={trackIndex * trackHeight}
            width={width}
            height={trackHeight}
            sceneFunc={(kCtx, shape) => {
              const ctx = kCtx._context
              const w = shape.width()
              const h = shape.height()
              ctx.save()
              ctx.beginPath()
              ctx.rect(0, 0, w, h)
              ctx.clip()
              const step = 7
              ctx.strokeStyle = colors.cooldownStripe
              ctx.lineWidth = colors.cooldownStripeWidth
              for (let i = -h; i < w + h; i += step) {
                ctx.beginPath()
                ctx.moveTo(i, 0)
                ctx.lineTo(i + h, h)
                ctx.stroke()
              }
              ctx.restore()
            }}
            shadowEnabled={false}
            perfectDrawEnabled={false}
            listening={false}
          />
        )
      })
    })
}
```

`actionMap`、`engine`、`draggingId` 由 props 传入（Task 14.4 已加）；`maxTime` 由外层 `useMemo` 产出。

- [ ] **Step 14.4：从 props 接 `engine` / `invalidCastEventMap` / `draggingId` / `setDraggingId`**

在 `SkillTracksCanvasProps` 上加：

```ts
  engine: import('@/utils/placement/engine').PlacementEngine | null
  invalidCastEventMap: Map<string, import('@/utils/placement/types').InvalidReason>
  draggingId: string | null
  setDraggingId: (id: string | null) => void
  actionMap: Map<number, MitigationAction>
```

并在解构 props 里同步加上。

- [ ] **Step 14.5：双击 track 走 engine.pickUniqueMember**

在 `onDoubleClickTrack(track, time)` 的调用处（Canvas 内 onDblClick/onDblTap handler）上层（Timeline/index.tsx 的 `handleDoubleClickTrack`）调整逻辑：

```ts
const handleDoubleClickTrack = useCallback(
  (track: SkillTrack, t: number) => {
    if (!engine) return
    const trackGroup = actionMap.get(track.actionId)?.trackGroup ?? track.actionId
    const member = engine.pickUniqueMember(trackGroup, track.playerId, t)
    if (!member) {
      toast.error('当前无可用技能') // 0 合法或 >1 合法（后者应被 validate 截住）
      return
    }
    const r = engine.canPlaceCastEvent(member, track.playerId, t)
    if (!r.ok) {
      toast.error('此位置不可放置')
      return
    }
    addCastEvent(member.id, track.playerId, t)
  },
  [engine, actionMap, addCastEvent]
)
```

`addCastEvent(actionId, playerId, t)` 按现有 API 签名调整；若现有 `addCastAt` 接受 `(track, t)`，重命名为 `(actionId, playerId, t)` 并同步调用方。

- [ ] **Step 14.6：测试**

Run: `pnpm test:run`
Expected: 全部通过。

- [ ] **Step 14.7：Commit（等用户授权）**

```bash
git add src/components/Timeline/SkillTracksCanvas.tsx src/components/Timeline/index.tsx
git commit -m "refactor(timeline): engine 统一 CD/placement 阴影，双击走 pickUniqueMember"
```

---

## Task 15: `CastEventIcon` —— dragBounds + 红边框 + reason tooltip

**Files:**

- Modify: `src/components/Timeline/CastEventIcon.tsx`
- Modify: `src/components/Timeline/SkillTracksCanvas.tsx`

- [ ] **Step 15.1：从 props 接 dragBounds / invalidReason**

`CastEventIcon` 新增 props：

```ts
  dragBounds: { left: number; right: number } | null
  invalidReason: import('@/utils/placement/types').InvalidReason | null
```

`SkillTracksCanvas` 渲染 `CastEventIcon` 时传入：

```tsx
dragBounds={dragBoundsByCastEventRef.current.get(castEvent.id) ?? null}
invalidReason={invalidCastEventMap.get(castEvent.id) ?? null}
```

其中 `dragBoundsByCastEventRef` 是 Timeline/index.tsx 通过 `useRef` 持有的 `Map<string, {left:number; right:number}>`，仅在 `draggingId` 变化时（onDragStart）刷新被拖那条 cast 的快照。

- [ ] **Step 15.2：`onDragStart` 生成快照**

在 Timeline/index.tsx 新增：

```ts
const dragBoundsByCastEventRef = useRef<Map<string, { left: number; right: number }>>(new Map())

const handleCastEventDragStart = useCallback(
  (castEvent: CastEvent) => {
    if (!engine) return
    const action = actionMap.get(castEvent.actionId)
    if (!action) return
    const intervals = engine.getValidIntervals(action, castEvent.playerId, castEvent.id)
    const cur = intervals.find(i => i.from <= castEvent.timestamp && castEvent.timestamp < i.to)
    const snap = cur
      ? { left: cur.from, right: cur.to }
      : { left: castEvent.timestamp, right: castEvent.timestamp }
    dragBoundsByCastEventRef.current.set(castEvent.id, snap)
    setDraggingId(castEvent.id)
  },
  [engine, actionMap]
)

const handleCastEventDragEnd = useCallback(
  (castEvent: CastEvent, finalT: number) => {
    setDraggingId(null)
    dragBoundsByCastEventRef.current.delete(castEvent.id)
    if (!engine) return
    const action = actionMap.get(castEvent.actionId)
    if (!action) return
    const r = engine.canPlaceCastEvent(action, castEvent.playerId, finalT, castEvent.id)
    if (!r.ok) {
      toast.error('此位置不可放置')
      return // 父组件不 commit 时间戳变更 → 自然回弹
    }
    updateCastEvent(castEvent.id, { timestamp: finalT })
  },
  [engine, actionMap, updateCastEvent]
)
```

并把 `handleCastEventDragStart` / `handleCastEventDragEnd` 当作 prop 传到下层。

- [ ] **Step 15.3：`dragBoundFunc` 读 props**

在 `CastEventIcon.tsx` 的 draggable Shape 上：

```tsx
dragBoundFunc={(pos) => {
  if (!dragBounds) return pos
  const clamped = Math.min(Math.max(pos.x / zoomLevel, dragBounds.left), dragBounds.right)
  return { x: clamped * zoomLevel, y: lockedY }
}}
```

- [ ] **Step 15.4：红边框 + tooltip**

在 `CastEventIcon.tsx` 删除 184 行 `displayAction ?? action` 的 `displayAction` 分支（同时从 props 中删 `displayAction`）；图标改为直接用 `action.icon`。

在图标下方加红色描边：

```tsx
{
  invalidReason && (
    <Rect
      x={-1}
      y={-16}
      width={32}
      height={32}
      stroke="#ef4444"
      strokeWidth={2}
      cornerRadius={4}
      listening={false}
      perfectDrawEnabled={false}
    />
  )
}
```

并在 hover 提示里按 reason 切文案（现有 hover tooltip 组件若接受 `string`，追加一个辅助派生）：

```ts
const invalidTooltip =
  invalidReason === 'placement_lost'
    ? '此位置已不满足条件'
    : invalidReason === 'cooldown_conflict'
      ? '与同轨其他技能 CD 冲突'
      : invalidReason === 'both'
        ? '此位置条件不满足且与 CD 冲突'
        : null
```

在现有 `<SkillPopover />` 之类组件中把 `invalidTooltip` 追加到内容开头（若组件不支持追加，就在 pop 里加一段条件渲染）。

- [ ] **Step 15.5：tsc + lint + 测试**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm lint`
Run: `pnpm test:run`
Expected: 全绿。

- [ ] **Step 15.6：Commit（等用户授权）**

```bash
git add src/components/Timeline/CastEventIcon.tsx src/components/Timeline/SkillTracksCanvas.tsx src/components/Timeline/index.tsx
git commit -m "feat(timeline): castEvent dragBounds + 红边框 + reason tooltip"
```

---

## Task 16: 集成测试 —— 关键场景

**Files:**

- Create: `src/utils/placement/integration.test.ts`

- [ ] **Step 16.1：场景覆盖**

```ts
import { describe, it, expect } from 'vitest'
import { createPlacementEngine } from './engine'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { createMitigationCalculator } from '@/utils/mitigationCalculator'
import type { CastEvent } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'

const actions = new Map(MITIGATION_DATA.actions.map(a => [a.id, a]))
const initialState: PartyState = { statuses: [], timestamp: 0 }

function makeEngine(castEvents: CastEvent[]) {
  const calc = createMitigationCalculator()
  return createPlacementEngine({
    castEvents,
    actions,
    simulate: evs =>
      calc.simulate({
        castEvents: evs,
        damageEvents: [{ id: 'd-end', time: 600, damage: 100000, type: 'aoe' } as any],
        initialState,
      }),
  })
}

describe('placement 集成', () => {
  it('炽天附体期间双击产出 37016，非 buff 期产出 37013', () => {
    const SERAPHISM_CAST: CastEvent = {
      id: 's',
      actionId: 37014,
      playerId: 1,
      timestamp: 10,
    } as any
    const engine = makeEngine([SERAPHISM_CAST])

    expect(engine.pickUniqueMember(37013, 1, 20)?.id).toBe(37016)
    expect(engine.pickUniqueMember(37013, 1, 45)?.id).toBe(37013) // buff 10+30=40 后失效
  })

  it('炽天附体期间把 37013 cast 在 buff 窗口内 → findInvalidCastEvents 标记 placement_lost', () => {
    const SERAPHISM_CAST: CastEvent = {
      id: 's',
      actionId: 37014,
      playerId: 1,
      timestamp: 10,
    } as any
    const BAD_INTUITION: CastEvent = {
      id: 'bad',
      actionId: 37013,
      playerId: 1,
      timestamp: 20,
    } as any
    const engine = makeEngine([SERAPHISM_CAST, BAD_INTUITION])

    const invalid = engine.findInvalidCastEvents()
    expect(invalid.some(r => r.castEvent.id === 'bad' && r.reason === 'placement_lost')).toBe(true)
  })

  it('拖拽 37014 到新位置预览：把 37016 cast 带出 buff 窗口外时应红边框', () => {
    const SERAPHISM_CAST: CastEvent = {
      id: 's',
      actionId: 37014,
      playerId: 1,
      timestamp: 10,
    } as any
    const ACCESSION_CAST: CastEvent = {
      id: 'a',
      actionId: 37016,
      playerId: 1,
      timestamp: 20,
    } as any
    const engine = makeEngine([SERAPHISM_CAST, ACCESSION_CAST])

    // 默认（不拖拽）：37016 在 buff 内 → 合法
    expect(engine.findInvalidCastEvents().some(r => r.castEvent.id === 'a')).toBe(false)
    // 预览"删除 37014"：37016 失去 buff 触发 → placement_lost
    expect(
      engine
        .findInvalidCastEvents('s')
        .some(r => r.castEvent.id === 'a' && r.reason === 'placement_lost')
    ).toBe(true)
  })
})
```

- [ ] **Step 16.2：跑集成测试**

Run: `pnpm test:run src/utils/placement/integration.test.ts`
Expected: 全部通过。

- [ ] **Step 16.3：全量测试兜底**

Run: `pnpm test:run`
Expected: 全绿。

- [ ] **Step 16.4：类型 + lint 兜底**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm lint`
Expected: 全绿。

- [ ] **Step 16.5：手动验证（UI 冒烟）**

不由 agent 跑，由用户自行启动 `pnpm dev` 后确认：

1. 刷新主页进入某时间轴，炽天附体 buff 激活期间双击学者"意气轩昂"轨道 → 产出降临之章（37016）图标
2. 在同一轨道 buff 期外双击 → 产出 37013
3. 技能池里没有独立的"降临之章"条目（已通过 trackGroup 挂到 37013）
4. FFLogs 导入一份日志（含 buff 期间的 37016 cast）→ 时间轴中该 cast 显示为降临之章图标（由 trackGroup 自动挂载），不再靠 displayOverride
5. 拖动一个 buff 期内的 37016 cast 越出 buff 窗口 → 被 `dragBoundFunc` 硬夹住
6. 把 37014 cast 删掉 → 原来在 buff 期内的 37016 cast 出现红边框 + 悬停"此位置已不满足条件"
7. 节制（16536）/ 神爱抚（37011）行为与本次改动**前保持一致**（本 plan 不迁移 follow-up）

若发现偏差，在这个 task 内 revert 到能复现的粒度后重新调整。

- [ ] **Step 16.6：Commit（等用户授权）**

```bash
git add src/utils/placement/integration.test.ts
git commit -m "test(placement): 集成测试覆盖变身/follow-up/拖拽/合法性回溯"
```

---

## 完工清单

- [ ] 所有 16 个 Task 的 commit step 都已按用户授权提交
- [ ] `pnpm lint` 全绿
- [ ] `pnpm exec tsc --noEmit` 全绿
- [ ] `pnpm test:run` 全绿
- [ ] `pnpm build` 通过
- [ ] 手动冒烟（Task 16.5）七项场景通过
- [ ] spec 文档 `2026-04-22-placement-architecture-design.md` 更新 `状态: Partial(37013/37016)`；16536/37011 follow-up 迁移注明延后单独 plan
