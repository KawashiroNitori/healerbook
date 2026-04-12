# PartyState 简化设计

**日期**: 2026-03-16
**状态**: 已批准
**作者**: Claude Code

## 背景

当前 `PartyState` 使用 `players: PlayerState[]` 数组结构，但在编辑模式下只使用 `players[0]` 作为代表玩家。这导致：

1. 代码中大量 `players[0]` 访问和数组遍历
2. 执行器需要 `isPartyWide` 参数区分单体/群体技能
3. 编辑模式和回放模式强行复用同一数据结构，职责不清

## 核心问题

**编辑模式和回放模式的数据来源完全不同**：

- **编辑模式**: 通过 `CastEvent` + `executor` 主动构建状态
- **回放模式**: 从 FFLogs 的 `StatusEvent[]` 被动读取状态快照

强行复用同一个 `PartyState` 结构是不合适的。

## 设计目标

1. 简化编辑模式的 `PartyState` 结构，消除数组访问
2. 删除 `isPartyWide` 参数，简化执行器逻辑
3. 分离编辑模式和回放模式的数据结构和计算路径
4. 合并 `enemy.statuses` 到全局状态列表

## 设计方案

### 1. 类型定义

```typescript
// 编辑模式专用状态
interface EditorPartyState {
  player: PlayerState // 单个代表玩家
  statuses: MitigationStatus[] // 全局状态（友方 Buff + 敌方 Debuff）
  timestamp: number
}

// 回放模式不使用 PartyState
// 直接从 StatusEvent[] 和 DamageEvent.playerDamageDetails 计算
```

### 2. 状态管理

**timelineStore 变更**：

```typescript
interface TimelineState {
  timeline: Timeline | null
  partyState: EditorPartyState | null // 仅编辑模式使用
  // ... 其他字段
}

// 删除 buildPartyStateFromStatusEvents 函数
// 回放模式不再构建 PartyState
```

### 3. 执行器简化

**删除 `isPartyWide` 参数**：

```typescript
// 之前
createBuffExecutor(statusId: number, duration: number, isPartyWide: boolean = true)

// 之后
createBuffExecutor(statusId: number, duration: number)
```

**友方 Buff 执行器**：

```typescript
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

**敌方 Debuff 执行器**：

```typescript
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

**盾值执行器**：

```typescript
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

### 4. 计算器分离

**编辑模式计算器**：

```typescript
class MitigationCalculator {
  calculateFromState(
    originalDamage: number,
    partyState: EditorPartyState,
    time: number,
    damageType: DamageType = 'physical'
  ): CalculationResult {
    // 1. 获取生效的状态（玩家状态 + 全局状态）
    const playerStatuses = this.getActiveStatuses([{ statuses: partyState.player.statuses }], time)
    const globalStatuses = this.getActiveStatuses([{ statuses: partyState.statuses }], time)

    // 2. 计算百分比减伤
    let multiplier = 1.0
    const appliedStatuses: MitigationStatus[] = []

    for (const status of [...playerStatuses, ...globalStatuses]) {
      const meta = getStatusById(status.statusId)
      if (!meta || meta.type !== 'multiplier') continue

      const damageMultiplier = this.getDamageMultiplier(meta.performance, damageType)
      multiplier *= damageMultiplier
      appliedStatuses.push(status)
    }

    let damage = originalDamage * multiplier

    // 3. 计算盾值减伤
    const statusUpdates = new Map<string, number>()
    let playerDamage = damage

    for (const status of partyState.player.statuses) {
      const meta = getStatusById(status.statusId)
      if (!meta || meta.type !== 'absorbed') continue
      if (!status.remainingBarrier || status.remainingBarrier <= 0) continue
      if (time < status.startTime || time > status.endTime) continue

      const absorbed = Math.min(playerDamage, status.remainingBarrier)
      playerDamage -= absorbed
      appliedStatuses.push(status)
      statusUpdates.set(status.instanceId, status.remainingBarrier - absorbed)
    }

    damage = playerDamage

    // 4. 更新状态
    const updatedPartyState: EditorPartyState = {
      ...partyState,
      player: {
        ...partyState.player,
        statuses: partyState.player.statuses.map(s =>
          statusUpdates.has(s.instanceId)
            ? { ...s, remainingBarrier: statusUpdates.get(s.instanceId) }
            : s
        ),
      },
    }

    return {
      originalDamage,
      finalDamage: Math.round(damage),
      mitigationPercentage: Math.round((1 - damage / originalDamage) * 100),
      appliedStatuses,
      updatedPartyState,
    }
  }
}
```

**回放模式计算器**：

```typescript
class MitigationCalculator {
  calculateFromSnapshot(
    originalDamage: number,
    statusEvents: StatusEvent[],
    packetId: number,
    damageType: DamageType,
    targetPlayerId: number
  ): CalculationResult {
    // 1. 过滤该 packetId 的状态事件
    const activeStatusEvents = statusEvents.filter(
      event =>
        event.packetId === packetId &&
        (event.targetPlayerId === targetPlayerId || !event.targetPlayerId)
    )

    // 2. 转换为 MitigationStatus
    const statuses: MitigationStatus[] = []
    for (const event of activeStatusEvents) {
      const statusMeta = getStatusById(event.statusId)
      if (!statusMeta) continue

      statuses.push({
        instanceId: `${event.targetPlayerId}-${event.statusId}-${event.targetInstance || 0}`,
        statusId: event.statusId,
        startTime: event.startTime,
        endTime: event.endTime,
        sourcePlayerId: event.sourcePlayerId,
        remainingBarrier: statusMeta.type === 'absorbed' && event.absorb ? event.absorb : undefined,
      })
    }

    // 3. 计算百分比减伤
    let multiplier = 1.0
    const appliedStatuses: MitigationStatus[] = []

    for (const status of statuses) {
      const meta = getStatusById(status.statusId)
      if (!meta || meta.type !== 'multiplier') continue

      const damageMultiplier = this.getDamageMultiplier(meta.performance, damageType)
      multiplier *= damageMultiplier
      appliedStatuses.push(status)
    }

    let damage = originalDamage * multiplier

    // 4. 计算盾值减伤
    for (const status of statuses) {
      const meta = getStatusById(status.statusId)
      if (!meta || meta.type !== 'absorbed') continue
      if (!status.remainingBarrier || status.remainingBarrier <= 0) continue

      const absorbed = Math.min(damage, status.remainingBarrier)
      damage -= absorbed
      appliedStatuses.push(status)
    }

    return {
      originalDamage,
      finalDamage: Math.round(damage),
      mitigationPercentage: Math.round((1 - damage / originalDamage) * 100),
      appliedStatuses,
      updatedPartyState: null as any, // 回放模式不需要更新状态
    }
  }
}
```

### 5. Hook 层适配

```typescript
export function useDamageCalculation(timeline: Timeline | null): Map<string, CalculationResult> {
  const partyState = useTimelineStore(state => state.partyState)
  const statistics = useTimelineStore(state => state.statistics)

  return useMemo(() => {
    const results = new Map<string, CalculationResult>()
    if (!timeline) return results

    const calculator = new MitigationCalculator()

    // 编辑模式
    if (!timeline.isReplayMode) {
      if (!partyState) return results

      const sortedDamageEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)
      const sortedCastEvents = [...(timeline.castEvents || [])].sort(
        (a, b) => a.timestamp - b.timestamp
      )

      let currentState: EditorPartyState = {
        player: { ...partyState.player, statuses: [] },
        statuses: [],
        timestamp: 0,
      }

      let castIdx = 0

      for (const event of sortedDamageEvents) {
        // 应用技能
        while (
          castIdx < sortedCastEvents.length &&
          sortedCastEvents[castIdx].timestamp <= event.time
        ) {
          const castEvent = sortedCastEvents[castIdx]
          const action = MITIGATION_DATA.actions.find(a => a.id === castEvent.actionId)
          if (action) {
            const ctx: ActionExecutionContext = {
              actionId: castEvent.actionId,
              useTime: castEvent.timestamp,
              partyState: currentState,
              sourcePlayerId: castEvent.playerId,
              statistics: statistics ?? undefined,
            }
            currentState = action.executor(ctx)
          }
          castIdx++
        }

        const result = calculator.calculateFromState(
          event.damage,
          currentState,
          event.time,
          event.damageType || 'physical'
        )

        results.set(event.id, result)
        currentState = result.updatedPartyState
      }

      return results
    }

    // 回放模式
    const statusEvents = timeline.statusEvents || []
    const sortedEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)

    for (const event of sortedEvents) {
      if (!event.packetId || !event.targetPlayerId) {
        results.set(event.id, {
          originalDamage: event.damage,
          finalDamage: event.damage,
          mitigationPercentage: 0,
          appliedStatuses: [],
          updatedPartyState: null as any,
        })
        continue
      }

      const result = calculator.calculateFromSnapshot(
        event.damage,
        statusEvents,
        event.packetId,
        event.damageType || 'physical',
        event.targetPlayerId
      )
      results.set(event.id, result)
    }

    return results
  }, [timeline, partyState, statistics])
}
```

### 6. 数据迁移

**mitigationStore 清理**：

- 删除 `filters.isPartyWide` 字段
- 删除 `setPartyWideFilter` 方法
- 删除 `getFilteredActions` 中的 `isPartyWide` 过滤逻辑

**技能数据更新**：

- 删除所有 `createBuffExecutor` 和 `createShieldExecutor` 调用中的 `isPartyWide` 参数

## 影响范围

### 需要修改的文件

1. **类型定义**
   - `src/types/partyState.ts` - 定义 `EditorPartyState`
   - `src/types/mitigation.ts` - 更新 `ActionExecutionContext`

2. **执行器**
   - `src/executors/createBuffExecutor.ts` - 删除 `isPartyWide` 参数
   - `src/executors/createShieldExecutor.ts` - 删除 `isPartyWide` 参数
   - `src/executors/createEnemyDebuffExecutor.ts` - 修改为添加到全局状态

3. **计算器**
   - `src/utils/mitigationCalculator.ts` - 添加 `calculateFromState` 和 `calculateFromSnapshot` 方法

4. **状态管理**
   - `src/store/timelineStore.ts` - 删除 `buildPartyStateFromStatusEvents`，更新 `initializePartyState`
   - `src/store/mitigationStore.ts` - 删除 `isPartyWide` 相关逻辑

5. **Hook**
   - `src/hooks/useDamageCalculation.ts` - 分离编辑模式和回放模式逻辑

6. **技能数据**
   - `src/data/mitigationActions.ts` - 删除所有 `isPartyWide` 参数

7. **测试**
   - `src/executors/executors.test.ts` - 更新测试用例
   - `src/utils/mitigationCalculator.test.ts` - 更新测试用例
   - `src/store/timelineStore.test.ts` - 更新测试用例
   - `src/data/mitigationActions.test.ts` - 更新测试用例

## 测试策略

1. **单元测试**
   - 执行器测试：验证状态正确添加到 `player.statuses` 或 `statuses`
   - 计算器测试：分别测试 `calculateFromState` 和 `calculateFromSnapshot`
   - 状态管理测试：验证 `EditorPartyState` 的初始化和更新

2. **集成测试**
   - 编辑模式：验证技能使用 → 状态附加 → 减伤计算的完整流程
   - 回放模式：验证 FFLogs 导入 → 状态快照 → 减伤计算的完整流程

3. **回归测试**
   - 确保现有的 84 个测试全部通过
   - 覆盖率保持在 80% 以上

## 优势

1. **代码简化**：消除所有 `players[0]` 访问和数组遍历
2. **职责清晰**：编辑模式和回放模式完全分离
3. **类型安全**：`EditorPartyState` 明确表达编辑模式的数据结构
4. **性能优化**：回放模式不再需要构建 `PartyState`，直接从快照计算
5. **易于维护**：删除 `isPartyWide` 参数，简化执行器逻辑

## 风险和缓解

### 风险 1：回放模式计算精度

**风险**：直接从 `StatusEvent[]` 计算可能丢失状态之间的交互逻辑

**缓解**：FFLogs 的 `buffs` 字段已经是完整的状态快照，包含所有生效的状态，不需要模拟状态交互

### 风险 2：测试覆盖率下降

**风险**：大量代码重构可能导致测试失败

**缓解**：

- 先更新类型定义和执行器（小范围修改）
- 逐步迁移计算器和 Hook（增量修改）
- 每个阶段运行测试，确保不引入回归

### 风险 3：数据迁移

**风险**：现有的 LocalStorage 数据可能不兼容

**缓解**：

- `EditorPartyState` 只在运行时使用，不持久化
- LocalStorage 只存储 `Timeline`，不存储 `PartyState`
- 无需数据迁移

## 实施计划

### Phase 1：类型定义和执行器（1-2 小时）

1. 定义 `EditorPartyState` 类型
2. 更新执行器工厂函数
3. 更新技能数据文件
4. 运行执行器测试

### Phase 2：计算器分离（2-3 小时）

1. 添加 `calculateFromState` 方法
2. 添加 `calculateFromSnapshot` 方法
3. 更新计算器测试
4. 验证计算结果一致性

### Phase 3：状态管理和 Hook（2-3 小时）

1. 更新 `timelineStore`
2. 更新 `useDamageCalculation`
3. 删除 `buildPartyStateFromStatusEvents`
4. 运行集成测试

### Phase 4：清理和优化（1 小时）

1. 删除 `mitigationStore` 中的 `isPartyWide` 逻辑
2. 删除未使用的代码
3. 更新文档
4. 最终测试

**总计**：6-9 小时

## 后续优化

1. **类型守卫优化**：添加 `isEditorPartyState` 类型守卫
2. **性能监控**：对比重构前后的计算性能
3. **UI 适配**：更新属性面板显示单个玩家状态
4. **文档更新**：更新 CLAUDE.md 中的架构说明

## 总结

本次重构通过分离编辑模式和回放模式的数据结构，大幅简化了 `PartyState` 的设计。核心思想是：

- **编辑模式**：维护单个玩家的持续状态（`EditorPartyState`）
- **回放模式**：直接从状态快照计算，不构建 `PartyState`

这种设计更符合两种模式的实际需求，消除了不必要的复杂性，提高了代码的可维护性。
