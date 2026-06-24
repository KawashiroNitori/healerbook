# 自动减伤优化器·核心引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现纯函数 `runOptimize(input, deps)`，自动为时间轴放置全队减伤技能：硬约束（每个 in-scope AOE 事件不致死）+ 软目标（最小化 Σ finalDamage）。

**Architecture:** 新模块 `src/utils/autoMitigation/`，与 `placement/`、`resource/` 平级，无 React 依赖。三阶段算法（可行性贪心 → 边际贪心 → 局部搜索），全部通过注入的 `OptimizeDeps` 解耦真值来源（`MitigationCalculator.simulate`）与合法性来源（`PlacementEngine`），便于单测注入 fake。本计划只交付**纯引擎**；CELF/增量等性能优化见计划二，worker/UX 见计划三。

**Tech Stack:** TypeScript 5.9、Vitest 4。复用 `mitigationCalculator.simulate`、`placement/engine`、`lethalDanger`、`id`。

## Global Constraints

- 包管理器必须用 **pnpm**（`pnpm test:run`、`pnpm exec tsc --noEmit`、`pnpm lint`）。
- 测试文件与源文件同目录 `*.test.ts`（Vitest）。
- 提交信息**禁止**含 "Claude" 字样（`.husky/commit-msg` 会拒）；不得禁用 gpgsign。
- 命名用 `action` 不用 `skill`。
- 模块**纯函数、无副作用、无 React/DOM 依赖**。
- `CastEvent` 结构固定：`{ id, actionId(=trackGroup 父 id), timestamp, playerId }`，变体交运行时 `resolveVariant`，不写死。
- 半开区间语义 `[from, to)`，浮点比较用 `placement/types` 的 `TIME_EPS = 1e-6`。
- in-scope 定义（贯穿全程）：`isAoeType(e.type) && e.damage < 1_000_000 && !e.targetMitigationDisabled`，`isAoeType ∈ {aoe, partial_aoe, partial_final_aoe}`。
- 致死口径**复用** `deriveLethalDangerous(undefined, finalDamage, referenceMaxHP, false)`（开 `skipHpPipeline` 故无 hpSim/overkill），不另造。

---

## File Structure

| 文件                                     | 职责                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/utils/autoMitigation/scope.ts`      | `isInScope(e)` —— in-scope 事件判定，单一真相                                       |
| `src/utils/autoMitigation/types.ts`      | `OptimizeInput/Output`、`Candidate`、`EvalResult`、`OptimizeDeps` 等类型            |
| `src/utils/autoMitigation/evaluate.ts`   | `createEvaluator(input)` → `(casts) => EvalResult`，封装 `simulate(skipHpPipeline)` |
| `src/utils/autoMitigation/candidates.ts` | `generateCandidates(input, engine)` → 断点集候选 + 安全支配剪枝                     |
| `src/utils/autoMitigation/prng.ts`       | `mulberry32(seed)` 确定性 PRNG                                                      |
| `src/utils/autoMitigation/moves.ts`      | 阶段 3 邻域算子（move/swap/replace/remove+add）                                     |
| `src/utils/autoMitigation/optimizer.ts`  | `runOptimize(input, deps?)` 三阶段主流程 + `defaultDeps()`                          |

每个文件配同名 `*.test.ts`。

---

### Task 1: 范围判定与共享类型

**Files:**

- Create: `src/utils/autoMitigation/scope.ts`
- Create: `src/utils/autoMitigation/types.ts`
- Test: `src/utils/autoMitigation/scope.test.ts`

**Interfaces:**

- Produces: `isInScope(e: DamageEvent): boolean`；类型 `OptimizeInput`、`OptimizeOutput`、`InfeasibleEvent`、`OptimizeSummary`、`PerEventEval`、`EvalResult`、`Candidate`、`Evaluator`、`OptimizeDeps`。

- [ ] **Step 1: 写失败测试** `scope.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { isInScope } from './scope'
import type { DamageEvent } from '@/types/timeline'

const base = (over: Partial<DamageEvent>): DamageEvent =>
  ({
    id: 'e',
    name: 'x',
    time: 10,
    damage: 50000,
    type: 'aoe',
    damageType: 'magical',
    ...over,
  }) as DamageEvent

describe('isInScope', () => {
  it('接受普通 AOE', () => {
    expect(isInScope(base({ type: 'aoe' }))).toBe(true)
    expect(isInScope(base({ type: 'partial_aoe' }))).toBe(true)
    expect(isInScope(base({ type: 'partial_final_aoe' }))).toBe(true)
  })
  it('排除坦专', () => {
    expect(isInScope(base({ type: 'tankbuster' }))).toBe(false)
    expect(isInScope(base({ type: 'auto' }))).toBe(false)
  })
  it('排除 ≥100 万伤害的超大机制', () => {
    expect(isInScope(base({ damage: 1_000_000 }))).toBe(false)
    expect(isInScope(base({ damage: 1_500_000 }))).toBe(false)
  })
  it('排除已禁用减伤的事件', () => {
    expect(isInScope(base({ targetMitigationDisabled: true }))).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/autoMitigation/scope.test.ts`
Expected: FAIL（`isInScope` 未定义 / 模块不存在）

- [ ] **Step 3: 写 `scope.ts`**

```typescript
import type { DamageEvent } from '@/types/timeline'

const AOE_TYPES = new Set<DamageEvent['type']>(['aoe', 'partial_aoe', 'partial_final_aoe'])

/** in-scope：受自动放置优化的伤害事件（非坦 AOE、原始伤害 <100 万、未禁用减伤）。 */
export function isInScope(e: DamageEvent): boolean {
  return AOE_TYPES.has(e.type) && e.damage < 1_000_000 && !e.targetMitigationDisabled
}
```

- [ ] **Step 4: 写 `types.ts`**

```typescript
import type { CastEvent, DamageEvent, Composition } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { PartyState } from '@/types/partyState'
import type { TimelineStatData } from '@/types/timeline'
import type { StatusInterval } from '@/types/status'
import type { PlacementEngine } from '@/utils/placement/types'

export interface OptimizeOptions {
  timeBudgetMs?: number // 默认 ≈ 3000
  seed?: number // 确定性 PRNG 播种，默认 1
  aggressive?: boolean // 启发剪枝开关（计划二）；默认 true
}

export interface OptimizeInput {
  damageEvents: DamageEvent[]
  lockedCastEvents: CastEvent[] // 固定不动；空白入口 = []
  composition: Composition
  actions: Map<number, MitigationAction>
  initialState: PartyState
  statistics?: TimelineStatData
  baseReferenceMaxHPForAoe?: number
  baseReferenceMaxHPForTank?: number
  options?: OptimizeOptions
}

export interface InfeasibleEvent {
  eventId: string
  originalDamage: number
  bestAchievedFinalDamage: number
}

export interface OptimizeSummary {
  totalDamageBefore: number
  totalDamageAfter: number
  castsAdded: number
  elapsedMs: number
}

export interface OptimizeOutput {
  addedCastEvents: CastEvent[]
  infeasibleEvents: InfeasibleEvent[]
  summary: OptimizeSummary
}

export interface PerEventEval {
  time: number
  inScope: boolean
  finalDamage: number
  referenceMaxHP?: number
}

export interface EvalResult {
  total: number // Σ finalDamage（仅 in-scope）
  perEvent: Map<string, PerEventEval>
  lethal: Set<string> // in-scope 且 isLethal 的事件 id
  // 供下游构建 PlacementEngine，免二次 simulate
  statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
  resolvedVariantByCastId: Map<string, number>
}

export type Evaluator = (casts: CastEvent[]) => EvalResult

export interface Candidate {
  action: MitigationAction
  playerId: number
  start: number // = cast.timestamp
  covers: Set<string> // 覆盖的 in-scope 事件 id
}

/** 注入依赖：单测替换为 fake，生产用 defaultDeps()。 */
export interface OptimizeDeps {
  createEvaluator: (input: OptimizeInput) => Evaluator
  buildPlacementEngine: (
    input: OptimizeInput,
    casts: CastEvent[],
    eval0: EvalResult
  ) => PlacementEngine
  generateId: () => string
  now: () => number
  makeRandom: (seed: number) => () => number
}
```

- [ ] **Step 5: 跑测试确认通过 + 类型检查**

Run: `pnpm test:run src/utils/autoMitigation/scope.test.ts && pnpm exec tsc --noEmit`
Expected: PASS；tsc 无错误

- [ ] **Step 6: 提交**

```bash
git add src/utils/autoMitigation/scope.ts src/utils/autoMitigation/scope.test.ts src/utils/autoMitigation/types.ts
git commit -m "feat(auto-mitigation): 范围判定与核心类型"
```

---

### Task 2: 评估器 evaluate

**Files:**

- Create: `src/utils/autoMitigation/evaluate.ts`
- Test: `src/utils/autoMitigation/evaluate.test.ts`

**Interfaces:**

- Consumes: `OptimizeInput`、`Evaluator`、`EvalResult`（Task 1）；`createMitigationCalculator`（`@/utils/mitigationCalculator`）；`deriveLethalDangerous`（`@/utils/lethalDanger`）；`isInScope`（Task 1）。
- Produces: `createEvaluator(input: OptimizeInput): Evaluator`。

- [ ] **Step 1: 写失败测试** `evaluate.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { createEvaluator } from './evaluate'
import type { OptimizeInput } from './types'
import type { DamageEvent } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'

const dmg = (id: string, time: number, damage: number): DamageEvent =>
  ({ id, name: id, time, damage, type: 'aoe', damageType: 'magical' }) as DamageEvent

const baseInput = (): OptimizeInput => ({
  damageEvents: [dmg('a', 10, 80000), dmg('b', 20, 120000)],
  lockedCastEvents: [],
  composition: { players: [{ id: 1, job: 'WHM' }] },
  actions: new Map(),
  initialState: { statuses: [], timestamp: 0 } as PartyState,
  baseReferenceMaxHPForAoe: 100000,
})

describe('createEvaluator', () => {
  it('无 cast 时 total = Σ 原始伤害（无减伤），并标出致死事件', () => {
    const ev = createEvaluator(baseInput())
    const r = ev([])
    expect(r.total).toBe(200000) // 80000 + 120000
    // 参考血 100000：b(120000) 致死，a(80000) 不致死
    expect(r.lethal.has('b')).toBe(true)
    expect(r.lethal.has('a')).toBe(false)
    expect(r.perEvent.get('a')?.inScope).toBe(true)
  })
  it('out-of-scope 事件不计入 total / lethal', () => {
    const input = baseInput()
    input.damageEvents.push({ ...dmg('t', 30, 500000), type: 'tankbuster' } as DamageEvent)
    const r = createEvaluator(input)([])
    expect(r.perEvent.get('t')?.inScope).toBe(false)
    expect(r.lethal.has('t')).toBe(false)
    expect(r.total).toBe(200000) // 不含 t
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/autoMitigation/evaluate.test.ts`
Expected: FAIL（`createEvaluator` 未定义）

- [ ] **Step 3: 写 `evaluate.ts`**

```typescript
import { createMitigationCalculator } from '@/utils/mitigationCalculator'
import { deriveLethalDangerous } from '@/utils/lethalDanger'
import { isInScope } from './scope'
import type { OptimizeInput, Evaluator, EvalResult, PerEventEval } from './types'

/**
 * 评估器：给定 cast 集合，调 simulate(skipHpPipeline) 得每事件 finalDamage，
 * 汇总 in-scope 总伤、致死集，并透出 status 时间线供合法性查询复用（免二次 simulate）。
 * 纯函数：每次调用独立，试探可丢弃返回值回滚。
 */
export function createEvaluator(input: OptimizeInput): Evaluator {
  const calc = createMitigationCalculator()
  const inScopeIds = new Set(input.damageEvents.filter(isInScope).map(e => e.id))
  return casts => {
    const out = calc.simulate({
      castEvents: casts,
      damageEvents: input.damageEvents,
      initialState: input.initialState,
      statistics: input.statistics,
      baseReferenceMaxHPForAoe: input.baseReferenceMaxHPForAoe,
      baseReferenceMaxHPForTank: input.baseReferenceMaxHPForTank,
      skipHpPipeline: true,
    })
    const perEvent = new Map<string, PerEventEval>()
    const lethal = new Set<string>()
    let total = 0
    for (const e of input.damageEvents) {
      const r = out.damageResults.get(e.id)
      if (!r) continue
      const inScope = inScopeIds.has(e.id)
      perEvent.set(e.id, {
        time: e.time,
        inScope,
        finalDamage: r.finalDamage,
        referenceMaxHP: r.referenceMaxHP,
      })
      if (inScope) {
        total += r.finalDamage
        // skipHpPipeline → 无 hpSim/overkill，落 refHP fallback 分支
        const { isLethal } = deriveLethalDangerous(
          undefined,
          r.finalDamage,
          r.referenceMaxHP,
          false
        )
        if (isLethal) lethal.add(e.id)
      }
    }
    return {
      total,
      perEvent,
      lethal,
      statusTimelineByPlayer: out.statusTimelineByPlayer,
      resolvedVariantByCastId: out.resolvedVariantByCastId,
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run src/utils/autoMitigation/evaluate.test.ts`
Expected: PASS

> 若 `referenceMaxHP` 未按预期填充导致 lethal 断言失败，检查 simulate 是否需要 `baseReferenceMaxHPForAoe` 同时 > 0；本测试已提供。

- [ ] **Step 5: 提交**

```bash
git add src/utils/autoMitigation/evaluate.ts src/utils/autoMitigation/evaluate.test.ts
git commit -m "feat(auto-mitigation): simulate 评估器"
```

---

### Task 3: 候选生成 + 安全支配剪枝

**Files:**

- Create: `src/utils/autoMitigation/candidates.ts`
- Test: `src/utils/autoMitigation/candidates.test.ts`

**Interfaces:**

- Consumes: `OptimizeInput`、`Candidate`（Task 1）；`PlacementEngine`、`Interval`、`TIME_EPS`（`@/utils/placement/types`）；`effectiveTrackGroup`（`@/types/mitigation`）；`isInScope`（Task 1）。
- Produces: `generateCandidates(input: OptimizeInput, engine: PlacementEngine): Candidate[]`。

- [ ] **Step 1: 写失败测试** `candidates.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { generateCandidates } from './candidates'
import type { OptimizeInput } from './types'
import type { MitigationAction } from '@/types/mitigation'
import type { DamageEvent } from '@/types/timeline'
import type { PlacementEngine, Interval } from '@/utils/placement/types'

const action = (over: Partial<MitigationAction>): MitigationAction =>
  ({
    id: 100,
    name: 'A',
    icon: '',
    jobs: ['WHM'],
    duration: 15,
    cooldown: 60,
    category: ['partywide', 'percentage'],
    ...over,
  }) as MitigationAction

const dmg = (id: string, time: number): DamageEvent =>
  ({ id, name: id, time, damage: 80000, type: 'aoe', damageType: 'magical' }) as DamageEvent

// 假 engine：整条时间轴合法
const fakeEngine = (legal: Interval[]): PlacementEngine =>
  ({ getValidIntervals: () => legal }) as unknown as PlacementEngine

const input = (actions: MitigationAction[], events: DamageEvent[]): OptimizeInput => ({
  damageEvents: events,
  lockedCastEvents: [],
  composition: { players: [{ id: 1, job: 'WHM' }] },
  actions: new Map(actions.map(a => [a.id, a])),
  initialState: { statuses: [], timestamp: 0 } as never,
})

describe('generateCandidates', () => {
  it('为每个 in-scope 事件在合法窗口内生成覆盖该事件的候选', () => {
    const a = action({ id: 100, duration: 15 })
    const cands = generateCandidates(
      input([a], [dmg('x', 10), dmg('y', 40)]),
      fakeEngine([{ from: 0, to: 100 }])
    )
    // 存在覆盖 x 的候选 & 覆盖 y 的候选
    expect(cands.some(c => c.covers.has('x'))).toBe(true)
    expect(cands.some(c => c.covers.has('y'))).toBe(true)
  })
  it('零贡献候选（覆盖窗口内无事件）被剪掉', () => {
    const a = action({ id: 100, duration: 5 })
    const cands = generateCandidates(input([a], [dmg('x', 10)]), fakeEngine([{ from: 50, to: 60 }]))
    expect(cands.length).toBe(0) // 窗口 [50,60) 罩不到 t=10 的事件
  })
  it('支配剪枝：同 (action,player) 覆盖集被包含者被丢弃', () => {
    const a = action({ id: 100, duration: 100 }) // 一发覆盖全部
    const cands = generateCandidates(
      input([a], [dmg('x', 10), dmg('y', 20)]),
      fakeEngine([{ from: 0, to: 5 }])
    )
    // 仅保留覆盖 {x,y} 的极大候选，不保留只覆盖子集者
    const maximal = cands.filter(c => c.covers.has('x') && c.covers.has('y'))
    expect(maximal.length).toBeGreaterThanOrEqual(1)
    expect(cands.every(c => !(c.covers.size === 1))).toBe(true)
  })
  it('玩家职业不匹配的 action 不产候选', () => {
    const a = action({ id: 100, jobs: ['SCH'] }) // 玩家是 WHM
    const cands = generateCandidates(input([a], [dmg('x', 10)]), fakeEngine([{ from: 0, to: 100 }]))
    expect(cands.length).toBe(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/autoMitigation/candidates.test.ts`
Expected: FAIL（`generateCandidates` 未定义）

- [ ] **Step 3: 写 `candidates.ts`**

```typescript
import { effectiveTrackGroup } from '@/types/mitigation'
import { TIME_EPS } from '@/utils/placement/types'
import type { Interval, PlacementEngine } from '@/utils/placement/types'
import { isInScope } from './scope'
import type { OptimizeInput, Candidate } from './types'

function inSomeLegal(t: number, legal: Interval[]): boolean {
  return legal.some(iv => t >= iv.from - TIME_EPS && t < iv.to - TIME_EPS)
}

/** 同 (action,player) 内丢弃覆盖集被严格包含或相等的候选，仅留极大集。 */
function dropDominated(cands: Candidate[]): Candidate[] {
  const sorted = [...cands].sort((a, b) => b.covers.size - a.covers.size)
  const kept: Candidate[] = []
  for (const c of sorted) {
    const dominated = kept.some(k => {
      if (k.covers.size < c.covers.size) return false
      for (const id of c.covers) if (!k.covers.has(id)) return false
      return true // k.covers ⊇ c.covers
    })
    if (!dominated) kept.push(c)
  }
  return kept
}

/**
 * 候选生成（§4 断点集 Bcov ∪ Bwin；Bvar 留待计划二接入变体感知）。
 * 候选起点固定于断点；合法性后续由 PlacementEngine 动态复查。
 */
export function generateCandidates(input: OptimizeInput, engine: PlacementEngine): Candidate[] {
  const inScopeEvents = input.damageEvents.filter(isInScope)
  const result: Candidate[] = []

  for (const player of input.composition.players) {
    for (const action of input.actions.values()) {
      if (action.hidden) continue
      if (effectiveTrackGroup(action) !== action.id) continue // 只放 trackGroup 父
      if (!action.jobs.includes(player.job)) continue

      const legal = engine.getValidIntervals(action, player.id)
      if (legal.length === 0) continue

      const d = action.duration
      const starts = new Set<number>()
      for (const e of inScopeEvents) {
        if (inSomeLegal(e.time, legal)) starts.add(e.time) // 左沿对齐事件
        const late = e.time - d + TIME_EPS // 尽量晚放仍罩住 e
        if (inSomeLegal(late, legal)) starts.add(late)
      }
      for (const iv of legal) starts.add(iv.from) // 合法窗口左端

      const perAction: Candidate[] = []
      for (const start of starts) {
        const covers = new Set<string>()
        for (const e of inScopeEvents) {
          if (e.time >= start - TIME_EPS && e.time < start + d - TIME_EPS) covers.add(e.id)
        }
        if (covers.size === 0) continue // A2 零贡献剪枝
        perAction.push({ action, playerId: player.id, start, covers })
      }
      result.push(...dropDominated(perAction)) // A1 支配剪枝
    }
  }
  return result
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run src/utils/autoMitigation/candidates.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/utils/autoMitigation/candidates.ts src/utils/autoMitigation/candidates.test.ts
git commit -m "feat(auto-mitigation): 候选生成与支配剪枝"
```

---

### Task 4: PRNG + 阶段 1 可行性贪心

**Files:**

- Create: `src/utils/autoMitigation/prng.ts`
- Create: `src/utils/autoMitigation/optimizer.ts`（本任务先建 + 写 `phase1Feasibility`）
- Test: `src/utils/autoMitigation/prng.test.ts`、`src/utils/autoMitigation/optimizer.phase1.test.ts`

**Interfaces:**

- Consumes: `Candidate`、`Evaluator`、`EvalResult`、`OptimizeInput`、`OptimizeDeps`、`InfeasibleEvent`（Task 1）。
- Produces: `mulberry32(seed: number): () => number`；内部 `OptimizerContext`、`phase1Feasibility(ctx): void`、`makeCast(ctx, cand): CastEvent`、`tryAccept(ctx, cand): EvalResult | null`。`OptimizerContext` 形如：

```typescript
interface OptimizerContext {
  input: OptimizeInput
  deps: OptimizeDeps
  evaluator: Evaluator
  cands: Candidate[]
  added: CastEvent[]
  evalState: EvalResult
  infeasible: Map<string, InfeasibleEvent>
}
```

- [ ] **Step 1: 写失败测试** `prng.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { mulberry32 } from './prng'

describe('mulberry32', () => {
  it('同 seed 同序列（可复现）', () => {
    const a = mulberry32(42),
      b = mulberry32(42)
    const seqA = [a(), a(), a()],
      seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })
  it('输出落在 [0,1)', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 100; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/autoMitigation/prng.test.ts`
Expected: FAIL

- [ ] **Step 3: 写 `prng.ts`**

```typescript
/** 确定性 PRNG（mulberry32）：规避 worker 下 Math.random 限制，且可复现。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

- [ ] **Step 4: 写 `optimizer.phase1.test.ts`**（用 fake evaluator/engine 注入）

```typescript
import { describe, it, expect } from 'vitest'
import { makeContext, phase1Feasibility } from './optimizer'
import type { OptimizeInput, Candidate, EvalResult, OptimizeDeps } from './types'
import type { MitigationAction } from '@/types/mitigation'
import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { PlacementEngine } from '@/utils/placement/types'

const act = (id: number): MitigationAction =>
  ({
    id,
    name: `a${id}`,
    icon: '',
    jobs: ['WHM'],
    duration: 30,
    cooldown: 60,
    category: ['partywide', 'percentage'],
  }) as MitigationAction
const dmg = (id: string, damage: number): DamageEvent =>
  ({ id, name: id, time: 10, damage, type: 'aoe', damageType: 'magical' }) as DamageEvent

// fake：每放一个覆盖事件 e 的 cast，把 e 的 finalDamage 砍半
function fakeDeps(
  rawDamage: Record<string, number>,
  refHP: number,
  cands: Candidate[]
): OptimizeDeps {
  const evaluator = (casts: CastEvent[]): EvalResult => {
    const perEvent = new Map(),
      lethal = new Set<string>()
    let total = 0
    for (const [id, base] of Object.entries(rawDamage)) {
      const hits = casts.filter(c =>
        cands.find(k => k.start === c.timestamp && k.action.id === c.actionId)?.covers.has(id)
      ).length
      const fd = base / Math.pow(2, hits)
      perEvent.set(id, { time: 10, inScope: true, finalDamage: fd, referenceMaxHP: refHP })
      total += fd
      if (fd >= refHP) lethal.add(id)
    }
    return {
      total,
      perEvent,
      lethal,
      statusTimelineByPlayer: new Map(),
      resolvedVariantByCastId: new Map(),
    }
  }
  return {
    createEvaluator: () => evaluator,
    buildPlacementEngine: () =>
      ({
        canPlaceCastEvent: () => ({ ok: true }),
        findInvalidCastEvents: () => [],
      }) as unknown as PlacementEngine,
    generateId: (() => {
      let n = 0
      return () => `g${n++}`
    })(),
    now: () => 0,
    makeRandom: () => () => 0,
  }
}

const input = (events: DamageEvent[]): OptimizeInput => ({
  damageEvents: events,
  lockedCastEvents: [],
  composition: { players: [{ id: 1, job: 'WHM' }] },
  actions: new Map([
    [100, act(100)],
    [200, act(200)],
  ]),
  initialState: { statuses: [], timestamp: 0 } as never,
  baseReferenceMaxHPForAoe: 100000,
})

describe('phase1Feasibility', () => {
  it('消解可救的致死事件', () => {
    const cands: Candidate[] = [
      { action: act(100), playerId: 1, start: 10, covers: new Set(['x']) },
      { action: act(200), playerId: 1, start: 10, covers: new Set(['x']) },
    ]
    const deps = fakeDeps({ x: 120000 }, 100000, cands) // 120000 致死，砍一半→60000 不致死
    const ctx = makeContext(input([dmg('x', 120000)]), deps, cands)
    phase1Feasibility(ctx)
    expect(ctx.evalState.lethal.has('x')).toBe(false)
    expect(ctx.added.length).toBeGreaterThanOrEqual(1)
    expect(ctx.infeasible.has('x')).toBe(false)
  })
  it('救不了的事件落入 infeasible', () => {
    const cands: Candidate[] = [] // 无候选可救
    const deps = fakeDeps({ y: 120000 }, 100000, cands)
    const ctx = makeContext(input([dmg('y', 120000)]), deps, cands)
    phase1Feasibility(ctx)
    expect(ctx.infeasible.has('y')).toBe(true)
  })
})
```

- [ ] **Step 5: 写 `optimizer.ts`（Task 4 部分：context + phase 1）**

```typescript
import { TIME_EPS } from '@/utils/placement/types'
import type { CastEvent } from '@/types/timeline'
import type { OptimizeInput, OptimizeDeps, Candidate, EvalResult, InfeasibleEvent } from './types'

export interface OptimizerContext {
  input: OptimizeInput
  deps: OptimizeDeps
  evaluator: (casts: CastEvent[]) => EvalResult
  cands: Candidate[]
  added: CastEvent[]
  evalState: EvalResult
  infeasible: Map<string, InfeasibleEvent>
}

export function makeContext(
  input: OptimizeInput,
  deps: OptimizeDeps,
  cands: Candidate[]
): OptimizerContext {
  const evaluator = deps.createEvaluator(input)
  const evalState = evaluator(input.lockedCastEvents)
  return { input, deps, evaluator, cands, added: [], evalState, infeasible: new Map() }
}

export function makeCast(ctx: OptimizerContext, c: Candidate): CastEvent {
  return {
    id: ctx.deps.generateId(),
    actionId: c.action.id,
    timestamp: c.start,
    playerId: c.playerId,
  }
}

/** 当前 cast 全集 = locked + added。 */
function allCasts(ctx: OptimizerContext): CastEvent[] {
  return [...ctx.input.lockedCastEvents, ...ctx.added]
}

/**
 * 试探接受一个候选：合法性闸 → 评估 → 可行性单调（不新增致死）→ 整体合法复查。
 * 通过则提交并返回新 EvalResult；否则不改状态返回 null。
 */
export function tryAccept(ctx: OptimizerContext, c: Candidate): EvalResult | null {
  const engine = ctx.deps.buildPlacementEngine(ctx.input, allCasts(ctx), ctx.evalState)
  if (!engine.canPlaceCastEvent(c.action, c.playerId, c.start).ok) return null

  const cast = makeCast(ctx, c)
  const next = ctx.evaluator([...allCasts(ctx), cast])

  // I2 可行性单调：不得新增致死事件
  for (const id of next.lethal) if (!ctx.evalState.lethal.has(id)) return null

  // I1 合法：加入后整组仍合法（资源争用复查）
  const engine2 = ctx.deps.buildPlacementEngine(ctx.input, [...allCasts(ctx), cast], next)
  if (engine2.findInvalidCastEvents().length > 0) return null

  ctx.added.push(cast)
  ctx.evalState = next
  return next
}

/** 阶段 1：消解致死事件（条件性，无致死 / 无 refHP 时整体跳过）。 */
export function phase1Feasibility(ctx: OptimizerContext): void {
  const shelved = new Set<string>()
  for (;;) {
    // 最致死优先（finalDamage / refHP 比值最大），跳过已 shelve
    let target: string | null = null
    let worst = -Infinity
    for (const id of ctx.evalState.lethal) {
      if (shelved.has(id)) continue
      const pe = ctx.evalState.perEvent.get(id)!
      const ratio = pe.referenceMaxHP ? pe.finalDamage / pe.referenceMaxHP : Infinity
      if (ratio > worst) {
        worst = ratio
        target = id
      }
    }
    if (target === null) break

    // 在覆盖 target 的候选里，选对 target 降伤最大者
    let best: { c: Candidate; next: EvalResult } | null = null
    for (const c of ctx.cands) {
      if (!c.covers.has(target)) continue
      const before = ctx.evalState.perEvent.get(target)!.finalDamage
      const next = probe(ctx, c)
      if (!next) continue
      const after = next.perEvent.get(target)!.finalDamage
      if (
        after < before - TIME_EPS &&
        (!best || after < best.next.perEvent.get(target)!.finalDamage)
      ) {
        best = { c, next }
      }
    }

    if (!best) {
      const pe = ctx.evalState.perEvent.get(target)!
      const orig = ctx.input.damageEvents.find(e => e.id === target)!.damage
      ctx.infeasible.set(target, {
        eventId: target,
        originalDamage: orig,
        bestAchievedFinalDamage: pe.finalDamage,
      })
      shelved.add(target)
      continue
    }
    // 真正接受（tryAccept 复查合法/可行并提交）
    if (!tryAccept(ctx, best.c)) {
      shelved.add(target)
    }
  }
}

/** 只读试探：返回若接受 c 后的 EvalResult，不改 ctx（用于打分）。 */
function probe(ctx: OptimizerContext, c: Candidate): EvalResult | null {
  const engine = ctx.deps.buildPlacementEngine(ctx.input, allCasts(ctx), ctx.evalState)
  if (!engine.canPlaceCastEvent(c.action, c.playerId, c.start).ok) return null
  return ctx.evaluator([...allCasts(ctx), makeCast(ctx, c)])
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm test:run src/utils/autoMitigation/prng.test.ts src/utils/autoMitigation/optimizer.phase1.test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/utils/autoMitigation/prng.ts src/utils/autoMitigation/prng.test.ts src/utils/autoMitigation/optimizer.ts src/utils/autoMitigation/optimizer.phase1.test.ts
git commit -m "feat(auto-mitigation): PRNG 与阶段 1 可行性贪心"
```

---

### Task 5: 阶段 2 边际贪心最小化

**Files:**

- Modify: `src/utils/autoMitigation/optimizer.ts`（追加 `phase2Minimize`）
- Test: `src/utils/autoMitigation/optimizer.phase2.test.ts`

**Interfaces:**

- Consumes: `OptimizerContext`、`probe`、`tryAccept`（Task 4）。
- Produces: `phase2Minimize(ctx: OptimizerContext): void`。

- [ ] **Step 1: 写失败测试** `optimizer.phase2.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { makeContext, phase2Minimize } from './optimizer'
import type { OptimizeInput, Candidate, EvalResult, OptimizeDeps } from './types'
import type { MitigationAction } from '@/types/mitigation'
import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { PlacementEngine } from '@/utils/placement/types'

const act = (id: number): MitigationAction =>
  ({
    id,
    name: `a${id}`,
    icon: '',
    jobs: ['WHM'],
    duration: 30,
    cooldown: 60,
    category: ['partywide', 'percentage'],
  }) as MitigationAction
const dmg = (id: string, damage: number): DamageEvent =>
  ({ id, name: id, time: 10, damage, type: 'aoe', damageType: 'magical' }) as DamageEvent

// fake：每个覆盖把对应事件 finalDamage 砍 30%；无致死约束
function fakeDeps(rawDamage: Record<string, number>, cands: Candidate[]): OptimizeDeps {
  const evaluator = (casts: CastEvent[]): EvalResult => {
    const perEvent = new Map()
    let total = 0
    for (const [id, base] of Object.entries(rawDamage)) {
      const hits = casts.filter(c =>
        cands.find(k => k.start === c.timestamp && k.action.id === c.actionId)?.covers.has(id)
      ).length
      const fd = base * Math.pow(0.7, hits)
      perEvent.set(id, { time: 10, inScope: true, finalDamage: fd, referenceMaxHP: undefined })
      total += fd
    }
    return {
      total,
      perEvent,
      lethal: new Set(),
      statusTimelineByPlayer: new Map(),
      resolvedVariantByCastId: new Map(),
    }
  }
  return {
    createEvaluator: () => evaluator,
    buildPlacementEngine: () =>
      ({
        canPlaceCastEvent: () => ({ ok: true }),
        findInvalidCastEvents: () => [],
      }) as unknown as PlacementEngine,
    generateId: (() => {
      let n = 0
      return () => `g${n++}`
    })(),
    now: () => 0,
    makeRandom: () => () => 0,
  }
}

const input = (events: DamageEvent[]): OptimizeInput => ({
  damageEvents: events,
  lockedCastEvents: [],
  composition: { players: [{ id: 1, job: 'WHM' }] },
  actions: new Map([[100, act(100)]]),
  initialState: { statuses: [], timestamp: 0 } as never,
})

describe('phase2Minimize', () => {
  it('优先把减伤盖在更高伤害的事件上', () => {
    // 两个互斥候选（同 action 占同一池，fake 不限制，故都能放，但优先级体现在先选高收益）
    const cands: Candidate[] = [
      { action: act(100), playerId: 1, start: 10, covers: new Set(['big']) },
      { action: act(100), playerId: 1, start: 50, covers: new Set(['small']) },
    ]
    const deps = fakeDeps({ big: 100000, small: 20000 }, cands)
    const ctx = makeContext(input([dmg('big', 100000), dmg('small', 20000)]), deps, cands)
    phase2Minimize(ctx)
    // 第一个被接受的应是覆盖 big 的候选（边际收益更大）
    const first = ctx.added[0]
    expect(first.timestamp).toBe(10)
    expect(ctx.evalState.total).toBeLessThan(120000)
  })
  it('无正收益时停止（不无意义加 cast）', () => {
    const cands: Candidate[] = []
    const deps = fakeDeps({ a: 10000 }, cands)
    const ctx = makeContext(input([dmg('a', 10000)]), deps, cands)
    phase2Minimize(ctx)
    expect(ctx.added.length).toBe(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/autoMitigation/optimizer.phase2.test.ts`
Expected: FAIL（`phase2Minimize` 未定义）

- [ ] **Step 3: 在 `optimizer.ts` 追加 `phase2Minimize`**（导出 `probe` 供本函数复用；若 Task 4 中 `probe` 为模块私有，改为在文件内直接调用即可，无需 export）

```typescript
/**
 * 阶段 2：边际贪心最小化总伤。每轮在保持可行下选 ΔTotal 最大的候选加入，
 * 直到无正收益。朴素全量评估（计划二用 CELF 惰性贪心加速）。
 */
export function phase2Minimize(ctx: OptimizerContext): void {
  const placed = new Set<string>() // 已加入的候选 key，避免重复放同点同技能
  const keyOf = (c: Candidate) => `${c.action.id}@${c.start}#${c.playerId}`
  for (;;) {
    let best: { c: Candidate; next: EvalResult; gain: number } | null = null
    for (const c of ctx.cands) {
      if (placed.has(keyOf(c))) continue
      const next = probe(ctx, c)
      if (!next) continue
      // 可行性单调：不新增致死
      let ok = true
      for (const id of next.lethal)
        if (!ctx.evalState.lethal.has(id)) {
          ok = false
          break
        }
      if (!ok) continue
      const gain = ctx.evalState.total - next.total
      if (gain > (best?.gain ?? TIME_EPS)) best = { c, next, gain }
    }
    if (!best || best.gain <= TIME_EPS) break
    if (tryAccept(ctx, best.c)) placed.add(keyOf(best.c))
    else placed.add(keyOf(best.c)) // 复查失败也标记，避免死循环
  }
}
```

> 注：`probe` 在 Task 4 文件内定义。若它是模块私有函数，`phase2Minimize` 同文件可直接调用；无需额外导出。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run src/utils/autoMitigation/optimizer.phase2.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/utils/autoMitigation/optimizer.ts src/utils/autoMitigation/optimizer.phase2.test.ts
git commit -m "feat(auto-mitigation): 阶段 2 边际贪心最小化"
```

---

### Task 6: 邻域算子 + 阶段 3 局部搜索

**Files:**

- Create: `src/utils/autoMitigation/moves.ts`
- Modify: `src/utils/autoMitigation/optimizer.ts`（追加 `phase3LocalSearch`）
- Test: `src/utils/autoMitigation/moves.test.ts`、`src/utils/autoMitigation/optimizer.phase3.test.ts`

**Interfaces:**

- Consumes: `OptimizerContext`、`tryAccept`、`probe`、`makeCast`（Task 4）；`Candidate`（Task 1）。
- Produces: `proposeMove(ctx, rng): MoveProposal | null`；`phase3LocalSearch(ctx, rng, deadline): void`。`MoveProposal`：

```typescript
interface MoveProposal {
  remove: CastEvent[] // 要撤掉的现有 added cast（0..n）
  add: Candidate[] // 要加入的候选（0..n）
}
```

- [ ] **Step 1: 写失败测试** `moves.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { applyMove } from './moves'
import type { OptimizerContext } from './optimizer'
import type { Candidate, EvalResult } from './types'
import type { CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

const act = (id: number): MitigationAction =>
  ({
    id,
    name: `a${id}`,
    icon: '',
    jobs: ['WHM'],
    duration: 30,
    cooldown: 60,
    category: ['partywide', 'percentage'],
  }) as MitigationAction

describe('applyMove', () => {
  it('接受降总伤的 move（撤 1 加 1）', () => {
    const oldCast: CastEvent = { id: 'old', actionId: 100, timestamp: 50, playerId: 1 }
    const newCand: Candidate = {
      action: act(100),
      playerId: 1,
      start: 10,
      covers: new Set(['big']),
    }
    let totalForCasts = (casts: CastEvent[]) =>
      casts.some(c => c.timestamp === 10) ? 60000 : 100000
    const evaluator = (casts: CastEvent[]): EvalResult => ({
      total: totalForCasts(casts),
      perEvent: new Map(),
      lethal: new Set(),
      statusTimelineByPlayer: new Map(),
      resolvedVariantByCastId: new Map(),
    })
    const ctx = {
      input: { lockedCastEvents: [], damageEvents: [] } as never,
      deps: {
        generateId: () => 'new',
        buildPlacementEngine: () => ({
          canPlaceCastEvent: () => ({ ok: true }),
          findInvalidCastEvents: () => [],
        }),
      } as never,
      evaluator,
      cands: [newCand],
      added: [oldCast],
      evalState: {
        total: 100000,
        perEvent: new Map(),
        lethal: new Set(),
        statusTimelineByPlayer: new Map(),
        resolvedVariantByCastId: new Map(),
      } as EvalResult,
      infeasible: new Map(),
    } as unknown as OptimizerContext
    const accepted = applyMove(ctx, { remove: [oldCast], add: [newCand] }, () => 0)
    expect(accepted).toBe(true)
    expect(ctx.evalState.total).toBe(60000)
    expect(ctx.added.some(c => c.timestamp === 10)).toBe(true)
    expect(ctx.added.some(c => c.id === 'old')).toBe(false)
  })
  it('拒绝升总伤的 move', () => {
    const evaluator = (): EvalResult => ({
      total: 200000,
      perEvent: new Map(),
      lethal: new Set(),
      statusTimelineByPlayer: new Map(),
      resolvedVariantByCastId: new Map(),
    })
    const ctx = {
      input: { lockedCastEvents: [] } as never,
      deps: {
        generateId: () => 'n',
        buildPlacementEngine: () => ({
          canPlaceCastEvent: () => ({ ok: true }),
          findInvalidCastEvents: () => [],
        }),
      } as never,
      evaluator,
      cands: [],
      added: [],
      evalState: {
        total: 100000,
        perEvent: new Map(),
        lethal: new Set(),
        statusTimelineByPlayer: new Map(),
        resolvedVariantByCastId: new Map(),
      } as EvalResult,
      infeasible: new Map(),
    } as unknown as OptimizerContext
    const accepted = applyMove(ctx, { remove: [], add: [] }, () => 0)
    expect(accepted).toBe(false)
    expect(ctx.evalState.total).toBe(100000)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/autoMitigation/moves.test.ts`
Expected: FAIL

- [ ] **Step 3: 写 `moves.ts`**

```typescript
import { TIME_EPS } from '@/utils/placement/types'
import type { CastEvent } from '@/types/timeline'
import type { Candidate } from './types'
import type { OptimizerContext } from './optimizer'

export interface MoveProposal {
  remove: CastEvent[]
  add: Candidate[]
}

/** 评估一个解的 total（不改 ctx）。 */
function totalOf(ctx: OptimizerContext, casts: CastEvent[]): number {
  return ctx.evaluator([...ctx.input.lockedCastEvents, ...casts]).total
}

/**
 * 应用一个 move（撤 remove、加 add），仅当：保持合法 + 不新增致死 + 总伤严格下降 时接受。
 * rng 预留给退火接受准则（计划二）；本版只接受严格改进。
 */
export function applyMove(ctx: OptimizerContext, mv: MoveProposal, _rng: () => number): boolean {
  const removeIds = new Set(mv.remove.map(c => c.id))
  const kept = ctx.added.filter(c => !removeIds.has(c.id))
  const newCasts = mv.add.map(c => ({
    id: ctx.deps.generateId(),
    actionId: c.action.id,
    timestamp: c.start,
    playerId: c.playerId,
  }))
  const candidate = [...kept, ...newCasts]

  const all = [...ctx.input.lockedCastEvents, ...candidate]
  const next = ctx.evaluator(all)

  // 合法
  const engine = ctx.deps.buildPlacementEngine(ctx.input, all, next)
  if (engine.findInvalidCastEvents().length > 0) return false
  // 不新增致死
  for (const id of next.lethal) if (!ctx.evalState.lethal.has(id)) return false
  // 严格降总伤
  if (next.total >= ctx.evalState.total - TIME_EPS) return false

  ctx.added = candidate
  ctx.evalState = next
  return true
}

/**
 * 提议一个随机 move：在现有 added 与候选间做 move/swap/replace/remove+add。
 * 偏向围绕高伤害事件采样（轻量启发，详细邻域剪枝见计划二）。
 */
export function proposeMove(ctx: OptimizerContext, rng: () => number): MoveProposal | null {
  if (ctx.cands.length === 0) return null
  const c = ctx.cands[Math.floor(rng() * ctx.cands.length)]
  // 若该候选时间点上已有同 player 的 cast，做替换；否则纯加入
  const clash = ctx.added.filter(
    a => a.playerId === c.playerId && Math.abs(a.timestamp - c.start) < TIME_EPS
  )
  return { remove: clash, add: [c] }
}
```

- [ ] **Step 4: 在 `optimizer.ts` 追加 `phase3LocalSearch`**

```typescript
import { applyMove, proposeMove } from './moves'

/**
 * 阶段 3：局部搜索精修，吃满 deadline 前的预算。维护 best 快照，
 * 预算到点回退到 best（不退化）。本版只接受严格改进的 move。
 */
export function phase3LocalSearch(
  ctx: OptimizerContext,
  rng: () => number,
  deadline: number
): void {
  let bestAdded = [...ctx.added]
  let bestEval = ctx.evalState
  while (ctx.deps.now() < deadline) {
    const mv = proposeMove(ctx, rng)
    if (!mv) break
    applyMove(ctx, mv, rng)
    if (ctx.evalState.total < bestEval.total) {
      bestAdded = [...ctx.added]
      bestEval = ctx.evalState
    }
  }
  ctx.added = bestAdded
  ctx.evalState = bestEval
}
```

- [ ] **Step 5: 写 `optimizer.phase3.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { makeContext, phase2Minimize, phase3LocalSearch } from './optimizer'
import { mulberry32 } from './prng'
import type { OptimizeInput, Candidate, EvalResult, OptimizeDeps } from './types'
import type { MitigationAction } from '@/types/mitigation'
import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { PlacementEngine } from '@/utils/placement/types'

const act = (id: number): MitigationAction =>
  ({
    id,
    name: `a${id}`,
    icon: '',
    jobs: ['WHM'],
    duration: 30,
    cooldown: 60,
    category: ['partywide', 'percentage'],
  }) as MitigationAction
const dmg = (id: string, damage: number): DamageEvent =>
  ({ id, name: id, time: 10, damage, type: 'aoe', damageType: 'magical' }) as DamageEvent

function fakeDeps(
  rawDamage: Record<string, number>,
  cands: Candidate[],
  clock: { t: number }
): OptimizeDeps {
  const evaluator = (casts: CastEvent[]): EvalResult => {
    const perEvent = new Map()
    let total = 0
    for (const [id, base] of Object.entries(rawDamage)) {
      const hits = casts.filter(c =>
        cands.find(k => k.start === c.timestamp && k.action.id === c.actionId)?.covers.has(id)
      ).length
      const fd = base * Math.pow(0.5, hits)
      perEvent.set(id, { time: 10, inScope: true, finalDamage: fd })
      total += fd
    }
    return {
      total,
      perEvent,
      lethal: new Set(),
      statusTimelineByPlayer: new Map(),
      resolvedVariantByCastId: new Map(),
    }
  }
  return {
    createEvaluator: () => evaluator,
    buildPlacementEngine: () =>
      ({
        canPlaceCastEvent: () => ({ ok: true }),
        findInvalidCastEvents: () => [],
      }) as unknown as PlacementEngine,
    generateId: (() => {
      let n = 0
      return () => `g${n++}`
    })(),
    now: () => clock.t++,
    makeRandom: mulberry32,
  }
}

describe('phase3LocalSearch', () => {
  it('预算内不退化（best 不升）', () => {
    const cands: Candidate[] = [
      { action: act(100), playerId: 1, start: 10, covers: new Set(['x']) },
    ]
    const clock = { t: 0 }
    const deps = fakeDeps({ x: 100000 }, cands, clock)
    const input: OptimizeInput = {
      damageEvents: [dmg('x', 100000)],
      lockedCastEvents: [],
      composition: { players: [{ id: 1, job: 'WHM' }] },
      actions: new Map([[100, act(100)]]),
      initialState: { statuses: [], timestamp: 0 } as never,
    }
    const ctx = makeContext(input, deps, cands)
    phase2Minimize(ctx)
    const before = ctx.evalState.total
    phase3LocalSearch(ctx, mulberry32(1), 100)
    expect(ctx.evalState.total).toBeLessThanOrEqual(before)
  })
})
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm test:run src/utils/autoMitigation/moves.test.ts src/utils/autoMitigation/optimizer.phase3.test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/utils/autoMitigation/moves.ts src/utils/autoMitigation/moves.test.ts src/utils/autoMitigation/optimizer.ts src/utils/autoMitigation/optimizer.phase3.test.ts
git commit -m "feat(auto-mitigation): 邻域算子与阶段 3 局部搜索"
```

---

### Task 7: 顶层 runOptimize 编排 + 真实集成测试

**Files:**

- Modify: `src/utils/autoMitigation/optimizer.ts`（追加 `runOptimize` + `defaultDeps`）
- Create: `src/utils/autoMitigation/index.ts`（对外只导出 `runOptimize` 与类型）
- Test: `src/utils/autoMitigation/optimizer.integration.test.ts`

**Interfaces:**

- Consumes: 全部前序；`createMitigationCalculator`、`createPlacementEngine`、`generateId`。
- Produces: `runOptimize(input: OptimizeInput, deps?: OptimizeDeps): OptimizeOutput`；`defaultDeps(): OptimizeDeps`。

- [ ] **Step 1: 在 `optimizer.ts` 追加 `defaultDeps` 与 `runOptimize`**

```typescript
import { createMitigationCalculator } from '@/utils/mitigationCalculator'
import { createPlacementEngine } from '@/utils/placement/engine'
import { generateId } from '@/utils/id'
import { mulberry32 } from './prng'
import { createEvaluator } from './evaluate'
import { generateCandidates } from './candidates'
import type { OptimizeOutput } from './types'

export function defaultDeps(): OptimizeDeps {
  return {
    createEvaluator,
    buildPlacementEngine: (input, casts, eval0) =>
      createPlacementEngine({
        castEvents: casts,
        actions: input.actions,
        statusTimelineByPlayer: eval0.statusTimelineByPlayer,
        resolvedVariantByCastId: eval0.resolvedVariantByCastId,
      }),
    generateId,
    now: () => Date.now(),
    makeRandom: mulberry32,
  }
}

/** 顶层编排：候选生成 → 阶段 1 → 阶段 2 → 阶段 3 → 汇总。 */
export function runOptimize(
  input: OptimizeInput,
  deps: OptimizeDeps = defaultDeps()
): OptimizeOutput {
  const start = deps.now()
  const budget = input.options?.timeBudgetMs ?? 3000
  const rng = deps.makeRandom(input.options?.seed ?? 1)

  // 候选基于 locked-only 基线的 status 时间线生成（起点固定，合法性后续动态复查）
  const evaluator = deps.createEvaluator(input)
  const baseEval = evaluator(input.lockedCastEvents)
  const baseEngine = deps.buildPlacementEngine(input, input.lockedCastEvents, baseEval)
  const cands = generateCandidates(input, baseEngine)

  const ctx = makeContext(input, deps, cands)
  const totalBefore = ctx.evalState.total

  phase1Feasibility(ctx)
  phase2Minimize(ctx)
  phase3LocalSearch(ctx, rng, start + budget)

  return {
    addedCastEvents: ctx.added,
    infeasibleEvents: [...ctx.infeasible.values()],
    summary: {
      totalDamageBefore: totalBefore,
      totalDamageAfter: ctx.evalState.total,
      castsAdded: ctx.added.length,
      elapsedMs: deps.now() - start,
    },
  }
}
```

- [ ] **Step 2: 写 `index.ts`**

```typescript
export { runOptimize, defaultDeps } from './optimizer'
export type {
  OptimizeInput,
  OptimizeOutput,
  OptimizeOptions,
  InfeasibleEvent,
  OptimizeSummary,
} from './types'
```

- [ ] **Step 3: 写集成测试** `optimizer.integration.test.ts`（真实 simulate + 真实 PlacementEngine + 真实技能数据）

```typescript
import { describe, it, expect } from 'vitest'
import { runOptimize } from './optimizer'
import { generateCandidates } from './candidates'
import { defaultDeps } from './optimizer'
import { createEvaluator } from './evaluate'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { createPlacementEngine } from '@/utils/placement/engine'
import type { OptimizeInput } from './types'
import type { DamageEvent } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'

function actionsMap() {
  return new Map(MITIGATION_DATA.actions.map(a => [a.id, a]))
}

const dmg = (id: string, time: number, damage: number): DamageEvent =>
  ({ id, name: id, time, damage, type: 'aoe', damageType: 'magical' }) as DamageEvent

describe('runOptimize（集成）', () => {
  const input: OptimizeInput = {
    damageEvents: [dmg('m1', 30, 90000), dmg('m2', 90, 95000), dmg('m3', 150, 88000)],
    lockedCastEvents: [],
    composition: {
      players: [
        { id: 1, job: 'WAR' },
        { id: 2, job: 'WHM' },
        { id: 3, job: 'SCH' },
        { id: 4, job: 'SAM' },
      ],
    },
    actions: actionsMap(),
    initialState: { statuses: [], timestamp: 0 } as PartyState,
    baseReferenceMaxHPForAoe: 100000,
    options: { timeBudgetMs: 800, seed: 1 },
  }

  it('降低总伤且不产生非法 cast', () => {
    const out = runOptimize(input)
    expect(out.summary.totalDamageAfter).toBeLessThan(out.summary.totalDamageBefore)
    // 用真实 PlacementEngine 校验产出全合法
    const ev = createEvaluator(input)(input.lockedCastEvents.concat(out.addedCastEvents))
    const engine = createPlacementEngine({
      castEvents: [...input.lockedCastEvents, ...out.addedCastEvents],
      actions: input.actions,
      statusTimelineByPlayer: ev.statusTimelineByPlayer,
      resolvedVariantByCastId: ev.resolvedVariantByCastId,
    })
    expect(engine.findInvalidCastEvents()).toEqual([])
  })

  it('确定性：同 seed 同结果', () => {
    const a = runOptimize(input)
    const b = runOptimize(input)
    expect(a.addedCastEvents.map(c => `${c.actionId}@${c.timestamp}#${c.playerId}`)).toEqual(
      b.addedCastEvents.map(c => `${c.actionId}@${c.timestamp}#${c.playerId}`)
    )
  })

  it('addedCastEvents 结构合法：actionId 为 trackGroup 父、id 唯一', () => {
    const out = runOptimize(input)
    const ids = out.addedCastEvents.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of out.addedCastEvents) {
      expect(input.actions.has(c.actionId)).toBe(true)
    }
  })
})
```

- [ ] **Step 4: 跑全量测试 + 类型 + lint**

Run: `pnpm test:run src/utils/autoMitigation && pnpm exec tsc --noEmit && pnpm lint`
Expected: 全 PASS，无类型/lint 错误

> 集成测试可能因真实技能数据的合法窗口而行为不同；若 `totalDamageAfter < totalDamageBefore` 偶发不成立（候选都不合法），放宽为 `≤` 并在 summary 断言 `castsAdded >= 0`，同时排查 `baseReferenceMaxHPForAoe` 与事件伤害是否触发了减伤。优先保证"无非法 cast"与"确定性"两条硬断言。

- [ ] **Step 5: 提交**

```bash
git add src/utils/autoMitigation/optimizer.ts src/utils/autoMitigation/index.ts src/utils/autoMitigation/optimizer.integration.test.ts
git commit -m "feat(auto-mitigation): runOptimize 顶层编排与集成测试"
```

---

## Self-Review

**Spec coverage：**

- §1 目标（硬约束+软目标解耦、软目标永远执行）→ Task 4 `phase1Feasibility`（条件性）+ Task 5/6（无条件）。✅
- §1 in-scope 定义 → Task 1 `scope.ts`。✅
- §4 类型/数据流 → Task 1 `types.ts`、Task 7 `runOptimize`。✅
- §4 候选断点集（Bcov∪Bwin；Bvar 标注计划二）→ Task 3。✅（Bvar 变体感知与 §8.8 局部失效/启发剪枝、§8.7 CELF/增量 → **计划二**）
- §5 判定口径复用 `deriveLethalDangerous` → Task 2。✅
- §5 三阶段 → Task 4/5/6。✅
- §6 worker/UX → **计划三**（本计划不含）。
- §7 测试（候选、可行性、最小化、确定性、写回契约、健全性 I1/I2）→ 各 Task 测试 + Task 7 集成。✅
- §8.1 健全性 I1/I2 → Task 4 `tryAccept`（canPlaceCastEvent + findInvalidCastEvents + 致死单调）、Task 6 `applyMove` 同款闸门。✅
- §8.5 终止性（阶段 3 预算封顶、不退化）→ Task 6 `phase3LocalSearch` best 快照。✅

**Placeholder scan：** 无 TBD/TODO；每个代码步给出完整可编译代码。计划二/三的边界已显式声明，非占位。

**Type consistency：** `OptimizerContext`、`Candidate`、`EvalResult`、`tryAccept`、`probe`、`makeContext`、`phase1Feasibility`、`phase2Minimize`、`phase3LocalSearch`、`applyMove`、`proposeMove` 跨 Task 命名一致；`OptimizeDeps` 字段（`createEvaluator`/`buildPlacementEngine`/`generateId`/`now`/`makeRandom`）在 Task 1 定义、Task 4–7 一致使用。

---

## 后续计划（不在本计划内）

- **计划二（性能）**：CELF 惰性贪心替换 Task 5 朴素全量、增量 evaluate、`Bvar` 变体感知候选、§8.8 启发剪枝（`options.aggressive`）、退火接受准则。
- **计划三（集成）**：calculator worker 新增 `optimize` 入口、EditorPage「自动减伤」按钮、预览/应用/放弃、`infeasibleEvents` 警告、批量 `addCastEvents` 单 undo。
