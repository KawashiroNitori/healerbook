# PartyState 简化实现计划 (Part 3)

## Chunk 3: 状态管理和 Hook 更新

### Task 7: 更新 timelineStore

**Files:**

- Modify: `src/store/timelineStore.ts`
- Test: `src/store/timelineStore.test.ts`

- [ ] **Step 1: 删除 buildPartyStateFromStatusEvents 函数**

在 `src/store/timelineStore.ts` 中删除整个 `buildPartyStateFromStatusEvents` 函数（第 17-74 行）

- [ ] **Step 2: 更新 initializePartyState 方法**

```typescript
initializePartyState: (composition: Composition) => {
  const { statistics } = get()
  if (!composition.players || composition.players.length === 0) {
    set({ partyState: null })
    return
  }

  // 使用第一个玩家作为代表
  const representative = composition.players[0]
  const maxHP = statistics?.maxHPByJob[representative.job] ?? 100000

  const partyState: PartyState = {
    player: {
      id: representative.id,
      job: representative.job,
      currentHP: maxHP,
      maxHP,
      statuses: [],
    },
    timestamp: 0,
  }

  set({ partyState })
},
```

- [ ] **Step 3: 删除 getPartyStateAtTime 方法**

删除 `getPartyStateAtTime` 方法及其在 `TimelineState` 接口中的声明

- [ ] **Step 4: 更新 exitReplayMode 方法**

确认 `exitReplayMode` 在退出回放后重新初始化小队状态（当前代码已正确，无需修改）

- [ ] **Step 5: 删除 executeAction 和 cleanupExpiredStatuses 方法中对 `enemy` 的引用**

检查并删除所有对 `partyState.enemy` 和 `partyState.players` 的引用：

```bash
grep -n "\.enemy\|\.players" src/store/timelineStore.ts
```

- [ ] **Step 6: 运行类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: 类型错误减少

- [ ] **Step 7: 更新 store 测试**

在 `src/store/timelineStore.test.ts` 中将旧 PartyState 结构更新为新结构:

```typescript
// 旧结构
{
  players: [{ id: 1, job: 'PLD', currentHP: 100000, maxHP: 100000, statuses: [] }],
  enemy: { statuses: [] },
  timestamp: 0,
}

// 新结构
{
  player: { id: 1, job: 'PLD', currentHP: 100000, maxHP: 100000, statuses: [] },
  timestamp: 0,
}
```

- [ ] **Step 8: 运行 store 测试**

```bash
pnpm test timelineStore.test.ts
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "refactor: 更新 timelineStore，删除回放模式的 PartyState 构建"
```

---

### Task 8: 更新 useDamageCalculation Hook

**Files:**

- Modify: `src/hooks/useDamageCalculation.ts`

- [ ] **Step 1: 重写 Hook，分离编辑模式和回放模式**

修改 `src/hooks/useDamageCalculation.ts`:

```typescript
export function useDamageCalculation(timeline: Timeline | null): Map<string, CalculationResult> {
  const partyState = useTimelineStore(state => state.partyState)
  const statistics = useTimelineStore(state => state.statistics)

  return useMemo(() => {
    const results = new Map<string, CalculationResult>()

    if (!timeline) return results

    const calculator = new MitigationCalculator()

    // 编辑模式：使用 PartyState，单次时间轴扫描
    if (!timeline.isReplayMode) {
      if (!partyState) return results

      const sortedDamageEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)
      const sortedCastEvents = [...(timeline.castEvents || [])].sort(
        (a, b) => a.timestamp - b.timestamp
      )

      let currentState: PartyState = {
        player: { ...partyState.player, statuses: [] },
        timestamp: 0,
      }

      let castIdx = 0

      for (const event of sortedDamageEvents) {
        // 应用所有在此伤害事件之前的技能
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

        const result = calculator.calculate(
          event.damage,
          currentState,
          event.time,
          event.damageType || 'physical'
        )

        results.set(event.id, result)
        // updatedPartyState 一定存在（编辑模式下 calculate 总会返回它）
        if (result.updatedPartyState) {
          currentState = result.updatedPartyState
        }
      }

      return results
    }

    // 回放模式：直接从 StatusEvent[] 计算，无需 PartyState
    if (!timeline.statusEvents) return results

    const sortedDamageEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)

    for (const event of sortedDamageEvents) {
      if (!event.packetId) {
        results.set(event.id, {
          originalDamage: event.damage,
          finalDamage: event.damage,
          mitigationPercentage: 0,
          appliedStatuses: [],
        })
        continue
      }

      // 取第一个受击玩家作为代表（非坦克优先，与 parseDamageEvents 逻辑一致）
      const targetPlayerId = event.playerDamageDetails?.[0]?.playerId ?? 0

      const result = calculator.calculateFromSnapshot(
        event.damage,
        timeline.statusEvents,
        event.packetId,
        event.damageType || 'physical',
        targetPlayerId
      )

      results.set(event.id, result)
    }

    return results
  }, [timeline, partyState, statistics])
}
```

- [ ] **Step 2: 运行类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useDamageCalculation.ts
git commit -m "refactor: 分离编辑模式和回放模式的计算逻辑"
```

---

## Chunk 4: 清理和最终验证

### Task 9: 删除 mitigationStore 中的 isPartyWide 逻辑

**Files:**

- Modify: `src/store/mitigationStore.ts`

- [ ] **Step 1: 删除 isPartyWide 过滤器字段**

```typescript
// 删除前
filters: {
  jobs: Job[]
  isPartyWide: boolean | null
}

// 删除后
filters: {
  jobs: Job[]
}
```

- [ ] **Step 2: 删除 setPartyWideFilter 方法及其声明**

- [ ] **Step 3: 清理 getFilteredActions**

```typescript
getFilteredActions: () => {
  const { actions, filters } = get()
  if (filters.jobs.length === 0) return actions
  return actions.filter(action => filters.jobs.some(job => action.jobs.includes(job)))
},
```

- [ ] **Step 4: 运行类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 5: Commit**

```bash
git add src/store/mitigationStore.ts
git commit -m "refactor: 删除 mitigationStore 中的 isPartyWide 过滤器"
```

---

### Task 10: 更新旧测试用例

**Files:**

- Modify: `src/executors/executors.test.ts`
- Modify: `src/utils/mitigationCalculator.test.ts`

- [ ] **Step 1: 更新执行器测试中的旧 PartyState 结构**

在 `src/executors/executors.test.ts` 中，将所有使用旧结构的测试改为新结构:

```typescript
// 旧结构
const partyState = {
  players: [{ id: 1, job: 'PLD', currentHP: 50000, maxHP: 50000, statuses: [] }],
  enemy: { statuses: [] },
  timestamp: 0,
}

// 新结构
const partyState = {
  player: { id: 1, job: 'PLD', currentHP: 50000, maxHP: 50000, statuses: [] },
  timestamp: 0,
}
```

- [ ] **Step 2: 运行执行器测试**

```bash
pnpm test executors.test.ts
```

Expected: PASS

- [ ] **Step 3: 更新计算器测试中的旧结构**

同样替换 `src/utils/mitigationCalculator.test.ts` 中所有旧 PartyState 结构

- [ ] **Step 4: 运行计算器测试**

```bash
pnpm test mitigationCalculator.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/executors/executors.test.ts src/utils/mitigationCalculator.test.ts
git commit -m "test: 更新测试用例以使用简化的 PartyState"
```

---

### Task 11: 最终验证

**Files:**

- All modified files

- [ ] **Step 1: 运行完整测试套件**

```bash
pnpm test:run
```

Expected: 所有测试通过

- [ ] **Step 2: 运行类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 3: 运行 lint**

```bash
pnpm lint
```

Expected: 无 lint 错误

- [ ] **Step 4: 生成覆盖率报告**

```bash
pnpm test:run --coverage
```

Expected: 覆盖率保持或提高

- [ ] **Step 5: 构建验证**

```bash
pnpm build
```

Expected: 构建成功

- [ ] **Step 6: 最终 Commit**

```bash
git add .
git commit -m "chore: PartyState 简化重构完成"
```

---

## 验证清单

- [ ] `PartyState` 不再有 `players` 数组和 `enemy` 字段
- [ ] `createEnemyDebuffExecutor` 文件已删除
- [ ] 所有技能的 `isPartyWide` 参数已删除
- [ ] `CalculationResult.updatedPartyState` 为可选字段
- [ ] 编辑模式减伤计算正常
- [ ] 回放模式减伤计算正常
- [ ] 所有测试通过，覆盖率 ≥ 67%

---

## 回滚计划

```bash
git log --oneline -15
git revert <commit-hash>
```
