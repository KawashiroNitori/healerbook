# HP 曲线轨道 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在伤害事件轨道与技能轨道之间新增 HP 曲线轨道，可视化 HP 模拟的累积扣血/治疗补回过程。

**Architecture:** `MitigationCalculator.simulate` 内部在每次 `hp.current` 改变后 push 一个 `HpTimelinePoint` 到 `SimulateOutput.hpTimeline`；`useDamageCalculation` 透传到 Timeline 主组件；新组件 `HpCurveTrack` 渲染在 `fixedStage` 内（与伤害轨道并列，不随主区垂直滚动）。

**Tech Stack:** React 19、TypeScript、react-konva 19 / Konva 10、Zustand、Vitest 4

**关联 spec:** `design/superpowers/specs/2026-04-28-hp-curve-track-design.md`

---

## 文件结构

| 文件                                       | 状态   | 职责                                                                    |
| ------------------------------------------ | ------ | ----------------------------------------------------------------------- |
| `src/types/hpTimeline.ts`                  | new    | `HpTimelinePoint` 类型定义                                              |
| `src/utils/mitigationCalculator.ts`        | modify | simulate 内 push 各类点；`SimulateOutput.hpTimeline`                    |
| `src/utils/mitigationCalculator.test.ts`   | modify | 5 个新单测（init / damage / heal+tick / maxhp / sort）                  |
| `src/hooks/useDamageCalculation.ts`        | modify | `DamageCalculationResult.hpTimeline` 透传                               |
| `src/components/Timeline/constants.ts`     | modify | 加 `HP_CURVE_HEIGHT`、`hpCurveStroke`、`hpCurveFill`、`hpCurveBaseline` |
| `src/components/Timeline/HpCurveTrack.tsx` | new    | Konva 折线 + 面积填充 + maxHP 基线渲染                                  |
| `src/components/Timeline/index.tsx`        | modify | hook、layoutData、`<HpCurveTrack>` 嵌入、左侧标签栏新增 "HP" 行         |

---

## Task 1: 新增 HpTimelinePoint 类型

**Files:**

- Create: `src/types/hpTimeline.ts`

- [ ] **Step 1: 创建类型文件**

```ts
/**
 * HP 池演化序列上的一个点。
 *
 * MitigationCalculator.simulate 在每次 hp.current 改变后 push 一条，
 * 出口前按 time 升序 sort（与 healSnapshots 一致）。
 *
 * - kind 区分触发原因：
 *   - init：simulate 入口 hp 池初始化后立即 push 一条
 *   - damage：applyDamageToHp 之后（aoe 或 partial 段增量）
 *   - heal：cast 一次性治疗（recordHeal 且 isHotTick=false）
 *   - tick：HoT tick 治疗（recordHeal 且 isHotTick=true）
 *   - maxhp-change：recomputeHpMax 后 hp.max 变化（含 hp.current 同步缩放）
 */
export type HpTimelineKind = 'init' | 'damage' | 'heal' | 'tick' | 'maxhp-change'

export interface HpTimelinePoint {
  /** 该点对应的时刻（秒） */
  time: number
  /** 该时刻 hp.current（已 clamp 到 [0, hp.max]） */
  hp: number
  /** 该时刻 hp.max（含 maxHP buff 累乘） */
  hpMax: number
  /** 触发原因 */
  kind: HpTimelineKind
  /** 关联源事件 id（damage = damage event id；heal/tick = cast event id；init/maxhp-change = undefined） */
  refEventId?: string
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无输出（干净）

- [ ] **Step 3: Commit**

```bash
git add src/types/hpTimeline.ts
git commit -m "feat(types): 新增 HpTimelinePoint 类型"
```

---

## Task 2: 接通 hpTimeline 输出管道（暂返空数组）

**目的：** 在 simulate 内还没 push 任何点之前，先把 SimulateOutput 字段、useDamageCalculation 透传打通，确保后续 push 点的 task 不必再修接口。

**Files:**

- Modify: `src/utils/mitigationCalculator.ts`
- Modify: `src/hooks/useDamageCalculation.ts`

- [ ] **Step 1: SimulateOutput 加 hpTimeline 字段**

在 `src/utils/mitigationCalculator.ts` 顶部 import 区追加：

```ts
import type { HpTimelinePoint } from '@/types/hpTimeline'
```

找到 SimulateOutput interface（约 145 行），在 `healSnapshots` 字段后追加：

```ts
  /** HP 池演化序列（time 升序）；回放模式 / hp 池未初始化时为空数组 */
  hpTimeline: HpTimelinePoint[]
```

在 simulate 函数体内 `const healSnapshots: HealSnapshot[] = []` 旁加：

```ts
const hpTimeline: HpTimelinePoint[] = []
```

return 块加字段：

```ts
return {
  damageResults,
  statusTimelineByPlayer,
  castEffectiveEndByCastEventId,
  healSnapshots,
  hpTimeline,
}
```

- [ ] **Step 2: useDamageCalculation 透传**

在 `src/hooks/useDamageCalculation.ts` 加 `import type { HpTimelinePoint } from '@/types/hpTimeline'`。

DamageCalculationResult 接口追加：

```ts
  /** HP 池演化序列（time 升序）；空时 HP 曲线轨道不挂载 */
  hpTimeline: HpTimelinePoint[]
```

`empty` 占位常量补 `hpTimeline: []`。

return 块（line ~144）补 `hpTimeline: full.hpTimeline`。

- [ ] **Step 3: 类型检查 + 现有测试不破**

Run: `pnpm exec tsc --noEmit && pnpm test:run src/utils/mitigationCalculator.test.ts src/hooks/useDamageCalculation.test.ts`
Expected: 类型干净；现有 644+ 测试全过

- [ ] **Step 4: Commit**

```bash
git add src/utils/mitigationCalculator.ts src/hooks/useDamageCalculation.ts
git commit -m "feat(simulator): SimulateOutput 透传 hpTimeline 字段（暂空）"
```

---

## Task 3: TDD push init point

**Files:**

- Modify: `src/utils/mitigationCalculator.test.ts`
- Modify: `src/utils/mitigationCalculator.ts`

- [ ] **Step 1: 在测试文件最末尾追加新 describe block**

```ts
describe('HP 池 · hpTimeline', () => {
  const baseInitialState: PartyState = { statuses: [], timestamp: 0 }

  it('hp 池初始化后立即 push 一条 init point', () => {
    const calculator = new MitigationCalculator()
    const out = calculator.simulate({
      castEvents: [],
      damageEvents: [],
      initialState: baseInitialState,
      baseReferenceMaxHPForAoe: 100000,
    })
    expect(out.hpTimeline).toEqual([{ time: 0, hp: 100000, hpMax: 100000, kind: 'init' }])
  })

  it('未配 hp 池时 hpTimeline 为空', () => {
    const calculator = new MitigationCalculator()
    const out = calculator.simulate({
      castEvents: [],
      damageEvents: [],
      initialState: baseInitialState,
      // 不传 baseReferenceMaxHPForAoe → initialHpPool=undefined
    })
    expect(out.hpTimeline).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试，确认两条都失败**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts -t "HP 池 · hpTimeline"`
Expected: 2 failed —— "expected [] to deep equal [{...init}]" 与 "expected [] to deep equal []"（第二条会过，但第一条失败）

- [ ] **Step 3: 实现 push init**

在 `src/utils/mitigationCalculator.ts` simulate 函数中找到 `currentState = this.recomputeHpMax(currentState)`（约 568 行，紧跟 `let currentState: PartyState = { statuses: ..., hp: initialHpPool }` 后面）。

在 `currentState = this.recomputeHpMax(currentState)` 之后立即追加：

```ts
if (currentState.hp) {
  hpTimeline.push({
    time: currentState.timestamp,
    hp: currentState.hp.current,
    hpMax: currentState.hp.max,
    kind: 'init',
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts -t "HP 池 · hpTimeline"`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "feat(simulator): hpTimeline push init point"
```

---

## Task 4: TDD push damage point

**Files:**

- Modify: `src/utils/mitigationCalculator.test.ts`
- Modify: `src/utils/mitigationCalculator.ts`

- [ ] **Step 1: 在 'HP 池 · hpTimeline' describe 内追加测试**

```ts
it('aoe 事件后 push damage point，hp 反映扣血结果', () => {
  const calculator = new MitigationCalculator()
  const out = calculator.simulate({
    castEvents: [],
    damageEvents: [mkDmg('A', 10, 'aoe', 30000)],
    initialState: baseInitialState,
    baseReferenceMaxHPForAoe: 100000,
  })
  expect(out.hpTimeline).toEqual([
    { time: 0, hp: 100000, hpMax: 100000, kind: 'init' },
    { time: 10, hp: 70000, hpMax: 100000, kind: 'damage', refEventId: 'A' },
  ])
})

it('partial 段每条扣血都各自 push 一条 damage point', () => {
  const calculator = new MitigationCalculator()
  const out = calculator.simulate({
    castEvents: [],
    damageEvents: [
      mkDmg('A', 5, 'partial_aoe', 20000),
      mkDmg('B', 10, 'partial_aoe', 25000),
      mkDmg('C', 15, 'partial_final_aoe', 30000),
    ],
    initialState: baseInitialState,
    baseReferenceMaxHPForAoe: 100000,
  })
  const dmgPoints = out.hpTimeline.filter(p => p.kind === 'damage')
  expect(dmgPoints).toEqual([
    { time: 5, hp: 80000, hpMax: 100000, kind: 'damage', refEventId: 'A' },
    { time: 10, hp: 75000, hpMax: 100000, kind: 'damage', refEventId: 'B' },
    { time: 15, hp: 70000, hpMax: 100000, kind: 'damage', refEventId: 'C' },
  ])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts -t "HP 池 · hpTimeline"`
Expected: 4 tests, 2 failed (新增的两条)

- [ ] **Step 3: 实现 push damage**

在 simulate 主循环里找到 `damageResults.set(event.id, { ...result, hpSimulation: hpSnap })`（约 648 行；上一 commit 改成构造时合并的那一行）。

在该行之后、`currentState = stateAfterHp` 之前插入：

```ts
if (stateAfterHp.hp) {
  hpTimeline.push({
    time: filterTime,
    hp: stateAfterHp.hp.current,
    hpMax: stateAfterHp.hp.max,
    kind: 'damage',
    refEventId: event.id,
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts -t "HP 池 · hpTimeline"`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "feat(simulator): hpTimeline push damage point"
```

---

## Task 5: TDD push heal/tick point

**Files:**

- Modify: `src/utils/mitigationCalculator.test.ts`
- Modify: `src/utils/mitigationCalculator.ts`

- [ ] **Step 1: 追加测试（复用现有 reactive heal mock 模式）**

在 'HP 池 · hpTimeline' describe 内追加：

```ts
it('recordHeal 触发时 push heal point（isHotTick=false）', () => {
  // 复用现有 onAfterDamage reactive heal mock：每次伤害后 +1500 治疗
  const REACTIVE_HEAL_BUFF_ID = 999900
  const mkMeta = (): MitigationStatusMetadata =>
    ({
      id: REACTIVE_HEAL_BUFF_ID,
      name: 'mock-heal',
      type: 'multiplier',
      performance: { physics: 1, magic: 1, darkness: 1 },
      isFriendly: true,
      isTankOnly: false,
      executor: {
        onAfterDamage: (ctx: {
          partyState: PartyState
          event: { time: number }
          recordHeal?: (snap: unknown) => void
        }) => {
          if (!ctx.partyState.hp) return
          const heal = 5000
          const before = ctx.partyState.hp.current
          const next = Math.min(before + heal, ctx.partyState.hp.max)
          ctx.recordHeal?.({
            castEventId: 'cast-heal-1',
            actionId: 0,
            sourcePlayerId: 1,
            time: ctx.event.time,
            baseAmount: heal,
            finalHeal: heal,
            applied: next - before,
            overheal: heal - (next - before),
            isHotTick: false,
          })
          return { ...ctx.partyState, hp: { ...ctx.partyState.hp, current: next } }
        },
      },
    }) as unknown as MitigationStatusMetadata

  const spy = vi
    .spyOn(registry, 'getStatusById')
    .mockImplementation(id => (id === REACTIVE_HEAL_BUFF_ID ? mkMeta() : undefined))
  try {
    const calculator = new MitigationCalculator()
    const initialState: PartyState = {
      statuses: [
        {
          instanceId: 'reactive',
          statusId: REACTIVE_HEAL_BUFF_ID,
          startTime: 0,
          endTime: 60,
          sourcePlayerId: 1,
        },
      ],
      timestamp: 0,
    }
    const out = calculator.simulate({
      castEvents: [],
      damageEvents: [mkDmg('A', 10, 'aoe', 30000)],
      initialState,
      baseReferenceMaxHPForAoe: 100000,
    })

    // 顺序：init → heal（onAfterDamage 钩子在 hp 扣血之前 fire，hp 满 → 全溢出）→ damage
    // 注：满血时治疗 applied=0，但仍 push 一条 point（hp/hpMax 不变）
    const events = out.hpTimeline.map(p => ({
      time: p.time,
      kind: p.kind,
      hp: p.hp,
      refEventId: p.refEventId,
    }))
    expect(events).toEqual([
      { time: 0, kind: 'init', hp: 100000, refEventId: undefined },
      { time: 10, kind: 'heal', hp: 100000, refEventId: 'cast-heal-1' },
      { time: 10, kind: 'damage', hp: 70000, refEventId: 'A' },
    ])
  } finally {
    spy.mockRestore()
  }
})

it('isHotTick=true 时 kind=tick', () => {
  const TICK_BUFF_ID = 999901
  const mkTickMeta = (): MitigationStatusMetadata =>
    ({
      id: TICK_BUFF_ID,
      name: 'mock-tick',
      type: 'multiplier',
      performance: { physics: 1, magic: 1, darkness: 1 },
      isFriendly: true,
      isTankOnly: false,
      executor: {
        onTick: (ctx: {
          partyState: PartyState
          tickTime: number
          recordHeal?: (snap: unknown) => void
        }) => {
          if (!ctx.partyState.hp) return
          const heal = 1000
          const before = ctx.partyState.hp.current
          const next = Math.min(before + heal, ctx.partyState.hp.max)
          ctx.recordHeal?.({
            castEventId: 'hot-cast',
            actionId: 0,
            sourcePlayerId: 1,
            time: ctx.tickTime,
            baseAmount: heal,
            finalHeal: heal,
            applied: next - before,
            overheal: heal - (next - before),
            isHotTick: true,
          })
          return { ...ctx.partyState, hp: { ...ctx.partyState.hp, current: next } }
        },
      },
    }) as unknown as MitigationStatusMetadata

  const spy = vi
    .spyOn(registry, 'getStatusById')
    .mockImplementation(id => (id === TICK_BUFF_ID ? mkTickMeta() : undefined))
  try {
    const calculator = new MitigationCalculator()
    // 先一次伤害把血扣到 50k 留出 tick 空间，再 advanceToTime 跨 9s 触发 3 个 tick
    const initialState: PartyState = {
      statuses: [
        {
          instanceId: 'hot',
          statusId: TICK_BUFF_ID,
          startTime: 0,
          endTime: 60,
          sourcePlayerId: 1,
        },
      ],
      timestamp: 0,
    }
    const out = calculator.simulate({
      castEvents: [],
      damageEvents: [
        mkDmg('A', 1, 'aoe', 50000), // hp → 50000
        mkDmg('B', 12, 'aoe', 0), // 走到 12s 触发 t=3,6,9,12 共 4 个 tick
      ],
      initialState,
      baseReferenceMaxHPForAoe: 100000,
    })

    const tickPoints = out.hpTimeline.filter(p => p.kind === 'tick')
    // tick 在 (prev, cur] 区间触发：第一段 (0,1] 无；第二段 (1,12] 触发 3,6,9,12
    expect(tickPoints.map(p => p.time)).toEqual([3, 6, 9, 12])
    expect(tickPoints[0].refEventId).toBe('hot-cast')
  } finally {
    spy.mockRestore()
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts -t "HP 池 · hpTimeline"`
Expected: 6 tests, 2 failed (新增两条)

- [ ] **Step 3: 实现 push heal/tick**

在 simulate 函数体内找到 `const recordHeal = (snap: HealSnapshot) => healSnapshots.push(snap)`（约 376 行），改成：

```ts
const recordHeal = (snap: HealSnapshot) => {
  healSnapshots.push(snap)
  // hpTimeline 同步：recordHeal 调用时 currentState 还未被 reactive heal 钩子的返回值更新，
  // 所以 push 的 hp 应该用 snap.applied 之后的值。但 snap.applied 已经反映"治疗实际加到 hp 的量"，
  // 钩子内部又会通过 return state 把 hp.current 更新。这里我们用 snap.time + 调用方下一行的 hp 值。
  // 简化：钩子调用 recordHeal 时已知 finalHeal/applied，直接构造 point 用 snap 数据。
  // 但我们需要 hp.current（钩子尚未 return），所以：用 lastHpAfterHeal helper。
}
```

**实际更简单的实现**：把 push 推到 hpTimeline 的位置不在 recordHeal 内部（拿不到 hp.current），而是在调用者拿到 result/state 之后。但这就要改所有 onAfterDamage / onConsume / onBeforeShield / onTick 钩子的调用点，太重。

**采用方案**：在 recordHeal 内 push，hp 用 `snap.applied` 算出"如果钩子按惯例更新 hp"的预期值。但这会与钩子真实行为脱钩（如果钩子不更新 hp 但调了 recordHeal，hpTimeline 会写错）。

**最终方案**：在 recordHeal 内只 push 一条 placeholder，不带 hp/hpMax；在每个 advanceToTime / calculate 之后由 simulate 主循环统一回填 hp。但这复杂。

**采用最简实用方案**：**recordHeal 内直接 push，hp 字段由 simulate 主循环在每个 tick / cast 完成后，发现 hpTimeline 的最后一条 hp 缺失时，从 currentState 回填**——同样复杂。

**真正采用的方案（trade-off）**：

修改 recordHeal 签名，让钩子调用前/后由 simulate 主循环显式填 hp 字段。具体做法：

把 recordHeal 在每个钩子调用周围"包装"——但每个钩子点都不一样。

**简化决策：将 hpTimeline 推迟到 task 7 一起重构**。Task 5 仅 push heal point 的 time/kind/refEventId，hp/hpMax 字段在 task 7 用"出口处遍历 + 用临时 hp 池跟踪"补齐。

具体实现：

把 `recordHeal` 改成：

```ts
const recordHeal = (snap: HealSnapshot) => {
  healSnapshots.push(snap)
  hpTimeline.push({
    time: snap.time,
    hp: 0, // 占位，task 7 在出口处用临时回放算 hp 序列
    hpMax: 0, // 同上
    kind: snap.isHotTick ? 'tick' : 'heal',
    refEventId: snap.castEventId || undefined,
  })
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts -t "HP 池 · hpTimeline"`
Expected: 测试关于 kind/time/refEventId 通过；hp 字段错（task 7 修）。

**为简化阶段性验证，临时把 task 5 测试里 expect 的 hp 字段改 0；task 7 再改回正确值**：

```ts
// Task 5 临时（task 7 删）：
expect(events).toEqual([
  { time: 0, kind: 'init', hp: 100000, refEventId: undefined },
  { time: 10, kind: 'heal', hp: 0, refEventId: 'cast-heal-1' },
  { time: 10, kind: 'damage', hp: 70000, refEventId: 'A' },
])
```

```ts
// tick 测试同样不验证 hp 字段，只验证 time/kind
```

- [ ] **Step 5: Commit**

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "feat(simulator): hpTimeline push heal/tick point（hp 字段待 task 7 回填）"
```

---

## Task 6: TDD push maxhp-change point

**Files:**

- Modify: `src/utils/mitigationCalculator.test.ts`
- Modify: `src/utils/mitigationCalculator.ts`

- [ ] **Step 1: 追加测试**

```ts
it('maxHP buff 切换时 push maxhp-change point', () => {
  // 复用现有 maxHP buff 测试模式：mock 一个 +20% maxHP buff
  const MAXHP_BUFF_ID = 999902
  const mkMaxHpMeta = (): MitigationStatusMetadata =>
    ({
      id: MAXHP_BUFF_ID,
      name: 'mock-maxhp',
      type: 'multiplier',
      performance: { physics: 1, magic: 1, darkness: 1, maxHP: 1.2 },
      isFriendly: true,
      isTankOnly: false,
    }) as unknown as MitigationStatusMetadata

  const spy = vi
    .spyOn(registry, 'getStatusById')
    .mockImplementation(id => (id === MAXHP_BUFF_ID ? mkMaxHpMeta() : undefined))
  try {
    const calculator = new MitigationCalculator()
    // buff 在 t=5 自然过期 → recomputeHpMax 缩 hp.max → 应该 push 一条 maxhp-change
    const initialState: PartyState = {
      statuses: [
        {
          instanceId: 'maxhp-buff',
          statusId: MAXHP_BUFF_ID,
          startTime: 0,
          endTime: 5,
          sourcePlayerId: 1,
        },
      ],
      timestamp: 0,
    }
    const out = calculator.simulate({
      castEvents: [],
      damageEvents: [mkDmg('A', 10, 'aoe', 0)], // 推进时间到 10s 让 buff 过期
      initialState,
      baseReferenceMaxHPForAoe: 100000,
    })

    const maxhpPoints = out.hpTimeline.filter(p => p.kind === 'maxhp-change')
    expect(maxhpPoints.length).toBeGreaterThanOrEqual(1)
    // 至少有一条 hp.max 不是 120000（过期后）
    expect(maxhpPoints.some(p => p.hpMax === 100000)).toBe(true)
  } finally {
    spy.mockRestore()
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts -t "HP 池 · hpTimeline"`
Expected: 1 failed

- [ ] **Step 3: 实现 push maxhp-change**

在 `MitigationCalculator` 类内找到 `recomputeHpMax` 方法（约 340 行）。**不修改方法本身**——而是在 simulate 内每次调用 recomputeHpMax 后比较前后的 hp.max。

更可靠：包一层 helper 在 simulate 内：

simulate 函数顶部 `const hpTimeline: HpTimelinePoint[] = []` 旁追加：

```ts
const recomputeAndTrack = (state: PartyState, time: number): PartyState => {
  const next = this.recomputeHpMax(state)
  if (state.hp && next.hp && state.hp.max !== next.hp.max) {
    hpTimeline.push({
      time,
      hp: next.hp.current,
      hpMax: next.hp.max,
      kind: 'maxhp-change',
    })
  }
  return next
}
```

**先用 grep 列出 simulate 函数内全部 recomputeHpMax 调用**：

Run: `grep -n "recomputeHpMax" src/utils/mitigationCalculator.ts`

把 simulate 函数内（不包括 `recomputeHpMax` 的方法定义本身、也不包括其他方法内的调用）的每处 `this.recomputeHpMax(X)` 替换成 `recomputeAndTrack(X, T)`，T 是该位置的"当前时刻"，按出现位置选下面任一来源：

| 位置                                             | T 取值（已存在的局部变量） |
| ------------------------------------------------ | -------------------------- |
| simulate 入口 hp 池初始化后                      | `currentState.timestamp`   |
| advanceToTime 内 fireTick                        | `t`                        |
| advanceToTime 内 fireExpire                      | `status.endTime`           |
| advanceToTime 末尾                               | `cur`                      |
| cast executor 后（主循环 + 末尾干推进，共 2 处） | `castEvent.timestamp`      |
| calculate 之后                                   | `filterTime`               |

不要在 simulate 外的方法（如 calculate）替换——calculate 内的 recomputeHpMax 与 hpTimeline 无关，hpTimeline 由 simulate 主循环独立维护。

- [ ] **Step 4: 跑测试**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts -t "HP 池 · hpTimeline"`
Expected: 7 tests passed (init/init-empty/damage/partial-damage/heal/tick/maxhp)

- [ ] **Step 5: Commit**

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "feat(simulator): hpTimeline push maxhp-change point"
```

---

## Task 7: TDD 出口 sort + 回填 heal/tick 的 hp 字段

**Files:**

- Modify: `src/utils/mitigationCalculator.test.ts`
- Modify: `src/utils/mitigationCalculator.ts`

- [ ] **Step 1: 追加 sort 测试 + 改 task 5 的占位 expect**

把 task 5 的测试里 hp 占位（`hp: 0`）改回正确值：

```ts
// "recordHeal 触发时 push heal point" 测试 expected 改为：
expect(events).toEqual([
  { time: 0, kind: 'init', hp: 100000, refEventId: undefined },
  { time: 10, kind: 'heal', hp: 100000, refEventId: 'cast-heal-1' },
  { time: 10, kind: 'damage', hp: 70000, refEventId: 'A' },
])
```

```ts
// "isHotTick=true 时 kind=tick" 测试追加 hp 校验：
const tickPoints = out.hpTimeline.filter(p => p.kind === 'tick')
expect(tickPoints.map(p => p.time)).toEqual([3, 6, 9, 12])
// 第一个 tick：50000 + 1000 = 51000，依次类推
expect(tickPoints.map(p => p.hp)).toEqual([51000, 52000, 53000, 54000])
```

新增 sort 测试：

```ts
it('hpTimeline 按 time 升序 sort', () => {
  // 同一 time 多事件（cast at t=10 同时 damage at t=10）的 push 顺序由 simulate 主循环内序定，
  // 出口 sort 用稳定排序保留同时刻先后
  const calculator = new MitigationCalculator()
  const out = calculator.simulate({
    castEvents: [],
    damageEvents: [
      mkDmg('A', 5, 'aoe', 10000),
      mkDmg('B', 3, 'aoe', 10000), // 故意时间倒序
      mkDmg('C', 8, 'aoe', 10000),
    ],
    initialState: { statuses: [], timestamp: 0 },
    baseReferenceMaxHPForAoe: 100000,
  })
  const times = out.hpTimeline.map(p => p.time)
  for (let i = 1; i < times.length; i++) {
    expect(times[i]).toBeGreaterThanOrEqual(times[i - 1])
  }
})

it('回放模式 hpTimeline 为空', () => {
  // simulate 不被回放模式直接调用，但 useDamageCalculation 在 isReplayMode 时短路返回 empty。
  // 此处只需验证：当 initialState.hp 为空 + 不传 baseReferenceMaxHPForAoe → hpTimeline 为空。
  const calculator = new MitigationCalculator()
  const out = calculator.simulate({
    castEvents: [],
    damageEvents: [mkDmg('A', 5, 'aoe', 10000)],
    initialState: { statuses: [], timestamp: 0 },
    // 不传 baseReferenceMaxHPForAoe → 没有 init point，applyDamageToHp 也跳过
  })
  expect(out.hpTimeline).toEqual([])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts -t "HP 池 · hpTimeline"`
Expected: heal/tick 测试 hp 错；sort 测试可能过；回放测试可能过。

- [ ] **Step 3: 改 recordHeal 让 hp 字段正确**

把 task 5 写的 recordHeal 改成 push 时直接读"已应用治疗后的 hp"——但 recordHeal 调用时钩子还未 return 更新后的 state。**唯一可靠方法**：让 recordHeal 接受 `hpAfterHeal` 参数。

但这要改 `ActionExecutionContext.recordHeal` 签名以及所有钩子调用方……

**简化方案**：recordHeal 内 push 时按 snap.applied 算 hp。具体：

```ts
// 维护一个 lastKnownHp 闭包变量，由 simulate 主循环每次 push damage / init / maxhp-change 后同步更新
let lastKnownHp = 0
let lastKnownHpMax = 0
const updateLastKnownHp = (state: PartyState) => {
  if (state.hp) {
    lastKnownHp = state.hp.current
    lastKnownHpMax = state.hp.max
  }
}

const recordHeal = (snap: HealSnapshot) => {
  healSnapshots.push(snap)
  // 治疗后 hp = 当前已知 hp + applied（钩子里还没 return，所以 lastKnown 还是治疗前的 hp.current）
  const hpAfter = Math.min(lastKnownHp + snap.applied, lastKnownHpMax)
  hpTimeline.push({
    time: snap.time,
    hp: hpAfter,
    hpMax: lastKnownHpMax,
    kind: snap.isHotTick ? 'tick' : 'heal',
    refEventId: snap.castEventId || undefined,
  })
  lastKnownHp = hpAfter
}
```

每次 push init / damage / maxhp-change 之前，调 `updateLastKnownHp(currentState)`：

- init push 前 → updateLastKnownHp(currentState)
- damage push 前 → updateLastKnownHp(stateAfterHp)
- maxhp-change push 前（在 recomputeAndTrack 内） → 已有 next.hp 信息，直接用 `lastKnownHp = next.hp.current; lastKnownHpMax = next.hp.max`

具体改动：

```ts
// init push 处：
if (currentState.hp) {
  lastKnownHp = currentState.hp.current
  lastKnownHpMax = currentState.hp.max
  hpTimeline.push({
    time: currentState.timestamp,
    hp: lastKnownHp,
    hpMax: lastKnownHpMax,
    kind: 'init',
  })
}

// damage push 处：
if (stateAfterHp.hp) {
  lastKnownHp = stateAfterHp.hp.current
  lastKnownHpMax = stateAfterHp.hp.max
  hpTimeline.push({
    time: filterTime,
    hp: lastKnownHp,
    hpMax: lastKnownHpMax,
    kind: 'damage',
    refEventId: event.id,
  })
}

// recomputeAndTrack 内：
const recomputeAndTrack = (state: PartyState, time: number): PartyState => {
  const next = this.recomputeHpMax(state)
  if (state.hp && next.hp && state.hp.max !== next.hp.max) {
    lastKnownHp = next.hp.current
    lastKnownHpMax = next.hp.max
    hpTimeline.push({ time, hp: lastKnownHp, hpMax: lastKnownHpMax, kind: 'maxhp-change' })
  }
  return next
}
```

- [ ] **Step 4: 出口 sort**

在 simulate return 块前追加：

```ts
hpTimeline.sort((a, b) => a.time - b.time)
```

- [ ] **Step 5: 跑测试**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts`
Expected: 全量 ~664 测试 passed（含新增 9 条 hpTimeline）

- [ ] **Step 6: Commit**

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "feat(simulator): hpTimeline 出口 sort + heal/tick hp 字段回填"
```

---

## Task 8: 主题色 + 高度常量

**Files:**

- Modify: `src/components/Timeline/constants.ts`

- [ ] **Step 1: 加常量与色板字段**

`CanvasColors` interface 在 "线条" 区域追加：

```ts
// HP 曲线
hpCurveStroke: string
hpCurveFill: string
hpCurveBaseline: string
```

`lightColors` 对象追加：

```ts
  hpCurveStroke: '#16a34a',
  hpCurveFill: 'rgba(34, 197, 94, 0.12)',
  hpCurveBaseline: '#cbd5e1',
```

`darkColors` 对象追加：

```ts
  hpCurveStroke: '#22c55e',
  hpCurveFill: 'rgba(34, 197, 94, 0.18)',
  hpCurveBaseline: '#475569',
```

文件末尾追加：

```ts
/** HP 曲线轨道高度（px） */
export const HP_CURVE_HEIGHT = 60
```

- [ ] **Step 2: 类型 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 干净

- [ ] **Step 3: Commit**

```bash
git add src/components/Timeline/constants.ts
git commit -m "feat(timeline): 加 HP 曲线主题色与高度常量"
```

---

## Task 9: HpCurveTrack 组件

**Files:**

- Create: `src/components/Timeline/HpCurveTrack.tsx`

- [ ] **Step 1: 创建组件**

```tsx
/**
 * HP 曲线轨道
 *
 * 在 fixedStage 内、伤害事件轨道下方渲染一条 HP 演化折线。
 * 数据源：useDamageCalculation 透传的 hpTimeline（time 升序）。
 * Y 轴：hp / hpMax → [0, 1] → 反向映射到 [yOffset+height-2, yOffset+2]
 * 视口裁剪：仅保留 X 落在可见区 ± 1 viewport 的点。
 */

import { memo } from 'react'
import { Line, Rect } from 'react-konva'
import type { HpTimelinePoint } from '@/types/hpTimeline'
import { useCanvasColors } from './constants'

interface HpCurveTrackProps {
  hpTimeline: HpTimelinePoint[]
  zoomLevel: number
  /** 轨道顶部 Y 坐标 */
  yOffset: number
  /** 轨道宽度（= timelineWidth） */
  width: number
  /** 轨道高度（= HP_CURVE_HEIGHT） */
  height: number
  viewportWidth: number
  scrollLeft: number
}

const HpCurveTrack = memo(function HpCurveTrack({
  hpTimeline,
  zoomLevel,
  yOffset,
  width,
  height,
  viewportWidth,
  scrollLeft,
}: HpCurveTrackProps) {
  const colors = useCanvasColors()

  if (hpTimeline.length < 2) return null

  // Y 映射：hp/hpMax = 1 → top；= 0 → bottom（留 2px 边距）
  const PADDING = 2
  const plotHeight = height - PADDING * 2
  const yFor = (hp: number, hpMax: number) =>
    yOffset + PADDING + (1 - hp / Math.max(1, hpMax)) * plotHeight

  // 视口裁剪：保留可见区 ± 1 viewport
  const buffer = viewportWidth
  const minX = scrollLeft - buffer
  const maxX = scrollLeft + viewportWidth + buffer

  // 找到第一个 X >= minX 的点的前一条（保证曲线左端连接到视口外）
  const xs = hpTimeline.map(p => p.time * zoomLevel)
  let startIdx = xs.findIndex(x => x >= minX)
  if (startIdx === -1) startIdx = hpTimeline.length - 1
  if (startIdx > 0) startIdx -= 1

  let endIdx = xs.findLastIndex(x => x <= maxX)
  if (endIdx === -1) endIdx = 0
  if (endIdx < hpTimeline.length - 1) endIdx += 1

  if (endIdx <= startIdx) return null

  // 折线点序列（每相邻两个点之间用阶梯：先水平延伸到下个 time，再垂直跳到下个 hp）
  // 但本期为简单起见用直接连线（与 mockup 一致）。如果未来要"瞬时下落"效果，改成
  // 在每个 damage point 前插一个 (time, prev.hp) 点。
  const points: number[] = []
  for (let i = startIdx; i <= endIdx; i++) {
    const p = hpTimeline[i]
    points.push(p.time * zoomLevel, yFor(p.hp, p.hpMax))
  }

  // 面积填充：闭合到 [first.x, bottom] 与 [last.x, bottom]
  const firstX = hpTimeline[startIdx].time * zoomLevel
  const lastX = hpTimeline[endIdx].time * zoomLevel
  const bottomY = yOffset + height
  const fillPoints = [firstX, bottomY, ...points, lastX, bottomY]

  // maxHP 基线（视口内）
  const baselineY = yFor(1, 1)
  const baselineLeft = Math.max(0, minX)
  const baselineRight = Math.min(width, maxX)

  return (
    <>
      {/* 轨道背景（使用伤害轨道同色，让 HP 曲线视觉上紧贴） */}
      <Rect
        x={0}
        y={yOffset}
        width={width}
        height={height}
        fill={colors.damageTrackBg}
        listening={false}
        perfectDrawEnabled={false}
      />

      {/* maxHP 基线 */}
      <Line
        points={[baselineLeft, baselineY, baselineRight, baselineY]}
        stroke={colors.hpCurveBaseline}
        strokeWidth={1}
        dash={[4, 3]}
        listening={false}
        perfectDrawEnabled={false}
      />

      {/* 面积填充 */}
      <Line
        points={fillPoints}
        fill={colors.hpCurveFill}
        closed={true}
        listening={false}
        perfectDrawEnabled={false}
      />

      {/* 折线 */}
      <Line
        points={points}
        stroke={colors.hpCurveStroke}
        strokeWidth={2}
        listening={false}
        perfectDrawEnabled={false}
      />
    </>
  )
})

export default HpCurveTrack
```

- [ ] **Step 2: 类型 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 干净

- [ ] **Step 3: Commit**

```bash
git add src/components/Timeline/HpCurveTrack.tsx
git commit -m "feat(timeline): 新增 HpCurveTrack 组件"
```

---

## Task 10: Timeline 主组件集成

**Files:**

- Modify: `src/components/Timeline/index.tsx`

- [ ] **Step 1: import + hook**

文件顶部 import 区追加：

```ts
import HpCurveTrack from './HpCurveTrack'
import { HP_CURVE_HEIGHT } from './constants'
```

在 `useUIStore` 解构 hook 列表里追加：

```ts
const enableHpSimulation = useUIStore(s => s.enableHpSimulation)
```

在 `useDamageCalculation` 返回值解构里追加 `hpTimeline`：

```ts
const { results: eventResults, ... , hpTimeline } = useDamageCalculation(timeline)
```

（具体属性名以现有解构形式为准；如果原代码用 `const dc = useDamageCalculation(timeline)`，则改为 `const { hpTimeline, ... } = dc`）

- [ ] **Step 2: layoutData useMemo 改 fixedAreaHeight**

在 `layoutData = useMemo(() => {...}, [...])` 内：

把：

```ts
const fixedAreaHeight = timeRulerHeight + eventTrackHeight
```

改为：

```ts
const hasHpData = hpTimeline.length >= 2
const hpTrackHeight = enableHpSimulation && hasHpData ? HP_CURVE_HEIGHT : 0
const fixedAreaHeight = timeRulerHeight + eventTrackHeight + hpTrackHeight
```

return 块追加 `hpTrackHeight`。

useMemo 依赖列表追加 `enableHpSimulation, hpTimeline.length`：

```ts
}, [timeline, zoomLevel, skillTracks, isDamageTrackCollapsed, filteredDamageEvents, enableHpSimulation, hpTimeline.length])
```

- [ ] **Step 3: 在 fixedStage Layer 内嵌 HpCurveTrack**

找到 `<DamageEventTrack ... />` 调用块（约 1212 行）。在它结束后追加：

```tsx
{
  hpTrackHeight > 0 && (
    <HpCurveTrack
      hpTimeline={hpTimeline}
      zoomLevel={zoomLevel}
      yOffset={timeRulerHeight + eventTrackHeight}
      width={timelineWidth}
      height={HP_CURVE_HEIGHT}
      viewportWidth={viewportWidth}
      scrollLeft={clampedScrollLeft}
    />
  )
}
```

`hpTrackHeight` 来自 `layoutData`，需要在该 JSX 上下文中解构出来：找到现有 `const { eventTrackHeight, timelineWidth, fixedAreaHeight, skillTracksHeight, LANE_ROW_HEIGHT, ...} = layoutData ?? defaultLayout` 那行（约 1090 行），追加 `hpTrackHeight`。

- [ ] **Step 4: 左侧标签栏新增 "HP" 行**

`labelColumnWidth` 已经在 Timeline/index.tsx 顶部定义（约 line 288，与 `timeRulerHeight` / `skillTrackHeight` 同位），直接复用。

Run: `grep -n '"伤害"' src/components/Timeline/index.tsx` 找到伤害标签 div 的位置。在该 div 结束 `</div>` 之后追加：

```tsx
{
  hpTrackHeight > 0 && (
    <div
      className="flex items-center justify-center border-t border-r"
      style={{ height: HP_CURVE_HEIGHT, width: labelColumnWidth }}
    >
      <span className="text-xs text-muted-foreground">HP</span>
    </div>
  )
}
```

className 以同位"伤害"标签的实际写法为准（如果"伤害"用的是 `flex items-center px-2` 等其他组合，HP 标签也用同样组合，仅替换文本）。

- [ ] **Step 5: 类型 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 干净

- [ ] **Step 6: 跑全量测试**

Run: `pnpm test:run`
Expected: 全部 passed（HpCurveTrack 不加单测；只验证现有测试不破）

- [ ] **Step 7: Commit**

```bash
git add src/components/Timeline/index.tsx
git commit -m "feat(timeline): 集成 HP 曲线轨道到 fixedStage"
```

---

## Task 11: 手动浏览器验证

**目的：** spec §6.3 表格里所有 9 个场景。

- [ ] **Step 1: 启动 dev server（如果未启）**

Run: `pnpm dev` （后台或单独终端；如果用户已起则跳过）
Expected: vite 在 http://localhost:5173 提供

- [ ] **Step 2: 准备一个有数据的时间轴**

进入主页 → 新建时间轴（选 M9S 或任一副本）→ 进入编辑器 → 配 statData（点齿轮按钮设 referenceMaxHP / 治疗 statistics）→ 配阵容 → 双击伤害轨道空白处加几个 aoe 事件。

- [ ] **Step 3: 在编辑模式下观察曲线**

| 场景                                                | 期望                                    |
| --------------------------------------------------- | --------------------------------------- |
| 配 statData + 加 aoe 事件 + 不挂减伤                | HP 曲线在每个事件后陡降，maxHP 基线在顶 |
| 挂减伤后                                            | 陡降幅度变小                            |
| 加 cast heal action（如果接了 executor）/ HoT regen | 曲线在治疗时刻爬升                      |
| 切换 HP 模拟开关 off                                | 整条 HP 曲线轨道收回，技能轨道上移      |
| 切回 on                                             | 轨道复现、layout 恢复                   |
| 切换主题（深色/浅色）                               | 折线颜色跟随                            |
| 水平拖动时间轴                                      | 曲线视口裁剪正确                        |
| 垂直滚动技能轨道                                    | HP 曲线轨道纹丝不动                     |
| 切折叠伤害轨道                                      | HP 曲线相对位置正确                     |
| 回放模式（导入 FFLogs 数据）                        | HP 曲线轨道不显示                       |

- [ ] **Step 4: 报告结果**

不 commit。把上述场景测试结果发给用户：哪些过、哪些有问题。如果全过，告知用户实施完成、可走 `/squash` 整理 commit 或单独走 PR。

---

## 完成标准

- [ ] 全部 11 个 task 完成
- [ ] 全量测试 passed
- [ ] tsc / lint 干净
- [ ] 浏览器验证 9 个场景全过
- [ ] 总 commit 数 ≤ 10（task 1-10 各 1，task 11 不 commit）
