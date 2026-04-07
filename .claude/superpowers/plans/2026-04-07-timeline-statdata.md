# 时间轴数值自定义设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户自定义时间轴中的盾技能数值和安全血量，时间轴内部持有完整统计数据，所有运行时计算只读时间轴内部数据。

**Architecture:** 新增 `TimelineStatData` 类型存储在 `Timeline.statData` 中。`ActionExecutionContext.statistics` 类型从 `EncounterStatistics` 改为 `TimelineStatData`。`MitigationAction` 新增 `statDataEntries` 声明技能需要的统计字段。模态框根据 `statDataEntries` 动态生成 UI。

**Tech Stack:** React 19, TypeScript, Zustand, shadcn/ui (Modal, Collapsible), Tailwind CSS, Vitest

---

### Task 1: 新增 `TimelineStatData` 和 `StatDataEntry` 类型

**Files:**

- Create: `src/types/statData.ts`
- Modify: `src/types/timeline.ts:29-67` — Timeline 新增 `statData` 字段
- Modify: `src/types/mitigation.ts:55` — `ActionExecutionContext.statistics` 类型改为 `TimelineStatData`
- Modify: `src/types/mitigation.ts:67-88` — `MitigationAction` 新增 `statDataEntries`

- [ ] **Step 1: 创建 `src/types/statData.ts`**

```typescript
/**
 * 时间轴内部统计数据
 */

/**
 * 技能统计数据条目声明
 * 标识一个技能需要从 statData 中读取哪些字段
 */
export interface StatDataEntry {
  /** 数据类型：shield=盾量, heal=治疗量, critHeal=暴击治疗量 */
  type: 'shield' | 'heal' | 'critHeal'
  /** 对应 Record 中的 key（shield 用 statusId，heal/critHeal 用 actionId） */
  key: number
  /** 可选显示标签（如展开战术的"鼓舞"） */
  label?: string
}

/**
 * 时间轴内部统计数据
 * 存储在 Timeline.statData 中，所有运行时计算只读此数据
 */
export interface TimelineStatData {
  /** 全局安全血量（非坦最低 HP） */
  referenceMaxHP: number
  /** 盾量：statusId → 中位盾值 */
  shieldByAbility: Record<number, number>
  /** 治疗量：actionId → 中位治疗量 */
  healByAbility: Record<number, number>
  /** 暴击治疗量：actionId → 暴击治疗量 */
  critHealByAbility: Record<number, number>
}
```

- [ ] **Step 2: 修改 `src/types/timeline.ts` — Timeline 新增 `statData` 字段**

在 `Timeline` 接口中 `annotations` 字段之后添加：

```typescript
import type { TimelineStatData } from './statData'

// 在 Timeline 接口内，annotations 后面添加：
  /** 时间轴内部统计数据（盾值、治疗量、安全血量） */
  statData?: TimelineStatData
```

- [ ] **Step 3: 修改 `src/types/mitigation.ts` — `ActionExecutionContext.statistics` 和 `MitigationAction`**

```typescript
import type { TimelineStatData, StatDataEntry } from './statData'

// ActionExecutionContext 中：
  /** 时间轴统计数据（可选，用于盾值计算） */
  statistics?: TimelineStatData  // 原为 EncounterStatistics

// MitigationAction 中，hidden 字段之后添加：
  /** 技能统计数据条目声明（有此字段 → 出现在数值设置模态框） */
  statDataEntries?: StatDataEntry[]
```

注意：`EncounterStatistics` 接口本身保留不删（API 层和 Worker 仍使用），但 `ActionExecutionContext` 不再引用它。

- [ ] **Step 4: 确认类型编译通过**

Run: `npx tsc --noEmit 2>&1 | head -30`

此步骤预期会有编译错误（因为 `statistics` 类型变了但使用端还没改），记录错误列表，后续 task 逐步修复。

- [ ] **Step 5: Commit**

```bash
git add src/types/statData.ts src/types/timeline.ts src/types/mitigation.ts
git commit -m "feat: 新增 TimelineStatData 和 StatDataEntry 类型定义"
```

---

### Task 2: 为所有盾技能添加 `statDataEntries` 配置

**Files:**

- Modify: `src/data/mitigationActions.ts` — 为 11 个盾技能添加 `statDataEntries`

- [ ] **Step 1: 添加 import**

在 `src/data/mitigationActions.ts` 顶部添加：

```typescript
import type { StatDataEntry } from '@/types/statData'
```

注意：`StatDataEntry` 已通过 `MitigationAction` 的类型声明间接可用，但直接 import 更清晰。

- [ ] **Step 2: 为各技能添加 `statDataEntries`**

按照以下表格逐个添加（在对应技能对象中添加 `statDataEntries` 字段）：

| 技能         | actionId | statDataEntries                                                    |
| ------------ | -------- | ------------------------------------------------------------------ |
| 圣光幕帘     | 3540     | `[{ type: 'shield', key: 1362 }]`                                  |
| 摆脱         | 7388     | `[{ type: 'shield', key: 1457 }]`                                  |
| 神爱抚       | 37011    | `[{ type: 'shield', key: 3903 }]`                                  |
| 展开战术     | 3585     | `[{ type: 'heal', key: 185, label: '鼓舞' }]`                      |
| 意气轩昂之策 | 37013    | `[{ type: 'heal', key: 37013 }, { type: 'critHeal', key: 37013 }]` |
| 降临之章     | 37016    | `[{ type: 'heal', key: 37016 }]`                                   |
| 慰藉         | 16546    | `[{ type: 'shield', key: 1917 }]`                                  |
| 阳星合相     | 37030    | `[{ type: 'shield', key: 1921 }]`                                  |
| 泛输血       | 24311    | `[{ type: 'shield', key: 2613 }]`                                  |
| 整体论       | 24310    | `[{ type: 'shield', key: 3365 }]`                                  |
| 均衡预后II   | 37034    | `[{ type: 'shield', key: 2609 }]`                                  |

示例（圣光幕帘）：

```typescript
{
  id: 3540,
  name: '圣光幕帘',
  icon: '/i/002000/002508.png',
  jobs: ['PLD'],
  duration: 30,
  cooldown: 90,
  executor: createShieldExecutor(1362, 30),
  statDataEntries: [{ type: 'shield', key: 1362 }],
},
```

- [ ] **Step 3: 确认编译通过**

Run: `npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add src/data/mitigationActions.ts
git commit -m "feat: 为盾技能添加 statDataEntries 配置"
```

---

### Task 3: 修改 executor 和计算引擎消费端适配 `TimelineStatData`

**Files:**

- Modify: `src/executors/createShieldExecutor.ts:42` — `ctx.statistics?.shieldByAbility` 不变（字段名一致）
- Modify: `src/store/timelineStore.ts:9,23,49,169-175,188-196` — statistics 相关类型和逻辑
- Modify: `src/hooks/useDamageCalculation.ts:90,119-125` — 传给 executor 的 statistics 改为 `statData`
- Modify: `src/utils/stats.ts:24-34` — `getNonTankMinHP` 改为支持从 `statData` 读取
- Modify: `src/components/Timeline/TimelineMinimap.tsx:10,207` — 改为从 `statData` 读取
- Modify: `src/data/mitigationActions.test.ts` — 更新测试中的 statistics mock

- [ ] **Step 1: 修改 `src/utils/stats.ts` — `getNonTankMinHP` 支持 `TimelineStatData`**

`getNonTankMinHP` 新增一个重载，接受 `TimelineStatData` 时直接返回 `referenceMaxHP`：

```typescript
import type { EncounterStatistics } from '@/types/mitigation'
import type { TimelineStatData } from '@/types/statData'
import type { Job } from '@/data/jobs'
import { getTankJobs } from '@/data/jobs'

// ... calculatePercentile 保持不变

const DEFAULT_MAX_HP = 100000

/**
 * 获取安全血量
 * 如果传入 TimelineStatData，直接返回 referenceMaxHP
 * 如果传入 EncounterStatistics，从 maxHPByJob 计算非坦最低值
 */
export function getNonTankMinHP(statistics: TimelineStatData): number
export function getNonTankMinHP(statistics: EncounterStatistics | null): number
export function getNonTankMinHP(statistics: EncounterStatistics | TimelineStatData | null): number {
  if (!statistics) return DEFAULT_MAX_HP
  if ('referenceMaxHP' in statistics) return statistics.referenceMaxHP
  if (!statistics.maxHPByJob) return DEFAULT_MAX_HP

  const tankJobs = new Set<string>(getTankJobs())
  const hpValues = (Object.entries(statistics.maxHPByJob) as [Job, number][])
    .filter(([job]) => !tankJobs.has(job))
    .map(([, hp]) => hp)
    .filter(hp => hp > 0)

  return hpValues.length > 0 ? Math.min(...hpValues) : DEFAULT_MAX_HP
}
```

- [ ] **Step 2: 修改 `src/store/timelineStore.ts` — statistics 存储和传递**

Store 中 `statistics` 字段保留为 `EncounterStatistics | null`（API 原始数据，用于初始化 `statData`）。关键变更：

1. `initializePartyState` 中 `maxHP` 从 `statistics?.maxHPByJob[p.job]` 改为也检查 `timeline.statData?.referenceMaxHP` 作为兜底（但 `PlayerState.maxHP` 仍用按职业数据）：

```typescript
initializePartyState: composition => {
  const { statistics, timeline } = get()
  if (!composition.players || composition.players.length === 0) {
    set({ partyState: null })
    return
  }

  const players: PlayerState[] = composition.players.map(p => ({
    id: p.id,
    job: p.job,
    maxHP: statistics?.maxHPByJob[p.job] ?? 100000,
  }))

  const partyState: PartyState = {
    players,
    statuses: [],
    timestamp: 0,
  }

  set({ partyState })
},
```

（此函数基本不变，`PlayerState.maxHP` 仍从 `EncounterStatistics` 取。）

2. 在 `executeAction` 中，将 `statistics` 改为传 `timeline.statData`：

```typescript
executeAction: (actionId, time, sourcePlayerId) => {
  const state = get()
  if (!state.partyState) return

  const action = MITIGATION_DATA.actions.find(a => a.id === actionId)
  if (!action) {
    console.error(`技能 ${actionId} 不存在`)
    return
  }

  const context: ActionExecutionContext = {
    actionId,
    useTime: time,
    partyState: state.partyState,
    sourcePlayerId,
    statistics: state.timeline?.statData ?? undefined,
  }

  if (!action.executor) return
  const newPartyState = action.executor(context)
  set({ partyState: newPartyState })
},
```

- [ ] **Step 3: 修改 `src/hooks/useDamageCalculation.ts` — 传给 executor 的 statistics 改为 `statData`**

```typescript
export function useDamageCalculation(timeline: Timeline | null): Map<string, CalculationResult> {
  const partyState = useTimelineStore(state => state.partyState)
  // 不再需要 statistics，改用 timeline.statData

  return useMemo(() => {
    const results = new Map<string, CalculationResult>()
    if (!timeline) return results

    const calculator = new MitigationCalculator()

    if (timeline.isReplayMode) {
      // ... 回放模式逻辑不变（不使用 statistics）
    }

    // 编辑模式
    if (!partyState) return results

    const referenceMaxHP = timeline.statData ? timeline.statData.referenceMaxHP : 100000

    // ... 排序逻辑不变

    // executor context 中传 statData
    // 原：statistics: statistics ?? undefined
    // 改为：
    const ctx: ActionExecutionContext = {
      actionId: castEvent.actionId,
      useTime: castEvent.timestamp,
      partyState: currentState,
      sourcePlayerId: castEvent.playerId,
      statistics: timeline.statData ?? undefined,
    }

    // ... 其余逻辑不变，referenceMaxHP 使用上面计算的值
  }, [timeline, partyState])
}
```

注意：useMemo 依赖项去掉 `statistics`，因为现在读的是 `timeline.statData`（已包含在 `timeline` 依赖中）。

- [ ] **Step 4: 修改 `src/components/Timeline/TimelineMinimap.tsx` — 从 `statData` 读取**

```typescript
// 删除: import { getNonTankMinHP } from '@/utils/stats'
// 删除: const statistics = useTimelineStore(state => state.statistics)（如果有的话）

// 在绘制伤害事件部分，将：
// const referenceMaxHP = getNonTankMinHP(statistics)
// 改为：
const referenceMaxHP = timeline.statData?.referenceMaxHP ?? 100000
```

- [ ] **Step 5: 修改 `src/data/mitigationActions.test.ts` — 更新测试中的 statistics mock**

将所有 `statistics: { encounterId: ..., encounterName: ..., ... }` 替换为只包含 `TimelineStatData` 字段的对象：

```typescript
statistics: {
  referenceMaxHP: 100000,
  shieldByAbility: {},
  healByAbility: { 37013: 8000, 37016: 12000 },
  critHealByAbility: { 37013: 16000 },
},
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm test:run 2>&1 | tail -30`

- [ ] **Step 7: Commit**

```bash
git add src/utils/stats.ts src/store/timelineStore.ts src/hooks/useDamageCalculation.ts src/components/Timeline/TimelineMinimap.tsx src/data/mitigationActions.test.ts
git commit -m "refactor: executor 和计算引擎改为读取 TimelineStatData"
```

---

### Task 4: 实现 `statData` 初始化和阵容变更逻辑

**Files:**

- Create: `src/utils/statDataUtils.ts` — statData 初始化、阵容变更补充/清理
- Test: `src/utils/statDataUtils.test.ts`
- Modify: `src/store/timelineStore.ts` — 新增 `updateStatData` action，`setStatistics` 和 `updateComposition` 中集成 statData 逻辑

- [ ] **Step 1: 编写 `src/utils/statDataUtils.test.ts` 测试**

```typescript
import { describe, it, expect } from 'vitest'
import type { EncounterStatistics } from '@/types/mitigation'
import type { TimelineStatData } from '@/types/statData'
import type { Composition } from '@/types/timeline'
import type { Job } from '@/data/jobs'
import { initializeStatData, fillMissingStatData, cleanupStatData } from './statDataUtils'

const mockStatistics: EncounterStatistics = {
  encounterId: 1,
  encounterName: 'Test',
  damageByAbility: {},
  maxHPByJob: { WHM: 95000, SCH: 96000, WAR: 120000, PLD: 118000 } as Record<Job, number>,
  shieldByAbility: { 1362: 24000, 1917: 18000, 3903: 15000 },
  critShieldByAbility: {},
  healByAbility: { 185: 12000, 37013: 15000, 37016: 11000 },
  critHealByAbility: { 37013: 22000 },
  sampleSize: 100,
  updatedAt: '2026-01-01',
}

describe('initializeStatData', () => {
  it('从 EncounterStatistics 和阵容提取相关字段', () => {
    const composition: Composition = {
      players: [
        { id: 1, job: 'PLD' },
        { id: 2, job: 'SCH' },
      ],
    }
    const result = initializeStatData(mockStatistics, composition)

    expect(result.referenceMaxHP).toBe(95000) // 非坦最低 HP
    expect(result.shieldByAbility[1362]).toBe(24000) // PLD 圣光幕帘
    expect(result.shieldByAbility[1917]).toBe(18000) // SCH 慰藉
    expect(result.healByAbility[185]).toBe(12000) // SCH 展开战术(鼓舞)
    expect(result.healByAbility[37013]).toBe(15000) // SCH 意气轩昂之策
    expect(result.critHealByAbility[37013]).toBe(22000) // SCH 意气轩昂之策(暴击)
  })

  it('statistics 中没有的字段使用默认值 10000', () => {
    const composition: Composition = {
      players: [{ id: 1, job: 'WHM' }],
    }
    const emptyStats: EncounterStatistics = {
      ...mockStatistics,
      shieldByAbility: {},
    }
    const result = initializeStatData(emptyStats, composition)
    expect(result.shieldByAbility[3903]).toBe(10000) // 默认值
  })

  it('statistics 为 null 时使用全部默认值', () => {
    const composition: Composition = {
      players: [{ id: 1, job: 'PLD' }],
    }
    const result = initializeStatData(null, composition)
    expect(result.referenceMaxHP).toBe(100000)
    expect(result.shieldByAbility[1362]).toBe(10000)
  })
})

describe('fillMissingStatData', () => {
  it('只填充 statData 中不存在的 key', () => {
    const existing: TimelineStatData = {
      referenceMaxHP: 90000,
      shieldByAbility: { 1362: 20000 },
      healByAbility: {},
      critHealByAbility: {},
    }
    const composition: Composition = {
      players: [
        { id: 1, job: 'PLD' },
        { id: 2, job: 'SCH' },
      ],
    }
    const result = fillMissingStatData(existing, mockStatistics, composition)

    expect(result.referenceMaxHP).toBe(90000) // 保留原值
    expect(result.shieldByAbility[1362]).toBe(20000) // 保留原值
    expect(result.shieldByAbility[1917]).toBe(18000) // 新填入 SCH 慰藉
    expect(result.healByAbility[185]).toBe(12000) // 新填入 SCH 展开战术
  })
})

describe('cleanupStatData', () => {
  it('移除不在阵容中的职业独有技能条目', () => {
    const statData: TimelineStatData = {
      referenceMaxHP: 95000,
      shieldByAbility: { 1362: 24000, 1917: 18000 },
      healByAbility: { 185: 12000 },
      critHealByAbility: {},
    }
    // 移除 SCH，只保留 PLD
    const composition: Composition = {
      players: [{ id: 1, job: 'PLD' }],
    }
    const result = cleanupStatData(statData, composition)

    expect(result.shieldByAbility[1362]).toBe(24000) // PLD 保留
    expect(result.shieldByAbility[1917]).toBeUndefined() // SCH 移除
    expect(result.healByAbility[185]).toBeUndefined() // SCH 移除
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run src/utils/statDataUtils.test.ts 2>&1 | tail -20`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 `src/utils/statDataUtils.ts`**

```typescript
/**
 * statData 初始化和维护工具
 */

import type { EncounterStatistics } from '@/types/mitigation'
import type { TimelineStatData } from '@/types/statData'
import type { Composition } from '@/types/timeline'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getNonTankMinHP } from './stats'

const DEFAULT_VALUE = 10000
const DEFAULT_MAX_HP = 100000

/**
 * 获取阵容中所有技能的 statDataEntries
 */
function getCompositionEntries(composition: Composition) {
  const jobs = new Set(composition.players.map(p => p.job))
  return MITIGATION_DATA.actions
    .filter(a => a.statDataEntries && a.jobs.some(j => jobs.has(j)))
    .flatMap(a => a.statDataEntries!)
}

/**
 * 从 EncounterStatistics 中获取指定 key 的值
 */
function getValueFromStatistics(
  statistics: EncounterStatistics | null,
  type: 'shield' | 'heal' | 'critHeal',
  key: number
): number {
  if (!statistics) return DEFAULT_VALUE
  switch (type) {
    case 'shield':
      return statistics.shieldByAbility[key] ?? DEFAULT_VALUE
    case 'heal':
      return statistics.healByAbility[key] ?? DEFAULT_VALUE
    case 'critHeal':
      return statistics.critHealByAbility[key] ?? DEFAULT_VALUE
  }
}

/**
 * 从 EncounterStatistics 和阵容初始化 statData
 */
export function initializeStatData(
  statistics: EncounterStatistics | null,
  composition: Composition
): TimelineStatData {
  const statData: TimelineStatData = {
    referenceMaxHP: statistics ? getNonTankMinHP(statistics) : DEFAULT_MAX_HP,
    shieldByAbility: {},
    healByAbility: {},
    critHealByAbility: {},
  }

  for (const entry of getCompositionEntries(composition)) {
    const value = getValueFromStatistics(statistics, entry.type, entry.key)
    switch (entry.type) {
      case 'shield':
        statData.shieldByAbility[entry.key] = value
        break
      case 'heal':
        statData.healByAbility[entry.key] = value
        break
      case 'critHeal':
        statData.critHealByAbility[entry.key] = value
        break
    }
  }

  return statData
}

/**
 * 填充 statData 中缺失的 key（阵容新增玩家时使用）
 * 已有的 key 不覆盖
 */
export function fillMissingStatData(
  existing: TimelineStatData,
  statistics: EncounterStatistics | null,
  composition: Composition
): TimelineStatData {
  const result: TimelineStatData = {
    referenceMaxHP: existing.referenceMaxHP,
    shieldByAbility: { ...existing.shieldByAbility },
    healByAbility: { ...existing.healByAbility },
    critHealByAbility: { ...existing.critHealByAbility },
  }

  for (const entry of getCompositionEntries(composition)) {
    const value = getValueFromStatistics(statistics, entry.type, entry.key)
    switch (entry.type) {
      case 'shield':
        if (!(entry.key in result.shieldByAbility)) {
          result.shieldByAbility[entry.key] = value
        }
        break
      case 'heal':
        if (!(entry.key in result.healByAbility)) {
          result.healByAbility[entry.key] = value
        }
        break
      case 'critHeal':
        if (!(entry.key in result.critHealByAbility)) {
          result.critHealByAbility[entry.key] = value
        }
        break
    }
  }

  return result
}

/**
 * 清理 statData 中不在阵容内的技能条目
 */
export function cleanupStatData(
  statData: TimelineStatData,
  composition: Composition
): TimelineStatData {
  const validEntries = getCompositionEntries(composition)
  const validShieldKeys = new Set(validEntries.filter(e => e.type === 'shield').map(e => e.key))
  const validHealKeys = new Set(validEntries.filter(e => e.type === 'heal').map(e => e.key))
  const validCritHealKeys = new Set(validEntries.filter(e => e.type === 'critHeal').map(e => e.key))

  const result: TimelineStatData = {
    referenceMaxHP: statData.referenceMaxHP,
    shieldByAbility: {},
    healByAbility: {},
    critHealByAbility: {},
  }

  for (const [key, value] of Object.entries(statData.shieldByAbility)) {
    if (validShieldKeys.has(Number(key))) result.shieldByAbility[Number(key)] = value
  }
  for (const [key, value] of Object.entries(statData.healByAbility)) {
    if (validHealKeys.has(Number(key))) result.healByAbility[Number(key)] = value
  }
  for (const [key, value] of Object.entries(statData.critHealByAbility)) {
    if (validCritHealKeys.has(Number(key))) result.critHealByAbility[Number(key)] = value
  }

  return result
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run src/utils/statDataUtils.test.ts 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: 修改 `src/store/timelineStore.ts` — 集成 statData 逻辑**

新增 `updateStatData` action，修改 `setStatistics` 和 `updateComposition`：

```typescript
import { initializeStatData, fillMissingStatData, cleanupStatData } from '@/utils/statDataUtils'
import type { TimelineStatData } from '@/types/statData'

// interface TimelineState 中新增：
  /** 更新时间轴统计数据 */
  updateStatData: (statData: TimelineStatData) => void

// setStatistics 实现中，统计数据到位后初始化 statData：
setStatistics: statistics => {
  set({ statistics })
  const { timeline } = get()
  if (statistics && timeline?.composition) {
    get().initializePartyState(timeline.composition)
    // 如果时间轴没有 statData，从 statistics 初始化
    if (!timeline.statData) {
      const statData = initializeStatData(statistics, timeline.composition)
      set(state => ({
        timeline: state.timeline ? { ...state.timeline, statData } : null,
      }))
      get().triggerAutoSave()
    } else {
      // 已有 statData，补充缺失的 key
      const filled = fillMissingStatData(timeline.statData, statistics, timeline.composition)
      if (filled !== timeline.statData) {
        set(state => ({
          timeline: state.timeline ? { ...state.timeline, statData: filled } : null,
        }))
        get().triggerAutoSave()
      }
    }
  }
},

// updateComposition 中追加 statData 清理和补充：
updateComposition: composition => {
  set(state => {
    if (!state.timeline) return state
    const newPlayerIds = composition.players.map(p => p.id)
    const filteredCastEvents = state.timeline.castEvents.filter(castEvent =>
      newPlayerIds.includes(castEvent.playerId)
    )
    const filteredAnnotations = (state.timeline.annotations ?? []).filter(
      a => a.anchor.type !== 'skillTrack' || newPlayerIds.includes(a.anchor.playerId)
    )

    // 清理 + 补充 statData
    let statData = state.timeline.statData
    if (statData) {
      statData = cleanupStatData(statData, composition)
      statData = fillMissingStatData(statData, state.statistics, composition)
    }

    return {
      timeline: {
        ...state.timeline,
        composition,
        castEvents: filteredCastEvents,
        annotations: filteredAnnotations,
        statData,
        updatedAt: Math.floor(Date.now() / 1000),
      },
    }
  })
  get().triggerAutoSave()
  get().initializePartyState(composition)
},

// updateStatData 实现：
updateStatData: statData => {
  set(state => {
    if (!state.timeline) return state
    return {
      timeline: {
        ...state.timeline,
        statData,
        updatedAt: Math.floor(Date.now() / 1000),
      },
    }
  })
  get().triggerAutoSave()
},
```

- [ ] **Step 6: 运行全部测试**

Run: `pnpm test:run 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/statDataUtils.ts src/utils/statDataUtils.test.ts src/store/timelineStore.ts
git commit -m "feat: statData 初始化、补充、清理逻辑"
```

---

### Task 5: 实现数值设置模态框组件

**Files:**

- Create: `src/components/StatDataDialog.tsx`
- Modify: `src/components/EditorToolbar.tsx` — 添加设置按钮

需要先添加 shadcn/ui Collapsible 组件（如果不存在）。

- [ ] **Step 1: 添加 Collapsible 组件**

Run: `npx shadcn@latest add collapsible 2>&1 | tail -10`

如果已存在则跳过。

- [ ] **Step 2: 创建 `src/components/StatDataDialog.tsx`**

```tsx
/**
 * 时间轴数值设置模态框
 * 让用户自定义盾技能数值和安全血量
 */

import { useState, useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useTimelineStore } from '@/store/timelineStore'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getJobName, sortJobsByOrder, type Job } from '@/data/jobs'
import JobIcon from '@/components/JobIcon'
import type { TimelineStatData, StatDataEntry } from '@/types/statData'
import type { MitigationAction } from '@/types/mitigation'

interface StatDataDialogProps {
  open: boolean
  onClose: () => void
}

/** statDataEntry type → 显示标签 */
function getEntryLabel(entry: StatDataEntry): string {
  const baseLabel =
    entry.type === 'shield' ? '盾量' : entry.type === 'heal' ? '治疗量' : '暴击治疗量'
  return entry.label ? `${baseLabel} (${entry.label})` : baseLabel
}

/** 从 statData 中读取指定条目的值 */
function getEntryValue(statData: TimelineStatData, entry: StatDataEntry): number {
  switch (entry.type) {
    case 'shield':
      return statData.shieldByAbility[entry.key] ?? 0
    case 'heal':
      return statData.healByAbility[entry.key] ?? 0
    case 'critHeal':
      return statData.critHealByAbility[entry.key] ?? 0
  }
}

/** 将值写入 statData 的副本 */
function setEntryValue(
  statData: TimelineStatData,
  entry: StatDataEntry,
  value: number
): TimelineStatData {
  const result = { ...statData }
  switch (entry.type) {
    case 'shield':
      result.shieldByAbility = { ...result.shieldByAbility, [entry.key]: value }
      break
    case 'heal':
      result.healByAbility = { ...result.healByAbility, [entry.key]: value }
      break
    case 'critHeal':
      result.critHealByAbility = { ...result.critHealByAbility, [entry.key]: value }
      break
  }
  return result
}

/** 数值输入组件 */
function NumberInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(value.toLocaleString())

  const handleBlur = () => {
    const num = parseInt(text.replace(/,/g, ''), 10)
    if (!isNaN(num) && num >= 0) {
      onChange(num)
      setText(num.toLocaleString())
    } else {
      setText(value.toLocaleString())
    }
  }

  return (
    <input
      type="text"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className="w-28 px-2 py-1 text-right text-sm tabular-nums border border-border rounded-md bg-background"
    />
  )
}

/** 单个技能条目行 */
function ActionEntryRow({
  action,
  entry,
  value,
  onChange,
}: {
  action: MitigationAction
  entry: StatDataEntry
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <img src={action.iconHD || action.icon} alt={action.name} className="w-7 h-7 rounded" />
        <div>
          <div className="text-sm">{action.name}</div>
          <div className="text-xs text-muted-foreground">{getEntryLabel(entry)}</div>
        </div>
      </div>
      <NumberInput value={value} onChange={onChange} />
    </div>
  )
}

export default function StatDataDialog({ open, onClose }: StatDataDialogProps) {
  const { timeline, updateStatData } = useTimelineStore()
  const statData = timeline?.statData
  const composition = timeline?.composition

  // 本地编辑态，保存时才写入 store
  const [localStatData, setLocalStatData] = useState<TimelineStatData | null>(null)

  // 打开时从 timeline 复制
  const currentData = localStatData ?? statData

  // 按职业分组的技能列表
  const groupedActions = useMemo(() => {
    if (!composition || !currentData) return []

    const jobs = new Set(composition.players.map(p => p.job))
    const actionsWithEntries = MITIGATION_DATA.actions.filter(
      a => a.statDataEntries && a.statDataEntries.length > 0 && a.jobs.some(j => jobs.has(j))
    )

    // 按职业分组
    const groups = new Map<Job, { action: MitigationAction; entry: StatDataEntry }[]>()
    for (const action of actionsWithEntries) {
      // 找到阵容中拥有此技能的职业
      const job = action.jobs.find(j => jobs.has(j))
      if (!job) continue
      if (!groups.has(job)) groups.set(job, [])
      for (const entry of action.statDataEntries!) {
        groups.get(job)!.push({ action, entry })
      }
    }

    // 按职业顺序排列
    const sortedJobs = sortJobsByOrder([...groups.keys()])
    return sortedJobs.map(job => ({
      job,
      entries: groups.get(job)!,
    }))
  }, [composition, currentData])

  // 折叠状态
  const [collapsedJobs, setCollapsedJobs] = useState<Set<Job>>(new Set())
  const toggleCollapse = (job: Job) => {
    setCollapsedJobs(prev => {
      const next = new Set(prev)
      if (next.has(job)) next.delete(job)
      else next.add(job)
      return next
    })
  }

  const handleOpen = () => {
    if (statData) setLocalStatData({ ...statData })
  }

  const handleSave = () => {
    if (localStatData) {
      updateStatData(localStatData)
    }
    setLocalStatData(null)
    onClose()
  }

  const handleCancel = () => {
    setLocalStatData(null)
    onClose()
  }

  // open 变化时初始化本地数据
  if (open && !localStatData && statData) {
    handleOpen()
  }

  if (!currentData || !composition) return null

  return (
    <Modal open={open} onClose={handleCancel}>
      <ModalContent className="max-h-[80vh] flex flex-col">
        <ModalHeader>
          <ModalTitle>数值设置</ModalTitle>
        </ModalHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          {/* 安全血量 */}
          <div>
            <div className="text-sm font-medium mb-1.5">安全血量</div>
            <div className="flex items-center gap-3">
              <NumberInput
                value={currentData.referenceMaxHP}
                onChange={v =>
                  setLocalStatData(prev => (prev ? { ...prev, referenceMaxHP: v } : prev))
                }
              />
              <span className="text-xs text-muted-foreground">非坦职业最低 HP</span>
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* 盾技能数值 */}
          <div className="text-sm font-medium">盾技能数值</div>

          {groupedActions.length === 0 && (
            <p className="text-sm text-muted-foreground">当前阵容中没有盾技能</p>
          )}

          {groupedActions.map(({ job, entries }) => (
            <Collapsible
              key={job}
              open={!collapsedJobs.has(job)}
              onOpenChange={() => toggleCollapse(job)}
            >
              <CollapsibleTrigger className="flex items-center gap-2 w-full py-1 hover:bg-accent rounded-md px-1 -mx-1">
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${collapsedJobs.has(job) ? '-rotate-90' : ''}`}
                />
                <JobIcon job={job} size={20} />
                <span className="text-sm font-medium">{getJobName(job)}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="ml-7 divide-y divide-border">
                  {entries.map(({ action, entry }) => (
                    <ActionEntryRow
                      key={`${action.id}-${entry.type}-${entry.key}`}
                      action={action}
                      entry={entry}
                      value={getEntryValue(currentData, entry)}
                      onChange={v =>
                        setLocalStatData(prev => (prev ? setEntryValue(prev, entry, v) : prev))
                      }
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>

        <ModalFooter>
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 border rounded-md hover:bg-accent transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            保存
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
```

- [ ] **Step 3: 修改 `src/components/EditorToolbar.tsx` — 添加设置按钮**

在 import 部分添加：

```typescript
import { Settings } from 'lucide-react'
import StatDataDialog from './StatDataDialog'
```

在组件内部添加状态：

```typescript
const [showStatDataDialog, setShowStatDataDialog] = useState(false)
```

在 `CompositionPopover` 之后、共享按钮之前（大约第 205-206 行之间）添加按钮：

```tsx
{
  /* 数值设置 */
}
{
  !isReplayMode && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setShowStatDataDialog(true)}
          disabled={!timeline?.statData}
        >
          <Settings className="w-4 h-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">数值设置</TooltipContent>
    </Tooltip>
  )
}
```

在组件 return 的末尾（`ConflictDialog` 之后、`</>` 之前）添加：

```tsx
<StatDataDialog open={showStatDataDialog} onClose={() => setShowStatDataDialog(false)} />
```

- [ ] **Step 4: 确认编译通过**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 5: 运行全部测试**

Run: `pnpm test:run 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/StatDataDialog.tsx src/components/EditorToolbar.tsx src/components/ui/collapsible.tsx
git commit -m "feat: 数值设置模态框和工具栏按钮"
```

---

### Task 6: 端到端验证和清理

**Files:**

- Modify: `src/hooks/useEncounterStatistics.ts` — 确认不影响现有流程
- 无新文件

- [ ] **Step 1: 运行全部测试**

Run: `pnpm test:run 2>&1 | tail -30`
Expected: 全部 PASS

- [ ] **Step 2: 编译检查**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 3: Lint 检查**

Run: `pnpm lint 2>&1 | tail -20`
Expected: 无错误（或仅有 warning）

- [ ] **Step 4: 启动开发服务器手动验证**

Run: `pnpm dev`

验证项目：

1. 新建一个时间轴 → 编辑阵容添加 PLD + SCH → 检查 `timeline.statData` 是否被初始化（浏览器 DevTools > Application > LocalStorage）
2. 点击工具栏设置按钮 → 模态框应显示 PLD 和 SCH 的盾技能
3. 修改某个盾值 → 保存 → 拖拽对应盾技能到时间轴 → 伤害事件卡片应反映新的盾值
4. 修改安全血量 → 致死判断应使用新值
5. 修改阵容移除 SCH → 重新打开模态框 → SCH 技能应消失
6. 修改阵容添加 SGE → 模态框应显示 SGE 技能且有默认值

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: 端到端验证通过，清理细节"
```
