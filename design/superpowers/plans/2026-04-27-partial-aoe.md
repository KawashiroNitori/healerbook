# Partial AOE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展 `DamageEventType` 增加 `partial_aoe` / `partial_final_aoe` 两个枚举，FFLogs 导入期按"非 T 玩家命中集合"自动判别细分原本的 `aoe`，UI 与过滤器同步开放。

**Architecture:** partial / partial_final 是 `aoe` 的语义子类，下游减伤计算（`mitigationCalculator` / `statusExtras`）零改动；状态机作为 `parseDamageEvents` 末尾的第 4 步后处理，独立模块单测驱动；`composition` 通过可选参数注入，既有测试零迁移。

**Tech Stack:** TypeScript 5.9 / Vitest 4 / React 19 / Zustand 5

**Spec:** `design/superpowers/specs/2026-04-27-partial-aoe-design.md`

---

## File Structure

| 文件                                             | 操作 | 职责                                                                   |
| ------------------------------------------------ | ---- | ---------------------------------------------------------------------- |
| `src/types/timeline.ts`                          | 修改 | 扩展 `DAMAGE_EVENT_TYPES`，新增 `DAMAGE_EVENT_TYPE_LABELS`             |
| `src/types/timelineV2.ts`                        | 修改 | 扩展 `V2DamageEvent.ty` 字面量类型                                     |
| `src/utils/timelineFormat.ts`                    | 修改 | 扩展数字编码映射 + 反序列化兜底                                        |
| `src/utils/partialAoeClassifier.ts`              | 新建 | partial 状态机算法（in-place 改写 type）                               |
| `src/utils/partialAoeClassifier.test.ts`         | 新建 | 状态机单元测试                                                         |
| `src/utils/fflogsImporter.ts`                    | 修改 | `parseDamageEvents` 新增可选 composition 参数并调用 classifyPartialAOE |
| `src/utils/fflogsImporter.test.ts`               | 修改 | 新增端到端 case                                                        |
| `src/utils/timelineFormat.test.ts`               | 修改 | round-trip 与未知编码兜底                                              |
| `src/components/ImportFFLogsDialog.tsx`          | 修改 | parseDamageEvents 传入 composition                                     |
| `src/components/AddEventDialog.tsx`              | 修改 | select 改为遍历 `DAMAGE_EVENT_TYPES`                                   |
| `src/components/PropertyPanel.tsx`               | 修改 | select 改为遍历 `DAMAGE_EVENT_TYPES`                                   |
| `src/components/FilterMenu/EditPresetDialog.tsx` | 修改 | Switch 列表改为动态渲染                                                |
| `src/store/filterStore.ts`                       | 修改 | 内置预设扩展 damageTypes                                               |
| `src/store/filterStore.test.ts`                  | 修改 | 内置预设语义验证                                                       |
| `src/hooks/useFilteredTimelineView.test.ts`      | 修改 | partial 命中预设的覆盖测试                                             |

---

## Task 1: 扩展类型与编码映射

**Files:**

- Modify: `src/types/timeline.ts:24-25`
- Modify: `src/types/timelineV2.ts:53-54`
- Modify: `src/utils/timelineFormat.ts:44-49`

- [ ] **Step 1: 扩展 `DAMAGE_EVENT_TYPES` 与新增 LABELS**

修改 `src/types/timeline.ts`，把第 24-25 行替换为：

```ts
/**
 * 攻击类型
 *
 * - aoe / partial_aoe / partial_final_aoe：非坦专（partial 是 aoe 的子类，
 *   仅 FFLogs 导入期由 partialAoeClassifier 自动判别产生，用户也可手动选择）
 * - tankbuster / auto：坦专路径，走多坦多分支计算
 */
export const DAMAGE_EVENT_TYPES = [
  'aoe',
  'tankbuster',
  'auto',
  'partial_aoe',
  'partial_final_aoe',
] as const
export type DamageEventType = (typeof DAMAGE_EVENT_TYPES)[number]

/** 攻击类型的中文展示标签（UI 下拉与过滤器 Switch 共用） */
export const DAMAGE_EVENT_TYPE_LABELS: Record<DamageEventType, string> = {
  aoe: '全员 AOE',
  partial_aoe: '部分 AOE',
  partial_final_aoe: '部分 AOE（结算）',
  tankbuster: '死刑',
  auto: '普通攻击',
}
```

- [ ] **Step 2: 扩展 V2 数字编码字面量类型**

修改 `src/types/timelineV2.ts:53-54`：

```ts
/** type: 0=aoe, 1=tankbuster, 2=auto, 3=partial_aoe, 4=partial_final_aoe */
ty: 0 | 1 | 2 | 3 | 4
```

- [ ] **Step 3: 扩展编码映射 + 反序列化兜底**

修改 `src/utils/timelineFormat.ts:44-49`：

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

继续在同文件中修改 `fromV2DamageEvent`（约第 254-269 行的 `type: NUM_TO_DAMAGE_EVENT_TYPE[e.ty]`）增加未知编码兜底：

```ts
type: NUM_TO_DAMAGE_EVENT_TYPE[e.ty] ?? 'aoe',
```

`migrateV1DamageEvent` 已有 `?? 0` 兜底（V1 → V2 数字编码层），保持不动。

- [ ] **Step 4: 验证类型检查**

Run: `pnpm exec tsc --noEmit`

Expected: 类型检查通过（注意：可能有少量消费者因为新增枚举出 exhaustive switch warning，记录下来在后续任务处理）。

- [ ] **Step 5: Commit**

```bash
git add src/types/timeline.ts src/types/timelineV2.ts src/utils/timelineFormat.ts
git commit -m "feat(types): 扩展 DamageEventType 增加 partial_aoe / partial_final_aoe"
```

---

## Task 2: timelineFormat 编码 round-trip 测试

**Files:**

- Modify: `src/utils/timelineFormat.test.ts`

- [ ] **Step 1: 编写失败测试**

在 `src/utils/timelineFormat.test.ts` 中找到 V2 round-trip 相关的 describe 块，新增以下 cases（如果没有合适的 describe，新建一个 `describe('DamageEventType round-trip', ...)`）：

```ts
import { toV2, hydrateFromV2 } from './timelineFormat'
import type { Timeline } from '@/types/timeline'

it('partial_aoe 走完整 V2 round-trip', () => {
  const tl = makeMinimalTimeline({
    damageEvents: [
      { id: 'e1', name: 'p1', time: 1, damage: 100, type: 'partial_aoe', damageType: 'magical' },
    ],
  })
  const v2 = toV2(tl)
  expect(v2.de[0].ty).toBe(3)
  const back = hydrateFromV2(v2)
  expect(back.damageEvents[0].type).toBe('partial_aoe')
})

it('partial_final_aoe 走完整 V2 round-trip', () => {
  const tl = makeMinimalTimeline({
    damageEvents: [
      {
        id: 'e1',
        name: 'p2',
        time: 2,
        damage: 100,
        type: 'partial_final_aoe',
        damageType: 'magical',
      },
    ],
  })
  const v2 = toV2(tl)
  expect(v2.de[0].ty).toBe(4)
  const back = hydrateFromV2(v2)
  expect(back.damageEvents[0].type).toBe('partial_final_aoe')
})

it('反序列化未知数字编码兜底为 aoe', () => {
  const tl = makeMinimalTimeline({
    damageEvents: [
      { id: 'e1', name: 'unknown', time: 1, damage: 100, type: 'aoe', damageType: 'magical' },
    ],
  })
  const v2 = toV2(tl)
  // 模拟旧 SPA 缓存遇到未来扩展的数字编码
  ;(v2.de[0] as { ty: number }).ty = 99
  const back = hydrateFromV2(v2)
  expect(back.damageEvents[0].type).toBe('aoe')
})
```

注意：`makeMinimalTimeline` 是该测试文件中已有的辅助函数；如果没有，参照文件顶部既有 helper 风格写一个最小 `Timeline` 构造器（必须字段：id / name / encounter / composition / damageEvents / castEvents / statusEvents / annotations / createdAt / updatedAt）。先 Read 该文件顶部的 helper 区段，复用现有 helper 即可。

- [ ] **Step 2: 运行测试验证失败 → 通过**

Run: `pnpm test:run src/utils/timelineFormat.test.ts`

Expected: 新增的 3 个 case 通过（Task 1 已经实现了所需逻辑，所以这是验证既有改动）。如果失败，说明 Task 1 的编码映射或兜底没改对，回到 Task 1 修复。

- [ ] **Step 3: Commit**

```bash
git add src/utils/timelineFormat.test.ts
git commit -m "test(timelineFormat): partial_aoe / partial_final_aoe round-trip"
```

---

## Task 3: partialAoeClassifier 模块（TDD：先写测试）

**Files:**

- Create: `src/utils/partialAoeClassifier.test.ts`
- Create: `src/utils/partialAoeClassifier.ts`

- [ ] **Step 1: 创建测试文件并写第一组失败测试**

创建 `src/utils/partialAoeClassifier.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { classifyPartialAOE } from './partialAoeClassifier'
import type { DamageEvent, PlayerDamageDetail } from '@/types/timeline'

// ─────────────── helpers ───────────────

interface Composition {
  players: Array<{ id: number; job: import('@/data/jobs').Job }>
}

/** 8 人组：2 坦（id 1,2 PLD/WAR）+ 6 非坦 */
const STD_COMP: Composition = {
  players: [
    { id: 1, job: 'PLD' },
    { id: 2, job: 'WAR' },
    { id: 3, job: 'WHM' },
    { id: 4, job: 'SCH' },
    { id: 5, job: 'SAM' },
    { id: 6, job: 'BLM' },
    { id: 7, job: 'BRD' },
    { id: 8, job: 'NIN' },
  ],
}

const NON_TANK_IDS = [3, 4, 5, 6, 7, 8] as const

function detail(playerId: number, job: import('@/data/jobs').Job): PlayerDamageDetail {
  return {
    timestamp: 0,
    playerId,
    job,
    unmitigatedDamage: 1000,
    finalDamage: 800,
    statuses: [],
  }
}

function aoeEvent(time: number, hitPlayerIds: number[]): DamageEvent {
  return {
    id: `e-${time}`,
    name: 'evt',
    time,
    damage: 1000,
    type: 'aoe',
    damageType: 'magical',
    playerDamageDetails: hitPlayerIds.map(id => {
      const job = STD_COMP.players.find(p => p.id === id)!.job
      return detail(id, job)
    }),
  }
}

// ─────────────── tests ───────────────

describe('classifyPartialAOE', () => {
  it('一波命中全部非T → aoe，前置计数被清零', () => {
    const e1 = aoeEvent(1, [3]) // partial_aoe，hitCount[3]=1
    const e2 = aoeEvent(2, [3, 4, 5, 6, 7, 8]) // 全员
    classifyPartialAOE([e1, e2], STD_COMP)
    expect(e1.type).toBe('partial_aoe')
    expect(e2.type).toBe('aoe')
  })

  it('一波命中部分非T → partial_aoe', () => {
    const e1 = aoeEvent(1, [3, 4])
    classifyPartialAOE([e1], STD_COMP)
    expect(e1.type).toBe('partial_aoe')
  })

  it('累计后所有非T 计数 ≥ 1 → partial_final_aoe，清零', () => {
    const e1 = aoeEvent(1, [3, 4, 5]) // partial_aoe
    const e2 = aoeEvent(2, [6, 7, 8]) // partial_final_aoe（全员都被打过了）
    const e3 = aoeEvent(3, [3]) // 清零后又一波 partial_aoe
    classifyPartialAOE([e1, e2, e3], STD_COMP)
    expect(e1.type).toBe('partial_aoe')
    expect(e2.type).toBe('partial_final_aoe')
    expect(e3.type).toBe('partial_aoe')
  })

  it('多轮 partial → partial_final 循环正确', () => {
    const events = [
      aoeEvent(1, [3, 4, 5]),
      aoeEvent(2, [6, 7, 8]), // 第一次结算
      aoeEvent(3, [3, 4, 5]),
      aoeEvent(4, [6, 7, 8]), // 第二次结算
    ]
    classifyPartialAOE(events, STD_COMP)
    expect(events.map(e => e.type)).toEqual([
      'partial_aoe',
      'partial_final_aoe',
      'partial_aoe',
      'partial_final_aoe',
    ])
  })

  it('tankbuster / auto 不被改写、不参与计数', () => {
    const e1 = aoeEvent(1, [3, 4, 5])
    const tb: DamageEvent = {
      id: 'tb',
      name: 'tb',
      time: 1.5,
      damage: 5000,
      type: 'tankbuster',
      damageType: 'physical',
      playerDamageDetails: [detail(1, 'PLD'), detail(2, 'WAR')],
    }
    const auto: DamageEvent = {
      id: 'auto',
      name: 'auto',
      time: 1.7,
      damage: 1000,
      type: 'auto',
      damageType: 'physical',
      playerDamageDetails: [detail(1, 'PLD')],
    }
    const e2 = aoeEvent(2, [6, 7, 8]) // 仍然是 partial_final_aoe（tb/auto 不影响计数）
    classifyPartialAOE([e1, tb, auto, e2], STD_COMP)
    expect(e1.type).toBe('partial_aoe')
    expect(tb.type).toBe('tankbuster')
    expect(auto.type).toBe('auto')
    expect(e2.type).toBe('partial_final_aoe')
  })

  it('非 T 全集为空（8 坦极端组）→ 不修改任何事件', () => {
    const allTanks: Composition = {
      players: [
        { id: 1, job: 'PLD' },
        { id: 2, job: 'WAR' },
        { id: 3, job: 'DRK' },
        { id: 4, job: 'GNB' },
      ],
    }
    const e1 = aoeEvent(1, [1, 2])
    classifyPartialAOE([e1], allTanks)
    expect(e1.type).toBe('aoe')
  })

  it('composition 缺失 → 不修改任何事件', () => {
    const e1 = aoeEvent(1, [3, 4])
    classifyPartialAOE([e1], undefined)
    expect(e1.type).toBe('aoe')
  })

  it('playerDamageDetails 为空 → 跳过该事件，不计数', () => {
    const e1: DamageEvent = {
      id: 'e1',
      name: 'no-details',
      time: 1,
      damage: 0,
      type: 'aoe',
      damageType: 'magical',
      playerDamageDetails: [],
    }
    const e2 = aoeEvent(2, [3, 4, 5, 6, 7, 8]) // 全员
    classifyPartialAOE([e1, e2], STD_COMP)
    expect(e1.type).toBe('aoe') // 不被改写
    expect(e2.type).toBe('aoe')
  })

  it('同一非T 在事件里出现多次 detail → 计数只 +1（去重）', () => {
    const dup: DamageEvent = {
      id: 'dup',
      name: 'dup',
      time: 1,
      damage: 1000,
      type: 'aoe',
      damageType: 'magical',
      // 玩家 3 出现 3 次（多伤害包），玩家 4 出现 1 次
      playerDamageDetails: [detail(3, 'WHM'), detail(3, 'WHM'), detail(3, 'WHM'), detail(4, 'SCH')],
    }
    const next1 = aoeEvent(2, [5])
    const next2 = aoeEvent(3, [6])
    const next3 = aoeEvent(4, [7])
    const next4 = aoeEvent(5, [8])
    // dup 把 3,4 各计 1 次；next1..4 各加 5,6,7,8 → 计数 3:1,4:1,5:1,6:1,7:1,8:1
    // next4 加完后所有 ≥1 → partial_final_aoe
    classifyPartialAOE([dup, next1, next2, next3, next4], STD_COMP)
    expect(dup.type).toBe('partial_aoe')
    expect(next1.type).toBe('partial_aoe')
    expect(next2.type).toBe('partial_aoe')
    expect(next3.type).toBe('partial_aoe')
    expect(next4.type).toBe('partial_final_aoe')
  })

  it('只命中坦克的"伪 aoe"（refine 没改成 tankbuster）保留 aoe，不动计数', () => {
    const tankOnlyButAOE: DamageEvent = {
      id: 'fake',
      name: 'fake',
      time: 1,
      damage: 5000,
      type: 'aoe', // refine 验证伤害量阈值未达，回退到了 aoe
      damageType: 'physical',
      playerDamageDetails: [detail(1, 'PLD')],
    }
    const e2 = aoeEvent(2, [3, 4, 5, 6, 7, 8])
    classifyPartialAOE([tankOnlyButAOE, e2], STD_COMP)
    expect(tankOnlyButAOE.type).toBe('aoe')
    expect(e2.type).toBe('aoe')
  })

  it('event 已按时间升序传入；调用方负责排序', () => {
    // 调用方约定：传入前已 sort by time
    const events = [aoeEvent(1, [3]), aoeEvent(2, [4]), aoeEvent(3, [5, 6, 7, 8])]
    classifyPartialAOE(events, STD_COMP)
    expect(events.map(e => e.type)).toEqual(['partial_aoe', 'partial_aoe', 'partial_final_aoe'])
  })
})
```

- [ ] **Step 2: 验证测试因为模块不存在而失败**

Run: `pnpm test:run src/utils/partialAoeClassifier.test.ts`

Expected: FAIL，提示 `Cannot find module './partialAoeClassifier'` 或 import 解析失败。

- [ ] **Step 3: 实现 classifyPartialAOE**

创建 `src/utils/partialAoeClassifier.ts`：

```ts
/**
 * 部分 AOE 状态机：把 type === 'aoe' 的事件按"非 T 玩家命中集合"细分为
 *   'aoe' / 'partial_aoe' / 'partial_final_aoe'
 *
 * 必须在 detectDamageType / refineTankbusterClassification /
 * refineAutoAttackClassification 之后调用，此时 tankbuster / auto 已稳定。
 *
 * 算法：
 *   1. 仅消费 type === 'aoe' 且 playerDamageDetails 非空的事件（其余跳过）
 *   2. 维护 hitCount: Map<nonTankPlayerId, number>，初值全 0
 *   3. 每个事件：
 *      a. hitNonTanks = 该事件命中的非 T 玩家集合（去重）
 *      b. 命中全部非 T → 'aoe'，清零
 *      c. 命中为空（只命中坦克的伪 aoe）→ 'aoe' 不变，不动计数
 *      d. 部分命中 → 计数 +1；累加后全员 ≥1 → 'partial_final_aoe' 并清零，
 *         否则 → 'partial_aoe'
 *
 * composition 缺失或非 T 全集为空 → no-op（既有用例保持等价行为）。
 */

import { getJobRole, type Job } from '@/data/jobs'
import type { DamageEvent } from '@/types/timeline'

interface CompositionLike {
  players: Array<{ id: number; job: Job }>
}

export function classifyPartialAOE(
  damageEvents: DamageEvent[],
  composition: CompositionLike | undefined
): void {
  if (!composition) return

  const nonTankIds = new Set<number>(
    composition.players.filter(p => getJobRole(p.job) !== 'tank').map(p => p.id)
  )
  if (nonTankIds.size === 0) return

  const hitCount = new Map<number, number>()
  for (const id of nonTankIds) hitCount.set(id, 0)

  const resetCounts = () => {
    for (const id of nonTankIds) hitCount.set(id, 0)
  }

  for (const event of damageEvents) {
    if (event.type !== 'aoe') continue
    const details = event.playerDamageDetails
    if (!details || details.length === 0) continue

    const hitNonTanks = new Set<number>()
    for (const d of details) {
      if (nonTankIds.has(d.playerId)) hitNonTanks.add(d.playerId)
    }

    if (hitNonTanks.size === 0) {
      // 伪 aoe（只命中坦克），保持 'aoe' 不变，不动计数
      continue
    }

    if (hitNonTanks.size === nonTankIds.size) {
      // 命中全部非 T —— 真正的全员 AOE
      event.type = 'aoe'
      resetCounts()
      continue
    }

    // 部分命中
    for (const id of hitNonTanks) {
      hitCount.set(id, (hitCount.get(id) ?? 0) + 1)
    }

    let allCovered = true
    for (const id of nonTankIds) {
      if ((hitCount.get(id) ?? 0) < 1) {
        allCovered = false
        break
      }
    }

    if (allCovered) {
      event.type = 'partial_final_aoe'
      resetCounts()
    } else {
      event.type = 'partial_aoe'
    }
  }
}
```

- [ ] **Step 4: 运行测试验证全部通过**

Run: `pnpm test:run src/utils/partialAoeClassifier.test.ts`

Expected: 所有 11 个测试通过。

- [ ] **Step 5: Commit**

```bash
git add src/utils/partialAoeClassifier.ts src/utils/partialAoeClassifier.test.ts
git commit -m "feat(importer): 新增 classifyPartialAOE 状态机识别部分 AOE"
```

---

## Task 4: 把 classifyPartialAOE 接入 fflogsImporter

**Files:**

- Modify: `src/utils/fflogsImporter.ts:107-112` (函数签名), `:373-378` (流水线末尾)
- Modify: `src/components/ImportFFLogsDialog.tsx:248-253`
- Modify: `src/utils/fflogsImporter.test.ts` (新增端到端 case)

- [ ] **Step 1: 修改 parseDamageEvents 签名增加可选 composition 参数**

修改 `src/utils/fflogsImporter.ts:107-112`：

```ts
export function parseDamageEvents(
  events: FFLogsEvent[],
  fightStartTime: number,
  playerMap: Map<number, { id: number; name: string; type: string }>,
  abilityMap?: Map<number, FFLogsAbility>,
  composition?: Composition
): DamageEvent[] {
```

并在文件顶部已有的 import 区域添加 import（`Composition` 已经在 `'@/types/timeline'` 导出，但还没在该文件 import；现有 import 行约第 5-14 行，把 `Composition` 加入 type-only import 列表）：

```ts
import type { FFLogsReport, FFLogsV1Report, FFLogsAbility, FFLogsEvent } from '@/types/fflogs'
import type {
  Composition,
  DamageEvent,
  DamageEventType,
  CastEvent,
  PlayerDamageDetail,
  DamageType,
  SyncEvent,
} from '@/types/timeline'
```

注意 `Composition` 可能已经在 import 列表中（用于 `parseComposition` 的返回类型），如果已存在则跳过。

- [ ] **Step 2: 在 parseDamageEvents 末尾调用 classifyPartialAOE**

修改 `src/utils/fflogsImporter.ts:373-378`，在 `refineAutoAttackClassification` 之后追加调用：

```ts
  damageEvents.sort((a, b) => a.time - b.time)

  // 后处理：验证 tankbuster 分类
  refineTankbusterClassification(damageEvents)
  // 后处理：用"出现次数 × 全 T 比例"启发式补捞 regex 漏掉的普通攻击
  refineAutoAttackClassification(damageEvents, TANK_JOBS)
  // 后处理：把 type==='aoe' 的事件按非 T 命中集合细分为
  //   'aoe' / 'partial_aoe' / 'partial_final_aoe'
  // composition 缺失（既有 dev 调用方）时 no-op，保持向后兼容
  classifyPartialAOE(damageEvents, composition)

  return damageEvents
}
```

并在文件顶部 import 区追加：

```ts
import { classifyPartialAOE } from './partialAoeClassifier'
```

- [ ] **Step 3: 跑既有测试验证零回归**

Run: `pnpm test:run src/utils/fflogsImporter.test.ts`

Expected: 既有 27 个用例全部通过（不传 composition，partial 状态机自动跳过，等价于旧行为）。

- [ ] **Step 4: 在 fflogsImporter.test.ts 新增端到端 case**

在 `src/utils/fflogsImporter.test.ts` 末尾（最后一个 describe 块前）新增：

```ts
describe('parseDamageEvents 集成 classifyPartialAOE', () => {
  it('传入 composition 时，aoe 事件被细分为 partial_aoe / partial_final_aoe', () => {
    const fightStartTime = 1_000_000
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Tank2', type: 'Warrior' }],
      [3, { id: 3, name: 'Healer1', type: 'WhiteMage' }],
      [4, { id: 4, name: 'Healer2', type: 'Scholar' }],
      [5, { id: 5, name: 'DPS1', type: 'Samurai' }],
      [6, { id: 6, name: 'DPS2', type: 'BlackMage' }],
      [7, { id: 7, name: 'DPS3', type: 'Bard' }],
      [8, { id: 8, name: 'DPS4', type: 'Ninja' }],
    ])
    const abilityMap = makeAbilityMap(900001, 'Mech', 1024)

    // 第一波（t=5）：只命中 3,4,5（partial_aoe）
    // 第二波（t=10）：命中 6,7,8（partial_final_aoe，全员到齐清零）
    // 第三波（t=15）：命中全部非T（aoe）
    const wave = (t: number, targets: number[], packetID: number) =>
      targets.map(targetID => ({
        type: 'damage' as const,
        packetID,
        abilityGameID: 900001,
        targetID,
        unmitigatedAmount: 1000,
        absorbed: 0,
        amount: 800,
        timestamp: fightStartTime + t * 1000,
        sourceID: 999,
      }))

    const events = [
      ...wave(5, [3, 4, 5], 1),
      ...wave(10, [6, 7, 8], 2),
      ...wave(15, [3, 4, 5, 6, 7, 8], 3),
    ]

    const composition = {
      players: [
        { id: 1, job: 'PLD' as const },
        { id: 2, job: 'WAR' as const },
        { id: 3, job: 'WHM' as const },
        { id: 4, job: 'SCH' as const },
        { id: 5, job: 'SAM' as const },
        { id: 6, job: 'BLM' as const },
        { id: 7, job: 'BRD' as const },
        { id: 8, job: 'NIN' as const },
      ],
    }

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap,
      composition
    )

    expect(result).toHaveLength(3)
    expect(result.map(e => e.type)).toEqual(['partial_aoe', 'partial_final_aoe', 'aoe'])
  })

  it('不传 composition 时（既有调用方），状态机跳过，type 等同旧行为', () => {
    const fightStartTime = 1_000_000
    const playerMap = new Map<number, V2Actor>([
      [3, { id: 3, name: 'Healer1', type: 'WhiteMage' }],
      [4, { id: 4, name: 'Healer2', type: 'Scholar' }],
    ])
    const abilityMap = makeAbilityMap(900002, 'Mech2', 1024)

    const events = [
      {
        type: 'damage' as const,
        packetID: 1,
        abilityGameID: 900002,
        targetID: 3,
        unmitigatedAmount: 1000,
        absorbed: 0,
        amount: 800,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )

    // 单个非 T 命中、无 composition：保持原 detect 路径的归类（aoe）
    expect(result[0].type).toBe('aoe')
  })
})
```

注意：`V2Actor`、`makeAbilityMap`、`withCalculatedDamage` 都是该测试文件已有的 helper，直接复用。

- [ ] **Step 5: 运行新增测试验证通过**

Run: `pnpm test:run src/utils/fflogsImporter.test.ts -t "classifyPartialAOE"`

Expected: 2 个新增 case 通过。

- [ ] **Step 6: 修改 ImportFFLogsDialog 传入 composition**

修改 `src/components/ImportFFLogsDialog.tsx:247-253`：

```tsx
// 解析伤害事件（传入 composition 启用 partial AOE 状态机识别）
const damageEvents = parseDamageEvents(
  eventsData.events || [],
  fightStartTime,
  playerMap,
  abilityMap,
  composition
)
newTimeline.damageEvents = damageEvents
```

注意上面 `composition` 变量在第 241 行已经赋值，直接复用。

- [ ] **Step 7: 类型检查与全量测试**

Run: `pnpm exec tsc --noEmit && pnpm test:run`

Expected: 类型检查通过 + 全部测试通过。

- [ ] **Step 8: Commit**

```bash
git add src/utils/fflogsImporter.ts src/utils/fflogsImporter.test.ts src/components/ImportFFLogsDialog.tsx
git commit -m "feat(importer): parseDamageEvents 接入 partial AOE 状态机"
```

---

## Task 5: UI 下拉选择器（AddEventDialog / PropertyPanel）

**Files:**

- Modify: `src/components/AddEventDialog.tsx:92-102`
- Modify: `src/components/PropertyPanel.tsx:407-424`

- [ ] **Step 1: 改写 AddEventDialog 攻击类型 select**

修改 `src/components/AddEventDialog.tsx`，先在 import 区添加：

```tsx
import {
  DAMAGE_EVENT_TYPES,
  DAMAGE_EVENT_TYPE_LABELS,
  type DamageType,
  type DamageEventType,
} from '@/types/timeline'
```

（替换原本的 `import type { DamageType, DamageEventType } from '@/types/timeline'`）

然后把第 92-102 行的攻击类型 select 替换为：

```tsx
<div>
  <label className="block text-sm font-medium mb-1">攻击类型</label>
  <select
    value={type}
    onChange={e => setType(e.target.value as DamageEventType)}
    className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
  >
    {DAMAGE_EVENT_TYPES.map(t => (
      <option key={t} value={t}>
        {DAMAGE_EVENT_TYPE_LABELS[t]}
      </option>
    ))}
  </select>
</div>
```

- [ ] **Step 2: 改写 PropertyPanel 攻击类型 select**

修改 `src/components/PropertyPanel.tsx`，先在 import 区把：

```tsx
import type { DamageType, DamageEventType } from '@/types/timeline'
```

替换为：

```tsx
import {
  DAMAGE_EVENT_TYPES,
  DAMAGE_EVENT_TYPE_LABELS,
  type DamageType,
  type DamageEventType,
} from '@/types/timeline'
```

然后把第 407-424 行的攻击类型 select 替换为：

```tsx
<div>
  <label className="block text-xs text-muted-foreground mb-1">攻击类型</label>
  <select
    value={event.type || 'aoe'}
    onChange={e =>
      updateDamageEvent(event.id, {
        type: e.target.value as DamageEventType,
      })
    }
    className="w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-background text-foreground disabled:bg-muted disabled:cursor-not-allowed"
    disabled={isReadOnly}
  >
    {DAMAGE_EVENT_TYPES.map(t => (
      <option key={t} value={t}>
        {DAMAGE_EVENT_TYPE_LABELS[t]}
      </option>
    ))}
  </select>
</div>
```

- [ ] **Step 3: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`

Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/components/AddEventDialog.tsx src/components/PropertyPanel.tsx
git commit -m "feat(ui): 攻击类型下拉支持 partial_aoe / partial_final_aoe"
```

---

## Task 6: 过滤器对话框 Switch 列表动态化

**Files:**

- Modify: `src/components/FilterMenu/EditPresetDialog.tsx:189-214`

- [ ] **Step 1: 在 import 区追加 LABELS 与常量**

修改 `src/components/FilterMenu/EditPresetDialog.tsx`，把：

```tsx
import type { DamageEventType } from '@/types/timeline'
```

替换为：

```tsx
import {
  DAMAGE_EVENT_TYPES,
  DAMAGE_EVENT_TYPE_LABELS,
  type DamageEventType,
} from '@/types/timeline'
```

- [ ] **Step 2: 把硬编码的 3 个 Switch 改为 map 渲染**

把第 189-214 行的伤害事件类型块替换为：

```tsx
<div className="space-y-1.5">
  <label className="text-sm font-medium">伤害事件类型</label>
  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-2 py-1">
    {DAMAGE_EVENT_TYPES.map(t => (
      <label key={t} className="flex items-center gap-2 cursor-pointer">
        <Switch checked={damageTypes.includes(t)} onCheckedChange={() => toggleDamageType(t)} />
        <span className="text-sm">{DAMAGE_EVENT_TYPE_LABELS[t]}</span>
      </label>
    ))}
  </div>
</div>
```

注意：`flex-wrap` + `gap-y-2` 让 5 个 Switch 在窄宽度下能正常换行，不必担心溢出。

- [ ] **Step 3: 修改"全选"默认值**

找到第 73-77 行 `damageTypes` state 初始化：

```tsx
const [damageTypes, setDamageTypes] = useState<DamageEventType[]>(() =>
  preset?.kind === 'custom' && preset.rule.damageTypes
    ? preset.rule.damageTypes
    : ['aoe', 'tankbuster', 'auto']
)
```

替换为：

```tsx
const [damageTypes, setDamageTypes] = useState<DamageEventType[]>(() =>
  preset?.kind === 'custom' && preset.rule.damageTypes
    ? preset.rule.damageTypes
    : [...DAMAGE_EVENT_TYPES]
)
```

新建预设时默认全选所有 5 个类型。

- [ ] **Step 4: 验证**

Run: `pnpm exec tsc --noEmit && pnpm lint`

Expected: 通过。

- [ ] **Step 5: 启动 dev server 手动验证（可选）**

如果用户的开发服务器没在跑，跳过此步。如果在跑，访问 EditPresetDialog 确认 5 个 Switch 正确渲染、文案正确。

- [ ] **Step 6: Commit**

```bash
git add src/components/FilterMenu/EditPresetDialog.tsx
git commit -m "feat(filter): EditPresetDialog 支持 5 种攻击类型动态渲染"
```

---

## Task 7: 内置过滤预设扩展

**Files:**

- Modify: `src/store/filterStore.ts:10-53`
- Modify: `src/store/filterStore.test.ts`
- Modify: `src/hooks/useFilteredTimelineView.test.ts`

- [ ] **Step 1: 扩展内置预设的 damageTypes**

修改 `src/store/filterStore.ts:10-53`：

```ts
export const BUILTIN_PRESETS: FilterPreset[] = [
  {
    kind: 'builtin',
    id: 'builtin:all',
    name: '全部',
    rule: {},
  },
  {
    kind: 'builtin',
    id: 'builtin:raidwide',
    name: '仅团减',
    rule: {
      damageTypes: ['aoe', 'partial_aoe', 'partial_final_aoe'],
      categories: ['partywide'],
    },
  },
  {
    kind: 'builtin',
    id: 'builtin:dps',
    name: '仅 DPS',
    rule: {
      damageTypes: ['aoe', 'partial_aoe', 'partial_final_aoe'],
      jobRoles: ['melee', 'ranged', 'caster'],
    },
  },
  {
    kind: 'builtin',
    id: 'builtin:tank',
    name: '仅坦克',
    rule: {
      damageTypes: ['aoe', 'partial_aoe', 'partial_final_aoe', 'tankbuster', 'auto'],
      jobRoles: ['tank'],
    },
  },
  {
    kind: 'builtin',
    id: 'builtin:healer',
    name: '仅治疗',
    rule: {
      damageTypes: ['aoe', 'partial_aoe', 'partial_final_aoe'],
      jobRoles: ['healer'],
    },
  },
]
```

- [ ] **Step 2: 在 filterStore.test.ts 新增内置预设语义验证（如已有 BUILTIN_PRESETS 验证则扩展）**

读取 `src/store/filterStore.test.ts` 找到验证 BUILTIN_PRESETS 的 describe 块。如果有现成的"内置预设"测试块，在其中追加：

```ts
import { BUILTIN_PRESETS } from './filterStore'

it('内置预设 raidwide 包含 partial_aoe / partial_final_aoe', () => {
  const p = BUILTIN_PRESETS.find(x => x.id === 'builtin:raidwide')!
  expect(p.kind).toBe('builtin')
  if (p.kind !== 'builtin') return
  expect(p.rule.damageTypes).toEqual(
    expect.arrayContaining(['aoe', 'partial_aoe', 'partial_final_aoe'])
  )
})

it('内置预设 tank 包含全部 5 个攻击类型', () => {
  const p = BUILTIN_PRESETS.find(x => x.id === 'builtin:tank')!
  if (p.kind !== 'builtin') throw new Error('not builtin')
  expect(p.rule.damageTypes).toEqual(
    expect.arrayContaining(['aoe', 'partial_aoe', 'partial_final_aoe', 'tankbuster', 'auto'])
  )
})
```

如果 `filterStore.test.ts` 没有 BUILTIN_PRESETS 相关测试块，新建一个 `describe('BUILTIN_PRESETS', () => { ... })`。

- [ ] **Step 3: 在 useFilteredTimelineView.test.ts 新增 partial 命中测试**

修改 `src/hooks/useFilteredTimelineView.test.ts`，在 `describe('matchDamageEvent', ...)` 块（约第 144 行起）追加：

```ts
it('内置 raidwide 预设命中 partial_aoe', () => {
  const e: DamageEvent = {
    id: 'e',
    name: 'p',
    time: 0,
    damage: 0,
    type: 'partial_aoe',
    damageType: 'magical',
  }
  const p = builtin({ damageTypes: ['aoe', 'partial_aoe', 'partial_final_aoe'] })
  expect(matchDamageEvent(e, p)).toBe(true)
})

it('内置 raidwide 预设命中 partial_final_aoe', () => {
  const e: DamageEvent = {
    id: 'e',
    name: 'p',
    time: 0,
    damage: 0,
    type: 'partial_final_aoe',
    damageType: 'magical',
  }
  const p = builtin({ damageTypes: ['aoe', 'partial_aoe', 'partial_final_aoe'] })
  expect(matchDamageEvent(e, p)).toBe(true)
})

it('自定义预设老数据 damageTypes:["aoe"] 不被迁移，partial 事件不命中', () => {
  const e: DamageEvent = {
    id: 'e',
    name: 'p',
    time: 0,
    damage: 0,
    type: 'partial_aoe',
    damageType: 'magical',
  }
  const p = custom({}, ['aoe'])
  expect(matchDamageEvent(e, p)).toBe(false)
})
```

- [ ] **Step 4: 运行测试**

Run: `pnpm test:run src/store/filterStore.test.ts src/hooks/useFilteredTimelineView.test.ts`

Expected: 新增测试全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/store/filterStore.ts src/store/filterStore.test.ts src/hooks/useFilteredTimelineView.test.ts
git commit -m "feat(filter): 内置预设自动包含 partial_aoe / partial_final_aoe"
```

---

## Task 8: 全量验证与收尾

**Files:** （无新文件，纯验证）

- [ ] **Step 1: 全量测试**

Run: `pnpm test:run`

Expected: 全部通过，无新增失败。

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`

Expected: 无错误。

- [ ] **Step 3: lint**

Run: `pnpm lint`

Expected: 无错误。

- [ ] **Step 4: 构建（兜底）**

Run: `pnpm build`

Expected: 构建成功。如果失败，多半是某个引用路径没改干净，按报错修复。

- [ ] **Step 5: 手动验证（如开发服务器在跑）**

如用户已有 dev server，验证：

1. 编辑模式新建伤害事件，下拉能看到 5 个攻击类型，文案为"全员 AOE / 死刑 / 普通攻击 / 部分 AOE / 部分 AOE（结算）"
2. PropertyPanel 选择已有事件，下拉同上
3. 过滤菜单"新建预设"对话框，伤害事件类型区域有 5 个 Switch
4. 切换"仅团减"内置预设，时间轴上 partial_aoe 类型的事件能被显示
5. （如可用）从 FFLogs 导入一个有"分波 AOE"机制的副本，验证 partial 状态机自动判别正确

如 dev server 不在跑，跳过此步并明确告知用户："UI 未亲自手动验证；功能正确性靠测试套保证。"

- [ ] **Step 6: 不需要单独 commit（前面任务已 commit）**

如果有未提交的零散改动（比如修复 lint 自动产生的格式化变更），统一 commit：

```bash
git status
# 如果有未提交内容：
git add -u
git commit -m "chore: 收尾格式 / lint 修复"
```

---

## Self-Review

**Spec coverage check:**

| Spec 节 / 要求                                       | Plan 任务                |
| ---------------------------------------------------- | ------------------------ |
| 类型层（DAMAGE_EVENT_TYPES + LABELS + V2 ty + 兜底） | Task 1                   |
| timelineFormat round-trip + 兜底测试                 | Task 2                   |
| partialAoeClassifier 模块 + 算法                     | Task 3                   |
| 流水线接入（detect → refine → classify）             | Task 4                   |
| ImportFFLogsDialog 传 composition                    | Task 4 Step 6            |
| AddEventDialog / PropertyPanel select                | Task 5                   |
| EditPresetDialog Switch 动态化                       | Task 6                   |
| 内置 4 个预设扩展                                    | Task 7 Step 1            |
| 自定义预设不迁移（验证测试）                         | Task 7 Step 3            |
| filterStore.test 内置预设语义                        | Task 7 Step 2            |
| useFilteredTimelineView.test partial 命中            | Task 7 Step 3            |
| mitigationCalculator / statusExtras 不动             | 隐式覆盖（无任务即落实） |
| 视觉层不动（DamageEventCard / Minimap / Table）      | 隐式覆盖（无任务即落实） |
| 全量测试 + 类型 + lint + 构建                        | Task 8                   |

**Placeholder scan:** 无 TBD/TODO/"appropriate"等占位；所有代码块完整可贴。

**Type consistency:** `classifyPartialAOE(events, composition)` 签名在 Task 3（实现）、Task 4（调用点）、Spec 三处一致；`Composition` import 在 fflogsImporter 中是 type-only 复用既有；`DAMAGE_EVENT_TYPE_LABELS` 在 Task 1 定义，在 Task 5/6 引用。

未发现遗漏。
