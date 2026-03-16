# PartyState 简化实现计划 (Part 2)

## Chunk 2: 技能数据更新

### Task 5: 更新技能数据中的执行器调用

**Files:**
- Modify: `src/data/mitigationActions.ts`

- [ ] **Step 1: 删除所有 isPartyWide 参数**

修改 `src/data/mitigationActions.ts`，找到所有执行器调用并删除第三个参数:

```typescript
// 之前
executor: createFriendlyBuffExecutor(1896, 15, false)

// 之后
executor: createFriendlyBuffExecutor(1896, 15)
```

需要修改的行：
- Line 47: `createShieldExecutor(1362, 30)` (已经没有 isPartyWide)
- Line 57: `createFriendlyBuffExecutor(1176, 5)` (已经没有 isPartyWide)
- Line 69: `createShieldExecutor(1457, 30)` (已经没有 isPartyWide)
- Line 81: `createFriendlyBuffExecutor(1894, 15)` (已经没有 isPartyWide)
- Line 93: `createFriendlyBuffExecutor(1839, 15)` (已经没有 isPartyWide)
- Line 107: `createFriendlyBuffExecutor(1873, 25)` (已经没有 isPartyWide)
- Line 117: `createFriendlyBuffExecutor(1219, 10)` (已经没有 isPartyWide)
- Line 127: `createShieldExecutor(3903, 10)` (已经没有 isPartyWide)
- Line 139: `createShieldExecutor(297, 30)` (已经没有 isPartyWide)
- Line 151: `createFriendlyBuffExecutor(1896, 15, false)` → `createFriendlyBuffExecutor(1896, 15)` **需要修改**
- 其他所有调用

- [ ] **Step 2: 运行类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: 类型错误减少

- [ ] **Step 3: 运行技能数据测试**

```bash
pnpm test mitigationActions.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/data/mitigationActions.ts
git commit -m "refactor: 删除技能数据中的 isPartyWide 参数"
```

---

## Chunk 3: 计算器重构

### Task 6: 更新计算器以支持简化的 PartyState

**Files:**
- Modify: `src/utils/mitigationCalculator.ts`
- Test: `src/utils/mitigationCalculator.test.ts`

- [ ] **Step 1: 编写失败的测试**

在 `src/utils/mitigationCalculator.test.ts` 中添加:

```typescript
describe('MitigationCalculator with simplified PartyState', () => {
  it('should calculate damage with player and global statuses', () => {
    const calculator = new MitigationCalculator()

    const partyState: PartyState = {
      player: {
        id: 1,
        job: 'WHM',
        currentHP: 50000,
        maxHP: 50000,
        statuses: [
          {
            instanceId: 'status-1',
            statusId: 1193, // 雪仇 10% 减伤
            startTime: 0,
            endTime: 15,
          },
        ],
      },
      statuses: [
        {
          instanceId: 'status-2',
          statusId: 1176, // 圣光幕帘 10% 减伤
          startTime: 0,
          endTime: 30,
        },
      ],
      timestamp: 10,
    }

    const result = calculator.calculate(10000, partyState, 10, 'physical')

    expect(result.finalDamage).toBe(8100) // 10000 * 0.9 * 0.9
    expect(result.appliedStatuses).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test mitigationCalculator.test.ts -t "simplified PartyState"
```

Expected: FAIL

- [ ] **Step 3: 更新计算器实现**

修改 `src/utils/mitigationCalculator.ts` 的 `calculate` 方法:

```typescript
calculate(
  originalDamage: number,
  partyState: PartyState,
  time: number,
  damageType: DamageType = 'physical',
  targetPlayerId?: number
): CalculationResult {
  // 1. 获取生效的状态（玩家状态 + 全局状态）
  const playerStatuses = this.getActiveStatuses(
    [{ statuses: partyState.player.statuses }],
    time
  )
  const globalStatuses = this.getActiveStatuses(
    [{ statuses: partyState.statuses }],
    time
  )

  // 2. 计算百分比减伤
  let multiplier = 1.0
  const appliedStatuses: MitigationStatus[] = []

  for (const status of [...playerStatuses, ...globalStatuses]) {
    const meta = getStatusById(status.statusId)
    if (!meta) continue

    if (meta.type === 'multiplier') {
      const damageMultiplier = this.getDamageMultiplier(meta.performance, damageType)
      multiplier *= damageMultiplier
      appliedStatuses.push(status)
    }
  }

  let damage = originalDamage * multiplier

  // 3. 计算盾值减伤（只处理玩家身上的盾）
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
  const updatedPartyState: PartyState = {
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
```

- [ ] **Step 4: 更新 getActiveStatusesAtTime 方法**

```typescript
getActiveStatusesAtTime(partyState: PartyState, time: number): MitigationStatus[] {
  const playerStatuses = this.getActiveStatuses([{ statuses: partyState.player.statuses }], time)
  const globalStatuses = this.getActiveStatuses([{ statuses: partyState.statuses }], time)
  return [...playerStatuses, ...globalStatuses]
}
```

- [ ] **Step 5: 运行测试验证通过**

```bash
pnpm test mitigationCalculator.test.ts -t "simplified PartyState"
```

Expected: PASS

- [ ] **Step 6: 运行所有计算器测试**

```bash
pnpm test mitigationCalculator.test.ts
```

Expected: 部分测试需要更新（使用旧的 PartyState 结构）

- [ ] **Step 7: Commit**

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "refactor: 更新计算器以支持简化的 PartyState"
```

---

### Task 7: 添加回放模式计算方法

**Files:**
- Modify: `src/utils/mitigationCalculator.ts`
- Test: `src/utils/mitigationCalculator.test.ts`

- [ ] **Step 1: 编写失败的测试**

在 `src/utils/mitigationCalculator.test.ts` 中添加:

```typescript
describe('MitigationCalculator.calculateFromSnapshot', () => {
  it('should calculate damage from status events', () => {
    const calculator = new MitigationCalculator()

    const statusEvents: StatusEvent[] = [
      {
        statusId: 1193, // 雪仇
        startTime: 0,
        endTime: 15,
        targetPlayerId: 1,
        packetId: 100,
      },
      {
        statusId: 1176, // 圣光幕帘
        startTime: 0,
        endTime: 30,
        packetId: 100,
      },
    ]

    const result = calculator.calculateFromSnapshot(
      10000,
      statusEvents,
      100,
      'physical',
      1
    )

    expect(result.finalDamage).toBe(8100)
    expect(result.appliedStatuses).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test mitigationCalculator.test.ts -t "calculateFromSnapshot"
```

Expected: FAIL (方法不存在)

- [ ] **Step 3: 实现 calculateFromSnapshot 方法**

在 `src/utils/mitigationCalculator.ts` 中添加:

```typescript
/**
 * 从状态快照计算减伤（回放模式专用）
 * @param originalDamage 原始伤害
 * @param statusEvents 状态事件列表
 * @param packetId 数据包 ID
 * @param damageType 伤害类型
 * @param targetPlayerId 目标玩家 ID
 * @returns 计算结果
 */
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

  // 5. 回放模式不需要更新状态，返回空的 PartyState
  const dummyPartyState: PartyState = {
    player: {
      id: targetPlayerId,
      job: 'WHM',
      currentHP: 0,
      maxHP: 0,
      statuses: [],
    },
    statuses: [],
    timestamp: 0,
  }

  return {
    originalDamage,
    finalDamage: Math.round(damage),
    mitigationPercentage: Math.round((1 - damage / originalDamage) * 100),
    appliedStatuses,
    updatedPartyState: dummyPartyState,
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test mitigationCalculator.test.ts -t "calculateFromSnapshot"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "feat: 添加回放模式专用的 calculateFromSnapshot 方法"
```

---

## Chunk 4: 状态管理和 Hook 更新

### Task 8: 更新 timelineStore

**Files:**
- Modify: `src/store/timelineStore.ts`
- Test: `src/store/timelineStore.test.ts`

- [ ] **Step 1: 删除 buildPartyStateFromStatusEvents 函数**

删除 `src/store/timelineStore.ts` 中的 `buildPartyStateFromStatusEvents` 函数（第 17-74 行）

- [ ] **Step 2: 更新 initializePartyState 方法**

修改 `initializePartyState` 方法:

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

删除 `getPartyStateAtTime` 方法（回放模式不再使用）

- [ ] **Step 4: 运行类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: 类型错误减少

- [ ] **Step 5: 运行 store 测试**

```bash
pnpm test timelineStore.test.ts
```

Expected: 部分测试失败（需要更新）

- [ ] **Step 6: 更新失败的测试**

更新 `src/store/timelineStore.test.ts` 中使用旧 PartyState 结构的测试

- [ ] **Step 7: 运行测试验证通过**

```bash
pnpm test timelineStore.test.ts
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "refactor: 更新 timelineStore 以支持简化的 PartyState"
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
    const sortedEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)

    // 编辑模式
    if (!timeline.isReplayMode) {
      if (!partyState) return results

      const sortedCastEvents = [...(timeline.castEvents || [])].sort(
        (a, b) => a.timestamp - b.timestamp
      )

      let currentState: PartyState = {
        player: { ...partyState.player, statuses: [] },
        statuses: [],
        timestamp: 0,
      }

      let castIdx = 0

      for (const event of sortedEvents) {
        // 应用该伤害事件之前的所有技能
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

    // 回放模式
    const statusEvents = timeline.statusEvents || []

    for (const event of sortedEvents) {
      const result = calculator.calculateFromSnapshot(
        event.damage,
        statusEvents,
        event.packetId!,
        event.damageType || 'physical',
        event.targetPlayerId || event.playerDamageDetails?.[0]?.playerId || 0
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

- [ ] **Step 3: 运行应用测试**

```bash
pnpm test
```

Expected: 大部分测试通过

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useDamageCalculation.ts
git commit -m "refactor: 分离编辑模式和回放模式的计算逻辑"
```

---

## Chunk 5: 清理和优化

### Task 10: 删除 mitigationStore 中的 isPartyWide 逻辑

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

删除 `setPartyWideFilter` 方法实现

- [ ] **Step 3: 简化 getFilteredActions 方法**

```typescript
getFilteredActions: () => {
  const { actions, filters } = get()
  let filtered = actions

  // 职业过滤
  if (filters.jobs.length > 0) {
    filtered = filtered.filter(action => filters.jobs.some(job => action.jobs.includes(job)))
  }

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

### Task 11: 最终测试和验证

**Files:**
- All modified files

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

- [ ] **Step 4: 构建项目**

```bash
pnpm build
```

Expected: 构建成功

- [ ] **Step 5: 手动测试编辑模式**

1. 启动开发服务器: `pnpm dev`
2. 创建新时间轴
3. 添加伤害事件
4. 拖拽减伤技能到时间轴
5. 验证减伤计算正确

- [ ] **Step 6: 手动测试回放模式**

1. 导入 FFLogs 数据
2. 验证伤害事件显示
3. 验证减伤计算正确
4. 验证状态显示

- [ ] **Step 7: 最终 Commit**

```bash
git add .
git commit -m "refactor: 完成 PartyState 简化重构"
```

---

## 总结

本实现计划通过以下步骤完成 PartyState 简化：

1. **类型定义**: 简化 PartyState 为单个玩家 + 全局状态
2. **执行器重构**: 删除 isPartyWide 参数，简化逻辑
3. **计算器分离**: 编辑模式使用 calculate，回放模式使用 calculateFromSnapshot
4. **状态管理**: 更新 timelineStore 和 Hook
5. **清理优化**: 删除未使用的代码和过滤器

**预计时间**: 6-9 小时

**关键风险**:
- 回放模式的状态快照计算可能需要调整
- 测试覆盖率需要保持在 80% 以上
- UI 组件可能需要适配新的数据结构
