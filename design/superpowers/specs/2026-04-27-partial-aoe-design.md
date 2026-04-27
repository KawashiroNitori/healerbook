# 部分 AOE 伤害类型扩展设计

> 日期：2026-04-27
> 范围：`DamageEventType` 枚举扩展 + FFLogs 导入期自动判别 + UI / 过滤器同步

## 背景与目标

当前 `DamageEventType` 仅区分三类：

- `aoe` —— 普通面向非 T 职业的全员 AOE
- `tankbuster` —— 死刑（仅命中坦克）
- `auto` —— 普通攻击

实战中常见的"AOE 只命中部分非 T"场景（连续点名分摊、机制错位）无法被表达，导致：

1. 时间轴上看不出某次机制是"全员 AOE"还是"分波 AOE"
2. 过滤器无法精确筛出这类事件
3. FFLogs 导入时这类事件被一并归类为 `aoe`，与真正的全员 AOE 混淆

本次扩展引入两个新枚举：

- `partial_aoe` —— 部分 AOE，相对于全员 AOE 的，只攻击了一部分非 T 职业的攻击
- `partial_final_aoe` —— 部分 AOE（结算），出现该类型时证明所有非 T 职业均至少被攻击过一次

并在 FFLogs 导入期自动按"被命中的非 T 玩家集合"做状态机判别，把原本统一为 `aoe` 的子集细分。

## 核心决策

| 决策                   | 取值                                                                  | 原因                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 新枚举对减伤计算的影响 | 无                                                                    | partial / partial_final 是 `aoe` 的语义子类，全部走"非坦专"代码路径，`mitigationCalculator` 与 `statusExtras` 无需改动 |
| UI 是否完全开放        | 是                                                                    | AddEventDialog / PropertyPanel 下拉提供 5 项；用户可在编辑模式手动选择 partial 类型                                    |
| FFLogs 状态机位置      | `detect → refineTankbuster → refineAutoAttack` 之后                   | 保证状态机消费的是已经稳定的 type，不会被 refine 改类型踩空                                                            |
| 状态机消费范围         | 仅 `type === 'aoe'` 的事件                                            | tankbuster / auto 既不参与计数也不被改写                                                                               |
| 内置过滤预设           | 自动扩展含 `aoe` 的预设为 `['aoe','partial_aoe','partial_final_aoe']` | "团减/DPS/治疗"在玩家心智里都包含部分团伤                                                                              |
| 自定义过滤预设         | 不做迁移                                                              | 用户已存的语义不应被替换；用户在 UI 上看到新增 switch 后可自行勾选                                                     |
| UI 视觉差异化          | 不做                                                                  | partial 在卡片 / minimap / 表格上视觉等同 `aoe`，仅在下拉与过滤器中体现枚举差别                                        |
| 'AOE' 文案重命名       | 'AOE' → '全员 AOE'                                                    | 仅 `DAMAGE_EVENT_TYPE_LABELS.aoe` 文案变更，枚举值不变                                                                 |

## 类型层

### `src/types/timeline.ts`

```ts
export const DAMAGE_EVENT_TYPES = [
  'aoe',
  'tankbuster',
  'auto',
  'partial_aoe',
  'partial_final_aoe',
] as const
export type DamageEventType = (typeof DAMAGE_EVENT_TYPES)[number]

export const DAMAGE_EVENT_TYPE_LABELS: Record<DamageEventType, string> = {
  aoe: '全员 AOE',
  partial_aoe: '部分 AOE',
  partial_final_aoe: '部分 AOE（结算）',
  tankbuster: '死刑',
  auto: '普通攻击',
}
```

下拉与过滤器的 Switch 标签统一从 `DAMAGE_EVENT_TYPE_LABELS` 取值，避免重复硬编码。

### `src/types/timelineV2.ts`

```ts
/** type: 0=aoe, 1=tankbuster, 2=auto, 3=partial_aoe, 4=partial_final_aoe */
ty: 0 | 1 | 2 | 3 | 4
```

### `src/utils/timelineFormat.ts`

```ts
const DAMAGE_EVENT_TYPE_TO_NUM: Record<DamageEventType, 0 | 1 | 2 | 3 | 4> = {
  aoe: 0,
  tankbuster: 1,
  auto: 2,
  partial_aoe: 3,
  partial_final_aoe: 4,
}
const NUM_TO_DAMAGE_EVENT_TYPE: readonly DamageEventType[] = [
  'aoe',
  'tankbuster',
  'auto',
  'partial_aoe',
  'partial_final_aoe',
]
```

`fromV2DamageEvent` 与 `migrateV1DamageEvent` 在反序列化时对未知数字编码（如旧 SPA 缓存遇到未来扩展）做兜底：

```ts
type: NUM_TO_DAMAGE_EVENT_TYPE[e.ty] ?? 'aoe'
```

兜底语义：未知编码退化为最宽松的非坦专路径，避免下游因 `type === undefined` 崩溃。

## FFLogs 导入流水线

### 状态机模块

新增 `src/utils/partialAoeClassifier.ts`：

```ts
import type { Job } from '@/data/jobs'
import { getJobRole } from '@/data/jobs'
import type { DamageEvent } from '@/types/timeline'

/**
 * 把 FFLogs 导入期 type === 'aoe' 的事件细分为：
 *   'aoe' / 'partial_aoe' / 'partial_final_aoe'
 *
 * 必须在 detectDamageType / refineTankbuster / refineAutoAttack 之后调用，
 * 此时 tankbuster / auto 已稳定。本函数：
 *   - 仅消费 type === 'aoe' 的事件，其余跳过（不计数、不改写）
 *   - 按 event.time 升序处理（调用方需要保证已排序）
 *   - in-place 修改 events 的 type 字段（与 refine 风格一致）
 */
export function classifyPartialAOE(
  damageEvents: DamageEvent[],
  composition: { players: Array<{ id: number; job: Job }> } | undefined
): void
```

### 算法

```
nonTankIds = composition 中 getJobRole !== 'tank' 的玩家 id 集合
hitCount   = Map<playerId, number>，初值全 0

if nonTankIds 为空 → 直接 return（极端组队，不修改任何事件）

for each event in damageEvents (按 time 升序):
  if event.type !== 'aoe' → continue                  # tankbuster/auto 跳过
  if !event.playerDamageDetails 或为空 → continue     # 数据缺失跳过

  hitNonTanks = playerDamageDetails 中 playerId ∈ nonTankIds 的玩家集合（去重）

  if hitNonTanks 为空:
    # 只命中坦克的"伪 aoe"（refine 没把它改成 tankbuster），保留 'aoe'，不动计数
    continue

  if hitNonTanks == nonTankIds（命中全部非 T）:
    event.type = 'aoe'                                # 真正的全员 AOE
    清零 hitCount
    continue

  # 否则：partial 路径
  for id in hitNonTanks:
    hitCount[id] += 1

  if 全部 nonTankIds 的 hitCount ≥ 1:
    event.type = 'partial_final_aoe'
    清零 hitCount
  else:
    event.type = 'partial_aoe'
```

### 调用点

`src/utils/fflogsImporter.ts` 的 `parseDamageEvents` 末尾：

```ts
damageEvents.sort((a, b) => a.time - b.time)
refineTankbusterClassification(damageEvents)
refineAutoAttackClassification(damageEvents, TANK_JOBS)
classifyPartialAOE(damageEvents, composition) // 新增
return damageEvents
```

`parseDamageEvents` 签名新增 `composition?: Composition` **可选参数**。`ImportFFLogsDialog`（已先调用 `parseComposition` 拿到 composition）传入；`scripts/fetch-events.ts`（dev-only 调试脚本）和 `fflogsImporter.test.ts` 的既有 27 个调用点不传，`classifyPartialAOE` 内部检测到 composition 缺失或非 T 全集为空时直接 return，保持原有 type 不变。

这样既有测试零迁移，新功能的端到端验证用 1-2 个新增 case 走完整路径即可。

## UI 与过滤器

### 下拉选择器

`src/components/AddEventDialog.tsx` 与 `src/components/PropertyPanel.tsx` 的 `<select>` 改为遍历 `DAMAGE_EVENT_TYPES`：

```tsx
{
  DAMAGE_EVENT_TYPES.map(t => (
    <option key={t} value={t}>
      {DAMAGE_EVENT_TYPE_LABELS[t]}
    </option>
  ))
}
```

显示顺序按 `DAMAGE_EVENT_TYPES` 常量声明顺序：`全员 AOE / 死刑 / 普通攻击 / 部分 AOE / 部分 AOE（结算）`。

### 过滤器对话框

`src/components/FilterMenu/EditPresetDialog.tsx:191-213` 的三个 Switch 改为遍历 `DAMAGE_EVENT_TYPES` 动态渲染，标签从 `DAMAGE_EVENT_TYPE_LABELS` 取。

### 内置过滤预设

`src/store/filterStore.ts` 中 `BUILTIN_PRESETS`：

```ts
{ id: 'builtin:raidwide', name: '仅团减', rule: {
    damageTypes: ['aoe', 'partial_aoe', 'partial_final_aoe'],
    categories: ['partywide'],
}}
{ id: 'builtin:dps', name: '仅 DPS', rule: {
    damageTypes: ['aoe', 'partial_aoe', 'partial_final_aoe'],
    jobRoles: ['melee', 'ranged', 'caster'],
}}
{ id: 'builtin:tank', name: '仅坦克', rule: {
    damageTypes: ['aoe', 'partial_aoe', 'partial_final_aoe', 'tankbuster', 'auto'],
    jobRoles: ['tank'],
}}
{ id: 'builtin:healer', name: '仅治疗', rule: {
    damageTypes: ['aoe', 'partial_aoe', 'partial_final_aoe'],
    jobRoles: ['healer'],
}}
```

`builtin:all` 不变（damageTypes 省略 = 不限）。

### 自定义预设

`customPresets` 中已存的 `damageTypes: ['aoe']` 这种值**不做迁移**。用户在 EditPresetDialog 里看到新增 switch 后可自行勾选。`useFilteredTimelineView.matchDamageEvent` 逻辑不变（已在用 `damageTypes.includes(e.type)`）。

### 视觉

`Timeline/DamageEventCard.tsx` / `Timeline/TimelineMinimap.tsx` / `TimelineTable/TableDataRow.tsx` **全部不改**。partial / partial_final 在卡片、minimap、表格上视觉等同 `aoe`。`isTankOnly` 判断（`type === 'tankbuster' || type === 'auto'`）保持不变。

## 减伤计算与 statusExtras

**不改动**：

- `src/utils/mitigationCalculator.ts:144,468` 的 `includeTankOnly` 判断保持原状，partial / partial_final 自然落在"非坦专"代码路径
- `src/data/statusExtras.ts:242` 大宇宙 `onAfterDamage` 跳过 tankbuster / auto 的判断保持原状，partial / partial_final 会被计入累计（与 `aoe` 一致的处理）

这是设计的关键好处：partial 是 aoe 的语义子类，下游计算无需感知。

## 边界 / 已知非目标

- **大宇宙累计逻辑**：partial_aoe 实际只命中部分非 T，但累加 `ctx.finalDamage` 时仍按"一份额"计入（与 `aoe` 同等对待），这与机制实际不完全相符。本次不修复——属于既有 statusExtras 的语义债，超出本任务范围。
- **Souma 导出**：不涉及。Souma 同步的是 boss cast / begincast 锚点（`SyncEvent`），不是伤害事件。
- **DamageEvent 上不持久化命中玩家计数**：状态机在导入期一次性消费完，结果落到 `type` 字段。计数器仅作为算法中间态存活，不进 V2、不进内存 Timeline。重新导入同一份 FFLogs 数据时按相同算法重算即可。
- **手动编辑后的语义自洽**：用户在 PropertyPanel 把一个 fflogs 自动判定的 `partial_aoe` 改成 `aoe`，仅改本事件 type，不会回溯重算其他事件的状态机分类。状态机仅在 import 时跑一次。

## 测试

### 新增 `src/utils/partialAoeClassifier.test.ts`

- 仅 `type === 'aoe'` 的事件被处理；tankbuster / auto 不被改写、不参与计数
- 一波命中全部非 T → `aoe`，前置计数被清零
- 一波命中部分非 T → `partial_aoe`，命中玩家计数 +1
- 累计后所有非 T 计数 ≥1（最后一波只命中之前未命中的人）→ `partial_final_aoe`，清零
- 多轮循环：partial → partial_final → partial → partial_final 正确
- 中间穿插 tankbuster / auto 不影响计数
- 空非 T 全集（8 坦极端组）→ 不修改任何事件
- `event.playerDamageDetails` 为空 → 跳过，不计数
- 同一非 T 在一个事件里出现多个 detail（多伤害包）→ 计数只 +1（去重）
- 8 人组 2T 6 非 T 端到端：一系列事件依次走完算法，断言 type 序列符合预期

### 调整 `src/utils/fflogsImporter.test.ts`

- 既有 27 个用例**零修改**（不传 composition，partial 状态机自动跳过）
- 新增 1-2 个端到端 case：mock events + 显式传 composition，跑完整流水线验证 partial 状态机被正确触发

### 调整 `src/utils/timelineFormat.test.ts`

- V2 round-trip 加 `partial_aoe` / `partial_final_aoe` 编码（3, 4）
- `migrateV1ToV2` 拿到未知字符串 type 时仍兜底为 0 = aoe（既有逻辑兼容）
- `fromV2DamageEvent` 反序列化未来未知数字编码（如 5）兜底为 'aoe'

### 调整 `src/store/filterStore.test.ts` + `src/hooks/useFilteredTimelineView.test.ts`

- 内置预设 raidwide / dps / healer / tank 的 damageTypes 扩展后能命中 partial / partial_final 事件
- 自定义预设 `damageTypes: ['aoe']` 老数据不迁移，partial 事件不在该预设结果中（验证"不做迁移"的行为）

### 不专门测的部分

- `mitigationCalculator` / `statusExtras`：判断逻辑没改，靠类型扩展不破坏既有用例隐式兜底
- UI 卡片样式：未变更，无新增视觉测试

## 实施顺序

1. 类型层：`timeline.ts` / `timelineV2.ts` / `timelineFormat.ts`（含兜底）
2. 状态机模块 `partialAoeClassifier.ts` + 单测
3. `fflogsImporter.ts` 加 composition 参数 + 调用 classifyPartialAOE
4. UI：AddEventDialog / PropertyPanel / EditPresetDialog 三处下拉与 Switch
5. 内置过滤预设扩展
6. 调整既有测试（fflogsImporter / timelineFormat / filterStore / useFilteredTimelineView）
7. `pnpm test:run`、`pnpm exec tsc --noEmit`、`pnpm lint` 全绿
