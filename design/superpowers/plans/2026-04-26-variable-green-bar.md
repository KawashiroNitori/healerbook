# 可变长度绿条 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让技能绿条与 cast 附着 buff/盾 的真实生命周期同步——盾被打穿、被 uniqueGroup 替换、自然过期或未来被 executor 修改时，绿条立即收束到对应时刻；末尾文字显示真实存活秒数。

**Architecture:** simulator 在已有 `pushInterval` 单点新增 `castEffectiveEndByCastEventId: Map<castEventId, number>` 输出，渲染层从此 Map 读取每条 cast 的真实结束时刻；无附着回退到 `action.duration`。

**Tech Stack:** TypeScript / Vitest / React-Konva。

**关联 spec:** `design/superpowers/specs/2026-04-26-variable-green-bar-design.md`

---

## 文件结构总览

| 文件                                            | 改动类型 | 职责                                                                                                         |
| ----------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `src/utils/mitigationCalculator.ts`             | modify   | `SimulateOutput` 加字段；`simulate()` 内 `pushInterval` 同步更新 map                                         |
| `src/utils/mitigationCalculator.test.ts`        | modify   | 新增 `castEffectiveEndByCastEventId` 输出测试组                                                              |
| `src/hooks/useDamageCalculation.ts`             | modify   | 透传新字段到 context value                                                                                   |
| `src/contexts/DamageCalculationContext.ts`      | modify   | 加 `useCastEffectiveEnd` hook + 默认空 Map                                                                   |
| `src/types/status.ts`                           | modify   | `MitigationStatus.instanceId` 注释升级（带正反例契约）                                                       |
| `CLAUDE.md`                                     | modify   | 加 "2.1. Executor 写作规范" 章节                                                                             |
| `src/components/Timeline/CastEventIcon.tsx`     | modify   | `effectiveEndSec` prop 替换基于 `action.duration` 的算法；末尾文字 round 真实秒数                            |
| `src/components/Timeline/SkillTracksCanvas.tsx` | modify   | 父组件查 map 算 `effectiveEndSec` 传给 icon；`visibleBarsByTrack` 同步换口径；删除绿条侧 `nextCastTime` 截短 |

---

## Task 1: simulator 输出 `castEffectiveEndByCastEventId`

**Files:**

- Modify: `src/utils/mitigationCalculator.ts`
- Test: `src/utils/mitigationCalculator.test.ts`

### Step 1.1: 写第一个失败测试（自然过期场景）

- [ ] 在 `src/utils/mitigationCalculator.test.ts` 现有 `describe('simulate → statusTimelineByPlayer', ...)` 下方追加新 `describe`：

```ts
describe('simulate → castEffectiveEndByCastEventId', () => {
  it('cast 一个 buff，无后续事件 → effectiveEnd = ts + max duration', () => {
    // 节制 16536 实际 attach 1873(25s) + 3881(30s)，多 status max → 30
    const castEvents = [
      { id: 'c1', actionId: 16536, playerId: 1, timestamp: 10 } as unknown as CastEvent,
    ]
    const calc = new MitigationCalculator()
    const { castEffectiveEndByCastEventId } = calc.simulate({
      castEvents,
      damageEvents: [],
      initialState: { players: [], statuses: [], timestamp: 0 },
    })
    expect(castEffectiveEndByCastEventId.get('c1')).toBe(40)
  })
})
```

### Step 1.2: 运行测试确认失败

- [ ] Run: `pnpm test:run mitigationCalculator -t "cast 一个 buff，无后续事件"`
- Expected: FAIL with "castEffectiveEndByCastEventId is undefined"（解构出 undefined）

### Step 1.3: 在 `SimulateOutput` 增加字段、`simulate()` 维护 map、返回值带上

- [ ] 修改 `src/utils/mitigationCalculator.ts`：

  在 `SimulateOutput` 接口（约 109 行附近）追加字段：

```ts
export interface SimulateOutput {
  damageResults: Map<string, CalculationResult>
  /** playerId → statusId → StatusInterval[]；task 5 才填充，本 task 返回空 Map */
  statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
  /**
   * castEvent.id → 该 cast 附着的所有 instance 中实际收束时刻的最大值。
   * 仅在 cast 有 executor 且产生了至少一个新 instance 时进表；
   * seeded buff（sourceCastEventId === ''）不进表。
   * 渲染层用此字段定位绿条末端，miss 时回退到 cast.timestamp + action.duration。
   */
  castEffectiveEndByCastEventId: Map<string, number>
}
```

在 `simulate(input)` 内 `statusTimelineByPlayer` 声明下方追加：

```ts
const castEffectiveEndByCastEventId = new Map<string, number>()
```

在 `pushInterval` 函数（约 267 行）末尾追加：

```ts
const pushInterval = (rec: OpenRecord, to: number) => {
  const byStatus = statusTimelineByPlayer.get(rec.targetPlayerId) ?? new Map()
  const arr = byStatus.get(rec.statusId) ?? []
  arr.push({
    from: rec.from,
    to,
    stacks: rec.stacks,
    sourcePlayerId: rec.sourcePlayerId,
    sourceCastEventId: rec.sourceCastEventId,
  })
  byStatus.set(rec.statusId, arr)
  statusTimelineByPlayer.set(rec.targetPlayerId, byStatus)

  // 维护 castEffectiveEnd：sourceCastEventId 为空（seeded buff）跳过；否则取 max
  if (rec.sourceCastEventId !== '') {
    const prev = castEffectiveEndByCastEventId.get(rec.sourceCastEventId) ?? -Infinity
    castEffectiveEndByCastEventId.set(rec.sourceCastEventId, Math.max(prev, to))
  }
}
```

在函数末尾 `return { damageResults, statusTimelineByPlayer }` 改为：

```ts
return { damageResults, statusTimelineByPlayer, castEffectiveEndByCastEventId }
```

### Step 1.4: 运行测试确认通过

- [ ] Run: `pnpm test:run mitigationCalculator -t "cast 一个 buff，无后续事件"`
- Expected: PASS

### Step 1.5: 加测试 2 — 盾击穿

- [ ] 追加测试用例：

```ts
it('盾被中途打穿 → effectiveEnd = damage event time', () => {
  // 极致防御 36920 给玩家 3830 盾，duration 15s，固定 fixedBarrier 走 statistics
  // 这里用 createShieldExecutor 的 fixedBarrier 走 statistics 显式控制
  const castEvents = [
    { id: 'c1', actionId: 36920, playerId: 1, timestamp: 0 } as unknown as CastEvent,
  ]
  const calc = new MitigationCalculator()
  const { castEffectiveEndByCastEventId } = calc.simulate({
    castEvents,
    damageEvents: [
      {
        id: 'd1',
        name: 'd1',
        time: 5,
        damage: 1_000_000, // 一定打穿
        type: 'tankbuster',
        damageType: 'physical',
      } as DamageEvent,
    ],
    initialState: { players: [{ id: 1, job: 'PLD', maxHP: 100000 }], statuses: [], timestamp: 0 },
    statistics: {
      // 极致防御附 3829 buff（15s）+ 3830 盾，shieldByAbility[3830] = 5000 让伤害打穿
      shieldByAbility: { 3830: 5000 },
      damageByAbility: {},
      maxHPByJob: {},
      critShieldByAbility: {},
      healByAbility: {},
      critHealByAbility: {},
      sampleSize: 0,
      updatedAt: '',
      tankReferenceMaxHP: 100000,
      referenceMaxHP: 100000,
    } as never, // 测试构造，type 从严走 statData 的 resolve 分支可绕过
  })
  // 极致防御附 3829（buff）+ 3830（shield）
  // 3830 在 t=5 被打穿且 removeOnBarrierBreak → interval to=5
  // 3829 buff 没人动 → interval to=15
  // max → 15（buff 还活着，绿条延伸到 buff 结束）
  expect(castEffectiveEndByCastEventId.get('c1')).toBe(15)
})
```

注：本测试同时验证 §Q2-A "max(interval.to)" 决议——盾击穿但 buff 还活时绿条取 buff 的 to。

纯击穿（无伴随 buff）的 case 用 createShieldExecutor 直接构造：

```ts
it('单纯盾击穿（无伴随 buff）→ effectiveEnd = damage event time', () => {
  // 用一个仅 attach shield 的 fake action：意气轩昂之策 37013 走 createShieldExecutor 路径
  // 但它依赖 statistics.healByAbility，构造稍复杂；此处直接用 mock 路径：
  // 通过 statistics 把 fixedBarrier 等价值控到 1000，在 1500 伤害下直接穿
  const castEvents = [
    { id: 'c1', actionId: 37013, playerId: 1, timestamp: 0 } as unknown as CastEvent,
  ]
  const calc = new MitigationCalculator()
  const { castEffectiveEndByCastEventId } = calc.simulate({
    castEvents,
    damageEvents: [
      {
        id: 'd1',
        name: 'd1',
        time: 7,
        damage: 1_000_000,
        type: 'aoe',
        damageType: 'physical',
      } as DamageEvent,
    ],
    initialState: { players: [{ id: 1, job: 'SCH', maxHP: 100000 }], statuses: [], timestamp: 0 },
    statistics: {
      healByAbility: { 37013: 100 }, // shield = 100*1.8 = 180，必穿
      damageByAbility: {},
      maxHPByJob: {},
      shieldByAbility: {},
      critShieldByAbility: {},
      critHealByAbility: {},
      sampleSize: 0,
      updatedAt: '',
      tankReferenceMaxHP: 100000,
      referenceMaxHP: 100000,
    } as never,
  })
  // 意气轩昂只 attach 一条 shield 297（duration 30）；t=7 被打穿，removeOnBarrierBreak → to=7
  expect(castEffectiveEndByCastEventId.get('c1')).toBe(7)
})
```

### Step 1.6: 运行测试 2 验证通过

- [ ] Run: `pnpm test:run mitigationCalculator -t "盾"`
- Expected: 两条新测试 PASS

### Step 1.7: 加测试 3 — uniqueGroup 替换

- [ ] 追加：

```ts
it('uniqueGroup 替换 → 第一条 effectiveEnd = 第二条 timestamp', () => {
  // 节制 16536 → attach 1873；二次施放 16536 → 旧 instance 被 createBuffExecutor 移除
  const castEvents = [
    { id: 'first', actionId: 16536, playerId: 1, timestamp: 10 } as unknown as CastEvent,
    { id: 'second', actionId: 16536, playerId: 1, timestamp: 20 } as unknown as CastEvent,
  ]
  const calc = new MitigationCalculator()
  const { castEffectiveEndByCastEventId } = calc.simulate({
    castEvents,
    damageEvents: [],
    initialState: { players: [], statuses: [], timestamp: 0 },
  })
  expect(castEffectiveEndByCastEventId.get('first')).toBe(20)
  expect(castEffectiveEndByCastEventId.get('second')).toBe(50) // 20 + 30（节制最长 buff 3881=30s）
})
```

### Step 1.8: 加测试 4 — 多 status max

- [ ] 追加：

```ts
it('多 status cast → effectiveEnd = max(interval.to)', () => {
  // 干预 7382：buff 1174 (8s) + buff 2675 (4s)
  const castEvents = [
    { id: 'c1', actionId: 7382, playerId: 1, timestamp: 0 } as unknown as CastEvent,
  ]
  const calc = new MitigationCalculator()
  const { castEffectiveEndByCastEventId } = calc.simulate({
    castEvents,
    damageEvents: [],
    initialState: { players: [], statuses: [], timestamp: 0 },
  })
  expect(castEffectiveEndByCastEventId.get('c1')).toBe(8)
})
```

### Step 1.9: 文档化跳过的扩展测试场景（不写代码）

- [ ] 在 simulate → castEffectiveEndByCastEventId 的 describe 末尾加一条注释：

```ts
// 未实现的测试（等中期 extension / detonation executor 落地后补）：
// - "executor 通过 updateStatus 延长 endTime → effectiveEnd 跟到新 endTime"
// - "executor 通过 removeStatus 引爆 → effectiveEnd = 引爆 cast 时刻"
// - "反例：filter 旧 + push 新 instanceId 的写法下，原 cast effectiveEnd 收束到
//    transformation 时刻；新 cast 接管新 interval"
//
// 跳过原因：以上场景需要测试用 executor，但项目无运行时 action 注册；
// 通过 mock MITIGATION_DATA.actions 实施代价高于本 task 收益。
// 本 task 已通过 uniqueGroup 替换路径（仅仅是 instanceId diff 的另一面）
// 间接验证了 "instance 消失即收束" 的核心机制。
```

只写注释，不写测试代码。继续 step 1.10。

### Step 1.10: 加测试 — seeded buff 不进表

- [ ] 追加：

```ts
it('seeded buff（initialState 带的、无 cast 来源）不进 castEffectiveEnd', () => {
  const calc = new MitigationCalculator()
  const { castEffectiveEndByCastEventId } = calc.simulate({
    castEvents: [],
    damageEvents: [],
    initialState: {
      players: [],
      statuses: [
        {
          instanceId: 'seeded',
          statusId: 1873,
          startTime: 0,
          endTime: 30,
        },
      ],
      timestamp: 0,
    },
  })
  expect(castEffectiveEndByCastEventId.size).toBe(0)
})
```

### Step 1.11: 运行所有 simulate 测试

- [ ] Run: `pnpm test:run mitigationCalculator`
- Expected: 全部 PASS（含原有的 statusTimelineByPlayer 测试组）

### Step 1.12: 类型检查

- [ ] Run: `pnpm exec tsc --noEmit`
- Expected: 无错误

### Step 1.13: Commit

- [ ] Run:

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "feat(calc): simulate 输出 castEffectiveEndByCastEventId Map"
```

---

## Task 2: 透传新字段到 context

**Files:**

- Modify: `src/hooks/useDamageCalculation.ts`
- Modify: `src/contexts/DamageCalculationContext.ts`

### Step 2.1: 写失败测试 — context 默认值

- [ ] 在 `src/contexts/DamageCalculationContext.ts` 旁边新建（如果还没有）测试，或追加到 `src/hooks/useDamageCalculation.test.ts`（如已存在）：

  先 grep 确认有无现成测试文件：

```bash
ls src/hooks/useDamageCalculation.test.ts 2>/dev/null && echo exists || echo missing
ls src/contexts/DamageCalculationContext.test.ts 2>/dev/null && echo exists || echo missing
```

如都不存在，本 task 跳过单测，在 task 4 集成后通过浏览器手测验证。直接进 step 2.2。

### Step 2.2: 修改 `DamageCalculationResult` 加字段

- [ ] 修改 `src/hooks/useDamageCalculation.ts` 第 17 行附近：

```ts
export interface DamageCalculationResult {
  results: Map<string, CalculationResult>
  statusTimelineByPlayer: StatusTimelineByPlayer
  /** castEvent.id → 该 cast 附着 instance 的实际收束时刻最大值（绿条末端用） */
  castEffectiveEndByCastEventId: Map<string, number>
  simulate: ((castEvents: CastEvent[]) => { statusTimelineByPlayer: StatusTimelineByPlayer }) | null
}
```

### Step 2.3: 在 `useDamageCalculation` 透传

- [ ] 同文件 `empty` 默认值（约 40 行）：

```ts
const empty: DamageCalculationResult = {
  results,
  statusTimelineByPlayer: new Map(),
  castEffectiveEndByCastEventId: new Map(),
  simulate: null,
}
```

返回处（约 137 行）：

```ts
return {
  results,
  statusTimelineByPlayer: full.statusTimelineByPlayer,
  castEffectiveEndByCastEventId: full.castEffectiveEndByCastEventId,
  simulate,
}
```

### Step 2.4: 在 context 加 hook + 默认值

- [ ] 修改 `src/contexts/DamageCalculationContext.ts`：

```ts
import { createContext, useContext } from 'react'
import type { CalculationResult } from '@/utils/mitigationCalculator'
import type { DamageCalculationResult, StatusTimelineByPlayer } from '@/hooks/useDamageCalculation'

const emptyContext: DamageCalculationResult = {
  results: new Map(),
  statusTimelineByPlayer: new Map(),
  castEffectiveEndByCastEventId: new Map(),
  simulate: null,
}

export const DamageCalculationContext = createContext<DamageCalculationResult>(emptyContext)

export function useDamageCalculationResults(): Map<string, CalculationResult> {
  return useContext(DamageCalculationContext).results
}

export function useStatusTimelineByPlayer(): StatusTimelineByPlayer {
  return useContext(DamageCalculationContext).statusTimelineByPlayer
}

export function useCastEffectiveEnd(): Map<string, number> {
  return useContext(DamageCalculationContext).castEffectiveEndByCastEventId
}

export function useDamageCalculationSimulate(): DamageCalculationResult['simulate'] {
  return useContext(DamageCalculationContext).simulate
}
```

### Step 2.5: 类型检查 + lint

- [ ] Run: `pnpm exec tsc --noEmit`
- Expected: 无错误
- [ ] Run: `pnpm lint`
- Expected: 无错误

### Step 2.6: Commit

- [ ] Run:

```bash
git add src/hooks/useDamageCalculation.ts src/contexts/DamageCalculationContext.ts
git commit -m "feat(damage-calc): 透传 castEffectiveEndByCastEventId 到 context + useCastEffectiveEnd hook"
```

---

## Task 3: instanceId 注释升级（带正反例契约）

**Files:**

- Modify: `src/types/status.ts:43-45`

### Step 3.1: 替换 instanceId 字段注释

- [ ] 修改 `src/types/status.ts`，找到 `MitigationStatus` 接口的 `instanceId` 字段，把现有 `/** 运行时生成的唯一 ID */` 替换为：

```ts
/**
 * 运行时生成的唯一 ID。**整个 instance 的生命周期内必须保持稳定**——
 * simulator 的 captureTransition 用 instanceId 集合 diff 判定 buff 的 attach / persist /
 * consume，并由此驱动绿条长度、status interval 区间记录等 UI 数据。
 *
 * ─── 修改既有 status 的执行器写法 ───────────────────────────────
 *
 * ✅ 正确：保持 instanceId，只改字段
 *   // 延长 30s
 *   statuses.map(s => s.instanceId === target.instanceId
 *     ? { ...s, endTime: s.endTime + 30 } : s)
 *
 *   // 变身（statusId 改、instanceId 不变）
 *   statuses.map(s => s.instanceId === target.instanceId
 *     ? { ...s, statusId: NEW_ID, endTime: ... } : s)
 *
 *   // 立即结束 / 引爆
 *   statuses.filter(s => s.instanceId !== target.instanceId)
 *
 * 推荐使用 `src/executors/statusHelpers.ts` 的 `updateStatus` / `removeStatus`
 * 以避免手写 map/filter 时遗漏字段。
 *
 * ❌ 错误：filter 掉再 push 新 instanceId
 *   const filtered = statuses.filter(s => s.instanceId !== target.instanceId)
 *   return [...filtered, { ...target, instanceId: generateId(), endTime: ... }]
 *   // 后果：原 cast 的 interval 在此刻被收束，新 instance 被错误归属到当前 cast
 *   //      —— 原 cast 的绿条会"断开 + 另起一条"，而不是延长。
 *
 * ─── 真的"换主人"了的例外 ───────────────────────────────────────
 *
 * 极少数场景（buff 转给另一个 cast 接管），新建 instanceId 是正确语义——
 * 这条 interval 归新 cast，原 cast 的绿条收束在转移时刻。绝大多数
 * extension / transformation / detonation 都不属于这种情况。
 */
instanceId: string
```

### Step 3.2: 类型检查

- [ ] Run: `pnpm exec tsc --noEmit`
- Expected: 无错误

### Step 3.3: Commit

- [ ] Run:

```bash
git add src/types/status.ts
git commit -m "docs(status): instanceId 注释加正反例契约 + 引用 statusHelpers"
```

---

## Task 4: CLAUDE.md 加 "2.1. Executor 写作规范" 章节

**Files:**

- Modify: `CLAUDE.md`

### Step 4.1: 在 "2. 执行器工厂" 之后插入新小节

- [ ] 修改 `CLAUDE.md`，在现有 "### 2. 执行器工厂" 段后追加：

```md
### 2.1. Executor 写作规范

修改既有 status 时**必须保持 `instanceId`** —— simulator 用 instanceId diff 判定
buff 的 attach / persist / consume，并据此驱动绿条长度、status interval 等 UI 数据。

| 场景                         | 写法                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| 延长持续时间 / 变身 / 改字段 | `statuses.map(s => s.instanceId === id ? { ...s, ...patch } : s)`，或用 `updateStatus(state, id, patch)` |
| 立即结束 / 引爆              | `statuses.filter(s => s.instanceId !== id)`，或用 `removeStatus(state, id)`                              |

❌ 反例：`filter` 掉旧的再 `push` 一个 `generateId()` 的新 instance —— 会让原 cast 的
绿条在此刻断开，新 interval 被错误归属到当前 cast。

详细契约（带反例）见 `src/types/status.ts:MitigationStatus.instanceId` 注释。
```

### Step 4.2: Commit

- [ ] Run:

```bash
git add CLAUDE.md
git commit -m "docs(claude): 加 Executor 写作规范章节，指向 instanceId 契约"
```

---

## Task 5: SkillTracksCanvas + CastEventIcon 切换数据源

**Files:**

- Modify: `src/components/Timeline/CastEventIcon.tsx`
- Modify: `src/components/Timeline/SkillTracksCanvas.tsx`

### Step 5.1: CastEventIcon 加 effectiveEndSec prop，删绿条侧 nextCastTime 用法

- [ ] 修改 `src/components/Timeline/CastEventIcon.tsx`：

  接口改动（约 14-43 行）：

```ts
interface CastEventIconProps {
  castEvent: CastEvent
  action: MitigationAction
  displayAction?: MitigationAction
  invalidReason?: InvalidReason | null
  invalidResourceId?: string | null
  isSelected: boolean
  zoomLevel: number
  trackY: number
  leftBoundary: number
  rightBoundary: number
  /**
   * 同 trackGroup 下一 cast 的 timestamp。
   * 仍保留：cdBar 的 visualEndSec 用它截短，绿条不再使用。
   */
  nextCastTime: number
  /**
   * 该 cast 的绿条结束秒数（来自 simulate 的 castEffectiveEndByCastEventId）。
   * 父组件已做 fallback：cast 无 executor / 无附着时 = ts + action.duration。
   */
  effectiveEndSec: number
  scrollLeft: number
  scrollTop: number
  onSelect: () => void
  onDragStart?: () => void
  onDragEnd: (x: number) => void
  onContextMenu: (e: KonvaContextMenuEvent) => void
  onHover: (action: MitigationAction, e: KonvaEventObject<MouseEvent>) => void
  onHoverEnd: () => void
  onClickIcon: (action: MitigationAction, e: KonvaEventObject<MouseEvent | TouchEvent>) => void
  isReadOnly?: boolean
  cdBarEnd: number | null
  timelineEndSec: number
}
```

函数体内（约 71-75 行）`effectiveDuration` 改为：

```ts
const effectiveDuration = Math.max(0, effectiveEndSec - castEvent.timestamp)
```

删除 `nextCastTime === Infinity ? action.duration : Math.min(action.duration, nextCastTime - castEvent.timestamp)` 这一段。

绿条本体 + 外缘光晕的渲染条件（约 130 行 / 147 行）从 `action.duration > 0` 改为 `effectiveDuration > 0`：

```tsx
{isSelected && effectiveDuration > 0 && (
  <Rect
    x={26}
    y={-15}
    width={Math.max(0, effectiveDuration * zoomLevel - 26)}
    ...
  />
)}

{effectiveDuration > 0 && (
  <Rect
    x={26}
    y={-15}
    width={Math.max(0, effectiveDuration * zoomLevel - 26)}
    ...
  />
)}
```

末尾文字（约 161-175 行）：

```tsx
{
  effectiveDuration >= 3 && (
    <Text
      x={effectiveDuration * zoomLevel - 32}
      y={0}
      width={28}
      align="right"
      text={`${Math.round(effectiveDuration)}s`}
      fontSize={10}
      fill={isSelected ? '#ffffff' : '#10b981'}
      fontStyle="bold"
      fontFamily="Arial, sans-serif"
      perfectDrawEnabled={false}
      listening={false}
    />
  )
}
```

cdBar 的 `visualEndSec`（约 79 行）保持原样——它继续用 `nextCastTime` 截短：

```ts
const rawEndSec = cdBarEnd === null ? null : cdBarEnd === Infinity ? timelineEndSec : cdBarEnd
const visualEndSec = rawEndSec === null ? null : Math.min(rawEndSec, nextCastTime)
const cdBarWidth =
  visualEndSec === null
    ? 0
    : Math.max(0, (visualEndSec - castEvent.timestamp) * zoomLevel - effectiveDuration * zoomLevel)
```

保持不变；`effectiveDuration` 现在含义是真实绿条宽度，cdBar 紧跟其后。

### Step 5.2: SkillTracksCanvas 算 effectiveEndSec 并传给 icon

- [ ] 修改 `src/components/Timeline/SkillTracksCanvas.tsx`：

  顶部 import 区追加：

```ts
import { useCastEffectiveEnd } from '@/contexts/DamageCalculationContext'
```

组件函数体内、`useFilteredTimelineView()` 调用附近（约 119 行）：

```ts
const castEffectiveEnd = useCastEffectiveEnd()
```

渲染 cast 的循环（约 599 行附近）的 `<CastEventIcon ... />`，在调用前算 `effectiveEndSec`：

```tsx
const fallbackEnd = castEvent.timestamp + action.duration
const effectiveEndSec = castEffectiveEnd.get(castEvent.id) ?? fallbackEnd

return (
  <CastEventIcon
    ...
    nextCastTime={nextCastTime}
    effectiveEndSec={effectiveEndSec}
    ...
  />
)
```

`visibleBarsByTrack` 的预聚合（约 135-177 行）也换口径——把 `Math.min(other.duration, nextCastTime - ce.timestamp)` 替换为基于 `castEffectiveEnd` 的算法：

```ts
const visibleBarsByTrack = useMemo(() => {
  const bucket = new Map<string, { from: number; to: number }[]>()
  if (!actionMap) return bucket

  const grouped = new Map<string, CastEvent[]>()
  for (const ce of timeline.castEvents) {
    const other = actionMap.get(ce.actionId)
    if (!other) continue
    const groupId = effectiveTrackGroup(other)
    const key = `${ce.playerId}|${groupId}`
    const arr = grouped.get(key) ?? []
    arr.push(ce)
    grouped.set(key, arr)
  }
  for (const arr of grouped.values()) {
    arr.sort((a, b) => a.timestamp - b.timestamp)
  }

  for (const [key, arr] of grouped) {
    const bucketArr: { from: number; to: number }[] = []
    for (let i = 0; i < arr.length; i++) {
      const ce = arr[i]
      const other = actionMap.get(ce.actionId)
      if (!other) continue
      const nextCastTime = i + 1 < arr.length ? arr[i + 1].timestamp : Infinity
      // 绿条末端：来自 simulate；缺失则回退 action.duration
      const fallbackEnd = ce.timestamp + other.duration
      const greenEnd = castEffectiveEnd.get(ce.id) ?? fallbackEnd
      // cdBar 末端：原算法不变
      const cdEnd = engine?.cdBarEndFor(ce.id) ?? null
      const rawEnd = cdEnd === null ? null : cdEnd === Infinity ? maxTime : cdEnd
      const visualEnd = rawEnd === null ? greenEnd : Math.min(rawEnd, nextCastTime)
      const visibleEnd = Math.max(greenEnd, visualEnd)
      bucketArr.push({ from: ce.timestamp, to: visibleEnd })
    }
    bucket.set(key, bucketArr)
  }

  const merged = new Map<string, { from: number; to: number }[]>()
  for (const [k, arr] of bucket) {
    merged.set(k, mergeOverlapping(sortIntervals(arr)))
  }
  return merged
}, [timeline.castEvents, actionMap, engine, maxTime, castEffectiveEnd])
```

注意：依赖数组追加 `castEffectiveEnd`（context 值变更时重算）。

### Step 5.3: 类型检查

- [ ] Run: `pnpm exec tsc --noEmit`
- Expected: 无错误

### Step 5.4: lint + 测试

- [ ] Run: `pnpm lint`
- Expected: 无错误
- [ ] Run: `pnpm test:run`
- Expected: 全部 PASS（已有视图相关 unit test 不会被本改动破坏）

### Step 5.5: 浏览器手动验证（按 spec 测试节）

- [ ] 启动 `pnpm dev`（如未启动）
- [ ] 在编辑器里手动新建（或复用现有）时间轴，逐项验证：
  - **Case A — 盾击穿**：放一个贤者 37013（意气轩昂之策），后接一个 1_000_000+ 伤害事件；检查绿条末端在击穿事件时间处收束，末尾文字 = 实际存活秒数
  - **Case B — uniqueGroup 替换**：连续两次 16536（节制）于 t=10 / t=20；检查第一条绿条在 t=20 处止，文字显示 `10s`
  - **Case C — trackGroup 变体**：放一个 37013 + 一个 37016（启用炽天附体后），共 trackGroup；检查替换点收束符合预期
  - **Case D — 无 executor 兜底**：找一个有 `duration > 0` 但无 executor 的 action（grep `duration: ` 但无 `executor:` 的条目）；检查绿条按 `action.duration` 显示
- [ ] 检查未选中 cast 的绿条同样按新长度渲染（不只是 `isSelected` 才生效）
- [ ] 检查盾被秒穿（`effectiveDuration < 3`）时绿条画 0/小宽度但文字不显示

### Step 5.6: Commit

- [ ] Run:

```bash
git add src/components/Timeline/CastEventIcon.tsx src/components/Timeline/SkillTracksCanvas.tsx
git commit -m "feat(timeline): 绿条长度跟随 simulate 的 castEffectiveEnd"
```

---

## Task 6: 自检 cdBar 的 nextCastTime 截短是否冗余

**Files:**

- Read: `src/utils/placement/engine.ts`
- (可能) Modify: `src/components/Timeline/CastEventIcon.tsx`

**目的：** 决定 cdBar 那侧的 `Math.min(rawEndSec, nextCastTime)` 是否可以一并删除。

### Step 6.1: 阅读 engine.cdBarEndFor 的实现

- [ ] Run: `grep -n "cdBarEndFor" src/utils/placement/engine.ts | head -20`
- [ ] Read 该函数体（不超过 100 行），确认它返回的 `rawEnd` 是否已考虑同 trackGroup 下一 cast 的 timestamp 截短。

### Step 6.2: 如果 engine 已截短，删 CastEventIcon 的 nextCastTime 用法

- [ ] 删除 `CastEventIcon.tsx` 内 `Math.min(rawEndSec, nextCastTime)`，简化为 `const visualEndSec = rawEndSec`
- [ ] 同时删 prop `nextCastTime`、删 SkillTracksCanvas 的传值
- [ ] 跑 `pnpm exec tsc --noEmit && pnpm lint && pnpm test:run`
- [ ] 浏览器手测：确认蓝条在变体技能（如 37013 / 37016）替换点同样止步，没有溢出
- [ ] Commit:

```bash
git add src/components/Timeline/CastEventIcon.tsx src/components/Timeline/SkillTracksCanvas.tsx
git commit -m "refactor(timeline): cdBar 改用 engine.cdBarEndFor 单一信息源，删 nextCastTime prop"
```

### Step 6.3: 如果 engine 未截短，保留现状

- [ ] 在 `CastEventIcon.tsx` 的 `nextCastTime` prop 注释上加一句"cdBar 仍依赖此 prop 截短，engine 当前不处理"
- [ ] 不 commit（无代码变更）

---

## Task 7: 全量验证 + 兜底测试

**Files:** N/A（仅 CI/手测）

### Step 7.1: 全量类型检查 / lint / test

- [ ] Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test:run`
- Expected: 全部 PASS
- 如失败：修到通过为止，再补一条 commit

### Step 7.2: 浏览器回归（重点检查可能受影响的 UI 区域）

- [ ] 主时间轴 Canvas：拖拽 cast、改 zoom、滚动—— 绿条 / 文字 / cd 蓝条都正常
- [ ] 不可放阴影：跨绿条改动后的 shadow 减算正确（不出现绿条上方有阴影斜纹的情况）
- [ ] TimelineTable：表格视图下技能持续时间列（如有）保持当前行为
- [ ] 表格 / 详情面板的"applied statuses" 显示不变（数据来源是 calculator 不是绿条）

### Step 7.3: 不需要 commit（仅验证）

- 验证发现 bug → 修 → 单独 commit；无 bug 直接收尾。

---

## 完成标准

- [ ] simulate 输出 `castEffectiveEndByCastEventId`，新增 6 条单测全 PASS：自然过期 / 盾穿+buff 还活（取 max） / 单纯盾穿 / uniqueGroup 替换 / 多 status max / seeded buff 跳过
- [ ] CastEventIcon 接收 `effectiveEndSec`，绿条 + 文字反映真实存活时长
- [ ] 浏览器手动验证 4 个 case 全部通过
- [ ] `pnpm exec tsc --noEmit && pnpm lint && pnpm test:run` 全绿
- [ ] CLAUDE.md / `MitigationStatus.instanceId` 注释更新到位

## 不在本计划范围

- 中期"延长 / 变身 / 立即引爆"类 executor 本身的实现
- buff lineage（`parentInstanceId` / `lineageId`）—— 本计划假定 executor 遵循 instanceId 约束
- status 的 `onTerminate` / `onRemove` 钩子
- `MitigationAction.primaryStatusId` 字段
