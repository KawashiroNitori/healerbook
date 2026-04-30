# 部分 AOE 段内延迟扣盾 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 partial_aoe 期间盾值仅参与显示不被扣减，等到 partial_final_aoe 时按段内最坏一次的 candidateDamage 真实结算。

**Architecture:** 将段累积状态（`segMax / inSegment / segCandidateMax`）从 `HpPool` 拆到独立 `PartyState.segment` 字段，让 `skipHpPipeline` 模式也能维护段。`runSingleBranch` Phase 3 按 `event.type` 分流：partial_aoe 走 read-only 路径（不扣 `remainingBarrier`、不收集 `consumedShields`），partial_final_aoe 走"显示 + 结算"两阶段（结算用 `max(自身 cd, segCandidateMax)`）。`applyDamageToHp` 签名扩展 `candidateDamage` 参数，所有段读写集中在它内部。

**Tech Stack:** TypeScript 5.9 + Vitest 4；改动文件 `src/types/partyState.ts`、`src/utils/mitigationCalculator.ts` 与对应测试；同步迁移 `createHealExecutor.test.ts` / `createRegenExecutor.test.ts` / `useDamageCalculation.test.ts` 中的 `HpPool` 构造。

参考 spec: `design/superpowers/specs/2026-04-29-partial-aoe-shield-deferral-design.md`

---

## 文件清单

**Create:**
（无新增文件）

**Modify:**

- `src/types/partyState.ts` —— 拆 `HpPool`、新增 `SegmentState`、`PartyState.segment`
- `src/utils/mitigationCalculator.ts` —— `applyDamageToHp` 签名 + 段读写迁移；`runSingleBranch` Phase 3 按 type 分流；`simulate` 初始化 `segment`、传 `candidateDamage`
- `src/utils/mitigationCalculator.test.ts` —— 既有"HP 池演化 - partial 段累积"组迁移字段；新增"partial 段延迟扣盾"组
- `src/executors/createHealExecutor.test.ts` —— `mkHp` 删 `segMax / inSegment`
- `src/executors/createRegenExecutor.test.ts` —— `mkHp` 删 `segMax / inSegment`

**Test:**

- `src/utils/mitigationCalculator.test.ts`（已存在，新增 describe 块）

---

## Task 1: 类型层拆分（HpPool / SegmentState / PartyState.segment）

**Files:**

- Modify: `src/types/partyState.ts`

- [ ] **Step 1: 改写 `src/types/partyState.ts` —— 拆出 `SegmentState`，从 `HpPool` 移除段字段**

完整替换文件内容：

```ts
/**
 * 小队状态类型定义（编辑模式专用）
 */

import type { MitigationStatus } from './status'

/**
 * 非坦聚合 HP 池（编辑模式专用）
 *
 * 仅模拟非坦克玩家共享的最低参考血量；坦专事件（tankbuster / auto）
 * 不入池，继续走 mitigationCalculator 的多坦分支孤立判定。
 *
 * 由 MitigationCalculator.simulate 在入口按 baseReferenceMaxHPForAoe 初始化，
 * 后续随 cast / damage / tick / expire 演化。回放模式不参与。
 *
 * 段累积状态（segMax / inSegment / segCandidateMax）独立放在 PartyState.segment，
 * 不再混在 HpPool 里——skipHpPipeline 模式下 hp 为 undefined 但 segment 仍需维护
 * 以驱动延迟扣盾。
 */
export interface HpPool {
  /** 当前 HP，clamp 到 [0, max] */
  current: number
  /** 当前上限 = base × ∏(active 非坦专 maxHP buff) */
  max: number
  /** 基线上限（不含 maxHP buff）；buff attach/expire 时按比例伸缩 current */
  base: number
}

/**
 * partial AOE 段累积状态。
 *
 * 与 HpPool 解耦——skipHpPipeline 模式下 hp 为 undefined，但 segment 仍需维护
 * 才能让延迟扣盾在 PlacementEngine 等轻量调用下行为一致。
 *
 * 由 simulate 主循环初始化为零值，applyDamageToHp 内部读写。
 */
export interface SegmentState {
  /** 是否处于 partial 段内（aoe / partial_final_aoe 收尾或时间轴起始时为 false） */
  inSegment: boolean
  /** 段内已观察到的最大 finalDamage（盾后），驱动 HP 池扣血增量 */
  segMax: number
  /**
   * 段内已观察到的最大 candidateDamage（盾前），驱动 partial_final_aoe 结算扣盾量。
   * 与 segMax 区分：partial_aoe 走 Phase 3 read-only 路径时 finalDamage 已被盾减过，
   * max(finalDamage) 在盾够大时恒为 0，无法反映"段内最坏一次对盾的消耗"。
   */
  segCandidateMax: number
}

/**
 * 小队状态（编辑模式）
 * 所有状态统一存放在 PartyState.statuses 中，不再区分友方/敌方。
 */
export interface PartyState {
  /** 所有状态列表（包含友方 Buff 和原敌方 Debuff） */
  statuses: MitigationStatus[]
  /** 当前时间戳（秒） */
  timestamp: number
  /**
   * 非坦聚合 HP 池。回放模式 / hp 未初始化时为 undefined。
   * timelineStore.partyState 不直接持有 hp；hp 由 simulate 内部合成进 state，
   * 不污染外部 store 的 partyState 对象。
   */
  hp?: HpPool
  /**
   * partial 段累积状态。simulate 主循环初始化为
   * `{ inSegment: false, segMax: 0, segCandidateMax: 0 }`。
   * 单事件 calculate 入口（PropertyPanel）可不传，runSingleBranch 兜底为段外语义。
   */
  segment?: SegmentState
}
```

- [ ] **Step 2: 跑类型检查确认其他文件的引用现在会报错**

Run: `pnpm exec tsc --noEmit`
Expected: 报错 `mitigationCalculator.ts` 内 `hp.segMax` / `hp.inSegment` 引用不存在；`createHealExecutor.test.ts` / `createRegenExecutor.test.ts` 内 `mkHp` 字面量多余字段。这正是后续 task 要修的。

- [ ] **Step 3: Commit（仅类型层，明知会留下编译错误，但便于回溯）**

Run:

```bash
git add src/types/partyState.ts
git commit -m "refactor(types): 拆分 HpPool / SegmentState，从 HpPool 移除段字段"
```

---

## Task 2: 迁移 `applyDamageToHp` 到 `state.segment` + 加 `candidateDamage` 参数

**Files:**

- Modify: `src/utils/mitigationCalculator.ts:307-361` (`applyDamageToHp`)
- Modify: `src/utils/mitigationCalculator.ts:644-660` (`initialHpPool` / `currentState` 初始化)
- Modify: `src/utils/mitigationCalculator.ts:750` (`applyDamageToHp` 调用处)

- [ ] **Step 1: 改写 `applyDamageToHp` 方法签名 + 实现**

把 `src/utils/mitigationCalculator.ts` 当前 307-361 行的整段 `applyDamageToHp` 替换为：

```ts
  /**
   * 按事件类型扣 HP 池，处理 partial 段累积；同时维护 partyState.segment。
   *
   * 段累积器读写：
   *   aoe                → 段重置（inSegment=false, segMax/segCandidateMax=0），扣全额
   *   partial_aoe        → 进/留段内，segMax / segCandidateMax 累加 max
   *   partial_final_aoe  → 累加后段结束（inSegment=false, segMax/segCandidateMax=0）
   *   tankbuster / auto  → 段不动，HP 不入池
   *
   * candidateDamage 来自 calculate 输出，用于驱动 segCandidateMax —— partial_final_aoe
   * 的延迟结算需要这个值。partial_aoe 在 Phase 3 走 read-only 路径，event 自身的
   * finalDamage 在盾够大时为 0，不能驱动 segCandidateMax；必须用 candidateDamage。
   *
   * 坦专事件（tankbuster / auto）不入池，snapshot 为 undefined。
   */
  private applyDamageToHp(
    state: PartyState,
    ev: DamageEvent,
    finalDamage: number,
    candidateDamage: number
  ): { nextState: PartyState; snapshot?: HpSimulationSnapshot } {
    if (ev.type === 'tankbuster' || ev.type === 'auto') {
      return { nextState: state }
    }

    // 段累积：先把段更新到"含本事件"的状态，再算扣血量
    const prevSegment = state.segment ?? {
      inSegment: false,
      segMax: 0,
      segCandidateMax: 0,
    }

    let nextSegment = prevSegment
    if (ev.type === 'aoe') {
      nextSegment = { inSegment: false, segMax: 0, segCandidateMax: 0 }
    } else if (ev.type === 'partial_aoe' || ev.type === 'partial_final_aoe') {
      const baseSeg = prevSegment.inSegment
        ? prevSegment
        : { inSegment: true, segMax: 0, segCandidateMax: 0 }
      nextSegment = {
        inSegment: ev.type === 'partial_final_aoe' ? false : true,
        segMax:
          ev.type === 'partial_final_aoe' ? 0 : Math.max(baseSeg.segMax, finalDamage),
        segCandidateMax:
          ev.type === 'partial_final_aoe'
            ? 0
            : Math.max(baseSeg.segCandidateMax, candidateDamage),
      }
    }

    if (!state.hp) {
      return { nextState: { ...state, segment: nextSegment } }
    }
    const hp = state.hp

    const before = hp.current
    let nextCurrent = hp.current
    let dealt = 0
    let snapshotSegMax: number | undefined

    if (ev.type === 'aoe') {
      dealt = finalDamage
      nextCurrent -= finalDamage
    } else if (ev.type === 'partial_aoe' || ev.type === 'partial_final_aoe') {
      // 用"段进入本事件前的 segMax"算增量；结算事件 nextSegment.segMax 已被清零，
      // 不能用它做增量参照。
      const segMaxBefore = prevSegment.inSegment ? prevSegment.segMax : 0
      const newSegMax = Math.max(segMaxBefore, finalDamage)
      dealt = Math.max(0, finalDamage - segMaxBefore)
      nextCurrent -= dealt
      snapshotSegMax = newSegMax
    }

    const overkill = Math.max(0, dealt - before)
    nextCurrent = Math.max(0, Math.min(nextCurrent, hp.max))

    return {
      nextState: {
        ...state,
        hp: { ...hp, current: nextCurrent },
        segment: nextSegment,
      },
      snapshot: {
        hpBefore: before,
        hpAfter: nextCurrent,
        hpMax: hp.max,
        segMax: snapshotSegMax,
        overkill: overkill > 0 ? overkill : undefined,
      },
    }
  }
```

- [ ] **Step 2: 改 `simulate` 主循环 `initialHpPool` —— 移除 `segMax / inSegment`**

定位 `src/utils/mitigationCalculator.ts` 中 `const initialHpPool: HpPool | undefined = ...` 段（约 644-653 行），把对象字面量精简为：

```ts
const initialHpPool: HpPool | undefined =
  !skipHpPipeline && baseReferenceMaxHPForAoe > 0
    ? {
        current: baseReferenceMaxHPForAoe,
        max: baseReferenceMaxHPForAoe,
        base: baseReferenceMaxHPForAoe,
      }
    : undefined
```

- [ ] **Step 3: 改 `simulate` 主循环 `currentState` 初始化 —— 加 `segment` 字段**

定位 `let currentState: PartyState = { statuses: ..., timestamp: ..., hp: initialHpPool }`，把它改为：

```ts
let currentState: PartyState = {
  statuses: [...initialState.statuses],
  timestamp: initialState.timestamp,
  hp: initialHpPool,
  segment: { inSegment: false, segMax: 0, segCandidateMax: 0 },
}
```

- [ ] **Step 4: 改 `applyDamageToHp` 调用处补传 `candidateDamage`**

定位 `simulate` 主循环里：

```ts
const { nextState: stateAfterHp, snapshot: hpSnap } = this.applyDamageToHp(
  currentState,
  event,
  result.finalDamage
)
```

改为：

```ts
const { nextState: stateAfterHp, snapshot: hpSnap } = this.applyDamageToHp(
  currentState,
  event,
  result.finalDamage,
  result.candidateDamage ?? result.finalDamage
)
```

`result.candidateDamage` 已经是 `CalculationResult` 的现有字段；`?? result.finalDamage` 兜底 calculate 万一未填充（实际 runSingleBranch 一定会填）。

- [ ] **Step 5: 跑现有 partial 累积测试，确认行为不退化**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts -t "HP 池演化 - partial 段累积"`
Expected: 全部通过（语义未变，仅字段位置变更）。

- [ ] **Step 6: 全量类型检查 —— 确认 mitigationCalculator.ts 干净**

Run: `pnpm exec tsc --noEmit 2>&1 | grep mitigationCalculator || echo OK`
Expected: 输出 `OK`。其他测试文件可能仍有 `mkHp` 多余字段错误，留 Task 3 处理。

- [ ] **Step 7: Commit**

Run:

```bash
git add src/utils/mitigationCalculator.ts
git commit -m "refactor(simulator): applyDamageToHp 段累积迁到 PartyState.segment + 接 candidateDamage"
```

---

## Task 3: 同步迁移测试文件中的 `HpPool` 构造

**Files:**

- Modify: `src/executors/createHealExecutor.test.ts:10-15` (`mkHp`)
- Modify: `src/executors/createRegenExecutor.test.ts:12-17` (`mkHp`)

- [ ] **Step 1: 改 `createHealExecutor.test.ts` 的 `mkHp` —— 删 `segMax / inSegment`**

定位 `src/executors/createHealExecutor.test.ts:10-15`，改为：

```ts
const mkHp = (overrides: Partial<HpPool> = {}): HpPool => ({
  current: 100000,
  max: 100000,
  base: 100000,
  ...overrides,
})
```

- [ ] **Step 2: 改 `createRegenExecutor.test.ts` 的 `mkHp` —— 同样改动**

定位 `src/executors/createRegenExecutor.test.ts:12-17`，改为：

```ts
const mkHp = (overrides: Partial<HpPool> = {}): HpPool => ({
  current: 100000,
  max: 100000,
  base: 100000,
  ...overrides,
})
```

- [ ] **Step 3: 跑两个 executor 测试**

Run: `pnpm test:run src/executors/createHealExecutor.test.ts src/executors/createRegenExecutor.test.ts`
Expected: 全部通过。

- [ ] **Step 4: 全量类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 全无报错。

- [ ] **Step 5: Commit**

Run:

```bash
git add src/executors/createHealExecutor.test.ts src/executors/createRegenExecutor.test.ts
git commit -m "test(executors): mkHp 同步移除 segMax / inSegment 字段"
```

---

## Task 4: 写延迟扣盾失败测试（先红）

**Files:**

- Modify: `src/utils/mitigationCalculator.test.ts` (在文件末尾追加新 describe 块)

- [ ] **Step 1: 在 `src/utils/mitigationCalculator.test.ts` 文件末尾追加新 describe 块**

把以下内容追加到文件末尾（紧贴最后一个 `describe` 之后，文件末尾的 `})` 之外不要嵌套）：

```ts
describe('partial 段延迟扣盾', () => {
  const SHIELD_STATUS_ID = 999_811
  const CONSUME_STATUS_ID = 999_812

  const mkShieldMeta = (
    initialBarrier: number,
    onConsume?: (ctx: { absorbedAmount: number }) => void
  ): MitigationStatusMetadata =>
    ({
      id: SHIELD_STATUS_ID,
      name: 'mock-shield',
      type: 'shield',
      performance: { physics: 1, magic: 1, darkness: 1 },
      isFriendly: true,
      isTankOnly: false,
      executor: onConsume
        ? {
            onConsume: (ctx2: { absorbedAmount: number; partyState: PartyState }) => {
              onConsume({ absorbedAmount: ctx2.absorbedAmount })
              return ctx2.partyState
            },
          }
        : undefined,
    }) as MitigationStatusMetadata

  const mkShieldStatus = (
    instanceId: string,
    startTime: number,
    initialBarrier: number,
    statusId = SHIELD_STATUS_ID
  ) => ({
    instanceId,
    statusId,
    startTime,
    endTime: startTime + 999,
    sourceActionId: 0,
    sourcePlayerId: 1,
    initialBarrier,
    remainingBarrier: initialBarrier,
    removeOnBarrierBreak: true,
  })

  function spyShield(initialBarrier: number, onConsume?: (a: { absorbedAmount: number }) => void) {
    return vi
      .spyOn(registry, 'getStatusById')
      .mockImplementation(id =>
        id === SHIELD_STATUS_ID ? mkShieldMeta(initialBarrier, onConsume) : undefined
      )
  }

  it('partial_aoe 期间 remainingBarrier 不变（盾仅显示参与）', () => {
    const spy = spyShield(50000)
    try {
      const calculator = new MitigationCalculator()
      const initialState: PartyState = {
        statuses: [mkShieldStatus('sh1', 0, 50000)],
        timestamp: 0,
      }
      const out = calculator.simulate({
        castEvents: [],
        damageEvents: [mkDmg('p1', 5, 'partial_aoe', 20000), mkDmg('p2', 10, 'partial_aoe', 30000)],
        initialState,
        baseReferenceMaxHPForAoe: 100000,
      })
      // 两个 partial_aoe 之间盾不应被扣
      const r1 = out.damageResults.get('p1')!
      const r2 = out.damageResults.get('p2')!
      // p1 显示：candidate=20k - absorb=20k → finalDamage=0
      expect(r1.finalDamage).toBe(0)
      // p2 显示：candidate=30k - absorb=30k → finalDamage=0；如果盾被 p1 扣过，p2 finalDamage > 0
      expect(r2.finalDamage).toBe(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('partial_final_aoe 按 max(自身 cd, segCandidateMax) 扣盾', () => {
    const spy = spyShield(50000)
    try {
      const calculator = new MitigationCalculator()
      const initialState: PartyState = {
        statuses: [mkShieldStatus('sh1', 0, 50000)],
        timestamp: 0,
      }
      // 段：partial_aoe 30k → partial_aoe 40k → partial_final_aoe 20k
      // segCandidateMax 在 final 时算到 max(30k, 40k) = 40k；自身 cd = 20k
      // effectiveDamage = max(20k, 40k) = 40k → 盾 50k 吃掉 40k → 残 10k
      const out = calculator.simulate({
        castEvents: [],
        damageEvents: [
          mkDmg('p1', 5, 'partial_aoe', 30000),
          mkDmg('p2', 10, 'partial_aoe', 40000),
          mkDmg('pf', 15, 'partial_final_aoe', 20000),
        ],
        initialState,
        baseReferenceMaxHPForAoe: 100000,
      })
      // pf 自身显示：candidate=20k - absorb=20k → finalDamage=0
      expect(out.damageResults.get('pf')!.finalDamage).toBe(0)

      // 盾被结算扣到剩 10k：再来一个 aoe 验证 remainingBarrier 已变更
      const out2 = calculator.simulate({
        castEvents: [],
        damageEvents: [
          mkDmg('p1', 5, 'partial_aoe', 30000),
          mkDmg('p2', 10, 'partial_aoe', 40000),
          mkDmg('pf', 15, 'partial_final_aoe', 20000),
          mkDmg('aoe', 20, 'aoe', 5000),
        ],
        initialState,
        baseReferenceMaxHPForAoe: 100000,
      })
      // aoe candidate=5k, 盾残 10k 吃掉 5k → finalDamage=0
      expect(out2.damageResults.get('aoe')!.finalDamage).toBe(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('单 partial_final_aoe（无前置 partial_aoe）按自身 cd 扣盾', () => {
    const spy = spyShield(50000)
    try {
      const calculator = new MitigationCalculator()
      const initialState: PartyState = {
        statuses: [mkShieldStatus('sh1', 0, 50000)],
        timestamp: 0,
      }
      // segCandidateMax = 0；effectiveDamage = max(35k, 0) = 35k → 盾残 15k
      const out = calculator.simulate({
        castEvents: [],
        damageEvents: [mkDmg('pf', 5, 'partial_final_aoe', 35000), mkDmg('aoe', 10, 'aoe', 10000)],
        initialState,
        baseReferenceMaxHPForAoe: 100000,
      })
      // pf 自身显示：35k - 35k = 0
      expect(out.damageResults.get('pf')!.finalDamage).toBe(0)
      // aoe candidate=10k, 盾残 15k 吃掉 10k → finalDamage=0
      expect(out.damageResults.get('aoe')!.finalDamage).toBe(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('Phase 4 onConsume 仅在 partial_final_aoe 结算时触发，absorbedAmount 反映实扣量', () => {
    const consumeCalls: number[] = []
    const spy = spyShield(30000, ({ absorbedAmount }) => consumeCalls.push(absorbedAmount))
    try {
      const calculator = new MitigationCalculator()
      const initialState: PartyState = {
        statuses: [mkShieldStatus('sh1', 0, 30000)],
        timestamp: 0,
      }
      // segCandidateMax 在 final 时 = max(40k, 50k) = 50k
      // effectiveDamage = max(15k, 50k) = 50k；盾 30k 全吃掉 → 触发 onConsume(absorbed=30k)
      calculator.simulate({
        castEvents: [],
        damageEvents: [
          mkDmg('p1', 5, 'partial_aoe', 40000),
          mkDmg('p2', 10, 'partial_aoe', 50000),
          mkDmg('pf', 15, 'partial_final_aoe', 15000),
        ],
        initialState,
        baseReferenceMaxHPForAoe: 100000,
      })
      // partial_aoe 阶段不该触发 onConsume；只有 partial_final_aoe 一次
      expect(consumeCalls).toEqual([30000])
    } finally {
      spy.mockRestore()
    }
  })

  it('段被 aoe 打断后，下一段 segCandidateMax 重置', () => {
    const spy = spyShield(50000)
    try {
      const calculator = new MitigationCalculator()
      const initialState: PartyState = {
        statuses: [mkShieldStatus('sh1', 0, 50000)],
        timestamp: 0,
      }
      // 段1：p1=40k → aoe 打断（吃掉 40k 盾，残 10k）
      // 段2：p2=15k → pf=10k；segCandidateMax=15k；effectiveDamage=max(10k,15k)=15k
      // 残盾 10k 不够吃 15k → 全消耗 → 盾归 0
      const out = calculator.simulate({
        castEvents: [],
        damageEvents: [
          mkDmg('p1', 5, 'partial_aoe', 40000),
          mkDmg('aoe', 10, 'aoe', 40000),
          mkDmg('p2', 15, 'partial_aoe', 15000),
          mkDmg('pf', 20, 'partial_final_aoe', 10000),
          mkDmg('aoe2', 25, 'aoe', 1000),
        ],
        initialState,
        baseReferenceMaxHPForAoe: 100000,
      })
      // aoe 把盾吃到剩 10k → finalDamage=0
      expect(out.damageResults.get('aoe')!.finalDamage).toBe(0)
      // aoe2 candidate=1k，盾此时已全部消耗 → finalDamage=1k
      expect(out.damageResults.get('aoe2')!.finalDamage).toBe(1000)
    } finally {
      spy.mockRestore()
    }
  })

  it('removeOnBarrierBreak: true 的盾在结算被打穿时自动从 statuses 移除', () => {
    const spy = spyShield(20000)
    try {
      const calculator = new MitigationCalculator()
      const initialState: PartyState = {
        statuses: [mkShieldStatus('sh1', 0, 20000)],
        timestamp: 0,
      }
      // segCandidateMax = 50k；盾 20k 被打穿
      const out = calculator.simulate({
        castEvents: [],
        damageEvents: [
          mkDmg('p1', 5, 'partial_aoe', 50000),
          mkDmg('pf', 10, 'partial_final_aoe', 10000),
        ],
        initialState,
        baseReferenceMaxHPForAoe: 100000,
      })
      // 通过 statusTimelineByPlayer 验证盾的 interval 在 pf 时刻收束
      const timeline = out.statusTimelineByPlayer.get(1)?.get(SHIELD_STATUS_ID) ?? []
      expect(timeline.length).toBeGreaterThan(0)
      const lastInterval = timeline[timeline.length - 1]
      expect(lastInterval.to).toBe(10) // pf 时刻
    } finally {
      spy.mockRestore()
    }
  })
})
```

- [ ] **Step 2: 跑新测试，预期全部失败（计算逻辑还没改）**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts -t "partial 段延迟扣盾"`
Expected: 6 个用例全部失败。失败信息会显示"盾被早于 final 扣"或"onConsume 被多次调用"。

- [ ] **Step 3: Commit 失败测试**

Run:

```bash
git add src/utils/mitigationCalculator.test.ts
git commit -m "test(simulator): 新增 partial 段延迟扣盾失败测试"
```

---

## Task 5: 改 `runSingleBranch` Phase 3 实现延迟扣盾

**Files:**

- Modify: `src/utils/mitigationCalculator.ts:887-1068` (`runSingleBranch`)

- [ ] **Step 1: 把 `runSingleBranch` 的 Phase 3 全段（盾值吸收）+ Phase 4（onConsume）替换为分流实现**

定位 `runSingleBranch` 内 `// Phase 3: 盾值吸收` 注释起，到 `// Phase 5 onAfterDamage 由 simulate 主循环...` 注释之前的所有代码（约 963-1056 行），替换为：

```ts
// Phase 3: 盾值吸收
// 判定依据是 **实例级** `remainingBarrier > 0`，不看 metadata 类型 ——
// 这样 buff 类 executor（如死斗）通过 onBeforeShield 给自己挂 transient barrier 也能参与吸收。
const collectActiveShields = (state: PartyState): MitigationStatus[] => {
  const arr: MitigationStatus[] = []
  for (const status of state.statuses) {
    const meta = getStatusById(status.statusId)
    if (!meta) continue
    // 盾的 isTankOnly 需与事件类型匹配：坦专盾只进死刑/普攻，群盾只进 aoe
    if (!shieldFilter(meta, status)) continue
    if (status.remainingBarrier === undefined || status.remainingBarrier <= 0) continue
    if (time >= status.startTime && time <= status.endTime) {
      arr.push(status)
    }
  }
  arr.sort((a, b) => a.startTime - b.startTime)
  return arr
}

const isPartial = event.type === 'partial_aoe' || event.type === 'partial_final_aoe'

// 阶段 A：本事件自身的"显示口径"扣盾——所有事件类型都跑，决定 finalDamage / appliedStatuses。
// partial_aoe 在这里只 read，不 mutation；partial_final_aoe / aoe / 坦专走完整 mutation。
const shieldStatuses = collectActiveShields(workingState)
const statusUpdates = new Map<string, Partial<MitigationStatus>>()
const consumedShields: Array<{ status: MitigationStatus; absorbed: number }> = []
let playerDamage = candidateDamage

for (const status of shieldStatuses) {
  const absorbed = Math.min(playerDamage, status.remainingBarrier!)
  playerDamage -= absorbed

  const existingIdx = appliedStatuses.findIndex(s => s.instanceId === status.instanceId)
  if (existingIdx >= 0) {
    appliedStatuses[existingIdx] = status
  } else {
    appliedStatuses.push(status)
  }

  if (event.type !== 'partial_aoe') {
    const newRemainingBarrier = status.remainingBarrier! - absorbed
    if (newRemainingBarrier <= 0 && status.stack && status.stack > 1 && status.initialBarrier) {
      statusUpdates.set(status.instanceId, {
        remainingBarrier: status.initialBarrier,
        stack: status.stack - 1,
      })
    } else {
      statusUpdates.set(status.instanceId, {
        remainingBarrier: newRemainingBarrier,
      })
      if (newRemainingBarrier <= 0) {
        consumedShields.push({ status, absorbed })
      }
    }
  }

  if (playerDamage <= 0) break
}

const damage = playerDamage

// 阶段 B（仅 partial_final_aoe）：用 max(自身 cd, segCandidateMax) 重跑一次 mutation
// 子流程，做"段最坏一次"的真实扣盾。displayed finalDamage 不受影响。
if (event.type === 'partial_final_aoe') {
  const segCandidateMax = partyState.segment?.segCandidateMax ?? 0
  const effectiveDamage = Math.max(candidateDamage, segCandidateMax)
  // 用阶段 A 已计算到现在的 statusUpdates 作起点：阶段 A 已按 candidateDamage 扣过一遍，
  // 阶段 B 只补"effectiveDamage - candidateDamage"那部分增量到剩余盾上。
  let extra = effectiveDamage - candidateDamage
  if (extra > 0) {
    for (const status of shieldStatuses) {
      // 用 statusUpdates 中已经的 remainingBarrier，没有则用原始
      const partial = statusUpdates.get(status.instanceId)
      const currentBarrier = partial?.remainingBarrier ?? status.remainingBarrier!
      if (currentBarrier <= 0) continue
      const absorbed = Math.min(extra, currentBarrier)
      extra -= absorbed
      const newBarrier = currentBarrier - absorbed
      if (newBarrier <= 0 && status.stack && status.stack > 1 && status.initialBarrier) {
        statusUpdates.set(status.instanceId, {
          remainingBarrier: status.initialBarrier,
          stack: status.stack - 1,
        })
        // stack 衰减不算"消耗殆尽"——与阶段 A 语义对齐
      } else {
        statusUpdates.set(status.instanceId, { remainingBarrier: newBarrier })
        if (newBarrier <= 0) {
          // 阶段 A 没把它当 consumed（absorb 不够打穿），阶段 B 打穿了才算
          const alreadyMarked = consumedShields.some(c => c.status.instanceId === status.instanceId)
          if (!alreadyMarked) {
            // absorbedAmount：阶段 A 的 absorb（若有）+ 阶段 B 的 absorb
            const aAbsorb = (() => {
              // 阶段 A 给该 status 已扣过的量 = remainingBarrier 原值 - 阶段 A 后的 remainingBarrier
              const afterA = partial?.remainingBarrier ?? status.remainingBarrier!
              return status.remainingBarrier! - afterA
            })()
            consumedShields.push({ status, absorbed: aAbsorb + absorbed })
          }
        }
      }
      if (extra <= 0) break
    }
  }
}

let updatedPartyState: PartyState = {
  ...workingState,
  statuses: workingState.statuses
    .map(s => {
      if (statusUpdates.has(s.instanceId)) {
        const updates = statusUpdates.get(s.instanceId)!
        return { ...s, ...updates }
      }
      return s
    })
    // barrier 归 0 时：仅 `removeOnBarrierBreak: true` 的实例被自动清除（原生盾）。
    // 其它（如死斗/出死入生借 onBeforeShield 挂的 transient barrier）保留 buff 本体。
    .filter(s => {
      if (s.remainingBarrier === undefined || s.remainingBarrier > 0) return true
      return !s.removeOnBarrierBreak
    }),
}

// Phase 4: onConsume — 刚被打穿的盾触发后续变化
// partial_aoe 不会进 consumedShields（阶段 A 跳过 mutation 时不收集）；
// partial_final_aoe / aoe / 坦专按收集到的列表触发。
for (const { status, absorbed } of consumedShields) {
  const meta = getStatusById(status.statusId)
  if (!meta?.executor?.onConsume) continue
  const result = meta.executor.onConsume({
    status,
    event,
    partyState: updatedPartyState,
    absorbedAmount: absorbed,
    statistics,
    recordHeal,
  })
  if (result) updatedPartyState = result
}

// 防御：避免 lint 警告（isPartial 仅用作可读性，未直接消费）
void isPartial
```

注：新增的 `void isPartial` 是为了给阅读者保留语义标记，又不触发 unused-var 警告。如果 lint 配置允许直接 `// eslint-disable-next-line no-unused-vars`，也可改成那种。

- [ ] **Step 2: 跑新增的延迟扣盾测试**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts -t "partial 段延迟扣盾"`
Expected: 全部 6 个用例通过。

- [ ] **Step 3: 跑既有 partial 累积 + 全部 mitigationCalculator 测试，确保无回归**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts`
Expected: 全部通过。

- [ ] **Step 4: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 全过。如果 `void isPartial` 仍触发 lint 警告，删掉这一行（保留 `const isPartial = ...` 也会触发，最简方案是连定义带使用一起删，事件类型分支用直接 `event.type === 'partial_aoe'` 判断已经够用——这是合理的清理）。

- [ ] **Step 5: Commit**

Run:

```bash
git add src/utils/mitigationCalculator.ts
git commit -m "feat(simulator): partial_aoe 期间盾仅显示，partial_final_aoe 按段最坏一次结算"
```

---

## Task 6: 全量回归 + 完工提交清单

**Files:** （不改代码，纯验证）

- [ ] **Step 1: 全量测试**

Run: `pnpm test:run`
Expected: 全部通过。如果 `useDamageCalculation.test.ts` / 其他 `useDamageCalculation` 等 hook 测试因 partial 行为变化而预期值变了，按以下原则修：

- 单事件 PropertyPanel 复算入口：`segment` 为 undefined，partial_final_aoe 退化为按自身 cd 扣盾——与原 aoe 行为等价
- `simulate` 调用入口：盾值消耗会延后；如果原测试期望 partial_aoe 期间盾被扣，需要更新预期为"段结束时统一扣"

如果只是预期值需要随新行为更新：调整断言；如果是逻辑判断错误：回 Task 5 排查。

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错。

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: 无错。

- [ ] **Step 4: 构建（可选兜底）**

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 5: 最终 commit（如 Task 6 修了任何遗漏）**

Run:

```bash
git status
# 如果还有未提交的修复：
git add <files>
git commit -m "test: 同步 partial 延迟扣盾的 hook 测试预期"
```

如果 Task 6 全程没有需要修复的，本 task 仅做验证，跳过 commit。

---

## Self-Review

**1. Spec 覆盖**

- ✅ Phase 3 partial_aoe read-only：Task 5 阶段 A 的 `if (event.type !== 'partial_aoe')` 跳过 mutation
- ✅ partial_final_aoe 显示 + 结算两阶段：Task 5 阶段 A（显示）+ 阶段 B（结算）
- ✅ `segCandidateMax` 累积：Task 2 `applyDamageToHp` 内
- ✅ HpPool 拆 SegmentState：Task 1
- ✅ 段中断条件：Task 2 `applyDamageToHp` 的事件类型分支
- ✅ Phase 4 onConsume 仅结算时：Task 5 通过 `consumedShields` 仅在阶段 A（非 partial_aoe）/ 阶段 B 收集
- ✅ 单事件入口兜底：Task 5 阶段 B 用 `partyState.segment?.segCandidateMax ?? 0`
- ✅ removeOnBarrierBreak：Task 5 `.filter(s => !s.removeOnBarrierBreak)` 保留
- ✅ 测试覆盖：Task 4 六个用例对应 spec 测试列表全部场景

**2. Placeholder 扫描**

- 全部 step 都有完整代码或具体命令；无 TBD / TODO / "如需要..."。

**3. 类型一致性**

- `applyDamageToHp(state, ev, finalDamage, candidateDamage)` 在 Task 2 定义、Task 2 Step 4 调用、参数类型一致
- `SegmentState` 字段名 `inSegment / segMax / segCandidateMax` 在 spec / Task 1 / Task 2 / Task 5 全文一致
- `consumedShields: Array<{ status; absorbed }>` 字段在 Task 5 阶段 A 和阶段 B 都用同一形状

**4. 遗漏点**

- Task 5 中 `void isPartial` 提示如有 lint 麻烦的清理方案（删掉变量），可选灵活处理
- Task 6 给了"hook 测试可能也需要更新预期"的说明，避免实施者卡在那
