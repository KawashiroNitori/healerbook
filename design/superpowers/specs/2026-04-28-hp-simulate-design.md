# HP 模拟设计

> 日期：2026-04-28
> 范围：编辑模式下非坦聚合 HP 池累积模拟 + 治疗 Executor 双形态 + PropertyPanel 累积视角

## 背景与目标

当前编辑模式下的 HP 展示是**孤立**视角：每个伤害事件各自以 `referenceMaxHP` 为基准，假设满血进入，独立判定致死 / 危险。`PropertyPanel.renderHpBar` 与 `TimelineMinimap` 着色都基于 `finalDamage / referenceMaxHP` 比率。

这丢失了实战规划最关键的信息：**跨事件的血量累积**。具体痛点：

1. 连续多次 AOE 伤害无法体现"血线步步降低"，规划治疗时机失去依据
2. 治疗 cast 即便已经在时间轴上，其作用没有被消费——计算路径里完全不读
3. `PerformanceType.heal` / `statistics.healByAbility` / `StatusExecutor.onTick` 等基础设施已经埋好但无人接管

本设计建立编辑模式下的 **HP 累积模拟器**，作为 `MitigationCalculator.simulate` 的内嵌子系统，覆盖：

- 一条非坦聚合 HP 池随时间演化（aoe / partial AOE 累积扣血、治疗补回）
- 一次性治疗 + HoT 双形态 Executor，与 buff/shield Executor 形态对齐
- `partial_aoe` / `partial_final_aoe` 的"段 max 增量"累积语义
- `maxHP` 倍率 buff 对池容量与当前 HP 的同步伸缩
- `heal` / `selfHeal` 双作用域的治疗加成区分
- 治疗 snapshot 收集（含 `overheal`），UI 后续消费

明确**不在范围内**：

- 回放模式（永远不参与模拟，走现有 `PlayerDamageDetail.hitPoints` 路径）
- 坦克 HP（坦专事件 `tankbuster` / `auto` 继续走孤立 + 多坦分支，HP 池零影响）
- 暴击治疗（`critHealByAbility` 永不消费）
- 主时间轴 HP 曲线 overlay（后续增量）
- 治疗 cast / HoT tick 详情面板（后续增量）

## 核心决策

| 决策                 | 取值                                                                               | 原因                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 模拟范围             | 累积伤害 + 解析治疗 cast                                                           | 充分利用已有的 `healByAbility`、`onTick`、`PerformanceType.heal` 基础设施                            |
| 池粒度               | 单条非坦聚合 HP 线                                                                 | 与 `referenceMaxHP` / 多坦分支二分一致；坦克路径维持现状                                             |
| 重置规则             | 永不自动归满                                                                       | 严格累积；代码留口子允许未来加手动锚点                                                               |
| partial 段语义       | 段内每次扣 `max(0, finalDamage - segMax)`；aoe/pfaoe 收尾段；tank/auto/heal 段穿透 | 反映"partial AOE 命中子集，段累积总扣血 = max"的实战机制                                             |
| 治疗 Executor 形态   | 双形态：`createHealExecutor`（一次性）+ `createRegenExecutor`（HoT）               | 与 buff/shield Executor 对齐；HoT 复用 onTick 网格                                                   |
| HoT tick 量          | snapshot-on-apply                                                                  | 与 buff `performance` snapshot 风格一致；tickAmount 在 cast 时锁定                                   |
| `maxHP` buff         | attach / expire 按比例同步伸缩 `hp.current`                                        | 贴近游戏内行为，最少惊讶                                                                             |
| HP 边界              | clamp 到 `[0, hp.max]`（不允许负数）                                               | 与 `overkill` 语义对偶；后续治疗从 0 起算（"复活"语义）                                              |
| 模拟器接入           | HP 池作为 `PartyState.hp` 字段，单次扫描                                           | 与 buff/shield Executor 形态对齐；partial 段累积天然嵌主循环                                         |
| 同时刻 cast / damage | cast 优先（`expire → tick → cast → damage`）                                       | 治疗在伤害前结算                                                                                     |
| 暴击治疗             | 永不消费 `critHealByAbility`                                                       | 治疗永远取 `healByAbility` 中位                                                                      |
| 回放模式             | 永远不参与                                                                         | `useDamageCalculation` 现有 return empty 是设计契约                                                  |
| status 过滤          | 仅 `!meta.isTankOnly` 的 status 参与 HP 模拟                                       | HP 池只模拟非坦聚合血量；坦专 buff（自身减伤 / 坦克自疗 / 坦克 maxHP）不应影响非坦池的治疗倍率与上限 |
| UI 改造              | 阶段 1 仅 `PropertyPanel` 累积视角                                                 | 主轨道 HP 曲线作为后续增量                                                                           |

## 类型层

### `src/types/partyState.ts` — 加 `hp` 字段

```ts
import type { MitigationStatus } from './status'

/**
 * 非坦聚合 HP 池（编辑模式专用）
 *
 * 仅模拟非坦克玩家共享的最低参考血量；坦专事件（tankbuster / auto）
 * 不入池，继续走 mitigationCalculator 的多坦分支孤立判定。
 */
export interface HpPool {
  /** 当前 HP，clamp 到 [0, max] */
  current: number
  /** 当前上限 = base × ∏(active maxHP buff) */
  max: number
  /** 基线上限（不含 maxHP buff）；buff attach/expire 时按比例伸缩 current */
  base: number
  /** partial 段累积器：段内已观察到的最大 finalDamage */
  segMax: number
  /** 当前是否处于 partial 段内（aoe / pfaoe 收尾或时间轴起始时为 false） */
  inSegment: boolean
}

export interface PartyState {
  statuses: MitigationStatus[]
  timestamp: number
  /**
   * 非坦聚合 HP 池。回放模式下为 undefined（永不参与）。
   * 编辑模式由 timelineStore 在 partyState 初始化时根据
   * resolveStatData(timeline.statData, statistics).referenceMaxHP 填充：
   *   hp.base = hp.max = hp.current = referenceMaxHP
   *   hp.segMax = 0；hp.inSegment = false
   */
  hp?: HpPool
}
```

### `src/types/status.ts` — `PerformanceType` 增加 `selfHeal`

现有 `PerformanceType` 已有 `heal` / `maxHP`。本期新增 `selfHeal`：

```ts
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
  /** 最大 HP 倍率（> 1 增益），缺省视为 1 */
  maxHP?: number
}
```

`heal` / `selfHeal` 区分：

- `heal`：buff 持有者无关；任何治疗 cast 都吃这个加成（团辅作用域）
- `selfHeal`：仅 `status.sourcePlayerId === healCast.sourcePlayerId` 时参与（自身 buff 作用域）
- 同一 buff 可同时具备 `heal + selfHeal`

### `src/types/healSnapshot.ts`（新文件）— 治疗事件快照

```ts
export interface HealSnapshot {
  /** 触发治疗的 cast event id */
  castEventId: string
  /** 触发治疗的 actionId（一次性 cast = 自身 actionId；HoT tick = HoT status 的 sourceActionId） */
  actionId: number
  /** 触发玩家 ID（cast.sourcePlayerId） */
  sourcePlayerId: number
  /** 治疗发生时刻（cast 时刻 / tick 时刻） */
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

### `src/utils/mitigationCalculator.ts` — `CalculationResult` 增加 `hpSimulation`

```ts
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

export interface CalculationResult {
  // ... 现有字段保持（含 perVictim 多坦分支）
  /** HP 池模拟快照；编辑模式下非坦事件填充；坦专 / 回放模式 / hp 缺失时为 undefined */
  hpSimulation?: HpSimulationSnapshot
}

export interface SimulateOutput {
  // ... 现有字段保持
  /** 所有治疗事件（cast + HoT tick）的 snapshot，按 time 升序 */
  healSnapshots: HealSnapshot[]
}
```

### `src/types/mitigation.ts` — `ActionExecutionContext` 加 sink

```ts
export interface ActionExecutionContext {
  // ... 现有字段保持
  /** 触发本次 executor 的 castEvent.id（治疗 executor 用于 healSnapshot.castEventId） */
  castEventId: string
  /** simulator 注入的治疗 snapshot 收集器 */
  recordHeal?: (snap: HealSnapshot) => void
}
```

`StatusTickContext` 同样新增 `recordHeal`，HoT 的 onTick 用以记录每个 tick 的 `HealSnapshot`。

## 治疗 Executor

### `createHealExecutor`（一次性治疗）

```ts
// src/executors/createHealExecutor.ts

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
  const { fixedAmount, amountSourceId } = options ?? {}

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
      castEventId: ctx.castEventId,
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

特点：

- 不挂状态；纯改 `hp.current`
- 不参与 partial 段累积器（`segMax` / `inSegment` 不动）
- HP 已归 0 时仍可治疗（"复活"语义）；clamp 到 `[0, max]`
- 即便 `applied = 0`（满血时）也写入 snapshot（`overheal = finalHeal`）

### `createRegenExecutor`（HoT）

```ts
// src/executors/createRegenExecutor.ts

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
    // cast 时刻按当时 active buff 快照 tickAmount（snapshot-on-apply）
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
      data: { tickAmount: snapshotTickAmount, castEventId: ctx.castEventId },
    }

    return { ...ctx.partyState, statuses: [...filteredStatuses, newStatus] }
  }
}
```

HoT 的 `onTick`（在 `STATUS_EXTRAS` 给该 statusId 挂）：

```ts
const regenStatusExecutor: StatusExecutor = {
  onTick: ctx => {
    if (!ctx.partyState.hp) return
    const tickAmount = (ctx.status.data?.tickAmount as number | undefined) ?? 0
    if (tickAmount <= 0) return

    const before = ctx.partyState.hp.current
    const next = Math.min(before + tickAmount, ctx.partyState.hp.max)
    const applied = next - before
    const overheal = tickAmount - applied

    ctx.recordHeal?.({
      castEventId: ctx.status.data?.castEventId as string,
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

特点：

- `tickAmount` 在 cast 时刻 snapshot（含当时 active 的 heal / selfHeal buff），写进 `status.data.tickAmount`
- `castEventId` 同步写进 `status.data`，供 HoT tick 反向溯源
- 后续 onTick 直接读 snapshot，不再重算（与现有 buff `performance` snapshot 风格一致）
- `instanceId` 生命周期遵循现有约定（延 / 引爆都不换 id）

### 组合 Executor

某些 action 既治疗又上 buff 或 HoT。用最朴素的串联：

```ts
function makeHealAndBuffExecutor(buffStatusId: number, buffDuration: number): ActionExecutor {
  const healExec = createHealExecutor()
  const buffExec = createBuffExecutor(buffStatusId, buffDuration)
  return ctx => {
    const afterHeal = healExec(ctx)
    return buffExec({ ...ctx, partyState: afterHeal })
  }
}
```

约定：**先治疗后 buff** —— 同一 cast 自带的 buff 不应加成自身的治疗量，否则违反 snapshot-on-apply 语义。

### `computeFinalHeal` 实现

放在 `src/executors/healMath.ts`（新文件），被 `createHealExecutor` / `createRegenExecutor` / 测试三处共享：

```ts
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
    // 非坦聚合 HP 模拟只消费非坦专 status：坦专治疗 buff 不污染非坦池
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
```

### 现有 `mitigationActions` 的迁移分类

| Action 类别                                               | Executor 选择                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 单次治疗（无 HoT）                                        | `createHealExecutor()`                                                          |
| 纯 HoT                                                    | `createRegenExecutor(statusId, duration)`                                       |
| 单次治疗 + 同步上 buff                                    | 组合（先 heal 后 buff）                                                         |
| 单次治疗 + HoT                                            | 组合（先 heal 后 regen）                                                        |
| 上 buff（含 heal/selfHeal `PerformanceType`），本身不治疗 | 仍用 `createBuffExecutor`；buff 的 performance 字段在其他 cast 治疗结算时被消费 |

具体 action 落点 + 哪些 statusId 需要在 `STATUS_EXTRAS` 注册 onTick / 设置 heal/selfHeal——由 plan 阶段逐个梳理；本 spec 不锁列表。

## 模拟器主循环

### 主循环改动

```ts
// 伪代码（实际嵌入 MitigationCalculator.simulate 内部）

const initialHpPool: HpPool = {
  current: input.baseReferenceMaxHPForAoe,
  max: input.baseReferenceMaxHPForAoe,
  base: input.baseReferenceMaxHPForAoe,
  segMax: 0,
  inSegment: false,
}

let state: PartyState = { ...input.initialState, hp: initialHpPool }
const healSnapshots: HealSnapshot[] = []
const recordHeal = (snap: HealSnapshot) => healSnapshots.push(snap)

for (const ev of mergedEvents) {
  // 已按 (time asc, kind tiebreak: expire → tick → cast → damage) 升序
  // ① 推进时间到 ev.time，触发期间所有 onTick / onExpire
  // advanceToTime 内部每次 expire 后调用 recomputeHpMax（buff 自然到期时 hp.max 立即下调）
  state = advanceToTime(state, ev.time, recordHeal)

  switch (ev.kind) {
    case 'cast': {
      // executor 直接修改 hp（createHealExecutor）或挂 HoT（createRegenExecutor）
      state = applyExecutor(state, ev.cast, recordHeal)
      // applyExecutor 后调用 recomputeHpMax（buff attach / 引爆 / consume 时 hp.max 同步伸缩）
      state = recomputeHpMax(state)
      break
    }
    case 'damage': {
      // ②.a calculate 流水线零改动；onBeforeShield / onAfterDamage / onConsume 钩子
      // 在内部修改 statuses 后由 simulator 在钩子返回处调用 recomputeHpMax
      const result = calculator.calculate(ev.damage, state, opts)

      // ②.b applyDamageToHp 按事件类型扣 HP；填充 result.hpSimulation
      const { nextState, snapshot } = applyDamageToHp(state, ev.damage, result.finalDamage)
      state = nextState
      result.hpSimulation = snapshot

      results.set(ev.damage.id, result)
      break
    }
  }
}

return { ...output, healSnapshots }
```

### `applyDamageToHp` — partial 段累积器

```ts
function applyDamageToHp(
  state: PartyState,
  ev: DamageEvent,
  finalDamage: number
): { nextState: PartyState; snapshot?: HpSimulationSnapshot } {
  if (!state.hp) return { nextState: state }
  const hp = state.hp
  const before = hp.current

  // 坦专路径：HP 池零影响、段状态不变；不填 hpSimulation（坦专走 perVictim）
  if (ev.type === 'tankbuster' || ev.type === 'auto') {
    return { nextState: state }
  }

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
```

### `recomputeHpMax` — maxHP buff 同步伸缩

每次 status mutation 之后调用：

```ts
function recomputeHpMax(state: PartyState): PartyState {
  if (!state.hp) return state
  const newMultiplier = computeMaxHpMultiplier(state.statuses, state.timestamp)
  const prevMultiplier = state.hp.max / state.hp.base
  if (Math.abs(newMultiplier - prevMultiplier) < 1e-9) return state

  const ratio = newMultiplier / prevMultiplier
  const newMax = state.hp.base * newMultiplier
  const newCurrent = Math.max(0, Math.min(state.hp.current * ratio, newMax))

  return { ...state, hp: { ...state.hp, current: newCurrent, max: newMax } }
}

function computeMaxHpMultiplier(statuses: MitigationStatus[], time: number): number {
  let m = 1
  for (const s of statuses) {
    if (s.startTime > time || s.endTime <= time) continue
    const meta = getStatusById(s.statusId)
    if (!meta) continue
    // 非坦聚合 HP 模拟只消费非坦专 status：坦专 maxHP buff 不抬升非坦池上限
    if (meta.isTankOnly) continue
    const perf = s.performance ?? meta.performance
    if (perf.maxHP !== undefined && perf.maxHP !== 1) m *= perf.maxHP
  }
  return m
}
```

### 边界 case

| 场景                                          | 行为                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 回放模式                                      | HP 模拟**永远**不参与；`useDamageCalculation` 现有 return empty 是设计契约；PropertyPanel 走 `PlayerDamageDetails` |
| 坦专 buff（`meta.isTankOnly === true`）active | 不参与 HP 模拟：`computeFinalHeal` / `computeMaxHpMultiplier` 都跳过；既不影响非坦治疗倍率，也不抬升非坦池上限     |
| 治疗 cast 落在 `ev.time = 0` 战斗起始         | 正常累乘 active buff；战斗起始无 buff → multiplier=1；HP clamp 到 max                                              |
| HoT 状态 `expire` 时                          | onExpire 不改 hp（HoT 没有 onExpire 收尾治疗）；只有 onTick 改 hp                                                  |
| 同一 cast 既治疗 + 上 buff                    | executor 内部串联（先 heal 后 buff）；分别产出 hp 修改与 status mutation                                           |
| `aoe.finalDamage = 0`（被盾完全吸收）         | 段仍隐式结束（aoe 语义），`nextCurrent -= 0` 实际不扣                                                              |
| `partial_aoe.finalDamage = 0`（被盾完全吸收） | 若原本不在段内则**开段**（`inSegment = true`，`segMax = 0`）；否则 `segMax = max(segMax, 0)` 无变化；不扣血        |
| 战斗末尾仍 `inSegment = true`                 | 不强制结算，HP 维持当前值                                                                                          |
| HP 已归 0 时 cast 治疗                        | 正常加血，"复活"语义                                                                                               |
| 满血时 cast 治疗                              | applied = 0、overheal = finalHeal 仍写入 snapshot                                                                  |
| HoT 在 expire 前被治疗顶满                    | 后续 tick 仍按 snapshot tickAmount 触发，applied=0、overheal 累计                                                  |

## UI 改造

### `CalculationResult.hpSimulation` 填充规则

- 编辑模式 + `ev.type ∈ {aoe, partial_aoe, partial_final_aoe}` → 填 `hpSimulation`
- 编辑模式 + `ev.type ∈ {tankbuster, auto}` → 不填（坦专继续走 `perVictim`）
- 回放模式 → 不填（PlayerDamageDetails 走原路径）

### `PropertyPanel.renderHpBar` 改造

非坦事件的 HP 条从孤立视角换为累积视角：

```
┌──────────────────────────────────────────┐
│ HP                              80,000   │   ← hpBefore  → hpAfter
│                              / 100,000   │
│                              (-15,000)   │   ← 实际扣血量（aoe = finalDamage；partial = delta）
├──────────────────────────────────────────┤
│ ████████░░░░░░░░░░░░░░                   │   ← 双色条：survival(green) | damage(red striped)
└──────────────────────────────────────────┘
```

伪代码：

```ts
function renderHpBar(snapshot: HpSimulationSnapshot) {
  const { hpBefore, hpAfter, hpMax, overkill } = snapshot
  const dealt = hpBefore - hpAfter
  const survivePct = (hpAfter / hpMax) * 100
  const damagePct = (dealt / hpMax) * 100
  const isLethal = hpAfter === 0 && (overkill ?? 0) > 0
  const isDangerous = !isLethal && survivePct < 5
  // ...
}
```

致死警示文案：

| 状态                                   | 文案                                                 |
| -------------------------------------- | ---------------------------------------------------- |
| 致死 (`hpAfter === 0 && overkill > 0`) | `致死 — 伤害溢出 {overkill} HP，需要更多减伤 / 治疗` |
| 危险 (`hpAfter / hpMax < 5%` 且非致死) | `危险 — 伤害后仅剩 {hpAfter} HP（{percent}%）`       |

### `PropertyPanel` partial 段 max 展示

partial_aoe / partial_final_aoe 事件多渲染一行 segMax，含增量公式（教学性）：

```
┌──────────────────────────────────────────┐
│ 段累积                          22,000   │   ← segMax
│                                          │
│  本次扣血 = max(0, 18000 - 22000) = 0    │   ← 增量
└──────────────────────────────────────────┘
```

`partial_final_aoe` 额外标注"段结束"。

### `renderMitigationBar` 溢出口径切换

减伤构成条的"溢出伤害"段：

- 之前：`branch.finalDamage - referenceMaxHP`（孤立超出满血部分）
- 改后：`hpSimulation?.overkill ?? 0`（超出当前 HP 部分；累积视角）

### 多坦分支保持不变

`tankbuster` / `auto` 的 `perVictim` 多坦分支 UI 完全不动；HP 模拟不参与坦专路径。

### 治疗 snapshot UI 推迟

本期 PropertyPanel **不**展示 `overheal`（PropertyPanel 仅响应 damage event 选中，治疗 snapshot 没有自然挂载点）。`SimulateOutput.healSnapshots` 完整产出，但 UI 等到主轨道 HP 曲线 / 治疗效率统计阶段再消费。

## 测试策略

### 单元测试覆盖矩阵

测试加在 `src/utils/mitigationCalculator.test.ts`、`src/executors/createHealExecutor.test.ts`（新）、`src/executors/createRegenExecutor.test.ts`（新）、`src/executors/healMath.test.ts`（新）。

| 类别                    | 用例                                                            | 验证                                                             |
| ----------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| **partial 段累积**      | 单段多次 partial_aoe + pfaoe 收尾                               | 段内每次 max 增量、pfaoe 触发段结束                              |
|                         | 中段插入 tankbuster / auto                                      | 段穿透、segMax 不变、HP 不变                                     |
|                         | 中段插入 aoe                                                    | 段隐式结束、aoe 全额扣、新段 segMax 从 0                         |
|                         | 中段插入治疗 cast                                               | 段穿透、HP 升、segMax 不变                                       |
|                         | EOF 时段未收尾                                                  | 段不强制结算、HP 维持                                            |
|                         | 段内伤害递减（22k→18k）                                         | 增量 = 0、HP 不变                                                |
|                         | finalDamage = 0 (被盾全吸)                                      | segMax 不变、HP 不扣                                             |
| **治疗 executor**       | createHealExecutor 一次性                                       | hp.current += finalHeal、clamp 到 max                            |
|                         | 满血时 cast 治疗                                                | applied = 0、overheal = finalHeal、snapshot 仍写入               |
|                         | hp = 0 时 cast 治疗                                             | applied 正确（"复活"语义）                                       |
|                         | createRegenExecutor 挂状态                                      | tickAmount snapshot 写入 status.data、castEventId 写入           |
|                         | HoT 持续 30s（10 ticks）                                        | 每 3s 网格 +tickAmount、clamp 到 max                             |
|                         | HoT 在 expire 前被治疗顶满                                      | 后续 tick overheal 累计                                          |
|                         | HoT snapshot 不被后挂 buff 影响                                 | tickAmount 在 cast 时锁定                                        |
| **heal / selfHeal**     | 仅 heal buff active                                             | 全队 cast 治疗都 ×heal                                           |
|                         | 仅 selfHeal buff active，sourcePlayer 匹配                      | 治疗 ×selfHeal                                                   |
|                         | 仅 selfHeal buff active，sourcePlayer 不匹配                    | 治疗 ×1（不加成）                                                |
|                         | heal + selfHeal 同时（同一 buff 持有者 cast）                   | 治疗 ×heal×selfHeal                                              |
|                         | heal + selfHeal 同时（非持有者 cast）                           | 治疗 ×heal（selfHeal 跳过）                                      |
| **maxHP buff**          | attach 10% maxHP（非坦专）                                      | hp.max ×1.1、hp.current ×1.1                                     |
|                         | expire 10% maxHP                                                | hp.max 还原、hp.current /1.1、clamp 到 base                      |
|                         | hp.current=80k 时 attach +10%                                   | next current 88k、max 110k                                       |
|                         | hp.current=hp.max 时 attach +10%                                | next current = new max（满血同步上升）                           |
|                         | attach 10% maxHP 但 `isTankOnly=true`                           | hp.max / hp.current 都不变（坦专 maxHP buff 被过滤）             |
| **isTankOnly 过滤**     | heal buff active 但 `isTankOnly=true`，非坦 cast 治疗           | 治疗 ×1（坦专 heal buff 被过滤）                                 |
|                         | selfHeal buff active 且 `isTankOnly=true`，持有者亲自 cast 治疗 | 治疗 ×1（坦专 selfHeal buff 被过滤，不论 sourcePlayer 匹配与否） |
| **overkill / overheal** | aoe finalDamage > hp.current                                    | hp clamp 到 0、overkill 正值、isLethal                           |
|                         | partial delta > hp.current                                      | hp clamp 到 0、overkill 正值                                     |
|                         | 治疗满血时 +amount                                              | applied = 0、overheal = finalHeal                                |
|                         | HoT tick 满血                                                   | applied = 0、overheal = tickAmount                               |
| **同时刻排序**          | cast 与 damage 同 time                                          | cast 优先结算、damage 取治疗后的 hp                              |
| **回放模式**            | timeline.isReplayMode = true                                    | hpSimulation 不填、hp 不演化                                     |
| **坦专路径**            | tankbuster / auto                                               | hp 池零影响、segMax / inSegment 不变                             |
|                         | tankbuster 接 partial_aoe                                       | partial 段不被打断                                               |

### 端到端测试

`src/hooks/useDamageCalculation.test.ts` 新增端到端用例：构造含多次 partial_aoe + pfaoe + cast 治疗 + HoT 的时间轴，断言：

- `damageResults.get(...).hpSimulation.hpAfter` 与手算一致
- `healSnapshots` 顺序、时间、applied / overheal 字段正确
- `healSnapshots` 中 HoT tick 的 `castEventId` 反向溯源到挂 HoT 的 cast

### 已有测试的影响

- `mitigationCalculator.test.ts`：现有用例不带 `partyState.hp`；simulator 应保持向后兼容（hp 为 undefined 时整段跳过演化）。**所有现有用例不变。**
- `useDamageCalculation.test.ts`：partyState 初始化路径加 `hp` 字段，原测试 mock 需补；逻辑断言不变。
- `executors.test.ts`：现有 buff/shield executor 行为不动；只新增治疗类用例。

### 性能

`simulate` 循环复杂度仍为 `O(N events × M statuses)`：`applyDamageToHp` 是 O(1)、`computeFinalHeal` / `computeMaxHpMultiplier` 是 O(M)，整体阶不变。

## 未来工作（不进本期实施）

每条标注未来接入点，避免被当作"应做但漏了"。

| 项                                                   | 接入点 / 留口子位置                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **手动重置锚点**（用户在时间轴某点打"假设此处归满"） | `applyDamageToHp` 主循环；新增 `HpResetMarker` 事件类型加进 `mergedEvents` 排序                     |
| **主时间轴 HP 曲线 overlay**                         | Konva `<SkillTracksCanvas>` / `<Timeline>`；消费 `simulateOutput.hpTrajectory`（待加）              |
| **治疗 cast / HoT tick 详情面板**                    | `PropertyPanel` 当前只响应 damage event；future 加 cast event 路径，展示 `healSnapshots` 中对应条目 |
| **治疗效率统计面板**                                 | 单独面板 / Statistics Dialog；聚合 `Σ overheal / Σ finalHeal`、按 sourcePlayerId / actionId 分组    |
| **段超时自动结算**                                   | `applyDamageToHp` partial 分支前；可加 `if time - lastSegEventTime > N: 段隐式结束`（当前永不超时） |
| **statusExecutor 钩子反向改 HP**                     | `onConsume` / `onBeforeShield` / `onAfterDamage` 已能改写 partyState.hp；本期无业务消费方           |
| **多份 HP 池 / per-player**                          | `partyState.hp` 当前是 `HpPool` 单值；future 可改成 `HpPool[]` 或 `Record<key, HpPool>`             |
