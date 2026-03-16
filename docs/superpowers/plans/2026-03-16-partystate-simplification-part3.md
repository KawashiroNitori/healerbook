# PartyState 简化实现计划 (Part 3)

## Chunk 4: 状态管理和 Hook 更新

### Task 8: 更新 timelineStore

**Files:**
- Modify: `src/store/timelineStore.ts`
- Test: `src/store/timelineStore.test.ts`

- [ ] **Step 1: 删除 buildPartyStateFromStatusEvents 函数**

在 `src/store/timelineStore.ts` 中删除整个函数（第 17-74 行）

- [ ] **Step 2: 更新 initializePartyState 方法**

```typescript
initializePartyState: (composition: Composition) => {
  if (!composition.players || composition.players.length === 0) {
    set({ partyState: null })
    return
  }

  // 使用第一个玩家作为代表
  const representative = composition.players[0]

  const partyState: PartyState = {
    player: {
      id: representative.id,
      job: representative.job,
      currentHP: 50000,
      maxHP: 50000,
      statuses: [],
    },
    statuses: [],
    timestamp: 0,
  }

  set({ partyState })
}
```

- [ ] **Step 3: 删除 getPartyStateAtTime 方法**

回放模式不再需要此方法

- [ ] **Step 4: 更新 enterReplayMode 方法**

```typescript
enterReplayMode: (statusEvents: StatusEvent[]) => {
  set(state => {
    if (!state.timeline) return state

    return {
      timeline: {
        ...state.timeline,
        isReplayMode: true,
        statusEvents,
      },
      // 回放模式不使用 partyState
      partyState: null,
    }
  })
}
```

- [ ] **Step 5: 更新 exitReplayMode 方法**

```typescript
exitReplayMode: () => {
  set(state => {
    if (!state.timeline || !state.timeline.isReplayMode) return state

    return {
      timeline: {
        ...state.timeline,
        isReplayMode: false,
      },
    }
  })
  get().triggerAutoSave()
  // 重新初始化小队状态
  const timeline = get().timeline
  if (timeline?.composition) {
    get().initializePartyState(timeline.composition)
  }
}
```

- [ ] **Step 6: 运行类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: 类型错误减少

- [ ] **Step 7: 运行 store 测试**

```bash
pnpm test timelineStore.test.ts
```

Expected: 部分测试失败（需要更新）

- [ ] **Step 8: Commit**

```bash
git add src/store/timelineStore.ts
git commit -m "refactor: 更新 timelineStore，删除回放模式的 PartyState 构建"
```

---

### Task 9: 更新 useDamageCalculation Hook

**Files:**
- Modify: `src/hooks/useDamageCalculation.ts`

- [ ] **Step 1: 分离编辑模式和回放模式逻辑**

修改 `src/hooks/useDamageCalculation.ts`:

```typescript
export function useDamageCalculation(timeline: Timeline | null): Map<string, CalculationResult> {
  const partyState = useTimelineStore(state => state.partyState)
  const statistics = useTimelineStore(state => state.statistics)

  return useMemo(() => {
    const results = new Map<string, CalculationResult>()

    if (!timeline) return results

    const calculator = new MitigationCalculator()

    // 编辑模式：使用 PartyState
    if (!timeline.isReplayMode) {
      if (!partyState) return results

      const sortedDamageEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)
      const sortedCastEvents = [...(timeline.castEvents || [])].sort(
        (a, b) => a.timestamp - b.timestamp
      )

      let currentState: PartyState = {
        player: { ...partyState.player, statuses: [] },
        statuses: [],
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
        currentState = result.updatedPartyState
      }

      return results
    }

    // 回放模式：直接从 StatusEvent[] 计算
    if (!timeline.statusEvents) return results

    const sortedEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)

    for (const event of sortedEvents) {
      if (!event.packetId) {
        results.set(event.id, {
          originalDamage: event.damage,
          finalDamage: event.damage,
          mitigationPercentage: 0,
          appliedStatuses: [],
          updatedPartyState: partyState!,
        })
        continue
      }

      // 使用第一个玩家的伤害详��作为代表
      const targetPlayerId = event.playerDamageDetails?.[0]?.playerId

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

Expected: 类型错误进一步减少

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useDamageCalculation.ts
git commit -m "refactor: 分离编辑模式和回放模式的计算逻辑"
```

---

## Chunk 5: 清理和测试

### Task 10: 更新所有测试

**Files:**
- Modify: `src/executors/executors.test.ts`
- Modify: `src/utils/mitigationCalculator.test.ts`
- Modify: `src/store/timelineStore.test.ts`

- [ ] **Step 1: 更新执行器测试**

在 `src/executors/executors.test.ts` 中，将所有使用旧 PartyState 结构的测试更新为新结构:

```typescript
// 旧结构
const partyState: PartyState = {
  players: [{ id: 1, job: 'PLD', currentHP: 50000, maxHP: 50000, statuses: [] }],
  enemy: { statuses: [] },
  timestamp: 10,
}

// 新结构
const partyState: PartyState = {
  player: { id: 1, job: 'PLD', currentHP: 50000, maxHP: 50000, statuses: [] },
  statuses: [],
  timestamp: 10,
}
```

- [ ] **Step 2: 运行执行器测试**

```bash
pnpm test executors.test.ts
```

Expected: PASS

- [ ] **Step 3: 更新计算器测试**

在 `src/utils/mitigationCalculator.test.ts` 中更新所有测试用例

- [ ] **Step 4: 运行计算器测试**

```bash
pnpm test mitigationCalculator.test.ts
```

Expected: PASS

- [ ] **Step 5: 更新 store 测试**

在 `src/store/timelineStore.test.ts` 中更新测试用例

- [ ] **Step 6: 运行 store 测试**

```bash
pnpm test timelineStore.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/executors/executors.test.ts src/utils/mitigationCalculator.test.ts src/store/timelineStore.test.ts
git commit -m "test: 更新所有测试以使用简化的 PartyState"
```

---

### Task 11: 删除 mitigationStore 中的 isPartyWide 逻辑

**Files:**
- Modify: `src/store/mitigationStore.ts`

- [ ] **Step 1: 删除 isPartyWide 过滤器**

修改 `src/store/mitigationStore.ts`:

```typescript
interface MitigationState {
  actions: MitigationAction[]
  selectedActionId: string | null
  filters: {
    jobs: Job[]
    // 删除 isPartyWide: boolean | null
  }

  loadActions: () => void
  selectAction: (actionId: string | null) => void
  setJobFilter: (jobs: Job[]) => void
  // 删除 setPartyWideFilter
  getFilteredActions: () => MitigationAction[]
  resetFilters: () => void
}

const initialFilters = {
  jobs: [] as Job[],
  // 删除 isPartyWide: null
}
```

- [ ] **Step 2: 删除 setPartyWideFilter 方法**

- [ ] **Step 3: 更新 getFilteredActions 方法**

```typescript
getFilteredActions: () => {
  const { actions, filters } = get()
  let filtered = actions

  // 职业过滤
  if (filters.jobs.length > 0) {
    filtered = filtered.filter(action => filters.jobs.some(job => action.jobs.includes(job)))
  }

  // 删除 isPartyWide 过滤逻辑

  return filtered
}
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

### Task 12: 运行完整测试套件

**Files:**
- All test files

- [ ] **Step 1: 运行所有测试**

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

- [ ] **Step 4: 生成测试覆盖率报告**

```bash
pnpm test:run --coverage
```

Expected: 覆盖率保持或提高

- [ ] **Step 5: 最终 commit**

```bash
git add .
git commit -m "chore: PartyState 简化重构完成"
```

---

## 验证清单

- [ ] 所有测试通过
- [ ] 无类型错误
- [ ] 无 lint 错误
- [ ] 编辑模式功能正常
- [ ] 回放模式功能正常
- [ ] 技能拖拽功能正常
- [ ] 减伤计算结果正确
- [ ] 测试覆盖率 ≥ 80%

---

## 回滚计划

如果重构出现问题：

```bash
git log --oneline -10
git revert <commit-hash>
```

或者重置到重构前的提交：

```bash
git reset --hard <commit-before-refactor>
```

---

## 总结

本实现计划通过 12 个任务完成 PartyState 简化重构：

1. **Task 1-4**: 类型定义和执行器重构
2. **Task 5**: 技能数据更新
3. **Task 6-7**: 计算器重构
4. **Task 8-9**: 状态管理和 Hook 更新
5. **Task 10-12**: 测试更新和验证

预计总时间：6-9 小时
