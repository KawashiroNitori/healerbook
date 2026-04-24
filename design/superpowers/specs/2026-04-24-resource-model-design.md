# 资源模型重构设计

- **日期**: 2026-04-24
- **状态**: Draft
- **supersedes**: `design/resource-model.md`（草案）
- **落地范围**: 学者慰藉 + 骑士献奉（草案步骤 4 + 5）同一个 PR 推完

## 背景

`MitigationAction` 目前只有 `cooldown: number`，表达"每 N 秒可用一次"。对**带充能**技能（献奉 60s CD 2 层）、**多技能共享池**（百合）、**事件驱动资源**（炽天 → 慰藉充能）都表达不了。

现状里学者慰藉的绕路实现 (`src/data/mitigationActions.ts:499-541`)：

- 炽天召唤 (16545) executor 附加**假 buff `20016546`**，用 `stack: 2` 冒充充能数
- 慰藉 (16546) executor 手动找到假 buff 并减 stack、stack 为 0 时移除
- 慰藉 `placement: whileStatus(20016546)` 限制只在有层时才能用

问题：

1. "资源"塞进"状态"通道，混淆两个正交概念
2. 每新加一种充能技能都要写一段 executor boilerplate
3. placement 系统承担了"层数用尽"检测（超出其"CD 以外的放置约束"职责）
4. 无法表达"时间恢复的充能技能"

## 目标

- 统一模型同时表达**单层 CD**、**多层充能**、**多技能共享池**、**事件驱动资源**
- 现有 200+ 个 action **零破坏**：仅声明 `cooldown` 的 action 自动按"单层 CD 资源"处理
- 把"CD / 层数可用性"从 placement engine 抽离为独立 validator
- 覆盖首个带 regen 的真实样本（献奉）验证充能计时路径

## 非目标

- 不实现派生规则（例：WHM 血百合靠 3 次治疗累计 +1 层）
- 不改 Canvas 渲染层；带 regen 技能的 CD 条可视化作为独立设计项
- 不引入跨场战斗持久化

## 核心决策

### D1. 资源按 (playerId, resourceId) 懒加载

不预先按 `Composition.players` 展开池子。`ResourceDefinition` 是静态声明；运行时按事件里的 `(playerId, resourceId)` 对**按需**实例化。私有资源（献奉）与共享池（百合）在模型里**不区分**：差别只在多少 action 的 `resourceEffects` 指向同一个 `resourceId`。

好处：

- 缺失的池零增量（比如队伍里没 DRK，`drk:oblation` 自然不参与计算）
- 不需要 Composition 过日子 —— validator 纯依赖 `castEvents + actions + registry`

### D2. 资源状态不入 `PartyState`，纯函数派生

单一真理源是 `castEvents + actions + registry`。任意时刻资源量由纯函数算。与 `MitigationCalculator` 按需计算的理念一致，避免状态二次存储。

### D3. `cooldown` 字段作为单充能池 shorthand

现有 action 不改。运行时：

- 若 action **未**声明 `resourceEffects` → 虚拟一个单充能池：
  ```ts
  resource = {
    id: `__cd__:${actionId}`,
    initial: 1,
    max: 1,
    regen: { interval: action.cooldown, amount: 1 },
  }
  effect = { resourceId, delta: -1 }
  ```
- 若 action **声明了** `resourceEffects` → **不**合成 `__cd__`，`cooldown` 字段变成纯信息性（保留以便 Canvas / 其他 UI 兜底用）

这条是"现有 CD 冲突行为与单充能池数学等价"的根。

**与 `trackGroup` 完全解耦**：合成键用 `actionId`、**不使用** `effectiveTrackGroup`。`trackGroup` 仅是 UI 渲染概念（哪些 actionId 共用一行），不进入 compute / validator / legalIntervals 层。副作用：现有 `cooldownAvailable` 里"同 trackGroup 跨 actionId 的 CD 冲突"检测随迁移消失（例：意气 37013 @ t=0 + 降临 37016 @ t=1 原被 block，新模型视为合法）。该场景属于 GCD 窗口内连按两个 GCD 技能——现实玩家做不到，由 FF14 常识而非 planner 阻止。不视作 regression。

### D4. 资源 regen = 充能计时（非固定钟）

FF14 充能类技能语义：**每次消耗调度一个 `interval` 秒后到点的独立 refill**，到点时若未满则 +amount、满则忽略。不是"从战斗 t=0 按 interval 固定 tick"。

反例（草案原伪代码）：献奉 `regen:{interval:60}` 初始满 2；t=45 消耗 1 层 → 草案固定钟算法在 t=60 会 tick → 1→2；**实际 FF14** 应当 t=45+60=105 才恢复那层。草案模型在 t≠k·60 用技能的场景系统性低估回充间隔。

### D5. Status onTick 与资源 regen 完全独立

`onTick`（HoT / DoT 的服务器 3s 判定节拍）与资源充能是两条互不影响的时钟轴。资源模型不参与 onTick 逻辑、反之亦然。

### D6. 炽天 22s buff vs 慰藉充能持久性 —— 不需要新机制

**游戏事实**：慰藉本身是 2 充能 + 30s/层自动回充的 action；"只能在炽天期间用"是 placement 规则、**不是资源来源**。炽天 120s CD ≫ 30s × 2 = 60s 完整回充时间，所以每次炽天触发时慰藉必定满充能，"buff 结束后残留充能怎么办"的问题在可达状态里不会暴露——**不用引入"状态关联资源"第四种机制**。

落地：

- **废弃假 buff `20016546`**
- 慰藉 `placement` 改用 `whileStatus(3095)`（炽天真 buff，同 22s、同 executor 写入，`whileStatus` 已按 `sourcePlayerId === playerId` 过滤 → 多 SCH 天然互不干扰）
- 慰藉充能由 `sch:consolation` 自充能承担（initial=2, max=2, regen=30）
- 炽天 executor **只造 buff 3095、不碰资源**；其 120s CD 由 D3 合成 `__cd__:16545` 自动强制

## 类型定义

### `src/types/resource.ts`（新文件）

```ts
import type { Job } from '@/data/jobs'

/** 资源池静态声明 */
export interface ResourceDefinition {
  /** 资源 id，如 'sch:consolation' / 'drk:oblation'。显式 id 不得以 '__cd__:' 开头 */
  id: string
  name: string
  job: Job
  /** 战斗开始时的值 */
  initial: number
  /** 池子上限 */
  max: number
  /**
   * 充能回充配置。不声明 = 不随时间恢复（纯事件驱动资源，如慰藉）。
   * 语义：每个消耗事件调度一个 interval 秒后到点的独立 refill，
   *      到点时若 amount < max 则 +amount、满则忽略。
   *      NOT 从战斗 t=0 固定节拍 tick。
   */
  regen?: {
    interval: number
    amount: number
  }
}

/** action 对资源的影响声明 */
export interface ResourceEffect {
  resourceId: string
  /** 正 = 产出，负 = 消耗；一次 cast 可对多个资源声明多个 effect */
  delta: number
  /** 仅对 delta < 0 有意义：资源不足是否阻止使用（默认 true） */
  required?: boolean
}

/** 从 castEvent 派生出的资源事件（不持久化） */
export interface ResourceEvent {
  /** `${playerId}:${resourceId}` */
  resourceKey: string
  timestamp: number
  delta: number
  castEventId: string
  actionId: number
  required: boolean
  /**
   * 同 timestamp 多事件的稳定 tie-break：castEvents 原数组下标。
   * 注意：`castEvents` 数组本身按 timestamp 升序存储（由现有 store 维护），
   * orderIndex 仅在同 timestamp 冲突时兜底。
   */
  orderIndex: number
}
```

### `src/types/mitigation.ts`（扩展）

```ts
export interface MitigationAction {
  // ... 现有字段保持不动
  /** 一次 cast 对资源池的影响；未声明则 compute 层按 cooldown 合成 __cd__:${id} */
  resourceEffects?: ResourceEffect[]
}
```

### `src/data/resources.ts`（新文件）

```ts
import type { ResourceDefinition } from '@/types/resource'

export const RESOURCE_REGISTRY: Record<string, ResourceDefinition> = {
  'sch:consolation': {
    id: 'sch:consolation',
    name: '慰藉充能',
    job: 'SCH',
    initial: 2, // 战斗开始满充能
    max: 2,
    regen: { interval: 30, amount: 1 }, // 自充能；使用受限于炽天 buff 由 placement 把关
  },
  'drk:oblation': {
    id: 'drk:oblation',
    name: '献奉充能',
    job: 'DRK',
    initial: 2,
    max: 2,
    regen: { interval: 60, amount: 1 },
  },
}

// 模块导入时校验：显式 id 不得以 __cd__: 开头（冲突保护）
for (const id of Object.keys(RESOURCE_REGISTRY)) {
  if (id.startsWith('__cd__:')) {
    throw new Error(`Resource id "${id}" conflicts with synthetic CD resource namespace`)
  }
}
```

### `src/utils/placement/types.ts`（改）

```ts
// cooldown_conflict 一把改 resource_exhausted，不保留 deprecated 别名
export type InvalidReason = 'placement_lost' | 'resource_exhausted' | 'both'

export interface InvalidCastEvent {
  castEvent: CastEvent
  reason: InvalidReason
  /**
   * reason === 'resource_exhausted' | 'both' 时填；指向第一个耗尽的资源 id。
   * UI 用它查 `RESOURCE_REGISTRY[resourceId]?.max` 决定文案："冷却中"（max=1）/"层数不足"（max>1）。
   * 一次 cast 若同时耗尽多个资源，取第一个（顺序由 action.resourceEffects 声明顺序决定）。
   */
  resourceId?: string
}
```

## 计算层 API

### `src/utils/resource/compute.ts`（新文件）

```ts
/**
 * 从 castEvents 派生出按 resourceKey 分组、按 (timestamp ASC, orderIndex ASC) 稳定排序的事件。
 *
 * - 对未声明 resourceEffects 的 action：合成一条 `__cd__:${actionId}` 单充能池的 delta=-1 事件
 * - ResourceEffect.required 未声明默认 true；派生到 ResourceEvent.required
 * - orderIndex 取 castEvents 数组下标，同 (playerId, resourceId) 在同时刻的事件按此稳定分序
 */
export function deriveResourceEvents(
  castEvents: CastEvent[],
  actions: Map<number, MitigationAction>
): Map<string /* resourceKey */, ResourceEvent[]>

/**
 * 计算 (playerId, resourceId) 在 atTime 时刻的值（应用所有 timestamp <= atTime 的事件后）。
 * 采用充能计时语义，不 clamp 下限（负值由 validator 语义解释）。
 */
export function computeResourceAmount(
  def: ResourceDefinition,
  events: ResourceEvent[],
  atTime: number
): number
```

### 充能计时算法（`computeResourceAmount` 伪代码）

```
amount = def.initial
pendingRefills = sortedList  // 按 time ASC

for ev in events where ev.timestamp <= atTime (已按 (ts, orderIndex) 稳定排序):
  // 1. 触发此事件之前该到点的 refill
  while pendingRefills.peek() != null and pendingRefills.peek() <= ev.timestamp:
    pendingRefills.pop()
    amount = min(amount + def.regen.amount, def.max)

  // 2. 应用事件 delta：clamp 上限，不 clamp 下限
  amount = min(amount + ev.delta, def.max)

  // 3. 消耗事件调度独立 refill（每消耗 1 单位调度 1 个）
  if ev.delta < 0 and def.regen:
    for k in 1..|ev.delta|:
      pendingRefills.push(ev.timestamp + def.regen.interval)

// 触发 atTime 之前还到点的 refill
while pendingRefills.peek() != null and pendingRefills.peek() <= atTime:
  pendingRefills.pop()
  amount = min(amount + def.regen.amount, def.max)

return amount
```

关键性质：

- **充能计时**：refill 是"在消耗事件 timestamp + interval 的绝对时刻"触发的单次事件，不是固定节拍 tick。献奉 t=45 消耗 → 对应 refill 在 t=105 而非 t=60。✓
- **多个产出 / 消耗事件在同 timestamp**：按 `orderIndex` 稳定处理 → 确定性。
- **amount 可为负**：`computeResourceAmount` 是纯数值函数，validator 决定合法性。
- **产出溢出 clamp 到 max**：如 max=2 时炽天 +2 打在已满 pool 上 → 仍 2，多余部分丢失。
- **`__cd__:${actionId}` 合成池**：`regen.amount = 1`，initial = 1，max = 1。单次消耗后下一次可用时间 = cast + cooldown，与原 `cooldownAvailable` 数学等价。

## 合法性校验层

### `src/utils/resource/validator.ts`（新文件）

```ts
export interface ResourceExhaustion {
  castEventId: string
  resourceKey: string
  resourceId: string
  playerId: number
}

/** 返回所有因资源不足被判非法的 cast */
export function findResourceExhaustedCasts(
  castEvents: CastEvent[],
  actions: Map<number, MitigationAction>,
  registry: Record<string, ResourceDefinition>,
  excludeId?: string
): ResourceExhaustion[]
```

- `excludeId`：与 placement engine 同语义，用于拖拽预览（排除正被拖动的 cast 重算）。
- 算法：按 resourceKey 分组遍历；用与 `computeResourceAmount` 同构的 pendingRefills 维护 amount，在每个 delta<0 事件**应用前**检查 `amount < |delta|`；是 → 若 `required=true` 记 exhaustion。

### 与 placement engine 解耦

当前 `src/utils/placement/engine.ts:56-78` 的 `cooldownAvailable` 承担 CD 冲突检测。迁移后：

- 删除 `cooldownAvailable` 函数
- 删除 `engine.ts:195-206` 的内联 CD 重叠检测（`findInvalidCastEvents` 内部）
- `findInvalidCastEvents` 最外层合并：placement 失效 + `findResourceExhaustedCasts` 结果
- `InvalidReason` 枚举由 placement 判断 + resource 判断共同填（两者都命中 → `'both'`）

## 阴影（shadow）计算

阴影代表"新 cast 不可放置的时间区间"。`computeTrackShadow` 外层结构不变：

```
legal = union(members.map(m => placement ∩ resourceLegalIntervals))
shadow = complement(legal)
```

把原 `cooldownAvailable` 换成新的 `resourceLegalIntervals`。

### `resourceLegalIntervals(action, playerId, events, registry): Interval[]`

对每条 `action.resourceEffects[i]`（合成 `__cd__:${id}` 也同样）：

```
# delta > 0 (产出) → 不贡献 forbid，跳过
# delta < 0 (消耗) → 自耗尽 + 下游透支两段
threshold = |delta|

# 自耗尽段（前向 CD 阴影源头）
trace = piecewise-constant amount(t) from events
selfForbid = { t : trace(t) < threshold }

# 下游透支段（反向 CD 阴影源头）
downstreamForbid = []
for 每条同资源的 consume event C at t_C:
  M_C = amountBefore(C) - |delta_C|
  if M_C < threshold:
    if def.regen:
      downstreamForbid.push( (t_C - def.regen.interval, t_C) )
    else:
      # 无 regen → 资源不会自动回 → 反向窗口延伸到 −∞
      downstreamForbid.push( (-Infinity, t_C) )

return complement( union(selfForbid, downstreamForbid) )
```

多条 `resourceEffects`：每条资源各算一份 legal，最后**取交集**。

### 前向 vs 反向 阴影的直觉映射

| 旧模型（cooldownAvailable） | 新模型（resourceLegalIntervals） |
| --------------------------- | -------------------------------- |
| 前向 `[t_e, t_e + cd)`      | 自耗尽段：消耗后 amount=0 的区间 |
| 反向 `(t_e − cd, t_e)`      | 下游透支段：M_e < threshold 触发 |

### 等价性：单充能合成 `__cd__` ≡ 旧 `cooldownAvailable`

对单充能（max=1、regen={interval=cd, amount=1}），已有 cast at t_e：

- `amountBefore(t_e) = 1`，`M_e = 0`；新 cast threshold=1 > 0 → 下游透支触发
- 下游透支段 = `(t_e − cd, t_e)`
- 自耗尽段 = `[t_e, t_e + cd)`
- union = `(t_e − cd, t_e + cd)`

旧 `cooldownAvailable` forbid = `[t_e − cd, t_e + cd)`，仅在左端点 `t_e − cd` 处闭合方向有微差，由 `TIME_EPS` 吸收 → **行为等价**。

### 献奉多充能示例（2 cast @ t=0, t=30，查询第 3 条献奉的 legal）

| 源               | 贡献 forbid | 推导                              |
| ---------------- | ----------- | --------------------------------- |
| 自耗尽           | `[30, 60)`  | amount 原始 trace 在此段 = 0      |
| 下游 t=0（M=1）  | —           | M ≥ threshold=1，新 cast 不打穿   |
| 下游 t=30（M=0） | `(−30, 30)` | M=0 被新 cast 扣到 −1 → exhausted |

合并 shadow = `(−30, 60)`（90s 宽）。旧单充能模型下同场景 shadow = `(−60, 90)`（150s）。多充能收益 60s。

### 慰藉示例（炽天 @ t=120，慰藉 @ t=125 / t=130）

`sch:consolation` 战斗起初 `amount=2`，regen=30s/层；慰藉自带 regen，下游透支段窗口有界。

| 时刻         | amount_before | amount_after | pending refills |
| ------------ | ------------- | ------------ | --------------- |
| t=125 慰藉 1 | 2             | 1            | `[155]`         |
| t=130 慰藉 2 | 1             | 0            | `[155, 160]`    |

查询第 3 条慰藉在 resource 层的 legal：

| 源                | 贡献 forbid  | 推导                          |
| ----------------- | ------------ | ----------------------------- |
| 自耗尽            | `[130, 155)` | amount<1 段                   |
| 下游 t=125（M=1） | —            | M≥threshold，不受新 cast 透支 |
| 下游 t=130（M=0） | `(100, 130)` | 窗口宽 = regen.interval = 30  |

合并 forbid = `(100, 155)`，resource-legal = `(−∞, 100] ∪ [155, ∞)`。

placement `whileStatus(3095)` 把 action 限死在 `[120, 142)`。placement ∩ resource-legal = `[120, 100] ∪ ([120, 142) ∩ [155, ∞))` = ∅ → 首个炽天窗口内**这两条已用掉的慰藉后，无法再放**。符合"两层用完等下个炽天"直觉。

## 蓝色 CD 条渲染

### 语义

蓝条表达的是**这次按键把池子打空到再次可按之间的时段**——用户看见蓝条意味着"这段时间里下一次同技能不可放"。它**不是**"这次按键的名义回充时间"、**不是** shadow 的镜像（虽然在单充能场景下两者数值重合）。

新规则：对 cast C at t_C（消耗 delta=−d 资源 R）：

1. 若 `amount_after_C >= d` → **不画蓝条**（池子还有库存，下一按键立即可放）
2. 否则 → 扫描 t_C 之后（pendingRefills + 后续 ResourceEvents），找 **第一个 `amount(t') >= d` 的 t'**；蓝条 `[t_C + effectiveDuration, t')`
3. 视觉截短：`visualEnd = min(rawEnd, nextCastTime)`——避免同轨下一 cast 叠涂

### 四类场景展开

| Action 类型                                                | amount_after_C  | 蓝条 rawEnd                                    |
| ---------------------------------------------------------- | --------------- | ---------------------------------------------- |
| 单充能合成 `__cd__`（200+ 现有 action）                    | 永远 0（max=1） | t_C + cooldown                                 |
| 多充能有 regen，此 cast 后**仍有库存**（献奉/慰藉第 1 层） | ≥1              | null（不画）                                   |
| 多充能有 regen，此 cast 后**打空**（献奉/慰藉第 2 层）     | 0               | 扫到第一个恢复到 ≥1 的 refill 时刻（自身调度） |
| 产出型 + 无消费者（炽天）                                  | n/a             | 走 `__cd__:${id}` 合成消费路径，同单充能       |

**说明**：慰藉迁移后 `sch:consolation` 有 regen，与献奉对齐；"无 regen" 类别在本次迁移后不再出现。保留作为未来事件驱动资源（例：hypothetical 治疗计数累积类）的占位。

### 献奉三连 @ t=0, t=30, t=70 工例

| Cast      | amount_before          | amount_after | rawEnd 来源          | rawEnd | 蓝条 `[t_C + effDur, visualEnd)` |
| --------- | ---------------------- | ------------ | -------------------- | ------ | -------------------------------- |
| #1 (t=0)  | 2                      | 1            | —                    | null   | 不画                             |
| #2 (t=30) | 1                      | 0            | refill@60（来自 #1） | 60     | `[37, 60)`（23s 宽）             |
| #3 (t=70) | 1（refill@60 已 fire） | 0            | refill@90（来自 #2） | 90     | `[77, 90)`（13s 宽）             |

### 单充能等价性（200+ action byte-identical）

合成 `__cd__:${id}` max=1 initial=1。每次 cast amount 都 1→0；`amount_after_C=0 < 1` 永远触发蓝条；rawEnd = t_C + cooldown = 现状蓝条右端。与现有渲染完全一致 ✓

### 末端文本规则

- **文本数字**：`Math.round(rawEnd - t_C)` —— 剩余恢复时间（秒，整数）
- **显示条件**：`visualEnd === rawEnd`（未被 `nextCastTime` 截）且 `rawEnd - t_C >= 3`（太窄塞不下文本）
- **位置**：`x = (rawEnd - t_C) * zoomLevel - 22`

例：献奉 #2 蓝条 `[37, 60)`，rawEnd − t_C = 30 → 文本 `"30s"`；慰藉 #2 @ t=130 蓝条 `[130, 155)`（自充能 refill@155），rawEnd − t_C = 25 → 文本 `"25s"`；200+ 单充能 action rawEnd − t_C = cooldown → 文本 `"${cd}s"`，现状保留。

**纯资源语义**：蓝条只读资源 trace，不参与 placement 判断。慰藉 #2 蓝条收在 t=155 资源层面恢复，但真实下次可按要等 t=240 下个炽天——placement/shadow 负责告知这个差异，蓝条仅反映"这次按键的库存补回进度"。

### `computeCdBarEnd` API

```ts
/**
 * 返回该 cast 蓝条右端（秒）。null = 不画；Infinity = 扫到时间轴结束都没恢复（UI 层截到时间轴右端）。
 */
export function computeCdBarEnd(
  action: MitigationAction,
  castEvent: CastEvent,
  resourceEventsByKey: Map<string, ResourceEvent[]>,
  registry: Record<string, ResourceDefinition>
): number | null
```

算法骨架：

```
consume = action.resourceEffects?.find(e => e.delta < 0) ?? syntheticConsume(__cd__:${id})
def     = registry[consume.resourceId] ?? syntheticDef(__cd__, cooldown)
thresh  = |consume.delta|
events  = resourceEventsByKey.get(`${castEvent.playerId}:${consume.resourceId}`)
idx     = events.findIndex(e => e.castEventId === castEvent.id)

# 1. 走到 idx（含），拿此 cast 应用后的 amount + pendingRefills
{amount, pending} = traceUpThrough(def, events, idx)

# 2. 判断是否画
if amount >= thresh:
  return null

# 3. 继续扫 (idx, events.length) 与 pending，时间升序合并
while amount < thresh:
  nextPending = pending[0] ?? +∞
  nextEvent   = events[idx+k]?.timestamp ?? +∞
  if nextPending === +∞ && nextEvent === +∞:
    return +∞
  pick 较早者 fire，更新 amount（refill 用 def.regen.amount、event 用 ev.delta）
return timeOfRecoveryPoint
```

复用 `computeResourceAmount` 的内部轨迹遍历，抽公共状态机。

### 数据流

`PlacementEngine` 已经在构造时持有 `resourceEventsByKey`（shadow 计算用）→ 顺手加方法：

```ts
interface PlacementEngine {
  // ...
  cdBarEndFor(castEventId: string): number | null
}
```

内部按 `castEventId` cache。`SkillTracksCanvas` 拿到后传给 `CastEventIcon`：

```tsx
<CastEventIcon
  cdBarEnd={engine?.cdBarEndFor(castEvent.id) ?? null}
  // ...
/>
```

### `CastEventIcon.tsx` 渲染片段

```ts
const rawEndSec =
  cdBarEnd === null
    ? null
    : cdBarEnd === Infinity
      ? timelineEndSec // UI 层的时间轴右端
      : cdBarEnd

// 无蓝条
if (rawEndSec === null) {
  /* skip all three Rects + Text */
} else {
  const visualEndSec = Math.min(rawEndSec, nextCastTime)
  const barWidth = Math.max(
    0,
    (visualEndSec - castEvent.timestamp) * zoomLevel - effectiveDuration * zoomLevel
  )
  const showBar = barWidth > 0
  const untruncated = visualEndSec === rawEndSec
  const remaining = rawEndSec - castEvent.timestamp
  const showText = untruncated && remaining >= 3
  const textSeconds = Math.round(remaining)
  const textX = remaining * zoomLevel - 22
  // 替换 144/148/163/165/175/177/179 六处 action.cooldown
}
```

### 层数角标

本次不画。"当前时刻剩几层"是时间函数、对不同 cast 不同——对应不到单个 icon。未来若要做，应放到独立的玩家资源面板或 hover 浮层里，不占 cast icon 视觉带宽。

## 迁移步骤

每步独立可测、独立 commit，便于 bisect。

### 步骤 1 · 类型骨架（零行为变更）

- 新建 `src/types/resource.ts`
- `src/types/mitigation.ts`：`MitigationAction` 加 `resourceEffects?: ResourceEffect[]`
- 新建 `src/data/resources.ts`，导出 `RESOURCE_REGISTRY = {}` + 命名空间断言
- 验证：`pnpm exec tsc --noEmit` + `pnpm lint`

### 步骤 2 · compute 层 + 单测

- 新建 `src/utils/resource/compute.ts`
- 新建 `src/utils/resource/compute.test.ts`，覆盖：
  - 纯 regen（0 事件、1 事件穿插 regen、连续消耗后补满）
  - 纯事件驱动（无 regen，产出 + 消耗、max 溢出）
  - 混合（regen + 产出 + 消耗交叉）
  - **关键**：t=45 -1 → t=105 refill 而非 t=60（充能计时回归）
  - 同 timestamp 多事件按 orderIndex 顺序
  - 合成 `__cd__:` 资源与原 `cooldownAvailable` 等价（单测直接对齐 engine.test.ts 的几个代表用例）
  - 初始已满时消耗后 refill 正确；满时产出溢出
- 验证：`pnpm test:run src/utils/resource`
- **本步骤不接任何调用方**

### 步骤 3 · validator + legalIntervals + placement 解耦（破坏性手术，独立 commit）

- 新建 `src/utils/resource/validator.ts`（含 `excludeId`）
- 新建 `src/utils/resource/legalIntervals.ts`（或放进 `compute.ts` 同文件），导出 `resourceLegalIntervals(action, playerId, resourceEvents, registry): Interval[]`
- 新建 `src/utils/resource/validator.test.ts`，覆盖：
  - 仅 `cooldown` 的 action 冲突 → `resource_exhausted`
  - 显式 resourceEffects 不足 → `resource_exhausted`
  - `excludeId` 排除被拖拽 cast 的效果
- 新建 `src/utils/resource/legalIntervals.test.ts`，覆盖：
  - **自耗尽段**：单充能 forbidden `[t_e, t_e + cd)`
  - **下游透支段**：单充能 M=0 场景 forbidden `(t_e − cd, t_e)`
  - **等价性 property**：单充能合成 `__cd__` 路径生成的 shadow 在全部 `engine.test.ts` 回归用例数值上与旧 `cooldownAvailable` 等价（逐帧对齐 TIME_EPS 容差内）
  - **多充能（献奉双 cast）**：shadow = `(−30, 60)`
  - **慰藉有 regen=30**：下游透支窗口 `(t_C − 30, t_C)`；`[120, 142)` placement ∩ resource-legal 覆盖 `[120, 155)` 外部时，用户无法连用第 3 次慰藉
  - **无 regen 的假想资源**：下游透支窗口延伸到 −∞（本次迁移不含此类 action，仅作理论测试）
  - **浮点紧贴边界**（从 `engine.test.ts:221` 回归用例搬过来，换成 resourceLegalIntervals 路径）
- `src/utils/placement/types.ts`：`InvalidReason` 一把改，不保留别名
- `src/utils/placement/engine.ts`：
  - 删除 `cooldownAvailable`
  - 删除 `findInvalidCastEvents` 内的 CD 重叠内联判断
  - `findInvalidCastEvents` 最外层合并 placement 结果 + resource 结果
- `src/utils/placement/engine.test.ts`：
  - 所有 `'cooldown_conflict'` 断言改 `'resource_exhausted'`
  - **浮点边界、回溯自身排除、紧贴边界 ULP** 等回归用例 **全部保留**
  - **跨 actionId 同 trackGroup 的 CD 冲突测试**（若存在）：确认迁移后该组合转为合法；如需保留 GCD 级检测请改由 placement 层或独立 GCD validator 承担（本次不做）
- UI 文案分支（按**失败资源的 `max`** 判）：
  - 失败 resource `max == 1` → 文案"冷却中"（涵盖 `__cd__:${id}` 合成池 + 未来 max=1 的显式池）
  - 失败 resource `max > 1` → 文案"层数不足"（慰藉 / 献奉）
  - `InvalidCastEvent` 需携带失败的 `resourceId`（或 `resourceKey`）以便 UI 查 `registry[resourceId]?.max ?? 1`
  - 落地点：`src/components/Timeline/CastEventIcon.tsx` + `src/components/Timeline/index.tsx`
  - 核查面：Grep `'CD 冲突'` / `'cooldown_conflict'` / `'resource_exhausted'`
- 验证：`pnpm test:run`

### 步骤 4 · 学者慰藉迁移

`src/data/resources.ts` 加 `sch:consolation`。

`src/data/mitigationActions.ts`：

```ts
// 炽天召唤 (16545)
{
  id: 16545,
  // ...
  executor: createBuffExecutor(3095, 22),        // 去掉假 buff 20016546 及其 stack
  // 无 resourceEffects —— 120s CD 由 D3 合成 __cd__:16545 强制
},

// 慰藉 (16546)
{
  id: 16546,
  name: '慰藉',
  // ...
  duration: 30,
  cooldown: 30,                                  // 恢复真实值（原 1 是 hack）
  executor: createShieldExecutor(1917, 30),      // 去掉手动 stack 维护
  placement: whileStatus(3095),                  // 炽天真 buff 做窗口门
  resourceEffects: [{ resourceId: 'sch:consolation', delta: -1 }],
  statDataEntries: [{ type: 'shield', key: 1917 }],
},
```

验证要点：

- 战斗起手 `sch:consolation = 2` 但 `whileStatus(3095)` 在 `[0, 120)` 无合法区间 → 慰藉被 placement 挡在首炽天前，不会误用库存
- 炽天后连用 2 次慰藉合法、第 3 次 `resource_exhausted`
- 炽天 buff 在 [120, 142)，resource 自充能在 [155, 160] 各补 1 层；但 placement 在 [142, 240) 禁止慰藉 → 蓝条 vs 真实可用有 UX 错位（见「蓝色 CD 条渲染」节的说明），语义上**蓝条仅反映资源恢复进度，不参与 placement 判断**

删除：

- `src/executors/createBuffExecutor.ts` 的 `BuffExecutorOptions.stack` 字段（唯一消费者是炽天，已下线）
- 全库对 `20016546` 的引用（目前仅 mitigationActions.ts 三处）

验证：

- `pnpm test:run`（全量）
- 手动构造 SCH 时间轴：
  - 炽天后连用 2 次慰藉合法、第 3 次 `resource_exhausted`
  - 炽天前用慰藉 → `resource_exhausted` + 炽天 buff 不存在 `placement_lost` → `'both'`
  - 炽天后 25s（buff 已过）用慰藉 → `placement_lost`
- 减伤数值与迁移前 byte-identical

### 步骤 5 · 献奉迁移（首个 regen 样本）

`src/data/resources.ts` 加 `drk:oblation`（已在 D1 示例里）。

`src/data/mitigationActions.ts`：

```ts
// 献奉 (25754)
{
  id: 25754,
  name: '献奉',
  // ...
  duration: 7,
  cooldown: 60,                                  // 保留为单层回充 shorthand（但被 resourceEffects 替换）
  executor: createBuffExecutor(2682, 7),
  resourceEffects: [{ resourceId: 'drk:oblation', delta: -1 }],
},
```

验证：

- 单测（步骤 2 已覆盖）
- **手动验证时序**（必须亲手过一遍，充能计时的关键回归）：构造 4 个献奉 cast，逐一检查：

| cast | 时刻 | 期望 amount（cast 前）      | 期望 amount（cast 后）   | 期望判定               |
| ---- | ---- | --------------------------- | ------------------------ | ---------------------- |
| #1   | t=0  | 2                           | 1（schedule refill@60）  | ✓ 合法                 |
| #2   | t=30 | 1                           | 0（schedule refill@90）  | ✓ 合法                 |
| #3   | t=70 | 1（refill@60 已 fire，0→1） | 0（schedule refill@130） | ✓ 合法                 |
| #4   | t=85 | 0（refill@90 未到）         | -1                       | ✗ `resource_exhausted` |

若把 #4 从 t=85 移到 t=90 → refill@90 命中，amount 0→1 后 cast 合法。**这条 t=85 vs t=90 的临界值就是 D4 充能计时 vs 固定钟差异的试金石**：草案固定钟模型会在 t=60 tick 使 amount 变成 2，之后 t=90 tick 再补到 2、t=70 的 cast 就会拿到 2→1、#4 在 t=85 就会合法。真实 FF14 是 t=85 非法。

### 步骤 6 · Canvas 渲染

见「蓝色 CD 条渲染」节。要点：

- 新建 `src/utils/resource/cdBar.ts`（或挂进 `compute.ts`），导出 `computeCdBarEnd(action, castEvent, resourceEventsByKey, registry)`
- `PlacementEngine` 加 `cdBarEndFor(castEventId): number | null`，内部按 id cache
- `SkillTracksCanvas.tsx:564+` 调用点增加 `cdBarEnd={engine?.cdBarEndFor(castEvent.id) ?? null}` prop 传递
- `CastEventIcon.tsx:144-187` 六处 `action.cooldown` 全部改用 `rawEndSec / visualEndSec / remaining`（按"蓝色 CD 条渲染"节的渲染片段）
- `Infinity` 情形（无 regen + 无下个产出）：UI 层截到时间轴右端 `timelineEndSec`（从已有 `timeline.totalDuration` 取）
- 单测：`cdBar.test.ts` 覆盖四类场景 + 献奉三连 + 慰藉扫下一个产出 + 无下一产出 → Infinity + 单充能等价于 `t_C + cooldown`
- 不新增层数角标

shadow 由 `engine.computeTrackShadow` 走新 `resourceLegalIntervals` 自动承接，`SkillTracksCanvas.tsx` 外层调用点不动。`computePlacementShadow` 保持原样（短 CD 轨道行为不变）。

### 步骤 7 · 清理与文档

- 全库搜 `cooldown_conflict` / `CD 冲突` 字面量，确认零残留
- 更新 `CLAUDE.md` "核心概念" 章节加"资源模型"小节，引用本 spec
- 更新受影响模块的头部注释

## 风险与注意事项

1. **UI 文案扫查**：步骤 3 完成后 Grep `CD 冲突` / `cooldown_conflict`，确认所有用户可见文案按**失败资源 `max`** 分支（`max==1 → 冷却中`；`max>1 → 层数不足`）。需要 `InvalidCastEvent.resourceId` 传到 UI。

2. **假 buff `20016546` 废弃连锁**：仅 `mitigationActions.ts` 3 处引用；`BuffExecutorOptions.stack` 字段随之删。步骤 4 末尾 Grep `20016546` / `\.stack` 确认零残留。

3. **Performance**：`findResourceExhaustedCasts` 按 `resourceKey` 分组后遍历。常规战斗 castEvents 100–300、资源池 <10，远低于性能敏感阈值；`pendingRefills` 用排序数组即可，无需堆。

4. **回溯一致性**：修改中途 cast 让下游重算资源可用性，与 `MitigationCalculator` 重算模型同构，架构无新问题。

5. **`__cd__:` 命名空间**：`RESOURCE_REGISTRY` 导入时断言显式 id 不得以该前缀开头，防未来有人误命名冲突。

## 范围外（未来课题）

- **事件派生规则**：WHM 血百合（治疗技能累计 3 次 → +1 层）需要"cast → 资源事件"规则映射，而非单点 `resourceEffects` 直接声明
- **状态关联资源**：如"某 buff 消失时某资源清零"；本次 D6 证明 SCH 不需要，但未来可能有其他职业需要
- **多层充能 CD 条可视化**：带 regen 技能（献奉等）如何表达"距下一层"与"距满层"的复合信息；本次先不画，等首个用户反馈后定
- **UI 资源面板**：时间点当前各玩家各池子值的独立面板
- **regen.amount > 1 的语义**：当前 FF14 充能类都是 amount=1，未来若真有 +N 池再定义

---

**核准检查表（供 review 时勾选）**：

- [ ] D1–D6 核心决策
- [ ] 充能计时算法（t=45 献奉 → t=105 refill 的核心 case）
- [ ] `InvalidReason` 一把改 `resource_exhausted`、不保留 `cooldown_conflict` 别名
- [ ] 慰藉 placement 改 `whileStatus(3095)`、`cooldown` 恢复 30、假 buff 废弃
- [ ] 献奉一起迁（步骤 4 + 5 同个 PR）
- [ ] UI 文案按失败资源 `max` 分支（`InvalidCastEvent.resourceId` 需携带）
- [ ] 资源模型与 `trackGroup` 完全解耦；合成 `__cd__:${actionId}`
- [ ] shadow 由 `resourceLegalIntervals` 推导（自耗尽段 + 下游透支段）
- [ ] 蓝色 CD 条语义：此 cast 打空池子到恢复到 ≥|delta| 的时段；还有库存时不画
- [ ] CD 条末端文本 = `Math.round(rawEnd − t_C)`；被 `nextCastTime` 截或 <3s 不画文本
- [ ] `computeCdBarEnd` + `engine.cdBarEndFor` 接入 `CastEventIcon`

**最后更新**：2026-04-24
