# HP 模拟实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在编辑模式下建立非坦聚合 HP 池累积模拟器，包含双形态治疗 Executor、partial 段累积语义、`maxHP` buff 同步伸缩与 PropertyPanel 累积视角 UI；治疗倍率累乘只消费 `!meta.isTankOnly` 的 status；回放模式永远不参与。

**Architecture:** HP 池作为 `PartyState.hp` 字段，与 status 一起在 `MitigationCalculator.simulate` 单次扫描中演化。治疗 executor（`createHealExecutor` 一次性 / `createRegenExecutor` HoT）与 buff/shield executor 形态对齐，HoT 复用 `StatusExecutor.onTick` 网格。PropertyPanel 阶段 1 改造 `renderHpBar` 为累积视角，主轨道 HP 曲线 / 治疗 cast 详情面板作为后续增量。

**Tech Stack:** TypeScript 5.9 / Vitest 4 / React 19 / Zustand 5 / nanoid

**Spec:** `design/superpowers/specs/2026-04-28-hp-simulate-design.md`

**提交约定：** 提交信息禁止包含 "Claude" 字样（`.husky/commit-msg` hook 会拒绝）；不加 Co-Authored-By。`.husky/pre-commit` 通过 lint-staged 自动跑 Prettier / ESLint / tsc。每个任务收尾跑 `pnpm test:run <pat>` 验证局部用例后再 commit。

---

## File Structure

| 文件                                        | 操作 | 职责                                                                                                                          |
| ------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/types/partyState.ts`                   | 修改 | 加 `HpPool` 类型与 `PartyState.hp` 可选字段                                                                                   |
| `src/types/status.ts`                       | 修改 | `PerformanceType` 加 `selfHeal`；`StatusTickContext` 加 `recordHeal` sink                                                     |
| `src/types/mitigation.ts`                   | 修改 | `ActionExecutionContext` 加 `castEventId` 与 `recordHeal` sink                                                                |
| `src/types/healSnapshot.ts`                 | 新建 | `HealSnapshot` 接口                                                                                                           |
| `src/executors/healMath.ts`                 | 新建 | `computeFinalHeal` / `computeMaxHpMultiplier`（含 `isTankOnly` 过滤）                                                         |
| `src/executors/healMath.test.ts`            | 新建 | 治疗倍率与 maxHP 倍率单元测试                                                                                                 |
| `src/executors/createHealExecutor.ts`       | 新建 | 一次性治疗 executor 工厂                                                                                                      |
| `src/executors/createHealExecutor.test.ts`  | 新建 | 一次性治疗单元测试                                                                                                            |
| `src/executors/createRegenExecutor.ts`      | 新建 | HoT executor 工厂 + onTick 处理器导出                                                                                         |
| `src/executors/createRegenExecutor.test.ts` | 新建 | HoT 单元测试                                                                                                                  |
| `src/executors/index.ts`                    | 修改 | 导出新 executor 工厂                                                                                                          |
| `src/utils/mitigationCalculator.ts`         | 修改 | `simulate` 主循环 hp 演化、`HpSimulationSnapshot` / `SimulateOutput.healSnapshots`、`applyDamageToHp` / `recomputeHpMax` 嵌入 |
| `src/utils/mitigationCalculator.test.ts`    | 修改 | partial 段、治疗、maxHP buff、overkill 等用例                                                                                 |
| `src/hooks/useDamageCalculation.ts`         | 修改 | 透传 `healSnapshots`；返回类型扩展                                                                                            |
| `src/hooks/useDamageCalculation.test.ts`    | 修改 | 端到端用例：partial 段 + cast 治疗 + HoT                                                                                      |
| `src/components/PropertyPanel.tsx`          | 修改 | `renderHpBar` 累积视角；partial seg 展示；溢出口径切换                                                                        |
| `src/data/mitigationActions.ts`             | 修改 | 治疗类 action 挂 executor（最小可行集合）                                                                                     |
| `src/data/statusExtras.ts`                  | 修改 | HoT statusId 注册 `regenStatusExecutor`                                                                                       |

---

## Task 1: 类型基础设施

> 一次性扩展所有类型，向后兼容（新字段都可选）。这一步不动行为，只把后续任务依赖的类型先就位。

**Files:**

- Modify: `src/types/partyState.ts`
- Modify: `src/types/status.ts`
- Modify: `src/types/mitigation.ts`
- Create: `src/types/healSnapshot.ts`
- Modify: `src/utils/mitigationCalculator.ts`（仅扩展 `CalculationResult` / `SimulateOutput` 类型）

- [ ] **Step 1: 新建 `src/types/healSnapshot.ts`**

```ts
/**
 * 治疗事件快照（一次性 cast / HoT tick 各产出一条）
 *
 * 由 MitigationCalculator.simulate 内部收集，写入 SimulateOutput.healSnapshots。
 * UI 后续消费（治疗 cast 详情面板 / 治疗效率统计），本期不直接渲染。
 */
export interface HealSnapshot {
  /** 触发治疗的 cast event id */
  castEventId: string
  /** 触发治疗的 actionId（一次性 cast = 自身 actionId；HoT tick = HoT status 的 sourceActionId） */
  actionId: number
  /** 触发玩家 ID（cast.sourcePlayerId） */
  sourcePlayerId: number
  /** 治疗发生时刻（cast 时刻 / tick 时刻），秒 */
  time: number
  /** 基础治疗量（statistics 或 fixedAmount） */
  baseAmount: number
  /** 应用 heal/selfHeal 倍率后的目标治疗量 */
  finalHeal: number
  /** 实际加进 hp 的量（受 hp.max - hp.current clamp 限制） */
  applied: number
  /** 溢出治疗量 = finalHeal - applied */
  overheal: number
  /** 是否 HoT tick（false = 一次性 cast） */
  isHotTick: boolean
}
```

- [ ] **Step 2: 修改 `src/types/partyState.ts` 加 `HpPool` 与 `hp` 字段**

把整个文件替换为：

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
 */
export interface HpPool {
  /** 当前 HP，clamp 到 [0, max] */
  current: number
  /** 当前上限 = base × ∏(active 非坦专 maxHP buff) */
  max: number
  /** 基线上限（不含 maxHP buff）；buff attach/expire 时按比例伸缩 current */
  base: number
  /** partial 段累积器：段内已观察到的最大 finalDamage */
  segMax: number
  /** 是否处于 partial 段内（aoe / pfaoe 收尾或时间轴起始时为 false） */
  inSegment: boolean
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
}
```

- [ ] **Step 3: 修改 `src/types/status.ts` `PerformanceType` 加 `selfHeal`**

定位到 `PerformanceType` 类型定义（约第 19-24 行），整体替换为：

```ts
/**
 * 减伤表现：在 3rd party 的 physics/magic/darkness 基础上新增 heal / selfHeal / maxHP
 * (1 = 无影响；< 1 减伤；此处复用同一套乘算口径)
 */
export type PerformanceType = ExternalPerformanceType & {
  /** 治疗增益倍率（全队作用域），缺省视为 1 */
  heal?: number
  /**
   * 自身治疗增益倍率，缺省视为 1
   *
   * 仅当 status.sourcePlayerId === healCast.sourcePlayerId 时参与累乘
   * ——即"该 buff 的持有者亲自施法治疗"才生效。
   */
  selfHeal?: number
  /** 最大 HP 倍率（> 1 增益；例如 1.1 = +10% HP），缺省视为 1 */
  maxHP?: number
}
```

- [ ] **Step 4: 修改 `src/types/status.ts` `StatusTickContext` 加 `recordHeal`**

定位到 `StatusTickContext`（约第 199-205 行），整体替换为：

```ts
/**
 * onTick 上下文（周期性脉冲）
 *
 * driver 在 `t % 3 === 0` 的整秒时间点统一触发所有活跃状态的 onTick；
 * tickTime 是这次 tick 的绝对时间（秒）。
 */
export interface StatusTickContext {
  status: MitigationStatus
  tickTime: number
  partyState: PartyState
  /** 时间轴内部统计数据，可选 */
  statistics?: TimelineStatData
  /** simulator 注入的治疗 snapshot 收集器；HoT 的 onTick 通过它记录每次 tick 的 HealSnapshot */
  recordHeal?: (snap: import('./healSnapshot').HealSnapshot) => void
}
```

- [ ] **Step 5: 修改 `src/types/mitigation.ts` `ActionExecutionContext` 加 `castEventId` 与 `recordHeal`**

定位到 `ActionExecutionContext`（约第 56-67 行），整体替换为：

```ts
/**
 * 技能执行器上下文
 */
export interface ActionExecutionContext {
  /** 技能 ID */
  actionId: number
  /** 使用时间（秒） */
  useTime: number
  /** 当前小队状态 */
  partyState: PartyState
  /** 使用技能的玩家 ID（对应 FFLogsActor.id） */
  sourcePlayerId: number
  /** 时间轴统计数据（可选，用于盾值计算） */
  statistics?: TimelineStatData
  /** 触发本次 executor 的 castEvent.id（治疗 executor 用于 healSnapshot.castEventId） */
  castEventId?: string
  /** simulator 注入的治疗 snapshot 收集器（一次性治疗在 cast 时记录） */
  recordHeal?: (snap: import('./healSnapshot').HealSnapshot) => void
}
```

> **注：** `castEventId` 与 `recordHeal` 都做成可选，避免破坏 `timelineStore.executeAction` 等外部调用方（不路过 simulator 的路径）。

- [ ] **Step 6: 修改 `src/utils/mitigationCalculator.ts` 扩展 `CalculationResult` 与 `SimulateOutput` 类型**

定位到 `CalculationResult`（约第 36-57 行）的末尾，在 `perVictim?` 字段后加入新字段；并新增 `HpSimulationSnapshot` 类型。

```ts
/**
 * HP 池模拟快照（编辑模式非坦事件填充）
 *
 * 坦专事件（tankbuster / auto）走 perVictim 多坦分支，hpSimulation 为 undefined。
 * 回放模式与 hp 池未初始化时同样为 undefined。
 */
export interface HpSimulationSnapshot {
  /** 事件前 HP（cast / HoT 已结算） */
  hpBefore: number
  /** 事件后 HP（已扣段增量 / aoe 全额，clamp 到 [0, max]） */
  hpAfter: number
  /** 当前 HP 上限（含 maxHP buff） */
  hpMax: number
  /** 段内 max（partial 事件填充；非 partial 事件不填） */
  segMax?: number
  /** 溢出伤害 = max(0, 应扣量 - hpBefore)（应扣量：partial = delta、aoe = finalDamage） */
  overkill?: number
}
```

并在 `CalculationResult` 接口里增加：

```ts
  /** HP 池模拟快照；编辑模式下非坦事件填充；坦专 / 回放模式 / hp 缺失时为 undefined */
  hpSimulation?: HpSimulationSnapshot
```

定位到 `SimulateOutput`（约第 111-122 行），加 `healSnapshots`：

```ts
import type { HealSnapshot } from '@/types/healSnapshot'

export interface SimulateOutput {
  damageResults: Map<string, CalculationResult>
  statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
  castEffectiveEndByCastEventId: Map<string, number>
  /** 所有治疗事件（cast + HoT tick）的 snapshot，按 time 升序 */
  healSnapshots: HealSnapshot[]
}
```

> **注：** 这一步还没填充 `healSnapshots`，仅扩展类型；后续 simulate 实现里再产出。先暂时初始化为空数组以保持类型一致：在 simulate 末尾的 return 中加 `healSnapshots: []`（占位，Task 5 实装）。

- [ ] **Step 7: 验证类型检查**

```
pnpm exec tsc --noEmit
```

Expected: 类型检查通过。

- [ ] **Step 8: Commit**

```bash
git add src/types/partyState.ts src/types/status.ts src/types/mitigation.ts src/types/healSnapshot.ts src/utils/mitigationCalculator.ts
git commit -m "feat(types): 加 HP 模拟基础类型（HpPool / PerformanceType.selfHeal / HealSnapshot）"
```

---

## Task 2: healMath 工具与单元测试

> 实现 `computeFinalHeal` 与 `computeMaxHpMultiplier`，含 `isTankOnly` 过滤。这两个函数是 executor / simulator 共享的纯函数。

**Files:**

- Create: `src/executors/healMath.ts`
- Create: `src/executors/healMath.test.ts`

- [ ] **Step 1: 新建 `src/executors/healMath.ts`**

```ts
/**
 * HP 模拟相关的纯函数计算工具
 *
 * 共两组：
 *   - computeFinalHeal：基础治疗量 → 应用 heal / selfHeal buff 倍率后的目标治疗量
 *   - computeMaxHpMultiplier：当前 active maxHP buff 累乘倍率
 *
 * 两者都只消费 !meta.isTankOnly 的 status——HP 池是非坦聚合视角，
 * 坦专 buff（自身减伤 / 坦克自疗 / 坦克 maxHP）不污染非坦池。
 */

import type { PartyState } from '@/types/partyState'
import type { MitigationStatus } from '@/types/status'
import { getStatusById } from '@/utils/statusRegistry'

/**
 * 计算应用所有活跃 heal / selfHeal buff 后的目标治疗量。
 *
 * 公式：
 *   finalHeal = baseAmount × ∏ (active heal[i]) × ∏ (active selfHeal[i] if sourcePlayer 匹配)
 *
 * 仅消费 !meta.isTankOnly 的 status。
 *
 * @param baseAmount 基础治疗量（statistics 或 fixedAmount）
 * @param partyState 当前小队状态（含 statuses）
 * @param castSourcePlayerId 施法玩家 ID
 * @param castTime 治疗发生时刻（cast 时刻 / tick 时刻），秒
 */
export function computeFinalHeal(
  baseAmount: number,
  partyState: PartyState,
  castSourcePlayerId: number,
  castTime: number
): number {
  let multiplier = 1

  for (const status of partyState.statuses) {
    if (status.startTime > castTime || status.endTime <= castTime) continue
    const meta = getStatusById(status.statusId)
    if (!meta) continue
    if (meta.isTankOnly) continue
    const perf = status.performance ?? meta.performance

    if (perf.heal !== undefined && perf.heal !== 1) {
      multiplier *= perf.heal
    }
    if (perf.selfHeal !== undefined && perf.selfHeal !== 1) {
      if (status.sourcePlayerId === castSourcePlayerId) {
        multiplier *= perf.selfHeal
      }
    }
  }

  return baseAmount * multiplier
}

/**
 * 计算当前 active maxHP buff 的累乘倍率。
 *
 * 仅消费 !meta.isTankOnly 的 status：坦专 maxHP buff 不抬升非坦池上限。
 */
export function computeMaxHpMultiplier(statuses: MitigationStatus[], time: number): number {
  let m = 1
  for (const s of statuses) {
    if (s.startTime > time || s.endTime <= time) continue
    const meta = getStatusById(s.statusId)
    if (!meta) continue
    if (meta.isTankOnly) continue
    const perf = s.performance ?? meta.performance
    if (perf.maxHP !== undefined && perf.maxHP !== 1) m *= perf.maxHP
  }
  return m
}
```

- [ ] **Step 2: 新建 `src/executors/healMath.test.ts` 写测试**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computeFinalHeal, computeMaxHpMultiplier } from './healMath'
import type { PartyState } from '@/types/partyState'
import type { MitigationStatus, MitigationStatusMetadata } from '@/types/status'
import { getStatusById } from '@/utils/statusRegistry'

vi.mock('@/utils/statusRegistry', () => ({
  getStatusById: vi.fn(),
}))

const mkStatus = (overrides: Partial<MitigationStatus>): MitigationStatus => ({
  instanceId: 'inst-' + Math.random(),
  statusId: 1,
  startTime: 0,
  endTime: 60,
  ...overrides,
})

const mkMeta = (overrides: Partial<MitigationStatusMetadata>): MitigationStatusMetadata =>
  ({
    id: 1,
    name: 'X',
    isTankOnly: false,
    performance: { physics: 1, magic: 1, darkness: 1 },
    ...overrides,
  }) as MitigationStatusMetadata

const partyStateOf = (statuses: MitigationStatus[]): PartyState => ({
  statuses,
  timestamp: 0,
})

describe('computeFinalHeal', () => {
  beforeEach(() => vi.mocked(getStatusById).mockReset())

  it('无 buff 时返回 baseAmount', () => {
    expect(computeFinalHeal(10000, partyStateOf([]), 1, 5)).toBe(10000)
  })

  it('单个全队 heal buff 累乘', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ performance: { physics: 1, magic: 1, darkness: 1, heal: 1.2 } })
    )
    const ps = partyStateOf([mkStatus({ sourcePlayerId: 2 })])
    expect(computeFinalHeal(10000, ps, 1, 5)).toBe(12000)
  })

  it('selfHeal 仅在 sourcePlayer 匹配时生效', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ performance: { physics: 1, magic: 1, darkness: 1, selfHeal: 1.3 } })
    )
    const ps = partyStateOf([mkStatus({ sourcePlayerId: 7 })])

    // 持有者 cast：×1.3
    expect(computeFinalHeal(10000, ps, 7, 5)).toBe(13000)
    // 非持有者 cast：×1
    expect(computeFinalHeal(10000, ps, 8, 5)).toBe(10000)
  })

  it('heal + selfHeal 同时（持有者 cast）累乘两者', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ performance: { physics: 1, magic: 1, darkness: 1, heal: 1.2, selfHeal: 1.3 } })
    )
    const ps = partyStateOf([mkStatus({ sourcePlayerId: 7 })])
    expect(computeFinalHeal(10000, ps, 7, 5)).toBeCloseTo(15600, 5)
  })

  it('heal + selfHeal 同时（非持有者 cast）只累乘 heal', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ performance: { physics: 1, magic: 1, darkness: 1, heal: 1.2, selfHeal: 1.3 } })
    )
    const ps = partyStateOf([mkStatus({ sourcePlayerId: 7 })])
    expect(computeFinalHeal(10000, ps, 8, 5)).toBe(12000)
  })

  it('isTankOnly buff 永远不参与累乘', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({
        isTankOnly: true,
        performance: { physics: 1, magic: 1, darkness: 1, heal: 1.5, selfHeal: 1.5 },
      })
    )
    const ps = partyStateOf([mkStatus({ sourcePlayerId: 7 })])
    expect(computeFinalHeal(10000, ps, 7, 5)).toBe(10000)
    expect(computeFinalHeal(10000, ps, 8, 5)).toBe(10000)
  })

  it('过期 / 未开始 buff 不参与', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ performance: { physics: 1, magic: 1, darkness: 1, heal: 1.2 } })
    )
    // endTime <= castTime
    const expired = partyStateOf([mkStatus({ endTime: 5 })])
    expect(computeFinalHeal(10000, expired, 1, 5)).toBe(10000)
    // startTime > castTime
    const notYet = partyStateOf([mkStatus({ startTime: 10 })])
    expect(computeFinalHeal(10000, notYet, 1, 5)).toBe(10000)
  })

  it('多个 buff 累乘', () => {
    vi.mocked(getStatusById).mockImplementation((id: number) => {
      if (id === 100)
        return mkMeta({ id: 100, performance: { physics: 1, magic: 1, darkness: 1, heal: 1.2 } })
      if (id === 200)
        return mkMeta({ id: 200, performance: { physics: 1, magic: 1, darkness: 1, heal: 1.1 } })
      return undefined
    })
    const ps = partyStateOf([
      mkStatus({ statusId: 100, sourcePlayerId: 1 }),
      mkStatus({ statusId: 200, sourcePlayerId: 2 }),
    ])
    expect(computeFinalHeal(10000, ps, 3, 5)).toBeCloseTo(13200, 5)
  })
})

describe('computeMaxHpMultiplier', () => {
  beforeEach(() => vi.mocked(getStatusById).mockReset())

  it('无 buff 返回 1', () => {
    expect(computeMaxHpMultiplier([], 5)).toBe(1)
  })

  it('单个 maxHP buff 累乘', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ performance: { physics: 1, magic: 1, darkness: 1, maxHP: 1.1 } })
    )
    expect(computeMaxHpMultiplier([mkStatus({})], 5)).toBeCloseTo(1.1, 5)
  })

  it('isTankOnly maxHP buff 永远不参与', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ isTankOnly: true, performance: { physics: 1, magic: 1, darkness: 1, maxHP: 1.1 } })
    )
    expect(computeMaxHpMultiplier([mkStatus({})], 5)).toBe(1)
  })

  it('过期 buff 不参与', () => {
    vi.mocked(getStatusById).mockReturnValue(
      mkMeta({ performance: { physics: 1, magic: 1, darkness: 1, maxHP: 1.1 } })
    )
    expect(computeMaxHpMultiplier([mkStatus({ endTime: 5 })], 5)).toBe(1)
  })
})
```

- [ ] **Step 3: 跑测试验证通过**

```
pnpm test:run src/executors/healMath.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add src/executors/healMath.ts src/executors/healMath.test.ts
git commit -m "feat(executors): healMath 治疗倍率与 maxHP 累乘工具"
```

---

## Task 3: createHealExecutor 工厂

**Files:**

- Create: `src/executors/createHealExecutor.ts`
- Create: `src/executors/createHealExecutor.test.ts`
- Modify: `src/executors/index.ts`

- [ ] **Step 1: 新建 `src/executors/createHealExecutor.ts`**

```ts
/**
 * 一次性治疗执行器工厂
 *
 * 在 cast.timestamp 时刻立即对 partyState.hp.current 加上 finalHeal，
 * clamp 到 [0, hp.max]，并通过 ctx.recordHeal 记录 HealSnapshot。
 *
 * 不挂状态；不参与 partial 段累积器；HP 已归 0 时仍可治疗（"复活"语义）。
 */

import type { ActionExecutor } from '@/types/mitigation'
import { computeFinalHeal } from './healMath'

export interface HealExecutorOptions {
  /** 固定治疗量；指定时跳过 statistics 读取 */
  fixedAmount?: number
  /**
   * 治疗量来源 actionId，缺省 = ctx.actionId。
   * 罕见场景下（一个 cast 的"治疗效果"绑在另一个 statId 上）使用。
   */
  amountSourceId?: number
}

export function createHealExecutor(options?: HealExecutorOptions): ActionExecutor {
  const fixedAmount = options?.fixedAmount
  const amountSourceId = options?.amountSourceId

  return ctx => {
    if (!ctx.partyState.hp) return ctx.partyState

    const sourceId = amountSourceId ?? ctx.actionId
    const baseAmount = fixedAmount ?? ctx.statistics?.healByAbility?.[sourceId] ?? 0
    if (baseAmount <= 0) return ctx.partyState

    const finalHeal = computeFinalHeal(baseAmount, ctx.partyState, ctx.sourcePlayerId, ctx.useTime)

    const before = ctx.partyState.hp.current
    const next = Math.min(before + finalHeal, ctx.partyState.hp.max)
    const applied = next - before
    const overheal = finalHeal - applied

    ctx.recordHeal?.({
      castEventId: ctx.castEventId ?? '',
      actionId: ctx.actionId,
      sourcePlayerId: ctx.sourcePlayerId,
      time: ctx.useTime,
      baseAmount,
      finalHeal,
      applied,
      overheal,
      isHotTick: false,
    })

    return { ...ctx.partyState, hp: { ...ctx.partyState.hp, current: next } }
  }
}
```

- [ ] **Step 2: 新建 `src/executors/createHealExecutor.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHealExecutor } from './createHealExecutor'
import type { ActionExecutionContext } from '@/types/mitigation'
import type { PartyState, HpPool } from '@/types/partyState'
import type { HealSnapshot } from '@/types/healSnapshot'
import { getStatusById } from '@/utils/statusRegistry'

vi.mock('@/utils/statusRegistry', () => ({ getStatusById: vi.fn() }))

const mkHp = (overrides: Partial<HpPool> = {}): HpPool => ({
  current: 100000,
  max: 100000,
  base: 100000,
  segMax: 0,
  inSegment: false,
  ...overrides,
})

const mkCtx = (overrides: Partial<ActionExecutionContext> = {}): ActionExecutionContext => ({
  actionId: 1,
  useTime: 5,
  sourcePlayerId: 7,
  partyState: { statuses: [], timestamp: 0, hp: mkHp() } as PartyState,
  ...overrides,
})

describe('createHealExecutor', () => {
  beforeEach(() => vi.mocked(getStatusById).mockReset())

  it('hp 未初始化时直接返回原 state', () => {
    const exec = createHealExecutor({ fixedAmount: 5000 })
    const ctx = mkCtx({ partyState: { statuses: [], timestamp: 0 } })
    const next = exec(ctx)
    expect(next).toBe(ctx.partyState)
  })

  it('一次性治疗 +amount 到 hp.current', () => {
    const exec = createHealExecutor({ fixedAmount: 15000 })
    const ctx = mkCtx({ partyState: { statuses: [], timestamp: 0, hp: mkHp({ current: 50000 }) } })
    const next = exec(ctx)
    expect(next.hp!.current).toBe(65000)
  })

  it('治疗 clamp 到 hp.max（满血时 applied=0、overheal=finalHeal）', () => {
    const snaps: HealSnapshot[] = []
    const exec = createHealExecutor({ fixedAmount: 20000 })
    const ctx = mkCtx({
      partyState: { statuses: [], timestamp: 0, hp: mkHp({ current: 90000 }) },
      recordHeal: snap => snaps.push(snap),
      castEventId: 'cast-1',
    })
    const next = exec(ctx)
    expect(next.hp!.current).toBe(100000)
    expect(snaps).toHaveLength(1)
    expect(snaps[0]).toMatchObject({
      castEventId: 'cast-1',
      baseAmount: 20000,
      finalHeal: 20000,
      applied: 10000,
      overheal: 10000,
      isHotTick: false,
    })
  })

  it('hp=0 时 cast 治疗仍能加血（"复活"语义）', () => {
    const exec = createHealExecutor({ fixedAmount: 30000 })
    const ctx = mkCtx({ partyState: { statuses: [], timestamp: 0, hp: mkHp({ current: 0 }) } })
    const next = exec(ctx)
    expect(next.hp!.current).toBe(30000)
  })

  it('baseAmount=0 时跳过（无 statistics 且无 fixedAmount）', () => {
    const exec = createHealExecutor()
    const ctx = mkCtx()
    const next = exec(ctx)
    expect(next.hp!.current).toBe(100000) // 不变
  })

  it('amountSourceId 覆盖 ctx.actionId 取 statistics 值', () => {
    const exec = createHealExecutor({ amountSourceId: 999 })
    const ctx = mkCtx({
      actionId: 1,
      partyState: { statuses: [], timestamp: 0, hp: mkHp({ current: 50000 }) },
      statistics: {
        shieldByAbility: {},
        critShieldByAbility: {},
        healByAbility: { 1: 5000, 999: 12000 },
        critHealByAbility: {},
      },
    })
    const next = exec(ctx)
    expect(next.hp!.current).toBe(62000) // 50k + 12k（取 999 不取 1）
  })
})
```

- [ ] **Step 3: 跑测试**

```
pnpm test:run src/executors/createHealExecutor.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 4: 修改 `src/executors/index.ts` 导出新 executor**

在文件顶部 export 区域加：

```ts
export { createHealExecutor } from './createHealExecutor'
export type { HealExecutorOptions } from './createHealExecutor'
```

- [ ] **Step 5: 验证类型检查 + 全量测试**

```
pnpm exec tsc --noEmit
pnpm test:run
```

Expected: 类型检查通过；现有测试全部 PASS（新加的 healMath / createHealExecutor 测试也 PASS）。

- [ ] **Step 6: Commit**

```bash
git add src/executors/createHealExecutor.ts src/executors/createHealExecutor.test.ts src/executors/index.ts
git commit -m "feat(executors): createHealExecutor 一次性治疗"
```

---

## Task 4: createRegenExecutor 工厂 + HoT onTick handler

> 治疗 HoT 由 cast 时挂状态 + 状态自身 onTick 钩子产出 tick 治疗组成。`tickAmount` 在 cast 时 snapshot；`castEventId` 写进 `status.data` 供 tick 反向溯源。

**Files:**

- Create: `src/executors/createRegenExecutor.ts`
- Create: `src/executors/createRegenExecutor.test.ts`
- Modify: `src/executors/index.ts`

- [ ] **Step 1: 新建 `src/executors/createRegenExecutor.ts`**

```ts
/**
 * HoT 治疗执行器工厂
 *
 * - cast 时挂状态（带 snapshot 的 tickAmount 与 castEventId 写进 status.data）
 * - HoT 通过 regenStatusExecutor.onTick 在每个 3s 网格触发治疗
 *
 * tickAmount 走 snapshot-on-apply：cast 时刻按当时 active 的 heal/selfHeal buff 算一次，
 * 之后的 tick 直接读 snapshot，不再随后挂 buff 变化。
 */

import type { ActionExecutor } from '@/types/mitigation'
import type { MitigationStatus, StatusExecutor } from '@/types/status'
import { computeFinalHeal } from './healMath'
import { generateId } from './utils'

export interface RegenExecutorOptions {
  /** 互斥组：默认 [statusId] */
  uniqueGroup?: number[]
  /**
   * 每个 tick 的固定治疗量。
   * 不指定 → tickAmount = healByAbility[statusId] / floor(duration / 3)
   *         （"全 duration 收满 healByAbility 总量"为锚）
   */
  tickAmount?: number
}

export function createRegenExecutor(
  statusId: number,
  duration: number,
  options?: RegenExecutorOptions
): ActionExecutor {
  const uniqueGroup = options?.uniqueGroup ?? [statusId]

  return ctx => {
    const totalTicks = Math.floor(duration / 3)
    const baseTickAmount =
      options?.tickAmount ??
      (totalTicks > 0 ? (ctx.statistics?.healByAbility?.[statusId] ?? 0) / totalTicks : 0)
    const snapshotTickAmount = computeFinalHeal(
      baseTickAmount,
      ctx.partyState,
      ctx.sourcePlayerId,
      ctx.useTime
    )

    const filteredStatuses = ctx.partyState.statuses.filter(s => !uniqueGroup.includes(s.statusId))

    const newStatus: MitigationStatus = {
      instanceId: generateId(),
      statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      sourceActionId: ctx.actionId,
      sourcePlayerId: ctx.sourcePlayerId,
      data: { tickAmount: snapshotTickAmount, castEventId: ctx.castEventId ?? '' },
    }

    return {
      ...ctx.partyState,
      statuses: [...filteredStatuses, newStatus],
    }
  }
}

/**
 * HoT 状态自带的 onTick：每 3s 网格 +tickAmount 到 hp.current，clamp 到 hp.max。
 *
 * 在 STATUS_EXTRAS 中给所有 HoT statusId 注册此 executor 即可。
 */
export const regenStatusExecutor: StatusExecutor = {
  onTick: ctx => {
    if (!ctx.partyState.hp) return
    const tickAmount = (ctx.status.data?.tickAmount as number | undefined) ?? 0
    if (tickAmount <= 0) return

    const before = ctx.partyState.hp.current
    const next = Math.min(before + tickAmount, ctx.partyState.hp.max)
    const applied = next - before
    const overheal = tickAmount - applied

    ctx.recordHeal?.({
      castEventId: (ctx.status.data?.castEventId as string | undefined) ?? '',
      actionId: ctx.status.sourceActionId ?? 0,
      sourcePlayerId: ctx.status.sourcePlayerId ?? 0,
      time: ctx.tickTime,
      baseAmount: tickAmount,
      finalHeal: tickAmount,
      applied,
      overheal,
      isHotTick: true,
    })

    return { ...ctx.partyState, hp: { ...ctx.partyState.hp, current: next } }
  },
}
```

- [ ] **Step 2: 新建 `src/executors/createRegenExecutor.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRegenExecutor, regenStatusExecutor } from './createRegenExecutor'
import type { ActionExecutionContext } from '@/types/mitigation'
import type { PartyState, HpPool } from '@/types/partyState'
import type { MitigationStatus, StatusTickContext } from '@/types/status'
import type { HealSnapshot } from '@/types/healSnapshot'
import { getStatusById } from '@/utils/statusRegistry'

vi.mock('@/utils/statusRegistry', () => ({ getStatusById: vi.fn() }))

const mkHp = (overrides: Partial<HpPool> = {}): HpPool => ({
  current: 100000,
  max: 100000,
  base: 100000,
  segMax: 0,
  inSegment: false,
  ...overrides,
})

const mkCtx = (overrides: Partial<ActionExecutionContext> = {}): ActionExecutionContext => ({
  actionId: 100,
  useTime: 0,
  sourcePlayerId: 7,
  partyState: { statuses: [], timestamp: 0, hp: mkHp() } as PartyState,
  ...overrides,
})

describe('createRegenExecutor (cast 时挂状态)', () => {
  beforeEach(() => vi.mocked(getStatusById).mockReset())

  it('挂状态：startTime / endTime / sourceActionId / sourcePlayerId 正确', () => {
    const exec = createRegenExecutor(500, 30, { tickAmount: 1000 })
    const ctx = mkCtx({ useTime: 5, actionId: 100, sourcePlayerId: 7 })
    const next = exec(ctx)
    expect(next.statuses).toHaveLength(1)
    expect(next.statuses[0]).toMatchObject({
      statusId: 500,
      startTime: 5,
      endTime: 35,
      sourceActionId: 100,
      sourcePlayerId: 7,
    })
  })

  it('snapshot tickAmount 写进 status.data', () => {
    const exec = createRegenExecutor(500, 30, { tickAmount: 1000 })
    const ctx = mkCtx({ castEventId: 'cast-x' })
    const next = exec(ctx)
    expect(next.statuses[0].data).toEqual({
      tickAmount: 1000,
      castEventId: 'cast-x',
    })
  })

  it('snapshot 在 cast 时锁定 heal buff（之后挂的 buff 不影响 tickAmount）', () => {
    vi.mocked(getStatusById).mockReturnValue({
      id: 999,
      name: 'X',
      isTankOnly: false,
      performance: { physics: 1, magic: 1, darkness: 1, heal: 1.2 },
    } as never)

    // cast 时已存在一个 heal=1.2 buff
    const partyState: PartyState = {
      statuses: [
        {
          instanceId: 'b1',
          statusId: 999,
          startTime: 0,
          endTime: 60,
          sourcePlayerId: 7,
        },
      ],
      timestamp: 0,
      hp: mkHp(),
    }
    const exec = createRegenExecutor(500, 30, { tickAmount: 1000 })
    const next = exec(mkCtx({ partyState, useTime: 5 }))
    expect(next.statuses.find(s => s.statusId === 500)!.data!.tickAmount).toBeCloseTo(1200, 5)
  })

  it('uniqueGroup 删除已有同组状态再挂新状态', () => {
    const partyState: PartyState = {
      statuses: [{ instanceId: 'old', statusId: 500, startTime: 0, endTime: 30 }],
      timestamp: 0,
      hp: mkHp(),
    }
    const exec = createRegenExecutor(500, 30, { tickAmount: 1000 })
    const next = exec(mkCtx({ partyState, useTime: 10 }))
    expect(next.statuses).toHaveLength(1)
    expect(next.statuses[0].instanceId).not.toBe('old')
  })

  it('未指定 tickAmount 时按 healByAbility / floor(duration/3) 推导', () => {
    const exec = createRegenExecutor(500, 30) // 30s = 10 ticks
    const ctx = mkCtx({
      statistics: {
        shieldByAbility: {},
        critShieldByAbility: {},
        healByAbility: { 500: 50000 },
        critHealByAbility: {},
      },
    })
    const next = exec(ctx)
    expect(next.statuses[0].data!.tickAmount).toBeCloseTo(5000, 5) // 50k / 10
  })
})

describe('regenStatusExecutor.onTick', () => {
  const mkTickCtx = (overrides: Partial<StatusTickContext> = {}): StatusTickContext => ({
    status: {
      instanceId: 'inst-1',
      statusId: 500,
      startTime: 0,
      endTime: 30,
      sourceActionId: 100,
      sourcePlayerId: 7,
      data: { tickAmount: 5000, castEventId: 'cast-x' },
    } as MitigationStatus,
    tickTime: 3,
    partyState: { statuses: [], timestamp: 3, hp: mkHp({ current: 80000 }) } as PartyState,
    ...overrides,
  })

  it('每 tick +tickAmount 到 hp.current', () => {
    const ctx = mkTickCtx()
    const next = regenStatusExecutor.onTick!(ctx)!
    expect((next as PartyState).hp!.current).toBe(85000)
  })

  it('hp 满血时 applied=0、overheal=tickAmount，仍记录 snapshot', () => {
    const snaps: HealSnapshot[] = []
    const ctx = mkTickCtx({
      partyState: { statuses: [], timestamp: 3, hp: mkHp({ current: 100000 }) } as PartyState,
      recordHeal: s => snaps.push(s),
    })
    regenStatusExecutor.onTick!(ctx)
    expect(snaps).toHaveLength(1)
    expect(snaps[0]).toMatchObject({
      isHotTick: true,
      applied: 0,
      overheal: 5000,
      finalHeal: 5000,
      castEventId: 'cast-x',
    })
  })

  it('hp 未初始化时不动', () => {
    const ctx = mkTickCtx({
      partyState: { statuses: [], timestamp: 3 } as PartyState,
    })
    expect(regenStatusExecutor.onTick!(ctx)).toBeUndefined()
  })

  it('tickAmount 缺失时不动', () => {
    const ctx = mkTickCtx({
      status: {
        instanceId: 'inst-1',
        statusId: 500,
        startTime: 0,
        endTime: 30,
        data: {},
      } as MitigationStatus,
    })
    expect(regenStatusExecutor.onTick!(ctx)).toBeUndefined()
  })
})
```

- [ ] **Step 3: 跑测试**

```
pnpm test:run src/executors/createRegenExecutor.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 4: 修改 `src/executors/index.ts` 导出**

```ts
export { createRegenExecutor, regenStatusExecutor } from './createRegenExecutor'
export type { RegenExecutorOptions } from './createRegenExecutor'
```

- [ ] **Step 5: 验证 + Commit**

```
pnpm exec tsc --noEmit
pnpm test:run src/executors
```

Expected: 通过。

```bash
git add src/executors/createRegenExecutor.ts src/executors/createRegenExecutor.test.ts src/executors/index.ts
git commit -m "feat(executors): createRegenExecutor 与 HoT onTick 处理"
```

---

## Task 5: 模拟器主循环集成

> 把 hp 池演化、partial 段累积、maxHP buff 同步、healSnapshots 收集、hpSimulation 填充全部嵌入 `MitigationCalculator.simulate`。这是最大一步，按测试驱动逐子能力推进。

**Files:**

- Modify: `src/utils/mitigationCalculator.ts`
- Modify: `src/utils/mitigationCalculator.test.ts`

> 实施前先 `Read` `src/utils/mitigationCalculator.ts` 完整文件，理解现有 `simulate` 主循环结构（cast / damage / tick / expire 的事件合并与排序）。新逻辑应嵌入既有循环，不重写。

- [ ] **Step 1: 先写 partial 段累积测试（红）**

在 `src/utils/mitigationCalculator.test.ts` 末尾添加 `describe('HP 池演化 - partial 段累积', ...)`：

```ts
import { MitigationCalculator } from './mitigationCalculator'
import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'

const mkDmg = (
  id: string,
  time: number,
  type: DamageEvent['type'],
  damage: number
): DamageEvent => ({
  id,
  name: id,
  time,
  damage,
  type,
  damageType: 'magical',
})

describe('HP 池演化 - partial 段累积', () => {
  const baseInitialState: PartyState = { statuses: [], timestamp: 0 }

  it('段内每次扣 max 增量；pfaoe 触发段结束', () => {
    const calculator = new MitigationCalculator()
    const damageEvents = [
      mkDmg('A', 10, 'aoe', 20000),
      mkDmg('B', 15, 'partial_aoe', 15000),
      mkDmg('D', 22, 'partial_aoe', 22000),
      mkDmg('E', 25, 'partial_aoe', 18000),
      mkDmg('G', 30, 'partial_final_aoe', 30000),
      mkDmg('I', 40, 'partial_aoe', 12000),
      mkDmg('J', 43, 'partial_aoe', 14000),
      mkDmg('L', 50, 'partial_aoe', 20000),
    ]
    const out = calculator.simulate({
      castEvents: [],
      damageEvents,
      initialState: baseInitialState,
      baseReferenceMaxHPForAoe: 100000,
    })
    const r = (id: string) => out.damageResults.get(id)!.hpSimulation!
    expect(r('A').hpAfter).toBe(80000)
    expect(r('B').hpAfter).toBe(65000)
    expect(r('D').hpAfter).toBe(58000)
    expect(r('E').hpAfter).toBe(58000) // 增量 0
    expect(r('G').hpAfter).toBe(28000) // 段尾 + pfaoe 自身（先扣 segMax 增量再扣自身）
    expect(r('I').hpAfter).toBe(16000)
    expect(r('J').hpAfter).toBe(14000)
    expect(r('L').hpAfter).toBe(8000)
  })

  it('aoe 中段插入打断 partial 段', () => {
    const calculator = new MitigationCalculator()
    const damageEvents = [
      mkDmg('X1', 5, 'partial_aoe', 20000),
      mkDmg('X2', 10, 'partial_aoe', 25000),
      mkDmg('X3', 15, 'aoe', 30000), // 段被打断
      mkDmg('X4', 20, 'partial_aoe', 15000), // 新段
      mkDmg('X5', 25, 'partial_final_aoe', 28000),
    ]
    const out = calculator.simulate({
      castEvents: [],
      damageEvents,
      initialState: baseInitialState,
      baseReferenceMaxHPForAoe: 100000,
    })
    const r = (id: string) => out.damageResults.get(id)!.hpSimulation!
    expect(r('X1').hpAfter).toBe(80000)
    expect(r('X2').hpAfter).toBe(75000)
    expect(r('X3').hpAfter).toBe(45000) // aoe 全额扣 30k
    expect(r('X4').hpAfter).toBe(30000)
    expect(r('X5').hpAfter).toBe(17000)
  })

  it('tankbuster / auto 段穿透；tankbuster 接 partial_aoe 段不被打断', () => {
    const calculator = new MitigationCalculator()
    const damageEvents = [
      mkDmg('p1', 5, 'partial_aoe', 20000),
      mkDmg('t1', 10, 'tankbuster', 50000),
      mkDmg('p2', 15, 'partial_aoe', 25000), // 段未被打断 → 增量 5k
    ]
    const out = calculator.simulate({
      castEvents: [],
      damageEvents,
      initialState: baseInitialState,
      baseReferenceMaxHPForAoe: 100000,
    })
    expect(out.damageResults.get('p1')!.hpSimulation!.hpAfter).toBe(80000)
    expect(out.damageResults.get('t1')!.hpSimulation).toBeUndefined() // 坦专不填
    expect(out.damageResults.get('p2')!.hpSimulation!.hpAfter).toBe(75000)
  })

  it('overkill：aoe finalDamage > hp.current 时 hp clamp 到 0', () => {
    const calculator = new MitigationCalculator()
    const damageEvents = [
      mkDmg('A', 5, 'aoe', 50000),
      mkDmg('B', 10, 'aoe', 80000), // 50k 剩余 -80k → clamp 0
    ]
    const out = calculator.simulate({
      castEvents: [],
      damageEvents,
      initialState: baseInitialState,
      baseReferenceMaxHPForAoe: 100000,
    })
    const r = out.damageResults.get('B')!.hpSimulation!
    expect(r.hpAfter).toBe(0)
    expect(r.overkill).toBe(30000)
  })

  it('段未收尾时 EOF 不强制结算', () => {
    const calculator = new MitigationCalculator()
    const damageEvents = [
      mkDmg('p1', 5, 'partial_aoe', 20000),
      mkDmg('p2', 10, 'partial_aoe', 30000),
      // EOF
    ]
    const out = calculator.simulate({
      castEvents: [],
      damageEvents,
      initialState: baseInitialState,
      baseReferenceMaxHPForAoe: 100000,
    })
    expect(out.damageResults.get('p2')!.hpSimulation!.hpAfter).toBe(70000) // 100 - 30
  })
})
```

跑测试，验证全部失败（hpSimulation 还没填）：

```
pnpm test:run src/utils/mitigationCalculator.test.ts -t "HP 池演化"
```

Expected: 全部 FAIL（`hpSimulation is undefined` 类错误）。

- [ ] **Step 2: 在 `mitigationCalculator.ts` 顶部加导入**

```ts
import type { HpPool, PartyState } from '@/types/partyState'
import type { HealSnapshot } from '@/types/healSnapshot'
import { computeMaxHpMultiplier } from '@/executors/healMath'
```

- [ ] **Step 3: 实现 `applyDamageToHp` 内部辅助函数**

在 `MitigationCalculator` class 内部（建议放在 `simulate` 方法之上）添加私有方法：

```ts
  /**
   * 按事件类型扣 HP 池，处理 partial 段累积。
   * 返回新的 PartyState（hp 字段更新）与本次产出的 HpSimulationSnapshot。
   * 坦专事件（tankbuster / auto）不入池，snapshot 为 undefined。
   */
  private applyDamageToHp(
    state: PartyState,
    ev: DamageEvent,
    finalDamage: number
  ): { nextState: PartyState; snapshot?: HpSimulationSnapshot } {
    if (!state.hp) return { nextState: state }
    const hp = state.hp

    if (ev.type === 'tankbuster' || ev.type === 'auto') {
      return { nextState: state }
    }

    const before = hp.current
    let nextCurrent = hp.current
    let nextSegMax = hp.segMax
    let nextInSegment = hp.inSegment
    let dealt = 0
    let snapshotSegMax: number | undefined

    if (ev.type === 'aoe') {
      dealt = finalDamage
      nextCurrent -= finalDamage
      nextSegMax = 0
      nextInSegment = false
    } else if (ev.type === 'partial_aoe' || ev.type === 'partial_final_aoe') {
      if (!nextInSegment) {
        nextSegMax = 0
        nextInSegment = true
      }
      dealt = Math.max(0, finalDamage - nextSegMax)
      nextCurrent -= dealt
      nextSegMax = Math.max(nextSegMax, finalDamage)
      snapshotSegMax = nextSegMax
      if (ev.type === 'partial_final_aoe') {
        nextInSegment = false
      }
    }

    const overkill = Math.max(0, dealt - before)
    nextCurrent = Math.max(0, Math.min(nextCurrent, hp.max))

    return {
      nextState: {
        ...state,
        hp: { ...hp, current: nextCurrent, segMax: nextSegMax, inSegment: nextInSegment },
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

  /**
   * 重算 hp.max（按 active 非坦专 maxHP buff 累乘），按比例同步伸缩 hp.current。
   * 在每次 status mutation（applyExecutor / advanceToTime expire / onConsume）后调用。
   */
  private recomputeHpMax(state: PartyState): PartyState {
    if (!state.hp) return state
    const newMultiplier = computeMaxHpMultiplier(state.statuses, state.timestamp)
    const prevMultiplier = state.hp.max / state.hp.base
    if (Math.abs(newMultiplier - prevMultiplier) < 1e-9) return state

    const ratio = newMultiplier / prevMultiplier
    const newMax = state.hp.base * newMultiplier
    const newCurrent = Math.max(0, Math.min(state.hp.current * ratio, newMax))

    return { ...state, hp: { ...state.hp, current: newCurrent, max: newMax } }
  }
```

- [ ] **Step 4: 在 `simulate` 入口初始化 `hp` 池**

定位到 `simulate` 方法（约第 252 行）。在解构 `input` 后、初始化 state 前加：

```ts
const initialHpPool: HpPool = {
  current: baseReferenceMaxHPForAoe,
  max: baseReferenceMaxHPForAoe,
  base: baseReferenceMaxHPForAoe,
  segMax: 0,
  inSegment: false,
}

const initialStateWithHp: PartyState = {
  ...initialState,
  hp: baseReferenceMaxHPForAoe > 0 ? initialHpPool : undefined,
}

const healSnapshots: HealSnapshot[] = []
const recordHeal = (snap: HealSnapshot) => healSnapshots.push(snap)
```

把后续 simulate 主循环里使用的 `state` 初值从 `initialState` 改成 `initialStateWithHp`（具体哪一行根据现有代码上下文调整；保留现有变量命名习惯）。

- [ ] **Step 5: 在每次伤害事件 calculate 后调用 `applyDamageToHp`**

定位到 simulate 内部处理 damageEvent 的分支（在 `damageResults.set` 调用之前）。在 calculate 调用之后插入：

```ts
const { nextState: stateAfterHp, snapshot: hpSnap } = this.applyDamageToHp(
  currentState, // 主循环里追踪的 PartyState 变量名
  ev, // 当前 damageEvent 变量名
  result.finalDamage
)
result.hpSimulation = hpSnap
currentState = stateAfterHp
```

> **注：** 实际变量名以现有代码为准。这一步把 `applyDamageToHp` 接入主循环，伤害事件的 hp 演化生效。

- [ ] **Step 6: 在每次 status mutation 后调用 `recomputeHpMax`**

需要在以下位置插入 `state = this.recomputeHpMax(state)`：

- 处理 expire（status 自然到期或 onExpire 钩子返回新 state 后）
- 处理 cast executor 调用之后
- 处理 onConsume / onBeforeShield / onAfterDamage 钩子返回新 state 后（如果钩子修改了 statuses）

把这些点统一成一个工具方法 / 在每个 mutation 点显式调用。具体位置由实施工程师在 inspect 主循环后决定。

- [ ] **Step 7: 在 cast executor 调用时注入 `castEventId` 与 `recordHeal`**

定位到 simulate 内部为 cast event 构造 `ActionExecutionContext` 的位置，在原有字段后加：

```ts
const ctx: ActionExecutionContext = {
  // ... 现有字段
  castEventId: castEvent.id,
  recordHeal,
}
```

同样在 `StatusTickContext` 构造处（advanceToTime 内部）加：

```ts
const tickCtx: StatusTickContext = {
  // ... 现有字段
  recordHeal,
}
```

- [ ] **Step 8: simulate 末尾返回 `healSnapshots`**

定位到 simulate 末尾的 return 语句，把 `healSnapshots: []` 占位改成实际值：

```ts
return {
  damageResults,
  statusTimelineByPlayer,
  castEffectiveEndByCastEventId,
  healSnapshots,
}
```

- [ ] **Step 9: 跑 partial 段累积测试，验证全部 PASS**

```
pnpm test:run src/utils/mitigationCalculator.test.ts -t "HP 池演化"
```

Expected: 全部 PASS。

- [ ] **Step 10: 写 maxHP buff 测试（直接构造 initialState.statuses 跳过 cast 链路）**

继续在 `mitigationCalculator.test.ts` 加：

```ts
import * as registry from './statusRegistry'
import type { MitigationStatusMetadata } from '@/types/status'

const MAX_HP_BUFF_ID = 999700

const mkMaxHpMeta = (multiplier: number, isTankOnly = false): MitigationStatusMetadata =>
  ({
    id: MAX_HP_BUFF_ID,
    name: 'mock-maxhp',
    type: 'multiplier',
    performance: { physics: 1, magic: 1, darkness: 1, maxHP: multiplier },
    isFriendly: true,
    isTankOnly,
  }) as MitigationStatusMetadata

describe('HP 池 - maxHP buff 同步伸缩', () => {
  it('initialState 已挂 +10% maxHP buff：hp.max=110k、hp.current=110k', () => {
    const spy = vi
      .spyOn(registry, 'getStatusById')
      .mockImplementation(id => (id === MAX_HP_BUFF_ID ? mkMaxHpMeta(1.1) : undefined))
    try {
      const calculator = new MitigationCalculator()
      const initialState: PartyState = {
        statuses: [
          {
            instanceId: 'maxhp',
            statusId: MAX_HP_BUFF_ID,
            startTime: 0,
            endTime: 60,
            sourcePlayerId: 1,
          },
        ],
        timestamp: 0,
      }
      const out = calculator.simulate({
        castEvents: [],
        damageEvents: [mkDmg('A', 10, 'aoe', 20000)],
        initialState,
        baseReferenceMaxHPForAoe: 100000,
      })
      const r = out.damageResults.get('A')!.hpSimulation!
      expect(r.hpMax).toBe(110000)
      expect(r.hpBefore).toBe(110000)
      expect(r.hpAfter).toBe(90000)
    } finally {
      spy.mockRestore()
    }
  })

  it('isTankOnly maxHP buff 永远不抬升非坦池上限', () => {
    const spy = vi
      .spyOn(registry, 'getStatusById')
      .mockImplementation(id =>
        id === MAX_HP_BUFF_ID ? mkMaxHpMeta(1.1, /*isTankOnly*/ true) : undefined
      )
    try {
      const calculator = new MitigationCalculator()
      const initialState: PartyState = {
        statuses: [
          {
            instanceId: 'maxhp-tank',
            statusId: MAX_HP_BUFF_ID,
            startTime: 0,
            endTime: 60,
            sourcePlayerId: 1,
          },
        ],
        timestamp: 0,
      }
      const out = calculator.simulate({
        castEvents: [],
        damageEvents: [mkDmg('A', 10, 'aoe', 20000)],
        initialState,
        baseReferenceMaxHPForAoe: 100000,
      })
      const r = out.damageResults.get('A')!.hpSimulation!
      expect(r.hpMax).toBe(100000) // 上限未被坦专 buff 抬升
      expect(r.hpAfter).toBe(80000)
    } finally {
      spy.mockRestore()
    }
  })

  it('maxHP buff 在事件之间 expire：hp.max 还原、hp.current 按比例回缩', () => {
    const spy = vi
      .spyOn(registry, 'getStatusById')
      .mockImplementation(id => (id === MAX_HP_BUFF_ID ? mkMaxHpMeta(1.1) : undefined))
    try {
      const calculator = new MitigationCalculator()
      const initialState: PartyState = {
        statuses: [
          {
            instanceId: 'maxhp',
            statusId: MAX_HP_BUFF_ID,
            startTime: 0,
            endTime: 15, // 在两次伤害之间过期
            sourcePlayerId: 1,
          },
        ],
        timestamp: 0,
      }
      const out = calculator.simulate({
        castEvents: [],
        damageEvents: [
          mkDmg('A', 10, 'aoe', 20000), // buff 仍在：hp.max=110k → hp 90k
          mkDmg('B', 20, 'aoe', 20000), // buff 已过期：hp.max=100k、hp 按比例回缩 90k/1.1≈81818 → 再扣 20k=61818
        ],
        initialState,
        baseReferenceMaxHPForAoe: 100000,
      })
      expect(out.damageResults.get('A')!.hpSimulation!.hpAfter).toBe(90000)
      const rB = out.damageResults.get('B')!.hpSimulation!
      expect(rB.hpMax).toBe(100000)
      // hp.current 90000 按 prev/new = 1.1 比例回缩 → 81818.18...
      // 然后扣 20k → 61818.18...
      expect(rB.hpAfter).toBeCloseTo(61818.18, 1)
    } finally {
      spy.mockRestore()
    }
  })
})
```

跑测试：

```
pnpm test:run src/utils/mitigationCalculator.test.ts -t "maxHP buff"
```

Expected: 全部 PASS。

- [ ] **Step 11: 跑全量测试 + 类型检查**

```
pnpm exec tsc --noEmit
pnpm test:run
```

Expected: 全部 PASS（含 mitigationCalculator 现有用例和新增的 HP 池演化用例）。

> **注：** 现有 simulator 测试不带 `partyState.hp`（因为 hp 由 simulate 内部初始化）；只要 `baseReferenceMaxHPForAoe` 缺省为 0，hp 池就为 undefined，`applyDamageToHp` 直接返回原 state，行为等价。

- [ ] **Step 12: Commit**

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "feat(simulator): HP 池演化嵌入 simulate 主循环（partial 段累积、maxHP 同步、healSnapshots 收集）"
```

---

## Task 6: useDamageCalculation 透传 + 端到端测试

> Hook 层暴露 `healSnapshots`；端到端用例覆盖 partial 段 + cast 治疗 + HoT 的真实场景。

**Files:**

- Modify: `src/hooks/useDamageCalculation.ts`
- Modify: `src/hooks/useDamageCalculation.test.ts`

- [ ] **Step 1: 修改 `useDamageCalculation.ts` 类型与返回值**

定位到 `DamageCalculationResult` 接口（约第 17-28 行）。加 `healSnapshots`：

```ts
import type { HealSnapshot } from '@/types/healSnapshot'

export interface DamageCalculationResult {
  results: Map<string, CalculationResult>
  statusTimelineByPlayer: StatusTimelineByPlayer
  castEffectiveEndByCastEventId: Map<string, number>
  /** 治疗 snapshot（一次性 cast + HoT tick）按 time 升序 */
  healSnapshots: HealSnapshot[]
  simulate: ((castEvents: CastEvent[]) => { statusTimelineByPlayer: StatusTimelineByPlayer }) | null
}
```

定位到 hook 的 `empty` 默认值（约第 42-47 行），加 `healSnapshots: []`：

```ts
const empty: DamageCalculationResult = {
  results,
  statusTimelineByPlayer: new Map(),
  castEffectiveEndByCastEventId: new Map(),
  healSnapshots: [],
  simulate: null,
}
```

定位到 hook 末尾返回路径（约第 140-145 行），把 simulate 输出的 `healSnapshots` 透传出去：

```ts
return {
  results,
  statusTimelineByPlayer: full.statusTimelineByPlayer,
  castEffectiveEndByCastEventId: full.castEffectiveEndByCastEventId,
  healSnapshots: full.healSnapshots,
  simulate,
}
```

- [ ] **Step 2: 写端到端测试（partial 段 + cast 治疗 + HoT）**

参考现有 `useDamageCalculation.test.ts` 顶部的 `fakeMeta` / `makeTimeline` helper 与 `useTimelineStore.setState({ partyState, statistics })` 注入模式。在文件末尾添加：

```ts
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { createHealExecutor } from '@/executors/createHealExecutor'
import { createRegenExecutor, regenStatusExecutor } from '@/executors/createRegenExecutor'

describe('HP 模拟端到端（partial 段 + cast 治疗 + HoT）', () => {
  it('partial 段 + cast 一次性治疗 + HoT 演化正确，healSnapshots 反向溯源 castEventId', () => {
    const HEAL_ACTION_ID = 999801
    const HOT_ACTION_ID = 999802
    const HOT_STATUS_ID = 999803

    // 注入临时 mitigation actions（仅用于本用例）
    const original = [...MITIGATION_DATA.actions]
    MITIGATION_DATA.actions.push(
      {
        id: HEAL_ACTION_ID,
        name: 'mock-heal',
        icon: '',
        jobs: ['WHM'],
        duration: 0,
        cooldown: 0,
        category: ['heal', 'partywide'],
        executor: createHealExecutor(),
      },
      {
        id: HOT_ACTION_ID,
        name: 'mock-regen',
        icon: '',
        jobs: ['WHM'],
        duration: 30,
        cooldown: 0,
        category: ['heal', 'partywide'],
        executor: createRegenExecutor(HOT_STATUS_ID, 30),
      }
    )

    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation(id => {
      if (id === HOT_STATUS_ID) {
        return fakeMeta(id, {
          executor: regenStatusExecutor,
          performance: { physics: 1, magic: 1, darkness: 1, heal: 1, maxHP: 1 },
        })
      }
      return undefined
    })

    try {
      // 构造 timeline：partial 段 + cast 治疗 + HoT
      const timeline: Timeline = {
        id: 't',
        name: 't',
        encounter: { id: 0, name: '', displayName: '', zone: '', damageEvents: [] },
        composition: { players: [{ id: 1, job: 'WHM' }] }, // 单非T，无坦
        damageEvents: [
          {
            id: 'p1',
            name: '',
            time: 10,
            damage: 20000,
            type: 'partial_aoe',
            damageType: 'magical',
          },
          {
            id: 'p2',
            name: '',
            time: 15,
            damage: 25000,
            type: 'partial_aoe',
            damageType: 'magical',
          },
          {
            id: 'p3',
            name: '',
            time: 25,
            damage: 30000,
            type: 'partial_final_aoe',
            damageType: 'magical',
          },
        ],
        castEvents: [
          { id: 'cast-heal', actionId: HEAL_ACTION_ID, timestamp: 5, playerId: 1 },
          { id: 'cast-hot', actionId: HOT_ACTION_ID, timestamp: 18, playerId: 1 },
        ],
        statusEvents: [],
        annotations: [],
        statData: {
          referenceMaxHP: 100000,
          tankReferenceMaxHP: 100000,
          shieldByAbility: {},
          critShieldByAbility: {},
          healByAbility: {
            [HEAL_ACTION_ID]: 10000, // 一次性治疗 +10k
            [HOT_STATUS_ID]: 30000, // HoT 30s = 10 ticks → 每 tick +3k
          },
          critHealByAbility: {},
        },
        createdAt: 0,
        updatedAt: 0,
      }

      useTimelineStore.setState({
        partyState: { statuses: [], timestamp: 0 },
        statistics: null,
      })

      const { result } = renderHook(() => useDamageCalculation(timeline))

      // p1 (t=10): hp 100k（cast 在 t=5 时刻 hp 满血、+10k overheal）→ partial 20k → 80k
      expect(result.current.results.get('p1')!.hpSimulation!.hpAfter).toBe(80000)
      // p2 (t=15): segMax 20k → 25k，增量 5k → 75k
      expect(result.current.results.get('p2')!.hpSimulation!.hpAfter).toBe(75000)
      // HoT cast 在 t=18，tick 在 t=21、t=24 触发（每次 +3k）→ p3 前 hp = 75 + 6 = 81k
      // p3 (t=25): segMax 25k → 30k，增量 5k → 76k
      expect(result.current.results.get('p3')!.hpSimulation!.hpAfter).toBe(76000)

      // healSnapshots：1 次 cast 一次性 + 2 次 HoT tick = 3
      const snaps = result.current.healSnapshots
      expect(snaps).toHaveLength(3)
      expect(snaps[0]).toMatchObject({
        castEventId: 'cast-heal',
        isHotTick: false,
        applied: 10000,
        overheal: 0,
      })
      expect(snaps[1]).toMatchObject({ castEventId: 'cast-hot', isHotTick: true, time: 21 })
      expect(snaps[2]).toMatchObject({ castEventId: 'cast-hot', isHotTick: true, time: 24 })
    } finally {
      spy.mockRestore()
      MITIGATION_DATA.actions.length = 0
      MITIGATION_DATA.actions.push(...original)
    }
  })
})
```

> **注：** 这个用例直接修改 `MITIGATION_DATA.actions` 数组属于"测试态污染"——`finally` 块负责复原。如果本项目有更干净的 action 注入机制（例如可注入的 actions registry），实施工程师可改用更优方式；功能验证不变。

- [ ] **Step 3: 跑测试 + 类型检查**

```
pnpm exec tsc --noEmit
pnpm test:run src/hooks/useDamageCalculation.test.ts
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useDamageCalculation.ts src/hooks/useDamageCalculation.test.ts
git commit -m "feat(hook): useDamageCalculation 透传 healSnapshots 与端到端用例"
```

---

## Task 7: PropertyPanel UI 累积视角改造

> `renderHpBar` 从孤立视角换成累积视角；partial 事件多展示一行 segMax；溢出口径切换。

**Files:**

- Modify: `src/components/PropertyPanel.tsx`

- [ ] **Step 1: 阅读现有 `PropertyPanel.tsx`**

先 Read 整个文件，重点理解：

- `BranchViewData` 接口结构（孤立视角的字段）
- `renderHpBar(branch)` 当前实现（基于 `referenceMaxHP - finalDamage`）
- `renderMitigationBar` 中的 `overkill` 计算（基于 `branch.finalDamage - maxHP`）
- 单坦 / 多坦分支渲染分流处

- [ ] **Step 2: 修改 `renderHpBar` 改用 `hpSimulation`**

在 `renderHpBar` 函数签名之上加一个新分支：当事件是非坦事件且 `result.hpSimulation` 存在时，走累积视角：

```tsx
function renderHpBarAccumulative(snap: HpSimulationSnapshot) {
  const { hpBefore, hpAfter, hpMax, overkill } = snap
  const dealt = hpBefore - hpAfter
  const survivePct = (hpAfter / hpMax) * 100
  const damagePct = (dealt / hpMax) * 100
  const isLethal = hpAfter === 0 && (overkill ?? 0) > 0
  const isDangerous = !isLethal && survivePct < 5

  return (
    <div className="space-y-1.5">
      {isLethal && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-3 py-2">
          <Skull className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-red-700 dark:text-red-400">致死</p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80">
              伤害溢出 {(overkill ?? 0).toLocaleString()} HP，需要更多减伤 / 治疗
            </p>
          </div>
        </div>
      )}
      {isDangerous && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 px-3 py-2">
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300">危险</p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
              伤害后仅剩 {hpAfter.toLocaleString()} HP（{survivePct.toFixed(1)}%）
            </p>
          </div>
        </div>
      )}
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">HP</span>
        <span className="tabular-nums">
          <span className="text-foreground">{hpAfter.toLocaleString()}</span>
          <span className="text-muted-foreground"> / {hpMax.toLocaleString()}</span>
          <span className="text-red-500 ml-1">(-{dealt.toLocaleString()})</span>
        </span>
      </div>
      <div className="h-2.5 bg-secondary rounded-full overflow-hidden flex">
        <div
          className="h-full rounded-l-full"
          style={{
            width: `${Math.max(0, Math.min(100, survivePct))}%`,
            backgroundColor: 'rgb(34, 197, 94)',
          }}
        />
        <div
          className="h-full"
          style={{
            width: `${Math.max(0, Math.min(100, damagePct))}%`,
            backgroundColor: 'rgb(239, 68, 68)',
            backgroundImage:
              'repeating-linear-gradient(-45deg, transparent, transparent 2px, rgba(0,0,0,0.2) 2px, rgba(0,0,0,0.2) 4px)',
          }}
        />
      </div>
    </div>
  )
}
```

在调用方（`renderBranchContent`）里加分流：

```tsx
function renderBranchContent(
  branch: BranchViewData,
  damageType: DamageType,
  originalDamage: number
) {
  // 非坦事件优先走累积视角；坦专 / 缺失 hpSimulation 时回退孤立视角
  const hpSnap = result.hpSimulation
  return (
    <>
      {hpSnap ? renderHpBarAccumulative(hpSnap) : renderHpBar(branch)}
      {renderMitigationBar(branch, originalDamage)}
      {renderAppliedStatuses(branch, damageType, originalDamage)}
    </>
  )
}
```

- [ ] **Step 3: partial 事件多渲染一行 segMax**

在 `renderHpBarAccumulative` 之外、与之并排的渲染路径中（仅 partial 事件渲染），加：

```tsx
function renderPartialSegInfo(snap: HpSimulationSnapshot, ev: DamageEvent) {
  if (snap.segMax === undefined) return null
  const dealt = snap.hpBefore - snap.hpAfter
  const isFinal = ev.type === 'partial_final_aoe'

  return (
    <div className="space-y-1 text-xs border-t pt-2 mt-2">
      <div className="flex justify-between">
        <span className="text-muted-foreground">段累积</span>
        <span className="tabular-nums text-foreground">
          {snap.segMax.toLocaleString()}
          {isFinal && <span className="ml-1 text-amber-600">（段结束）</span>}
        </span>
      </div>
      <div className="text-muted-foreground">
        本次扣血 = max(0, {ev.damage.toLocaleString()} - {(snap.segMax - dealt).toLocaleString()}) ={' '}
        {dealt.toLocaleString()}
      </div>
    </div>
  )
}
```

并在 `renderBranchContent` 末尾追加：

```tsx
{
  hpSnap &&
    (event.type === 'partial_aoe' || event.type === 'partial_final_aoe') &&
    renderPartialSegInfo(hpSnap, event)
}
```

- [ ] **Step 4: `renderMitigationBar` 溢出口径切换**

定位到 `renderMitigationBar` 中 `overkill` 的计算（约第 150 行）：

```tsx
// 之前：const overkill = maxHP > 0 ? Math.max(0, branch.finalDamage - maxHP) : 0
const overkill =
  result.hpSimulation?.overkill ??
  (branch.referenceMaxHP && branch.referenceMaxHP > 0
    ? Math.max(0, branch.finalDamage - branch.referenceMaxHP)
    : 0)
```

> 优先用累积视角的 `overkill`；缺失时回退到原孤立计算（坦专路径仍然用旧口径）。

- [ ] **Step 5: 验证类型检查 + 启动 dev server 手动验**

```
pnpm exec tsc --noEmit
pnpm lint
```

如果用户已启动 `pnpm dev`，打开编辑器：

1. 选中一个 partial_aoe 事件 → HP 条显示"事件前 → 事件后"，并在底部展示段累积
2. 选中一个 aoe 事件 → 同样累积视角，无段累积区
3. 选中一个 tankbuster 事件 → 仍走 perVictim 多坦视角
4. 致死场景：HP 池跌破 0 → 红色"致死"警示

- [ ] **Step 6: Commit**

```bash
git add src/components/PropertyPanel.tsx
git commit -m "feat(ui): PropertyPanel HP 条改为累积视角 + partial 段累积展示"
```

---

## Task 8: 治疗 action 接入示例

> 给 `MITIGATION_DATA.actions` 中的治疗类 action 挂 executor，给 HoT 类 status 在 `STATUS_EXTRAS` 注册 `regenStatusExecutor`。本任务**不**强求覆盖所有治疗 action，先把 1-2 个代表性 action 接通跑通端到端，留一份 mapping 表给后续逐步铺开。

**Files:**

- Modify: `src/data/mitigationActions.ts`
- Modify: `src/data/statusExtras.ts`

- [ ] **Step 1: 调研现有治疗类 action**

先 grep 找出 `MITIGATION_DATA.actions` 中 `category` 含 `'heal'` 的 action：

```
grep -n "category" src/data/mitigationActions.ts | head -50
```

人工 inspection 这些 action：

- 哪些是单次治疗（cast 时立即回血、无对应 buff 状态）
- 哪些是纯 HoT（cast 挂 status，每 3s tick 回血）
- 哪些是单次 + buff 组合（cast 立即回血同时挂减伤 / 加治疗 buff）
- 哪些是单次 + HoT 组合

按 spec §4.5 的 mapping 表分类。

- [ ] **Step 2: 选择 1-2 个代表性 action 作为接入示例**

从调研结果中选 1 个**单次治疗**（最简）+ 1 个**纯 HoT**（验证 onTick 链路）。**不**在 plan 文档里硬编技能名——由实施工程师在 inspection 后选择。

按 spec §4.5 mapping 表给选定 action 加 `executor` 字段。例如对单次治疗 action：

```ts
{
  id: <SELECTED_ACTION_ID>,
  // ... 其他既有字段
  executor: createHealExecutor(),  // 或 createHealExecutor({ amountSourceId: <STATUS_ID> }) 视情况
}
```

对 HoT action：

```ts
{
  id: <SELECTED_HOT_ACTION_ID>,
  // ... 其他既有字段
  executor: createRegenExecutor(<HOT_STATUS_ID>, <DURATION>),
}
```

- [ ] **Step 3: 给 HoT 类 status 注册 `regenStatusExecutor`**

定位到 `src/data/statusExtras.ts`，给 HoT 状态对应的 `STATUS_EXTRAS[<HOT_STATUS_ID>]` 加 `executor: regenStatusExecutor`：

```ts
import { regenStatusExecutor } from '@/executors/createRegenExecutor'

// ... 在对应 status 配置里
[<HOT_STATUS_ID>]: {
  // ... 现有字段
  executor: regenStatusExecutor,
}
```

- [ ] **Step 4: 验证（手动 + 自动）**

```
pnpm exec tsc --noEmit
pnpm test:run
```

Expected: 全部 PASS。

启动 dev server，构造一个简单时间轴：

1. 加几个非坦 AOE 伤害事件
2. 在中间 cast 选定的治疗 action 与 HoT action
3. 选中 AOE 事件，观察 HP 条（应能看到累积扣血、被治疗补回、HoT 持续期 hp 慢慢上升）

- [ ] **Step 5: Commit**

```bash
git add src/data/mitigationActions.ts src/data/statusExtras.ts
git commit -m "feat(actions): 接入示例治疗 action（一次性 + HoT），HP 模拟可视化端到端跑通"
```

- [ ] **Step 6: 留一份 mapping 表给后续逐步接入**

在 `src/data/mitigationActions.ts` 顶部加注释，记录未来要接入的治疗 action 工作清单（不在本期完成）：

```ts
/**
 * 治疗 action executor 接入进度
 *
 * 已接入：
 *   - <ACTION_ID_1>: createHealExecutor
 *   - <ACTION_ID_2>: createRegenExecutor(<STATUS>, <DURATION>)
 *
 * 待接入（按 spec §4.5 mapping 表）：
 *   - 单次治疗：<grep category=heal 中所有未挂 executor 的>
 *   - 纯 HoT：<对应 status 待在 statusExtras 注册>
 *   - 治疗 + buff 组合：<复合 executor>
 *   - heal/selfHeal performance：<给对应 buff status 加 performance.heal/selfHeal 字段>
 *
 * 详见 design/superpowers/specs/2026-04-28-hp-simulate-design.md §4.5。
 */
```

- [ ] **Step 7: Commit (注释更新)**

```bash
git add src/data/mitigationActions.ts
git commit -m "docs(actions): 治疗 action 接入进度清单"
```

---

## 完成

跑全套验证：

```
pnpm exec tsc --noEmit
pnpm lint
pnpm test:run
pnpm build
```

Expected: 全部通过。

按本计划完成后，HP 模拟基础设施已就位：

- `PartyState.hp` 累积模型（partial 段、maxHP buff、heal/selfHeal）
- `createHealExecutor` / `createRegenExecutor` 双形态治疗
- `MitigationCalculator.simulate` 单次扫描产出 `hpSimulation` + `healSnapshots`
- `PropertyPanel` 非坦事件累积视角

后续增量（spec §未来工作）：

- 主时间轴 HP 曲线 overlay
- 治疗 cast / HoT tick 详情面板
- 治疗效率统计
- 手动重置锚点
- 段超时自动结算
- 全部治疗 action 逐步接入（按 §4.5 mapping 表）
