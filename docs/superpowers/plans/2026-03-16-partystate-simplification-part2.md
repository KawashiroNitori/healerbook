# PartyState 简化实现计划 (Part 2)

## Chunk 2: 计算器重构

### Task 5: 更新计算器以支持简化的 PartyState

**Files:**

- Modify: `src/utils/mitigationCalculator.ts`
- Test: `src/utils/mitigationCalculator.test.ts`

- [ ] **Step 1: 修改 CalculationResult 类型，updatedPartyState 改为可选**

在 `src/utils/mitigationCalculator.ts` 中修改接口：

```typescript
export interface CalculationResult {
  /** 原始伤害 */
  originalDamage: number
  /** 最终伤害 */
  finalDamage: number
  /** 减伤百分比 */
  mitigationPercentage: number
  /** 应用的状态列表 */
  appliedStatuses: MitigationStatus[]
  /** 更新后的小队状态（盾值消耗后，回放模式下为 undefined） */
  updatedPartyState?: PartyState
}
```

- [ ] **Step 2: 编写失败的测试**

在 `src/utils/mitigationCalculator.test.ts` 中添加:

```typescript
describe('MitigationCalculator with simplified PartyState', () => {
  it('should calculate damage using player.statuses only', () => {
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
          {
            instanceId: 'status-2',
            statusId: 1176, // 圣光幕帘 10% 减伤
            startTime: 0,
            endTime: 30,
          },
        ],
      },
      timestamp: 10,
    }

    const result = calculator.calculate(10000, partyState, 10, 'physical')

    expect(result.finalDamage).toBe(8100) // 10000 * 0.9 * 0.9
    expect(result.appliedStatuses).toHaveLength(2)
    expect(result.updatedPartyState).toBeDefined()
  })
})
```

- [ ] **Step 3: 运行测试验证失败**

```bash
pnpm test mitigationCalculator.test.ts -t "simplified PartyState"
```

Expected: FAIL

- [ ] **Step 4: 更新 calculate 方法**

修改 `src/utils/mitigationCalculator.ts` 的 `calculate` 方法，所有状态统一从 `partyState.player.statuses` 读取，删除 `globalStatuses`：

```typescript
calculate(
  originalDamage: number,
  partyState: PartyState,
  time: number,
  damageType: DamageType = 'physical'
): CalculationResult {
  // 1. 获取生效的玩家状态（包含原来的友方 Buff 和敌方 Debuff）
  const activeStatuses = this.getActiveStatuses(
    [{ statuses: partyState.player.statuses }],
    time
  )

  // 2. 计算百分比减伤
  let multiplier = 1.0
  const appliedStatuses: MitigationStatus[] = []

  for (const status of activeStatuses) {
    const meta = getStatusById(status.statusId)
    if (!meta) continue

    if (meta.type === 'multiplier') {
      const damageMultiplier = this.getDamageMultiplier(meta.performance, damageType)
      multiplier *= damageMultiplier
      appliedStatuses.push(status)
    }
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

  // 4. 更新盾值状态
  const updatedPartyState: PartyState = {
    ...partyState,
    player: {
      ...partyState.player,
      statuses: partyState.player.statuses
        .map(s =>
          statusUpdates.has(s.instanceId)
            ? { ...s, remainingBarrier: statusUpdates.get(s.instanceId) }
            : s
        )
        .filter(s => s.remainingBarrier === undefined || s.remainingBarrier > 0),
    },
  }

  return {
    originalDamage,
    finalDamage: Math.max(0, Math.round(damage)),
    mitigationPercentage: Math.round(((originalDamage - damage) / originalDamage) * 100 * 10) / 10,
    appliedStatuses,
    updatedPartyState,
  }
}
```

- [ ] **Step 5: 更新 getActiveStatusesAtTime 方法**

```typescript
getActiveStatusesAtTime(partyState: PartyState, time: number): MitigationStatus[] {
  return this.getActiveStatuses([{ statuses: partyState.player.statuses }], time)
}
```

- [ ] **Step 6: 删除 targetPlayerId 参数**

`calculate` 方法不再需要 `targetPlayerId`（编辑模式只有单个玩家），删除该参数及相关逻辑。

- [ ] **Step 7: 运行测试验证通过**

```bash
pnpm test mitigationCalculator.test.ts -t "simplified PartyState"
```

Expected: PASS

- [ ] **Step 8: 运行所有计算器测试**

```bash
pnpm test mitigationCalculator.test.ts
```

Expected: 部分旧测试失败（需在下一步更新）

- [ ] **Step 9: Commit**

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "refactor: 更新计算器，所有状态统一从 player.statuses 读取"
```

---

### Task 6: 添加回放模式专用计算方法

**Files:**

- Modify: `src/utils/mitigationCalculator.ts`
- Test: `src/utils/mitigationCalculator.test.ts`

- [ ] **Step 1: 编写失败的测试**

在 `src/utils/mitigationCalculator.test.ts` 中添加:

```typescript
describe('MitigationCalculator.calculateFromSnapshot', () => {
  it('should calculate damage from status snapshot', () => {
    const calculator = new MitigationCalculator()

    const statusEvents: StatusEvent[] = [
      {
        statusId: 1193, // 雪仇 10% 减伤
        startTime: 0,
        endTime: 15,
        targetPlayerId: 1,
        packetId: 100,
      },
      {
        statusId: 1176, // 圣光幕帘 10% 减伤
        startTime: 0,
        endTime: 30,
        targetPlayerId: 1,
        packetId: 100,
      },
    ]

    const result = calculator.calculateFromSnapshot(10000, statusEvents, 100, 'physical', 1)

    expect(result.finalDamage).toBe(8100)
    expect(result.appliedStatuses).toHaveLength(2)
    expect(result.updatedPartyState).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test mitigationCalculator.test.ts -t "calculateFromSnapshot"
```

Expected: FAIL（方法不存在）

- [ ] **Step 3: 实现 calculateFromSnapshot 方法**

在 `src/utils/mitigationCalculator.ts` 中添加：

```typescript
/**
 * 从状态快照计算减伤（回放模式专用）
 * 直接使用 FFLogs 记录的状态快照，不需要 PartyState
 */
calculateFromSnapshot(
  originalDamage: number,
  statusEvents: StatusEvent[],
  packetId: number,
  damageType: DamageType,
  targetPlayerId: number
): CalculationResult {
  // 1. 过滤该 packetId、属于目标玩家或无目标的状态事件
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
      remainingBarrier:
        statusMeta.type === 'absorbed' && event.absorb ? event.absorb : undefined,
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

  // 回放模式不需要 updatedPartyState
  return {
    originalDamage,
    finalDamage: Math.max(0, Math.round(damage)),
    mitigationPercentage: Math.round(((originalDamage - damage) / originalDamage) * 100 * 10) / 10,
    appliedStatuses,
    // updatedPartyState 故意不设置（回放模式无需更新状态）
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

## 总结

Part 2 完成计算器层重构：

- `calculate` 方法统一从 `player.statuses` 读取，删除 `targetPlayerId` 参数
- `CalculationResult.updatedPartyState` 改为可选，回放模式不返回该字段
- 新增 `calculateFromSnapshot`，回放模式直接从 `StatusEvent[]` 计算

**下一步**: Part 3 更新状态管理和 Hook 层。
