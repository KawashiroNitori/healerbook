# PartyState 简化实现计划 (Part 1)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 简化 PartyState 结构，分离编辑模式和回放模式的数据流

**Architecture:**

- 编辑模式使用简化的 `PartyState`（单个玩家，所有状态统一挂在 `player.statuses`）
- 回放模式直接从 `StatusEvent[]` 计算，不构建 PartyState
- 删除 `isPartyWide` 参数，删除 `EnemyState` 和独立的 `statuses` 全局字段

**Tech Stack:** TypeScript, Zustand, Vitest

---

## 文件结构

### 修改文件

- `src/types/partyState.ts` - 简化类型定义，删除 `EnemyState` 和 `statuses` 字段
- `src/executors/createBuffExecutor.ts` - 删除 `isPartyWide` 参数
- `src/executors/createShieldExecutor.ts` - 删除 `isPartyWide` 参数
- `src/data/mitigationActions.ts` - 替换 `createEnemyDebuffExecutor`，删除 `isPartyWide` 参数

### 删除文件

- `src/executors/createEnemyDebuffExecutor.ts` - 删除，统一使用 `createBuffExecutor` 替代

### 测试文件

- `src/executors/executors.test.ts` - 更新执行器测试

---

## Chunk 1: 类型定义和执行器重构

### Task 1: 更新 PartyState 类型定义

**Files:**

- Modify: `src/types/partyState.ts`

- [ ] **Step 1: 简化 PartyState 类型**

修改 `src/types/partyState.ts`（完整替换文件内容）:

```typescript
/**
 * 小队状态类型定义（编辑模式专用）
 */

import type { Job } from './mitigation'
import type { MitigationStatus } from './status'

/**
 * 小队状态（编辑模式）
 * 所有状态统一存放在 player.statuses 中，不再区分友方/敌方
 */
export interface PartyState {
  /** 单个代表玩家 */
  player: PlayerState
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
  /** 所有状态列表（包含友方 Buff 和原敌方 Debuff） */
  statuses: MitigationStatus[]
}
```

- [ ] **Step 2: 运行类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: 出现类型错误（后续任务会修复）

- [ ] **Step 3: Commit**

```bash
git add src/types/partyState.ts
git commit -m "refactor: 简化 PartyState 类型，删除 EnemyState 和全局 statuses 字段"
```

---

### Task 2: 更新友方 Buff 执行器

**Files:**

- Modify: `src/executors/createBuffExecutor.ts`
- Test: `src/executors/executors.test.ts`

- [ ] **Step 1: 编写失败的测试**

在 `src/executors/executors.test.ts` 中添加:

```typescript
describe('createBuffExecutor (simplified)', () => {
  it('should add buff to player statuses', () => {
    const executor = createBuffExecutor(1176, 5)

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
pnpm test executors.test.ts -t "createBuffExecutor (simplified)"
```

Expected: FAIL

- [ ] **Step 3: 简化执行器实现**

修改 `src/executors/createBuffExecutor.ts`:

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
export function createBuffExecutor(statusId: number, duration: number): ActionExecutor {
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
pnpm test executors.test.ts -t "createBuffExecutor (simplified)"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/executors/createBuffExecutor.ts src/executors/executors.test.ts
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
  it('should add shield to player statuses', () => {
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

### Task 4: 删除敌方 Debuff 执行器并更新技能数据

**Files:**

- Delete: `src/executors/createEnemyDebuffExecutor.ts`
- Modify: `src/executors/index.ts`
- Modify: `src/data/mitigationActions.ts`

- [ ] **Step 1: 检查 createEnemyDebuffExecutor 的使用情况**

```bash
grep -n "createEnemyDebuffExecutor" src/data/mitigationActions.ts
```

Expected: 找到所有使用该执行器的技能（如雪仇）

- [ ] **Step 2: 在 mitigationActions.ts 中做两件事**

2a. 将所有 `createEnemyDebuffExecutor(...)` 替换为 `createBuffExecutor(...)`:

```typescript
// 之前
executor: createEnemyDebuffExecutor(1193, 15),

// 之后
executor: createBuffExecutor(1193, 15),
```

2b. 删除唯一的 `isPartyWide: false` 参数（第 151 行附近的秘策技能）:

```typescript
// 之前
executor: createBuffExecutor(1896, 15, false),

// 之后
executor: createBuffExecutor(1896, 15),
```

2c. 删除 `createEnemyDebuffExecutor` 的 import

- [ ] **Step 3: 从 executors/index.ts 中删除导出**

```typescript
// 删除这一行
export { createEnemyDebuffExecutor } from './createEnemyDebuffExecutor'
```

- [ ] **Step 4: 删除文件**

```bash
rm src/executors/createEnemyDebuffExecutor.ts
```

- [ ] **Step 5: 运行类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: 无新增类型错误

- [ ] **Step 6: 运行测试**

```bash
pnpm test executors.test.ts
pnpm test mitigationActions.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: 删除敌方 Debuff 执行器，统一使用友方 Buff，删除 isPartyWide 参数"
```

---

## 总结

Part 1 完成执行器层重构：

- `PartyState` 简化为 `{ player, timestamp }`，删除 `EnemyState` 和全局 `statuses`
- 删除 `createEnemyDebuffExecutor`，所有状态统一挂在 `player.statuses`
- 删除 `isPartyWide` 参数

**下一步**: Part 2 重构计算器层。
