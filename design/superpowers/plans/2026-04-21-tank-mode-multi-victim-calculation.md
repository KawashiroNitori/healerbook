# 坦专事件多承伤者减伤计算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git 授权提醒**：项目规则"未经用户明确要求不得自行 Git 操作"。每个 Task 的 commit step 执行前必须等用户明确授权；不得携带 `Co-Authored-By: Claude`。

**Spec:** `design/superpowers/specs/2026-04-21-tank-mode-multi-victim-calculation-design.md`

**Goal:** 让 `MitigationCalculator` 对 tankbuster / auto 事件按每个坦克独立产出减伤结果（`perVictim`），过滤规则基于 `MitigationCategory`，第一坦分支的 `updatedPartyState` 对外持久化；PropertyPanel 展示 per-tank 预估。

**Architecture:** 给 `MitigationStatusMetadata` 补 `category` 字段并从 `STATUS_EXTRAS` 透传；抽出 `isStatusValidForTank` 过滤 helper；把现有 5 阶段 pipeline 提成 `runSingleBranch()`；`calculate()` 里分发：坦专 + 有坦克 → 逐 tank 跑 branch，聚合；其它走等价单路径。maxHP 倍率从 `useDamageCalculation` 下沉到 calculator 内按 branch 叠乘。UI 上 PropertyPanel 在 HP 条上方加一个 per-victim 紧凑列表。

**Tech Stack:** TypeScript 5.9, Vitest 4, React 19, Zustand 5。

---

## File 映射

| 动作   | 文件                                     | 作用                                                           |
| ------ | ---------------------------------------- | -------------------------------------------------------------- |
| Modify | `src/types/status.ts`                    | 补 `MitigationStatusMetadata.category?: MitigationCategory[]`  |
| Modify | `src/utils/statusRegistry.ts`            | merge 时拷贝 `extras?.category`                                |
| Create | `src/utils/statusFilter.ts`              | `isStatusValidForTank(meta, status, tankId)`                   |
| Create | `src/utils/statusFilter.test.ts`         | 过滤规则单元测试                                               |
| Modify | `src/utils/mitigationCalculator.ts`      | 类型扩展 + 抽 `runSingleBranch` + 多坦分发 + maxHP 下沉        |
| Modify | `src/utils/mitigationCalculator.test.ts` | 新增 8 个 case                                                 |
| Modify | `src/hooks/useDamageCalculation.ts`      | 传 `tankPlayerIds` / `baseReferenceMaxHP`，移除外部 maxHP 累乘 |
| Modify | `src/components/PropertyPanel.tsx`       | 新增 per-victim 列表渲染块                                     |

---

## Task 1: 补齐 `MitigationStatusMetadata.category` 字段

**Files:**

- Modify: `src/types/status.ts`
- Modify: `src/utils/statusRegistry.ts`

- [ ] **Step 1.1：`src/types/status.ts` 加 category 字段**

修改 `MitigationStatusMetadata` interface，`executor?: StatusExecutor` 之后加：

```ts
import type { MitigationCategory } from './mitigation'

export interface MitigationStatusMetadata extends Omit<Keigenn, 'performance' | 'fullIcon'> {
  performance: PerformanceType
  fullIcon?: string
  isTankOnly: boolean
  executor?: StatusExecutor
  /** 分类 tag，透传自 STATUS_EXTRAS.category；calculator 按 tank 过滤时消费 */
  category?: MitigationCategory[]
}
```

- [ ] **Step 1.2：`src/utils/statusRegistry.ts` merge extras.category**

在 `initializeStatusRegistry()` 的 `merged` 对象里加 `category: extras?.category` 行（紧跟 `executor: extras?.executor`）：

```ts
const merged: MitigationStatusMetadata = {
  ...status,
  performance: {
    ...status.performance,
    heal: extras?.heal ?? 1,
    maxHP: extras?.maxHP ?? 1,
  },
  isTankOnly: extras?.isTankOnly ?? false,
  executor: extras?.executor,
  category: extras?.category,
}
```

- [ ] **Step 1.3：类型检查通过**

Run: `pnpm exec tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 1.4：测试没被打破**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts src/utils/statusRegistry.test.ts`
Expected: 全部通过。

- [ ] **Step 1.5：Commit**

```bash
git add src/types/status.ts src/utils/statusRegistry.ts
git commit -m "feat(mitigation): 把 STATUS_EXTRAS.category 透传到 MitigationStatusMetadata"
```

---

## Task 2: `isStatusValidForTank` 过滤 helper（TDD）

**Files:**

- Create: `src/utils/statusFilter.ts`
- Create: `src/utils/statusFilter.test.ts`

- [ ] **Step 2.1：先写失败测试**

新建 `src/utils/statusFilter.test.ts`：

```ts
/**
 * statusFilter 测试
 */

import { describe, it, expect } from 'vitest'
import { isStatusValidForTank } from './statusFilter'
import type { MitigationStatus, MitigationStatusMetadata } from '@/types/status'

function makeMeta(category?: MitigationStatusMetadata['category']): MitigationStatusMetadata {
  // 仅测试用；业务字段按最小必要填
  return {
    id: 999,
    name: 't',
    type: 'multiplier',
    performance: { physics: 1, magic: 1, darkness: 1 },
    isFriendly: true,
    isTankOnly: false,
    category,
  } as unknown as MitigationStatusMetadata
}

function makeStatus(sourcePlayerId: number): MitigationStatus {
  return {
    instanceId: 'x',
    statusId: 999,
    startTime: 0,
    endTime: 10,
    sourcePlayerId,
  }
}

describe('isStatusValidForTank', () => {
  it('partywide → 对任何 tank 都有效', () => {
    const meta = makeMeta(['partywide', 'percentage'])
    expect(isStatusValidForTank(meta, makeStatus(1), 1)).toBe(true)
    expect(isStatusValidForTank(meta, makeStatus(1), 2)).toBe(true)
  })

  it('未标注 category → 默认放行', () => {
    const meta = makeMeta(undefined)
    expect(isStatusValidForTank(meta, makeStatus(1), 2)).toBe(true)
  })

  it('category 不含 self/target → 默认放行', () => {
    const meta = makeMeta(['percentage'])
    expect(isStatusValidForTank(meta, makeStatus(1), 2)).toBe(true)
  })

  it('持有者评估：要求 self', () => {
    expect(isStatusValidForTank(makeMeta(['self', 'percentage']), makeStatus(1), 1)).toBe(true)
    expect(isStatusValidForTank(makeMeta(['target', 'percentage']), makeStatus(1), 1)).toBe(false)
  })

  it('非持有者评估：要求 target', () => {
    expect(isStatusValidForTank(makeMeta(['target', 'percentage']), makeStatus(1), 2)).toBe(true)
    expect(isStatusValidForTank(makeMeta(['self', 'percentage']), makeStatus(1), 2)).toBe(false)
  })

  it('self+target 同时有 → 两侧都通过', () => {
    const meta = makeMeta(['self', 'target', 'percentage'])
    expect(isStatusValidForTank(meta, makeStatus(1), 1)).toBe(true)
    expect(isStatusValidForTank(meta, makeStatus(1), 2)).toBe(true)
  })
})
```

- [ ] **Step 2.2：跑测试确认 fail**

Run: `pnpm test:run src/utils/statusFilter.test.ts`
Expected: FAIL — cannot find module `./statusFilter`。

- [ ] **Step 2.3：写最小实现**

新建 `src/utils/statusFilter.ts`：

```ts
/**
 * 按坦克过滤状态：决定某个 MitigationStatus 是否对指定 tank 生效。
 *
 * 规则：
 *   1. category 含 'partywide' → 有效
 *   2. category 不含 'self' 也不含 'target' → 有效（未标注 = 默认放行）
 *   3. status.sourcePlayerId === tankId → 要求 category 含 'self'
 *   4. 否则 → 要求 category 含 'target'
 */

import type { MitigationStatus, MitigationStatusMetadata } from '@/types/status'

export function isStatusValidForTank(
  meta: MitigationStatusMetadata,
  status: MitigationStatus,
  tankId: number
): boolean {
  const cat = meta.category ?? []
  if (cat.includes('partywide')) return true
  if (!cat.includes('self') && !cat.includes('target')) return true
  return status.sourcePlayerId === tankId ? cat.includes('self') : cat.includes('target')
}
```

- [ ] **Step 2.4：跑测试确认 pass**

Run: `pnpm test:run src/utils/statusFilter.test.ts`
Expected: PASS，6 个 case 全过。

- [ ] **Step 2.5：Commit**

```bash
git add src/utils/statusFilter.ts src/utils/statusFilter.test.ts
git commit -m "feat(mitigation): 新增 isStatusValidForTank 过滤 helper"
```

---

## Task 3: Calculator 类型扩展（`CalculateOptions` / `CalculationResult`）

**Files:**

- Modify: `src/utils/mitigationCalculator.ts`

这一步只加类型字段，不改行为；后续 task 会消费。

- [ ] **Step 3.1：扩展 `CalculateOptions`**

在 `src/utils/mitigationCalculator.ts` 里，把 `CalculateOptions` 改为：

```ts
export interface CalculateOptions {
  /**
   * 事件对应的参考血量（已叠加 maxHP 倍率；单路径兼容字段）。
   * 多坦路径会改用 `baseReferenceMaxHP` 由 calculator 内部按 tank 叠乘。
   */
  referenceMaxHP?: number
  /**
   * 基线参考 HP（未叠加 maxHP 倍率）。提供此字段时，calculator 负责按活跃 buff 叠乘。
   */
  baseReferenceMaxHP?: number
  /**
   * 坦专事件的承伤者坦克列表，按 composition 顺序。
   * - 非空 + event.type ∈ {tankbuster, auto} → 多坦路径
   * - 否则 → 单路径（现有行为）
   */
  tankPlayerIds?: number[]
}
```

- [ ] **Step 3.2：新增 `PerTankResult` + 扩展 `CalculationResult`**

同文件新增 + 修改：

```ts
export interface PerTankResult {
  /** 该坦克玩家 ID */
  playerId: number
  finalDamage: number
  mitigationPercentage: number
  appliedStatuses: MitigationStatus[]
  /** 该分支个性化后的参考 HP（叠乘 maxHP 倍率） */
  referenceMaxHP: number
}

export interface CalculationResult {
  originalDamage: number
  finalDamage: number
  maxDamage: number
  mitigationPercentage: number
  appliedStatuses: MitigationStatus[]
  updatedPartyState?: PartyState
  referenceMaxHP?: number
  /**
   * 多坦路径产出；单路径（aoe / 无坦克）为 undefined。
   * 顶层 finalDamage / appliedStatuses / updatedPartyState 取 perVictim[0]；
   * maxDamage 取 max(perVictim.finalDamage)。
   */
  perVictim?: PerTankResult[]
}
```

- [ ] **Step 3.3：类型检查 + 原测试通过**

Run: `pnpm exec tsc --noEmit && pnpm test:run src/utils/mitigationCalculator.test.ts`
Expected: 无新增错误，原 test 全通过（行为无变化）。

- [ ] **Step 3.4：Commit**

```bash
git add src/utils/mitigationCalculator.ts
git commit -m "feat(mitigation): 扩展 CalculateOptions / CalculationResult 类型以支持 per-tank"
```

---

## Task 4: 把 5 阶段 pipeline 提成 `runSingleBranch()`（纯重构，不改行为）

**Files:**

- Modify: `src/utils/mitigationCalculator.ts`

目的：让多坦分发在 Task 5 里能复用同一套管线。

- [ ] **Step 4.1：抽出 `runSingleBranch` 私有方法**

在 `MitigationCalculator` 类里新增（放在 `calculate` 之后作为 private 方法）。

**设计注意**：旧版 Phase 1/2/5（multiplier 向）过滤是 `isTankOnly && !includeTankOnly` 跳过，Phase 3（shield 向）过滤是 `isTankOnly !== includeTankOnly`。为避免单路径等价性回归，这里接收**两个 filter**：`multiplierFilter`（Phase 1 / 2 / 5）、`shieldFilter`（Phase 3）。多坦路径下两个 filter 都传同一个 `isStatusValidForTank(…, tankId)`；单路径分别复刻旧口径。

```ts
private runSingleBranch(
  event: DamageEvent,
  partyState: PartyState,
  opts: {
    multiplierFilter: (meta: MitigationStatusMetadata, status: MitigationStatus) => boolean
    shieldFilter: (meta: MitigationStatusMetadata, status: MitigationStatus) => boolean
    referenceMaxHP: number
  }
): {
  finalDamage: number
  mitigationPercentage: number
  appliedStatuses: MitigationStatus[]
  updatedPartyState: PartyState
} {
  const originalDamage = event.damage
  const time = event.time
  const damageType: DamageType = event.damageType || 'physical'
  const snapshotTime = event.snapshotTime
  const mitigationTime = snapshotTime ?? time
  const { multiplierFilter, shieldFilter, referenceMaxHP } = opts

  // Phase 1: % 减伤
  let multiplier = 1.0
  const appliedStatuses: MitigationStatus[] = []

  for (const status of partyState.statuses) {
    const meta = getStatusById(status.statusId)
    if (!meta) continue
    if (!multiplierFilter(meta, status)) continue

    if (meta.type === 'multiplier') {
      if (mitigationTime >= status.startTime && mitigationTime <= status.endTime) {
        const performance = status.performance ?? meta.performance
        const damageMultiplier = this.getDamageMultiplier(performance, damageType)
        multiplier *= damageMultiplier
        appliedStatuses.push(status)
      }
    }
  }

  const candidateDamage = Math.round(originalDamage * multiplier)

  // Phase 2: onBeforeShield
  let workingState: PartyState = partyState
  for (const status of partyState.statuses) {
    const meta = getStatusById(status.statusId)
    if (!meta?.executor?.onBeforeShield) continue
    if (!multiplierFilter(meta, status)) continue
    if (mitigationTime < status.startTime || mitigationTime > status.endTime) continue

    const result = meta.executor.onBeforeShield({
      status,
      event,
      partyState: workingState,
      candidateDamage,
      referenceMaxHP,
    })
    if (result) workingState = result
  }

  // Phase 3: 盾吸收
  const shieldStatuses: MitigationStatus[] = []
  for (const status of workingState.statuses) {
    const meta = getStatusById(status.statusId)
    if (!meta) continue
    if (!shieldFilter(meta, status)) continue
    if (status.remainingBarrier === undefined || status.remainingBarrier <= 0) continue
    if (time >= status.startTime && time <= status.endTime) {
      shieldStatuses.push(status)
    }
  }
  shieldStatuses.sort((a, b) => a.startTime - b.startTime)

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

    if (playerDamage <= 0) break
  }

  const damage = playerDamage

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
      .filter(s => {
        if (s.remainingBarrier === undefined || s.remainingBarrier > 0) return true
        return !s.removeOnBarrierBreak
      }),
  }

  // Phase 4: onConsume
  for (const { status, absorbed } of consumedShields) {
    const meta = getStatusById(status.statusId)
    if (!meta?.executor?.onConsume) continue
    const result = meta.executor.onConsume({
      status,
      event,
      partyState: updatedPartyState,
      absorbedAmount: absorbed,
    })
    if (result) updatedPartyState = result
  }

  // Phase 5: onAfterDamage
  for (const status of partyState.statuses) {
    const meta = getStatusById(status.statusId)
    if (!meta?.executor?.onAfterDamage) continue
    if (!multiplierFilter(meta, status)) continue
    if (mitigationTime < status.startTime || mitigationTime > status.endTime) continue

    const result = meta.executor.onAfterDamage({
      status,
      event,
      partyState: updatedPartyState,
      candidateDamage,
      finalDamage: Math.max(0, Math.round(damage)),
    })
    if (result) updatedPartyState = result
  }

  const mitigationPercentage =
    originalDamage > 0 ? ((originalDamage - damage) / originalDamage) * 100 : 0

  return {
    finalDamage: Math.max(0, Math.round(damage)),
    mitigationPercentage: Math.round(mitigationPercentage * 10) / 10,
    appliedStatuses,
    updatedPartyState,
  }
}
```

**注意**：`includeTankOnly` 参数仅为保留（单路径里某些 hook 内部逻辑会通过 filter 间接消费；此 helper 自身不再直接用它）。下一步 `calculate()` 会组合它。

- [ ] **Step 4.2：`calculate()` 改成调用 `runSingleBranch`（单路径等价）**

把 `calculate()` 方法体替换为：

```ts
calculate(
  event: DamageEvent,
  partyState: PartyState,
  opts?: CalculateOptions
): CalculationResult {
  const originalDamage = event.damage
  const attackType = event.type
  const includeTankOnly = attackType === 'tankbuster' || attackType === 'auto'

  // 单路径两口径 filter（维持旧行为 1:1 等价）：
  //   multiplierFilter（Phase 1/2/5）：`isTankOnly && !includeTankOnly` 时跳过
  //   shieldFilter（Phase 3）：`isTankOnly !== includeTankOnly` 时跳过
  const singleMultiplierFilter = (meta: MitigationStatusMetadata) =>
    !(meta.isTankOnly && !includeTankOnly)
  const singleShieldFilter = (meta: MitigationStatusMetadata) =>
    meta.isTankOnly === includeTankOnly

  // referenceMaxHP 优先用 opts.referenceMaxHP（旧调用方已算好），否则由 baseReferenceMaxHP 叠乘
  const referenceMaxHP =
    opts?.referenceMaxHP ??
    this.computeReferenceMaxHP(event, partyState, opts?.baseReferenceMaxHP ?? 0, includeTankOnly)

  const branch = this.runSingleBranch(event, partyState, {
    multiplierFilter: singleMultiplierFilter,
    shieldFilter: singleShieldFilter,
    referenceMaxHP,
  })

  return {
    originalDamage,
    finalDamage: branch.finalDamage,
    maxDamage: branch.finalDamage,
    mitigationPercentage: branch.mitigationPercentage,
    appliedStatuses: branch.appliedStatuses,
    updatedPartyState: branch.updatedPartyState,
    referenceMaxHP,
  }
}

/**
 * 计算指定事件在给定 status 过滤下的参考 HP（基线 × 活跃 buff maxHP 累乘）。
 */
private computeReferenceMaxHP(
  event: DamageEvent,
  partyState: PartyState,
  base: number,
  includeTankOnly: boolean
): number {
  if (base <= 0) return 0
  const mitigationTime = event.snapshotTime ?? event.time
  let m = 1
  for (const status of partyState.statuses) {
    if (mitigationTime < status.startTime || mitigationTime > status.endTime) continue
    const meta = getStatusById(status.statusId)
    if (!meta) continue
    if (meta.isTankOnly && !includeTankOnly) continue
    const perf = status.performance ?? meta.performance
    const mm = perf.maxHP ?? 1
    if (mm !== 1) m *= mm
  }
  return Math.round(base * m)
}
```

**注意**：`opts.referenceMaxHP`（旧路径兼容）仍然优先；只有当调用方不传 `referenceMaxHP` 且传了 `baseReferenceMaxHP` 时才由 calculator 叠乘。这样单路径行为与旧版等价。

- [ ] **Step 4.3：跑全部 calculator 测试**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts`
Expected: 全部通过（纯重构，无行为变化）。如果有退化，对比抽取前后的 phase 1/2/3/5 过滤语句是否严格一致并修正。

- [ ] **Step 4.4：Commit**

```bash
git add src/utils/mitigationCalculator.ts
git commit -m "refactor(mitigation): 把 calculator 五阶段 pipeline 抽成 runSingleBranch"
```

---

## Task 5: 多坦分发 + 核心测试

**Files:**

- Modify: `src/utils/mitigationCalculator.ts`
- Modify: `src/utils/mitigationCalculator.test.ts`

- [ ] **Step 5.1：`calculate()` 增加多坦分支**

修改 `calculate()`，在确定 `includeTankOnly` 之后、走 `runSingleBranch` 之前，插入：

```ts
import { isStatusValidForTank } from './statusFilter'

// …在 calculate() 里：

const tankIds = opts?.tankPlayerIds ?? []
if (includeTankOnly && tankIds.length >= 1) {
  const base = opts?.baseReferenceMaxHP ?? opts?.referenceMaxHP ?? 0

  const perVictim: PerTankResult[] = tankIds.map(tankId => {
    const tankFilter = (meta: MitigationStatusMetadata, status: MitigationStatus) =>
      isStatusValidForTank(meta, status, tankId)
    const refHP = this.computeReferenceMaxHPFiltered(event, partyState, base, tankFilter)
    const branch = this.runSingleBranch(event, partyState, {
      multiplierFilter: tankFilter,
      shieldFilter: tankFilter,
      referenceMaxHP: refHP,
    })
    return {
      playerId: tankId,
      finalDamage: branch.finalDamage,
      mitigationPercentage: branch.mitigationPercentage,
      appliedStatuses: branch.appliedStatuses,
      referenceMaxHP: refHP,
      _state: branch.updatedPartyState, // 临时字段，聚合后丢弃
    } as PerTankResult & { _state: PartyState }
  })

  const firstBranch = perVictim[0] as PerTankResult & { _state: PartyState }
  const result: CalculationResult = {
    originalDamage,
    finalDamage: firstBranch.finalDamage,
    maxDamage: Math.max(...perVictim.map(v => v.finalDamage)),
    mitigationPercentage: firstBranch.mitigationPercentage,
    appliedStatuses: firstBranch.appliedStatuses,
    updatedPartyState: firstBranch._state,
    referenceMaxHP: firstBranch.referenceMaxHP,
    perVictim: perVictim.map(({ _state: _ignored, ...rest }) => {
      void _ignored
      return rest
    }),
  }
  return result
}
```

并新增 `computeReferenceMaxHPFiltered` 私有方法（逻辑同 `computeReferenceMaxHP`，但过滤函数走外部传入）：

```ts
private computeReferenceMaxHPFiltered(
  event: DamageEvent,
  partyState: PartyState,
  base: number,
  filter: (meta: MitigationStatusMetadata, status: MitigationStatus) => boolean
): number {
  if (base <= 0) return 0
  const mitigationTime = event.snapshotTime ?? event.time
  let m = 1
  for (const status of partyState.statuses) {
    if (mitigationTime < status.startTime || mitigationTime > status.endTime) continue
    const meta = getStatusById(status.statusId)
    if (!meta) continue
    if (!filter(meta, status)) continue
    const perf = status.performance ?? meta.performance
    const mm = perf.maxHP ?? 1
    if (mm !== 1) m *= mm
  }
  return Math.round(base * m)
}
```

**import 顺便加到文件顶部**：`import { isStatusValidForTank } from './statusFilter'`。

- [ ] **Step 5.2：写核心测试（先 fail）**

在 `src/utils/mitigationCalculator.test.ts` 文件尾部新增 describe 块：

```ts
describe('多坦 per-victim 路径', () => {
  it('双坦共受伤：死斗（self+shield）只在持有者分支生效', () => {
    // statusId 409 = 死斗，category: ['self', 'shield']，executor 走 createSurvivalBarrierHook
    const partyState: PartyState = {
      ...basePartyState,
      statuses: [
        {
          instanceId: 'ihd-1',
          statusId: 409,
          startTime: 0,
          endTime: 10,
          sourcePlayerId: 1, // MT 持有
          removeOnBarrierBreak: false,
        },
      ],
    }
    const result = calculator.calculate(
      makeEvent(200000, 5, 'physical', 'tankbuster'),
      partyState,
      {
        tankPlayerIds: [1, 2],
        baseReferenceMaxHP: 100000,
      }
    )
    expect(result.perVictim).toHaveLength(2)
    expect(result.perVictim![0].playerId).toBe(1)
    expect(result.perVictim![1].playerId).toBe(2)
    // MT 分支：死斗 survival hook 把伤害顶到 1
    expect(result.perVictim![0].finalDamage).toBe(1)
    // OT 分支：死斗 category 不含 target 且 sourcePlayerId(1)!==OT(2)，被过滤 → 吃满 200000
    expect(result.perVictim![1].finalDamage).toBe(200000)
    // 顶层 = 第一坦（MT）
    expect(result.finalDamage).toBe(1)
    expect(result.maxDamage).toBe(200000)
  })

  it('未标注 category 的状态对持有者和非持有者都生效（复仇 89）', () => {
    // 复仇 89 只标 isTankOnly，没 category；按规则默认放行
    // 构造一个 mock：让 89 实际有 performance，用 vi.spyOn 覆盖 registry
    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation((id: number) => {
      if (id === 89) {
        return {
          id: 89,
          name: '复仇',
          type: 'multiplier',
          performance: { physics: 0.7, magic: 0.7, darkness: 0.7 },
          isFriendly: true,
          isTankOnly: true,
          // 不设 category → 默认放行
        } as unknown as MitigationStatusMetadata
      }
      return undefined
    })
    try {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'v-1',
            statusId: 89,
            startTime: 0,
            endTime: 10,
            sourcePlayerId: 1,
          },
        ],
      }
      const result = calculator.calculate(
        makeEvent(10000, 5, 'physical', 'tankbuster'),
        partyState,
        { tankPlayerIds: [1, 2], baseReferenceMaxHP: 100000 }
      )
      // 两个分支都应用了 0.7 减伤
      expect(result.perVictim![0].finalDamage).toBe(7000)
      expect(result.perVictim![1].finalDamage).toBe(7000)
    } finally {
      spy.mockRestore()
    }
  })

  it('第一坦 state 持久化：OT 分支盾消耗不写回 updatedPartyState', () => {
    // 构造一个 self+target+shield 的持久盾，OT 施放给自己（sourcePlayerId=2）
    // MT 分支因 category 含 target 也会消耗；OT 分支含 self 也会消耗。
    // updatedPartyState 应只反映 MT 分支的消耗。
    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation((id: number) => {
      if (id === 8888) {
        return {
          id: 8888,
          name: 'mock-shield',
          type: 'absorbed',
          performance: { physics: 1, magic: 1, darkness: 1 },
          isFriendly: true,
          isTankOnly: true,
          category: ['self', 'target', 'shield'],
        } as unknown as MitigationStatusMetadata
      }
      return undefined
    })
    try {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'sh-1',
            statusId: 8888,
            startTime: 0,
            endTime: 10,
            sourcePlayerId: 2, // OT 施放
            remainingBarrier: 5000,
            initialBarrier: 5000,
            removeOnBarrierBreak: true,
          },
        ],
      }
      const result = calculator.calculate(
        makeEvent(3000, 5, 'physical', 'tankbuster'),
        partyState,
        { tankPlayerIds: [1, 2], baseReferenceMaxHP: 100000 }
      )
      // MT 分支把盾吃掉 3000，剩 2000
      expect(result.perVictim![0].finalDamage).toBe(0)
      // OT 分支同样可见这块盾（self），自己也能吃 3000 → 实际伤害 0
      expect(result.perVictim![1].finalDamage).toBe(0)
      // 持久化 state 只来自 MT 分支：盾剩 2000
      const persistedShield = result.updatedPartyState!.statuses.find(s => s.instanceId === 'sh-1')
      expect(persistedShield?.remainingBarrier).toBe(2000)
    } finally {
      spy.mockRestore()
    }
  })

  it('maxHP 按 tank 个性化：MT 有战栗 1.2× 加成，OT 没有', () => {
    // 战栗 87 category: ['self']，maxHP 1.2
    const partyState: PartyState = {
      ...basePartyState,
      statuses: [
        {
          instanceId: 'tr-1',
          statusId: 87,
          startTime: 0,
          endTime: 10,
          sourcePlayerId: 1, // MT 自己
        },
      ],
    }
    const result = calculator.calculate(makeEvent(1, 5, 'physical', 'tankbuster'), partyState, {
      tankPlayerIds: [1, 2],
      baseReferenceMaxHP: 100000,
    })
    // MT 分支：87 category=['self']+sourcePlayerId===MT → 有效，maxHP×1.2 → 120000
    expect(result.perVictim![0].referenceMaxHP).toBe(120000)
    // OT 分支：87 source=MT、非持有者要 target → 过滤掉 → maxHP 不叠 → 100000
    expect(result.perVictim![1].referenceMaxHP).toBe(100000)
  })

  it('单坦退化：tankPlayerIds 只有一个时 perVictim 长度=1', () => {
    const partyState: PartyState = {
      ...basePartyState,
      statuses: [
        {
          instanceId: 'br-1',
          statusId: 1191, // 铁壁 isTankOnly + category: ['self', 'percentage']
          startTime: 0,
          endTime: 10,
          sourcePlayerId: 1,
        },
      ],
    }
    const result = calculator.calculate(makeEvent(10000, 5, 'physical', 'tankbuster'), partyState, {
      tankPlayerIds: [1],
      baseReferenceMaxHP: 100000,
    })
    expect(result.perVictim).toHaveLength(1)
    expect(result.perVictim![0].playerId).toBe(1)
    // 铁壁 physics 0.8 → 8000
    expect(result.finalDamage).toBe(8000)
  })

  it('非坦专事件不走多坦路径：aoe 事件 perVictim undefined', () => {
    const partyState: PartyState = {
      ...basePartyState,
      statuses: [],
    }
    const result = calculator.calculate(makeEvent(10000, 5, 'magical', 'aoe'), partyState, {
      tankPlayerIds: [1, 2],
      baseReferenceMaxHP: 100000,
    })
    expect(result.perVictim).toBeUndefined()
  })
})
```

（`partywide 盾参与坦专` case 合并进 Task 6 的 maxHP 等价验证块里，见下。）

- [ ] **Step 5.3：跑新测试**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts`
Expected: 6 个新 case 全通过，原有 case 不退化。

- [ ] **Step 5.4：`pnpm lint` 清掉新引入的 any / unused**

Run: `pnpm lint src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts`
Expected: 无 error；有 warning 则修掉 `as unknown as` 的合理性（测试里 mock 可以容忍但不该报 lint error）。

- [ ] **Step 5.5：Commit**

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "feat(mitigation): calculator 支持 per-tank 多结果路径"
```

---

## Task 6: partywide 盾进入坦专 + maxHP 下沉的等价验证

**Files:**

- Modify: `src/utils/mitigationCalculator.test.ts`

说明：partywide 盾在多坦路径已经通过 `isStatusValidForTank` 的第一条规则放行；单路径里的 `singleFilter` 仍维持旧口径（`meta.isTankOnly !== includeTankOnly` 语义）以向后兼容。本任务只补一个 case 证明"多坦路径下 partywide 盾确实被消耗"。

- [ ] **Step 6.1：新增 partywide 盾 case**

在多坦 describe 块尾部追加：

```ts
it('partywide 盾在坦专事件下被第一坦分支消耗', () => {
  const spy = vi.spyOn(registry, 'getStatusById').mockImplementation((id: number) => {
    if (id === 9999) {
      return {
        id: 9999,
        name: 'mock-party-shield',
        type: 'absorbed',
        performance: { physics: 1, magic: 1, darkness: 1 },
        isFriendly: true,
        isTankOnly: false,
        category: ['partywide', 'shield'],
      } as unknown as MitigationStatusMetadata
    }
    return undefined
  })
  try {
    const partyState: PartyState = {
      ...basePartyState,
      statuses: [
        {
          instanceId: 'ps-1',
          statusId: 9999,
          startTime: 0,
          endTime: 10,
          sourcePlayerId: 3, // 治疗玩家
          remainingBarrier: 4000,
          initialBarrier: 4000,
          removeOnBarrierBreak: true,
        },
      ],
    }
    const result = calculator.calculate(makeEvent(2000, 5, 'physical', 'tankbuster'), partyState, {
      tankPlayerIds: [1, 2],
      baseReferenceMaxHP: 100000,
    })
    // 两个分支都看到这块盾（partywide 永远放行），都吃 2000
    expect(result.perVictim![0].finalDamage).toBe(0)
    expect(result.perVictim![1].finalDamage).toBe(0)
    // 持久化状态 = MT 分支：盾剩 2000
    const persisted = result.updatedPartyState!.statuses.find(s => s.instanceId === 'ps-1')
    expect(persisted?.remainingBarrier).toBe(2000)
  } finally {
    spy.mockRestore()
  }
})
```

- [ ] **Step 6.2：跑测试**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts`
Expected: 通过。

- [ ] **Step 6.3：Commit**

```bash
git add src/utils/mitigationCalculator.test.ts
git commit -m "test(mitigation): 补 partywide 盾进入坦专事件的 case"
```

---

## Task 7: `useDamageCalculation` 接线 + 移除外部 maxHP 累乘

**Files:**

- Modify: `src/hooks/useDamageCalculation.ts`

- [ ] **Step 7.1：改造编辑模式的 calculate 调用**

`src/hooks/useDamageCalculation.ts` 编辑模式里（在 `for (const event of sortedDamageEvents)` 循环内）当前构造 `eventReferenceMaxHP` 的段落（约 195–216 行）：

```ts
const includeTankOnly = event.type === 'tankbuster' || event.type === 'auto'
const baseReferenceMaxHP = includeTankOnly ? tankReferenceMaxHP : referenceMaxHP

// 依据活跃状态 performance.maxHP 抬高/压低参考 HP …
const mitigationTime = event.snapshotTime ?? event.time
let maxHPMultiplier = 1
for (const status of currentState.statuses) {
  if (mitigationTime < status.startTime || mitigationTime > status.endTime) continue
  const meta = getStatusById(status.statusId)
  if (!meta) continue
  if (meta.isTankOnly && !includeTankOnly) continue
  const perf = status.performance ?? meta.performance
  const m = perf.maxHP ?? 1
  if (m !== 1) maxHPMultiplier *= m
}

const eventReferenceMaxHP = Math.round(baseReferenceMaxHP * maxHPMultiplier)

const result = calculator.calculate(event, currentState, {
  referenceMaxHP: eventReferenceMaxHP,
})

results.set(event.id, { ...result, referenceMaxHP: eventReferenceMaxHP })
```

替换为：

```ts
const includeTankOnly = event.type === 'tankbuster' || event.type === 'auto'
const baseReferenceMaxHP = includeTankOnly ? tankReferenceMaxHP : referenceMaxHP

// 从 composition 取坦克玩家 ID，按自然顺序（首个 tank 作为"MT 参考分支"）
const tankPlayerIds = includeTankOnly
  ? timeline.composition.players.filter(p => getJobRole(p.job) === 'tank').map(p => p.id)
  : []

const result = calculator.calculate(event, currentState, {
  baseReferenceMaxHP,
  tankPlayerIds,
})

results.set(event.id, result)
if (result.updatedPartyState) {
  currentState = result.updatedPartyState
}
```

并在文件顶 import 追加：

```ts
import { getJobRole } from '@/data/jobs'
```

原来 `if (result.updatedPartyState) { currentState = result.updatedPartyState }` 保持在同一位置（放在 `results.set` 之后）。

**注意**：`getStatusById` 如果在本 hook 的其它地方还有被引用（onTick / onExpire 的 advanceToTime 里），保留那部分 import。

- [ ] **Step 7.2：pnpm exec tsc --noEmit**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 7.3：跑 hook + calculator 测试**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts src/hooks`
Expected: 全通过（单坦 timeline 下的旧 case 应当与之前等价，因为新路径对 tankPlayerIds=[MT] 会走到多坦分支但退化为 1 结果，顶层等价）。

- [ ] **Step 7.4：启动开发服务器手动验证**

跳过 —— dev server 通常用户在运行，hook 层面无 UI 变化。留到 Task 8 后一并 QA。

- [ ] **Step 7.5：Commit**

```bash
git add src/hooks/useDamageCalculation.ts
git commit -m "feat(mitigation): useDamageCalculation 注入 tankPlayerIds，移除外部 maxHP 累乘"
```

---

## Task 8: PropertyPanel 展示 per-victim

**Files:**

- Modify: `src/components/PropertyPanel.tsx`

设计上：在现有 HP 条块（约 L188–257）**上方**插入一个紧凑列表块，`result.perVictim` 存在且长度 ≥ 1 时渲染"每个坦克一行（job 图标 + 坦克编号 + finalDamage + mitigationPercentage）"；现有 HP 条和减伤构成继续显示 `result.finalDamage / referenceMaxHP`（即第一坦分支）不变。

- [ ] **Step 8.1：补辅助 import**

确认文件顶部已 import：`useTimelineStore`（已有）、jobs/role 相关（若要显示 job 图标，需要 `JOB_ICON` 映射表或现有 icon util。先用 `job` 文字占位，图标后续迭代。）

（如项目里已有 `getJobIconUrl` / `JOB_METADATA`，可直接引用；若没有则先用文字 badge。）

- [ ] **Step 8.2：插入 per-victim 块**

在 `{/* HP 条（编辑模式） */}` 上方（当前大约 L186–187 之间）新增：

```tsx
{
  /* per-tank 预估（仅多坦路径产出） */
}
{
  result.perVictim && result.perVictim.length >= 1 && (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">坦克承伤预估</div>
      <div className="space-y-1">
        {result.perVictim.map(v => {
          const playerMeta = timeline.composition.players.find(p => p.id === v.playerId)
          const label = playerMeta ? playerMeta.job : `P${v.playerId}`
          return (
            <div
              key={v.playerId}
              className="flex items-center justify-between text-xs tabular-nums rounded-md border px-2 py-1"
            >
              <span className="text-muted-foreground">{label}</span>
              <span>
                <span className="font-medium text-red-500">{v.finalDamage.toLocaleString()}</span>
                <span className="text-muted-foreground ml-1">
                  ({v.mitigationPercentage.toFixed(1)}%)
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 8.3：类型 / lint / 格式**

Run: `pnpm exec tsc --noEmit && pnpm lint src/components/PropertyPanel.tsx`
Expected: 无 error。

- [ ] **Step 8.4：手动 QA**

开发服务器（用户已启动）中：

1. 打开一个有 2 个坦克的时间轴，定位到一条 tankbuster
2. 确认 PropertyPanel 右栏在 HP 条上方出现"坦克承伤预估"块，列出两行（顺序同 composition）
3. 给其中一坦挂一个 self-only buff（如铁壁），另一坦不挂 → 两行数值应当不同
4. 切到一条 aoe 事件 → 该块不显示
5. 切到单坦时间轴 → 该块只显示一行

- [ ] **Step 8.5：Commit**

```bash
git add src/components/PropertyPanel.tsx
git commit -m "feat(property-panel): 展示坦专事件每坦克的承伤预估"
```

---

## Task 9: 全量质量门禁 + 手动 E2E

**Files:** N/A

- [ ] **Step 9.1：全量测试**

Run: `pnpm test:run`
Expected: 绿。

- [ ] **Step 9.2：类型 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 无 error（warning 可审阅后决定）。

- [ ] **Step 9.3：构建兜底**

Run: `pnpm build`
Expected: 成功。

- [ ] **Step 9.4：手动 QA 覆盖**

在 dev 环境走一遍：

1. 从 FFLogs 导入一个带双坦的副本 → 选择任意 tankbuster 事件 → 展示两行，顺序与 composition 一致
2. 给 MT 挂"战栗（maxHP 1.2×）"→ MT 行 HP 条上的 `referenceMaxHP` 与 OT 不同（面板里 HP 条仍取 MT 分支即第一坦）
3. 给 OT 挂"死斗" → OT 行 finalDamage 应远低于 MT 行
4. 切换到 aoe 事件 → per-victim 块消失，旧面板正常
5. 单坦时间轴 → per-victim 块只显示 1 行，数值与旧版等价
6. 回放模式（`isReplayMode=true`）→ per-victim 未注入，使用原有 `playerDamageDetails` 路径（无回归）

- [ ] **Step 9.5：记录已知折中 / 后续议题**

在 `design/superpowers/specs/2026-04-21-tank-mode-multi-victim-calculation-design.md`的"已知折中"段落里若发现新副作用，更新一笔。否则跳过。

- [ ] **Step 9.6：（可选）打 tag commit / 等用户授权再 merge**

不主动 commit。用户要发布时再决定。

---

## 自查（写计划后）

- [x] **Spec coverage**：spec §1–7 全部映射到 Task 1–8；测试 §对应 Task 2 + Task 5 + Task 6
- [x] **Placeholder scan**：无 TBD / "implement later" / 空 step
- [x] **Type consistency**：`CalculateOptions.tankPlayerIds` / `CalculationResult.perVictim` / `PerTankResult` 在 Task 3 定义，Task 5/7/8 引用；字段名一致
- [x] **Spec 新副作用已在 Task 5/6 的 case 里兜住**：第一坦 state 持久化、partywide 盾消耗、maxHP 个性化
