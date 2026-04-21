# 坦专事件多承伤者减伤计算设计

> 2026-04-21 · 分支 `feat/tank-mode`

## 背景

当前 `MitigationCalculator.calculate()` 对每个 `DamageEvent` 输出单个 `CalculationResult`。在坦专事件（`type === 'tankbuster' | 'auto'`）下，这个单结果用"所有 `isTankOnly` 状态一起应用"的方式近似计算，无法表达"不同坦克因自身 buff 不同而承伤不同"的真实语义。

状态数据层面，`STATUS_EXTRAS` 已给大部分坦克状态标注了 `category: MitigationCategory[]`（`partywide | self | target | percentage | shield`），但 `MitigationStatusMetadata` 没有透出这个字段，计算器也没有消费它。

## 目标

- tankbuster / auto 事件对队伍里每个坦克独立计算减伤，输出 per-tank 结果（按 composition 里坦克的出现顺序）
- 过滤规则基于 `category`（见下）
- PropertyPanel 展示 per-tank 多结果；盾值消耗等持久化 state 只认"最优减伤分支"（`finalDamage` 最低的那个，tie-break 按 composition 顺序）
- aoe 事件保持当前单结果语义，本次不改

## 非目标

- 让用户指定 tankbuster 的承伤者（简化诉求：默认所有坦克）
- 解决"target 盾只给目标人"的建模缺口（当前 `MitigationStatus` 只记 `sourcePlayerId`，没记"盾给谁"）——下一期再议
- aoe / 非坦专事件的 per-player 拆分

## 过滤规则

对当前评估的坦克 `tankId`，遍历 `partyState.statuses`：

```
if meta.category 含 'partywide'                 → 有效
if meta.category 不含 'self' 也不含 'target'     → 有效（未标注 = 默认放行）
if status.sourcePlayerId === tankId             → 需 meta.category 含 'self'
else                                             → 需 meta.category 含 'target'
```

"默认放行"分支保护了漏标 category 的数据（如 `statusId: 89` 复仇只标了 `isTankOnly` 没标 category），避免静默过滤真实应用的减伤。

## 设计

### 1. 类型层

**`src/types/status.ts`**：

```ts
export interface MitigationStatusMetadata extends Omit<Keigenn, 'performance' | 'fullIcon'> {
  performance: PerformanceType
  fullIcon?: string
  isTankOnly: boolean
  executor?: StatusExecutor
  /** 分类 tag，透传自 STATUS_EXTRAS.category；计算器按 tank 过滤时消费 */
  category?: MitigationCategory[]
}
```

**`src/utils/statusRegistry.ts`**：初始化时把 `extras?.category` 合入 `merged.category`。

### 2. 过滤 helper

放在 `src/utils/mitigationCalculator.ts` 内部（或单独拆 `src/utils/statusFilter.ts`）：

```ts
function isStatusValidForTank(
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

### 3. Calculator 接口

**`CalculateOptions`** 新增：

```ts
export interface CalculateOptions {
  referenceMaxHP?: number
  /**
   * 坦专事件的承伤者坦克列表（按 composition 顺序）。
   * - 非空 + event.type ∈ {tankbuster, auto} → 走 per-tank 多结果路径
   * - 否则 → 走原有单路径
   */
  tankPlayerIds?: number[]
  /**
   * 基线参考 HP（未叠加 maxHP 倍率）。多坦路径下由 calculator 按 tank 单独叠乘
   * 活跃 buff 的 maxHP，替代原先由 hook 全局累算的做法。
   */
  baseReferenceMaxHP?: number
}
```

**`CalculationResult`** 新增：

```ts
export interface PerTankResult {
  playerId: number
  finalDamage: number
  mitigationPercentage: number
  appliedStatuses: MitigationStatus[]
  /** 该坦克分支使用的个性化参考 HP（叠乘 maxHP 后） */
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
   * 多坦路径产出（`event.type ∈ {tankbuster, auto}` 且 `tankPlayerIds.length >= 1`）。
   * 其它路径（aoe / 无坦克） → undefined
   */
  perVictim?: PerTankResult[]
}
```

顶层字段聚合规则（多坦路径下）——`perVictim` 按 `finalDamage` 升序排列，Array.sort 稳定 tie-break 保留 composition 原始索引顺序：

- `perVictim[0]` 即"最优减伤分支"（finalDamage 最低）
- `finalDamage` / `mitigationPercentage` / `appliedStatuses` / `updatedPartyState` ← `perVictim[0]`
- `maxDamage` ← `perVictim[length - 1].finalDamage`（保留"最坏情况"历史语义）
- `referenceMaxHP` ← `perVictim[0].referenceMaxHP`
- UI 也按这个排序渲染：减伤最好的坦克先显示

### 4. Calculator 多坦分发逻辑

```
if event.type ∈ {tankbuster, auto} and tankPlayerIds.length >= 1:
    perVictim = []
    for tankId in tankPlayerIds:
        filtered = statuses.filter(s => isStatusValidForTank(meta, s, tankId))
        refHP = baseReferenceMaxHP × Π(filtered 活跃状态的 maxHP)
        runBranch(event, partyState, filtered, refHP, tankId)
        perVictim.push(branchResult)
    perVictim.sort(by finalDamage ascending, stable tie-break by composition order)
    updatedPartyState = perVictim[0].state    # 其余分支丢弃
    aggregate into CalculationResult
else:
    # 现有单路径，完全保留
```

**关键点**：

- 所有分支从**同一基线 `partyState`** 起算，互不影响
- 5 个 phase 在每个分支内完整走一遍（multiplier / onBeforeShield / 盾吸收 / onConsume / onAfterDamage）
- 分支内遍历 statuses 时，**用 `filtered` 列表**替代原始 `partyState.statuses`
- 分支内 Phase 3 的 shieldFilter 在 `isStatusValidForTank` 基础上叠加 `meta.isTankOnly`，复刻旧版 `isTankOnly === includeTankOnly` 口径（partywide 盾不会被坦专事件消耗）
- 只有**最优减伤分支**（`finalDamage` 最低，同值按 composition 顺序取前）的 `updatedPartyState` 对外生效

### 5. maxHP 倍率下沉

当前 `useDamageCalculation` 在 calculator 之外用全局过滤（所有 tank-included buff 一起累乘）算 `eventReferenceMaxHP`。多坦下这不对：MT 有战栗（maxHP 1.2×）、OT 没有，两个分支应当用各自的 `refHP`。

**改动**：

- `useDamageCalculation` 只传 `baseReferenceMaxHP`（不叠 buff 倍率），连同 `tankPlayerIds` 一并交给 calculator
- Calculator 统一负责 maxHP 叠乘：
  - 多坦路径：每个 tank 分支对 `filtered` 状态集累乘各自的 `refHP`
  - 单路径（aoe / 无坦克）：等价于旧 `useDamageCalculation` 做法——按 `includeTankOnly` 过滤 (`if (meta.isTankOnly && !includeTankOnly) continue`) 后累乘；旧行为完整保留
- `CalculationResult.referenceMaxHP` 多坦路径取最优减伤分支的 `referenceMaxHP`，单路径取 calculator 内算出的该值

### 6. Caller 接线

**`src/hooks/useDamageCalculation.ts`**：

- 从 `timeline.composition.players` 筛坦克 playerId（`jobs.ts` 里的 role 判定）
- 注入 `opts.tankPlayerIds`；未筛到坦克则传空数组，走单路径退化
- `eventReferenceMaxHP` 相关 maxHP 倍率累乘代码下沉到 calculator，这里只传 `baseReferenceMaxHP`

### 7. UI

**PropertyPanel / DamagePanel 等消费者**：

- `result.perVictim?.length >= 1` → 渲染多行，每行展示该坦克 job 图标 + finalDamage + 减伤百分比 + 参与状态
- 否则沿用当前单结果渲染

本次 spec 不细化 UI 组件具体结构，留给实现计划阶段分解。

## 已知折中 / 副作用

1. **非最优减伤分支的真实盾消耗不持久化**：两坦都有持久盾、被吸收量不同时，只有最优分支（吸收更多 → finalDamage 更低）的盾消耗写回 `updatedPartyState`，另一坦分支的消耗被丢弃。`onBeforeShield` 每事件重算的 transient barrier（死斗 / 行尸走肉 / 出死入生）不受影响。
2. **`finalDamage` 聚合取最优分支 vs max**：选最优减伤分支，和 `updatedPartyState` 同分支保持一致。对"最大伤害/最坏情况"的展示需要看 `maxDamage` 或 `perVictim`。
3. **aoe 不做 per-player**：本次不改；未来若需要延用 `perVictim` 结构扩展即可。
4. **`isTankOnly` 字段仍保留**：新过滤基于 `category`，但现有 `isTankOnly` 还被 `onBeforeShield` hook (`createSurvivalBarrierHook` 里的筛选) 消费，也继续用于单路径 maxHP 过滤，不在本次剔除。
5. **盾值过滤保留 `isTankOnly` 口径**：多坦路径 Phase 3 的 `shieldFilter` 在 `isStatusValidForTank` 基础上额外叠加 `meta.isTankOnly`（坦专事件下等价旧版 `isTankOnly === includeTankOnly`）。这意味着"一份 partywide 盾代表单玩家份额"的旧语义保持，非坦专盾不会被死刑/普攻消耗。multiplierFilter（Phase 1/2/5）不收紧，继续按 `isStatusValidForTank` 放行。

## 测试

`src/utils/mitigationCalculator.test.ts` 新增 case：

1. **双坦共受伤 + self 盾隔离**：MT 有死斗、OT 没有。`perVictim[0]`（MT）吃到死斗自生盾，`perVictim[1]`（OT）没吃到，两人 `finalDamage` 不同
2. **partywide 盾参与坦专**：`['partywide', 'shield']` 盾对 tankbuster 有效（旧实现会被 `meta.isTankOnly !== includeTankOnly` 挡掉，新实现放行）
3. **未标注 category 的状态默认放行**：复仇 (89) 对持有者和非持有者都生效
4. **target 盾方向**：OT 对 MT 施放某个 target 盾，MT 分支吃、OT 分支不吃（因为 OT 需 'self'）
5. **持久化 state 只来自最优减伤分支**：两坦承伤差异时，最低 finalDamage 分支的 `updatedPartyState` 被保留；另一分支的盾消耗丢弃
6. **maxHP 按 tank 个性化**：MT 有战栗、OT 没有 → 两个分支 `referenceMaxHP` 不同
7. **单坦退化**：composition 只有一坦时 `perVictim.length === 1`，行为与旧实现等价
8. **非坦专事件不走新路径**：aoe 无 `perVictim`

## 实现顺序建议（交给 writing-plans 细化）

1. 补 `MitigationStatusMetadata.category` 类型 + `statusRegistry` 合并
2. 加 `isStatusValidForTank` helper + 单元测试
3. Calculator 多坦分发骨架（沿用现 5 阶段，加 filtered 循环 + 分支产出）
4. maxHP 下沉
5. `useDamageCalculation` 接线
6. PropertyPanel / DamagePanel UI 消费 `perVictim`
7. 端到端测试 + 手动 QA
