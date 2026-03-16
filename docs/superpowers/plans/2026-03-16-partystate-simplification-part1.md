# PartyState 简化实现计划 (Part 1)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 简化 PartyState 结构，分离编辑模式和回放模式的数据流

**Architecture:**
- 编辑模式使用简化的 `PartyState`（单个玩家 + 全局状态）
- 回放模式直接从 `StatusEvent[]` 计算，不构建 PartyState
- 删除 `isPartyWide` 参数，简化执行器逻辑

**Tech Stack:** TypeScript, Zustand, Vitest

---

## 文件结构

### 修改文件
- `src/types/partyState.ts` - 简化类型定义
- `src/executors/createFriendlyBuffExecutor.ts` - 删除 `isPartyWide` 参数
- `src/executors/createShieldExecutor.ts` - 删除 `isPartyWide` 参数
- `src/executors/createEnemyDebuffExecutor.ts` - 修改为添加到全局状态

### 测试文件
- `src/executors/executors.test.ts` - 更新执行器测试

---

## Chunk 1: 类型定义和执行器重构

### Task 1: 更新 PartyState 类型定义

**Files:**
- Modify: `src/types/partyState.ts`

- [ ] **Step 1: 简化 PartyState 类型**

修改 `src/types/partyState.ts`:

```typescript
/**
 * 小队状态类型定义（编辑模式专用）
 */

import type { Job } from './mitigation'
import type { MitigationStatus } from './status'

/**
 * 小队状态
 */
export interface PartyState {
  /** 单个代表玩家 */
  player: PlayerState
  /** 全局状态列表（友方 Buff + 敌方 Debuff） */
  statuses: MitigationStatus[]
  /** 当前时间戳（秒） */
  timestamp: number
}

/**
 * 玩家状态
 */
export interface PlayerState {
  /** 玩家 ID（对应 FFLogsActor.id） */
  id: number
  /** 职业 */
  job: Job
  /** 当前 HP */
  currentHP: number
  /** 最大 HP */
  maxHP: number
  /** 玩家身上的状态列表 */
  statuses: MitigationStatus[]
}
```

- [ ] **Step 2: 运行类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: 类型错误（后续任务会修复）

- [ ] **Step 3: Commit**

```bash
git add src/types/partyState.ts
git commit -m "refactor: 简化 PartyState 类型定义"
```

---

### Task 2: 更新友方 Buff 执行器

**Files:**
- Modify: `src/executors/createFriendlyBuffExecutor.ts`
- Test: `src/executors/executors.test.ts`

- [ ] **Step 1: 编写失败的测试**

在 `src/executors/executors.test.ts` 中添加:

```typescript
describe('createFriendlyBuffExecutor (simplified)', () => {
  it('should add buff to single player', () => {
    const executor = createFriendlyBuffExecutor(1176, 5)

    const ctx: ActionExecutionContext = {
      actionId: 7382,
      useTime: 10,
      partyState: {
        player: {
          id: 1,
          job: 'PLD',
          currentHP: 50000,
          maxHP: 50000,
          statuses: [],
        },
        statuses: [],
        timestamp: 10,
      },
      sourcePlayerId: 1,
    }

    const result = executor(ctx)

    expect(result.player.statuses).toHaveLength(1)
    expect(result.player.statuses[0].statusId).toBe(1176)
    expect(result.player.statuses[0].startTime).toBe(10)
    expect(result.player.statuses[0].endTime).toBe(15)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test executors.test.ts -t "createFriendlyBuffExecutor (simplified)"
```

Expected: FAIL

- [ ] **Step 3: 简化执行器实现**

修改 `src/executors/createFriendlyBuffExecutor.ts`:

```typescript
/**
 * 友方 Buff 执行器工厂
 */

import type { ActionExecutor } from '@/types/mitigation'
import type { MitigationStatus } from '@/types/status'
import { generateId } from './utils'

/**
 * 创建友方 Buff 执行器
 * @param statusId 状态 ID
 * @param duration 持续时间（秒）
 * @returns 技能执行器
 */
export function createFriendlyBuffExecutor(
  statusId: number,
  duration: number
): ActionExecutor {
  return ctx => {
    const newStatus: MitigationStatus = {
      instanceId: generateId(),
      statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      sourceActionId: ctx.actionId,
      sourcePlayerId: ctx.partyState.player.id,
    }

    return {
      ...ctx.partyState,
      player: {
        ...ctx.partyState.player,
        statuses: [...ctx.partyState.player.statuses, newStatus],
      },
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test executors.test.ts -t "createFriendlyBuffExecutor (simplified)"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/executors/createFriendlyBuffExecutor.ts src/executors/executors.test.ts
git commit -m "refactor: 简化友方 Buff 执行器，删除 isPartyWide 参数"
```

---

### Task 3: 更新盾值执行器

**Files:**
- Modify: `src/executors/createShieldExecutor.ts`
- Test: `src/executors/executors.test.ts`

- [ ] **Step 1: 编写失败的测试**

在 `src/executors/executors.test.ts` 中添加:

```typescript
describe('createShieldExecutor (simplified)', () => {
  it('should add shield to single player', () => {
    const executor = createShieldExecutor(1362, 30, 0.1)

    const ctx: ActionExecutionContext = {
      actionId: 3540,
      useTime: 10,
      partyState: {
        player: {
          id: 1,
          job: 'PLD',
          currentHP: 50000,
          maxHP: 50000,
          statuses: [],
        },
        statuses: [],
        timestamp: 10,
      },
      sourcePlayerId: 1,
    }

    const result = executor(ctx)

    expect(result.player.statuses).toHaveLength(1)
    expect(result.player.statuses[0].statusId).toBe(1362)
    expect(result.player.statuses[0].remainingBarrier).toBe(5000)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test executors.test.ts -t "createShieldExecutor (simplified)"
```

Expected: FAIL

- [ ] **Step 3: 简化执行器实现**

修改 `src/executors/createShieldExecutor.ts`:

```typescript
/**
 * 盾值执行器工厂
 */

import type { ActionExecutor } from '@/types/mitigation'
import type { MitigationStatus } from '@/types/status'
import { generateId } from './utils'

/**
 * 创建盾值执行器
 * @param statusId 状态 ID
 * @param duration 持续时间（秒）
 * @param shieldMultiplier 盾值倍率（相对于目标最大 HP，默认 0.1）
 * @returns 技能执行器
 */
export function createShieldExecutor(
  statusId: number,
  duration: number,
  shieldMultiplier: number = 0.1
): ActionExecutor {
  return ctx => {
    const barrier =
      ctx.statistics?.shieldByAbility[statusId] ??
      (ctx.partyState.player.maxHP * shieldMultiplier || 10000)

    const newStatus: MitigationStatus = {
      instanceId: generateId(),
      statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      sourceActionId: ctx.actionId,
      sourcePlayerId: ctx.partyState.player.id,
      remainingBarrier: barrier,
    }

    return {
      ...ctx.partyState,
      player: {
        ...ctx.partyState.player,
        statuses: [...ctx.partyState.player.statuses, newStatus],
      },
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test executors.test.ts -t "createShieldExecutor (simplified)"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/executors/createShieldExecutor.ts src/executors/executors.test.ts
git commit -m "refactor: 简化盾值执行器，删除 isPartyWide 参数"
```

---

### Task 4: 更新敌方 Debuff 执行器

**Files:**
- Modify: `src/executors/createEnemyDebuffExecutor.ts`
- Test: `src/executors/executors.test.ts`

- [ ] **Step 1: 编写失败的测试**

在 `src/executors/executors.test.ts` 中添加:

```typescript
describe('createEnemyDebuffExecutor (simplified)', () => {
  it('should add debuff to global statuses', () => {
    const executor = createEnemyDebuffExecutor(1193, 15)

    const ctx: ActionExecutionContext = {
      actionId: 7535,
      useTime: 10,
      partyState: {
        player: {
          id: 1,
          job: 'WAR',
          currentHP: 50000,
          maxHP: 50000,
          statuses: [],
        },
        statuses: [],
        timestamp: 10,
      },
      sourcePlayerId: 1,
    }

    const result = executor(ctx)

    expect(result.statuses).toHaveLength(1)
    expect(result.statuses[0].statusId).toBe(1193)
    expect(result.statuses[0].startTime).toBe(10)
    expect(result.statuses[0].endTime).toBe(25)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test executors.test.ts -t "createEnemyDebuffExecutor (simplified)"
```

Expected: FAIL

- [ ] **Step 3: 修改执行器实现**

修改 `src/executors/createEnemyDebuffExecutor.ts`:

```typescript
/**
 * 敌方 Debuff 执行器工厂
 */

import type { ActionExecutor } from '@/types/mitigation'
import type { MitigationStatus } from '@/types/status'
import { generateId } from './utils'

/**
 * 创建敌方 Debuff 执行器
 * @param statusId 状态 ID
 * @param duration 持续时间（秒）
 * @returns 技能执行器
 */
export function createEnemyDebuffExecutor(statusId: number, duration: number): ActionExecutor {
  return ctx => {
    const newStatus: MitigationStatus = {
      instanceId: generateId(),
      statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      sourceActionId: ctx.actionId,
    }

    return {
      ...ctx.partyState,
      statuses: [...ctx.partyState.statuses, newStatus],
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test executors.test.ts -t "createEnemyDebuffExecutor (simplified)"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/executors/createEnemyDebuffExecutor.ts src/executors/executors.test.ts
git commit -m "refactor: 修改敌方 Debuff 执行器，添加到全局状态"
```

---

### Task 5: 更新技能数据中的执行器调用

**Files:**
- Modify: `src/data/mitigationActions.ts:151`

- [ ] **Step 1: 删除 isPartyWide 参数**

修改 `src/data/mitigationActions.ts` 第 151 行:

```typescript
// 之前
executor: createFriendlyBuffExecutor(1896, 15, false),

// 之后
executor: createFriendlyBuffExecutor(1896, 15),
```

- [ ] **Step 2: 运行类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: 无类型错误（或更少的错误）

- [ ] **Step 3: Commit**

```bash
git add src/data/mitigationActions.ts
git commit -m "refactor: 删除技能数据中的 isPartyWide 参数"
```

---

## 总结

Part 1 完成了执行器层的重构，删除了 `isPartyWide` 参数，简化了状态管理逻辑。

**下一步**: Part 2 将重构计算器和状态管理层。
