# 部分 AOE 段内延迟扣盾设计

> 日期：2026-04-29
> 范围：`MitigationCalculator` Phase 3 盾值消耗 + 段状态从 `HpPool` 拆出 + partial 段累积

## 背景与目标

当前 `partial_aoe` / `partial_final_aoe` 在 `mitigationCalculator.ts` 的 Phase 3 阶段与 `aoe` 走同一路径——按事件自身 `finalDamage` 实扣 `remainingBarrier`、按需触发 Phase 4 `onConsume`。这导致同一段（segment）内多次 partial AOE 把同一个盾"重复消耗"，与实战机制不符。

实战中：partial AOE 的多次事件命中**不同的非坦子集**。每个被打中的玩家用自己的一份盾吸收一次伤害。"最坏情况下的玩家"挨了段内最大那一下的伤害，他的盾被那一次消耗掉。模型对应到聚合 HP 池的 segMax 累积语义：

- HP 池：段内每条扣 `max(0, finalDamage - segMax)`，`segMax` 跟踪段内最大 finalDamage（盾后）
- 盾值：应**延迟到段结束（`partial_final_aoe`）才一次性扣**，扣的量 = "段内最坏一次"对盾的消耗

本设计实现这个延迟扣盾语义，同时把 segment 状态从 `HpPool` 独立出来（让 `skipHpPipeline` 模式的 PlacementEngine 也能正确处理）。

明确**不在范围**：

- HP 池累积（已实现，沿用 `segMax` / `inSegment` 现有口径）
- 坦专事件（`tankbuster` / `auto`）的盾消耗（与 partial 无关）
- 减伤百分比计算（Phase 1，与盾值无关）

## 核心决策

| 决策                       | 取值                                                                                                                                                          | 原因                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `partial_aoe` 期间盾值行为 | Phase 3 read-only：算 `absorbed` 给 finalDamage 显示，但不扣 `remainingBarrier`、不触发 Phase 4                                                               | 玩家在卡片上看到"盾在段内每次都顶住"；但盾在物理层面只对应"被打中最重那个玩家挨的一下"           |
| 段累积器追踪量             | `segCandidateMax`（盾**前** candidateDamage 段最大）                                                                                                          | read-only Phase 3 下 finalDamage 已被盾减过，max(finalDamage) 在盾够大时恒为 0，无法驱动结算扣盾 |
| `partial_final_aoe` 结算量 | `max(自身 candidateDamage, segCandidateMax)`                                                                                                                  | 段内最坏一次对盾的消耗；replay Phase 3 mutation 阶段                                             |
| `partial_final_aoe` 显示量 | 自身 `candidateDamage` - 自身 `absorbed`（与 partial_aoe 一致）                                                                                               | `event.damage`（用户输入）是单一权威；扣盾差异留给"下一事件"自然体现                             |
| Phase 4 `onConsume` 触发点 | 仅在 partial_final_aoe 结算时触发，按 settlement 实际扣的盾                                                                                                   | 与"延迟消耗"语义自洽；段内不会重复触发                                                           |
| 段状态存储位置             | 新建 `partyState.segment: { inSegment, segMax, segCandidateMax }`，从 `HpPool` 拆出                                                                           | `skipHpPipeline` 模式（engine）下 hp 为 undefined，但盾消耗仍要走延迟逻辑；段状态独立于 HP 池    |
| 现存 `HpPool` 字段         | 只剩 `{ current, max, base }`                                                                                                                                 | 职责单一：HP 池上限/当前；段累积归 `segment`                                                     |
| 段中断条件                 | `aoe` / `partial_final_aoe` 之后 `inSegment = false`，下一个 partial\_\* 进入新段时清零 `segMax` 与 `segCandidateMax`；`tankbuster` / `auto` 段穿透（不入池） | 与现状 segMax 重置规则对齐                                                                       |
| 单事件 `calculate` 入口    | 仍按事件自身 candidateDamage 走 Phase 3 mutation；不感知段状态                                                                                                | PropertyPanel / 单事件复算入口没有段上下文；保留旧行为，仅 `simulate` 主循环维护段语义           |

## 数据模型

### `src/types/partyState.ts`

```ts
/**
 * 非坦聚合 HP 池（编辑模式专用）
 * 仅模拟非坦克玩家共享的最低参考血量。
 * 段累积器（segMax / inSegment / segCandidateMax）独立放在 PartyState.segment。
 */
export interface HpPool {
  current: number
  max: number
  base: number
}

/**
 * 段累积状态（partial AOE 段内）。
 * 与 HpPool 解耦：skipHpPipeline 模式下 hp 为 undefined，但 segment 仍需维护
 * 以驱动延迟扣盾。
 */
export interface SegmentState {
  /** 是否处于 partial 段内（aoe / partial_final_aoe 收尾或时间轴起始时为 false） */
  inSegment: boolean
  /** 段内已观察到的最大 finalDamage（盾后），驱动 HP 池扣血增量 */
  segMax: number
  /**
   * 段内已观察到的最大 candidateDamage（盾前），驱动 partial_final_aoe 结算扣盾量。
   * 跟 segMax 区分：read-only Phase 3 下 finalDamage 已被盾减，max(finalDamage)
   * 不能反映"最坏一次对盾的消耗"。
   */
  segCandidateMax: number
}

export interface PartyState {
  statuses: MitigationStatus[]
  timestamp: number
  hp?: HpPool
  /**
   * 段累积状态。simulate 主循环初始化为 { inSegment: false, segMax: 0, segCandidateMax: 0 }。
   * 单事件 calculate 入口不读不写。
   */
  segment?: SegmentState
}
```

`segment` 标记为可选，与 `hp` 对偶——`simulate` 入口初始化，`calculate` 单事件入口可不传。

## 行为变更

### Phase 3 改造

`runSingleBranch` 在 Phase 3 区分事件类型：

- `event.type === 'partial_aoe'`：**read-only 路径**
  - 遍历 active shield 计算 `absorbed`、累加到 `appliedStatuses`、计算 `playerDamage`
  - **不**生成 `statusUpdates`、**不**收集 `consumedShields`、`updatedPartyState.statuses` 不修改盾的 `remainingBarrier`
  - 返回的 `finalDamage = candidateDamage - absorbed`（与现状一致，盾在显示上参与）

- `event.type === 'partial_final_aoe'`：**显示 + 结算两阶段**
  - 阶段 1（显示）：与 partial_aoe 同样的 read-only 路径，产出本事件 `finalDamage` / `appliedStatuses`
  - 阶段 2（结算）：以 `effectiveDamage = max(event 自身 candidateDamage, segCandidateMax)` 重跑一遍 Phase 3 mutation 子流程，按 startTime 顺序对 active shield 实扣 `remainingBarrier`、生成 `statusUpdates`、收集 `consumedShields`
  - 阶段 2 的结果合并到 `updatedPartyState`：盾值更新、`removeOnBarrierBreak: true` 的实例自动清除
  - Phase 4 `onConsume` 跑阶段 2 收集的 `consumedShields`

- `event.type === 'aoe' / 'tankbuster' / 'auto'`：保持现状（一次性 mutation + Phase 4）

### segment 状态维护

`segment` 字段全部读写集中在 `applyDamageToHp` 内（与 `segMax` 现状对称）。`applyDamageToHp` 签名扩展加 `candidateDamage` 参数：

```
applyDamageToHp(state, event, finalDamage, candidateDamage) -> { nextState, snapshot }
```

简化伪码：

```
处理事件 ev：
  // calculate 内部读 currentState.segment.segCandidateMax（partial_final_aoe 阶段 2 用）
  result = calculate(ev, currentState, ...)
  // 此时 result.candidateDamage 是本事件的 candidate

  // 更新 partyState（含盾 mutation）
  if result.updatedPartyState: currentState = result.updatedPartyState

  // applyDamageToHp 用 segment 字段，且更新 segCandidateMax
  applyDamageToHp(currentState, ev, result.finalDamage, result.candidateDamage):
    若 ev.type ∈ {tankbuster, auto}:
      早返回，segment 不动

    若 ev.type === 'aoe':
      dealt = finalDamage
      segment = { inSegment: false, segMax: 0, segCandidateMax: 0 }

    若 ev.type ∈ {partial_aoe, partial_final_aoe}:
      若 !segment.inSegment:
        segment = { inSegment: true, segMax: 0, segCandidateMax: 0 }
      dealt = max(0, finalDamage - segment.segMax)
      segment.segMax = max(segment.segMax, finalDamage)
      segment.segCandidateMax = max(segment.segCandidateMax, candidateDamage)
      若 ev.type === 'partial_final_aoe':
        段结束 → segment = { inSegment: false, segMax: 0, segCandidateMax: 0 }
```

注意时序：`calculate` **先**于 `applyDamageToHp` 调用。`runSingleBranch` 读到的 `segment.segCandidateMax` 是"上一事件 applyDamageToHp 后"的值，即"段内之前所有 partial_aoe 的 max"，不含本事件。partial_final_aoe 在 `effectiveDamage = max(本事件 candidateDamage, segCandidateMax)` 中把本事件并进来，等价于"含本事件的段最大"。

### `calculate` 接口变化

`runSingleBranch` 需要知道 `segCandidateMax` 才能在 `partial_final_aoe` 阶段 2 算 `effectiveDamage`。两种传递方式：

- **方案 1**：`partyState.segment.segCandidateMax` 由 simulate 主循环写好，runSingleBranch 直接读
- **方案 2**：通过 `CalculateOptions.segCandidateMax` 显式传入

采用**方案 1**——segment 已经在 partyState 上，自然读；不增加 opts 字段。

`calculate` 单事件入口（PropertyPanel 用）不维护 segment，读到的 `segment` 通常为 undefined 或不可信。runSingleBranch 在阶段 2 兜底：`effectiveDamage = max(candidateDamage, partyState.segment?.segCandidateMax ?? 0)` —— 单事件入口传不传都不报错；不传时 `effectiveDamage = candidateDamage`，结算扣盾按事件自身值，与 aoe 行为一致（约等于"单事件场景假设这是个独立 partial_final_aoe"）。

## 文件改动

### 类型 / 数据

- `src/types/partyState.ts`：拆 `HpPool`，新增 `SegmentState`，`PartyState` 加 `segment`

### 核心逻辑

- `src/utils/mitigationCalculator.ts`：
  - `applyDamageToHp`：签名加 `candidateDamage` 参数；读写 `state.segment` 而非 `state.hp.segMax / inSegment`；维护 `segCandidateMax`（partial_aoe / partial_final_aoe 时累加，aoe / partial_final_aoe 完结时清零）；返回 `{ nextState, snapshot }` 接口不变
  - `runSingleBranch` Phase 3 按 `event.type` 分流：partial_aoe read-only / partial_final_aoe 显示 + 结算（结算读 `partyState.segment?.segCandidateMax`）/ 其他保持
  - `simulate` 主循环：
    - 初始化 `currentState.segment = { inSegment: false, segMax: 0, segCandidateMax: 0 }`
    - `applyDamageToHp` 调用处补传 `result.candidateDamage`

### 测试

- `src/utils/mitigationCalculator.test.ts`：
  - 既有"HP 池演化 - partial 段累积"组（行 1457 起）：断言迁移到 `state.segment.segMax`，行为不变
  - 现有 PartyState 构造（含 hp 池）：`hp.segMax / hp.inSegment` 字段移除；新增 `segment` 字段在需要的用例里手工构造
  - 新增"partial 段延迟扣盾"组：
    - partial_aoe 期间 `remainingBarrier` 不变
    - partial_final_aoe 按 `max(自身 cd, segCandidateMax)` 扣盾
    - 单 partial_final_aoe（无前置 partial_aoe）退化为按自身 cd 扣盾（与 aoe 等价）
    - 多盾按 startTime 顺序在结算时被消耗
    - Phase 4 onConsume 仅在 partial_final_aoe 结算时触发，且 absorbedAmount 反映实扣量
    - 段被 aoe 打断后，下一段重置 segCandidateMax
    - removeOnBarrierBreak: true 的盾在结算被打穿时自动从 statuses 移除
- 其他用到 `HpPool` 字段的测试文件（`createRegenExecutor.test.ts` / `useDamageCalculation.test.ts` / `createHealExecutor.test.ts`）：随类型层重构同步把 `hp.segMax / hp.inSegment` 删除，无需改语义

## 边界 / 已知非目标

- **段中途新增的盾**：在 partial 段中途 cast 出的新盾，结算时按 segCandidateMax（含早期 partial_aoe）扣，可能略微过扣（早期 partial_aoe 那个玩家本不该有这个盾）。属于聚合 HP 模型的固有简化，不修复
- **段中途过期的盾**：`advanceToTime` 在事件前自然剔除过期盾；剔除后即不参与结算，符合预期
- **`onBeforeShield` 钩子挂的 transient barrier**：Phase 2 在 partial_aoe 也跑，可能附加一个 transient barrier。read-only Phase 3 不消费它，barrier 在 statuses 中保留——下个事件 Phase 2 重跑时各执行器自行决定是否重复挂（执行器本身可检查"已存在则跳过"）。本设计不为此特化；执行器现有语义沿用
- **单事件 `calculate` 路径**：PropertyPanel / 单事件复算调用 `calculator.calculate` 时无段上下文，`segCandidateMax` 缺省 0，partial_final_aoe 退化为按自身 cd 扣盾。可接受——单事件视图本就是孤立判定
- **多坦路径**：`tankbuster` / `auto` 不会是 partial\_\*，多坦分支 Phase 3 改动只跟着把 `state.hp.segMax → state.segment.segMax` 字段名换掉，不引入新逻辑

## 实施顺序

1. 类型层：拆 `HpPool` / 新增 `SegmentState` / `PartyState.segment`
2. `applyDamageToHp` 迁移到读写 `state.segment`；既有测试断言改字段路径
3. `simulate` 初始化 `segment`；移除 `HpPool.segMax / inSegment` 旧字段的初始化
4. `runSingleBranch` Phase 3 按 event.type 分流（partial_aoe read-only / partial_final_aoe 两阶段）
5. `simulate` 主循环：partial_aoe / partial_final_aoe 时累加 `segCandidateMax`；partial_final_aoe 结算后清零
6. 新增测试：partial 段延迟扣盾各场景
7. `pnpm test:run` / `pnpm exec tsc --noEmit` / `pnpm lint` 全绿
