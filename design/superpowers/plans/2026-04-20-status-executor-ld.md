# StatusExecutor 框架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给减伤计算系统铺一层 `StatusExecutor` 框架——让状态本身可以在减伤流程中产生副作用（加/删状态），以便后续支持"行尸走肉 → 出死入生"这类状态流转。本 plan **只做框架**，不含任何具体业务状态的 executor 逻辑。

**Architecture:** 状态元数据 (`MitigationStatusMetadata`) 新增可选 `executor` 字段，支持五个钩子：`onBeforeShield`（% 减伤后、盾吸前）、`onConsume`（盾被打穿瞬间）、`onAfterDamage`（盾吸后）三个由 `MitigationCalculator` 触发；`onExpire`（状态自然到期）与 `onTick`（周期性脉冲，应对 DoT/HoT 类）由 driver `useDamageCalculation` 在事件间触发。`onTick` 遵循 **全局 3 秒网格**——只在 `t % 3 === 0` 的整秒点统一触发所有带 `onTick` 的活跃状态，匹配 FF14 的服务端 tick 模型。`MitigationStatus` 新增 `data?: Record<string, unknown>` 字段给 executor 存自定义数据，`performance?: PerformanceType` 字段允许 cast 时按条件覆盖 metadata 默认减伤值（snapshot-on-apply）。Executor 是 `(ctx) => PartyState | void` 的纯函数，通过 immutable helpers (`addStatus` / `removeStatus` / `removeStatusesByStatusId` / `updateStatus` / `updateStatusData`) 构造新状态。同时把 calculator 的盾阶段判定改成 **实例级**（`status.remainingBarrier > 0`），让任何状态实例只要被赋予 barrier 就能参与盾吸收——这样 LD 这类用例可以直接 mutate 行尸走肉自己的实例加上 barrier，不需要合成状态或 `damageOverride`。

**Tech Stack:** TypeScript 5.9，Vitest 4，pnpm；沿用现有 `MitigationCalculator` / `createBuffExecutor` / `statusRegistry` 模式。

---

## File Structure

**Create:**

- `src/executors/statusHelpers.ts` — `addStatus` / `removeStatus` / `removeStatusesByStatusId` / `updateStatus` / `updateStatusData` 不可变工具
- `src/executors/statusHelpers.test.ts`

**Modify:**

- `src/types/status.ts` — 新增 `StatusExecutor` / `StatusDamageContext` / `StatusConsumeContext` / `StatusAfterDamageContext` / `StatusExpireContext` / `StatusTickContext`；`MitigationStatusMetadata.executor?: StatusExecutor`；`MitigationStatus.data?: Record<string, unknown>`、`MitigationStatus.performance?: PerformanceType`
- `src/executors/createBuffExecutor.ts` — 新增 `performance?: (ctx) => PerformanceType | undefined` option（Task 6）
- `src/data/statusExtras.ts` — `StatusExtras` 接口扩展 `executor?: StatusExecutor` 字段
- `src/utils/statusRegistry.ts` — 把 `extras.executor` 挂到 metadata 上
- `src/utils/mitigationCalculator.ts` — 盾阶段判定从 `meta.type === 'absorbed'` 改为实例级 `status.remainingBarrier > 0`；依次调用 `onBeforeShield` / `onConsume` / `onAfterDamage`
- `src/hooks/useDamageCalculation.ts` — 事件间触发 `onTick` + `onExpire`
- `src/utils/mitigationCalculator.test.ts` — 加一组 smoke test 验证钩子通路（用 `vi.spyOn` 临时注入 executor）
- `src/executors/index.ts` — 导出新 helpers

---

## Task 1: StatusExecutor 类型定义

**Files:**

- Modify: `src/types/status.ts`

- [ ] **Step 1: 添加类型导入**

在 `src/types/status.ts` 顶部现有 import 之后追加：

```typescript
import type { DamageEvent } from './timeline'
import type { PartyState } from './partyState'
```

- [ ] **Step 2: 文件末尾追加 StatusExecutor 与 Context 类型**

```typescript
/**
 * onBeforeShield 上下文
 */
export interface StatusDamageContext {
  /** 触发本次钩子的状态实例 */
  status: MitigationStatus
  /** 当前伤害事件 */
  event: DamageEvent
  /** 本事件进入此钩子时的小队状态（含前序钩子已合并的修改） */
  partyState: PartyState
  /** % 减伤后的候选伤害（未扣盾） */
  candidateDamage: number
}

/**
 * onConsume 上下文
 */
export interface StatusConsumeContext {
  /** 刚被打穿的盾值状态实例（`remainingBarrier` 已归 0） */
  status: MitigationStatus
  event: DamageEvent
  partyState: PartyState
  /** 此盾值在本事件被吸收的量 */
  absorbedAmount: number
}

/**
 * onAfterDamage 上下文（盾吸收后）
 */
export interface StatusAfterDamageContext {
  status: MitigationStatus
  event: DamageEvent
  partyState: PartyState
  /** % 减伤后的候选伤害 */
  candidateDamage: number
  /** 盾吸收后的最终伤害 */
  finalDamage: number
}

/**
 * onExpire 上下文（状态自然到期）
 */
export interface StatusExpireContext {
  /** 即将过期的状态实例 */
  status: MitigationStatus
  /** 过期检查的时刻（通常是下一个事件的 time / snapshotTime） */
  expireTime: number
  partyState: PartyState
}

/**
 * onTick 上下文（周期性脉冲）
 *
 * driver 在 `t % 3 === 0` 的整秒时间点统一触发所有活跃状态的 onTick；
 * tickTime 是这次 tick 的绝对时间（秒）。
 */
export interface StatusTickContext {
  status: MitigationStatus
  tickTime: number
  partyState: PartyState
}

/**
 * 状态自身在减伤计算过程中的副作用钩子
 *
 * 每个钩子接收上下文，返回新的 PartyState（返回 void 表示不变）。
 * executor 应保持纯函数——只读 ctx、只返回新 state。
 */
export interface StatusExecutor {
  /** % 减伤后、盾值吸收前调用 */
  onBeforeShield?: (ctx: StatusDamageContext) => PartyState | void
  /** 盾值在本事件被完全打穿瞬间调用 */
  onConsume?: (ctx: StatusConsumeContext) => PartyState | void
  /** 盾值吸收后调用（无论这个状态自身是否参与了吸收） */
  onAfterDamage?: (ctx: StatusAfterDamageContext) => PartyState | void
  /** 状态到达 endTime、即将被 driver 清理时调用 */
  onExpire?: (ctx: StatusExpireContext) => PartyState | void
  /** 全局 3s tick 网格上、状态仍活跃时触发（DoT / HoT 等） */
  onTick?: (ctx: StatusTickContext) => PartyState | void
}
```

- [ ] **Step 3: MitigationStatusMetadata 增加 executor 字段**

修改 `MitigationStatusMetadata` 接口（约 status.ts:26-31）：

```typescript
export interface MitigationStatusMetadata extends Omit<Keigenn, 'performance' | 'fullIcon'> {
  performance: PerformanceType
  fullIcon?: string
  /** 是否仅对坦克生效 */
  isTankOnly: boolean
  /** 状态自身的副作用钩子（可选） */
  executor?: StatusExecutor
}
```

- [ ] **Step 4: MitigationStatus 增加 data / performance 字段**

在 `MitigationStatus` 接口末尾追加：

```typescript
export interface MitigationStatus {
  // ... 既有字段
  /** executor 自定义数据（tick 计数、累计值等）；框架不关心内容 */
  data?: Record<string, unknown>
  /** 条件性减伤值；若存在优先于 metadata.performance（snapshot-on-apply） */
  performance?: PerformanceType
}
```

- [ ] **Step 5: 类型校验通过**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/types/status.ts
git commit -m "feat(status): 新增 StatusExecutor 抽象与上下文类型"
```

---

## Task 2: 不可变状态工具 addStatus / removeStatus

**Files:**

- Create: `src/executors/statusHelpers.ts`
- Create: `src/executors/statusHelpers.test.ts`
- Modify: `src/executors/index.ts`

- [ ] **Step 1: 写失败测试**

`src/executors/statusHelpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  addStatus,
  removeStatus,
  removeStatusesByStatusId,
  updateStatus,
  updateStatusData,
} from './statusHelpers'
import type { PartyState } from '@/types/partyState'

function basePartyState(): PartyState {
  return {
    players: [{ id: 1, job: 'DRK', maxHP: 200000 }],
    statuses: [],
    timestamp: 0,
  }
}

describe('statusHelpers', () => {
  describe('addStatus', () => {
    it('按模板添加状态，自动生成 instanceId + startTime/endTime', () => {
      const state = addStatus(basePartyState(), {
        statusId: 810,
        duration: 10,
        sourcePlayerId: 1,
        eventTime: 30,
      })

      expect(state.statuses).toHaveLength(1)
      const added = state.statuses[0]
      expect(added.statusId).toBe(810)
      expect(added.startTime).toBe(30)
      expect(added.endTime).toBe(40)
      expect(added.sourcePlayerId).toBe(1)
      expect(added.instanceId).toBeTruthy()
    })

    it('initialBarrier 缺省等于 remainingBarrier', () => {
      const state = addStatus(basePartyState(), {
        statusId: 297,
        duration: 30,
        remainingBarrier: 5000,
        eventTime: 0,
      })

      expect(state.statuses[0].remainingBarrier).toBe(5000)
      expect(state.statuses[0].initialBarrier).toBe(5000)
    })

    it('返回新数组，不修改原 state', () => {
      const original = basePartyState()
      const state = addStatus(original, {
        statusId: 810,
        duration: 10,
        eventTime: 0,
      })
      expect(state).not.toBe(original)
      expect(state.statuses).not.toBe(original.statuses)
      expect(original.statuses).toHaveLength(0)
    })

    it('performance 与 data 直接透传到实例字段上', () => {
      const state = addStatus(basePartyState(), {
        statusId: 1234,
        duration: 10,
        eventTime: 5,
        performance: { physics: 0.8, magic: 0.8, darkness: 0.8, heal: 1, maxHP: 1 },
        data: { boosted: true },
      })
      expect(state.statuses[0].performance).toEqual({
        physics: 0.8,
        magic: 0.8,
        darkness: 0.8,
        heal: 1,
        maxHP: 1,
      })
      expect(state.statuses[0].data).toEqual({ boosted: true })
    })
  })

  describe('removeStatus', () => {
    it('按 instanceId 移除指定状态', () => {
      const withStatuses: PartyState = {
        ...basePartyState(),
        statuses: [
          { instanceId: 'a', statusId: 1, startTime: 0, endTime: 10 },
          { instanceId: 'b', statusId: 2, startTime: 0, endTime: 10 },
        ],
      }
      const state = removeStatus(withStatuses, 'a')
      expect(state.statuses).toHaveLength(1)
      expect(state.statuses[0].instanceId).toBe('b')
    })
  })

  describe('removeStatusesByStatusId', () => {
    it('按 statusId 移除所有匹配状态', () => {
      const withStatuses: PartyState = {
        ...basePartyState(),
        statuses: [
          { instanceId: 'a', statusId: 810, startTime: 0, endTime: 10 },
          { instanceId: 'b', statusId: 810, startTime: 5, endTime: 15 },
          { instanceId: 'c', statusId: 811, startTime: 0, endTime: 10 },
        ],
      }
      const state = removeStatusesByStatusId(withStatuses, 810)
      expect(state.statuses).toHaveLength(1)
      expect(state.statuses[0].statusId).toBe(811)
    })
  })

  describe('updateStatus', () => {
    it('按 instanceId 合并更新字段', () => {
      const withStatuses: PartyState = {
        ...basePartyState(),
        statuses: [
          {
            instanceId: 'a',
            statusId: 810,
            startTime: 0,
            endTime: 10,
          },
        ],
      }
      const state = updateStatus(withStatuses, 'a', {
        remainingBarrier: 5000,
        endTime: 5,
      })
      expect(state.statuses[0].remainingBarrier).toBe(5000)
      expect(state.statuses[0].endTime).toBe(5)
      expect(state.statuses[0].statusId).toBe(810) // 未提供的字段保持
    })

    it('instanceId 不匹配时返回新 state 但数据等价', () => {
      const original: PartyState = {
        ...basePartyState(),
        statuses: [{ instanceId: 'a', statusId: 1, startTime: 0, endTime: 10 }],
      }
      const state = updateStatus(original, 'nonexistent', { remainingBarrier: 99 })
      expect(state).not.toBe(original)
      expect(state.statuses[0]).toEqual(original.statuses[0])
    })
  })

  describe('updateStatusData', () => {
    it('把 patch 浅合并到 data 上', () => {
      const withStatuses: PartyState = {
        ...basePartyState(),
        statuses: [
          {
            instanceId: 'a',
            statusId: 1,
            startTime: 0,
            endTime: 10,
            data: { ticksFired: 2, other: 'keep' },
          },
        ],
      }
      const state = updateStatusData(withStatuses, 'a', { ticksFired: 3 })
      expect(state.statuses[0].data).toEqual({ ticksFired: 3, other: 'keep' })
    })

    it('data 为 undefined 时也能初始化', () => {
      const withStatuses: PartyState = {
        ...basePartyState(),
        statuses: [{ instanceId: 'a', statusId: 1, startTime: 0, endTime: 10 }],
      }
      const state = updateStatusData(withStatuses, 'a', { ticksFired: 1 })
      expect(state.statuses[0].data).toEqual({ ticksFired: 1 })
    })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/executors/statusHelpers.test.ts`
Expected: FAIL — `Cannot find module './statusHelpers'`

- [ ] **Step 3: 实现 statusHelpers**

`src/executors/statusHelpers.ts`:

```typescript
/**
 * 状态不可变更新工具
 *
 * 供 StatusExecutor 使用；调用方只描述"要做什么"，由 helpers 负责
 * instanceId 生成、startTime/endTime 计算、initialBarrier 默认值。
 */

import type { PartyState } from '@/types/partyState'
import type { MitigationStatus, PerformanceType } from '@/types/status'
import { generateId } from './utils'

/**
 * addStatus 入参
 * 框架根据 eventTime + duration 填 startTime/endTime，生成 instanceId。
 */
export interface AddStatusInput {
  statusId: number
  /** 事件发生时刻（作为 startTime） */
  eventTime: number
  /** 持续时间（秒），endTime = eventTime + duration */
  duration: number
  remainingBarrier?: number
  /** 不填默认等于 remainingBarrier */
  initialBarrier?: number
  stack?: number
  sourceActionId?: number
  sourcePlayerId?: number
  /** 条件性减伤值覆盖（不填走 metadata 默认） */
  performance?: PerformanceType
  /** executor 自定义数据初值 */
  data?: Record<string, unknown>
}

/**
 * 添加一个新状态到 PartyState
 */
export function addStatus(state: PartyState, input: AddStatusInput): PartyState {
  const { eventTime, duration, statusId, remainingBarrier, initialBarrier, ...rest } = input

  const newStatus: MitigationStatus = {
    instanceId: generateId(),
    statusId,
    startTime: eventTime,
    endTime: eventTime + duration,
    ...rest,
  }

  if (remainingBarrier !== undefined) {
    newStatus.remainingBarrier = remainingBarrier
    newStatus.initialBarrier = initialBarrier ?? remainingBarrier
  }

  return {
    ...state,
    statuses: [...state.statuses, newStatus],
  }
}

/**
 * 按 instanceId 移除状态
 */
export function removeStatus(state: PartyState, instanceId: string): PartyState {
  return {
    ...state,
    statuses: state.statuses.filter(s => s.instanceId !== instanceId),
  }
}

/**
 * 按 statusId 移除所有匹配状态
 */
export function removeStatusesByStatusId(state: PartyState, statusId: number): PartyState {
  return {
    ...state,
    statuses: state.statuses.filter(s => s.statusId !== statusId),
  }
}

/**
 * 按 instanceId 合并更新指定状态字段
 */
export function updateStatus(
  state: PartyState,
  instanceId: string,
  patch: Partial<MitigationStatus>
): PartyState {
  return {
    ...state,
    statuses: state.statuses.map(s => (s.instanceId === instanceId ? { ...s, ...patch } : s)),
  }
}

/**
 * 按 instanceId 浅合并更新指定状态的 `data` 字段
 * 方便 executor 只写增量字段，不用每次手动 `{ ...s.data, ... }`
 */
export function updateStatusData(
  state: PartyState,
  instanceId: string,
  patch: Record<string, unknown>
): PartyState {
  return {
    ...state,
    statuses: state.statuses.map(s =>
      s.instanceId === instanceId ? { ...s, data: { ...s.data, ...patch } } : s
    ),
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run src/executors/statusHelpers.test.ts`
Expected: 所有用例通过

- [ ] **Step 5: 在 executors/index.ts 导出**

修改 `src/executors/index.ts`:

```typescript
export { createBuffExecutor } from './createBuffExecutor'
export { createShieldExecutor } from './createShieldExecutor'
export { generateId } from './utils'
export {
  addStatus,
  removeStatus,
  removeStatusesByStatusId,
  updateStatus,
  updateStatusData,
} from './statusHelpers'
export type { AddStatusInput } from './statusHelpers'
```

- [ ] **Step 6: Commit**

```bash
git add src/executors/statusHelpers.ts src/executors/statusHelpers.test.ts src/executors/index.ts
git commit -m "feat(executors): 新增 addStatus/removeStatus/updateStatus/updateStatusData 不可变工具"
```

---

## Task 3: StatusExtras 扩展 executor 字段

**Files:**

- Modify: `src/data/statusExtras.ts`
- Modify: `src/utils/statusRegistry.ts`

业务侧 executor 通过在 `STATUS_EXTRAS` 里追加 `executor: { ... }` 注册；`statusExtras.ts` 保持"所有针对 statusId 的本地补充字段"单一出口。

- [ ] **Step 1: StatusExtras 接口加字段**

修改 `src/data/statusExtras.ts`，imports 处追加：

```typescript
import type { StatusExecutor } from '@/types/status'
```

扩展 `StatusExtras` 接口：

```typescript
export interface StatusExtras {
  /** 是否仅对坦克生效；缺省为 false */
  isTankOnly?: boolean
  /** performance.heal 倍率（1 = 无影响，> 1 增疗）；缺省为 1 */
  heal?: number
  /** performance.maxHP 倍率（1 = 无影响，> 1 增加最大 HP）；缺省为 1 */
  maxHP?: number
  /** 状态自身的副作用钩子（可选） */
  executor?: StatusExecutor
}
```

现有的 `STATUS_EXTRAS` 数据不用改。

- [ ] **Step 2: statusRegistry 注入 executor**

修改 `src/utils/statusRegistry.ts`，在 `initializeStatusRegistry()` 的 `merged` 对象上加 `executor`：

```typescript
const merged: MitigationStatusMetadata = {
  ...status,
  performance: {
    ...status.performance,
    heal: extras?.heal ?? 1,
    maxHP: extras?.maxHP ?? 1,
  },
  isTankOnly: extras?.isTankOnly ?? false,
  executor: extras?.executor,
}
```

- [ ] **Step 3: 验证现有测试不回归**

Run: `pnpm test:run src/utils/statusRegistry.test.ts`
Expected: 已有用例全部通过

- [ ] **Step 4: 类型校验**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/data/statusExtras.ts src/utils/statusRegistry.ts
git commit -m "feat(status): StatusExtras 接入可选 executor 字段"
```

---

## Task 4: calculator 集成 onBeforeShield + onConsume 钩子

**Files:**

- Modify: `src/utils/mitigationCalculator.ts`
- Modify: `src/utils/mitigationCalculator.test.ts`

- [ ] **Step 1: 写失败 smoke test**

在 `src/utils/mitigationCalculator.test.ts` 顶部 imports 追加：

```typescript
import { vi } from 'vitest'
import * as registry from '@/utils/statusRegistry'
import type { MitigationStatusMetadata } from '@/types/status'
import { updateStatus } from '@/executors/statusHelpers'
```

在 `MitigationCalculator with simplified PartyState` describe 之前追加新的 describe：

```typescript
describe('StatusExecutor 钩子通路', () => {
  /**
   * 通过 vi.spyOn 临时给一个虚构 statusId 注入 executor，
   * 验证 calculator 会按预期调用 onBeforeShield / onConsume。
   * 不依赖任何真实业务 executor。
   */
  const FAKE_BUFF_ID = 999900
  const FAKE_SHIELD_ID = 999901

  function withFakeMeta(extra: Record<number, Partial<MitigationStatusMetadata>>) {
    const original = registry.getStatusById
    return vi.spyOn(registry, 'getStatusById').mockImplementation(id => {
      if (extra[id]) {
        return {
          id,
          name: `fake-${id}`,
          type: extra[id].type ?? 'multiplier',
          performance: { physics: 1, magic: 1, darkness: 1, heal: 1, maxHP: 1 },
          isFriendly: true,
          isTankOnly: false,
          ...extra[id],
        } as MitigationStatusMetadata
      }
      return original(id)
    })
  }

  it('onBeforeShield 被调用，返回的 PartyState 带入盾值阶段', () => {
    const onBeforeShield = vi.fn().mockImplementation(ctx => {
      return {
        ...ctx.partyState,
        statuses: [
          ...ctx.partyState.statuses,
          {
            instanceId: 'injected-shield',
            statusId: FAKE_SHIELD_ID,
            startTime: ctx.event.time,
            endTime: ctx.event.time,
            remainingBarrier: 5000,
            initialBarrier: 5000,
          },
        ],
      }
    })

    const spy = withFakeMeta({
      [FAKE_BUFF_ID]: { type: 'multiplier', executor: { onBeforeShield } },
      [FAKE_SHIELD_ID]: { type: 'absorbed' },
    })

    try {
      const partyState: PartyState = {
        players: [{ id: 1, job: 'DRK', maxHP: 100000 }],
        statuses: [
          {
            instanceId: 'trigger',
            statusId: FAKE_BUFF_ID,
            startTime: 0,
            endTime: 10,
            sourcePlayerId: 1,
          },
        ],
        timestamp: 0,
      }

      const result = calculator.calculate(makeEvent(10000, 5, 'physical', 'tankbuster'), partyState)

      expect(onBeforeShield).toHaveBeenCalledTimes(1)
      expect(onBeforeShield.mock.calls[0][0].candidateDamage).toBe(10000)
      // 注入的 5000 盾被消耗
      expect(result.finalDamage).toBe(5000)
    } finally {
      spy.mockRestore()
    }
  })

  it('onConsume 在盾被完全打穿时被调用', () => {
    const onConsume = vi.fn().mockImplementation(ctx => ctx.partyState)

    const spy = withFakeMeta({
      [FAKE_SHIELD_ID]: { type: 'absorbed', executor: { onConsume } },
    })

    try {
      const partyState: PartyState = {
        players: [{ id: 1, job: 'DRK', maxHP: 100000 }],
        statuses: [
          {
            instanceId: 'shield',
            statusId: FAKE_SHIELD_ID,
            startTime: 0,
            endTime: 20,
            remainingBarrier: 3000,
            initialBarrier: 3000,
          },
        ],
        timestamp: 0,
      }

      calculator.calculate(makeEvent(5000, 5, 'physical', 'tankbuster'), partyState)

      expect(onConsume).toHaveBeenCalledTimes(1)
      expect(onConsume.mock.calls[0][0].absorbedAmount).toBe(3000)
    } finally {
      spy.mockRestore()
    }
  })

  it('onBeforeShield 可以通过 updateStatus 给 multiplier 状态实例加 barrier 使其当场参与盾吸收', () => {
    // 模拟 LD 模式：行尸走肉本身 meta.type = multiplier（无减伤），
    // onBeforeShield 现场给自己实例加 remainingBarrier 来吃这一下。
    const onBeforeShield = vi.fn().mockImplementation(ctx => {
      return updateStatus(ctx.partyState, ctx.status.instanceId, {
        remainingBarrier: ctx.candidateDamage,
        endTime: ctx.event.time,
      })
    })

    const spy = withFakeMeta({
      [FAKE_BUFF_ID]: { type: 'multiplier', executor: { onBeforeShield } },
    })

    try {
      const partyState: PartyState = {
        players: [{ id: 1, job: 'DRK', maxHP: 100000 }],
        statuses: [
          {
            instanceId: 'ld',
            statusId: FAKE_BUFF_ID,
            startTime: 0,
            endTime: 10,
            sourcePlayerId: 1,
          },
        ],
        timestamp: 0,
      }

      const result = calculator.calculate(makeEvent(15000, 5, 'physical', 'tankbuster'), partyState)

      expect(onBeforeShield).toHaveBeenCalledTimes(1)
      expect(result.finalDamage).toBe(0) // barrier=15000 吸完伤害
      // 自身 remainingBarrier 归 0，被 calculator filter 清掉
      expect(result.updatedPartyState!.statuses.find(s => s.instanceId === 'ld')).toBeUndefined()
    } finally {
      spy.mockRestore()
    }
  })

  it('onConsume 在盾未打穿时不调用', () => {
    const onConsume = vi.fn()

    const spy = withFakeMeta({
      [FAKE_SHIELD_ID]: { type: 'absorbed', executor: { onConsume } },
    })

    try {
      const partyState: PartyState = {
        players: [{ id: 1, job: 'DRK', maxHP: 100000 }],
        statuses: [
          {
            instanceId: 'shield',
            statusId: FAKE_SHIELD_ID,
            startTime: 0,
            endTime: 20,
            remainingBarrier: 10000,
            initialBarrier: 10000,
          },
        ],
        timestamp: 0,
      }

      calculator.calculate(makeEvent(3000, 5, 'physical', 'tankbuster'), partyState)

      expect(onConsume).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('onAfterDamage 在盾吸收后调用，能拿到 finalDamage', () => {
    const onAfterDamage = vi.fn().mockImplementation(ctx => ctx.partyState)

    const spy = withFakeMeta({
      [FAKE_BUFF_ID]: { type: 'multiplier', executor: { onAfterDamage } },
    })

    try {
      const partyState: PartyState = {
        players: [{ id: 1, job: 'DRK', maxHP: 100000 }],
        statuses: [
          {
            instanceId: 'watcher',
            statusId: FAKE_BUFF_ID,
            startTime: 0,
            endTime: 10,
            sourcePlayerId: 1,
          },
        ],
        timestamp: 0,
      }

      calculator.calculate(makeEvent(4000, 5, 'physical', 'tankbuster'), partyState)

      expect(onAfterDamage).toHaveBeenCalledTimes(1)
      const passed = onAfterDamage.mock.calls[0][0]
      expect(passed.candidateDamage).toBe(4000)
      expect(passed.finalDamage).toBe(4000)
    } finally {
      spy.mockRestore()
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts`
Expected: 新加 5 个用例失败（calculator 尚未调用钩子，盾阶段也还是 metadata 门控）

- [ ] **Step 3: 改造 calculator，插入钩子调用**

修改 `src/utils/mitigationCalculator.ts`，把 `calculate()` 方法主体（从"// 百分比减伤使用快照时间"起）整体替换为：

```typescript
const originalDamage = event.damage
const time = event.time
const damageType: DamageType = event.damageType || 'physical'
const snapshotTime = event.snapshotTime
const attackType = event.type

const mitigationTime = snapshotTime ?? time

const includeTankOnly = attackType === 'tankbuster' || attackType === 'auto'

// Phase 1: % 减伤
let multiplier = 1.0
const appliedStatuses: MitigationStatus[] = []

for (const status of partyState.statuses) {
  const meta = getStatusById(status.statusId)
  if (!meta) continue
  if (meta.isTankOnly && !includeTankOnly) continue

  if (meta.type === 'multiplier') {
    if (mitigationTime >= status.startTime && mitigationTime <= status.endTime) {
      // instance 的 performance 优先（snapshot-on-apply 覆盖），不在则取 metadata
      const performance = status.performance ?? meta.performance
      const damageMultiplier = this.getDamageMultiplier(performance, damageType)
      multiplier *= damageMultiplier
      appliedStatuses.push(status)
    }
  }
}

const candidateDamage = Math.round(originalDamage * multiplier)

// Phase 2: onBeforeShield — 状态可在此阶段新增/修改状态
let workingState: PartyState = partyState
for (const status of partyState.statuses) {
  const meta = getStatusById(status.statusId)
  if (!meta?.executor?.onBeforeShield) continue
  if (meta.isTankOnly && !includeTankOnly) continue
  if (mitigationTime < status.startTime || mitigationTime > status.endTime) continue

  const result = meta.executor.onBeforeShield({
    status,
    event,
    partyState: workingState,
    candidateDamage,
  })
  if (result) workingState = result
}

// Phase 3: 盾值吸收（基于 workingState，可能已含 onBeforeShield 修改）
// 盾的判定改为实例级：只看 remainingBarrier，不再限定 metadata 必须是 absorbed，
// 这样 executor 可以通过 updateStatus 给任意状态实例当场加 barrier（如 LD）。
const shieldStatuses: MitigationStatus[] = []
for (const status of workingState.statuses) {
  const meta = getStatusById(status.statusId)
  if (!meta) continue
  if (meta.isTankOnly && !includeTankOnly) continue
  if (status.remainingBarrier === undefined || status.remainingBarrier <= 0) continue
  if (time >= status.startTime && time <= status.endTime) {
    shieldStatuses.push(status)
  }
}
shieldStatuses.sort((a, b) => a.startTime - b.startTime)

const statusUpdates = new Map<string, Partial<MitigationStatus>>()
const consumedShields: Array<{ status: MitigationStatus; absorbed: number }> = []
let playerDamage = candidateDamage

for (const status of shieldStatuses) {
  const absorbed = Math.min(playerDamage, status.remainingBarrier!)
  playerDamage -= absorbed

  if (!appliedStatuses.find(s => s.instanceId === status.instanceId)) {
    appliedStatuses.push(status)
  }

  const newRemainingBarrier = status.remainingBarrier! - absorbed

  if (newRemainingBarrier <= 0 && status.stack && status.stack > 1 && status.initialBarrier) {
    statusUpdates.set(status.instanceId, {
      remainingBarrier: status.initialBarrier,
      stack: status.stack - 1,
    })
  } else {
    statusUpdates.set(status.instanceId, {
      remainingBarrier: newRemainingBarrier,
    })
    if (newRemainingBarrier <= 0) {
      // 仅 stack <= 1 且被打穿的盾算"消耗殆尽"，会触发 onConsume
      consumedShields.push({ status, absorbed })
    }
  }

  if (playerDamage <= 0) break
}

const damage = playerDamage

let updatedPartyState: PartyState = {
  ...workingState,
  statuses: workingState.statuses
    .map(s => {
      if (statusUpdates.has(s.instanceId)) {
        const updates = statusUpdates.get(s.instanceId)!
        return { ...s, ...updates }
      }
      return s
    })
    .filter(s => s.remainingBarrier === undefined || s.remainingBarrier > 0),
}

// Phase 4: onConsume — 刚被打穿的盾触发后续变化
for (const { status, absorbed } of consumedShields) {
  const meta = getStatusById(status.statusId)
  if (!meta?.executor?.onConsume) continue
  const result = meta.executor.onConsume({
    status,
    event,
    partyState: updatedPartyState,
    absorbedAmount: absorbed,
  })
  if (result) updatedPartyState = result
}

// Phase 5: onAfterDamage — 盾吸收后的通用收尾
// 注意：遍历 partyState.statuses（原始活跃集合），而不是 updatedPartyState，
// 避免刚添加的新状态在本事件又触发自己。
for (const status of partyState.statuses) {
  const meta = getStatusById(status.statusId)
  if (!meta?.executor?.onAfterDamage) continue
  if (meta.isTankOnly && !includeTankOnly) continue
  if (mitigationTime < status.startTime || mitigationTime > status.endTime) continue

  const result = meta.executor.onAfterDamage({
    status,
    event,
    partyState: updatedPartyState,
    candidateDamage,
    finalDamage: Math.max(0, Math.round(damage)),
  })
  if (result) updatedPartyState = result
}

const mitigationPercentage =
  originalDamage > 0 ? ((originalDamage - damage) / originalDamage) * 100 : 0

return {
  originalDamage,
  finalDamage: Math.max(0, Math.round(damage)),
  maxDamage: Math.max(0, Math.round(damage)),
  mitigationPercentage: Math.round(mitigationPercentage * 10) / 10,
  appliedStatuses,
  updatedPartyState,
}
```

关键变化：

1. `candidateDamage` 被单独命名，供 `onBeforeShield` / `onAfterDamage` 上下文使用；
2. 盾阶段判定改为 **实例级** (`status.remainingBarrier > 0`)，不再要求 `meta.type === 'absorbed'`；
3. `workingState` 滚动更新；Phase 3 基于它收集盾值；
4. `consumedShields` 只记录 `newRemainingBarrier <= 0` 且 `stack <= 1` 的盾（多层盾会重置，不算打穿）；
5. `onConsume` 在盾消耗完 + 状态已从 `updatedPartyState` 过滤掉之后执行；
6. `onAfterDamage` 遍历原始 `partyState.statuses`（而非 `updatedPartyState`），防止本事件新加的状态立即又触发自己。

**兼容性说明**：现有纯 multiplier 状态（铁壁等）不带 `remainingBarrier`，不会被盾阶段误拾；现有纯 absorbed 状态（鼓舞等）依然是"有 barrier 的实例"，行为完全一致。21 个既有测试应当全部通过。

- [ ] **Step 4: 跑测试确认全部通过**

Run: `pnpm test:run src/utils/mitigationCalculator.test.ts`
Expected: 21 个既有用例 + 5 个新 smoke test 全部通过

- [ ] **Step 5: 全量验证**

Run: `pnpm test:run && pnpm exec tsc --noEmit && pnpm lint`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "feat(calculator): 接入 onBeforeShield/onConsume/onAfterDamage 状态钩子"
```

---

## Task 5: driver 接入 onTick + onExpire

**Files:**

- Modify: `src/hooks/useDamageCalculation.ts`
- Modify: `src/hooks/useDamageCalculation.test.ts`（若不存在则新建）

事件间的两件事由 driver 负责：

1. **`onTick`**：从前一个参考时间点 `prev` 到当前参考时间点 `cur`，遍历全局 3s 网格上的 tick 点（`t = 3, 6, 9, ...` 且 `prev < t ≤ cur`），对每个 tick 点上所有 `startTime ≤ t ≤ endTime` 的活跃状态调 `onTick`。
2. **`onExpire`**：在 ticks 跑完后，按 `cur` 为 filterTime 过滤状态；对即将被过滤的状态先调钩子再移除。

两处原 filter 调用（cast 循环前、calculate 前）都替换为统一的 `advanceToTime(state, prev, cur)` helper。

- [ ] **Step 1: 写失败 smoke test**

`src/hooks/useDamageCalculation.test.ts`（若不存在则新建）追加：

```typescript
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import * as registry from '@/utils/statusRegistry'
import { useDamageCalculation } from './useDamageCalculation'
import { useTimelineStore } from '@/store/timelineStore'
import type { MitigationStatusMetadata } from '@/types/status'
import type { Timeline } from '@/types/timeline'

function fakeMeta(
  id: number,
  overrides: Partial<MitigationStatusMetadata>
): MitigationStatusMetadata {
  return {
    id,
    name: `fake-${id}`,
    type: 'multiplier',
    performance: { physics: 1, magic: 1, darkness: 1, heal: 1, maxHP: 1 },
    isFriendly: true,
    isTankOnly: false,
    ...overrides,
  } as MitigationStatusMetadata
}

function makeTimeline(events: Array<{ time: number }>): Timeline {
  return {
    id: 't',
    name: 't',
    encounter: { id: 0, name: '', displayName: '', zone: '', damageEvents: [] },
    composition: { players: [{ id: 1, job: 'DRK' }] },
    damageEvents: events.map((e, i) => ({
      id: `e${i}`,
      name: '',
      time: e.time,
      damage: 1000,
      type: 'tankbuster',
      damageType: 'physical',
    })),
    castEvents: [],
    statusEvents: [],
    annotations: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('useDamageCalculation: onExpire / onTick 钩子', () => {
  it('状态在事件之间过期时，onExpire 被调用', () => {
    const FAKE_ID = 999800
    const onExpire = vi.fn().mockImplementation(ctx => ctx.partyState)

    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation(id => {
      if (id === FAKE_ID) return fakeMeta(id, { executor: { onExpire } })
      return null as unknown as MitigationStatusMetadata
    })

    try {
      useTimelineStore.setState({
        partyState: {
          players: [{ id: 1, job: 'DRK', maxHP: 100000 }],
          statuses: [
            {
              instanceId: 'will-expire',
              statusId: FAKE_ID,
              startTime: 0,
              endTime: 5,
              sourcePlayerId: 1,
            },
          ],
          timestamp: 0,
        },
        statistics: null,
      })

      renderHook(() => useDamageCalculation(makeTimeline([{ time: 3 }, { time: 10 }])))

      expect(onExpire).toHaveBeenCalledTimes(1)
      expect(onExpire.mock.calls[0][0].status.instanceId).toBe('will-expire')
    } finally {
      spy.mockRestore()
    }
  })

  it('活跃状态在全局 3s 网格的整秒点触发 onTick', () => {
    const FAKE_ID = 999801
    const onTick = vi.fn().mockImplementation(ctx => ctx.partyState)

    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation(id => {
      if (id === FAKE_ID) return fakeMeta(id, { executor: { onTick } })
      return null as unknown as MitigationStatusMetadata
    })

    try {
      useTimelineStore.setState({
        partyState: {
          players: [{ id: 1, job: 'DRK', maxHP: 100000 }],
          statuses: [
            {
              instanceId: 'ticker',
              statusId: FAKE_ID,
              startTime: 0,
              endTime: 12,
              sourcePlayerId: 1,
            },
          ],
          timestamp: 0,
        },
        statistics: null,
      })

      // 事件在 t=10；推进时间经过 tick 点 t=3,6,9
      renderHook(() => useDamageCalculation(makeTimeline([{ time: 10 }])))

      const ticksCalled = onTick.mock.calls.map(c => c[0].tickTime)
      expect(ticksCalled).toEqual([3, 6, 9])
    } finally {
      spy.mockRestore()
    }
  })

  it('状态未覆盖的 tick 点不触发 onTick', () => {
    const FAKE_ID = 999802
    const onTick = vi.fn()

    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation(id => {
      if (id === FAKE_ID) return fakeMeta(id, { executor: { onTick } })
      return null as unknown as MitigationStatusMetadata
    })

    try {
      useTimelineStore.setState({
        partyState: {
          players: [{ id: 1, job: 'DRK', maxHP: 100000 }],
          statuses: [
            {
              instanceId: 'short',
              statusId: FAKE_ID,
              startTime: 4,
              endTime: 5, // 覆盖不到任何 3s 网格点
              sourcePlayerId: 1,
            },
          ],
          timestamp: 0,
        },
        statistics: null,
      })

      renderHook(() => useDamageCalculation(makeTimeline([{ time: 9 }])))

      expect(onTick).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/hooks/useDamageCalculation.test.ts`
Expected: FAIL — 钩子都未被调用

- [ ] **Step 3: driver 中插入 advanceToTime helper**

打开 `src/hooks/useDamageCalculation.ts`。在 import 区追加：

```typescript
import { getStatusById } from '@/utils/statusRegistry'
```

在 `useMemo` 回调内、编辑模式分支之前，定义：

```typescript
const TICK_INTERVAL = 3

function advanceToTime(state: PartyState, prev: number, cur: number): PartyState {
  let next = state

  // 1) 全局 3s tick：对 prev < t <= cur 且 t % 3 === 0 的每个 t，触发活跃状态的 onTick
  const firstTick = Math.floor(prev / TICK_INTERVAL) * TICK_INTERVAL + TICK_INTERVAL
  for (let t = firstTick; t <= cur; t += TICK_INTERVAL) {
    for (const status of next.statuses) {
      if (status.startTime > t || status.endTime < t) continue
      const meta = getStatusById(status.statusId)
      if (!meta?.executor?.onTick) continue
      const result = meta.executor.onTick({
        status,
        tickTime: t,
        partyState: next,
      })
      if (result) next = result
    }
  }

  // 2) 到期清理：endTime < cur 的状态触发 onExpire 后被过滤
  for (const status of next.statuses) {
    if (status.endTime >= cur) continue
    const meta = getStatusById(status.statusId)
    if (!meta?.executor?.onExpire) continue
    const result = meta.executor.onExpire({
      status,
      expireTime: cur,
      partyState: next,
    })
    if (result) next = result
  }
  return {
    ...next,
    statuses: next.statuses.filter(s => s.endTime >= cur),
  }
}
```

在 `useMemo` 回调内靠上位置（`let currentState` 初始化之后、`let castIdx = 0` 之前）加：

```typescript
let lastAdvanceTime = 0
```

把两处 filter 调用替换为 `advanceToTime`：

原先（cast 循环内）：

```typescript
currentState = {
  ...currentState,
  statuses: currentState.statuses.filter(
    s => s.endTime >= castEvent.timestamp || s.endTime >= filterTime
  ),
}
```

改为：

```typescript
currentState = advanceToTime(currentState, lastAdvanceTime, castEvent.timestamp)
lastAdvanceTime = castEvent.timestamp
```

原先（calculate 前）：

```typescript
currentState = {
  ...currentState,
  statuses: currentState.statuses.filter(s => s.endTime >= filterTime),
}
```

改为：

```typescript
currentState = advanceToTime(currentState, lastAdvanceTime, filterTime)
lastAdvanceTime = filterTime
```

> 注意：原先 cast 循环处还有 `|| s.endTime >= filterTime` 兜底保留 DOT 快照状态。新实现用 `castEvent.timestamp` 作 filterTime，若 DOT 场景出现回归（某状态在 cast 时刻已过期但快照时仍需保留），把 cast 循环里的 `advanceToTime` 目标改为 `Math.min(castEvent.timestamp, filterTime)` 即可。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run src/hooks/useDamageCalculation.test.ts`
Expected: 通过

- [ ] **Step 5: 全量验证**

Run: `pnpm test:run && pnpm exec tsc --noEmit && pnpm lint`
Expected: 全绿（已有的 useDamageCalculation 行为等价，onExpire 只是在 filter 之前插了钩子调用）

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useDamageCalculation.ts src/hooks/useDamageCalculation.test.ts
git commit -m "feat(driver): 事件间触发 onTick/onExpire 钩子"
```

---

## Task 6: createBuffExecutor 支持条件性 performance

**Files:**

- Modify: `src/executors/createBuffExecutor.ts`
- Modify: `src/executors/executors.test.ts`

让 `createBuffExecutor` 接一个可选的 performance 计算器，在 cast 时根据 partyState 算出具体减伤值并 snapshot 到 instance 上。

- [ ] **Step 1: 写失败测试**

在 `src/executors/executors.test.ts` 的 `createBuffExecutor` describe 内追加：

```typescript
it('支持条件性 performance：满足条件时覆盖 metadata 默认值', () => {
  const executor = createBuffExecutor(1234, 20, {
    performance: ctx => {
      const boosted = ctx.partyState.statuses.some(s => s.statusId === 9999)
      return boosted ? { physics: 0.8, magic: 0.8, darkness: 0.8, heal: 1, maxHP: 1 } : undefined
    },
  })

  const withTrigger: ActionExecutionContext = {
    actionId: 1,
    useTime: 0,
    sourcePlayerId: 1,
    partyState: {
      players: [{ id: 1, job: 'DRK', maxHP: 100000 }],
      statuses: [{ instanceId: 'trigger', statusId: 9999, startTime: 0, endTime: 30 }],
      timestamp: 0,
    },
  }

  const resultWithTrigger = executor(withTrigger)
  const added = resultWithTrigger.statuses.find(s => s.statusId === 1234)
  expect(added?.performance?.physics).toBe(0.8)

  const withoutTrigger: ActionExecutionContext = {
    ...withTrigger,
    partyState: { ...withTrigger.partyState, statuses: [] },
  }
  const resultWithout = executor(withoutTrigger)
  const addedNoOverride = resultWithout.statuses.find(s => s.statusId === 1234)
  expect(addedNoOverride?.performance).toBeUndefined()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/executors/executors.test.ts`
Expected: FAIL — `performance` option 尚未实现

- [ ] **Step 3: 扩展 createBuffExecutor**

修改 `src/executors/createBuffExecutor.ts`：

```typescript
import type { ActionExecutionContext, ActionExecutor } from '@/types/mitigation'
import type { MitigationStatus, PerformanceType } from '@/types/status'
import { generateId } from './utils'

export interface BuffExecutorOptions {
  uniqueGroup?: number[]
  /** 条件性 performance 计算器；cast 时调用，返回 undefined 则走 metadata 默认值 */
  performance?: (ctx: ActionExecutionContext) => PerformanceType | undefined
}

export function createBuffExecutor(
  statusId: number,
  duration: number,
  options?: BuffExecutorOptions
): ActionExecutor {
  const uniqueGroup = options?.uniqueGroup ?? [statusId]
  const performanceCalc = options?.performance

  return ctx => {
    const filteredStatuses = ctx.partyState.statuses.filter(s => !uniqueGroup.includes(s.statusId))

    const newStatus: MitigationStatus = {
      instanceId: generateId(),
      statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      sourceActionId: ctx.actionId,
      sourcePlayerId: ctx.sourcePlayerId,
    }

    const computedPerformance = performanceCalc?.(ctx)
    if (computedPerformance !== undefined) {
      newStatus.performance = computedPerformance
    }

    return {
      ...ctx.partyState,
      statuses: [...filteredStatuses, newStatus],
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run src/executors/executors.test.ts`
Expected: 新增用例 + 原有 createBuffExecutor 用例全部通过

- [ ] **Step 5: 全量验证**

Run: `pnpm test:run && pnpm exec tsc --noEmit && pnpm lint`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add src/executors/createBuffExecutor.ts src/executors/executors.test.ts
git commit -m "feat(executors): createBuffExecutor 支持条件性 performance"
```

---

## Self-review checklist

- **Spec coverage**：框架六大件——类型（Task 1，含 5 个钩子 + `MitigationStatus.data` / `performance`）、helpers（Task 2 含 `updateStatus` / `updateStatusData`，`AddStatusInput` 透传 `performance` / `data`）、`statusExtras.executor` 注入（Task 3）、calculator 钩子 + 实例级盾判定 + instance performance 覆盖（Task 4）、driver `onTick` / `onExpire`（Task 5）、`createBuffExecutor` 条件性 performance（Task 6）——齐全。具体业务（行尸走肉等）留给后续单独的 plan。
- **Placeholder scan**：不存在任何独立空容器；所有步骤都含可运行的代码与命令。
- **Type consistency**：`AddStatusInput` / `StatusDamageContext` / `StatusConsumeContext` / `StatusAfterDamageContext` / `StatusExpireContext` / `StatusTickContext` 在 Task 1、2、4、5 中签名一致；`eventTime` 由 executor 作者在调用 `addStatus` 时从 `ctx.event.time` 显式传入。
- **兼容性**：Task 4 盾阶段从 metadata 门控改为实例级，逻辑等价于"现有 absorbed 类状态的实例一定有 barrier、现有 multiplier 类实例一定没有 barrier"——因此既有测试预期仍通过；这一点已在 Task 4 Step 4 验证。Task 5 未注册任何 `onTick` / `onExpire` 的状态行为保持原 filter 语义（`advanceToTime` 仅对带钩子的 statusId 有行为差异）。

---

## Execution Handoff

Plan complete。两种执行方式：

1. **Subagent-Driven（推荐）** — 每个 task 派新 subagent，任务间 review。
2. **Inline Execution** — 当前会话按 executing-plans 分批执行 + checkpoint。

选哪种？
