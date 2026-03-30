# 炽天附体·意气轩昂之策转化逻辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现意气轩昂之策（37013）在炽天附体（buff 3885）激活时自动转化为降临之章（37016）的导入转换、视觉渲染和计算逻辑，并将 37016 标记为隐藏技能。

**Architecture:** 在 FFLogs 导入层将 37016 cast 事件转换为 37013；在时间轴渲染层检测炽天附体 cast 事件的活跃窗口以决定显示图标；在 executor 层优先检测 buff 3885 以切换盾值计算来源；通过 `hidden` 字段从技能轨道生成中排除 37016。

**Tech Stack:** React 19, TypeScript, Zustand, Vitest

---

## 文件清单

| 操作   | 文件                                            | 改动内容                                           |
| ------ | ----------------------------------------------- | -------------------------------------------------- |
| Modify | `src/types/mitigation.ts`                       | `MitigationAction` 加 `hidden?: boolean`           |
| Modify | `src/data/mitigationActions.ts`                 | 37016 加 `hidden: true`；37013 executor 加炽天判断 |
| Modify | `src/store/mitigationStore.ts`                  | `getFilteredActions` 过滤 `hidden`                 |
| Modify | `src/components/Timeline/index.tsx`             | skillTracks 生成时过滤 `hidden`                    |
| Modify | `src/components/Timeline/CastEventIcon.tsx`     | 加 `displayAction?` prop                           |
| Modify | `src/components/Timeline/SkillTracksCanvas.tsx` | 37013 渲染时计算 `displayAction`                   |
| Modify | `src/utils/fflogsImporter.ts`                   | 37016 cast 事件转换为 37013                        |
| Modify | `src/data/mitigationActions.test.ts`            | 37013 executor 新增炽天场景测试                    |
| Modify | `src/utils/fflogsImporter.test.ts`              | 新增 37016→37013 转换测试                          |

---

## Task 1: 类型定义与隐藏标记

**Files:**

- Modify: `src/types/mitigation.ts`
- Modify: `src/data/mitigationActions.ts`

- [ ] **Step 1: 在 `MitigationAction` 接口加 `hidden` 字段**

在 `src/types/mitigation.ts` 的 `MitigationAction` 接口中，紧接 `executor` 字段之后添加：

```typescript
  /** 隐藏技能（不在技能轨道中显示，仅供内部数据引用） */
  hidden?: boolean
```

- [ ] **Step 2: 标记 37016 为隐藏**

在 `src/data/mitigationActions.ts` 中，找到 id 为 37016 的技能定义，加上 `hidden: true`：

```typescript
    {
      id: 37016,
      name: '降临之章',
      icon: '/i/002000/002883.png',
      jobs: ['SCH'],
      duration: 30,
      cooldown: 1,
      hidden: true,
      executor: (ctx: ActionExecutionContext) => {
```

- [ ] **Step 3: 运行类型检查**

```bash
pnpm tsc --noEmit
```

期望：无类型错误。

- [ ] **Step 4: Commit**

```bash
git add src/types/mitigation.ts src/data/mitigationActions.ts
git commit -m "feat: 为 MitigationAction 添加 hidden 字段，标记 37016 为隐藏"
```

---

## Task 2: 过滤隐藏技能（store + 轨道生成）

**Files:**

- Modify: `src/store/mitigationStore.ts`
- Modify: `src/components/Timeline/index.tsx`

- [ ] **Step 1: `getFilteredActions` 过滤隐藏技能**

在 `src/store/mitigationStore.ts` 中，修改 `getFilteredActions`：

```typescript
  getFilteredActions: () => {
    const { actions, filters } = get()
    const visible = actions.filter(action => !action.hidden)
    if (filters.jobs.length === 0) return visible
    return visible.filter(action => filters.jobs.some(job => action.jobs.includes(job)))
  },
```

- [ ] **Step 2: skillTracks 生成时过滤隐藏技能**

在 `src/components/Timeline/index.tsx` 中，找到如下行（约第 205 行）：

```typescript
const jobActions = actions.filter(action => action.jobs.includes(player.job))
```

改为：

```typescript
const jobActions = actions.filter(action => action.jobs.includes(player.job) && !action.hidden)
```

- [ ] **Step 3: 运行测试确认无回归**

```bash
pnpm test:run
```

期望：全部通过。

- [ ] **Step 4: Commit**

```bash
git add src/store/mitigationStore.ts src/components/Timeline/index.tsx
git commit -m "feat: 过滤隐藏技能，37016 不再生成独立轨道"
```

---

## Task 3: 修改 37013 executor 支持炽天附体

**Files:**

- Modify: `src/data/mitigationActions.ts`
- Modify: `src/data/mitigationActions.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/data/mitigationActions.test.ts` 的 `describe('自定义 Executor')` 块中新增：

```typescript
it('意气轩昂之策在炽天附体（buff 3885）激活时应使用 37016 的治疗量基础值', () => {
  const action = MITIGATION_DATA.actions.find(a => a.id === 37013)!
  const stateWithSeraph: PartyState = {
    players: [{ id: 1, job: 'SCH', maxHP: 100000 }],
    statuses: [
      {
        instanceId: 'seraph-1',
        statusId: 3885,
        startTime: 0,
        endTime: 30,
      },
    ],
    timestamp: 5,
  }
  const ctx: ActionExecutionContext = {
    actionId: 37013,
    useTime: 5,
    partyState: stateWithSeraph,
    sourcePlayerId: 1,
    statistics: {
      encounterId: 1,
      encounterName: 'test',
      damageByAbility: {},
      maxHPByJob: {} as Record<Job, number>,
      shieldByAbility: {},
      critShieldByAbility: {},
      healByAbility: { 37013: 8000, 37016: 12000 },
      critHealByAbility: { 37013: 16000 },
      sampleSize: 100,
      updatedAt: '2026-01-01T00:00:00Z',
    },
  }

  const newState = action.executor(ctx)

  // 炽天附体激活时应使用 37016 的 healByAbility（12000），而非 37013
  const shield = newState.statuses.find(s => s.statusId === 297)
  expect(shield).toBeDefined()
  expect(shield!.remainingBarrier).toBe(Math.round(12000 * 1.8)) // 21600
})

it('意气轩昂之策在无炽天附体时应继续使用 37013 的治疗量（含秘策判断）', () => {
  const action = MITIGATION_DATA.actions.find(a => a.id === 37013)!
  const ctx: ActionExecutionContext = {
    actionId: 37013,
    useTime: 10,
    partyState: mockPartyState,
    sourcePlayerId: 1,
    statistics: {
      encounterId: 1,
      encounterName: 'test',
      damageByAbility: {},
      maxHPByJob: {} as Record<Job, number>,
      shieldByAbility: {},
      critShieldByAbility: {},
      healByAbility: { 37013: 8000, 37016: 12000 },
      critHealByAbility: { 37013: 16000 },
      sampleSize: 100,
      updatedAt: '2026-01-01T00:00:00Z',
    },
  }

  const newState = action.executor(ctx)

  // 无炽天附体时应使用 37013 的 healByAbility（8000）
  const shield = newState.statuses.find(s => s.statusId === 297)
  expect(shield).toBeDefined()
  expect(shield!.remainingBarrier).toBe(Math.round(8000 * 1.8)) // 14400
})
```

注意：需要在测试文件顶部补充 `Job` 类型导入（若尚不存在）：

```typescript
import type { Job } from '@/data/jobs'
```

- [ ] **Step 2: 运行新测试确认失败**

```bash
pnpm test:run src/data/mitigationActions.test.ts
```

期望：两条新测试 FAIL。

- [ ] **Step 3: 修改 37013 executor**

在 `src/data/mitigationActions.ts` 中，将 37013 的 executor 替换为以下内容（完整替换 executor 函数体）：

```typescript
      executor: (ctx: ActionExecutionContext) => {
        const seraphId = 3885 // 炽天附体
        const recitationId = 1896 // 秘策
        const baseShieldId = 297 // 鼓舞
        const sageShieldId = 2609 // 贤者群盾

        const hasSeraph = ctx.partyState.statuses.some(s => s.statusId === seraphId)

        let baseHeal: number
        if (hasSeraph) {
          // 炽天附体激活：等效降临之章，使用 37016 基础恢复力，秘策无效
          baseHeal = ctx.statistics?.healByAbility[37016] ?? 10000
        } else {
          // 普通意气轩昂之策：检测秘策决定是否用暴击治疗量
          const hasRecitation = ctx.partyState.statuses.some(s => s.statusId === recitationId)
          baseHeal = hasRecitation
            ? (ctx.statistics?.critHealByAbility[37013] ?? 10000)
            : (ctx.statistics?.healByAbility[37013] ?? 10000)
        }

        const barrier = Math.round(baseHeal * 1.8)

        const statusesToRemove = hasSeraph
          ? [baseShieldId, sageShieldId]
          : [recitationId, baseShieldId, sageShieldId]

        const filteredStatuses = ctx.partyState.statuses.filter(
          s => !statusesToRemove.includes(s.statusId)
        )

        return {
          ...ctx.partyState,
          statuses: [
            ...filteredStatuses,
            {
              instanceId: generateId(),
              statusId: baseShieldId,
              startTime: ctx.useTime,
              endTime: ctx.useTime + 30,
              remainingBarrier: barrier,
              initialBarrier: barrier,
              sourceActionId: ctx.actionId,
              sourcePlayerId: ctx.sourcePlayerId,
            },
          ],
        }
      },
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test:run src/data/mitigationActions.test.ts
```

期望：全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/data/mitigationActions.ts src/data/mitigationActions.test.ts
git commit -m "feat: 37013 executor 优先检测炽天附体 buff，切换为 37016 盾量计算"
```

---

## Task 4: FFLogs 导入 37016→37013 转换

**Files:**

- Modify: `src/utils/fflogsImporter.ts`
- Modify: `src/utils/fflogsImporter.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/utils/fflogsImporter.test.ts` 的 `describe('parseCastEvents')` 块中新增：

```typescript
it('应该将 37016（降临之章）的 cast 事件转换为 37013（意气轩昂之策）', () => {
  const mockPlayerMapSCH = new Map<number, V2Actor>([
    [3, { id: 3, name: 'Scholar', type: 'Scholar' }],
  ])
  const events = [
    { type: 'cast', abilityGameID: 37016, sourceID: 3, timestamp: fightStartTime + 5000 },
  ]

  const result = parseCastEvents(events, fightStartTime, mockPlayerMapSCH)

  expect(result).toHaveLength(1)
  expect(result[0].actionId).toBe(37013)
  expect(result[0].timestamp).toBe(5)
})
```

注意：需确认 `V2Actor` 已从 `fflogsImporter` 或相关类型文件中导入（查看测试文件顶部现有导入）。

- [ ] **Step 2: 运行新测试确认失败**

```bash
pnpm test:run src/utils/fflogsImporter.test.ts
```

期望：新测试 FAIL（37016 被过滤掉，结果为空，或 actionId 仍为 37016）。

- [ ] **Step 3: 修改 `parseCastEvents`**

在 `src/utils/fflogsImporter.ts` 中，找到 `parseCastEvents` 函数内处理单个事件的循环，在 `const abilityGameID = event.abilityGameID` 之后立即添加转换逻辑：

```typescript
const abilityGameID = event.abilityGameID
if (!abilityGameID) continue

// 降临之章（37016）是意气轩昂之策（37013）在炽天附体激活时的变体，导入时统一归并为 37013
const effectiveAbilityId = abilityGameID === 37016 ? 37013 : abilityGameID

if (!validActionIds.has(effectiveAbilityId)) continue
```

并将后续使用 `abilityGameID` 作为 actionId 的地方改为 `effectiveAbilityId`：

```typescript
castEventsResult.push({
  id: `cast-${castEventsResult.length}`,
  actionId: effectiveAbilityId,
  timestamp: (event.timestamp - fightStartTime) / 1000,
  playerId: event.sourceID,
  job,
  targetPlayerId: event.targetID,
})
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test:run src/utils/fflogsImporter.test.ts
```

期望：全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/utils/fflogsImporter.ts src/utils/fflogsImporter.test.ts
git commit -m "feat: FFLogs 导入时将 37016 cast 事件转换为 37013"
```

---

## Task 5: 时间轴渲染——37013 炽天附体激活时显示 37016 图标

**Files:**

- Modify: `src/components/Timeline/CastEventIcon.tsx`
- Modify: `src/components/Timeline/SkillTracksCanvas.tsx`

- [ ] **Step 1: 给 `CastEventIcon` 添加 `displayAction` prop**

在 `src/components/Timeline/CastEventIcon.tsx` 中，修改 `CastEventIconProps` 接口，在 `action` 字段之后添加：

```typescript
  /** 覆盖显示用的技能（仅影响图标和悬浮窗，不影响持续/冷却时间条） */
  displayAction?: MitigationAction
```

在组件函数参数解构中加入 `displayAction`：

```typescript
export default function CastEventIcon({
  castEvent,
  action,
  displayAction,
  isSelected,
  ...
```

将技能图标渲染从：

```typescript
      {action ? (
        <SkillIcon iconPath={action.icon} isSelected={isSelected} />
```

改为：

```typescript
      {action ? (
        <SkillIcon iconPath={(displayAction ?? action).icon} isSelected={isSelected} />
```

将图标区域的 hover 和 tap 回调从：

```typescript
          onMouseEnter={e => onHover(action, e)}
          onTap={e => onClickIcon(action, e)}
```

改为：

```typescript
          onMouseEnter={e => onHover(displayAction ?? action, e)}
          onTap={e => onClickIcon(displayAction ?? action, e)}
```

- [ ] **Step 2: 在 `SkillTracksCanvas` 计算 `displayAction`**

在 `src/components/Timeline/SkillTracksCanvas.tsx` 中，找到渲染 castEvents 的循环（`timeline.castEvents.map(castEvent => {`），在取得 `action` 之后（`const action = actions.find(a => a.id === castEvent.actionId)`），添加：

```typescript
if (!action) return null

// 意气轩昂之策（37013）在炽天附体（37014）持续期间显示降临之章（37016）图标
let displayAction: MitigationAction | undefined
if (castEvent.actionId === 37013) {
  const seraphAction = actions.find(a => a.id === 37014)
  if (seraphAction) {
    const seraphActive = timeline.castEvents.some(
      other =>
        other.playerId === castEvent.playerId &&
        other.actionId === 37014 &&
        castEvent.timestamp >= other.timestamp &&
        castEvent.timestamp < other.timestamp + seraphAction.duration
    )
    if (seraphActive) {
      displayAction = actions.find(a => a.id === 37016)
    }
  }
}
```

将 `CastEventIcon` 的渲染调用加入 `displayAction` prop：

```typescript
            <CastEventIcon
              key={castEvent.id}
              castEvent={castEvent}
              action={action}
              displayAction={displayAction}
              isSelected={isSelected}
              ...
```

- [ ] **Step 3: 运行全量测试**

```bash
pnpm test:run
```

期望：全部通过。

- [ ] **Step 4: 运行类型检查**

```bash
pnpm tsc --noEmit
```

期望：无类型错误。

- [ ] **Step 5: Commit**

```bash
git add src/components/Timeline/CastEventIcon.tsx src/components/Timeline/SkillTracksCanvas.tsx
git commit -m "feat: 37013 在炽天附体持续期间渲染为 37016 图标和悬浮窗"
```

---

## Task 6: 全量验证

- [ ] **Step 1: 运行全量测试**

```bash
pnpm test:run
```

期望：≥ 131 条测试全部通过（新增 3 条）。

- [ ] **Step 2: 类型检查**

```bash
pnpm tsc --noEmit
```

期望：无错误。

- [ ] **Step 3: Lint**

```bash
pnpm lint
```

期望：无错误。
