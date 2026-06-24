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
  options?: {
    timeBudgetMs?: number // 默认 ≈ 3000
    seed?: number // 确定性 PRNG 播种
    aggressive?: boolean // 启发剪枝总开关（§8.8 B 类）；默认 true，false = 保守仅安全剪枝
  }
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

### 候选时间离散化（断点集）

一个减伤覆盖半开窗口 `[s, s+d)`（`d = duration`，与 `StatusInterval` 半开一致）。事件 `e` 被覆盖 ⟺ `s ≤ e.time < s+d` ⟺ `s ∈ (e.time − d, e.time]`。把放置价值看作 `s` 的函数 `V(s)`，它**只在有限个断点处变化**，断点集 `B(action, player)`：

```
B = Bcov ∪ Bvar ∪ Bwin
  Bcov = { e.time : e∈inScope } ∪ { e.time − d + ε : e∈inScope }   # 覆盖事件集变化点（进/出）
  Bvar = { 各 status 区间端点 }                                     # 触发 resolveVariant / suppressedByStatus 价值跳变的点
  Bwin = { getValidIntervals(action,player) 各区间端点 }            # 合法性边界
candidateStarts = clampIntoLegal(B) ∩ getValidIntervals(action, player)
```

- `Bcov`：滑动窗口时，事件在 `s = e.time` 处离开覆盖、在 `s = e.time − d`（半开，故取 `+ε`）处进入覆盖——`V` 仅在此跳变。
- `Bvar`：技能变体/资源豁免依赖**当时存在的 buff 窗口**（如"在某 buff 内更强/免费"），其价值跳变发生在那些 buff 区间端点，必须纳入断点，否则会漏掉强力变体的最优落点。
- `Bwin`：合法窗口端点本身。
- `clampIntoLegal`：把断点夹入合法窗口（落在窗口内或贴合左端），落在非法区间的断点丢弃。

**为何无损**见 §8 引理 1。候选数 = `O((事件数 + buff 区间数) × 技能数)`，单场战斗量级仍是几百级别。

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
- **复杂度护栏**：每步只重 `simulate` 一次（`skipHpPipeline`）；候选数见 §4 断点集。完整时空复杂度与瓶颈见 §8.7——**朴素阶段 2 全量探测会超几秒预算，必须配 CELF 惰性贪心 + 增量 evaluate + 候选剪枝**；阶段 3 吃满剩余预算爬山。预算到点必返回**历史最优解**，不退化。

### 核心子程序与数据结构

优化器维护一个可增量推进、可回滚的 **SolutionState**：

```typescript
interface SolutionState {
  added: CastEvent[] // 当前已接受的新增放置
  eval: EvalResult // = evaluate([...locked, ...added]) 的缓存
}
interface EvalResult {
  total: number // Σ finalDamage（over in-scope）
  perEvent: Map<eventId, { finalDamage: number; referenceMaxHP?: number; hasOverkill: boolean }>
  lethal: Set<eventId> // deriveLethalDangerous(...).isLethal === true 的 in-scope 事件
}
```

**`evaluate(casts): EvalResult`** —— 唯一的真值来源。调 `simulate({ castEvents: casts, damageEvents, initialState, baseReferenceMaxHPForAoe, ..., skipHpPipeline: true })`，遍历 `damageResults`，对 in-scope 事件读 `finalDamage` / `referenceMaxHP`，用 `deriveLethalDangerous` 填 `lethal`。**纯函数**：不读写外部状态，故试探天然可回滚（丢弃返回值即可）。

**`probe(state, cast): { ok: boolean; next?: EvalResult }`** —— 试探一个候选：

1. **合法性闸**：`canPlaceCastEvent(action, player, cast.timestamp, /*exclude*/ none)`；不合法直接 `ok:false`，**不进 simulate**（省一次最贵的调用）。
2. `next = evaluate([...locked, ...state.added, cast])`。
3. 返回 `next`，由调用方决定是否接受（接受 = `state.added.push(cast); state.eval = next`）。

**边际增益 Δ**（阶段 2/3 的打分函数）：

```
ΔTotal(state, cast)        = state.eval.total − probe(state, cast).next.total      # >0 表示降伤
ΔEvent(state, cast, e)     = state.eval.perEvent[e].finalDamage
                             − probe(state, cast).next.perEvent[e].finalDamage     # 阶段 1 用，仅看目标事件 e
```

**`recomputeLegality`（更新 cands）** —— 接受一个 cast 后，它消耗某资源池 / 触发某 buff 变体，会改变**其他候选**的合法窗口。实现：接受后对受影响的 `(player, resourceId)` 维度，用 PlacementEngine 以新的 `added` 重建 `getValidIntervals`，刷新候选可用标志。其余候选不动（局部失效，避免全量重算）。

**增量评估（可选优化，非首版必需）**：`evaluate` 默认全量 `simulate`。因加入一个 cast 只影响其覆盖窗口内事件 + 下游资源段，可缓存"未受影响事件"的 `finalDamage`，仅重算受影响子集。**等价性前提**：减伤为乘算、盾为按时间序减算，受影响集 = 覆盖窗口 ∪ 资源透支下游段。首版先用全量保正确，性能不足再引入增量并以"全量 == 增量"做差分测试。

**阶段 1 的"覆盖 e 的候选"**：`cands` 按覆盖区间建索引 `coveringCands(e) = { c : c.start ≤ e.time < c.start + c.duration }`，`argmax ΔEvent` 仅在该子集上取，避免每个致死事件扫全部候选。

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

- **候选生成**：假 PlacementEngine，验证候选断点集 = `Bcov ∪ Bvar ∪ Bwin` 夹入合法窗口（§4）；覆盖半开边界（`e.time − d + ε`）、buff 区间端点、零宽窗口等情形。
- **可行性阶段**：致死 AOE + 可救减伤 → 优化后 `finalDamage < refHP`；无解事件 → 落入 `infeasibleEvents`；无 refHP → 阶段 1 空跑不报错。
- **最小化阶段**：两减伤 + 两不同伤害事件 → 强减伤盖在高伤害事件上（贪心方向正确）；不破坏 locked casts。
- **资源/CD 正确性**：借真实 PlacementEngine + 真实 `simulate`，断言放置不违反 CD/资源池；变体由 `resolveVariant` 正确派生。
- **确定性**：同 `seed` → 同结果。
- **收敛/预算**：`timeBudgetMs` 到点必返回，且为历史最优解（不退化）。
- **写回契约**：`addedCastEvents` 结构合法、id 唯一、`actionId` 为 trackGroup 父 id。

针对 §8 各保证的性质测试（property test）：

- **健全性 I1**（§8.1）：随机构造放置序列，每次接受后断言 `findInvalidCastEvents = ∅`；构造资源争用使后插 cast 让先插 cast 变非法 → 断言该接受被拒绝/回滚。
- **可行性单调 I2**（§8.1）：随机 move，断言接受后 `lethal ⊆` 接受前 `lethal`（不新增致死）。
- **引理 1 无损**（§8.2）：固定其余 cast，在同一断点开区间内随机取多个 `s`，断言 `total` 全等；跨断点取点断言 `total` 改变。
- **可行性非完备的诚实性**（§8.4）：构造一个"贪心会漏、但存在可行解"的小场景，断言落入 `infeasibleEvents` 且文案为"未能覆盖"而非"不可能"；并验证阶段 3 惩罚项能在足够预算下修复它。
- **剪枝安全性**（§8.8）：A 类安全剪枝（支配/对称/局部失效）开关前后断言**同解**；启发剪枝差分——`aggressive=true` 的总伤 `≥` `aggressive=false`（保守）×(1−容差)，量化最优性损失。

集成用例：真实 `MITIGATION_DATA` + 一段真实导入 timeline，跑 `optimize`，断言总伤下降且 `findInvalidCastEvents` 无非法 cast。

## 8. 正确性论证与保证边界

记一个解 `X = L ∪ A`（`L` 锁定 cast，`A` 新增 cast）。目标写成"降伤量"`f(A) = total(L) − total(L ∪ A)`（越大越好）。可行性谓词 `feasible(X)` ⟺ 每个 in-scope 事件 `deriveLethalDangerous(...).isLethal === false`。

### 8.1 健全性（Soundness）—— 输出永远合法、永不恶化可行性

构造性维护两个不变量：

- **(I1 合法)** 每次接受一个 cast 前过 `canPlaceCastEvent`；接受后对整个 `A` 跑一次 `findInvalidCastEvents`（比 simulate 便宜），**若任一已接受 cast 因新增的资源争用而变非法，则拒绝本次接受并回滚**。故任一时刻 `A` 全合法。最终输出再被集成测试断言 `findInvalidCastEvents = ∅`。
- **(I2 可行性单调)** 阶段 2/3 的接受条件显式要求 `probe.next.lethal ⊆ state.lethal`（不新增致死事件）。阶段 1 只接受使目标致死事件降伤的 cast。

**结论**：任何返回的 `best` 都合法，且其致死集 ⊆ 阶段 1 结束时的致死集（即 `infeasibleEvents`）。即优化器**不会把一个本可不致死的事件变致死，也不会输出非法 cast**。这两条是可证的硬保证。

### 8.2 离散化无损（引理 1）

**引理 1（单 cast 断点无损）**：固定其余所有 cast，仅移动一个 cast 的起点 `s` 于某合法窗口内。则 `total` 作为 `s` 的函数，在 §4 断点集 `B` 划分出的每个开区间内为常数。

**证明**：`total = Σ_e finalDamage_e`。`simulate` 决定的 `finalDamage_e` 只依赖于「`e.time` 时刻活跃的 status 集合、各 status 的 performance/变体、盾的时序」。移动该 cast 的 `s` 仅通过三条途径影响某个 `e`：(a) 此 cast 的 buff 是否覆盖 `e` —— 仅在 `s` 跨 `Bcov` 时变；(b) 此 cast 自身 resolved 变体 / 资源豁免 —— 仅在 `s` 跨 `Bvar`（其他 buff 区间端点）时变；(c) 合法性 —— `Bwin`。三者皆 ⊆ `B`。`s` 在区间内变动不跨断点 ⟹ 每个 `finalDamage_e` 不变 ⟹ `total` 不变。∎

**推论**：在每个区间取一代表点（取断点本身夹入合法窗口）即可无损枚举该 cast 的全部可达 `total`。故"只在断点集放置"不丢任何单 cast 的可达目标值。边界：半开窗口 ⟹ `Bcov` 用 `e.time − d + ε`；`clampIntoLegal` 保代表点合法。

> 注意引理 1 是**单 cast、固定其余**的逐坐标无损，它保证邻域算子（move/replace）不会因离散化错过更优落点；它**不**蕴含多 cast 联合最优（见 §8.3/8.4）。

### 8.3 阶段 2 贪心的近似保证（理想化）与失效项

**命题**：在"纯乘算百分比减伤、变体固定、忽略盾"的理想化下，`f(A) = Σ_e D_e·(1 − Π_{m∈cover(e)∩A}(1−r_m))` 关于集合 `A` **单调非减且次模（submodular）**；CD/资源约束构成**划分拟阵**（每个 `(player,resourceId)` 池限制可取充能数）。

- _单调_：多放一个减伤不增加伤害。
- _次模（边际递减）_：单事件 `e` 加入 `m` 的边际降伤 `= D_e·Π_{S∩cover(e)}(1−r)·r_m`，随 `S` 增大而 `Π` 缩小 ⟹ 边际递减；对 `e` 求和保持次模。
- _经典结论_：单调次模 + 拟阵约束下，贪心（阶段 2 的 argmax 边际增益）有 **1/2 近似**；约束退化为单池基数约束时为 **1 − 1/e ≈ 0.63**。

这给阶段 2 一个**可证的质量下界（理想化下）**。诚实声明三个失效/扰动项——正是阶段 3 要补的：

1. **盾是减算且封顶**（吸收 `min(barrier, dmg)`、`removeOnBarrierBreak`）——破坏纯乘算次模性。
2. **条件变体 / 资源豁免**（`suppressedByStatus`、秘策免费暴击）——cast 价值依赖另一 cast 是否在场，引入协同，破坏次模。
3. **跨事件耦合 + locked 背景**——真值由 `simulate` 给出，闭式仅近似。

故阶段 2 给"理想化有界、真值上接近"的起点，阶段 3 局部搜索消化扰动项逼近真·最优。

### 8.4 可行性的完备性边界（诚实声明）

阶段 1 贪心**不是完备的可行性求解器**——它可能找不到一个其实存在的可行解（set-cover 贪心非完备 + 资源拟阵约束）。因此：

- `infeasibleEvents` 的语义是 **"本算法尽力后仍未消解"，不是"数学上不可能救"**。UI/文档措辞须如实：写"自动放置未能覆盖，建议手动处理"，**不**写"无法拯救"。
- **缓解**：阶段 3 把"仍致死事件"作为**高权重惩罚项**并入 `ΔTotal`，让 swap/remove+add 有机会修复阶段 1 的贪心错误；多随机重启（确定性多 seed）降低漏判率。
- **升级路径（非首版）**：若实测漏判明显，对致死事件改用小范围 beam / 回溯（事件少、候选受限，可承受）。

### 8.5 终止性

- **阶段 1**：每轮要么消解一个致死事件（致死数 −1），要么标记一事件为已尽力（移出待处理集）；待处理致死事件数严格递减、上界为事件数 ⟹ 有限步终止。
- **阶段 2**：每轮接受一个 `ΔTotal > 0` 的 cast，`total` 严格下降且有下界（≥ 0）；每个 `(player,resourceId)` 池可用充能有限 ⟹ 可接受 cast 数有限 ⟹ 终止。
- **阶段 3**：`timeBudgetMs` 显式封顶；维护 `best` 快照，到点返回 `best` ⟹ 必终止且**不退化**（返回 `total ≤` 进入阶段 3 时的 `total`）。

### 8.6 能保证什么 / 不能保证什么

| 性质                                            | 状态                                     |
| ----------------------------------------------- | ---------------------------------------- |
| 输出 cast 全部合法（`findInvalidCastEvents=∅`） | ✅ 构造性保证（§8.1）                    |
| 不把本可不致死的事件变致死                      | ✅（§8.1 I2）                            |
| 候选离散化不丢单 cast 可达目标值                | ✅ 引理 1（§8.2）                        |
| 阶段 2 贪心有 1/2 ~ 1−1/e 近似                  | ⚠️ 仅理想化（无盾 / 无条件变体）（§8.3） |
| 找到全局最优放置                                | ❌ NP-hard，不保证                       |
| 必定找到存在的可行解                            | ❌ 阶段 1 非完备，best-effort（§8.4）    |
| 同 seed 可复现、按时返回、不退化                | ✅（§8.5）                               |

### 8.7 时空复杂度分析

**参数**（括号为单场战斗典型量级）：

| 符号    | 含义                                             | 典型值    |
| ------- | ------------------------------------------------ | --------- | --- | ----- |
| `N`     | in-scope 事件数                                  | 30–60     |
| `D`     | 全部伤害事件数（`D ≥ N`）                        | 50–120    |
| `M`     | `(action,player)` 生成器数 `= Σ_p                | kit(p)    | `   | 40–60 |
| `S`     | status 区间（buff 窗口）总数 `= O(L)`            | 数十      |
| `L`     | 当前 cast 总数（locked+added），`L_max` 为其上界 | 数十      |
| `C`     | 候选总数 `= O(M·(N+S))`                          | 数百~数千 |
| `κ`     | 单事件平均被覆盖的候选窗口数                     | 小常数    |
| `G`     | 阶段 2 接受的 cast 数 `≤ L_max`                  | 数十      |
| `T_sim` | 一次 `simulate(skipHpPipeline)` 成本             | 见下      |

**单次 `simulate` 成本**：构建/排序 status 时间线 `O(L log L)`，逐事件遍历活跃 status `O(D·ā)`（`ā` = 平均同时活跃 status 数）：

```
T_sim = O(L log L + D·ā)
```

复杂度的**真实货币是 `simulate` 调用次数**（每次 `T_sim`，远贵于区间运算）。逐阶段计：

| 阶段     | `simulate` 调用数（最坏）       | 备注                                       |
| -------- | ------------------------------- | ------------------------------------------ |
| 候选生成 | 0                               | 纯区间运算 `O(M·(N+S))`，不调 simulate     |
| 阶段 1   | `O(N · M·κ)`                    | 外层 ≤ `N`，每轮探 `e` 的覆盖候选 `O(M·κ)` |
| 阶段 2   | `O(G · C) = O(L_max · M·(N+S))` | 每轮探全部候选；**朴素实现的瓶颈**         |
| 阶段 3   | `O(timeBudget / T_sim)`         | 预算封顶，每 move 探 O(1) 候选             |

**时间复杂度（朴素）**：

```
T = O( (N·M·κ + G·M·(N+S)) · T_sim  +  timeBudget )
  = O( M·(N+S)·L_max · T_sim  +  timeBudget )         # 阶段 2 主导
```

**关键发现（对设计有反馈）**：代入典型值，阶段 2 朴素实现 `simulate` 调用数 `≈ M²·(N+S) ≈ 50²×100 ≈ 2.5×10⁵`，即便 `T_sim` 仅 0.05–0.2 ms，也要 **十几~几十秒**，超出"几秒"预算。故阶段 2 朴素全量探测**不可接受**，必须上三项优化（其可行性恰由前文性质支撑）：

1. **惰性贪心 CELF**（依赖 §8.3 次模性）：维护候选边际增益的**上界优先队列**，每轮只重算队首的过期上界；次模性保证上界单调有效，典型可把每轮探测从 `O(C)` 降到**接近 `O(log C)` 摊还**（文献上常见 ~数百倍 evaluation 缩减）。这把次模性从"质量论证"升级为"复杂度刚需"。
2. **增量 `evaluate`**（§5 可选优化）：加入一个 cast 只影响其覆盖窗口 + 资源透支下游段，把单次 `T_sim` 从 `O(D·ā)` 降到 `O(受影响事件数·ā)`，常数级窗口下近 `O(1)`。
3. **候选剪枝**：阶段 2 只对"覆盖了仍有显著伤害事件"的候选入队，砍掉对总伤无贡献的窗口。

三者叠加后，阶段 2 实际 `simulate` 调用数降到 `O((C + G·log C))` 量级、单次更便宜，落回几秒预算内。

**空间复杂度**：

```
Space = O( C + D + L_max )
      = O( M·(N+S) + D )
```

- 候选集 `O(C)`、CELF 优先队列 `O(C)`、单个 `EvalResult.perEvent` `O(D)`、`best` 快照只存 `added` 列表 `O(L_max)`、`simulate` 工作集 `O(D + L)`。
- **全程线性于问题规模，无组合爆炸**——优化器从不物化指数级的解空间，只持有当前解 + 候选集 + 一份最优快照。

> 注：阶段 3 时间被 `timeBudget` 硬性封顶，与上述无关；空间不随迭代增长（只滚动维护当前解与 `best`）。

### 8.8 剪枝策略

剪枝是把 §8.7 朴素 `O(G·C)` 探测压回预算的核心手段。按**是否保持最优性**分两类，逐项标注生效条件与所依赖的理想化前提（与 §8.3 同源——盾/条件变体会削弱"安全"性，故"安全"仅在其不参与时严格成立）。

#### A. 安全剪枝（不丢最优，在 §8.3 理想化下严格）

1. **支配剪枝（dominance）**——同一 `(action,player)` 的两个候选 `c1`、`c2`，若 `c1` 覆盖的 in-scope 事件集 ⊇ `c2` 的、且资源代价相同，则 `c2` 被支配，丢弃。依据引理 1：同生成器的断点给出有限个覆盖集，集合包含关系下只保留极大者。**前提**：覆盖集可比（包含关系成立）且无条件变体差异；不可比时两者都留。
2. **零贡献剪枝**——候选覆盖窗口内不含任何 in-scope 事件 → 对目标与可行性均无贡献 → 丢弃。恒安全。
3. **死窗口剪枝**——合法窗口为空（资源永不就绪）→ 丢弃。已由 `getValidIntervals` 天然完成。
4. **对称性剪枝（break symmetry）**——多个玩家能放**同效**技能（如两坦都有团减），在某放置点上可互换（同效果、同资源就绪）时只试一个，用 `pickUniqueMember` 选代表。把同效分支从"乘玩家数"降为常数。**前提**：候选玩家的该资源池状态等价。
5. **变体折叠去重**——仅 resolved 变体不同、放置点相同的候选 = 同一 `CastEvent`（`actionId` 存 trackGroup 父 id）→ dedup。恒安全。
6. **CELF 上界剪枝**（依赖 §8.3 次模性）——惰性贪心维护边际增益上界优先队列；次模性保证陈旧上界仍是有效上界，故"队首陈旧上界 ≤ 本轮已找到的最佳真实增益"时，其余候选全部免探。这是阶段 2 的主力剪枝。
7. **局部失效剪枝（locality）**——接受一个 cast 只改变其覆盖窗口 + 资源透支下游段；该区域**外**的候选边际增益不变（引理 1 的多 cast 推广），无需重探，只刷新与变动区相交的候选的 CELF 上界。把每轮刷新量从 `O(C)` 降到 `O(局部候选数)`。

#### B. 启发剪枝（以最优性换速度，默认开但可关）

8. **乐观上界预筛（admissible bound）**——对候选给一个不需 simulate 的乐观降伤上界 `Σ_{e∈cover} curDmg_e · r_max`（忽略边际递减、盾封顶）。该上界 ≤ 阈值的候选**不入队**。上界 admissible 时偏安全（只剪真正无望者），但阈值 > 0 即转为启发。
9. **伤害阈值剪枝**——in-scope 事件中 `finalDamage` 已低于某比例（如 < refHP·X% 或 < 全场峰值·Y%）的，视为"不值得再压"，其专属候选不入阶段 2 队列。直接缩小 `C`，但可能放过微小总伤收益。
10. **阶段 3 邻域剪枝 + 惩罚引导**——局部搜索不全局采样：move/swap/replace 只在「现有 cast 的时间邻域」与「仍致死或高伤害事件附近」取样；致死事件带高权重惩罚项引导修复（呼应 §8.4 缓解）。砍掉绝大多数无效 move。
11. **每池预算上界剪枝**——每个 `(player,resourceId)` 池的总充能数是硬上界；当某池已排满，其全部剩余候选直接出局，不再探测。介于安全与启发之间（池满是硬约束，安全；但"先到先得"的接受顺序影响最终结果，故对最优性非中性）。

#### 组合与顺序

```
候选生成 → [A2,A3,A5 静态丢弃] → [A1 支配 + A4 对称] 折叠 → [B8,B9 预筛] 入 CELF 队
阶段 2 循环：CELF 取队首(A6) → 增量 evaluate(§8.7-2) → 接受后 A7 局部刷新 + A11 池满清退
阶段 3：B10 邻域采样
```

安全剪枝（A）先行且默认全开；启发剪枝（B）受开关与阈值控制，`options` 可暴露 `aggressive: boolean` 一键切换"保守(仅 A)/激进(A+B)"。**保守模式可作为差分基准**：测试中断言"激进解的总伤 ≥ 保守解 ×(1−容差)"，量化启发剪枝的最优性损失。

## 9. 复用资产清单

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
