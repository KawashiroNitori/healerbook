# 资源模型设计（草案）

> 草案阶段。替换现有"单层 `cooldown` + 假 buff 模拟 stack"的方案，引入统一的**随时间/事件变化的资源池**抽象。本文档是另一个分支实现时的指导说明。

## 背景

当前 `MitigationAction` 只有单一的 `cooldown: number` 字段，表达"每 N 秒可用一次"。对于**带充能**的技能（如献奉：60s CD 但可积蓄 2 层）或**多技能共享资源池**（如学者的以太超流 / 慰藉积蓄）就表达不了。

现状里为了模拟学者慰藉的"只有炽天召唤之后才能用，最多叠 2 层"这种语义，`mitigationActions.ts` 采取了绕路做法：

- 炽天召唤 `executor` 附加一个**假 buff `20016546`**，用 `stack: 2` 表达充能数
- 慰藉的 `executor` 手动找到假 buff、减 stack、stack 为 0 时移除
- 慰藉的 `placement` 用 `whileStatus(20016546)` 限制必须在有层时才能用

这条路径：

1. 把"资源"语义塞进了"状态"通道，混淆了两个本应正交的概念
2. 每加一种充能技能都要写一段类似的 executor boilerplate
3. placement 系统被迫承担"CD 冲突"之外的"层数用尽"检测
4. 无法自然扩展到"时间恢复的充能技能"（献奉那种）

## 目标

- 统一模型同时表达**单层 CD 技能**、**多层充能技能**、**多技能共享资源池**、**事件驱动资源**
- 对现有 200+ 个 action 数据**零破坏**：仅声明了 `cooldown` 的 action 自动按"单层 CD 资源"处理
- 把"CD/层数可用性校验"从 placement 引擎中抽离为独立 validator
- 为未来扩展（如 SCH 以太超流 / WHM 百合 / AST 抽卡）铺好类型层

## 非目标

- **不**实现复杂的事件派生规则（例：WHM 血百合靠累计 3 次治疗技能生成 1 层）。本次只做"cast 直接产出/消耗资源"的直接映射；复杂累加规则作为后续独立课题
- **不**重新设计 UI。Canvas 渲染分支仅做最小必要调整；多层充能技能的 CD 条可视化作为独立设计项单独讨论
- **不**引入跨场战斗的资源持久化。资源状态纯从单场 castEvents 派生

## 核心概念

### 1. 资源是**玩家私有**的

每个玩家按职业持有若干资源池实例。`ResourceDefinition` 是静态声明；运行时按 `Composition.players` 展开 —— 职业匹配的玩家各自获得一份独立池子。私有资源（献奉只有该玩家自己的 CD）和共享资源（百合一个玩家的三个治疗技能共用）在模型里**不需区分**：差别只在于有多少 action 的 `resourceEffects` 指向同一个 `resourceId`。

### 2. 资源状态**不入 `PartyState`**，纯函数派生

当前 `PartyState.statuses` 已经是从 `castEvents` 派生出来的。资源同构：单一真理源是**资源定义 + 排序后的资源事件流**，任意时刻的资源量由纯函数算出。这与 `MitigationCalculator` 的按需计算理念一致，避免状态二次存储与同步问题。

### 3. `cooldown` 字段保留，采取**隐式合成**

不要求现有 action 改动。运行时若 action 未声明 `resourceEffects`，compute 层按下面规则**虚拟**一个单层资源参与校验：

```
resource = {
  id: `__cd__:${actionId}`,   // 每个 action 独立私有池
  initial: 1, max: 1,
  regen: { interval: action.cooldown, amount: 1 },
}
effect = { resourceId, delta: -1 }
```

这样现有 CD 冲突行为与"单层充能资源"在数学上完全等价，无数据迁移成本。

### 4. 资源既可时间 regen 也可事件增减

- 时间 regen：`regen: { interval, amount }`，不声明则不自然恢复
- 事件增减：由某个 action 的 `resourceEffects[].delta > 0` 触发（例：炽天召唤 `+2` 慰藉充能）
- 同一资源可同时存在两种来源，compute 层统一处理

## 类型定义

### `src/types/resource.ts`（新文件）

```ts
import type { Job } from '@/data/jobs'

/** 资源池定义（静态数据） */
export interface ResourceDefinition {
  /** 资源 id，如 'sch:consolation' / 'drk:oblation' / 'wm:lily' */
  id: string
  /** UI 显示名 */
  name: string
  /** 持有此资源池的职业；按 Composition.players 展开，每位匹配玩家各一份实例 */
  job: Job
  /** 战斗开始时的值 */
  initial: number
  /** 池子上限 */
  max: number
  /** 时间 regen；不声明 = 不随时间恢复 */
  regen?: {
    interval: number // 秒
    amount: number // 每 interval +amount，clamp 到 max
  }
}

/** 技能对资源的影响声明（挂在 MitigationAction 上） */
export interface ResourceEffect {
  /** 目标资源 id */
  resourceId: string
  /** 正 = 产出，负 = 消耗；一次 cast 可对多个资源声明多个 effect */
  delta: number
  /** 仅对 delta < 0 有意义：资源不足是否阻止使用（默认 true） */
  required?: boolean
}

/** 派生出的资源事件（不存储，从 castEvents 映射） */
export interface ResourceEvent {
  /** 实例 key：`${playerId}:${resourceDefId}` */
  resourceKey: string
  /** 事件发生时刻（秒） */
  timestamp: number
  /** 变化量，正负符号与 ResourceEffect.delta 一致 */
  delta: number
  /** 产生此事件的 castEvent.id */
  castEventId: string
  /** 对应的 action id，用于调试 */
  actionId: number
  /** 若 delta < 0 且 required=false，可能资源不足也允许通过；默认 true */
  required: boolean
}
```

### `src/types/mitigation.ts`（扩展）

```ts
export interface MitigationAction {
  // ... 现有字段保持不动
  /** 一次 cast 对资源池的影响；未声明则 compute 层按 cooldown 隐式合成 */
  resourceEffects?: ResourceEffect[]
}
```

### `src/data/resources.ts`（新文件）

模仿 `statusRegistry.ts`，集中声明所有显式资源池：

```ts
import type { ResourceDefinition } from '@/types/resource'

export const RESOURCE_REGISTRY: Record<string, ResourceDefinition> = {
  'sch:consolation': {
    id: 'sch:consolation',
    name: '慰藉充能',
    job: 'SCH',
    initial: 0,
    max: 2,
    // 无 regen —— 纯事件驱动
  },
  // 'drk:oblation': { ... 献奉 }
  // 'wm:lily': { ... 百合 }
  // 后续按需添加
}
```

## 计算层 API

### `src/utils/resource/compute.ts`（新文件）

```ts
/**
 * 从 castEvents 派生出全队资源事件流
 * 对无 resourceEffects 的 action，合成 `__cd__:${actionId}` 单层资源
 * 返回按 resourceKey 分组、按 timestamp 升序的事件
 */
export function deriveResourceEvents(
  castEvents: CastEvent[],
  actions: Record<number, MitigationAction>,
  composition: Composition
): Map<string /* resourceKey */, ResourceEvent[]>

/**
 * 计算某资源实例在 atTime 时刻的值
 * 已知事件列表按 timestamp 升序；timestamp === atTime 的事件在查询中已生效
 */
export function computeResourceAmount(
  def: ResourceDefinition,
  events: ResourceEvent[],
  atTime: number
): number
```

**算法**（伪代码）：

```
amount = def.initial
nextRegenTick = def.regen ? def.regen.interval : +Infinity
for event in events where event.timestamp <= atTime:
  while nextRegenTick <= event.timestamp:
    amount = min(amount + def.regen.amount, def.max)
    nextRegenTick += def.regen.interval
  amount = clamp(amount + event.delta, 0, def.max)
while nextRegenTick <= atTime:
  amount = min(amount + def.regen.amount, def.max)
  nextRegenTick += def.regen.interval
return amount
```

> 注意 `clamp(..., 0, def.max)`：产出溢出要 clamp 到 max；消耗若使值变负应由 validator 检测并标记非法，而非允许负值传播。具体策略：compute 返回"若无 validator 兜底，资源可为负数"的原始值，由 validator 做合法性判断。实现里 compute 函数可以直接不 clamp 下限，让 validator 捕捉；或者 clamp 到 0 并额外返回 `exhaustedCasts` 列表。**建议采用后者**（不 clamp 下限，保留负值给 validator），让 compute 成为纯粹的数值函数，validator 负责语义解释。

## 合法性校验层

### `src/utils/resource/validator.ts`（新文件）

```ts
export interface ResourceExhaustion {
  castEventId: string
  resourceKey: string
  resourceId: string
  playerId: number
}

/** 返回所有因资源不足而非法的 cast */
export function findResourceExhaustedCasts(
  castEvents: CastEvent[],
  actions: Record<number, MitigationAction>,
  composition: Composition,
  registry: Record<string, ResourceDefinition>
): ResourceExhaustion[]
```

### 与 placement engine 的关系

当前 `src/utils/placement/engine.ts:56` 的 `cooldownAvailable` 承担了 CD 冲突检测。迁移后：

- `placement/engine.ts` 的 `cooldownAvailable` **完全删除**，engine 只管"castEvent 是否落在 `validIntervals` 内"
- `findInvalidCastEvents` 改为两个 validator 结果的并集：placement 失效 + 资源耗尽
- `InvalidReason` 新增 `'resource_exhausted'`；原 `'cooldown_conflict'` 语义由 `resource_exhausted` 覆盖（因为 CD-only action 隐式合成为资源）

### `src/utils/placement/types.ts` 改动

```ts
export type InvalidReason =
  | 'placement_lost'
  | 'resource_exhausted' // 新增，替代 'cooldown_conflict'
  | 'both'
```

若需向后兼容 UI 文案，可在 UI 层根据 action 是否声明 `resourceEffects` 决定错误提示用"CD 冲突"还是"层数不足"的措辞 —— 两者在引擎层是同一种原因。

## 渲染层变更

### `src/components/Timeline/SkillTracksCanvas.tsx`

| 情况                                                      | CD 条    | 层数角标   |
| --------------------------------------------------------- | -------- | ---------- |
| 仅 `cooldown`（无 `resourceEffects`）                     | 现状保留 | 不显示     |
| `resourceEffects` + 对应资源**无 regen**（慰藉 / 血百合） | **不画** | **不显示** |
| `resourceEffects` + 对应资源**有 regen**（献奉）          | ⚠️ 待定  | ⚠️ 待定    |

第三档作为**独立设计项**处理；本次迁移默认按"不画"实现，留 TODO 注释。决策前提：需要先跑一次带充能的真实数据，看用户对"距下一层恢复时间"的直觉需求，再确定可视化形态。

## 迁移步骤

每一步独立可测、提交、回滚。推荐按步骤单独 commit，便于 review 与 bisect。

### 步骤 1 · 类型骨架

- 新建 `src/types/resource.ts`，定义 `ResourceDefinition` / `ResourceEffect` / `ResourceEvent`
- `src/types/mitigation.ts`：`MitigationAction` 加 `resourceEffects?: ResourceEffect[]`
- 新建 `src/data/resources.ts`，导出空 `RESOURCE_REGISTRY`
- 验证：`pnpm exec tsc --noEmit` + `pnpm lint`，零行为变更

### 步骤 2 · compute 层 + 单元测试

- 新建 `src/utils/resource/compute.ts`，实现 `deriveResourceEvents` / `computeResourceAmount`
- 新建 `src/utils/resource/compute.test.ts`，覆盖：
  - 纯时间 regen（0 事件、1 事件、多事件穿插 regen）
  - 纯事件驱动（无 regen，产出 + 消耗）
  - 混合（时间 regen + 事件产出 + 事件消耗）
  - 初始 = max 时 regen 不溢出
  - 同时刻多事件的顺序处理
  - 合成 CD 资源（action 只有 cooldown、无 resourceEffects）与原 `cooldownAvailable` 等价
- 验证：`pnpm test:run src/utils/resource`
- **本步骤不接入任何调用方**，纯新增代码

### 步骤 3 · validator + placement 解耦

- 新建 `src/utils/resource/validator.ts`，实现 `findResourceExhaustedCasts`
- `src/utils/placement/types.ts`：`InvalidReason` 加 `'resource_exhausted'`（暂时保留 `'cooldown_conflict'` 作为 deprecated 别名，下一步再清理）
- `src/utils/placement/engine.ts`：
  - 删除 `cooldownAvailable` 函数
  - `findInvalidCastEvents` 内部不再检查 CD 冲突
  - 上层（`engine.ts` 的导出入口 `findInvalidCastEvents`）合并 placement 结果 + `findResourceExhaustedCasts` 结果
- 更新 `src/utils/placement/engine.test.ts`：
  - 所有 `'cooldown_conflict'` 断言改为 `'resource_exhausted'`
  - 浮点边界、回溯自身排除等回归用例全部保留
- 验证：`pnpm test:run`（全量）

> ⚠️ 这一步是破坏性手术的关键点。独立 commit，review 通过后再进下一步。

### 步骤 4 · 学者慰藉迁移（回归验证）

利用现有"假 buff + stack"的绕路代码作为试金石。期望迁移后行为等价，代码大幅简化。

改动 `src/data/resources.ts`：

```ts
'sch:consolation': {
  id: 'sch:consolation',
  name: '慰藉充能',
  job: 'SCH',
  initial: 0,
  max: 2,
}
```

改动 `src/data/mitigationActions.ts`：

```ts
// 炽天召唤（id=16545）
{
  id: 16545,
  // ...
  executor: createBuffExecutor(3095, 22),           // 去掉假 buff 20016546
  resourceEffects: [{ resourceId: 'sch:consolation', delta: +2 }],
}

// 慰藉（id=16546）
{
  id: 16546,
  // ...
  executor: createShieldExecutor(1917, 30),         // 去掉手动 stack 维护
  resourceEffects: [{ resourceId: 'sch:consolation', delta: -1 }],
  // 删除 placement: whileStatus(20016546)
}
```

删除：

- `src/executors/createBuffExecutor.ts` 里 `BuffExecutorOptions.stack` 字段（如果没有其他 action 使用）
- 所有 statusId `20016546` 相关代码

验证：

- `pnpm test:run`（全量，关注 mitigationCalculator 相关测试）
- 手动构造一个 SCH 时间轴：炽天召唤后连续用 2 次慰藉合法，第 3 次标记 `resource_exhausted`；未用炽天召唤前的慰藉也标记 `resource_exhausted`
- 减伤计算数值与迁移前完全一致

### 步骤 5 · 献奉作为首个时间 regen 样例

- `src/data/resources.ts` 加：

  ```ts
  'drk:oblation': {
    id: 'drk:oblation',
    name: '献奉',
    job: 'DRK',
    initial: 2,
    max: 2,
    regen: { interval: 60, amount: 1 },
  }
  ```

- `mitigationActions.ts` 对应献奉 action 加 `resourceEffects: [{ resourceId: 'drk:oblation', delta: -1 }]`
- `cooldown` 字段**保留**（用于 Canvas 兜底渲染与其他可能依赖；不保留也可行，视步骤 6 渲染方案定）
- 单元测试 + 手动验证：2 层起手，连续 2 次合法，第 3 次 `resource_exhausted`；60s 后恢复 1 层

### 步骤 6 · Canvas 渲染最小调整

- `SkillTracksCanvas.tsx` 按上面渲染规则表：
  - 有 `resourceEffects` + 对应资源无 regen → 不画 CD 条、不画层数角标
  - 有 `resourceEffects` + 对应资源有 regen → 同上（先落最小实现，TODO 注释指向单独设计项）
  - 其他分支保持现状
- 不引入新的视觉元素。层数 / 充能 UI 作为下一个独立任务

### 步骤 7 · 清理与文档

- `'cooldown_conflict'` 枚举值彻底删除，全局搜索替换
- CLAUDE.md "核心概念" 章节加"资源模型"小节（引用本文档）
- 更新受影响模块的注释

## 风险与注意事项

1. **`cooldown_conflict` → `resource_exhausted` 的 UI 文案**：若现有 UI 错误提示里硬编码了"CD 冲突"字样，需要改为"层数不足 / 冷却中"之类更中性的措辞，或在 UI 层按 action 类型分支（有显式 `resourceEffects` → "层数不足"，纯 CD → "冷却中"）。步骤 3 完成后搜一遍 UI 代码。

2. **学者慰藉迁移细节**：现在 placement 上 `whileStatus(20016546)` 的语义包含"炽天召唤 buff 还在（22s 内）"这层时间约束。迁移后只靠资源校验，**能量池本身没有过期**——如果用户在炽天召唤 30s 后还想用慰藉，资源池理论上仍允许。需要确认这是符合游戏真实行为的（炽天召唤 buff 本身 22s，我倾向游戏里慰藉只能在 buff 期间使用）。如果实际需要"资源随 buff 消失而清空"，需在资源模型里增加第四种机制"状态消失时 clamp 资源到 0"，这**超出本次迁移范围**。

   **处理方案**：步骤 4 迁移时保留原 `placement: whileStatus(20016546)` 约束作为时间窗口限制，资源模型只管层数；这样两套机制协同工作。等未来需要更多此类场景再抽象"状态关联资源"。

   _—— 这条需要你在实现时确认：游戏里炽天召唤 buff 结束后慰藉还能用吗？_

3. **Performance**：`findResourceExhaustedCasts` 需要按 `resourceKey` 分组后逐条迭代事件。常规战斗 castEvents 数量级在 100–300，资源池数量在 10 以内，完全没问题；若未来 castEvents 暴涨可用索引或缓存优化，当前不做。

4. **回溯一致性**：修改时间轴中途某个 cast 会让下游所有 cast 的资源可用性重算。这与现有 `MitigationCalculator` 的重算模型一致，架构上无新问题；性能方面同第 3 点。

5. **`__cd__:${actionId}` 合成资源 id 的命名空间**：为避免与显式声明的资源 id 冲突，约定显式 id **不得**以 `__cd__:` 开头。在 `RESOURCE_REGISTRY` 导入时加 assertion。

## 范围外（未来课题）

- **事件派生规则**：WHM 血百合（治疗技能累计 3 次 +1 层）需要一层"cast → 资源事件"的规则映射，而不仅仅是 action 的 `resourceEffects` 直接声明
- **状态关联资源**：如"炽天召唤 buff 消失时慰藉充能清零"，需要 status 系统与 resource 系统双向通信
- **多层充能 CD 条可视化**：献奉等带 regen 的资源，CD 条如何表达"距下一层恢复"与"距满层"的复合信息
- **UI 资源面板**：是否需要单独的 UI 面板显示当前时间点各玩家各资源池的值，辅助用户规划

---

**最后更新**：2026-04-24
