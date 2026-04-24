# 资源模型重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"单层 cooldown + 假 buff stack 模拟多充能"替换为统一的资源池抽象；同时迁移学者慰藉、骑士献奉到新模型，并重写蓝色 CD 条语义为"此 cast 打空池子到恢复的时段"。

**Architecture:** 新增 `src/utils/resource/` 子目录承载 compute / validator / legalIntervals / cdBar 四个纯函数模块；`src/types/resource.ts` + `src/data/resources.ts` 承载静态数据层；放置引擎 (`src/utils/placement/engine.ts`) 里的 `cooldownAvailable` 被删除，合并 resource validator / legalIntervals 到统一入口。资源事件从 `castEvents` 纯函数派生，不进 `PartyState`。

**Tech Stack:** TypeScript 5.9, Vitest 4, React 19 + react-konva（Canvas 渲染）

**参考 spec:** `design/superpowers/specs/2026-04-24-resource-model-design.md`

---

## 文件结构

### 新增文件

| 路径                                        | 职责                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/types/resource.ts`                     | `ResourceDefinition` / `ResourceEffect` / `ResourceEvent` / `ResourceSnapshot` / `ResourceExhaustion` |
| `src/data/resources.ts`                     | `RESOURCE_REGISTRY` 映射 + 命名空间断言                                                               |
| `src/utils/resource/compute.ts`             | `deriveResourceEvents` / `computeResourceTrace` / `computeResourceAmount`                             |
| `src/utils/resource/compute.test.ts`        | compute 层单测                                                                                        |
| `src/utils/resource/validator.ts`           | `findResourceExhaustedCasts`                                                                          |
| `src/utils/resource/validator.test.ts`      | validator 单测                                                                                        |
| `src/utils/resource/legalIntervals.ts`      | `resourceLegalIntervals`                                                                              |
| `src/utils/resource/legalIntervals.test.ts` | legalIntervals 单测                                                                                   |
| `src/utils/resource/cdBar.ts`               | `computeCdBarEnd`                                                                                     |
| `src/utils/resource/cdBar.test.ts`          | cdBar 单测                                                                                            |

### 修改文件

| 路径                                            | 改动                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/types/mitigation.ts`                       | `MitigationAction` 加 `resourceEffects?: ResourceEffect[]`                                       |
| `src/utils/placement/types.ts`                  | `InvalidReason` 改、`InvalidCastEvent` 加 `resourceId?`                                          |
| `src/utils/placement/engine.ts`                 | 删 `cooldownAvailable`；`findInvalidCastEvents` 合并 placement + resource；加 `cdBarEndFor` 方法 |
| `src/utils/placement/engine.test.ts`            | `'cooldown_conflict'` → `'resource_exhausted'` 断言迁移                                          |
| `src/data/mitigationActions.ts`                 | 炽天/慰藉/献奉三条数据改，假 buff `20016546` 连带删                                              |
| `src/executors/createBuffExecutor.ts`           | 删 `BuffExecutorOptions.stack`                                                                   |
| `src/components/Timeline/CastEventIcon.tsx`     | 蓝条宽度按 `cdBarEnd` 算；文本按 `Math.round` 剩余秒数                                           |
| `src/components/Timeline/SkillTracksCanvas.tsx` | 给 `CastEventIcon` 传 `cdBarEnd` + `timelineEndSec` prop                                         |
| `CLAUDE.md`                                     | "核心概念"章节加"资源模型"小节                                                                   |

---

## 执行顺序概览

1. **阶段 1（类型骨架）**：Task 1.1–1.4。零行为变更。一 commit。
2. **阶段 2（compute 层）**：Task 2.1–2.9。纯新增，不接调用方。一 commit。
3. **阶段 3（validator + legalIntervals）**：Task 3.1–3.7。一 commit。
4. **阶段 4（placement engine 解耦）**：Task 4.1–4.7。**破坏性手术**。单独 commit。
5. **阶段 5（数据迁移）**：Task 5.1–5.8。慰藉 + 献奉 + 炽天。一 commit。
6. **阶段 6（CD 条渲染）**：Task 6.1–6.8。一 commit。
7. **阶段 7（清理 + 文档）**：Task 7.1–7.4。一 commit。

---

## 阶段 1 · 类型骨架

### Task 1.1：创建 `src/types/resource.ts`

**Files:**

- Create: `src/types/resource.ts`

- [ ] **Step 1：写出类型文件**

```typescript
/**
 * 资源池类型定义
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 */

import type { Job } from '@/data/jobs'

/** 资源池静态声明 */
export interface ResourceDefinition {
  /** 资源 id，如 'sch:consolation' / 'drk:oblation'。显式 id 不得以 '__cd__:' 开头 */
  id: string
  name: string
  /** 所属职业。仅 registry 元数据 / 未来 UI 面板用；runtime compute 层不消费 */
  job: Job
  /** 战斗开始时的值 */
  initial: number
  /** 池子上限 */
  max: number
  /**
   * 充能回充配置。不声明 = 不随时间恢复（纯事件驱动资源）。
   * 语义：每个消耗事件调度一个 interval 秒后到点的独立 refill，到点时若 amount < max 则 +amount、满则忽略。
   * NOT 从战斗 t=0 固定节拍 tick。
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
  playerId: number
  resourceId: string
  required: boolean
  /**
   * 同 timestamp 多事件的稳定 tie-break：castEvents 原数组下标。
   * castEvents 数组本身按 timestamp 升序存储，orderIndex 仅在同 timestamp 冲突时兜底。
   */
  orderIndex: number
}

/** 事件处理前后 + pending refills 快照，供 validator / legalIntervals / cdBarEnd 共用 */
export interface ResourceSnapshot {
  /** 对应 events[index] */
  index: number
  /** 事件 apply 前的 amount（已 apply 前面所有 refills） */
  amountBefore: number
  /** 事件 apply 后的 amount（已 clamp 上限，下限不 clamp） */
  amountAfter: number
  /** 此事件 apply 后仍挂着的 refill 时间列表（升序） */
  pendingAfter: number[]
}

/** validator 的非法 cast 记录 */
export interface ResourceExhaustion {
  castEventId: string
  resourceKey: string
  resourceId: string
  playerId: number
}
```

- [ ] **Step 2：运行 tsc 验证**

Run: `pnpm exec tsc --noEmit`
Expected: 零 error（仅新增类型文件，无引用冲突）

### Task 1.2：扩展 `MitigationAction` 加 `resourceEffects?`

**Files:**

- Modify: `src/types/mitigation.ts`

- [ ] **Step 1：在 `MitigationAction` interface 末尾加字段**

在 `src/types/mitigation.ts:114`（`placement?: ...` 之后、接口闭合 `}` 之前）插入：

```typescript
  /**
   * 一次 cast 对资源池的影响。compute 层的合成规则：
   *   - 本字段未声明，或声明了但不含 delta<0（纯产出）→ 合成单充能池 __cd__:${id} 强制 cooldown
   *   - 含 delta<0（有显式消费者）→ 跳过合成，cooldown 字段沦为信息性
   */
  resourceEffects?: import('./resource').ResourceEffect[]
```

- [ ] **Step 2：tsc 验证**

Run: `pnpm exec tsc --noEmit`
Expected: 零 error（可选字段不影响现有数据）

### Task 1.3：创建 `src/data/resources.ts`（空 registry）

**Files:**

- Create: `src/data/resources.ts`

- [ ] **Step 1：写出空 registry + 命名空间断言**

```typescript
/**
 * 资源池 registry
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 *
 * 约束：显式资源 id **不得**以 '__cd__:' 开头 —— 该前缀保留给 compute 层合成的单充能池。
 */

import type { ResourceDefinition } from '@/types/resource'

export const RESOURCE_REGISTRY: Record<string, ResourceDefinition> = {}

// 模块导入时校验命名空间不冲突
for (const id of Object.keys(RESOURCE_REGISTRY)) {
  if (id.startsWith('__cd__:')) {
    throw new Error(`Resource id "${id}" conflicts with synthetic CD resource namespace`)
  }
}
```

- [ ] **Step 2：tsc + lint 验证**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 零 error / 零 warning

### Task 1.4：阶段 1 commit

- [ ] **Step 1：commit**

```bash
git add src/types/resource.ts src/types/mitigation.ts src/data/resources.ts
git commit -m "feat(resource): 类型骨架 + 空 registry（零行为变更）"
```

Expected: husky pre-commit 通过（改动文件小，lint-staged 通过 prettier/eslint/tsc 检查）

---

## 阶段 2 · compute 层 + 单测

### Task 2.1：`deriveResourceEvents` 写测试（纯事件驱动）

**Files:**

- Create: `src/utils/resource/compute.test.ts`

- [ ] **Step 1：创建测试文件框架 + 第一组 case**

```typescript
import { describe, it, expect } from 'vitest'
import { deriveResourceEvents, computeResourceTrace, computeResourceAmount } from './compute'
import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { ResourceDefinition } from '@/types/resource'

function makeAction(partial: Partial<MitigationAction> & { id: number }): MitigationAction {
  return {
    name: 'A',
    icon: '',
    jobs: [] as unknown as MitigationAction['jobs'],
    category: ['partywide'],
    duration: 0,
    cooldown: 60,
    ...partial,
  } as MitigationAction
}

function makeCast(partial: Partial<CastEvent> & { id: string; actionId: number }): CastEvent {
  return {
    playerId: 10,
    timestamp: 0,
    ...partial,
  } as CastEvent
}

describe('deriveResourceEvents', () => {
  it('无 resourceEffects 的 action 合成 __cd__:${id} 消耗事件', () => {
    const action = makeAction({ id: 101, cooldown: 60 })
    const events = deriveResourceEvents(
      [makeCast({ id: 'c1', actionId: 101, timestamp: 10 })],
      new Map([[101, action]])
    )
    const key = '10:__cd__:101'
    expect(events.get(key)).toEqual([
      {
        resourceKey: key,
        timestamp: 10,
        delta: -1,
        castEventId: 'c1',
        actionId: 101,
        playerId: 10,
        resourceId: '__cd__:101',
        required: true,
        orderIndex: 0,
      },
    ])
  })
})
```

- [ ] **Step 2：运行测试验证 fail**

Run: `pnpm test:run src/utils/resource/compute.test.ts`
Expected: FAIL（模块 `./compute` 不存在）

### Task 2.2：实现 `deriveResourceEvents`

**Files:**

- Create: `src/utils/resource/compute.ts`

- [ ] **Step 1：写出 `deriveResourceEvents` 初稿**

```typescript
/**
 * 资源 compute 层
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 */

import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type {
  ResourceDefinition,
  ResourceEffect,
  ResourceEvent,
  ResourceSnapshot,
} from '@/types/resource'

/**
 * 判断 action 是否声明了消费者（delta<0）。没有消费者 → 合成 __cd__:${id}。
 */
function hasExplicitConsumer(action: MitigationAction): boolean {
  return !!action.resourceEffects?.some(e => e.delta < 0)
}

/**
 * 单条 cast 生成其应派生的 ResourceEffect 列表。
 * 有显式消费者 → 直接用 action.resourceEffects；
 * 无显式消费者 → 合成一个 [{ resourceId: '__cd__:${id}', delta: -1, required: true }]，
 *             同时带上可能存在的产出 effect（如未来纯产出类）。
 */
function effectsForAction(action: MitigationAction): ResourceEffect[] {
  if (hasExplicitConsumer(action)) {
    return action.resourceEffects ?? []
  }
  const synthetic: ResourceEffect = {
    resourceId: `__cd__:${action.id}`,
    delta: -1,
    required: true,
  }
  return [synthetic, ...(action.resourceEffects ?? [])]
}

/**
 * 从 castEvents 派生出按 resourceKey 分组、按 (timestamp ASC, orderIndex ASC) 稳定排序的事件。
 *
 * - 对 resourceEffects 中无 `delta < 0` 的 action（无声明 / 只产出）：合成 `__cd__:${id}` 消耗事件
 * - ResourceEffect.required 未声明默认 true；派生到 ResourceEvent.required
 */
export function deriveResourceEvents(
  castEvents: CastEvent[],
  actions: Map<number, MitigationAction>
): Map<string, ResourceEvent[]> {
  const grouped = new Map<string, ResourceEvent[]>()
  castEvents.forEach((ce, orderIndex) => {
    const action = actions.get(ce.actionId)
    if (!action) return
    for (const eff of effectsForAction(action)) {
      const resourceKey = `${ce.playerId}:${eff.resourceId}`
      const ev: ResourceEvent = {
        resourceKey,
        timestamp: ce.timestamp,
        delta: eff.delta,
        castEventId: ce.id,
        actionId: ce.actionId,
        playerId: ce.playerId,
        resourceId: eff.resourceId,
        required: eff.required ?? true,
        orderIndex,
      }
      const arr = grouped.get(resourceKey) ?? []
      arr.push(ev)
      grouped.set(resourceKey, arr)
    }
  })
  // 稳定排序：主序 timestamp，次序 orderIndex
  for (const arr of grouped.values()) {
    arr.sort((a, b) => a.timestamp - b.timestamp || a.orderIndex - b.orderIndex)
  }
  return grouped
}

// 占位导出，避免下游 test 引入失败；后续 task 补实现
export function computeResourceTrace(
  _def: ResourceDefinition,
  _events: ResourceEvent[]
): ResourceSnapshot[] {
  throw new Error('computeResourceTrace not implemented yet')
}

export function computeResourceAmount(
  _def: ResourceDefinition,
  _events: ResourceEvent[],
  _atTime: number
): number {
  throw new Error('computeResourceAmount not implemented yet')
}
```

- [ ] **Step 2：运行测试验证 pass**

Run: `pnpm test:run src/utils/resource/compute.test.ts`
Expected: PASS（第一个 case 通过；另外两个函数暂 throw，与 test 无关）

### Task 2.3：`deriveResourceEvents` 补充测试

**Files:**

- Modify: `src/utils/resource/compute.test.ts`

- [ ] **Step 1：追加覆盖 case**

在 `describe('deriveResourceEvents', () => {` 块内、`it('无 resourceEffects ...'` 之后追加：

```typescript
it('声明了消费者的 action → 不合成 __cd__，直接用 resourceEffects', () => {
  const action = makeAction({
    id: 16546,
    cooldown: 30,
    resourceEffects: [{ resourceId: 'sch:consolation', delta: -1 }],
  })
  const events = deriveResourceEvents(
    [makeCast({ id: 'c1', actionId: 16546, timestamp: 125 })],
    new Map([[16546, action]])
  )
  expect(events.has('10:__cd__:16546')).toBe(false)
  expect(events.get('10:sch:consolation')).toEqual([
    expect.objectContaining({
      resourceId: 'sch:consolation',
      delta: -1,
      castEventId: 'c1',
      timestamp: 125,
    }),
  ])
})

it('同 timestamp 多事件按 castEvents 原顺序稳定排序', () => {
  const a = makeAction({ id: 1, cooldown: 10 })
  const events = deriveResourceEvents(
    [
      makeCast({ id: 'first', actionId: 1, timestamp: 5 }),
      makeCast({ id: 'second', actionId: 1, timestamp: 5 }),
    ],
    new Map([[1, a]])
  )
  const arr = events.get('10:__cd__:1')!
  expect(arr.map(e => e.castEventId)).toEqual(['first', 'second'])
  expect(arr.map(e => e.orderIndex)).toEqual([0, 1])
})

it('未知 actionId 被忽略（no-op，不抛异常）', () => {
  const events = deriveResourceEvents(
    [makeCast({ id: 'x', actionId: 9999, timestamp: 0 })],
    new Map()
  )
  expect(events.size).toBe(0)
})

it('纯产出类（delta>0 only）仍合成 __cd__ 消耗（future-proof）', () => {
  const action = makeAction({
    id: 42,
    cooldown: 25,
    resourceEffects: [{ resourceId: 'wm:blood-lily', delta: +1 }],
  })
  const events = deriveResourceEvents(
    [makeCast({ id: 'c', actionId: 42, timestamp: 0 })],
    new Map([[42, action]])
  )
  // 既有 __cd__:42 消耗，也有 wm:blood-lily 产出
  expect(events.get('10:__cd__:42')?.[0].delta).toBe(-1)
  expect(events.get('10:wm:blood-lily')?.[0].delta).toBe(+1)
})
```

- [ ] **Step 2：运行 + 验证全部 pass**

Run: `pnpm test:run src/utils/resource/compute.test.ts`
Expected: 4 passing（含 Task 2.1 的）

### Task 2.4：`computeResourceTrace` 写测试

**Files:**

- Modify: `src/utils/resource/compute.test.ts`

- [ ] **Step 1：追加 trace 单测**

在文件末尾追加：

```typescript
describe('computeResourceTrace — 充能计时语义', () => {
  function makeDef(partial: Partial<ResourceDefinition>): ResourceDefinition {
    return {
      id: 'test',
      name: 'Test',
      job: 'SCH',
      initial: 2,
      max: 2,
      regen: { interval: 60, amount: 1 },
      ...partial,
    } as ResourceDefinition
  }

  function makeRe(partial: {
    timestamp: number
    delta: number
    index: number
  }): import('@/types/resource').ResourceEvent {
    return {
      resourceKey: '10:test',
      playerId: 10,
      resourceId: 'test',
      castEventId: `c${partial.index}`,
      actionId: 1,
      required: true,
      orderIndex: partial.index,
      ...partial,
    }
  }

  it('单事件消耗调度单 refill，其 interval 秒后恢复', () => {
    const def = makeDef({ initial: 2, max: 2, regen: { interval: 60, amount: 1 } })
    const events = [makeRe({ timestamp: 45, delta: -1, index: 0 })]
    const trace = computeResourceTrace(def, events)
    expect(trace).toEqual([
      {
        index: 0,
        amountBefore: 2,
        amountAfter: 1,
        pendingAfter: [105], // 45 + 60
      },
    ])
  })

  it('充能计时核心回归：t=45 消耗 → refill 在 t=105 而非 t=60', () => {
    // D4 反例：草案固定钟会在 t=60 tick 补满，真实 FF14 是 t=105
    const def = makeDef({ initial: 2, max: 2, regen: { interval: 60, amount: 1 } })
    const events = [
      makeRe({ timestamp: 45, delta: -1, index: 0 }),
      // 模拟 t=60 查询时：refill@105 未触发 → amount=1（非 2）
    ]
    const trace = computeResourceTrace(def, events)
    // t=60 无事件，trace 只有一条 @ t=45；在 atTime=60 的 amount 由 computeResourceAmount 测；
    // 这里验证 pendingAfter[0] = 105 而不是 60
    expect(trace[0].pendingAfter).toEqual([105])
  })

  it('献奉双 cast @ t=0/30 连环消耗：pendingAfter 各独立调度', () => {
    const def = makeDef({ initial: 2, max: 2, regen: { interval: 60, amount: 1 } })
    const events = [
      makeRe({ timestamp: 0, delta: -1, index: 0 }),
      makeRe({ timestamp: 30, delta: -1, index: 1 }),
    ]
    const trace = computeResourceTrace(def, events)
    expect(trace).toEqual([
      { index: 0, amountBefore: 2, amountAfter: 1, pendingAfter: [60] },
      { index: 1, amountBefore: 1, amountAfter: 0, pendingAfter: [60, 90] },
    ])
  })

  it('产出溢出 clamp 到 max（上限）', () => {
    const def = makeDef({ initial: 2, max: 2, regen: undefined })
    const events = [makeRe({ timestamp: 0, delta: +2, index: 0 })]
    const trace = computeResourceTrace(def, events)
    expect(trace[0].amountAfter).toBe(2) // 2 + 2 clamp to 2
  })

  it('消耗不 clamp 下限（amount 可为负）', () => {
    const def = makeDef({ initial: 0, max: 2, regen: undefined })
    const events = [makeRe({ timestamp: 0, delta: -1, index: 0 })]
    const trace = computeResourceTrace(def, events)
    expect(trace[0].amountAfter).toBe(-1)
  })

  it('refill 触发穿插在事件之间', () => {
    const def = makeDef({ initial: 2, max: 2, regen: { interval: 30, amount: 1 } })
    const events = [
      makeRe({ timestamp: 0, delta: -1, index: 0 }), // schedule refill@30
      makeRe({ timestamp: 35, delta: -1, index: 1 }), // refill@30 先触发 → amount=2；然后消耗到 1
    ]
    const trace = computeResourceTrace(def, events)
    expect(trace[1].amountBefore).toBe(2)
    expect(trace[1].amountAfter).toBe(1)
  })

  it('无 regen 时消耗不调度 refill', () => {
    const def = makeDef({ initial: 2, max: 2, regen: undefined })
    const events = [makeRe({ timestamp: 0, delta: -1, index: 0 })]
    const trace = computeResourceTrace(def, events)
    expect(trace[0].pendingAfter).toEqual([])
  })

  it('|delta|=N 的消耗调度 N 个独立 refill（同 timestamp+interval）', () => {
    const def = makeDef({ initial: 2, max: 2, regen: { interval: 60, amount: 1 } })
    const events = [makeRe({ timestamp: 0, delta: -2, index: 0 })]
    const trace = computeResourceTrace(def, events)
    expect(trace[0].pendingAfter).toEqual([60, 60])
  })
})
```

- [ ] **Step 2：运行测试验证 fail**

Run: `pnpm test:run src/utils/resource/compute.test.ts`
Expected: 8 new tests FAIL（`computeResourceTrace not implemented yet`）

### Task 2.5：实现 `computeResourceTrace`

**Files:**

- Modify: `src/utils/resource/compute.ts`

- [ ] **Step 1：替换占位实现**

把 `computeResourceTrace` 函数体替换为：

```typescript
export function computeResourceTrace(
  def: ResourceDefinition,
  events: ResourceEvent[]
): ResourceSnapshot[] {
  const result: ResourceSnapshot[] = []
  let amount = def.initial
  // pending refills 用升序数组（事件数通常 <20，插入成本可忽略）
  const pending: number[] = []

  const firePendingUpTo = (t: number) => {
    while (pending.length > 0 && pending[0] <= t) {
      pending.shift()
      if (def.regen) {
        amount = Math.min(amount + def.regen.amount, def.max)
      }
    }
  }

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    firePendingUpTo(ev.timestamp)
    const amountBefore = amount
    // 应用 delta；上限 clamp，下限不 clamp
    amount = Math.min(amount + ev.delta, def.max)
    // 消耗事件调度 |delta| 个 refill
    if (ev.delta < 0 && def.regen) {
      const count = -ev.delta
      for (let k = 0; k < count; k++) {
        const refillTime = ev.timestamp + def.regen.interval
        // 保持 pending 升序（所有新 refill 时刻相同，push 到末尾即可）
        pending.push(refillTime)
      }
    }
    result.push({
      index: i,
      amountBefore,
      amountAfter: amount,
      pendingAfter: [...pending],
    })
  }
  return result
}
```

- [ ] **Step 2：运行测试验证 pass**

Run: `pnpm test:run src/utils/resource/compute.test.ts`
Expected: 12 passing（4 deriveResourceEvents + 8 computeResourceTrace）

### Task 2.6：`computeResourceAmount` 写测试

**Files:**

- Modify: `src/utils/resource/compute.test.ts`

- [ ] **Step 1：追加测试**

在文件末尾追加：

```typescript
describe('computeResourceAmount', () => {
  function makeDef(partial: Partial<ResourceDefinition>): ResourceDefinition {
    return {
      id: 'test',
      name: 'Test',
      job: 'SCH',
      initial: 2,
      max: 2,
      regen: { interval: 60, amount: 1 },
      ...partial,
    } as ResourceDefinition
  }

  function makeRe(partial: {
    timestamp: number
    delta: number
    index: number
  }): import('@/types/resource').ResourceEvent {
    return {
      resourceKey: '10:test',
      playerId: 10,
      resourceId: 'test',
      castEventId: `c${partial.index}`,
      actionId: 1,
      required: true,
      orderIndex: partial.index,
      ...partial,
    }
  }

  it('无事件：返回 initial', () => {
    const def = makeDef({ initial: 2 })
    expect(computeResourceAmount(def, [], 100)).toBe(2)
  })

  it('atTime 早于任何事件：返回 initial', () => {
    const def = makeDef({ initial: 2 })
    const events = [makeRe({ timestamp: 45, delta: -1, index: 0 })]
    expect(computeResourceAmount(def, events, 40)).toBe(2)
  })

  it('献奉 t=45 消耗 → atTime=60 仍是 1（refill@105 未触发）', () => {
    const def = makeDef({ initial: 2, max: 2, regen: { interval: 60, amount: 1 } })
    const events = [makeRe({ timestamp: 45, delta: -1, index: 0 })]
    expect(computeResourceAmount(def, events, 60)).toBe(1)
    expect(computeResourceAmount(def, events, 104)).toBe(1)
    expect(computeResourceAmount(def, events, 105)).toBe(2)
    expect(computeResourceAmount(def, events, 200)).toBe(2)
  })

  it('献奉双 cast 连环：t=30 降 0、t=60 升 1、t=90 升 2', () => {
    const def = makeDef({ initial: 2, max: 2, regen: { interval: 60, amount: 1 } })
    const events = [
      makeRe({ timestamp: 0, delta: -1, index: 0 }),
      makeRe({ timestamp: 30, delta: -1, index: 1 }),
    ]
    expect(computeResourceAmount(def, events, 0)).toBe(1)
    expect(computeResourceAmount(def, events, 29)).toBe(1)
    expect(computeResourceAmount(def, events, 30)).toBe(0)
    expect(computeResourceAmount(def, events, 59)).toBe(0)
    expect(computeResourceAmount(def, events, 60)).toBe(1)
    expect(computeResourceAmount(def, events, 89)).toBe(1)
    expect(computeResourceAmount(def, events, 90)).toBe(2)
    expect(computeResourceAmount(def, events, 200)).toBe(2)
  })
})
```

- [ ] **Step 2：运行测试验证 fail**

Run: `pnpm test:run src/utils/resource/compute.test.ts`
Expected: 4 new FAIL（`computeResourceAmount not implemented yet`）

### Task 2.7：实现 `computeResourceAmount`（基于 trace）

**Files:**

- Modify: `src/utils/resource/compute.ts`

- [ ] **Step 1：重写实现**

替换 `computeResourceAmount` 函数体：

```typescript
export function computeResourceAmount(
  def: ResourceDefinition,
  events: ResourceEvent[],
  atTime: number
): number {
  let amount = def.initial
  const pending: number[] = []

  const firePendingUpTo = (t: number) => {
    while (pending.length > 0 && pending[0] <= t) {
      pending.shift()
      if (def.regen) {
        amount = Math.min(amount + def.regen.amount, def.max)
      }
    }
  }

  for (const ev of events) {
    if (ev.timestamp > atTime) break
    firePendingUpTo(ev.timestamp)
    amount = Math.min(amount + ev.delta, def.max)
    if (ev.delta < 0 && def.regen) {
      const count = -ev.delta
      for (let k = 0; k < count; k++) {
        pending.push(ev.timestamp + def.regen.interval)
      }
    }
  }
  // 触发 atTime 及以前剩余的 pending
  firePendingUpTo(atTime)
  return amount
}
```

- [ ] **Step 2：运行测试验证全部 pass**

Run: `pnpm test:run src/utils/resource/compute.test.ts`
Expected: 16 passing（4 derive + 8 trace + 4 amount）

### Task 2.8：lint + tsc 收尾

- [ ] **Step 1：跑检查**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 零 error / 零 warning

### Task 2.9：阶段 2 commit

- [ ] **Step 1：commit**

```bash
git add src/utils/resource/compute.ts src/utils/resource/compute.test.ts
git commit -m "feat(resource): compute 层 + 单测（deriveResourceEvents / trace / amount）"
```

---

## 阶段 3 · validator + legalIntervals

### Task 3.1：`findResourceExhaustedCasts` 写测试

**Files:**

- Create: `src/utils/resource/validator.test.ts`

- [ ] **Step 1：写测试文件**

```typescript
import { describe, it, expect } from 'vitest'
import { findResourceExhaustedCasts } from './validator'
import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { ResourceDefinition } from '@/types/resource'

function makeAction(partial: Partial<MitigationAction> & { id: number }): MitigationAction {
  return {
    name: 'A',
    icon: '',
    jobs: [] as unknown as MitigationAction['jobs'],
    category: ['partywide'],
    duration: 0,
    cooldown: 60,
    ...partial,
  } as MitigationAction
}

function makeCast(partial: Partial<CastEvent> & { id: string; actionId: number }): CastEvent {
  return { playerId: 10, timestamp: 0, ...partial } as CastEvent
}

const syntheticRegistry: Record<string, ResourceDefinition> = {}

describe('findResourceExhaustedCasts', () => {
  it('单充能 action 两 cast 距离 < cd → 第二个非法', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const cs = [
      makeCast({ id: 'a', actionId: 1, timestamp: 0 }),
      makeCast({ id: 'b', actionId: 1, timestamp: 30 }),
    ]
    const result = findResourceExhaustedCasts(cs, new Map([[1, action]]), syntheticRegistry)
    expect(result).toEqual([
      expect.objectContaining({
        castEventId: 'b',
        resourceKey: '10:__cd__:1',
        resourceId: '__cd__:1',
        playerId: 10,
      }),
    ])
  })

  it('两 cast 恰好紧贴 cd 边界（t1 = t0 + cd）→ 都合法', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const cs = [
      makeCast({ id: 'a', actionId: 1, timestamp: 0 }),
      makeCast({ id: 'b', actionId: 1, timestamp: 60 }),
    ]
    const result = findResourceExhaustedCasts(cs, new Map([[1, action]]), syntheticRegistry)
    expect(result).toEqual([])
  })

  it('显式消费者 sch:consolation：第 3 次慰藉 exhaust', () => {
    const consolation = {
      id: 'sch:consolation',
      name: '慰藉充能',
      job: 'SCH',
      initial: 2,
      max: 2,
      regen: { interval: 30, amount: 1 },
    } as ResourceDefinition
    const huishi = makeAction({
      id: 16546,
      cooldown: 30,
      resourceEffects: [{ resourceId: 'sch:consolation', delta: -1 }],
    })
    const cs = [
      makeCast({ id: '1', actionId: 16546, timestamp: 125 }),
      makeCast({ id: '2', actionId: 16546, timestamp: 130 }),
      makeCast({ id: '3', actionId: 16546, timestamp: 135 }),
    ]
    const registry = { 'sch:consolation': consolation }
    const result = findResourceExhaustedCasts(cs, new Map([[16546, huishi]]), registry)
    expect(result.map(r => r.castEventId)).toEqual(['3'])
  })

  it('excludeId 排除某 cast 后其他 cast 合法性重算', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const cs = [
      makeCast({ id: 'a', actionId: 1, timestamp: 0 }),
      makeCast({ id: 'b', actionId: 1, timestamp: 30 }),
    ]
    // 排除 a → b 不再有前序冲突
    const result = findResourceExhaustedCasts(cs, new Map([[1, action]]), syntheticRegistry, 'a')
    expect(result).toEqual([])
  })

  it('required=false 的 effect 即使资源不足也不算非法', () => {
    const action = makeAction({
      id: 1,
      cooldown: 0,
      resourceEffects: [{ resourceId: 'x:optional', delta: -1, required: false }],
    })
    const registry = {
      'x:optional': {
        id: 'x:optional',
        name: 'X',
        job: 'SCH',
        initial: 0,
        max: 1,
      } as ResourceDefinition,
    }
    const cs = [makeCast({ id: 'a', actionId: 1, timestamp: 0 })]
    const result = findResourceExhaustedCasts(cs, new Map([[1, action]]), registry)
    expect(result).toEqual([])
  })

  it('不同 playerId 的 cast 各有独立池', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const cs = [
      makeCast({ id: 'a', actionId: 1, timestamp: 0, playerId: 10 }),
      makeCast({ id: 'b', actionId: 1, timestamp: 10, playerId: 20 }),
    ]
    const result = findResourceExhaustedCasts(cs, new Map([[1, action]]), syntheticRegistry)
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2：运行测试验证 fail**

Run: `pnpm test:run src/utils/resource/validator.test.ts`
Expected: FAIL（模块 `./validator` 不存在）

### Task 3.2：实现 `findResourceExhaustedCasts`

**Files:**

- Create: `src/utils/resource/validator.ts`

- [ ] **Step 1：写实现**

```typescript
/**
 * 资源池合法性校验
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 */

import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { ResourceDefinition, ResourceExhaustion } from '@/types/resource'
import { deriveResourceEvents } from './compute'

/**
 * 合成 `__cd__:${actionId}` 资源池定义。
 * 只在查到不存在 registry[resourceId] 且 id 以 '__cd__:' 开头时返回。
 */
function syntheticCdDef(resourceId: string, actionCd: number): ResourceDefinition {
  return {
    id: resourceId,
    name: `Synthetic CD ${resourceId}`,
    job: 'SCH', // 合成池 job 无意义，随便填
    initial: 1,
    max: 1,
    regen: { interval: actionCd, amount: 1 },
  }
}

/**
 * 返回所有因资源不足被判非法的 cast。
 *
 * @param excludeId 拖拽预览：排除正被拖动的 cast 重算。
 */
export function findResourceExhaustedCasts(
  castEvents: CastEvent[],
  actions: Map<number, MitigationAction>,
  registry: Record<string, ResourceDefinition>,
  excludeId?: string
): ResourceExhaustion[] {
  const filteredCasts = excludeId ? castEvents.filter(ce => ce.id !== excludeId) : castEvents
  const grouped = deriveResourceEvents(filteredCasts, actions)
  const exhaustions: ResourceExhaustion[] = []

  for (const [resourceKey, events] of grouped.entries()) {
    if (events.length === 0) continue
    const resourceId = events[0].resourceId
    let def = registry[resourceId]
    if (!def && resourceId.startsWith('__cd__:')) {
      const actionId = Number(resourceId.slice('__cd__:'.length))
      const action = actions.get(actionId)
      if (!action) continue
      def = syntheticCdDef(resourceId, action.cooldown)
    }
    if (!def) continue

    // 沿事件遍历，在每个 delta<0 事件应用前检查 amount < |delta|
    let amount = def.initial
    const pending: number[] = []
    const firePendingUpTo = (t: number) => {
      while (pending.length > 0 && pending[0] <= t) {
        pending.shift()
        if (def.regen) amount = Math.min(amount + def.regen.amount, def.max)
      }
    }

    for (const ev of events) {
      firePendingUpTo(ev.timestamp)
      if (ev.delta < 0 && ev.required) {
        const threshold = -ev.delta
        if (amount < threshold) {
          exhaustions.push({
            castEventId: ev.castEventId,
            resourceKey,
            resourceId,
            playerId: ev.playerId,
          })
        }
      }
      amount = Math.min(amount + ev.delta, def.max)
      if (ev.delta < 0 && def.regen) {
        const count = -ev.delta
        for (let k = 0; k < count; k++) {
          pending.push(ev.timestamp + def.regen.interval)
        }
      }
    }
  }

  return exhaustions
}
```

- [ ] **Step 2：运行测试验证 pass**

Run: `pnpm test:run src/utils/resource/validator.test.ts`
Expected: 6 passing

### Task 3.3：`resourceLegalIntervals` 写测试

**Files:**

- Create: `src/utils/resource/legalIntervals.test.ts`

- [ ] **Step 1：写测试文件**

```typescript
import { describe, it, expect } from 'vitest'
import { resourceLegalIntervals } from './legalIntervals'
import { deriveResourceEvents } from './compute'
import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { ResourceDefinition } from '@/types/resource'

const INF = Number.POSITIVE_INFINITY
const NEG_INF = Number.NEGATIVE_INFINITY

function makeAction(partial: Partial<MitigationAction> & { id: number }): MitigationAction {
  return {
    name: 'A',
    icon: '',
    jobs: [] as unknown as MitigationAction['jobs'],
    category: ['partywide'],
    duration: 0,
    cooldown: 60,
    ...partial,
  } as MitigationAction
}

function makeCast(partial: Partial<CastEvent> & { id: string; actionId: number }): CastEvent {
  return { playerId: 10, timestamp: 0, ...partial } as CastEvent
}

describe('resourceLegalIntervals — 单充能 __cd__ 场景', () => {
  it('无 cast：legal = (-∞, +∞)', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const events = deriveResourceEvents([], new Map([[1, action]]))
    const intervals = resourceLegalIntervals(action, 10, events, {})
    expect(intervals).toEqual([{ from: NEG_INF, to: INF }])
  })

  it('已有 cast @ t=90 (cd=60) → forbid = (30, 150)，legal = (-∞, 30] ∪ [150, +∞)', () => {
    // 等价于原 cooldownAvailable 对单充能的行为（由 TIME_EPS 吸收端点差异）
    const action = makeAction({ id: 1, cooldown: 60 })
    const events = deriveResourceEvents(
      [makeCast({ id: 'c1', actionId: 1, timestamp: 90 })],
      new Map([[1, action]])
    )
    const intervals = resourceLegalIntervals(action, 10, events, {})
    // forbid = self-forbid [90, 150) ∪ downstream-forbid (30, 90) = (30, 150)
    // legal = (-∞, 30] ∪ [150, +∞)
    expect(intervals).toEqual([
      { from: NEG_INF, to: 30 },
      { from: 150, to: INF },
    ])
  })
})

describe('resourceLegalIntervals — 多充能 drk:oblation 场景', () => {
  const oblation: ResourceDefinition = {
    id: 'drk:oblation',
    name: '献奉充能',
    job: 'DRK',
    initial: 2,
    max: 2,
    regen: { interval: 60, amount: 1 },
  }
  const registry = { 'drk:oblation': oblation }
  const xianfeng = makeAction({
    id: 25754,
    cooldown: 60,
    resourceEffects: [{ resourceId: 'drk:oblation', delta: -1 }],
  })

  it('单 cast @ t=0（amount_after=1）：下游 M=1 不透支，自耗尽 t∈∅ → legal 全时间', () => {
    const events = deriveResourceEvents(
      [makeCast({ id: '1', actionId: 25754, timestamp: 0 })],
      new Map([[25754, xianfeng]])
    )
    const intervals = resourceLegalIntervals(xianfeng, 10, events, registry)
    // 自耗尽 forbid: amount(t) < 1 的时段。amount 轨迹 [−∞,0)=2, [0,∞)=1 → 永不 <1
    // 下游 t=0 cast M = amountBefore(0) - 1 = 2-1 = 1 ≥ threshold(1) → 不透支
    expect(intervals).toEqual([{ from: NEG_INF, to: INF }])
  })

  it('双 cast @ t=0, t=30（amount 轨迹 2/1/0/1/2）：shadow = (−30, 60)', () => {
    const events = deriveResourceEvents(
      [
        makeCast({ id: '1', actionId: 25754, timestamp: 0 }),
        makeCast({ id: '2', actionId: 25754, timestamp: 30 }),
      ],
      new Map([[25754, xianfeng]])
    )
    const intervals = resourceLegalIntervals(xianfeng, 10, events, registry)
    // 自耗尽 forbid: amount<1 的 [30, 60)
    // 下游 t=0 M=1 → 不透支；下游 t=30 M=0 → forbid (30-60, 30) = (-30, 30)
    // union = (-30, 60)；legal = (-∞, -30] ∪ [60, +∞)
    expect(intervals).toEqual([
      { from: NEG_INF, to: -30 },
      { from: 60, to: INF },
    ])
  })
})

describe('resourceLegalIntervals — 无 regen 场景', () => {
  const customPool: ResourceDefinition = {
    id: 'x:no-regen',
    name: 'X',
    job: 'SCH',
    initial: 2,
    max: 2,
    // 无 regen
  }
  const registry = { 'x:no-regen': customPool }
  const consumer = makeAction({
    id: 1,
    cooldown: 0,
    resourceEffects: [{ resourceId: 'x:no-regen', delta: -1 }],
  })

  it('下游 M=0 → forbid (−∞, t_C)（无 regen 窗口延到 −∞）', () => {
    const events = deriveResourceEvents(
      [
        makeCast({ id: '1', actionId: 1, timestamp: 0 }),
        makeCast({ id: '2', actionId: 1, timestamp: 10 }),
      ],
      new Map([[1, consumer]])
    )
    const intervals = resourceLegalIntervals(consumer, 10, events, registry)
    // 轨迹：[−∞,0)=2, [0,10)=1, [10,∞)=0（无 regen）
    // 自耗尽 forbid: [10, ∞)
    // 下游 t=0 M=1 → 不透支；下游 t=10 M=0 → forbid (−∞, 10)
    // union = (−∞, ∞)；legal = ∅
    expect(intervals).toEqual([])
  })
})

describe('resourceLegalIntervals — 产出型 action', () => {
  it('只产出无消耗：无自耗尽 + 无下游透支 → legal 全时间', () => {
    const action = makeAction({
      id: 1,
      cooldown: 120,
      resourceEffects: [{ resourceId: 'pool', delta: +2 }],
    })
    const pool: ResourceDefinition = {
      id: 'pool',
      name: 'p',
      job: 'SCH',
      initial: 0,
      max: 4,
    }
    const events = deriveResourceEvents(
      [makeCast({ id: '1', actionId: 1, timestamp: 10 })],
      new Map([[1, action]])
    )
    // 纯产出 → 合成 __cd__:1 消耗（每 120s 一次），受 __cd__ forbid
    // pool:+2 不贡献 forbid
    const intervals = resourceLegalIntervals(action, 10, events, { pool })
    // forbid by __cd__:1 = (10-120, 10+120) = (-110, 130)
    expect(intervals).toEqual([
      { from: NEG_INF, to: -110 },
      { from: 130, to: INF },
    ])
  })
})
```

- [ ] **Step 2：运行测试验证 fail**

Run: `pnpm test:run src/utils/resource/legalIntervals.test.ts`
Expected: FAIL（模块不存在）

### Task 3.4：实现 `resourceLegalIntervals`

**Files:**

- Create: `src/utils/resource/legalIntervals.ts`

- [ ] **Step 1：写实现**

```typescript
/**
 * 资源池合法区间计算（shadow 来源）
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 */

import type { MitigationAction } from '@/types/mitigation'
import type {
  ResourceDefinition,
  ResourceEffect,
  ResourceEvent,
  ResourceSnapshot,
} from '@/types/resource'
import type { Interval } from '@/utils/placement/types'
import { complement, intersect, mergeOverlapping, sortIntervals } from '@/utils/placement/intervals'
import { computeResourceTrace } from './compute'

const INF = Number.POSITIVE_INFINITY
const NEG_INF = Number.NEGATIVE_INFINITY

function syntheticCdDef(resourceId: string, actionCd: number): ResourceDefinition {
  return {
    id: resourceId,
    name: `Synthetic CD ${resourceId}`,
    job: 'SCH',
    initial: 1,
    max: 1,
    regen: { interval: actionCd, amount: 1 },
  }
}

function resolveDef(
  resourceId: string,
  registry: Record<string, ResourceDefinition>,
  actionForSynthCd: MitigationAction
): ResourceDefinition | null {
  const explicit = registry[resourceId]
  if (explicit) return explicit
  if (resourceId.startsWith('__cd__:')) {
    return syntheticCdDef(resourceId, actionForSynthCd.cooldown)
  }
  return null
}

/**
 * 单个 ResourceEffect 对应的 forbid 区间集合（自耗尽 ∪ 下游透支）。
 * events 是该 (playerId, resourceId) 对的全部事件（含这个 action 与其他 consumer 的）。
 */
function forbidForEffect(
  effect: ResourceEffect,
  events: ResourceEvent[],
  def: ResourceDefinition
): Interval[] {
  if (effect.delta >= 0) return [] // 产出不贡献 forbid
  const threshold = -effect.delta

  const trace = computeResourceTrace(def, events)

  // 自耗尽段：枚举"amount 跌到 <threshold"的持续时段
  // amount 函数是分段常量，分段点是 events[i].timestamp 和 pendingAfter 中的 refill 时刻
  const selfForbid: Interval[] = []
  // 构建分段：(t, amount_at_t_after_all_events_and_refills_applied)
  // 方法：按时间合并事件点 + 所有 pending refill 时刻，线性扫描记录 amount
  const transitions: Array<{ t: number; amount: number }> = []
  // 初始段 [−∞, events[0].timestamp)：amount = def.initial
  transitions.push({ t: NEG_INF, amount: def.initial })
  for (let i = 0; i < events.length; i++) {
    const snap = trace[i]
    const ev = events[i]
    // 事件发生瞬间 amount 变为 amountAfter（边界：[ev.timestamp, next) 段 = amountAfter）
    transitions.push({ t: ev.timestamp, amount: snap.amountAfter })
    // 此事件后到下一事件前可能有 refill 触发
    const nextEventTs = i + 1 < events.length ? events[i + 1].timestamp : INF
    // 计算在 [ev.timestamp, nextEventTs) 区间内 pending 到点的瞬间
    // pendingAfter 是应用此事件后的 refill 队列；升序；只关心 <= nextEventTs 的部分
    let currentAmount = snap.amountAfter
    for (const refillTime of snap.pendingAfter) {
      if (refillTime >= nextEventTs) break
      if (!def.regen) break
      currentAmount = Math.min(currentAmount + def.regen.amount, def.max)
      transitions.push({ t: refillTime, amount: currentAmount })
    }
  }

  // 把 transitions 合成 [from, to) 区段，amount < threshold 的加入 selfForbid
  for (let i = 0; i < transitions.length; i++) {
    const { t, amount } = transitions[i]
    if (amount < threshold) {
      const next = i + 1 < transitions.length ? transitions[i + 1].t : INF
      selfForbid.push({ from: t, to: next })
    }
  }

  // 下游透支段：对每条 delta<0 事件 C，M_C = amountBefore(C) - |delta_C|
  // 若 M_C < threshold → 新 cast 窗口 (C.timestamp - interval, C.timestamp) 进 forbid
  // 无 regen 时窗口延到 −∞
  const downstreamForbid: Interval[] = []
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (ev.delta >= 0) continue
    const M = trace[i].amountBefore - -ev.delta
    if (M < threshold) {
      const from = def.regen ? ev.timestamp - def.regen.interval : NEG_INF
      downstreamForbid.push({ from, to: ev.timestamp })
    }
  }

  return mergeOverlapping(sortIntervals([...selfForbid, ...downstreamForbid]))
}

/**
 * 返回 action 对某 player 的 resource-legal 区间集合。
 *
 * 对每个 resourceEffect（含合成 `__cd__`）单独算 forbid，最后取 complement 的交集。
 */
export function resourceLegalIntervals(
  action: MitigationAction,
  playerId: number,
  resourceEventsByKey: Map<string, ResourceEvent[]>,
  registry: Record<string, ResourceDefinition>
): Interval[] {
  // 合成 effect 列表（与 deriveResourceEvents 对齐）
  const hasConsumer = !!action.resourceEffects?.some(e => e.delta < 0)
  const effects: ResourceEffect[] = hasConsumer
    ? (action.resourceEffects ?? [])
    : [
        { resourceId: `__cd__:${action.id}`, delta: -1, required: true },
        ...(action.resourceEffects ?? []),
      ]

  let legal: Interval[] = [{ from: NEG_INF, to: INF }]
  for (const eff of effects) {
    const def = resolveDef(eff.resourceId, registry, action)
    if (!def) continue
    const events = resourceEventsByKey.get(`${playerId}:${eff.resourceId}`) ?? []
    const forbid = forbidForEffect(eff, events, def)
    const thisLegal = complement(forbid)
    legal = intersect(legal, thisLegal)
  }
  return legal
}
```

- [ ] **Step 2：运行测试验证 pass**

Run: `pnpm test:run src/utils/resource/legalIntervals.test.ts`
Expected: 5 passing

### Task 3.5：lint + tsc 收尾

- [ ] **Step 1：**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 零 error

### Task 3.6：阶段 3 commit

- [ ] **Step 1：**

```bash
git add src/utils/resource/validator.ts src/utils/resource/validator.test.ts \
        src/utils/resource/legalIntervals.ts src/utils/resource/legalIntervals.test.ts
git commit -m "feat(resource): validator + legalIntervals（纯新增，未接调用方）"
```

---

## 阶段 4 · placement engine 解耦（破坏性手术）

### Task 4.1：更新 `InvalidReason` + `InvalidCastEvent`

**Files:**

- Modify: `src/utils/placement/types.ts`

- [ ] **Step 1：改类型**

把 `src/utils/placement/types.ts:46` 的：

```typescript
export type InvalidReason = 'placement_lost' | 'cooldown_conflict' | 'both'
```

改成：

```typescript
export type InvalidReason = 'placement_lost' | 'resource_exhausted' | 'both'
```

在 `src/utils/placement/types.ts:48`（`InvalidCastEvent` interface 内）把：

```typescript
export interface InvalidCastEvent {
  castEvent: CastEvent
  reason: InvalidReason
}
```

改成：

```typescript
export interface InvalidCastEvent {
  castEvent: CastEvent
  reason: InvalidReason
  /**
   * reason === 'resource_exhausted' | 'both' 时填；指向第一个耗尽的资源 id。
   * UI 用它查 `RESOURCE_REGISTRY[resourceId]?.max` 决定文案（max=1 → '冷却中'；max>1 → '层数不足'）。
   */
  resourceId?: string
}
```

- [ ] **Step 2：tsc 验证**

Run: `pnpm exec tsc --noEmit`
Expected: 会冒出一批 TS error（`'cooldown_conflict'` 字面量引用处、消费方 UI 处）——这是预期。下面几步修它们。

### Task 4.2：重写 `engine.ts` 的 `findInvalidCastEvents` + `getValidIntervals`

**Files:**

- Modify: `src/utils/placement/engine.ts`

- [ ] **Step 1：在文件顶部加 import**

在 `src/utils/placement/engine.ts:12` 的 import 块末尾加：

```typescript
import { deriveResourceEvents } from '@/utils/resource/compute'
import { findResourceExhaustedCasts } from '@/utils/resource/validator'
import { resourceLegalIntervals } from '@/utils/resource/legalIntervals'
import { RESOURCE_REGISTRY } from '@/data/resources'
```

在 `PlacementEngineInput` interface（`engine.ts:14-18`）上方不动；`createPlacementEngine` 函数开头追加一步预派生 resource events（放在 `const defaultTimeline = simulate(castEvents).statusTimelineByPlayer` 之后）：

```typescript
const resourceEventsByKey = deriveResourceEvents(castEvents, actions)
```

- [ ] **Step 2：删除 `cooldownAvailable` 函数（engine.ts:56-78）**

整段删除。

- [ ] **Step 3：重写 `getValidIntervals`（engine.ts:80-91）**

替换为：

```typescript
function getValidIntervals(
  action: MitigationAction,
  playerId: number,
  excludeId?: string
): Interval[] {
  const ctx = buildContext(action, playerId, excludeId)
  const placementIntervals = action.placement
    ? action.placement.validIntervals(ctx)
    : [{ from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY }]
  const effectiveResourceEvents = excludeId
    ? deriveResourceEvents(
        castEvents.filter(e => e.id !== excludeId),
        actions
      )
    : resourceEventsByKey
  const resourceIntervals = resourceLegalIntervals(
    action,
    playerId,
    effectiveResourceEvents,
    RESOURCE_REGISTRY
  )
  return intersect(placementIntervals, resourceIntervals)
}
```

- [ ] **Step 4：重写 `findInvalidCastEvents`（engine.ts:178-217）**

替换整段（从 `function findInvalidCastEvents` 到它返回 `return result`）为：

```typescript
function findInvalidCastEvents(excludeId?: string): InvalidCastEvent[] {
  const effectiveEvents = effectiveCastEvents(excludeId).filter(e => e.id !== excludeId)

  // 1. placement 层失效
  const placementLost = new Map<string, boolean>()
  for (const castEvent of effectiveEvents) {
    const action = actions.get(castEvent.actionId)
    if (!action) continue
    const t = castEvent.timestamp
    const ctx = buildContext(action, castEvent.playerId, excludeId, castEvent)
    const ok =
      !action.placement ||
      action.placement.validIntervals(ctx).some(i => i.from - TIME_EPS <= t && t <= i.to + TIME_EPS)
    if (!ok) placementLost.set(castEvent.id, true)
  }

  // 2. resource 层失效
  const resourceExhausted = findResourceExhaustedCasts(
    castEvents,
    actions,
    RESOURCE_REGISTRY,
    excludeId
  )
  const exhaustedMap = new Map<string, string>()
  for (const ex of resourceExhausted) {
    // 一次 cast 可能命中多个资源，保留第一个
    if (!exhaustedMap.has(ex.castEventId)) exhaustedMap.set(ex.castEventId, ex.resourceId)
  }

  // 3. 合并
  const result: InvalidCastEvent[] = []
  for (const castEvent of effectiveEvents) {
    const pLost = placementLost.has(castEvent.id)
    const rExhausted = exhaustedMap.has(castEvent.id)
    if (!pLost && !rExhausted) continue
    const reason: InvalidReason =
      pLost && rExhausted ? 'both' : pLost ? 'placement_lost' : 'resource_exhausted'
    const entry: InvalidCastEvent = { castEvent, reason }
    if (rExhausted) entry.resourceId = exhaustedMap.get(castEvent.id)
    result.push(entry)
  }
  return result
}
```

- [ ] **Step 5：tsc 验证 engine.ts 干净**

Run: `pnpm exec tsc --noEmit`
Expected: `engine.ts` 内 0 error；测试文件 + UI 层仍有 `'cooldown_conflict'` 引用的 error —— 下面修它们。

### Task 4.3：给 engine 添加 `cdBarEndFor` 方法（先空实现占位）

**Files:**

- Modify: `src/utils/placement/engine.ts`
- Modify: `src/utils/placement/types.ts`

- [ ] **Step 1：`PlacementEngine` interface 增加方法签名**

在 `src/utils/placement/types.ts` 的 `PlacementEngine` interface 末尾（`findInvalidCastEvents` 声明之后）加：

```typescript
  /**
   * 返回指定 cast 的蓝色 CD 条右端（秒）。null = 不画；Infinity = 时间轴内无恢复。
   * 不接受 excludeId——永远以 engine 构造时的完整 castEvents 计算。
   */
  cdBarEndFor(castEventId: string): number | null
```

- [ ] **Step 2：engine.ts 里加一个占位实现**

在 `src/utils/placement/engine.ts` 的返回对象（`return { ... }` 块，目前 219-226 行）里加：

```typescript
    cdBarEndFor: (_castEventId: string) => null, // 阶段 6 补真实实现
```

- [ ] **Step 3：tsc 验证**

Run: `pnpm exec tsc --noEmit`
Expected: engine 相关 0 error

### Task 4.4：更新 `engine.test.ts`（cooldown_conflict → resource_exhausted）

**Files:**

- Modify: `src/utils/placement/engine.test.ts`

- [ ] **Step 1：全局搜替换字符串字面量**

在 `engine.test.ts` 内，Grep 定位所有 `'cooldown_conflict'` 字面量，逐一换成 `'resource_exhausted'`。

具体位置（基于提交时的行号，以实际搜索为准）：

- `src/utils/placement/engine.test.ts:165`（`it('findInvalidCastEvents: 区分 placement_lost / cooldown_conflict / both'`）→ 描述里改 `cooldown_conflict` 为 `resource_exhausted`
- `src/utils/placement/engine.test.ts:185`：`expect(byId.get('bad3')).toBe('cooldown_conflict')` → 改 `'resource_exhausted'`
- `src/utils/placement/engine.test.ts:216`：`expect(r.reason).not.toBe('cooldown_conflict')` → 改 `'resource_exhausted'`
- `src/utils/placement/engine.test.ts:221`：`it('findInvalidCastEvents: 紧贴边界带浮点误差时不应误判 cooldown_conflict'` → 改 `resource_exhausted`

执行:

```bash
pnpm exec tsc --noEmit
```

Expected: `engine.test.ts` 相关 0 error（测试尚未运行）

- [ ] **Step 2：运行测试**

Run: `pnpm test:run src/utils/placement/engine.test.ts`
Expected: PASS（大部分用例是单 actionId 场景，走新合成 **cd** 路径数学等价）

### Task 4.5：更新 UI 文案（CastEventIcon + Timeline/index）

**Files:**

- Modify: `src/components/Timeline/CastEventIcon.tsx`
- Modify: `src/components/Timeline/index.tsx`

- [ ] **Step 1：检查 CastEventIcon 有无硬编码文案**

Run: `pnpm exec grep -rn 'CD 冲突\|cooldown_conflict' src/components/Timeline/`
Expected: 若有匹配，按下面规则改；若只有注释匹配（如 `engine.ts:121` 的函数注释），不需改代码。

- [ ] **Step 2：CastEventIcon 加接收 `resourceId` 的准备**

在 `src/components/Timeline/CastEventIcon.tsx:14-36` 的 `CastEventIconProps` 内、`invalidReason?: InvalidReason | null` 下方加：

```typescript
  /** reason === 'resource_exhausted' | 'both' 时携带：首个失败的 resourceId（UI 用来查 max） */
  invalidResourceId?: string | null
```

（真正消费 `resourceId` → 文案的逻辑在阶段 6 加进渲染层；本步仅打通 prop 通路。）

- [ ] **Step 3：Timeline/index.tsx 把 resourceId 一起塞进 invalid map**

在 `src/components/Timeline/index.tsx:196-200`（`invalidCastEventMap` 的 useMemo）处：

旧：

```typescript
const invalidCastEventMap = useMemo(() => {
  if (!engine) return new Map<string, InvalidReason>()
  const invalid = engine.findInvalidCastEvents(draggingId ?? undefined)
  return new Map(invalid.map(r => [r.castEvent.id, r.reason]))
}, [engine, draggingId])
```

新：

```typescript
const invalidCastEventMap = useMemo(() => {
  if (!engine) return new Map<string, { reason: InvalidReason; resourceId?: string }>()
  const invalid = engine.findInvalidCastEvents(draggingId ?? undefined)
  return new Map(invalid.map(r => [r.castEvent.id, { reason: r.reason, resourceId: r.resourceId }]))
}, [engine, draggingId])
```

搜索该 map 消费方（Grep `invalidCastEventMap`）并更新：

- `src/components/Timeline/SkillTracksCanvas.tsx` 里 `invalidCastEventMap?: Map<string, InvalidReason>` 的类型改为 `Map<string, { reason: InvalidReason; resourceId?: string }>`
- 消费处 `invalidCastEventMap?.get(castEvent.id)` 从 `InvalidReason | undefined` 变为对象，渲染时取 `.reason`

具体消费位置在 `SkillTracksCanvas.tsx:570` 附近：

旧：

```typescript
invalidReason={invalidCastEventMap?.get(castEvent.id) ?? null}
```

新：

```typescript
invalidReason={invalidCastEventMap?.get(castEvent.id)?.reason ?? null}
invalidResourceId={invalidCastEventMap?.get(castEvent.id)?.resourceId ?? null}
```

- [ ] **Step 4：tsc 验证**

Run: `pnpm exec tsc --noEmit`
Expected: 0 error

### Task 4.6：跑全量测试

- [ ] **Step 1：**

Run: `pnpm test:run`
Expected: 全 PASS（含 integration.test.ts 意气/降临场景）。若有 fail：

- `engine.test.ts` 中涉及跨 actionId 同 trackGroup CD 冲突的测试若 fail，视情形改为"新语义下合法"或删除该用例（trackGroup 解耦的设计决策已在 spec D3 敲定）
- integration.test.ts 若 fail（目前只测 placement，应无影响）

- [ ] **Step 2：lint**

Run: `pnpm lint`
Expected: 0 error / 0 warning

### Task 4.7：阶段 4 commit

- [ ] **Step 1：**

```bash
git add src/utils/placement/types.ts src/utils/placement/engine.ts \
        src/utils/placement/engine.test.ts \
        src/components/Timeline/CastEventIcon.tsx \
        src/components/Timeline/index.tsx \
        src/components/Timeline/SkillTracksCanvas.tsx
git commit -m "refactor(placement): 删 cooldownAvailable，CD 冲突走新资源模型"
```

---

## 阶段 5 · 数据迁移（慰藉 + 献奉）

### Task 5.1：registry 加 `sch:consolation` + `drk:oblation`

**Files:**

- Modify: `src/data/resources.ts`

- [ ] **Step 1：填充 registry**

替换 `src/data/resources.ts` 的 `RESOURCE_REGISTRY` 为：

```typescript
export const RESOURCE_REGISTRY: Record<string, ResourceDefinition> = {
  'sch:consolation': {
    id: 'sch:consolation',
    name: '慰藉充能',
    job: 'SCH',
    initial: 2, // 战斗开始满充能
    max: 2,
    regen: { interval: 30, amount: 1 }, // 自充能 30s/层
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
```

- [ ] **Step 2：tsc 验证**

Run: `pnpm exec tsc --noEmit`
Expected: 0 error

### Task 5.2：迁移炽天召唤 (16545)

**Files:**

- Modify: `src/data/mitigationActions.ts`

- [ ] **Step 1：替换炽天 action 定义**

在 `src/data/mitigationActions.ts:499-511` 把：

```typescript
{
  id: 16545,
  name: '炽天召唤',
  icon: '/i/002000/002850.png',
  jobs: ['SCH'],
  category: ['partywide', 'percentage', 'shield'],
  duration: 22,
  cooldown: 120,
  executor: ctx => {
    const partyState = createBuffExecutor(3095, 22)(ctx)
    return createBuffExecutor(20016546, 22, { stack: 2 })({ ...ctx, partyState }) // 假 buff，模拟慰藉积蓄
  },
},
```

改成：

```typescript
{
  id: 16545,
  name: '炽天召唤',
  icon: '/i/002000/002850.png',
  jobs: ['SCH'],
  category: ['partywide', 'percentage', 'shield'],
  duration: 22,
  cooldown: 120,
  executor: createBuffExecutor(3095, 22), // 只造炽天真 buff；慰藉充能由 sch:consolation 自行 regen
},
```

### Task 5.3：迁移慰藉 (16546)

**Files:**

- Modify: `src/data/mitigationActions.ts`

- [ ] **Step 1：替换慰藉 action 定义**

在 `src/data/mitigationActions.ts:513-541` 把：

```typescript
{
  id: 16546,
  name: '慰藉',
  icon: '/i/002000/002851.png',
  jobs: ['SCH'],
  category: ['partywide', 'shield'],
  duration: 30,
  cooldown: 1,
  //executor: createShieldExecutor(1917, 30),
  executor: ctx => {
    let partyState = createShieldExecutor(1917, 30)(ctx)
    const charge = partyState.statuses.find(s => s.statusId === 20016546)
    if (charge) {
      const newStack = (charge.stack ?? 1) - 1
      partyState =
        newStack <= 0
          ? { ...partyState, statuses: partyState.statuses.filter(s => s !== charge) }
          : {
              ...partyState,
              statuses: partyState.statuses.map(s =>
                s === charge ? { ...s, stack: newStack } : s
              ),
            }
    }
    return partyState
  },
  placement: whileStatus(20016546),
  statDataEntries: [{ type: 'shield', key: 1917 }],
},
```

改成：

```typescript
{
  id: 16546,
  name: '慰藉',
  icon: '/i/002000/002851.png',
  jobs: ['SCH'],
  category: ['partywide', 'shield'],
  duration: 30,
  cooldown: 30, // 真实单层回充时间；实际 gating 交给 sch:consolation + whileStatus(3095)
  executor: createShieldExecutor(1917, 30),
  placement: whileStatus(3095), // 炽天真 buff 窗口
  resourceEffects: [{ resourceId: 'sch:consolation', delta: -1 }],
  statDataEntries: [{ type: 'shield', key: 1917 }],
},
```

### Task 5.4：迁移献奉 (25754)

**Files:**

- Modify: `src/data/mitigationActions.ts`

- [ ] **Step 1：给献奉加 resourceEffects**

在 `src/data/mitigationActions.ts:238-247` 把：

```typescript
{
  id: 25754,
  name: '献奉',
  icon: '/i/003000/003089.png',
  jobs: ['DRK'],
  category: ['self', 'target', 'percentage'],
  duration: 7,
  cooldown: 60,
  executor: createBuffExecutor(2682, 7),
},
```

改成：

```typescript
{
  id: 25754,
  name: '献奉',
  icon: '/i/003000/003089.png',
  jobs: ['DRK'],
  category: ['self', 'target', 'percentage'],
  duration: 7,
  cooldown: 60,
  executor: createBuffExecutor(2682, 7),
  resourceEffects: [{ resourceId: 'drk:oblation', delta: -1 }],
},
```

- [ ] **Step 2：tsc 验证**

Run: `pnpm exec tsc --noEmit`
Expected: 0 error

### Task 5.5：删除 `BuffExecutorOptions.stack` 字段

**Files:**

- Modify: `src/executors/createBuffExecutor.ts`

- [ ] **Step 1：确认无其他消费者**

Run: `pnpm exec grep -rn '.stack\s*:\s*[0-9]' src/data/`
Expected: 0 个匹配（炽天已删、无其他引用）

Run: `pnpm exec grep -rn 'BuffExecutorOptions' src/`
Expected: 只有 `createBuffExecutor.ts` 自身

- [ ] **Step 2：删 `stack` 字段**

在 `src/executors/createBuffExecutor.ts:19-21` 把：

```typescript
  /** 层数：buff 耗尽后会减少层数并重置，默认为 1 */
  stack?: number
}
```

改成：

```typescript
}
```

然后把 `src/executors/createBuffExecutor.ts:48` 的：

```typescript
      stack: options?.stack ?? 1,
```

改成：

```typescript
      stack: 1,
```

- [ ] **Step 3：确认无 `20016546` 残留**

Run: `pnpm exec grep -rn '20016546' src/`
Expected: 0 个匹配（spec 步骤 4 的目标之一）

### Task 5.6：跑全量测试

- [ ] **Step 1：**

Run: `pnpm test:run`
Expected: 全 PASS

若有 fail：

- `mitigationCalculator` 测试触及学者慰藉数值的，若发现差异：确认 shield amount 未变（慰藉消费 executor 改成纯 createShieldExecutor，不再 fake buff，数值逻辑应 byte-identical）
- statDataUtils 对慰藉 1917 盾值的测试不动

### Task 5.7：手动浏览器验证

- [ ] **Step 1：启动 dev server（如用户尚未启动）**

Run: `pnpm dev`（让用户启动；agent 不主动启）

- [ ] **Step 2：构造 SCH 时间轴手动过以下断言**

用户操作：

1. 空白时间轴 + SCH 1 人 composition
2. 放 t=0 慰藉 → 期望：红框（`placement_lost` + 无炽天 buff，反向透支也触发）
3. 放 t=10 炽天 → 期望：合法
4. 放 t=12 + t=15 + t=18 慰藉（3 连）→ 期望：第 3 条红框（resource_exhausted）
5. 放 t=50 慰藉（炽天 buff 已过 t=32）→ 期望：红框（placement_lost）

如有异常，定位到步骤 5.2–5.5 某一步回退再查。

- [ ] **Step 3：构造 DRK 时间轴验证献奉**

用户操作：

1. DRK 1 人
2. t=0 献奉（2→1）、t=30 献奉（1→0）→ 两条合法
3. t=70 献奉：查 amount 轨迹应在 t=60 有 refill@60（0→1）、t=70 amount=1，消耗合法
4. t=85 献奉：amount(85)=0（refill@90 未到）→ 红框
5. 拖动 t=85 献奉到 t=90：合法（refill@90 命中）

### Task 5.8：阶段 5 commit

- [ ] **Step 1：**

```bash
git add src/data/resources.ts src/data/mitigationActions.ts src/executors/createBuffExecutor.ts
git commit -m "feat(data): 学者慰藉/炽天 + 骑士献奉迁移到资源模型，废弃假 buff 20016546"
```

---

## 阶段 6 · CD 条渲染

### Task 6.1：`computeCdBarEnd` 写测试

**Files:**

- Create: `src/utils/resource/cdBar.test.ts`

- [ ] **Step 1：写测试文件**

```typescript
import { describe, it, expect } from 'vitest'
import { computeCdBarEnd } from './cdBar'
import { deriveResourceEvents } from './compute'
import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { ResourceDefinition } from '@/types/resource'

function makeAction(partial: Partial<MitigationAction> & { id: number }): MitigationAction {
  return {
    name: 'A',
    icon: '',
    jobs: [] as unknown as MitigationAction['jobs'],
    category: ['partywide'],
    duration: 0,
    cooldown: 60,
    ...partial,
  } as MitigationAction
}

function makeCast(partial: Partial<CastEvent> & { id: string; actionId: number }): CastEvent {
  return { playerId: 10, timestamp: 0, ...partial } as CastEvent
}

describe('computeCdBarEnd — 单充能（合成 __cd__）', () => {
  it('每次 cast 都画蓝条，rawEnd = t + cd', () => {
    const action = makeAction({ id: 1, cooldown: 60 })
    const cast = makeCast({ id: 'c', actionId: 1, timestamp: 100 })
    const events = deriveResourceEvents([cast], new Map([[1, action]]))
    expect(computeCdBarEnd(action, cast, events, {})).toBe(160)
  })
})

describe('computeCdBarEnd — 多充能有 regen（献奉）', () => {
  const oblation: ResourceDefinition = {
    id: 'drk:oblation',
    name: '献奉充能',
    job: 'DRK',
    initial: 2,
    max: 2,
    regen: { interval: 60, amount: 1 },
  }
  const registry = { 'drk:oblation': oblation }
  const xianfeng = makeAction({
    id: 25754,
    cooldown: 60,
    resourceEffects: [{ resourceId: 'drk:oblation', delta: -1 }],
  })

  it('#1 cast 后仍有库存 → null（不画）', () => {
    const cs = [makeCast({ id: '1', actionId: 25754, timestamp: 0 })]
    const events = deriveResourceEvents(cs, new Map([[25754, xianfeng]]))
    expect(computeCdBarEnd(xianfeng, cs[0], events, registry)).toBeNull()
  })

  it('#2 cast 后打空 → rawEnd 是第一个恢复到 ≥1 的 refill 时刻', () => {
    // 献奉 t=0, t=30 连消 → t=30 后 amount=0，pending=[60, 90]
    // refill@60 把 amount 提回 1，rawEnd=60
    const cs = [
      makeCast({ id: '1', actionId: 25754, timestamp: 0 }),
      makeCast({ id: '2', actionId: 25754, timestamp: 30 }),
    ]
    const events = deriveResourceEvents(cs, new Map([[25754, xianfeng]]))
    expect(computeCdBarEnd(xianfeng, cs[1], events, registry)).toBe(60)
  })

  it('#3 cast 在 refill@60 fire 后打空 → rawEnd 是 refill@90', () => {
    // 献奉 t=0, t=30, t=70 → 第 3 条 cast 前 refill@60 已 fire (amount 0→1)
    // #3 消耗 1→0，pending=[90, 130]；rawEnd=90
    const cs = [
      makeCast({ id: '1', actionId: 25754, timestamp: 0 }),
      makeCast({ id: '2', actionId: 25754, timestamp: 30 }),
      makeCast({ id: '3', actionId: 25754, timestamp: 70 }),
    ]
    const events = deriveResourceEvents(cs, new Map([[25754, xianfeng]]))
    expect(computeCdBarEnd(xianfeng, cs[2], events, registry)).toBe(90)
  })
})

describe('computeCdBarEnd — 无 regen 后续产出恢复', () => {
  const pool: ResourceDefinition = {
    id: 'x:event-driven',
    name: 'X',
    job: 'SCH',
    initial: 0,
    max: 2,
    // 无 regen
  }
  const registry = { 'x:event-driven': pool }
  const producer = makeAction({
    id: 1,
    cooldown: 120,
    resourceEffects: [{ resourceId: 'x:event-driven', delta: +2 }],
  })
  const consumer = makeAction({
    id: 2,
    cooldown: 30,
    resourceEffects: [{ resourceId: 'x:event-driven', delta: -1 }],
  })

  it('打空 + 有下一个产出事件 → rawEnd = 产出时刻', () => {
    const cs = [
      makeCast({ id: 'p1', actionId: 1, timestamp: 120 }), // +2 → amount 2
      makeCast({ id: 'c1', actionId: 2, timestamp: 125 }), // -1 → amount 1
      makeCast({ id: 'c2', actionId: 2, timestamp: 130 }), // -1 → amount 0
      makeCast({ id: 'p2', actionId: 1, timestamp: 240 }), // +2
    ]
    const events = deriveResourceEvents(
      cs,
      new Map<number, MitigationAction>([
        [1, producer],
        [2, consumer],
      ])
    )
    // c2 amount_after=0，扫到 t=240 +2 → rawEnd=240
    expect(computeCdBarEnd(consumer, cs[2], events, registry)).toBe(240)
  })

  it('打空 + 无任何后续产出 → rawEnd = Infinity', () => {
    const cs = [
      makeCast({ id: 'p1', actionId: 1, timestamp: 120 }),
      makeCast({ id: 'c1', actionId: 2, timestamp: 125 }),
      makeCast({ id: 'c2', actionId: 2, timestamp: 130 }),
    ]
    const events = deriveResourceEvents(
      cs,
      new Map<number, MitigationAction>([
        [1, producer],
        [2, consumer],
      ])
    )
    expect(computeCdBarEnd(consumer, cs[2], events, registry)).toBe(Infinity)
  })
})
```

- [ ] **Step 2：运行测试验证 fail**

Run: `pnpm test:run src/utils/resource/cdBar.test.ts`
Expected: FAIL（模块 `./cdBar` 不存在）

### Task 6.2：实现 `computeCdBarEnd`

**Files:**

- Create: `src/utils/resource/cdBar.ts`

- [ ] **Step 1：写实现**

```typescript
/**
 * 蓝色 CD 条右端计算
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 */

import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { ResourceDefinition, ResourceEffect, ResourceEvent } from '@/types/resource'
import { computeResourceTrace } from './compute'

function syntheticCdDef(resourceId: string, actionCd: number): ResourceDefinition {
  return {
    id: resourceId,
    name: `Synthetic CD ${resourceId}`,
    job: 'SCH',
    initial: 1,
    max: 1,
    regen: { interval: actionCd, amount: 1 },
  }
}

function resolveDef(
  resourceId: string,
  registry: Record<string, ResourceDefinition>,
  action: MitigationAction
): ResourceDefinition | null {
  const explicit = registry[resourceId]
  if (explicit) return explicit
  if (resourceId.startsWith('__cd__:')) {
    return syntheticCdDef(resourceId, action.cooldown)
  }
  return null
}

/**
 * 返回 cast 的蓝条 rawEnd（秒）。null = 不画；Infinity = 时间轴内无恢复。
 *
 * 选取"第一条 delta<0 的 effect"作为代表（action 主消费者）。若 action 无消费者走合成 __cd__。
 */
export function computeCdBarEnd(
  action: MitigationAction,
  castEvent: CastEvent,
  resourceEventsByKey: Map<string, ResourceEvent[]>,
  registry: Record<string, ResourceDefinition>
): number | null {
  // 选代表 consume effect（同 deriveResourceEvents 的合成逻辑）
  const hasConsumer = !!action.resourceEffects?.some(e => e.delta < 0)
  const consume: ResourceEffect = hasConsumer
    ? action.resourceEffects!.find(e => e.delta < 0)!
    : { resourceId: `__cd__:${action.id}`, delta: -1, required: true }

  const def = resolveDef(consume.resourceId, registry, action)
  if (!def) return null

  const events = resourceEventsByKey.get(`${castEvent.playerId}:${consume.resourceId}`) ?? []
  const idx = events.findIndex(e => e.castEventId === castEvent.id)
  if (idx < 0) return null

  const trace = computeResourceTrace(def, events)
  const snap = trace[idx]
  const threshold = -consume.delta
  if (snap.amountAfter >= threshold) return null

  // 继续扫：合并 pending refills 和后续 ResourceEvents，时间升序，找 amount 恢复到 ≥threshold
  let amount = snap.amountAfter
  const pending = [...snap.pendingAfter]
  let nextEventIdx = idx + 1

  while (amount < threshold) {
    const nextPending = pending.length > 0 ? pending[0] : Infinity
    const nextEvent = nextEventIdx < events.length ? events[nextEventIdx].timestamp : Infinity
    if (nextPending === Infinity && nextEvent === Infinity) return Infinity

    if (nextPending <= nextEvent) {
      pending.shift()
      if (def.regen) amount = Math.min(amount + def.regen.amount, def.max)
      if (amount >= threshold) return nextPending
    } else {
      const ev = events[nextEventIdx]
      amount = Math.min(amount + ev.delta, def.max)
      if (ev.delta < 0 && def.regen) {
        const count = -ev.delta
        for (let k = 0; k < count; k++) pending.push(ev.timestamp + def.regen.interval)
        pending.sort((a, b) => a - b)
      }
      nextEventIdx++
      if (amount >= threshold) return ev.timestamp
    }
  }
  return null // 上面循环里必然 return，理论不可达
}
```

- [ ] **Step 2：运行测试验证 pass**

Run: `pnpm test:run src/utils/resource/cdBar.test.ts`
Expected: 6 passing

### Task 6.3：engine 挂 `cdBarEndFor`

**Files:**

- Modify: `src/utils/placement/engine.ts`

- [ ] **Step 1：加 import**

在 `src/utils/placement/engine.ts` 顶部 import 块加：

```typescript
import { computeCdBarEnd } from '@/utils/resource/cdBar'
```

- [ ] **Step 2：实现 cache 版 `cdBarEndFor`**

在 `createPlacementEngine` 内部（`trackGroupMembers` 那块上面即可）加一个 cache Map，并把之前占位的 `cdBarEndFor: (_castEventId) => null` 替换为真实实现：

```typescript
// 蓝条 rawEnd cache：key = castEventId。engine 生命周期内固定（castEvents 不变）。
const cdBarEndCache = new Map<string, number | null>()
const castEventById = new Map(castEvents.map(ce => [ce.id, ce]))

function cdBarEndFor(castEventId: string): number | null {
  if (cdBarEndCache.has(castEventId)) return cdBarEndCache.get(castEventId)!
  const ce = castEventById.get(castEventId)
  if (!ce) {
    cdBarEndCache.set(castEventId, null)
    return null
  }
  const action = actions.get(ce.actionId)
  if (!action) {
    cdBarEndCache.set(castEventId, null)
    return null
  }
  const end = computeCdBarEnd(action, ce, resourceEventsByKey, RESOURCE_REGISTRY)
  cdBarEndCache.set(castEventId, end)
  return end
}
```

然后在 `return { ... }` 块里把占位行 `cdBarEndFor: (_castEventId: string) => null` 改成 `cdBarEndFor,`。

- [ ] **Step 3：tsc 验证**

Run: `pnpm exec tsc --noEmit`
Expected: 0 error

### Task 6.4：SkillTracksCanvas 传 `cdBarEnd` + `timelineEndSec` 到 CastEventIcon

**Files:**

- Modify: `src/components/Timeline/SkillTracksCanvas.tsx`
- Modify: `src/components/Timeline/index.tsx`

- [ ] **Step 1：SkillTracksCanvas 加 timelineEndSec prop**

在 `src/components/Timeline/SkillTracksCanvas.tsx:33`（`timelineWidth: number` 之后）加：

```typescript
timelineEndSec: number
```

- [ ] **Step 2：Timeline/index.tsx 传这个 prop**

在 `src/components/Timeline/index.tsx:328-329` 的 `maxTime` 计算旁边（即 `const maxTime = Math.max(300, lastEventTime + 60)` 这一行），记下这个 `maxTime` 就是 `timelineEndSec`。

在调用 `SkillTracksCanvas` 的地方（约 `index.tsx:1361`）加 prop：

```tsx
<SkillTracksCanvas
  timelineWidth={timelineWidth}
  timelineEndSec={maxTime}
  {/* ... 其他 props */}
/>
```

- [ ] **Step 3：SkillTracksCanvas 把 cdBarEnd 传给 CastEventIcon**

在 `SkillTracksCanvas.tsx:564+`（调用 `<CastEventIcon />` 处）加：

```tsx
<CastEventIcon
  {/* ... 既有 props */}
  cdBarEnd={engine?.cdBarEndFor(castEvent.id) ?? null}
  timelineEndSec={timelineEndSec}
/>
```

同时接收 `timelineEndSec` 的 props 解构（组件函数签名）：

在 `SkillTracksCanvas.tsx:87` 附近 props 解构里加 `timelineEndSec`。

- [ ] **Step 4：CastEventIcon 接收新 props**

在 `src/components/Timeline/CastEventIcon.tsx:14-37` 的 `CastEventIconProps` 末尾加：

```typescript
/** 蓝条右端（秒）；null = 不画；Infinity = 截到 timelineEndSec */
cdBarEnd: number | null
/** Infinity 蓝条截到此值（从 timeline 顶层传下来的 maxTime） */
timelineEndSec: number
```

组件函数的参数解构也加这两个。

- [ ] **Step 5：tsc 验证**

Run: `pnpm exec tsc --noEmit`
Expected: 0 error

### Task 6.5：CastEventIcon 重写蓝条渲染

**Files:**

- Modify: `src/components/Timeline/CastEventIcon.tsx`

- [ ] **Step 1：在 `effectiveDuration` 定义后加 cd 条相关变量**

在 `src/components/Timeline/CastEventIcon.tsx:67` 之后插入：

```typescript
// 蓝条几何
const rawEndSec = cdBarEnd === null ? null : cdBarEnd === Infinity ? timelineEndSec : cdBarEnd
const visualEndSec = rawEndSec === null ? null : Math.min(rawEndSec, nextCastTime)
const cdBarWidth =
  visualEndSec === null
    ? 0
    : Math.max(0, (visualEndSec - castEvent.timestamp) * zoomLevel - effectiveDuration * zoomLevel)
const showCdBar = cdBarWidth > 0
const cdRemainingSec = rawEndSec === null ? 0 : rawEndSec - castEvent.timestamp
const showCdText = rawEndSec !== null && visualEndSec === rawEndSec && cdRemainingSec >= 3
const cdTextSeconds = Math.round(cdRemainingSec)
const cdTextX = cdRemainingSec * zoomLevel - 22
```

- [ ] **Step 2：替换 selected-glow Rect 条件与宽度**

在 `src/components/Timeline/CastEventIcon.tsx:144-158`（原 `isSelected && action.cooldown > 0 && (...)` 块）替换为：

```tsx
{
  isSelected && showCdBar && (
    <Rect
      x={effectiveDuration * zoomLevel}
      y={-15}
      width={cdBarWidth}
      height={30}
      fill="#3b82f6"
      opacity={0.5}
      shadowColor="#3b82f6"
      shadowBlur={18}
      shadowOpacity={1}
      shadowEnabled={true}
      listening={false}
    />
  )
}
```

- [ ] **Step 3：替换主蓝条 Rect**

在 `src/components/Timeline/CastEventIcon.tsx:161-172`（原 `{action.cooldown > 0 && (...)` 块）替换为：

```tsx
{
  showCdBar && (
    <Rect
      x={effectiveDuration * zoomLevel}
      y={-15}
      width={cdBarWidth}
      height={30}
      fill="#3b82f6"
      opacity={isHovered ? 0.35 : 0.2}
      shadowEnabled={false}
      perfectDrawEnabled={false}
    />
  )
}
```

- [ ] **Step 4：替换末端文本**

在 `src/components/Timeline/CastEventIcon.tsx:174-187`（原 `{action.cooldown >= 3 && (...)` 块）替换为：

```tsx
{
  showCdText && (
    <Text
      x={cdTextX}
      y={0}
      text={`${cdTextSeconds}s`}
      fontSize={10}
      fill={isSelected ? '#ffffff' : '#3b82f6'}
      fontStyle="bold"
      fontFamily="Arial, sans-serif"
      perfectDrawEnabled={false}
      listening={false}
    />
  )
}
```

- [ ] **Step 5：更新鼠标响应层宽度**

在 `src/components/Timeline/CastEventIcon.tsx:222-226`（透明鼠标响应 Rect）把：

```tsx
width={Math.max(30, effectiveDuration * zoomLevel, action.cooldown * zoomLevel)}
```

改成（把 cooldown 参考宽度换成 cdBar 实际右端）：

```tsx
width={Math.max(
  30,
  effectiveDuration * zoomLevel,
  visualEndSec !== null ? (visualEndSec - castEvent.timestamp) * zoomLevel : 0
)}
```

- [ ] **Step 6：tsc + test 验证**

Run: `pnpm exec tsc --noEmit && pnpm test:run`
Expected: 0 error；所有单测通过

### Task 6.6：UI 文案按 `resourceId` max 分支（接上 Task 4.5 通路）

**Files:**

- Modify: `src/components/Timeline/CastEventIcon.tsx`

- [ ] **Step 1：引入 RESOURCE_REGISTRY 并在 tooltip/aria 逻辑里用**

目前代码里没有硬编码的"CD 冲突 / 层数不足"文案（红边框靠 `invalidReason` prop 驱动视觉，没带文本）。若将来要加 tooltip 显示非法原因，模式为：

```typescript
import { RESOURCE_REGISTRY } from '@/data/resources'

const invalidText = (() => {
  if (!invalidReason) return null
  if (invalidReason === 'placement_lost') return '放置错误'
  if (invalidReason === 'resource_exhausted' || invalidReason === 'both') {
    const max = invalidResourceId ? (RESOURCE_REGISTRY[invalidResourceId]?.max ?? 1) : 1
    return max > 1 ? '层数不足' : '冷却中'
  }
  return null
})()
```

本阶段只把 `invalidResourceId` 接收进来并为未来 tooltip 准备；无需渲染 text（保持现状视觉）。

- [ ] **Step 2：tsc 验证**

Run: `pnpm exec tsc --noEmit`
Expected: 0 error

### Task 6.7：手动浏览器验证

- [ ] **Step 1：dev server 已启**

用户启动 `pnpm dev`

- [ ] **Step 2：Cases**

1. 选中任意单充能 action（如雪仇 cd=60）→ 蓝条宽度 60s、文本 "60s"。与迁移前对照应一致。
2. 选中献奉 #1（库存后剩 1 层）→ 无蓝条。
3. 选中献奉 #2（打空）→ 蓝条截到下一层回充、文本整数秒。
4. 选中慰藉 #1（炽天内还有库存）→ 无蓝条。
5. 选中慰藉 #2（打空 + 炽天 buff 还在）→ 蓝条截到自充能 refill、文本整数秒。
6. 拖拽任意 cast → 蓝条随拖拽位置 "冻结"（用 engine 原 castEvents 算，非预览），与现状行为一致。
7. 短 CD 技能（cd=2 意气）→ 蓝条 2s、无文本（<3s 阈值）。

### Task 6.8：阶段 6 commit

- [ ] **Step 1：**

```bash
git add src/utils/resource/cdBar.ts src/utils/resource/cdBar.test.ts \
        src/utils/placement/engine.ts \
        src/components/Timeline/CastEventIcon.tsx \
        src/components/Timeline/SkillTracksCanvas.tsx \
        src/components/Timeline/index.tsx
git commit -m "feat(canvas): 蓝色 CD 条改为资源语义驱动（打空到恢复）"
```

---

## 阶段 7 · 清理 + 文档

### Task 7.1：全库搜字面残留

- [ ] **Step 1：跑搜索验证 0 残留**

Run:

```bash
pnpm exec grep -rn '20016546' src/
pnpm exec grep -rn 'cooldown_conflict' src/
pnpm exec grep -rn "'CD 冲突'" src/
```

Expected: 0 matches（每个命令）

若有：逐个定位处理（大概率是 comment；若是 code 说明前面遗漏）

### Task 7.2：更新 `CLAUDE.md`

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1：在"核心概念"章节追加资源模型小节**

在 `CLAUDE.md` 的"### 5. 认证系统"这一小节**之前**（即"### 4. 编辑器三种模式"之后）插入：

```markdown
### 4.5. 资源模型（CD / 充能 / 共享池）

技能使用可用性由**资源池**统一表达，替代原"单层 cooldown + 假 buff stack"方案。设计见 `design/superpowers/specs/2026-04-24-resource-model-design.md`。

- **`ResourceDefinition`** 在 `src/data/resources.ts` 的 `RESOURCE_REGISTRY` 中声明（如 `sch:consolation`、`drk:oblation`）。池按 `(playerId, resourceId)` 懒实例化。
- **`MitigationAction.resourceEffects`** 声明一次 cast 对资源的影响（`+N` 产出、`-N` 消耗）。含消费者（`delta<0`）时，跳过 `__cd__` 合成；否则合成 `__cd__:${id}` 单充能池强制 `cooldown`。
- **`regen`** 采用充能计时语义：每次消耗调度 `interval` 秒后的独立 refill，**不**是从 t=0 固定节拍。
- **校验**：`findResourceExhaustedCasts` 判 cast 是否因资源不足非法；shadow 由 `resourceLegalIntervals`（自耗尽段 + 下游透支段）推导。
- **trackGroup** 与资源模型**完全解耦**，仅用于 UI 渲染轨道归属。
- **蓝色 CD 条** 的语义是"此 cast 打空池子到恢复的时段"；还有库存时不画。
```

### Task 7.3：最终检查

- [ ] **Step 1：全量验证**

Run:

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test:run
pnpm build
```

Expected: 全 PASS

### Task 7.4：阶段 7 commit

- [ ] **Step 1：**

```bash
git add CLAUDE.md
git commit -m "docs: 资源模型章节加入 CLAUDE.md"
```

---

## 最终状态

执行完成后分支应有 7 个 feat/refactor/docs commit 叠加在 `feat/resource-engine` 上：

1. `feat(resource): 类型骨架 + 空 registry`
2. `feat(resource): compute 层 + 单测`
3. `feat(resource): validator + legalIntervals`
4. `refactor(placement): 删 cooldownAvailable，CD 冲突走新资源模型`
5. `feat(data): 学者慰藉/炽天 + 骑士献奉迁移到资源模型，废弃假 buff 20016546`
6. `feat(canvas): 蓝色 CD 条改为资源语义驱动`
7. `docs: 资源模型章节加入 CLAUDE.md`

状态：全量 `pnpm test:run` 通过、浏览器手动验证 5 + 3 cases 通过、假 buff `20016546` 零残留。
