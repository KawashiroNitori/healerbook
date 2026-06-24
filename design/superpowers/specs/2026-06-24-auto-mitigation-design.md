# 自动放置减伤技能优化器（auto-mitigation）设计

> 状态：已评审，待实现
> 日期：2026-06-24
> 分支：feat/auto-mitigation

## 1. 目标

提供一个算法，自动为时间轴放置全队减伤技能，达成两级目标：

1. **硬约束（可行性）**：每个 in-scope 的 AOE 伤害事件减伤后**不致死**。
2. **软目标（最优性）**：在满足硬约束的前提下，**最小化所有 in-scope 事件 `finalDamage` 的总和**。

两级解耦：硬约束与软目标互不依赖，**软目标永远执行**（即便没有满血基准、或全部事件本就不致死，仍会继续压低总伤、用满 CD）。技能"利用率最大化"是软目标的自然副产物，而非独立目标。

### in-scope 事件定义（一处定义，贯穿全程）

```
inScope(e) = isAoeType(e.type) && e.damage < 1_000_000 && !e.targetMitigationDisabled
isAoeType(t) = t ∈ { 'aoe', 'partial_aoe', 'partial_final_aoe' }
```

坦专事件（`tankbuster` / `auto`）与原始伤害 ≥ 1,000,000 的超大机制/狂暴不在范围内。

## 2. 非目标（YAGNI）

- 不做累积 HP 时间线视角的致死判定（本版用单段独立口径，见 §4）。
- 不做坦专 / 多坦分支的自动放置。
- 不做 ILP / 精确最优求解。
- 不做跨战斗的全局策略或多套方案对比。

## 3. 总体架构与模块边界

新增独立、纯函数、无 React/DOM 依赖的优化器模块，与 `placement/`、`resource/` 平级，跑在 calculator worker 内：

```
src/utils/autoMitigation/
├── types.ts          # OptimizeInput / OptimizeOutput / Candidate / Move
├── candidates.ts     # 候选生成：getValidIntervals × 事件时刻 → Candidate[]
├── evaluate.ts       # 评估器：封装 simulate(skipHpPipeline)，算可行性 & Σ伤害
├── optimizer.ts      # 主流程：feasibility → minimize → localSearch 三阶段
├── moves.ts          # 局部搜索邻域：add / remove / move / swap / replace
└── optimizer.test.ts # 及各单元同目录 *.test.ts
```

**定位说明**：本项目的 `src/utils/` 是事实上的"纯计算 / 领域引擎层"（`mitigationCalculator.ts`、`placement/`、`resource/`、`lethalDanger.ts` 等都在此）。优化器直接架在 `placement/` + `resource/` + `mitigationCalculator` 之上，三者皆在 `utils/`，故 `autoMitigation/` 与之平级，依赖方向最顺。

**职责边界：**

| 单元         | 输入                                  | 输出                                | 依赖                          |
| ------------ | ------------------------------------- | ----------------------------------- | ----------------------------- |
| `candidates` | actions、composition、PlacementEngine | 每 (action,player) 的合法候选时间点 | placement/\*                  |
| `evaluate`   | castEvents 集合                       | `{ total, perEvent, lethalEvents }` | mitigationCalculator.simulate |
| `optimizer`  | OptimizeInput                         | OptimizeOutput                      | candidates / evaluate / moves |
| `moves`      | 当前解 + candidates                   | 邻域动作列表                        | candidates                    |

**与现有代码的衔接（复用，绝不重造）：**

- 合法性（CD / 资源 / placement 约束）一律走 `createPlacementEngine` 的 `getValidIntervals` / `canPlaceCastEvent`。
- 评估真值一律走 `MitigationCalculator.simulate`，开 `skipHpPipeline`。
- 致死判定一律复用 `deriveLethalDangerous`（`lethalDanger.ts`），优化器成为它的第 4 个消费方，与 PropertyPanel / 卡片 / 表格口径一致、防漂移。
- 写回严格遵守 `CastEvent` 结构，`actionId` 存 trackGroup 父 id，变体交运行时 `resolveVariant`。

## 4. 核心接口与数据流

### 类型（`types.ts`）

```typescript
interface OptimizeInput {
  damageEvents: DamageEvent[]
  lockedCastEvents: CastEvent[] // 用户已放、固定不动；空白入口 = []
  composition: Composition // 派生玩家可用技能池 + tankPlayerIds
  actions: Map<number, MitigationAction>
  initialState: PartyState
  statistics?: SimulateInput['statistics']
  baseReferenceMaxHPForAoe?: number // 与 useDamageCalculation 同源；缺省时阶段 1 空跑
  baseReferenceMaxHPForTank?: number
  options?: { timeBudgetMs?: number; seed?: number } // 默认 timeBudgetMs ≈ 3000
}

interface OptimizeOutput {
  addedCastEvents: CastEvent[] // 优化器新增放置，供前端预览/应用
  infeasibleEvents: Array<{
    eventId: string
    originalDamage: number
    bestAchievedFinalDamage: number
  }>
  summary: {
    totalDamageBefore: number // 仅 lockedCastEvents 时的 Σ finalDamage
    totalDamageAfter: number
    castsAdded: number
    elapsedMs: number
  }
}
```

### 数据流（一次 optimize）

```
OptimizeInput
   ├─ candidates.generate() → 每 (action,player) 用 getValidIntervals，与 in-scope 事件时刻取交、
   │                          snap 成候选起点 → Candidate[]
   ├─ evaluate.create()     → evaluator：给定 castEvents，调 simulate(skipHpPipeline)，
   │                          逐事件读 referenceMaxHP / finalDamage，返回 { total, perEvent, lethalEvents }
   └─ optimizer.run()       → 三阶段（§5）→ OptimizeOutput → addedCastEvents 写回 timeline.castEvents
```

### 候选时间离散化

一个减伤覆盖 `[t, t+duration]`，最优起点只需落在"覆盖窗口刚好罩住某伤害事件"的点上：

```
candidateStarts(action, player) =
  { e.time | e ∈ inScopeEvents } ∩ getValidIntervals(action, player)
  ∪ { 合法窗口右沿 - ε }（覆盖"尽量晚放仍罩住事件"的情形）
```

把连续时间压成每技能 O(in-scope 事件数) 个候选。

### 关键不变量

- 优化器**只增不改** `lockedCastEvents`；`addedCastEvents` 用 `id.ts` 生成独立新 id。
- 试探一个候选 = 把它并入 `[...locked, ...currentAdds, candidate]` 重新 `simulate`；先过 `canPlaceCastEvent` 再 simulate，避免无效评估。
- evaluator 以"当前已接受解"为基线缓存；试探失败回滚不改状态（纯函数，天然可回滚）。

## 5. 优化器三阶段算法

### 判定口径（与主程序一致）

复用 `deriveLethalDangerous`。因开 `skipHpPipeline`（无 `hpSim`），落到 refHP fallback 分支：

- **硬约束（可行性）**：in-scope 事件 `deriveLethalDangerous(undefined, finalDamage, referenceMaxHP, hasOverkill).isLethal === false`，即 `finalDamage < referenceMaxHP`。
- **软目标**：`Σ finalDamage`（over in-scope 事件）最小。

可行性与目标函数统一用 `finalDamage` 单口径。

### 流程

```
run(input):
  base  = evaluate([...locked])           # 基线
  cands = candidates.generate(...)
  added = []

  # ── 阶段 1：可行性（条件性，可能 no-op）──────────────
  #   无 refHP 或无致死事件时整体跳过
  while ∃ in-scope 事件 e, isLethal(e):
      e    = argmax_e (finalDamage(e) / referenceMaxHP(e))   # 最致死优先
      pick = argmax_{c∈cands, c 合法 & 覆盖 e} Δ(降低 e.finalDamage)
      if pick 不存在:
          infeasibleEvents.add(e); 标记 e 已尽力，跳过
      else:
          added.push(pick); 重新 evaluate; 更新 cands 合法性

  # ── 阶段 2：边际贪心最小化总伤（无条件执行）─────────
  loop:
      move = argmax_{add c} ΔTotal(c)       # 仅在保持可行下
      if ΔTotal(move) <= 0: break           # 无正收益
      added.push(move.cast); 重新 evaluate; 更新 cands

  # ── 阶段 3：局部搜索精修（吃满剩余预算）──────────────
  best = added
  while elapsed < timeBudget:
      m = 邻域采样(move/swap/replace/remove+add)    # moves.ts，确定性 PRNG
      if m 保持可行 且 ΔTotal(m) > 0: 接受
      elif 退火接受准则: 接受                         # 轻度随机重启跳出局部最优
      if 当前优于 best: best = 当前快照
  return { addedCastEvents: best, infeasibleEvents, summary }
```

### 邻域算子（`moves.ts`，"明显更优"的来源）

- `move`：已放 cast 平移到邻近更优窗口（罩住更高伤害事件）
- `swap`：某事件改由另一玩家/技能覆盖，腾出更稀缺 CD
- `replace`：用更强或更省的减伤替换当前覆盖
- `remove+add`：撤掉边际为负/冗余放置，重投他处

### 工程约束

- **随机性**：worker 上下文 `Math.random()` 受限，退火/重启用**确定性 PRNG**（`options.seed` 播种，如 mulberry32），可复现且规避限制。
- **复杂度护栏**：每步只重 `simulate` 一次（`skipHpPipeline`）；候选数 ≈ 技能数 × in-scope 事件数。阶段 1/2 在单场战斗（数十事件、十余减伤）几秒内可完成；阶段 3 吃满剩余预算爬山。预算到点必返回**历史最优解**，不退化。

## 6. UX 接入与写回契约

### Worker 侧

`src/web-workers/calculator/` 新增 `optimize(input): Promise<OptimizeOutput>`，与 `simulate` 并列。

**关键**：现有 `simulate` client 会 silent-drop 过期请求（只 resolve 最新一次），不适合优化器内循环的成百上千次评估。故优化器**整体跑在 worker 内，直接调进程内 `createMitigationCalculator().simulate(...)`**——一次 `optimize` 消息进、一个 `OptimizeOutput` 出，绕开 stale-drop 并省跨线程开销。可选支持进度回调与 `cancel`。

### 前端流程（EditorPage，仅 `local` / `author` 可编辑模式）

```
[自动减伤] 按钮
   │ 收集 OptimizeInput（damageEvents、当前 castEvents 作 locked、composition、actions、
   │                    baseReferenceMaxHPForAoe —— 全部与 useDamageCalculation 同源）
   ▼
worker.optimize(input)  ──进度条 + 可取消──▶  OptimizeOutput
   ▼
预览态：addedCastEvents 以"幽灵/高亮"叠加在时间轴上（不直接落库）
   ├─ summary 卡片：总伤 before→after、新增技能数、耗时
   ├─ infeasibleEvents 警告：列出"救不了的事件"（可点击定位）
   ▼
[应用] → 一次批量 addCastEvents（单 undo 单元，走 Yjs）   |   [放弃] → 丢弃预览
```

### 写回契约（硬性）

- 每条 `addedCastEvent` = `{ id: 新生成, actionId: trackGroup 父 id, timestamp, playerId }`；变体不写死，交运行时 `resolveVariant`。
- `lockedCastEvents` 一字不改，只追加。
- 批量应用 = **单个撤销单元**，可一键 Undo 整次优化（走 Yjs `y*CastEvent`，避免碎成数十步）。

### 模式与边界

- `view`（他人只读）隐藏入口；按钮**不因缺满血基准而禁用**。
- 无 `baseReferenceMaxHPForAoe` 或全部事件本就不致死：阶段 1 空跑，阶段 2/3 照常压总伤；summary 如实说明（如"无致死风险，已纯做总伤优化"或"未加任何 cast，已是局部最优"）。

## 7. 测试策略

各单元同目录 `*.test.ts`（Vitest）：

- **候选生成**：假 PlacementEngine，验证候选点 = 合法窗口 ∩ 事件时刻，边界（窗口右沿、零宽窗口）正确。
- **可行性阶段**：致死 AOE + 可救减伤 → 优化后 `finalDamage < refHP`；无解事件 → 落入 `infeasibleEvents`；无 refHP → 阶段 1 空跑不报错。
- **最小化阶段**：两减伤 + 两不同伤害事件 → 强减伤盖在高伤害事件上（贪心方向正确）；不破坏 locked casts。
- **资源/CD 正确性**：借真实 PlacementEngine + 真实 `simulate`，断言放置不违反 CD/资源池；变体由 `resolveVariant` 正确派生。
- **确定性**：同 `seed` → 同结果。
- **收敛/预算**：`timeBudgetMs` 到点必返回，且为历史最优解（不退化）。
- **写回契约**：`addedCastEvents` 结构合法、id 唯一、`actionId` 为 trackGroup 父 id。

集成用例：真实 `MITIGATION_DATA` + 一段真实导入 timeline，跑 `optimize`，断言总伤下降且 `findInvalidCastEvents` 无非法 cast。

## 8. 复用资产清单

| 资产                            | 文件                            | 用途                                      |
| ------------------------------- | ------------------------------- | ----------------------------------------- |
| `MitigationCalculator.simulate` | `utils/mitigationCalculator.ts` | 评估真值（`skipHpPipeline`）              |
| `createPlacementEngine`         | `utils/placement/engine.ts`     | `getValidIntervals` / `canPlaceCastEvent` |
| 区间代数                        | `utils/placement/intervals.ts`  | 候选窗口求交/补                           |
| `deriveLethalDangerous`         | `utils/lethalDanger.ts`         | 致死口径（防漂移）                        |
| `findInvalidCastEvents`         | `utils/placement/engine.ts`     | 集成测试校验                              |
| `id` 生成                       | `utils/id.ts`                   | 新 cast id                                |
| calculator worker client        | `web-workers/calculator/`       | 新增 `optimize` 入口                      |
| 批量加 cast                     | `store/timelineStore.ts`        | 单 undo 单元写回                          |
