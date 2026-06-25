# 战斗资源悬浮窗设计

> 在时间轴视图与表格视图中，鼠标悬停某一时刻时，浮层展示所有成员在该时刻持有的战斗资源情况。

**状态**：已通过 brainstorming 评审，待用户复核
**日期**：2026-06-26
**关联**：`design/superpowers/specs/2026-04-24-resource-model-design.md`（资源模型）

---

## 1. 目标与范围

鼠标悬停在：

- **时间轴视图**的任意横向位置（对应一个时刻 `t`）
- **表格视图**的任意数据行（对应该行 damage event 的 `time`）

时，弹出一个**跟随光标**的浮层，按成员分组展示每名成员在 `t` 时刻持有的全部战斗资源，每种资源按其「样式类型」以不同形态渲染。

资源来源：

- `RESOURCE_REGISTRY` 中的**显式共享池**（以太超流、治疗百合、蛇胆、慰藉、献奉、天星交错、神祝祷）
- 每个减伤技能隐式/显式的 **`__cd__:${actionId}` 冷却池**

**非目标**：不改动资源 compute 层语义（`computeResourceAmount` / `computeResourceTrace` / `deriveResourceEvents` 保持不变）；不引入新的减伤计算；不做移动端适配。

---

## 2. 数据模型变更：`ResourceDefinition.style`

### 2.1 新增类型

`src/types/resource.ts`：

```ts
/** 资源在悬浮窗中的渲染样式 */
export type ResourceStyle =
  | 'cooldown' // 技能图标 + 时钟 sweep 遮罩 + 倒计时数字（+ 多充能时层数角标）
  | 'progressBar' // 进度条 + current/max 文本（连续型资源；当前 registry 暂无使用，保留扩展）
  | 'lights' // N 个指示灯，亮 amount 个
  | 'lightsWithBar' // N 个指示灯 + 下一充能积累进度条

export interface ResourceDefinition {
  // ...现有字段
  /** 悬浮窗渲染样式（必填） */
  style: ResourceStyle
  /**
   * 仅 cooldown 样式有意义：取图标的代表技能 id。
   * 省略时由运行时回退到「该池的唯一 delta<0 消费者技能」的图标。
   * cooldown 样式的显式池均为单消费者，故默认可省略。
   */
  iconActionId?: number
}
```

### 2.2 合成池样式

`syntheticCdDef`（`src/utils/resource/compute.ts`）构造的 `__cd__:${id}` 池**恒定** `style: 'cooldown'`。其图标来自合成池对应的 action（调用方已持有该 action）。

### 2.3 显式池样式分配（最终定稿）

| 池 id              | 名称       | max | 回充            | style              |
| ------------------ | ---------- | --- | --------------- | ------------------ |
| `sch:aetherflow`   | 以太超流   | 3   | 60s 一次回满 3  | `lights`           |
| `whm:lily`         | 治疗百合   | 3   | 20s / 档        | `lightsWithBar`    |
| `sge:addersgall`   | 蛇胆       | 3   | 20s / 档        | `lightsWithBar`    |
| `sch:consolation`  | 慰藉充能   | 2   | 30s / 档        | `cooldown`         |
| `drk:oblation`     | 献奉充能   | 2   | 60s / 档        | `cooldown`         |
| `ast:intersection` | 天星交错   | 2   | 30s / 档        | `cooldown`         |
| `whm:divine`       | 神祝祷充能 | 2   | 30s / 档        | `cooldown`         |
| `__cd__:${id}`     | 隐式冷却   | 1~N | action.cooldown | `cooldown`（恒定） |

- 以太超流 60s 一次性回满 3 档，进度条无意义 → `lights`。
- 百合 / 蛇胆逐档回充，进度条有意义 → `lightsWithBar`。
- 2 充能单技能池均为 `cooldown`，复用技能图标 + sweep + 层数角标，与隐式 CD 池观感一致。
- `progressBar` 样式仅实现 + 单测覆盖渲染，当前 registry 无连续型资源使用它。

---

## 3. 资源快照计算：`useResourceHoverData`

新增 `src/hooks/useResourceHoverData.ts`，在 `DamageCalculationContext` 作用域内消费：

- `useTimelineStore` → `timeline`（castEvents、composition）
- `useMitigationStore` → `actions`
- `useFilterStore` → `getActivePreset()`
- `useStatusTimelineByPlayer()`、`useResolvedVariantByCastId()`（来自 `DamageCalculationContext`）

### 3.1 派生事件（memo）

```ts
const resourceEventsByKey = useMemo(
  () => deriveResourceEvents(timeline.castEvents, actionsById, statusTimeline, resolvedVariant),
  [timeline.castEvents, actionsById, statusTimeline, resolvedVariant]
)
```

独立于两个视图各自的 `PlacementEngine`，避免耦合；`deriveResourceEvents` 成本低。

### 3.2 资源宇宙（filter 之前）

对每个成员 `(playerId, job)`：

- **CD 池**：该 job 可用的**全部技能**各自的 `__cd__:${actionId}` 池（含未释放的技能——其池恒为满/就绪）。具体取该 action `effectsForAction` 中代表性 `delta<0` 的 `__cd__:` effect；若 action 走显式共享池消费（无 `__cd__`），则该 action **不产生** CD 池项（其 recast 由共享池表达）。
- **显式共享池**：`RESOURCE_REGISTRY` 中 `def.job === job` 的全部池。

### 3.3 过滤器 gating

- **CD 池**：仅当 `matchSingleAction(action, job, preset)` 为真才纳入。
- **显式共享池**：仅当该成员在当前过滤器下**有任意技能可见**（存在某 action 满足 `action.jobs.includes(job) && matchSingleAction(action, job, preset)`）才纳入。
- 成员若无任何可见池 → 不出现在面板。

### 3.4 快照接口

```ts
interface ResourceWidget {
  resourceId: string
  style: ResourceStyle
  name: string
  icon?: string // cooldown 样式：代表技能图标
  amount: number
  max: number
  /** 仅当 amount < max 且有 regen：距下一充能恢复剩余秒 */
  countdownSec?: number
  /** 仅 lightsWithBar / cooldown sweep：下一充能积累进度 [0,1] */
  nextChargeProgress?: number
}

interface MemberResourceSnapshot {
  playerId: number
  job: Job
  /** 非 CD 类池（style !== 'cooldown'）：按 resources.ts 定义顺序 */
  pools: ResourceWidget[]
  /** CD 类池（style === 'cooldown'，含合成 __cd__ 与显式 cooldown 池）：按代表技能在 mitigationActions.ts 的顺序 */
  cooldowns: ResourceWidget[]
}

// hook 返回（成员按 composition.players 顺序）
function getSnapshotAt(time: number): MemberResourceSnapshot[]
```

### 3.5 排序规则

- **成员**：按 `timeline.composition.players` 顺序（即阵容所列职业顺序）。
- **职业内 `pools`（非 CD 类）**：按 `RESOURCE_REGISTRY` 的 key 声明顺序（`resources.ts` 定义顺序）排列。
- **职业内 `cooldowns`（CD 类）**：按各池**代表技能**在 `actions`（源自 `mitigationActions.ts`）数组中的下标排序。代表技能：`__cd__:${actionId}` 取 `actionId`；显式 cooldown 池（慰藉/献奉/天星交错/神祝祷）取其唯一 `delta<0` 消费者技能（即 `iconActionId` 的回退目标）。

计算细节（每个池）：

- `def = resolveDef(resourceId, RESOURCE_REGISTRY, actionForSynthCd)`；`amount = computeResourceAmount(def, events, time)`。
- 倒计时 / 进度：用 `computeResourceTrace(def, events)` 取「时间戳 ≤ time 的最后一个事件」的 `pendingAfter`，再叠加 `time` 之前已触发的 refill 后剩余的 pending（与 `computeResourceAmount` 同口径）。取最早一条 pending `earliest`：
  - `countdownSec = earliest − time`（仅 `amount < max`）
  - `nextChargeProgress = clamp((time − (earliest − def.regen.interval)) / def.regen.interval, 0, 1)`
  - 满档（`amount === max`）或无 regen → 两者均省略。

> 为避免「最后事件 pending + 后续 time 内 refill」口径分裂，hook 内实现一个轻量 `pendingStateAt(def, events, time)`：复刻 `computeResourceTrace` 的 firePending/调度逻辑跑到 `time`，返回 `{ amount, pending: number[] }`。这是 compute 层逻辑的只读复用，不修改原函数。

---

## 4. hover 状态打通：`resourceHoverStore`

新增 `src/store/resourceHoverStore.ts`（轻量 Zustand）：

```ts
interface ResourceHoverState {
  time: number | null
  cursor: { x: number; y: number } | null
  setHover: (time: number, cursor: { x: number; y: number }) => void
  clearHover: () => void
}
```

**写入方**：

- **时间轴视图** `src/components/Timeline/index.tsx`：mousemove 已算出 `hoverTimeRef.current`，在同一处 throttle（rAF 合并）写 `setHover(time, {x: e.evt.clientX, y: e.evt.clientY})`；mouseleave 写 `clearHover()`。
- **表格视图** `src/components/TimelineTable/TableDataRow.tsx`：行 `onMouseMove` 写该行 damage event 的 `time` + 光标坐标；`onMouseLeave` → `clearHover()`。

> store 仅承载 hover 瞬时态，不持久化、不进 timeline 数据。

---

## 5. 悬浮窗组件 `ResourceHoverPanel`

新增 `src/components/ResourceHover/`：

- `ResourceHoverPanel.tsx`：挂在 `EditorPage` 的 `DamageCalculationContext.Provider` 内、视图之后。读 `resourceHoverStore`；`time == null` 则不渲染。调 `useResourceHoverData().getSnapshotAt(time)`。
  - `position: fixed`，基于 `cursor` 定位（偏移 +16/+16），近右/下边界时翻转到光标左/上侧，避免越出视口。
  - `pointer-events: none`，避免浮层自身吃 hover。
  - 布局：顶部时刻标签 `T+45.2s`；其下按 `composition.players` 顺序逐成员一行：`[职业图标] [pools…] [cooldowns section]`。
    - `pools`（非 CD 类，resources.ts 顺序）先横向排列。
    - 其后接 `cooldowns` 紧凑平铺 section（按 mitigationActions.ts 顺序），作为该成员行的最后一段——小图标网格密铺、必要时换行，与前面的 pools 在视觉上区隔（如间距/分隔）。
- 部件子组件：
  - `CooldownWidget.tsx`：技能图标 + 径向灰色 sweep 遮罩（sweep 比例 = `countdownSec / def.regen.interval`，即 `1 − nextChargeProgress`）+ 中央倒计时整数秒；`max ≥ 2` 时右下角层数角标显示 `amount`。满档无遮罩/数字。
  - `ProgressBarWidget.tsx`：进度条（`amount/max`）+ `amount / max` 文本。
  - `LightsWidget.tsx`：`max` 个指示灯，前 `amount` 个点亮。
  - `LightsWithBarWidget.tsx`：`LightsWidget` + 细进度条（`nextChargeProgress`）。

渲染分发按 `widget.style` switch。

---

## 6. 测试

- `src/hooks/useResourceHoverData.test.ts`（纯逻辑，构造 timeline + preset）：
  - gating：各内置预设（全部 / 仅团减 / 仅治疗 / 仅坦克 / 仅 DPS）下成员与池的纳入正确；自定义预设勾选父 id 的命中。
  - amount / countdownSec / nextChargeProgress 计算：含满档（无倒计时）、多 pending 取最早、无 regen 池、`__cd__` 单充能与多充能。
  - `pendingStateAt` 与 `computeResourceAmount` 的 amount 一致性。
  - 排序：成员按 composition 顺序；`pools` 按 resources.ts 顺序；`cooldowns` 按代表技能在 mitigationActions.ts 的下标顺序。
- `src/components/ResourceHover/*.test.tsx`：4 个 widget 渲染快照（含 `progressBar` 未使用样式）。
- 回归：`pnpm test:run`、`pnpm exec tsc --noEmit`、`pnpm lint`。

---

## 7. 受影响文件清单

**改**：

- `src/types/resource.ts`：`ResourceStyle` 类型、`ResourceDefinition.style` / `iconActionId`
- `src/data/resources.ts`：7 个显式池补 `style`
- `src/utils/resource/compute.ts`：`syntheticCdDef` 写 `style: 'cooldown'`
- `src/components/Timeline/index.tsx`：mousemove/leave 写 hover store
- `src/components/TimelineTable/TableDataRow.tsx`：行 hover 写 hover store
- `src/pages/EditorPage.tsx`：挂载 `ResourceHoverPanel`

**增**：

- `src/store/resourceHoverStore.ts`
- `src/hooks/useResourceHoverData.ts`（+ test）
- `src/components/ResourceHover/ResourceHoverPanel.tsx`
- `src/components/ResourceHover/{CooldownWidget,ProgressBarWidget,LightsWidget,LightsWithBarWidget}.tsx`（+ test）

---

## 8. 风险与权衡

- **「职业全部资源」信息密度**：「全部」过滤器下治疗成员的 CD 池可达 10+ 个，跟随光标的浮层会较大。用户已知悉并接受——窄过滤器（仅治疗/仅团减）即可收敛展示集。
- **跟随光标抖动**：throttle + rAF 合并 mousemove 写入；`pointer-events: none` 防自吃 hover。
- **`pendingStateAt` 复刻逻辑**：与 `computeResourceTrace` 同源，单测以一致性断言锁死，避免两份逻辑漂移。
