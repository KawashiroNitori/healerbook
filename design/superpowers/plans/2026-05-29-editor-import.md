# 编辑器内"导入到当前时间轴" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `EditorPage` 工具栏新增「导入」入口，允许把 FFLogs 报告或副本模板的数据**追加**到当前时间轴（伤害事件 / 技能使用 / sync 锚点），支持时间区间过滤与技能使用合法性校验。

**Architecture:** 用一组**纯函数**（`importAdapter.ts`）做提取/过滤/职业映射/cast 校验/sync 去重；新增一个 `bulkImport` Zustand action，把所有写入塞进单个 Y.Doc 事务（一次 Ctrl+Z 全回滚）；UI 是 2 步 wizard 对话框，第 1 步选源 + 拉取，第 2 步配置 + 实时预览。

**Tech Stack:** React 19 + TypeScript、Zustand 5、Yjs、Vitest 4、shadcn/ui + 自家 `TimeInput`、ky（HTTP）。

**相关 spec:** `design/superpowers/specs/2026-05-29-editor-import-design.md`

---

## 文件结构

- **`src/utils/importAdapter.ts`**（新建）：纯函数集合 —— `extractImportableFromTimeline` / `filterByRange` / `buildPlayerIdMap` / `validateCastsForImport` / `dedupeSyncEvents`。dialog 与 store 都消费它。
- **`src/utils/importAdapter.test.ts`**（新建）：上述函数的单测，每个函数独立 `describe`。
- **`src/store/timelineStore.ts`**（修改）：新增 `bulkImport` action；在 `engine.doc.transact(..., LOCAL_ORIGIN)` 内调既有 `yAddDamageEvent` / `yAddCastEvent` + `ySetMeta`。
- **`src/store/timelineStore.test.ts`**（修改）：新增 `bulkImport` 原子性 + undo 单步性测试。
- **`src/components/ImportIntoTimelineDialog.tsx`**（新建）：wizard 对话框组件，基于现有 `Modal`。
- **`src/components/EditorToolbar.tsx`**（修改）：新增 `Upload` 图标按钮 + 受控渲染（viewer / replay 不渲染、editLock 不允许写时 disabled）+ 引导挂载 dialog。

---

## Task 1: importAdapter — `extractImportableFromTimeline`

**Files:**

- Create: `src/utils/importAdapter.ts`
- Test: `src/utils/importAdapter.test.ts`

`extractImportableFromTimeline` 把 `/api/fflogs/import` 返回的完整 `Timeline` 收窄到导入路径关心的子集，方便上层不接触整个 timeline 形状。

- [ ] **Step 1: 写失败测试**

`src/utils/importAdapter.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import type { Timeline } from '@/types/timeline'
import { extractImportableFromTimeline } from './importAdapter'

const baseTimeline = (overrides: Partial<Timeline> = {}): Timeline => ({
  id: 't1',
  name: 'fake',
  encounter: { id: 1077, name: 'M3S', displayName: 'M3S', zone: '', damageEvents: [] },
  composition: { players: [] },
  damageEvents: [],
  castEvents: [],
  statusEvents: [],
  annotations: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

describe('extractImportableFromTimeline', () => {
  it('提取三个事件数组 + encounter + 拼接 sourceLabel', () => {
    const t = baseTimeline({
      damageEvents: [{ id: 'd1', name: 'X', time: 1, damage: 100, type: 'aoe' }],
      castEvents: [{ id: 'c1', actionId: 7382, timestamp: 2, playerId: 1 }],
      syncEvents: [
        { time: 1, type: 'cast', actionId: 100, actionName: 'A', window: [2, 2], syncOnce: false },
      ],
      fflogsSource: { reportCode: 'ABC123', fightId: 5 },
    })

    const out = extractImportableFromTimeline(t)

    expect(out.damageEvents).toHaveLength(1)
    expect(out.castEvents).toHaveLength(1)
    expect(out.syncEvents).toHaveLength(1)
    expect(out.encounter?.id).toBe(1077)
    expect(out.sourceLabel).toContain('ABC123')
    expect(out.sourceLabel).toContain('#5')
    expect(out.sourceLabel).toContain('M3S')
  })

  it('syncEvents 缺失时返回空数组', () => {
    const t = baseTimeline()
    expect(extractImportableFromTimeline(t).syncEvents).toEqual([])
  })

  it('fflogsSource 缺失时 sourceLabel 仅含 encounter 名', () => {
    const t = baseTimeline()
    expect(extractImportableFromTimeline(t).sourceLabel).toBe('M3S')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/importAdapter.test.ts`
Expected: FAIL，找不到 `./importAdapter` 模块。

- [ ] **Step 3: 写实现**

`src/utils/importAdapter.ts`：

```ts
/**
 * 编辑器导入适配层 —— 纯函数。
 *
 * 把 /api/fflogs/import 返回的 Timeline 或 /api/encounter-templates 返回的事件，
 * 收窄成「可追加到当前时间轴」的子集，并提供过滤 / 职业映射 / cast 校验 / sync 去重。
 */

import type { Timeline, DamageEvent, CastEvent, SyncEvent } from '@/types/timeline'

export interface ImportableSubset {
  damageEvents: DamageEvent[]
  castEvents: CastEvent[]
  syncEvents: SyncEvent[]
  encounter: Timeline['encounter'] | null
  /** 显示给用户的来源标签，例："报告 ABC123 / 战斗 #5「M3S」" 或 "M3S" */
  sourceLabel: string
}

export function extractImportableFromTimeline(t: Timeline): ImportableSubset {
  const parts: string[] = []
  if (t.fflogsSource) {
    parts.push(`报告 ${t.fflogsSource.reportCode}`)
    parts.push(`战斗 #${t.fflogsSource.fightId}`)
  }
  if (t.encounter?.name) parts.push(t.encounter.name)

  return {
    damageEvents: t.damageEvents ?? [],
    castEvents: t.castEvents ?? [],
    syncEvents: t.syncEvents ?? [],
    encounter: t.encounter ?? null,
    sourceLabel: parts.join(' / ') || '未知来源',
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run src/utils/importAdapter.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: tsc + commit**

```bash
pnpm exec tsc --noEmit
git add src/utils/importAdapter.ts src/utils/importAdapter.test.ts
git commit -m "feat(import): add extractImportableFromTimeline"
```

---

## Task 2: importAdapter — `filterByRange`

**Files:**

- Modify: `src/utils/importAdapter.ts`
- Modify: `src/utils/importAdapter.test.ts`

按时间范围过滤事件。`damageEvents` 用 `time`、`castEvents` 用 `timestamp`、`syncEvents` 用 `time`，故签名带 `getTime` 提取器。

- [ ] **Step 1: 写失败测试**

在 `src/utils/importAdapter.test.ts` 顶部 import 行追加 `filterByRange`：

```ts
import { extractImportableFromTimeline, filterByRange } from './importAdapter'
```

末尾追加：

```ts
describe('filterByRange', () => {
  const events = [
    { id: 'a', t: 10 },
    { id: 'b', t: 20 },
    { id: 'c', t: 30 },
    { id: 'd', t: 40 },
  ]
  const getT = (e: { t: number }) => e.t

  it('mode=all 返回原数组（不复制顺序变化）', () => {
    expect(filterByRange(events, { mode: 'all' }, getT)).toEqual(events)
  })

  it('mode=range 起点包含、终点排除', () => {
    const out = filterByRange(events, { mode: 'range', start: 20, end: 40 }, getT)
    expect(out.map(e => e.id)).toEqual(['b', 'c'])
  })

  it('end=null 表示 +∞，只受 start 约束', () => {
    const out = filterByRange(events, { mode: 'range', start: 25, end: null }, getT)
    expect(out.map(e => e.id)).toEqual(['c', 'd'])
  })

  it('start === end 返回空', () => {
    expect(filterByRange(events, { mode: 'range', start: 20, end: 20 }, getT)).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/importAdapter.test.ts`
Expected: FAIL，找不到 `filterByRange`。

- [ ] **Step 3: 实现**

在 `src/utils/importAdapter.ts` 末尾追加：

```ts
export type ImportRange = { mode: 'all' } | { mode: 'range'; start: number; end: number | null }

export function filterByRange<T>(events: T[], range: ImportRange, getTime: (e: T) => number): T[] {
  if (range.mode === 'all') return events
  return events.filter(e => {
    const t = getTime(e)
    if (t < range.start) return false
    if (range.end !== null && t >= range.end) return false
    return true
  })
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm test:run src/utils/importAdapter.test.ts`
Expected: PASS（4 + 上一任务 3 = 7 tests）。

- [ ] **Step 5: commit**

```bash
git add src/utils/importAdapter.ts src/utils/importAdapter.test.ts
git commit -m "feat(import): add filterByRange"
```

---

## Task 3: importAdapter — `buildPlayerIdMap`

**Files:**

- Modify: `src/utils/importAdapter.ts`
- Modify: `src/utils/importAdapter.test.ts`

按 `composition.players` 出现顺序，先按职业分组，组内第 i 个 incoming player → 组内第 i 个 current player。组缺失或组内长度不够 → 该 incoming player 不入 map。

- [ ] **Step 1: 写失败测试**

import 行追加 `buildPlayerIdMap`。末尾追加：

```ts
import type { Composition } from '@/types/timeline'

const comp = (entries: Array<[number, string]>): Composition => ({
  players: entries.map(([id, job]) => ({ id, job: job as Composition['players'][number]['job'] })),
})

describe('buildPlayerIdMap', () => {
  it('1:1 全匹配', () => {
    const incoming = comp([
      [100, 'WHM'],
      [101, 'SCH'],
    ])
    const current = comp([
      [1, 'WHM'],
      [2, 'SCH'],
    ])
    const map = buildPlayerIdMap(incoming, current)
    expect(map.get(100)).toBe(1)
    expect(map.get(101)).toBe(2)
  })

  it('多对多按出现顺序匹配', () => {
    const incoming = comp([
      [100, 'WHM'],
      [101, 'WHM'],
      [102, 'SCH'],
    ])
    const current = comp([
      [1, 'WHM'],
      [2, 'SCH'],
      [3, 'WHM'],
    ])
    const map = buildPlayerIdMap(incoming, current)
    expect(map.get(100)).toBe(1) // 双方第 1 个 WHM
    expect(map.get(101)).toBe(3) // 双方第 2 个 WHM
    expect(map.get(102)).toBe(2) // 双方第 1 个 SCH
  })

  it('incoming 多余职业 → 不入 map', () => {
    const incoming = comp([
      [100, 'WHM'],
      [101, 'AST'],
    ])
    const current = comp([[1, 'WHM']])
    const map = buildPlayerIdMap(incoming, current)
    expect(map.get(100)).toBe(1)
    expect(map.has(101)).toBe(false)
  })

  it('incoming 同职业人数 > current → 多出的不入 map', () => {
    const incoming = comp([
      [100, 'WHM'],
      [101, 'WHM'],
    ])
    const current = comp([[1, 'WHM']])
    const map = buildPlayerIdMap(incoming, current)
    expect(map.get(100)).toBe(1)
    expect(map.has(101)).toBe(false)
  })

  it('current 多余职业 → incoming 不分配对应 player', () => {
    const incoming = comp([[100, 'WHM']])
    const current = comp([
      [1, 'WHM'],
      [2, 'SCH'],
    ])
    const map = buildPlayerIdMap(incoming, current)
    expect(map.get(100)).toBe(1)
  })

  it('完全无交集 → 空 map', () => {
    const incoming = comp([[100, 'AST']])
    const current = comp([[1, 'WHM']])
    expect(buildPlayerIdMap(incoming, current).size).toBe(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/importAdapter.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`src/utils/importAdapter.ts` 末尾追加：

```ts
import type { Composition } from '@/types/timeline'

export function buildPlayerIdMap(incoming: Composition, current: Composition): Map<number, number> {
  // 双方按 job 分桶，组内保持 composition.players 出现顺序
  const groupByJob = (c: Composition): Map<string, number[]> => {
    const groups = new Map<string, number[]>()
    for (const p of c.players) {
      const arr = groups.get(p.job)
      if (arr) arr.push(p.id)
      else groups.set(p.job, [p.id])
    }
    return groups
  }
  const inc = groupByJob(incoming)
  const cur = groupByJob(current)
  const map = new Map<number, number>()
  for (const [job, incIds] of inc) {
    const curIds = cur.get(job)
    if (!curIds) continue
    for (let i = 0; i < incIds.length; i++) {
      const target = curIds[i]
      if (target === undefined) break
      map.set(incIds[i], target)
    }
  }
  return map
}
```

> 注：上面 import 行已经声明过 `Composition`（来自 timeline.ts），如果文件里没有，把 `import type { Composition } from '@/types/timeline'` 加进顶部既有的 import 块。

- [ ] **Step 4: 跑测试**

Run: `pnpm test:run src/utils/importAdapter.test.ts`
Expected: PASS（+6 tests，累计 13）。

- [ ] **Step 5: commit**

```bash
git add src/utils/importAdapter.ts src/utils/importAdapter.test.ts
git commit -m "feat(import): add buildPlayerIdMap by job-position"
```

---

## Task 4: importAdapter — `validateCastsForImport`

**Files:**

- Modify: `src/utils/importAdapter.ts`
- Modify: `src/utils/importAdapter.test.ts`

按时间序遍历 incoming casts：

1. playerId 不在 map → 跳过
2. 映射 playerId、actionId 不在 actions 注册表 → 跳过
3. 用 placement engine 检查 `canPlaceCastEvent` → false 跳过
4. 通过的进 kept，并把它"加入虚拟 castEvents 列表"重建 engine，让后续 cast 看到它

`createPlacementEngine` 已在 `src/utils/placement/engine.ts` 提供；本函数为简化使用，传 engine 工厂函数避免直接耦合。

- [ ] **Step 1: 写失败测试**

import 追加 `validateCastsForImport`，并补 `createPlacementEngine`、`MITIGATION_DATA`。在末尾追加：

```ts
import type { CastEvent } from '@/types/timeline'
import { createPlacementEngine } from '@/utils/placement/engine'
import { MITIGATION_DATA } from '@/data/mitigationActions'

describe('validateCastsForImport', () => {
  const fakeAction = MITIGATION_DATA.actions.find(a => a.cooldown && a.cooldown >= 60)!
  const actionId = fakeAction.id
  const job = fakeAction.jobs[0]
  const currentComp: Composition = { players: [{ id: 1, job }] }
  const incomingComp: Composition = { players: [{ id: 100, job }] }
  const baseTimeline = (): Timeline => ({
    id: 't',
    name: '',
    encounter: { id: 0, name: '', displayName: '', zone: '', damageEvents: [] },
    composition: currentComp,
    damageEvents: [],
    castEvents: [],
    statusEvents: [],
    annotations: [],
    createdAt: 0,
    updatedAt: 0,
  })

  it('playerId 不在 map → 跳过', () => {
    const map = buildPlayerIdMap({ players: [] }, currentComp) // 空 map
    const incoming: CastEvent[] = [{ id: 'i1', actionId, timestamp: 10, playerId: 100 }]
    const result = validateCastsForImport({
      incoming,
      playerIdMap: map,
      baseTimeline: baseTimeline(),
      mitigationActions: MITIGATION_DATA.actions,
      statusTimelineByPlayer: new Map(),
      createEngine: createPlacementEngine,
    })
    expect(result.kept).toHaveLength(0)
    expect(result.skipped).toBe(1)
  })

  it('actionId 不在 registry → 跳过', () => {
    const map = buildPlayerIdMap(incomingComp, currentComp)
    const incoming: CastEvent[] = [{ id: 'i1', actionId: 99999999, timestamp: 10, playerId: 100 }]
    const result = validateCastsForImport({
      incoming,
      playerIdMap: map,
      baseTimeline: baseTimeline(),
      mitigationActions: MITIGATION_DATA.actions,
      statusTimelineByPlayer: new Map(),
      createEngine: createPlacementEngine,
    })
    expect(result.kept).toHaveLength(0)
    expect(result.skipped).toBe(1)
  })

  it('同 player 同 action 间隔 < CD → 第 2 个进 skipped', () => {
    const map = buildPlayerIdMap(incomingComp, currentComp)
    const incoming: CastEvent[] = [
      { id: 'i1', actionId, timestamp: 10, playerId: 100 },
      { id: 'i2', actionId, timestamp: 11, playerId: 100 }, // 1 秒内重复
    ]
    const result = validateCastsForImport({
      incoming,
      playerIdMap: map,
      baseTimeline: baseTimeline(),
      mitigationActions: MITIGATION_DATA.actions,
      statusTimelineByPlayer: new Map(),
      createEngine: createPlacementEngine,
    })
    expect(result.kept).toHaveLength(1)
    expect(result.kept[0].playerId).toBe(1) // 映射后
    expect(result.skipped).toBe(1)
  })

  it('全合法 → kept = incoming（playerId 已映射）', () => {
    const map = buildPlayerIdMap(incomingComp, currentComp)
    const incoming: CastEvent[] = [{ id: 'i1', actionId, timestamp: 10, playerId: 100 }]
    const result = validateCastsForImport({
      incoming,
      playerIdMap: map,
      baseTimeline: baseTimeline(),
      mitigationActions: MITIGATION_DATA.actions,
      statusTimelineByPlayer: new Map(),
      createEngine: createPlacementEngine,
    })
    expect(result.kept).toHaveLength(1)
    expect(result.kept[0].playerId).toBe(1)
    expect(result.kept[0].actionId).toBe(actionId)
    expect(result.skipped).toBe(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/importAdapter.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`src/utils/importAdapter.ts` 顶部 import 追加：

```ts
import type { MitigationAction } from '@/types/mitigation'
import type { StatusTimelineByPlayer } from '@/utils/placement/types'
import type { PlacementEngine } from '@/utils/placement/types'
import type { createPlacementEngine } from '@/utils/placement/engine'
```

末尾追加：

```ts
export interface ValidateCastsArgs {
  incoming: CastEvent[]
  playerIdMap: Map<number, number>
  baseTimeline: Timeline
  mitigationActions: MitigationAction[]
  statusTimelineByPlayer: StatusTimelineByPlayer
  /** 注入 engine factory，方便测试 / 解耦 */
  createEngine: typeof createPlacementEngine
}

export function validateCastsForImport(args: ValidateCastsArgs): {
  kept: CastEvent[]
  skipped: number
} {
  const {
    incoming,
    playerIdMap,
    baseTimeline,
    mitigationActions,
    statusTimelineByPlayer,
    createEngine,
  } = args
  const actionMap = new Map(mitigationActions.map(a => [a.id, a]))
  const sorted = [...incoming].sort((a, b) => a.timestamp - b.timestamp)

  const accepted: CastEvent[] = []
  let skipped = 0

  // 每次接受新 cast 后重建 engine —— O(n²) 但 n≈50，可接受
  const buildEngine = (): PlacementEngine =>
    createEngine({
      castEvents: [...baseTimeline.castEvents, ...accepted],
      actions: actionMap,
      statusTimelineByPlayer,
    })
  let engine = buildEngine()

  for (const raw of sorted) {
    const mappedId = playerIdMap.get(raw.playerId)
    if (mappedId === undefined) {
      skipped++
      continue
    }
    const action = actionMap.get(raw.actionId)
    if (!action) {
      skipped++
      continue
    }
    // excludeId 传 undefined：incoming cast 不在 engine 当前 castEvents 内，无需排除
    const result = engine.canPlaceCastEvent(action, mappedId, raw.timestamp, undefined)
    if (!result.ok) {
      skipped++
      continue
    }
    accepted.push({ ...raw, playerId: mappedId })
    engine = buildEngine()
  }

  return { kept: accepted, skipped }
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm test:run src/utils/importAdapter.test.ts`
Expected: PASS（+4 tests，累计 17）。

> 若 `MITIGATION_DATA.actions.find(a => a.cooldown && a.cooldown >= 60)` 返回 undefined（数据集变更导致），改成挑一个具体已知技能（如 `a.id === 7382`）并跳过断言中的"cd<60s"假设。

- [ ] **Step 5: commit**

```bash
git add src/utils/importAdapter.ts src/utils/importAdapter.test.ts
git commit -m "feat(import): add validateCastsForImport with placement engine"
```

---

## Task 5: importAdapter — `dedupeSyncEvents`

**Files:**

- Modify: `src/utils/importAdapter.ts`
- Modify: `src/utils/importAdapter.test.ts`

按 actionId 与现有 timeline.syncEvents 比对：existing 已有该 actionId → 整条 incoming 丢；incoming 批内允许重复（同 boss 技能多次发动是合法的）。

- [ ] **Step 1: 写失败测试**

import 追加 `dedupeSyncEvents`。末尾追加：

```ts
import type { SyncEvent } from '@/types/timeline'

const sync = (actionId: number, time: number): SyncEvent => ({
  time,
  type: 'cast',
  actionId,
  actionName: `a${actionId}`,
  window: [2, 2],
  syncOnce: false,
})

describe('dedupeSyncEvents', () => {
  it('existing 已有 actionId → 整条 incoming 丢', () => {
    const existing: SyncEvent[] = [sync(100, 5)]
    const incoming: SyncEvent[] = [sync(100, 10), sync(100, 20), sync(200, 30)]
    const out = dedupeSyncEvents(incoming, existing)
    expect(out.kept.map(s => s.actionId)).toEqual([200])
    expect(out.dedupedCount).toBe(2)
  })

  it('existing 为空 → 全部保留', () => {
    const incoming: SyncEvent[] = [sync(100, 1), sync(200, 2)]
    const out = dedupeSyncEvents(incoming, [])
    expect(out.kept).toHaveLength(2)
    expect(out.dedupedCount).toBe(0)
  })

  it('incoming 批内同 actionId 多次 → 全部保留', () => {
    const incoming: SyncEvent[] = [sync(100, 1), sync(100, 2), sync(100, 3)]
    const out = dedupeSyncEvents(incoming, [])
    expect(out.kept).toHaveLength(3)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/importAdapter.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`src/utils/importAdapter.ts` 末尾追加：

```ts
export function dedupeSyncEvents(
  incoming: SyncEvent[],
  existing: SyncEvent[]
): { kept: SyncEvent[]; dedupedCount: number } {
  const taken = new Set(existing.map(s => s.actionId))
  const kept: SyncEvent[] = []
  let dedupedCount = 0
  for (const s of incoming) {
    if (taken.has(s.actionId)) {
      dedupedCount++
      continue
    }
    kept.push(s)
  }
  return { kept, dedupedCount }
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm test:run src/utils/importAdapter.test.ts`
Expected: PASS（+3 tests，累计 20）。

- [ ] **Step 5: tsc + commit**

```bash
pnpm exec tsc --noEmit
git add src/utils/importAdapter.ts src/utils/importAdapter.test.ts
git commit -m "feat(import): add dedupeSyncEvents by actionId"
```

---

## Task 6: timelineStore — `bulkImport` action

**Files:**

- Modify: `src/store/timelineStore.ts`
- Modify: `src/store/timelineStore.test.ts`

新增 `bulkImport`，把 damage / cast 用 `yAddDamageEvent` / `yAddCastEvent` 写入，sync 用 `ySetMeta` 整数组替换。整批包在一个外层 `engine.doc.transact(..., LOCAL_ORIGIN)` 内（Yjs 事务可重入合并，UndoManager 视为一个 step）。

- [ ] **Step 1: 在 `timelineStore.test.ts` 末尾追加测试**

先确定文件顶部 import 是否已含必要类型；如未含，追加：

```ts
import type { DamageEvent, CastEvent, SyncEvent } from '@/types/timeline'
```

末尾追加新 `describe`：

```ts
describe('bulkImport', () => {
  beforeEach(async () => {
    const store = useTimelineStore.getState()
    await store.openTimeline('bulk-import-test', { role: 'local' })
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  it('一次写入若干 damage / cast / sync，仅一步 undo 全部回滚', () => {
    const before = useTimelineStore.getState().timeline!
    const damages: DamageEvent[] = [
      { id: 'will-regen-1', name: 'd1', time: 1, damage: 100, type: 'aoe' },
      { id: 'will-regen-2', name: 'd2', time: 2, damage: 200, type: 'aoe' },
    ]
    const casts: CastEvent[] = [{ id: 'will-regen-c1', actionId: 7382, timestamp: 1, playerId: 1 }]
    const syncs: SyncEvent[] = [
      { time: 1, type: 'cast', actionId: 100, actionName: 'A', window: [2, 2], syncOnce: false },
    ]

    useTimelineStore
      .getState()
      .bulkImport({ damageEvents: damages, castEvents: casts, syncEvents: syncs })

    const after = useTimelineStore.getState().timeline!
    expect(after.damageEvents.length).toBe(before.damageEvents.length + 2)
    expect(after.castEvents.length).toBe(before.castEvents.length + 1)
    expect(after.syncEvents?.length).toBe(1)

    // 一步 undo 即清空
    expect(useTimelineStore.getState().canUndo).toBe(true)
    useTimelineStore.getState().undo()

    const reverted = useTimelineStore.getState().timeline!
    expect(reverted.damageEvents.length).toBe(before.damageEvents.length)
    expect(reverted.castEvents.length).toBe(before.castEvents.length)
  })

  it('写入时给每条 damage / cast 重新生成 id（避免与现有冲突）', () => {
    useTimelineStore.getState().bulkImport({
      damageEvents: [{ id: 'foo', name: 'd', time: 1, damage: 100, type: 'aoe' }],
    })
    const ev = useTimelineStore.getState().timeline!.damageEvents.at(-1)!
    expect(ev.id).not.toBe('foo')
    expect(ev.id.length).toBeGreaterThan(4)
  })

  it('sync 整数组替换（带原有 sync 时与 incoming 合并并按 time 排序）', () => {
    // 先写一个 base sync
    const { engine } = useTimelineStore.getState() as unknown as {
      engine: { doc: import('yjs').Doc }
    }
    // 通过 store 不暴露的方式预置 sync 不方便；改用先 bulkImport 一条做 baseline
    useTimelineStore.getState().bulkImport({
      syncEvents: [
        { time: 10, type: 'cast', actionId: 100, actionName: 'A', window: [0, 0], syncOnce: false },
      ],
    })
    // 再追加另一条更早的
    useTimelineStore.getState().bulkImport({
      syncEvents: [
        { time: 5, type: 'cast', actionId: 200, actionName: 'B', window: [0, 0], syncOnce: false },
      ],
    })

    const sync = useTimelineStore.getState().timeline!.syncEvents!
    expect(sync.map(s => s.time)).toEqual([5, 10])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/store/timelineStore.test.ts`
Expected: FAIL（`bulkImport is not a function`）。

- [ ] **Step 3: 实现 store 改动**

在 `src/store/timelineStore.ts` 的 `interface TimelineState` 内找到 `removeAnnotation` 附近，追加：

```ts
  /** 批量导入：单个 Y.Doc 事务包裹所有写入，UndoManager 视为一步 */
  bulkImport: (data: {
    damageEvents?: DamageEvent[]
    castEvents?: CastEvent[]
    syncEvents?: SyncEvent[]
  }) => void
```

类型 import 在文件顶部找 `import type { Timeline, DamageEvent, CastEvent, Composition, Annotation } from '@/types/timeline'`，把 `SyncEvent` 加进去：

```ts
import type {
  Timeline,
  DamageEvent,
  CastEvent,
  Composition,
  Annotation,
  SyncEvent,
} from '@/types/timeline'
```

`generateId` 已经在文件顶部从 `@/utils/id` import；确认有，没有则补：

```ts
import { generateId } from '@/utils/id'
```

在 `create` 工厂内、`removeAnnotation` 实现之后追加：

```ts
    bulkImport: data => {
      const engine = get().engine
      if (!engine) return
      const damageEvents = data.damageEvents ?? []
      const castEvents = data.castEvents ?? []
      const syncEvents = data.syncEvents ?? []
      if (damageEvents.length === 0 && castEvents.length === 0 && syncEvents.length === 0) return

      engine.doc.transact(() => {
        for (const e of damageEvents) {
          yAddDamageEvent(engine.doc, {
            ...e,
            id: generateId(),
            time: Math.max(0, e.time),
            snapshotTime: e.snapshotTime != null ? Math.max(0, e.snapshotTime) : e.snapshotTime,
          })
        }
        for (const c of castEvents) {
          yAddCastEvent(engine.doc, { ...c, id: generateId() })
        }
        if (syncEvents.length > 0) {
          const existing = get().timeline?.syncEvents ?? []
          const merged = [...existing, ...syncEvents].sort((a, b) => a.time - b.time)
          ySetMeta(engine.doc, { syncEvents: merged })
        }
      }, LOCAL_ORIGIN)
    },
```

- [ ] **Step 4: 跑测试**

Run: `pnpm test:run src/store/timelineStore.test.ts`
Expected: PASS（+3 tests）。

- [ ] **Step 5: tsc + commit**

```bash
pnpm exec tsc --noEmit
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "feat(store): add bulkImport action with atomic transaction"
```

---

## Task 7: 工具栏按钮 + 对话框骨架（无功能）

**Files:**

- Create: `src/components/ImportIntoTimelineDialog.tsx`
- Modify: `src/components/EditorToolbar.tsx`

第一版只渲染按钮 + 空对话框（含 stepper + 取消按钮 + 占位文字）。确保按钮可见性规则正确：viewer / replay 不渲染，editLock 不允许 content 写入时 disabled。

- [ ] **Step 1: 创建空对话框组件**

`src/components/ImportIntoTimelineDialog.tsx`：

```tsx
/**
 * 导入到当前时间轴 —— 2 步 wizard
 *
 * Step 1: 选择来源（FFLogs 战斗 / 副本模板）+ 输入数据 + 解析
 * Step 2: 配置导入（数据类型 / 时间范围 / 实时预览 / 确认导入）
 *
 * 详见 design/superpowers/specs/2026-05-29-editor-import-design.md
 */

import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

interface ImportIntoTimelineDialogProps {
  open: boolean
  onClose: () => void
}

export default function ImportIntoTimelineDialog({ open, onClose }: ImportIntoTimelineDialogProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>导入到当前时间轴</ModalTitle>
        </ModalHeader>

        <div className="px-6 py-4 border-b text-sm text-muted-foreground">
          ① 选择来源 → ② 配置导入
        </div>

        <div className="px-6 py-8 min-h-[200px]">
          <p className="text-sm text-muted-foreground">（占位：后续任务填充）</p>
        </div>

        <ModalFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
```

- [ ] **Step 2: 在 `EditorToolbar.tsx` 引入按钮**

顶部 import 区，`Download` 行附近加 `Upload`：

```ts
import {
  // ... 现有图标
  Upload,
} from 'lucide-react'
```

文件顶部 lazy import 区（`ExportSoumaDialog` 附近）追加：

```ts
const ImportIntoTimelineDialog = lazy(() => import('./ImportIntoTimelineDialog'))
```

在组件函数体里、现有 `showSoumaDialog` 等 useState 附近追加：

```ts
const [showImportDialog, setShowImportDialog] = useState(false)
```

在工具栏 JSX 中、"导出" `DropdownMenu` 块**之后**追加：

```tsx
{
  /* 导入 */
}
{
  timeline && !timeline.isReplayMode && sessionRole !== 'viewer' && (
    <>
      <div className="w-px h-6 bg-border mx-1" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowImportDialog(true)}
            disabled={!editLock.can('content')}
          >
            <Upload className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">导入</TooltipContent>
      </Tooltip>
    </>
  )
}
```

`sessionRole` 已在文件顶部由 `useTimelineStore()` 解构出。如果当前没解构，从 `useTimelineStore` 取一下，或加：

```ts
const sessionRole = useTimelineStore(s => s.sessionRole)
```

在文件底部 `<Suspense>` 块内追加渲染（与 ExportSoumaDialog 同级）：

```tsx
{
  showImportDialog && (
    <ImportIntoTimelineDialog open={showImportDialog} onClose={() => setShowImportDialog(false)} />
  )
}
```

- [ ] **Step 3: 跑 lint + tsc**

```bash
pnpm exec tsc --noEmit
pnpm lint
```

Expected: 两者均无新增报错。

- [ ] **Step 4: 手动验证（叫用户跑）**

告诉用户跑 `pnpm dev`，在编辑器打开一个本地时间轴，验证：

- 工具栏右侧出现 Upload 图标按钮
- 点击弹出 Modal，显示"导入到当前时间轴"+ stepper 占位 + 取消按钮
- 在回放模式时间轴中，按钮**不渲染**
- 在 viewer 模式分享链接中，按钮**不渲染**

- [ ] **Step 5: commit**

```bash
git add src/components/ImportIntoTimelineDialog.tsx src/components/EditorToolbar.tsx
git commit -m "feat(import): add toolbar entry + dialog skeleton"
```

---

## Task 8: Step 1 表单 — FFLogs 来源（URL + 解析）

**Files:**

- Modify: `src/components/ImportIntoTimelineDialog.tsx`

实现 Step 1 的 FFLogs 形态：URL 输入 + 校验 + 自动剪贴板探测 + 「下一步」按钮触发解析（调 `/api/fflogs/import`），解析成功后切到 Step 2 占位。模板源在 Task 9 加。

- [ ] **Step 1: 重写 dialog 组件**

完整替换 `src/components/ImportIntoTimelineDialog.tsx`：

```tsx
/**
 * 导入到当前时间轴 —— 2 步 wizard
 *
 * Step 1: 选择来源（FFLogs 战斗 / 副本模板）+ 输入数据 + 解析
 * Step 2: 配置导入（数据类型 / 时间范围 / 实时预览 / 确认导入）
 *
 * 详见 design/superpowers/specs/2026-05-29-editor-import-design.md
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { apiClient } from '@/api/apiClient'
import { parseFFLogsUrl } from '@/utils/fflogsParser'
import { parseFromAny } from '@/utils/timelineFormat'
import { parseApiError } from '@/api/parseApiError'
import { generateId } from '@/utils/id'
import { extractImportableFromTimeline, type ImportableSubset } from '@/utils/importAdapter'

interface ImportIntoTimelineDialogProps {
  open: boolean
  onClose: () => void
}

type Step = 1 | 2
type SourceKind = 'fflogs'

export default function ImportIntoTimelineDialog({ open, onClose }: ImportIntoTimelineDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>(1)
  const [source] = useState<SourceKind>('fflogs') // 模板源在 Task 9 引入
  const [url, setUrl] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [error, setError] = useState('')
  const [parsed, setParsed] = useState<ImportableSubset | null>(null)
  /** parsed 对应的 URL，用于检测用户改动 URL 后是否需要重新解析 */
  const [parsedKey, setParsedKey] = useState<string>('')

  // 自动聚焦 + 剪贴板探测
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    void (async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (text && /fflogs\.com\/reports\//.test(text)) setUrl(text)
      } catch {
        /* 剪贴板权限拒绝，静默 */
      }
    })()
  }, [open])

  // 关闭时重置内部态
  useEffect(() => {
    if (!open) {
      setStep(1)
      setUrl('')
      setError('')
      setParsed(null)
      setParsedKey('')
      setIsParsing(false)
    }
  }, [open])

  const parsedUrl = url ? parseFFLogsUrl(url) : null
  const urlValid = !!parsedUrl?.reportCode
  const needReparse = parsed !== null && parsedKey !== url
  const nextLabel = step === 1 ? (parsed && !needReparse ? '下一步' : '解析') : '确认导入'

  const handleParse = async () => {
    if (!parsedUrl?.reportCode) return
    setError('')
    setIsParsing(true)
    try {
      const params = new URLSearchParams({ reportCode: parsedUrl.reportCode })
      if (!parsedUrl.isLastFight && parsedUrl.fightId !== null) {
        params.set('fightId', String(parsedUrl.fightId))
      }
      const response = await apiClient.get(`fflogs/import?${params}`, {
        timeout: 120000,
        throwHttpErrors: false,
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as unknown
        throw new Error(parseApiError(body, response.status))
      }
      const raw = await response.json()
      const fullTimeline = parseFromAny(raw, { id: generateId() })
      const extracted = extractImportableFromTimeline(fullTimeline)
      setParsed(extracted)
      setParsedKey(url)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败')
    } finally {
      setIsParsing(false)
    }
  }

  const handleNext = () => {
    if (step === 1) {
      if (needReparse || !parsed) void handleParse()
      else setStep(2)
    } else {
      // Task 13 接入 bulkImport
    }
  }

  const stepper = (
    <div className="px-6 py-3 border-b bg-muted/30 flex items-center gap-3 text-sm">
      <span className={step === 1 ? 'font-semibold' : 'text-muted-foreground'}>① 选择来源</span>
      <span className="text-muted-foreground">→</span>
      <span className={step === 2 ? 'font-semibold' : 'text-muted-foreground'}>② 配置导入</span>
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} disableBackdropClick={isParsing}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>导入到当前时间轴</ModalTitle>
        </ModalHeader>

        {stepper}

        <div className="px-6 py-6 min-h-[220px] space-y-4">
          {step === 1 && (
            <>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  FFLogs 链接
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://www.fflogs.com/reports/ABC123#fight=5"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={isParsing}
                />
                {url && !urlValid && (
                  <p className="text-xs text-destructive mt-1">无法识别 FFLogs 链接</p>
                )}
              </div>
              {isParsing && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  正在解析 FFLogs 报告...
                </div>
              )}
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {error}
                </div>
              )}
            </>
          )}

          {step === 2 && parsed && (
            <div className="text-sm text-muted-foreground">
              已解析：{parsed.sourceLabel} · {parsed.damageEvents.length} 伤害 /{' '}
              {parsed.castEvents.length} 技能
              <p className="text-xs mt-2">（Task 9-13 接入配置区与确认按钮）</p>
            </div>
          )}
        </div>

        <ModalFooter>
          {step === 2 && (
            <Button variant="outline" onClick={() => setStep(1)} disabled={isParsing}>
              ‹ 上一步
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={isParsing}>
            取消
          </Button>
          <Button onClick={handleNext} disabled={isParsing || (step === 1 && !urlValid)}>
            {nextLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
```

> 来源切换器 segmented 在 Task 9 加；这里 source 暂定为常量 `'fflogs'`。

- [ ] **Step 2: 跑 lint + tsc**

```bash
pnpm exec tsc --noEmit
pnpm lint
```

Expected: 无报错。

- [ ] **Step 3: 手动验证（叫用户跑）**

`pnpm dev`，在编辑器打开本地时间轴 → 点工具栏 Upload → 验证：

- 自动聚焦输入框，剪贴板里若有 FFLogs URL 自动填入
- 输入有效 URL → 「解析」按钮可点
- 点解析 → spinner 显示 → 解析完成进 Step 2，显示"已解析：..."
- 在 Step 2 点「‹ 上一步」回到 Step 1，URL 保留
- 改 URL 后按钮 label 切回"解析"

- [ ] **Step 4: commit**

```bash
git add src/components/ImportIntoTimelineDialog.tsx
git commit -m "feat(import): wire Step 1 FFLogs URL + parse trigger"
```

---

## Task 9: Step 1 引入模板源 + segmented + prefetch

**Files:**

- Modify: `src/components/ImportIntoTimelineDialog.tsx`

加入「副本模板」来源。dialog open 时 prefetch 当前 encounter 的模板：

- 当前无 encounter → segmented 不渲染，只剩 FFLogs 表单
- 模板返回 `events: []` → 同上
- 否则 segmented 二选一

切换 source 时清空 parsed。

- [ ] **Step 1: 引入 useTimelineStore + fetchEncounterTemplate**

`src/components/ImportIntoTimelineDialog.tsx` 顶部 import 追加：

```ts
import { useTimelineStore } from '@/store/timelineStore'
import { fetchEncounterTemplate } from '@/api/encounterTemplate'
import type { DamageEvent } from '@/types/timeline'
```

`SourceKind` 拓展：

```ts
type SourceKind = 'fflogs' | 'template'
```

组件函数体内、`source` state 改为可变：

```ts
const [source, setSource] = useState<SourceKind>('fflogs')
const timeline = useTimelineStore(s => s.timeline)
const currentEncounter = timeline?.encounter
const [templateEvents, setTemplateEvents] = useState<DamageEvent[] | null>(null)
const [templatePrefetching, setTemplatePrefetching] = useState(false)
```

在 open useEffect 之后追加 prefetch effect：

```ts
useEffect(() => {
  if (!open || !currentEncounter?.id) {
    setTemplateEvents(null)
    return
  }
  setTemplatePrefetching(true)
  let ignore = false
  void fetchEncounterTemplate(currentEncounter.id)
    .then(res => {
      if (!ignore) setTemplateEvents(res.events)
    })
    .catch(() => {
      if (!ignore) setTemplateEvents([])
    })
    .finally(() => {
      if (!ignore) setTemplatePrefetching(false)
    })
  return () => {
    ignore = true
  }
}, [open, currentEncounter?.id])
```

是否显示 segmented：

```ts
const templateAvailable = (templateEvents?.length ?? 0) > 0
const showSegmented = !!currentEncounter && templateAvailable
```

`handleParse` 增加 template 分支；改造成统一 `handleNext`：

```ts
const handleParse = async () => {
  setError('')
  if (source === 'fflogs') {
    if (!parsedUrl?.reportCode) return
    setIsParsing(true)
    try {
      const params = new URLSearchParams({ reportCode: parsedUrl.reportCode })
      if (!parsedUrl.isLastFight && parsedUrl.fightId !== null) {
        params.set('fightId', String(parsedUrl.fightId))
      }
      const response = await apiClient.get(`fflogs/import?${params}`, {
        timeout: 120000,
        throwHttpErrors: false,
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as unknown
        throw new Error(parseApiError(body, response.status))
      }
      const raw = await response.json()
      const fullTimeline = parseFromAny(raw, { id: generateId() })
      const extracted = extractImportableFromTimeline(fullTimeline)
      setParsed(extracted)
      setParsedKey(url)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败')
    } finally {
      setIsParsing(false)
    }
  } else {
    // template
    if (!templateEvents) return
    setParsed({
      damageEvents: templateEvents,
      castEvents: [],
      syncEvents: [],
      encounter: currentEncounter ?? null,
      sourceLabel: `模板「${currentEncounter?.name ?? ''}」`,
    })
    setParsedKey(`template:${currentEncounter?.id}`)
    setStep(2)
  }
}
```

`needReparse` 改造（template 切换也算 reparse 需求）：

```ts
const reparseKey = source === 'fflogs' ? url : `template:${currentEncounter?.id ?? ''}`
const needReparse = parsed !== null && parsedKey !== reparseKey
```

切换 source 时清 parsed：

```ts
const handleSourceChange = (s: SourceKind) => {
  if (s === source) return
  setSource(s)
  setParsed(null)
  setParsedKey('')
  setError('')
  setStep(1)
}
```

Step 1 JSX 重组：

```tsx
{
  step === 1 && (
    <>
      {showSegmented && (
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            来源
          </label>
          <div className="inline-flex border border-border rounded-md p-0.5 bg-muted/30">
            <button
              type="button"
              onClick={() => handleSourceChange('fflogs')}
              className={`px-3 py-1 rounded text-xs ${source === 'fflogs' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              FFLogs 战斗
            </button>
            <button
              type="button"
              onClick={() => handleSourceChange('template')}
              className={`px-3 py-1 rounded text-xs ${source === 'template' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              副本模板
            </button>
          </div>
        </div>
      )}

      {source === 'fflogs' && (
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            FFLogs 链接
          </label>
          <input
            ref={inputRef}
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://www.fflogs.com/reports/ABC123#fight=5"
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={isParsing}
          />
          {url && !urlValid && (
            <p className="text-xs text-destructive mt-1">无法识别 FFLogs 链接</p>
          )}
        </div>
      )}

      {source === 'template' && currentEncounter && (
        <div className="rounded-md bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">
          将从模板「{currentEncounter.name}」导入（按当前时间轴 encounter 自动选择）
        </div>
      )}

      {(isParsing || templatePrefetching) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          {isParsing ? '正在解析...' : '正在加载模板...'}
        </div>
      )}

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
      )}
    </>
  )
}
```

「下一步」disabled 条件改：

```ts
const canNext =
  step === 1 ? (source === 'fflogs' ? urlValid : (templateEvents?.length ?? 0) > 0) : true // Step 2 由 Task 13 接管
```

并把 Button disabled 改成 `isParsing || !canNext`。

- [ ] **Step 2: 跑 lint + tsc**

```bash
pnpm exec tsc --noEmit
pnpm lint
```

- [ ] **Step 3: 手动验证（叫用户跑）**

`pnpm dev`：

- 打开有 encounter 且后端有模板的时间轴 → segmented 出现，可切换
- 切换到「副本模板」→ 显示蓝色 info 条；「下一步」直接可点 → 进 Step 2
- 打开无 encounter 的时间轴（如自由创建的 wiki 副本，若有这种条件；否则手动 hack `timeline.encounter` 为 null）→ segmented **不渲染**
- 在 Step 2 切换 source → parsed 清空，自动回 Step 1

- [ ] **Step 4: commit**

```bash
git add src/components/ImportIntoTimelineDialog.tsx
git commit -m "feat(import): add template source with segmented + prefetch"
```

---

## Task 10: Step 2 数据类型 checkbox + 时间范围 UI（TimeInput）

**Files:**

- Modify: `src/components/ImportIntoTimelineDialog.tsx`

加入 Step 2 的数据类型多选 + 时间范围控件。预览计数在 Task 11 加，确认按钮逻辑在 Task 13 加。

- [ ] **Step 1: 引入 TimeInput + Checkbox + RadioGroup**

`src/components/ImportIntoTimelineDialog.tsx` 顶部 import 追加：

```ts
import TimeInput from '@/components/ui/time-input'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
```

> 检查 shadcn checkbox / radio-group 是否已安装：`pnpm shadcn add checkbox radio-group` 若缺。

组件函数体内追加 state：

```ts
const [includeDamage, setIncludeDamage] = useState(true)
const [includeCast, setIncludeCast] = useState(true)
const [rangeMode, setRangeMode] = useState<'range' | 'all'>('range')
const [rangeStart, setRangeStart] = useState(0)
const [rangeEnd, setRangeEnd] = useState(0)
const [rangeEndUnlimited, setRangeEndUnlimited] = useState(true)
```

进 Step 2 时计算默认 start（damage / cast 的最大 time / timestamp，不看 sync）：

```ts
useEffect(() => {
  if (step !== 2 || !timeline) return
  const dMax = timeline.damageEvents.reduce((m, e) => Math.max(m, e.time), 0)
  const cMax = timeline.castEvents.reduce((m, e) => Math.max(m, e.timestamp), 0)
  setRangeStart(Math.max(dMax, cMax))
  setRangeEnd(Math.max(dMax, cMax))
  setRangeEndUnlimited(true)
  setRangeMode('range')
  // 模板源没 castEvents，强制取消勾选
  if (source === 'template') {
    setIncludeCast(false)
  } else {
    setIncludeCast(true)
  }
  setIncludeDamage(true)
}, [step, timeline, source])
```

Step 2 JSX 替换原占位段：

```tsx
{
  step === 2 && parsed && (
    <div className="space-y-5">
      <div className="rounded-md bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">
        已解析：{parsed.sourceLabel} · {parsed.damageEvents.length} 伤害
        {source === 'fflogs' && ` / ${parsed.castEvents.length} 技能`}
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          数据类型
        </label>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includeDamage} onCheckedChange={v => setIncludeDamage(!!v)} />
            伤害事件{' '}
            <span className="text-muted-foreground">（{parsed.damageEvents.length} 条）</span>
          </label>
          {source === 'fflogs' && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={includeCast} onCheckedChange={v => setIncludeCast(!!v)} />
              技能使用{' '}
              <span className="text-muted-foreground">（{parsed.castEvents.length} 条）</span>
            </label>
          )}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          时间范围
        </label>
        <RadioGroup
          value={rangeMode}
          onValueChange={v => setRangeMode(v as 'range' | 'all')}
          className="flex gap-4 mb-2"
        >
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="range" /> 时间区间
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="all" /> 全部
          </label>
        </RadioGroup>

        {rangeMode === 'range' ? (
          <div className="flex items-center gap-2">
            <TimeInput value={rangeStart} onChange={setRangeStart} size="sm" />
            <span className="text-muted-foreground">~</span>
            {rangeEndUnlimited ? (
              <div className="px-3 py-1 border border-border rounded text-muted-foreground text-sm font-mono min-w-[88px] text-center">
                ∞
              </div>
            ) : (
              <TimeInput value={rangeEnd} onChange={setRangeEnd} size="sm" />
            )}
            <label className="flex items-center gap-2 text-sm ml-2">
              <Checkbox
                checked={rangeEndUnlimited}
                onCheckedChange={v => setRangeEndUnlimited(!!v)}
              />
              至时间轴结尾
            </label>
          </div>
        ) : (
          <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            ⚠ 全部模式可能与时间轴已有事件重复。建议改用「时间区间」并选择空白时间段。
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 跑 lint + tsc**

```bash
pnpm exec tsc --noEmit
pnpm lint
```

Expected: 无报错。若 Checkbox / RadioGroup 未安装，会有 module-not-found —— 此时跑 `pnpm dlx shadcn@latest add checkbox radio-group`。

- [ ] **Step 3: 手动验证**

`pnpm dev`，导入 FFLogs 报告 → 进 Step 2：

- 数据类型两个 checkbox 默认勾选
- 时间范围默认"时间区间"，起始 = 当前时间轴最后事件时间，"至时间轴结尾"勾选 → 第二个 TimeInput 显示 ∞
- 取消勾选"至时间轴结尾" → 第二个 TimeInput 可编辑
- 切换到"全部" → TimeInput 消失，红色警告横条出现
- 模板源进 Step 2 → 技能使用 row 不渲染

- [ ] **Step 4: commit**

```bash
git add src/components/ImportIntoTimelineDialog.tsx
git commit -m "feat(import): wire Step 2 type checkboxes + range controls"
```

---

## Task 11: encounter 不一致警告 + 实时预览计数

**Files:**

- Modify: `src/components/ImportIntoTimelineDialog.tsx`

加入两件事：

1. **encounter 不一致黄色警告**：仅在双方都有 encounter 且 ID 不同时显示
2. **实时预览计数**：用 useMemo 跑 filter + validate + dedup，显示"本次将导入：N 伤害 / M 技能（跳过 K）"

cast 校验需要 `mitigationActions` 和 `statusTimelineByPlayer`。前者从 `useMitigationStore` 取，后者从 `DamageCalculationContext` 取。

- [ ] **Step 1: 给 `extractImportableFromTimeline` 加 `composition` 字段（先写失败测试）**

打开 `src/utils/importAdapter.test.ts`，在 `extractImportableFromTimeline` describe 末尾追加：

```ts
it('暴露 incoming composition', () => {
  const t = baseTimeline({
    composition: { players: [{ id: 5, job: 'WHM' }] },
  })
  expect(extractImportableFromTimeline(t).composition.players).toHaveLength(1)
})
```

Run: `pnpm test:run src/utils/importAdapter.test.ts`
Expected: FAIL（`composition` undefined）。

- [ ] **Step 2: 让测试通过**

`src/utils/importAdapter.ts` 中 `ImportableSubset` 接口加字段：

```ts
export interface ImportableSubset {
  damageEvents: DamageEvent[]
  castEvents: CastEvent[]
  syncEvents: SyncEvent[]
  encounter: Timeline['encounter'] | null
  /** 报告内的 incoming composition；用于按职业映射 playerId */
  composition: Composition
  sourceLabel: string
}
```

`extractImportableFromTimeline` 的 return 加一行：

```ts
return {
  damageEvents: t.damageEvents ?? [],
  castEvents: t.castEvents ?? [],
  syncEvents: t.syncEvents ?? [],
  encounter: t.encounter ?? null,
  composition: t.composition ?? { players: [] },
  sourceLabel: parts.join(' / ') || '未知来源',
}
```

Run: `pnpm test:run src/utils/importAdapter.test.ts`
Expected: PASS。

- [ ] **Step 3: dialog 引入依赖 + 用 useMemo 算预览**

`src/components/ImportIntoTimelineDialog.tsx` 顶部 import 追加：

```ts
import { useContext, useMemo } from 'react'
import { useMitigationStore } from '@/store/mitigationStore'
import { DamageCalculationContext } from '@/contexts/DamageCalculationContext'
import { createPlacementEngine } from '@/utils/placement/engine'
import {
  buildPlayerIdMap,
  dedupeSyncEvents,
  filterByRange,
  validateCastsForImport,
  type ImportRange,
} from '@/utils/importAdapter'
```

组件函数体内追加：

```ts
const mitigationActions = useMitigationStore(s => s.actions)
const calc = useContext(DamageCalculationContext)

const range = useMemo<ImportRange>(
  () =>
    rangeMode === 'all'
      ? { mode: 'all' }
      : { mode: 'range', start: rangeStart, end: rangeEndUnlimited ? null : rangeEnd },
  [rangeMode, rangeStart, rangeEnd, rangeEndUnlimited]
)

const encounterMismatch =
  parsed?.encounter && timeline?.encounter && parsed.encounter.id !== timeline.encounter.id

const preview = useMemo(() => {
  if (!parsed || !timeline) return null
  const damages = includeDamage ? filterByRange(parsed.damageEvents, range, e => e.time) : []
  const filteredCasts = includeCast ? filterByRange(parsed.castEvents, range, e => e.timestamp) : []
  // 即便 includeCast=false，sync 仍按范围过滤（用户可见不显示，但提交时也带）
  const filteredSyncs = filterByRange(parsed.syncEvents, range, e => e.time)

  const playerIdMap = buildPlayerIdMap(parsed.composition, timeline.composition)

  const castResult = validateCastsForImport({
    incoming: filteredCasts,
    playerIdMap,
    baseTimeline: timeline,
    mitigationActions,
    statusTimelineByPlayer: calc?.statusTimelineByPlayer ?? new Map(),
    createEngine: createPlacementEngine,
  })

  const syncResult = dedupeSyncEvents(filteredSyncs, timeline.syncEvents ?? [])

  return {
    damageCount: damages.length,
    damages,
    castKept: castResult.kept.length,
    castSkipped: castResult.skipped,
    casts: castResult.kept,
    syncs: syncResult.kept,
  }
}, [parsed, timeline, range, includeDamage, includeCast, mitigationActions, calc])
```

- [ ] **Step 4: 在 Step 2 JSX 末尾加预览计数 + 警告**

```tsx
{
  encounterMismatch && (
    <div className="rounded-md border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-800 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-300">
      ⚠ 该报告的副本「{parsed?.encounter?.name}」与当前时间轴「{timeline?.encounter?.name}」不一致
    </div>
  )
}

{
  preview && (
    <div className="rounded-md bg-muted/40 px-3 py-2 font-mono text-xs leading-6">
      <div className="text-muted-foreground">本次将导入：</div>
      {includeDamage && (
        <div>
          　伤害事件　
          <span className="text-green-600 dark:text-green-400">{preview.damageCount} 条</span>
        </div>
      )}
      {source === 'fflogs' && includeCast && (
        <div>
          　技能使用　
          <span className="text-green-600 dark:text-green-400">{preview.castKept} 条</span>
          {preview.castSkipped > 0 && (
            <span className="text-yellow-600 dark:text-yellow-400">
              {' '}
              （跳过 {preview.castSkipped} 条因 CD/状态冲突或玩家不在阵容）
            </span>
          )}
        </div>
      )}
    </div>
  )
}
```

把 encounter 警告插到「已解析」info 条**下方**、数据类型 checkbox 之上。把预览 panel 放在时间范围区**之下**。

- [ ] **Step 5: tsc + lint + 跑全 test**

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test:run
```

- [ ] **Step 6: 手动验证**

`pnpm dev`：

- 导入与当前副本一致的 FFLogs → 无 encounter 警告，预览计数显示
- 导入不同 encounter 的 FFLogs → 黄色警告横条出现
- 调整时间区间 → 计数实时变化
- 切到「全部」→ 计数显示全量

- [ ] **Step 7: commit**

```bash
git add src/components/ImportIntoTimelineDialog.tsx src/utils/importAdapter.ts src/utils/importAdapter.test.ts
git commit -m "feat(import): add encounter mismatch warning + live preview counts"
```

---

## Task 12: 确认导入 → bulkImport + toast + 收尾

**Files:**

- Modify: `src/components/ImportIntoTimelineDialog.tsx`

接入「确认导入」：调用 `bulkImport`，弹 toast 汇总，关闭 dialog。处理 disable 条件（区间 start >= end / 数据类型全未勾）。

- [ ] **Step 1: 加上 confirm 逻辑**

`src/components/ImportIntoTimelineDialog.tsx` 顶部 import 追加：

```ts
import { toast } from 'sonner'
import { track } from '@/utils/analytics'
```

组件函数体内：

```ts
const bulkImport = useTimelineStore(s => s.bulkImport)

const rangeInvalid = rangeMode === 'range' && !rangeEndUnlimited && rangeStart >= rangeEnd
const typesAllUnchecked = !includeDamage && (source !== 'fflogs' || !includeCast)
const canConfirm = step === 2 && preview !== null && !rangeInvalid && !typesAllUnchecked

const handleConfirm = () => {
  if (!preview) return
  bulkImport({
    damageEvents: includeDamage ? preview.damages : [],
    castEvents: source === 'fflogs' && includeCast ? preview.casts : [],
    syncEvents: preview.syncs, // sync 始终静默导入
  })
  track('editor-import', {
    source,
    damageCount: includeDamage ? preview.damageCount : 0,
    castCount: source === 'fflogs' && includeCast ? preview.castKept : 0,
    castSkipped: source === 'fflogs' && includeCast ? preview.castSkipped : 0,
    syncCount: preview.syncs.length,
    rangeMode,
  })
  const segs: string[] = []
  if (includeDamage) segs.push(`${preview.damageCount} 伤害`)
  if (source === 'fflogs' && includeCast) {
    segs.push(
      `${preview.castKept} 技能${preview.castSkipped > 0 ? `（跳过 ${preview.castSkipped}）` : ''}`
    )
  }
  toast.success(`导入完成：${segs.join(' / ')}`)
  onClose()
}
```

把 `handleNext` 改造：

```ts
const handleNext = () => {
  if (step === 1) {
    if (needReparse || !parsed) void handleParse()
    else setStep(2)
  } else {
    handleConfirm()
  }
}
```

Button disabled 改成：

```ts
disabled={isParsing || (step === 1 ? !canNext : !canConfirm)}
```

`canNext` 已在 Task 9 定义，保持。

- [ ] **Step 2: range 输入红边提示**

TimeInput 没有 error 状态 prop，但可以包外层 div：

```tsx
{rangeMode === 'range' ? (
  <div
    className={`flex items-center gap-2 ${rangeInvalid ? 'ring-1 ring-destructive rounded-md p-1' : ''}`}
  >
    {/* ...原 TimeInput 块 */}
  </div>
) : (
  ...
)}
```

加一行 hint：

```tsx
{
  rangeInvalid && <p className="text-xs text-destructive mt-1">起始时间必须小于结束时间</p>
}
```

- [ ] **Step 3: tsc + lint + 全测试**

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test:run
```

- [ ] **Step 4: 手动验证（端到端）**

`pnpm dev`，端到端走一遍：

1. 打开本地时间轴 → 工具栏 Upload → 输入 FFLogs URL → 解析
2. Step 2 默认勾选两个类型 + 区间 = `[lastEventTime, +∞]`
3. 看到预览计数
4. 点「确认导入」→ toast 显示汇总 → dialog 关闭
5. 时间轴上看到追加的伤害事件 + 技能使用
6. 按 Ctrl+Z 一次 → 全部导入被回滚
7. 重复一次走「副本模板」源
8. 把区间起点改成 > 终点 → 「确认导入」disabled + 红边

- [ ] **Step 5: commit**

```bash
git add src/components/ImportIntoTimelineDialog.tsx
git commit -m "feat(import): confirm → bulkImport + toast + close"
```

---

## 自审

**Spec coverage** 检查：

| Spec 章节                                                     | 覆盖任务      |
| ------------------------------------------------------------- | ------------- |
| 入口与可见性（toolbar、viewer/replay 隐藏、editLock disable） | Task 7        |
| Step 1 segmented / FFLogs URL / 模板自动选                    | Task 8、9     |
| Step 1 解析 spinner / 错误条                                  | Task 8        |
| Step 2 已解析 info / 数据类型 checkbox / 时间范围             | Task 10       |
| Step 2 encounter 不一致警告 / 全部模式警告                    | Task 11、10   |
| Step 2 预览计数                                               | Task 11       |
| 范围模式 `start >= end` disable                               | Task 12       |
| 类型全未勾 disable                                            | Task 12       |
| 确认 → bulkImport → toast → 关闭                              | Task 12       |
| 「上一步」保留 URL / parsed                                   | Task 8        |
| 改 URL → button label 切回"解析"                              | Task 8        |
| 切换 segmented 来源清 parsed                                  | Task 9        |
| FFLogs encounter 与当前一致性比较前提（双方都有）             | Task 11       |
| 无 encounter / 无模板 → segmented 隐藏                        | Task 9        |
| 复用 `/api/fflogs/import`                                     | Task 8        |
| `bulkImport` 单事务 + 一步 undo                               | Task 6        |
| ID 重生成                                                     | Task 6        |
| sync 静默 by actionId 去重                                    | Task 5、11    |
| cast 按职业映射 + placement 校验                              | Task 3、4、11 |
| TimeInput 用 `src/components/ui/time-input.tsx`               | Task 10       |

**Placeholder scan**：无 TBD / TODO；所有"Add error handling"都已展开为具体代码；所有引用的函数 / 类型在前序任务里定义；commit message 不含 "Claude" 字样。

**Type consistency** 检查：

- `validateCastsForImport` 入参 `createEngine: typeof createPlacementEngine` 与 Task 11 实际调用一致
- `ImportableSubset.composition` 在 Task 11 Step 1-2 用 TDD 节奏（先测后实现）引入
- `bulkImport` 入参 shape (`{ damageEvents?, castEvents?, syncEvents? }`) 在 Task 6 store 接口 / Task 12 dialog 调用处一致
- `ImportRange` discriminated union 在 Task 2 定义 / Task 10 状态推导 / Task 11 useMemo 入参全程一致

---

## Plan complete

Plan complete and saved to `design/superpowers/plans/2026-05-29-editor-import.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每个任务派一个新 subagent 执行，两阶段 review，迭代快

**2. Inline Execution** — 在本会话内顺序执行，批量检查点 review

Which approach?
