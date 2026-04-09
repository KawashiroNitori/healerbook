# 表格视图实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为编辑器页 `/timeline/:id` 增加表格视图模式，以伤害事件为行纵向展示减伤分配，便于阅览与分享。

**Architecture:** 纯 DOM `<table>` + CSS `position: sticky` 实现粘性表头和粘性前几列。视图模式由 URL query 参数 `?view=table` 驱动，通过 `useSearchParams()` 读取。表格组件不触碰现有只读机制；"只读"由组件自身不暴露编辑交互保证。castEvent 窗口判定是纯函数，与时间轴视图共享 `skillTracks` 派生逻辑。

**Tech Stack:** React 19, TypeScript, Tailwind CSS v3, shadcn/ui (DropdownMenuRadioGroup), zustand, react-router-dom (`useSearchParams`), vitest

**Spec:** `.claude/superpowers/specs/2026-04-09-table-view-design.md`

---

## 文件结构

**新增：**

- `src/utils/skillTracks.ts` — 纯函数 `deriveSkillTracks(composition, hiddenPlayerIds, actions)` + `SkillTrack` 类型定义（迁出自 `SkillTrackLabels.tsx`）
- `src/utils/skillTracks.test.ts` — 纯函数测试
- `src/utils/castWindow.ts` — 纯函数 `computeLitCellsByEvent(damageEvents, castEvents, actionsById)`，返回 `Map<eventId, Set<'playerId:actionId'>>`
- `src/utils/castWindow.test.ts` — 纯函数测试（边界条件）
- `src/utils/tableRows.ts` — 纯函数 `mergeAndSortRows(damageEvents, annotations)` + `TableRow` 联合类型
- `src/utils/tableRows.test.ts` — 纯函数测试
- `src/hooks/useSkillTracks.ts` — 响应式 hook，封装 zustand 订阅 + `deriveSkillTracks`
- `src/components/TimelineTable/constants.ts` — 布局常量
- `src/components/TimelineTable/TableHeader.tsx` — 表头（列名行）
- `src/components/TimelineTable/TableDataRow.tsx` — 伤害事件行
- `src/components/TimelineTable/AnnotationRow.tsx` — 注释行
- `src/components/TimelineTable/index.tsx` — 主组件 `TimelineTableView`

**修改：**

- `src/components/Timeline/SkillTrackLabels.tsx` — 从 `./SkillTrackLabels` 导出的 `SkillTrack` 改为 `re-export` 自 `@/utils/skillTracks`
- `src/components/Timeline/index.tsx:235-253` — 替换 `skillTracks` 派生为调用 `deriveSkillTracks()`；import 路径改为 `@/utils/skillTracks`
- `src/components/Timeline/SkillTracksCanvas.tsx` — `SkillTrack` import 改为 `@/utils/skillTracks`
- `src/pages/EditorPage.tsx` — 读取 `useSearchParams()`，按 `viewMode` 切换渲染 `<TimelineCanvas>` / `<TimelineTableView>`；向 `EditorToolbar` 传 `viewMode`、`onViewModeChange`
- `src/components/EditorToolbar.tsx` — 视图菜单顶部加 `DropdownMenuRadioGroup`；接收 `viewMode`、`onViewModeChange` props；表格视图下 zoom 滑块 `disabled`

---

## Task 1：抽取 skillTracks 派生为纯函数

**Files:**

- Create: `src/utils/skillTracks.ts`
- Create: `src/utils/skillTracks.test.ts`

- [ ] **Step 1.1: 写测试文件**

```typescript
// src/utils/skillTracks.test.ts
import { describe, it, expect } from 'vitest'
import { deriveSkillTracks } from './skillTracks'
import type { Composition } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

const makeAction = (id: number, jobs: MitigationAction['jobs'], hidden = false): MitigationAction =>
  ({
    id,
    name: `action-${id}`,
    icon: `/icon-${id}.png`,
    jobs,
    duration: 10,
    cooldown: 60,
    hidden,
    executor: () => ({ players: [], statuses: [], timestamp: 0 }),
  }) as unknown as MitigationAction

describe('deriveSkillTracks', () => {
  const composition: Composition = {
    players: [
      { id: 1, job: 'WHM' },
      { id: 2, job: 'PLD' },
    ],
  }

  it('按职业顺序排序并展开每个玩家的可用技能', () => {
    const actions = [makeAction(100, ['WHM']), makeAction(200, ['PLD'])]
    const result = deriveSkillTracks(composition, new Set(), actions)
    // PLD (坦克) 应排在 WHM (治疗) 之前
    expect(result.map(t => t.playerId)).toEqual([2, 1])
    expect(result.map(t => t.actionId)).toEqual([200, 100])
  })

  it('过滤掉 hiddenPlayerIds 中的玩家', () => {
    const actions = [makeAction(100, ['WHM']), makeAction(200, ['PLD'])]
    const result = deriveSkillTracks(composition, new Set([2]), actions)
    expect(result.map(t => t.playerId)).toEqual([1])
  })

  it('过滤掉 hidden 技能', () => {
    const actions = [makeAction(100, ['WHM']), makeAction(101, ['WHM'], true)]
    const result = deriveSkillTracks(composition, new Set(), actions)
    expect(result.map(t => t.actionId)).toEqual([100])
  })

  it('空 composition 返回空数组', () => {
    const result = deriveSkillTracks({ players: [] }, new Set(), [])
    expect(result).toEqual([])
  })

  it('一个玩家有多个可用技能则全部展开，顺序与 actions 数组一致', () => {
    const actions = [makeAction(100, ['WHM']), makeAction(101, ['WHM']), makeAction(102, ['WHM'])]
    const result = deriveSkillTracks({ players: [{ id: 1, job: 'WHM' }] }, new Set(), actions)
    expect(result.map(t => t.actionId)).toEqual([100, 101, 102])
  })
})
```

- [ ] **Step 1.2: 运行测试确认失败**

Run: `pnpm test:run src/utils/skillTracks.test.ts`
Expected: FAIL with "Cannot find module './skillTracks'"

- [ ] **Step 1.3: 创建 skillTracks.ts**

```typescript
// src/utils/skillTracks.ts
/**
 * 技能轨道派生逻辑（时间轴视图和表格视图共享）
 */

import { sortJobsByOrder } from '@/data/jobs'
import type { Composition, Job } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

export interface SkillTrack {
  job: Job
  playerId: number
  actionId: number
  actionName: string
  actionIcon: string
}

/**
 * 根据阵容、隐藏玩家集合和技能列表派生技能轨道
 *
 * 规则：
 * - 玩家按职业序排序（坦克 → 治疗 → DPS）
 * - 跳过 hiddenPlayerIds 中的玩家
 * - 每个玩家展开其职业可用的非 hidden 技能
 */
export function deriveSkillTracks(
  composition: Composition,
  hiddenPlayerIds: Set<number>,
  actions: MitigationAction[]
): SkillTrack[] {
  const sortedPlayers = sortJobsByOrder(composition.players, p => p.job)
  const tracks: SkillTrack[] = []
  for (const player of sortedPlayers) {
    if (hiddenPlayerIds.has(player.id)) continue
    const jobActions = actions.filter(a => a.jobs.includes(player.job) && !a.hidden)
    for (const action of jobActions) {
      tracks.push({
        job: player.job,
        playerId: player.id,
        actionId: action.id,
        actionName: action.name,
        actionIcon: action.icon,
      })
    }
  }
  return tracks
}
```

- [ ] **Step 1.4: 运行测试确认通过**

Run: `pnpm test:run src/utils/skillTracks.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 1.5: 提交**

```bash
git add src/utils/skillTracks.ts src/utils/skillTracks.test.ts
git commit -m "refactor: 抽取 skillTracks 派生为纯函数"
```

---

## Task 2：Timeline 组件切换使用 deriveSkillTracks

**Files:**

- Modify: `src/components/Timeline/SkillTrackLabels.tsx`（移除 `SkillTrack` 接口定义，改为 re-export）
- Modify: `src/components/Timeline/index.tsx:235-253`
- Modify: `src/components/Timeline/SkillTracksCanvas.tsx`（import 路径）

- [ ] **Step 2.1: 修改 SkillTrackLabels.tsx 的类型导出**

把 `src/components/Timeline/SkillTrackLabels.tsx` 第 10-16 行的 `SkillTrack` 接口定义改为 re-export：

```typescript
// 原来：
export interface SkillTrack {
  job: Job
  playerId: number
  actionId: number
  actionName: string
  actionIcon: string
}

// 改为：
export type { SkillTrack } from '@/utils/skillTracks'
```

同时移除顶部不再使用的 `import type { Job } from '@/types/timeline'`（如果 `Job` 在文件内其他位置未被使用）。

- [ ] **Step 2.2: 修改 Timeline/index.tsx 的 skillTracks 派生**

用编辑工具把 `src/components/Timeline/index.tsx` 第 238-253 行的 inline 派生替换为：

```typescript
const skillTracks = deriveSkillTracks(composition, hiddenPlayerIds, actions)
```

在文件顶部 import 区加：

```typescript
import { deriveSkillTracks } from '@/utils/skillTracks'
```

注意：`sortedPlayers` 变量声明（第 236 行）如果后续代码没有再用到，可以一起删除。检查 237-253 之外的代码有无 `sortedPlayers` 引用，若无则删除其声明。

- [ ] **Step 2.3: 修改 SkillTracksCanvas.tsx 的 SkillTrack import**

查找 `src/components/Timeline/SkillTracksCanvas.tsx` 顶部 `import type { SkillTrack } from './SkillTrackLabels'` 一行，改为：

```typescript
import type { SkillTrack } from '@/utils/skillTracks'
```

（如果原来不是这个路径，则跳过——确保 SkillTrack 的 import 来源最终指向 `@/utils/skillTracks` 或间接通过 re-export 到达。）

- [ ] **Step 2.4: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无错误

- [ ] **Step 2.5: 运行相关单元测试**

Run: `pnpm test:run`
Expected: 所有现有测试通过，新增 skillTracks 测试也通过

- [ ] **Step 2.6: 提交**

```bash
git add src/components/Timeline/SkillTrackLabels.tsx src/components/Timeline/index.tsx src/components/Timeline/SkillTracksCanvas.tsx
git commit -m "refactor: Timeline 使用 deriveSkillTracks 纯函数"
```

---

## Task 3：cast 窗口命中判定的纯函数

**Files:**

- Create: `src/utils/castWindow.ts`
- Create: `src/utils/castWindow.test.ts`

- [ ] **Step 3.1: 写测试**

```typescript
// src/utils/castWindow.test.ts
import { describe, it, expect } from 'vitest'
import { computeLitCellsByEvent, cellKey } from './castWindow'
import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

const damage = (id: string, time: number): DamageEvent =>
  ({
    id,
    name: `dmg-${id}`,
    time,
    damage: 100000,
    type: 'aoe',
    damageType: 'magical',
  }) as DamageEvent

const cast = (id: string, playerId: number, actionId: number, timestamp: number): CastEvent =>
  ({
    id,
    actionId,
    timestamp,
    playerId,
    job: 'WHM',
  }) as CastEvent

const action = (id: number, duration: number): MitigationAction =>
  ({
    id,
    name: `a-${id}`,
    icon: '',
    jobs: [],
    duration,
    cooldown: 60,
    executor: () => ({ players: [], statuses: [], timestamp: 0 }),
  }) as unknown as MitigationAction

describe('computeLitCellsByEvent', () => {
  it('castTime <= damageTime < castTime + duration 时亮起', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const events = [damage('d1', 5)]
    const casts = [cast('c1', 1, 100, 0)] // 窗口 [0, 10)
    const result = computeLitCellsByEvent(events, casts, actionsById)
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
  })

  it('castTime === damageTime 时亮起（左闭）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const result = computeLitCellsByEvent([damage('d1', 0)], [cast('c1', 1, 100, 0)], actionsById)
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
  })

  it('damageTime === castTime + duration 时不亮起（右开）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const result = computeLitCellsByEvent([damage('d1', 10)], [cast('c1', 1, 100, 0)], actionsById)
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false)
  })

  it('damageTime 在 cast 窗口之前不亮起', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const result = computeLitCellsByEvent([damage('d1', 0)], [cast('c1', 1, 100, 5)], actionsById)
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false)
  })

  it('一个玩家的多次 cast 只要有一个窗口命中就亮起', () => {
    const actionsById = new Map([[100, action(100, 5)]])
    const casts = [
      cast('c1', 1, 100, 0), // 窗口 [0, 5)
      cast('c2', 1, 100, 20), // 窗口 [20, 25)
    ]
    const result = computeLitCellsByEvent(
      [damage('d1', 2), damage('d2', 10), damage('d3', 22)],
      casts,
      actionsById
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
    expect(result.get('d2')?.has(cellKey(1, 100))).toBe(false)
    expect(result.get('d3')?.has(cellKey(1, 100))).toBe(true)
  })

  it('不同 playerId / actionId 的 cast 独立计算', () => {
    const actionsById = new Map([
      [100, action(100, 10)],
      [200, action(200, 10)],
    ])
    const casts = [cast('c1', 1, 100, 0), cast('c2', 2, 200, 0)]
    const result = computeLitCellsByEvent([damage('d1', 5)], casts, actionsById)
    const lit = result.get('d1')!
    expect(lit.has(cellKey(1, 100))).toBe(true)
    expect(lit.has(cellKey(2, 200))).toBe(true)
    expect(lit.has(cellKey(1, 200))).toBe(false)
    expect(lit.has(cellKey(2, 100))).toBe(false)
  })

  it('actionsById 中不存在的 actionId 被跳过', () => {
    const actionsById = new Map<number, MitigationAction>()
    const result = computeLitCellsByEvent([damage('d1', 5)], [cast('c1', 1, 999, 0)], actionsById)
    expect(result.get('d1')?.size).toBe(0)
  })

  it('每个伤害事件都有一个 Set（可能为空）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const result = computeLitCellsByEvent([damage('d1', 100), damage('d2', 200)], [], actionsById)
    expect(result.get('d1')).toEqual(new Set())
    expect(result.get('d2')).toEqual(new Set())
  })
})

describe('cellKey', () => {
  it('格式为 playerId:actionId', () => {
    expect(cellKey(1, 100)).toBe('1:100')
  })
})
```

- [ ] **Step 3.2: 运行测试确认失败**

Run: `pnpm test:run src/utils/castWindow.test.ts`
Expected: FAIL with "Cannot find module './castWindow'"

- [ ] **Step 3.3: 实现 castWindow.ts**

```typescript
// src/utils/castWindow.ts
/**
 * 表格视图单元格命中判定：判断某个伤害事件时刻是否处于某个 cast 窗口内
 */

import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

/**
 * 生成单元格 key，用于 `Set<string>` 存储
 */
export function cellKey(playerId: number, actionId: number): string {
  return `${playerId}:${actionId}`
}

/**
 * 计算每个伤害事件在其时间点上亮起的 (playerId, actionId) 组合。
 *
 * 规则：存在 castEvent 满足
 *   cast.playerId === player
 *   cast.actionId === action
 *   cast.timestamp ≤ damageEvent.time < cast.timestamp + action.duration
 *
 * @returns Map<damageEventId, Set<cellKey>>
 */
export function computeLitCellsByEvent(
  damageEvents: DamageEvent[],
  castEvents: CastEvent[],
  actionsById: Map<number, MitigationAction>
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  for (const event of damageEvents) {
    const lit = new Set<string>()
    for (const castEvent of castEvents) {
      const action = actionsById.get(castEvent.actionId)
      if (!action) continue
      if (castEvent.timestamp <= event.time && event.time < castEvent.timestamp + action.duration) {
        lit.add(cellKey(castEvent.playerId, castEvent.actionId))
      }
    }
    result.set(event.id, lit)
  }
  return result
}
```

- [ ] **Step 3.4: 运行测试确认通过**

Run: `pnpm test:run src/utils/castWindow.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 3.5: 提交**

```bash
git add src/utils/castWindow.ts src/utils/castWindow.test.ts
git commit -m "feat: 新增 cast 窗口命中判定纯函数"
```

---

## Task 4：表格行合并与排序纯函数

**Files:**

- Create: `src/utils/tableRows.ts`
- Create: `src/utils/tableRows.test.ts`

- [ ] **Step 4.1: 写测试**

```typescript
// src/utils/tableRows.test.ts
import { describe, it, expect } from 'vitest'
import { mergeAndSortRows } from './tableRows'
import type { DamageEvent, Annotation } from '@/types/timeline'

const dmg = (id: string, time: number): DamageEvent =>
  ({ id, name: `d-${id}`, time, damage: 0, type: 'aoe', damageType: 'magical' }) as DamageEvent

const ann = (id: string, time: number, text = 'note'): Annotation => ({
  id,
  text,
  time,
  anchor: { type: 'damageTrack' },
})

describe('mergeAndSortRows', () => {
  it('只有伤害事件时按 time 升序', () => {
    const rows = mergeAndSortRows([dmg('a', 10), dmg('b', 5), dmg('c', 20)], [])
    expect(rows.map(r => r.kind + ':' + r.id)).toEqual(['damage:b', 'damage:a', 'damage:c'])
  })

  it('只有注释时按 time 升序', () => {
    const rows = mergeAndSortRows([], [ann('x', 10), ann('y', 5)])
    expect(rows.map(r => r.kind + ':' + r.id)).toEqual(['annotation:y', 'annotation:x'])
  })

  it('同时有两类时按 time 归并排序', () => {
    const rows = mergeAndSortRows([dmg('a', 10), dmg('b', 30)], [ann('x', 5), ann('y', 20)])
    expect(rows.map(r => r.kind + ':' + r.id)).toEqual([
      'annotation:x',
      'damage:a',
      'annotation:y',
      'damage:b',
    ])
  })

  it('相同 time 时注释行排在伤害事件之前', () => {
    const rows = mergeAndSortRows([dmg('a', 10)], [ann('x', 10)])
    expect(rows.map(r => r.kind)).toEqual(['annotation', 'damage'])
  })

  it('多个相同 time 时所有注释在前、伤害事件在后，组内保持输入顺序', () => {
    const rows = mergeAndSortRows([dmg('a', 10), dmg('b', 10)], [ann('x', 10), ann('y', 10)])
    expect(rows.map(r => r.id)).toEqual(['x', 'y', 'a', 'b'])
  })

  it('空输入返回空数组', () => {
    expect(mergeAndSortRows([], [])).toEqual([])
  })
})
```

- [ ] **Step 4.2: 运行测试确认失败**

Run: `pnpm test:run src/utils/tableRows.test.ts`
Expected: FAIL with "Cannot find module './tableRows'"

- [ ] **Step 4.3: 实现 tableRows.ts**

```typescript
// src/utils/tableRows.ts
/**
 * 表格视图的行数据类型与排序
 */

import type { DamageEvent, Annotation } from '@/types/timeline'

export type TableRow =
  | { kind: 'damage'; id: string; time: number; event: DamageEvent }
  | { kind: 'annotation'; id: string; time: number; annotation: Annotation }

/**
 * 合并伤害事件和注释为统一行列表，按 time 升序。
 * 相同 time 时注释行排在伤害事件之前。组内保持输入顺序（稳定排序）。
 */
export function mergeAndSortRows(
  damageEvents: DamageEvent[],
  annotations: Annotation[]
): TableRow[] {
  const rows: TableRow[] = []
  for (const annotation of annotations) {
    rows.push({ kind: 'annotation', id: annotation.id, time: annotation.time, annotation })
  }
  for (const event of damageEvents) {
    rows.push({ kind: 'damage', id: event.id, time: event.time, event })
  }
  // 稳定排序：先按 time，time 相同时 annotation (0) < damage (1)
  rows.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time
    const order = (r: TableRow) => (r.kind === 'annotation' ? 0 : 1)
    return order(a) - order(b)
  })
  return rows
}
```

- [ ] **Step 4.4: 运行测试确认通过**

Run: `pnpm test:run src/utils/tableRows.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 4.5: 提交**

```bash
git add src/utils/tableRows.ts src/utils/tableRows.test.ts
git commit -m "feat: 新增表格视图行合并排序函数"
```

---

## Task 5：useSkillTracks hook

**Files:**

- Create: `src/hooks/useSkillTracks.ts`

- [ ] **Step 5.1: 实现 hook**

```typescript
// src/hooks/useSkillTracks.ts
/**
 * 技能轨道派生的响应式 hook，供时间轴视图和表格视图共用。
 */

import { useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { deriveSkillTracks, type SkillTrack } from '@/utils/skillTracks'

export function useSkillTracks(): SkillTrack[] {
  const composition = useTimelineStore(s => s.timeline?.composition)
  const hiddenPlayerIds = useUIStore(s => s.hiddenPlayerIds)
  const actions = useMitigationStore(s => s.actions)

  return useMemo(() => {
    if (!composition) return []
    return deriveSkillTracks(composition, hiddenPlayerIds, actions)
  }, [composition, hiddenPlayerIds, actions])
}
```

- [ ] **Step 5.2: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无错误

- [ ] **Step 5.3: 提交**

```bash
git add src/hooks/useSkillTracks.ts
git commit -m "feat: 新增 useSkillTracks hook"
```

---

## Task 6：TimelineTable 布局常量

**Files:**

- Create: `src/components/TimelineTable/constants.ts`

- [ ] **Step 6.1: 创建常量文件**

```typescript
// src/components/TimelineTable/constants.ts
/**
 * 表格视图布局常量
 */

/** 时间列宽度（px） */
export const TIME_COL_WIDTH = 72

/** 事件名列宽度（px） */
export const NAME_COL_WIDTH = 160

/** 原始伤害列宽度（px） */
export const ORIGINAL_DAMAGE_COL_WIDTH = 80

/** 实际伤害列宽度（px） */
export const ACTUAL_DAMAGE_COL_WIDTH = 80

/** 技能列宽度（px，保持正方形） */
export const SKILL_COL_WIDTH = 40

/** 数据行高（px，与技能列宽相同以保持正方形单元格） */
export const ROW_HEIGHT = 40

/** 列头行高（px） */
export const HEADER_HEIGHT = 48
```

- [ ] **Step 6.2: 提交**

```bash
git add src/components/TimelineTable/constants.ts
git commit -m "feat: 表格视图布局常量"
```

---

## Task 7：TableHeader 组件

**Files:**

- Create: `src/components/TimelineTable/TableHeader.tsx`

- [ ] **Step 7.1: 创建组件**

```typescript
// src/components/TimelineTable/TableHeader.tsx
/**
 * 表格视图列头
 *
 * 布局：
 * - 粘性顶部（sticky top: 0）
 * - 前 2-4 列也粘性左侧
 * - 技能列头显示职业图标 + 技能图标，hover/click 触发 tooltip
 */

import JobIcon from '../JobIcon'
import { getIconUrl } from '@/utils/iconUtils'
import { useTooltipStore } from '@/store/tooltipStore'
import type { SkillTrack } from '@/utils/skillTracks'
import type { MitigationAction } from '@/types/mitigation'
import {
  TIME_COL_WIDTH,
  NAME_COL_WIDTH,
  ORIGINAL_DAMAGE_COL_WIDTH,
  ACTUAL_DAMAGE_COL_WIDTH,
  SKILL_COL_WIDTH,
  HEADER_HEIGHT,
} from './constants'

interface TableHeaderProps {
  skillTracks: SkillTrack[]
  actionsById: Map<number, MitigationAction>
  showOriginalDamage: boolean
  showActualDamage: boolean
}

export default function TableHeader({
  skillTracks,
  actionsById,
  showOriginalDamage,
  showActualDamage,
}: TableHeaderProps) {
  const { showTooltip, toggleTooltip, hideTooltip } = useTooltipStore()

  // 计算粘性左侧列的累积 left 值
  let leftOffset = 0
  const timeLeft = leftOffset
  leftOffset += TIME_COL_WIDTH
  const nameLeft = leftOffset
  leftOffset += NAME_COL_WIDTH
  const origLeft = leftOffset
  if (showOriginalDamage) leftOffset += ORIGINAL_DAMAGE_COL_WIDTH
  const actualLeft = leftOffset
  if (showActualDamage) leftOffset += ACTUAL_DAMAGE_COL_WIDTH

  const stickyCellClass =
    'sticky bg-background border-r border-b text-xs font-semibold text-muted-foreground'

  return (
    <thead>
      <tr style={{ height: HEADER_HEIGHT }}>
        <th
          className={`${stickyCellClass} top-0 z-30 text-left px-2`}
          style={{ width: TIME_COL_WIDTH, minWidth: TIME_COL_WIDTH, left: timeLeft }}
        >
          时间
        </th>
        <th
          className={`${stickyCellClass} top-0 z-30 text-left px-2`}
          style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH, left: nameLeft }}
        >
          事件
        </th>
        {showOriginalDamage && (
          <th
            className={`${stickyCellClass} top-0 z-30 text-right px-2`}
            style={{
              width: ORIGINAL_DAMAGE_COL_WIDTH,
              minWidth: ORIGINAL_DAMAGE_COL_WIDTH,
              left: origLeft,
            }}
          >
            原始
          </th>
        )}
        {showActualDamage && (
          <th
            className={`${stickyCellClass} top-0 z-30 text-right px-2`}
            style={{
              width: ACTUAL_DAMAGE_COL_WIDTH,
              minWidth: ACTUAL_DAMAGE_COL_WIDTH,
              left: actualLeft,
            }}
          >
            实际
          </th>
        )}
        {skillTracks.map((track, index) => {
          const action = actionsById.get(track.actionId)
          const isNewPlayer = index === 0 || skillTracks[index - 1].playerId !== track.playerId
          const bgColor = index % 2 === 0 ? 'bg-background' : 'bg-muted/20'
          return (
            <th
              key={`h-${track.playerId}-${track.actionId}`}
              className={`sticky top-0 z-20 border-b text-center ${bgColor} ${
                isNewPlayer ? 'border-l-2 border-l-foreground/20' : 'border-l'
              }`}
              style={{ width: SKILL_COL_WIDTH, minWidth: SKILL_COL_WIDTH }}
            >
              <div className="flex flex-col items-center gap-0.5 py-1">
                <div className="opacity-60">
                  <JobIcon job={track.job} size="sm" />
                </div>
                <img
                  src={getIconUrl(track.actionIcon)}
                  alt={track.actionName}
                  className="w-6 h-6 rounded cursor-pointer"
                  onError={e => {
                    e.currentTarget.style.display = 'none'
                  }}
                  onMouseEnter={e => {
                    if (action) showTooltip(action, e.currentTarget.getBoundingClientRect())
                  }}
                  onMouseLeave={hideTooltip}
                  onClick={e => {
                    if (action) toggleTooltip(action, e.currentTarget.getBoundingClientRect())
                  }}
                />
              </div>
            </th>
          )
        })}
      </tr>
    </thead>
  )
}
```

- [ ] **Step 7.2: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无错误

- [ ] **Step 7.3: 提交**

```bash
git add src/components/TimelineTable/TableHeader.tsx
git commit -m "feat: 表格视图列头组件"
```

---

## Task 8：TableDataRow 组件（伤害事件行）

**Files:**

- Create: `src/components/TimelineTable/TableDataRow.tsx`

- [ ] **Step 8.1: 创建组件**

```typescript
// src/components/TimelineTable/TableDataRow.tsx
/**
 * 表格视图的伤害事件行
 *
 * 负责：
 * - 渲染时间、事件名、原始伤害、实际伤害四个粘性左侧列
 * - 遍历 skillTracks 渲染每个技能列，查 litCells 决定是否亮起
 * - 对编辑 / 回放、AoE / 死刑四种情况处理伤害数值来源
 */

import { formatTimeWithDecimal } from '@/utils/timeFormat'
import { cellKey } from '@/utils/castWindow'
import type { DamageEvent, Timeline } from '@/types/timeline'
import type { SkillTrack } from '@/utils/skillTracks'
import type { CalculationResult } from '@/utils/mitigationCalculator'
import {
  TIME_COL_WIDTH,
  NAME_COL_WIDTH,
  ORIGINAL_DAMAGE_COL_WIDTH,
  ACTUAL_DAMAGE_COL_WIDTH,
  SKILL_COL_WIDTH,
  ROW_HEIGHT,
} from './constants'

interface TableDataRowProps {
  event: DamageEvent
  timeline: Timeline
  skillTracks: SkillTrack[]
  litCells: Set<string>
  calculationResult: CalculationResult | undefined
  showOriginalDamage: boolean
  showActualDamage: boolean
}

const EMPTY = '—'

function formatDamage(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return EMPTY
  return n.toLocaleString()
}

/**
 * 提取死刑行的目标坦克伤害详情（仅回放模式下可用）
 */
function getTankbusterDetail(event: DamageEvent) {
  if (!event.playerDamageDetails || event.playerDamageDetails.length === 0) return undefined
  if (event.targetPlayerId !== undefined) {
    return event.playerDamageDetails.find(d => d.playerId === event.targetPlayerId)
  }
  return event.playerDamageDetails[0]
}

function resolveDamageNumbers(
  event: DamageEvent,
  timeline: Timeline,
  calculationResult: CalculationResult | undefined
): { original: number | undefined; actual: number | undefined } {
  const isReplay = !!timeline.isReplayMode
  const isTankbuster = event.type === 'tankbuster'

  if (isTankbuster) {
    if (isReplay) {
      const detail = getTankbusterDetail(event)
      return { original: detail?.unmitigatedDamage, actual: detail?.finalDamage }
    }
    // 编辑模式：calculator 跳过死刑
    return { original: event.damage, actual: undefined }
  }

  // AoE：两种模式都走 calculationResult
  return {
    original: calculationResult?.originalDamage,
    actual: calculationResult?.finalDamage,
  }
}

export default function TableDataRow({
  event,
  timeline,
  skillTracks,
  litCells,
  calculationResult,
  showOriginalDamage,
  showActualDamage,
}: TableDataRowProps) {
  const { original, actual } = resolveDamageNumbers(event, timeline, calculationResult)

  // 计算粘性左偏移
  let leftOffset = 0
  const timeLeft = leftOffset
  leftOffset += TIME_COL_WIDTH
  const nameLeft = leftOffset
  leftOffset += NAME_COL_WIDTH
  const origLeft = leftOffset
  if (showOriginalDamage) leftOffset += ORIGINAL_DAMAGE_COL_WIDTH
  const actualLeft = leftOffset
  if (showActualDamage) leftOffset += ACTUAL_DAMAGE_COL_WIDTH

  const stickyCell = 'sticky bg-background border-r border-b text-xs'
  const hoverClass = 'group-hover:bg-muted/50'

  return (
    <tr className="group" style={{ height: ROW_HEIGHT }}>
      <td
        className={`${stickyCell} ${hoverClass} z-10 px-2 tabular-nums`}
        style={{ width: TIME_COL_WIDTH, minWidth: TIME_COL_WIDTH, left: timeLeft }}
      >
        {formatTimeWithDecimal(event.time)}
      </td>
      <td
        className={`${stickyCell} ${hoverClass} z-10 px-2 truncate`}
        style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH, left: nameLeft }}
        title={event.name}
      >
        {event.name}
      </td>
      {showOriginalDamage && (
        <td
          className={`${stickyCell} ${hoverClass} z-10 px-2 text-right tabular-nums`}
          style={{
            width: ORIGINAL_DAMAGE_COL_WIDTH,
            minWidth: ORIGINAL_DAMAGE_COL_WIDTH,
            left: origLeft,
          }}
        >
          {formatDamage(original)}
        </td>
      )}
      {showActualDamage && (
        <td
          className={`${stickyCell} ${hoverClass} z-10 px-2 text-right tabular-nums`}
          style={{
            width: ACTUAL_DAMAGE_COL_WIDTH,
            minWidth: ACTUAL_DAMAGE_COL_WIDTH,
            left: actualLeft,
          }}
        >
          {formatDamage(actual)}
        </td>
      )}
      {skillTracks.map((track, index) => {
        const isNewPlayer = index === 0 || skillTracks[index - 1].playerId !== track.playerId
        const isLit = litCells.has(cellKey(track.playerId, track.actionId))
        const baseBg = index % 2 === 0 ? 'bg-background' : 'bg-muted/20'
        return (
          <td
            key={`c-${track.playerId}-${track.actionId}`}
            className={`border-b ${baseBg} ${hoverClass} ${
              isNewPlayer ? 'border-l-2 border-l-foreground/20' : 'border-l'
            }`}
            style={{ width: SKILL_COL_WIDTH, minWidth: SKILL_COL_WIDTH }}
          >
            {isLit && <div className="w-full h-full bg-primary/20" />}
          </td>
        )
      })}
    </tr>
  )
}
```

- [ ] **Step 8.2: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无错误

- [ ] **Step 8.3: 提交**

```bash
git add src/components/TimelineTable/TableDataRow.tsx
git commit -m "feat: 表格视图伤害事件行组件"
```

---

## Task 9：AnnotationRow 组件

**Files:**

- Create: `src/components/TimelineTable/AnnotationRow.tsx`

- [ ] **Step 9.1: 创建组件**

```typescript
// src/components/TimelineTable/AnnotationRow.tsx
/**
 * 表格视图的注释行
 *
 * 独占一行，时间列显示 mm:ss.f；其余所有列合并为一格展示注释文本。
 */

import { StickyNote } from 'lucide-react'
import { formatTimeWithDecimal } from '@/utils/timeFormat'
import type { Annotation } from '@/types/timeline'
import { TIME_COL_WIDTH } from './constants'

interface AnnotationRowProps {
  annotation: Annotation
  /** 除时间列外的剩余列数（用于 colSpan） */
  restColSpan: number
}

export default function AnnotationRow({ annotation, restColSpan }: AnnotationRowProps) {
  return (
    <tr className="bg-yellow-50/40 dark:bg-yellow-900/20">
      <td
        className="sticky left-0 z-10 bg-yellow-50/40 dark:bg-yellow-900/20 border-r border-b text-xs px-2 tabular-nums align-top py-2"
        style={{ width: TIME_COL_WIDTH, minWidth: TIME_COL_WIDTH }}
      >
        {formatTimeWithDecimal(annotation.time)}
      </td>
      <td
        colSpan={restColSpan}
        className="border-b text-xs italic text-muted-foreground px-3 py-2 align-top"
      >
        <div className="flex items-start gap-2">
          <StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="whitespace-pre-wrap leading-snug">{annotation.text}</div>
        </div>
      </td>
    </tr>
  )
}
```

- [ ] **Step 9.2: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无错误

- [ ] **Step 9.3: 提交**

```bash
git add src/components/TimelineTable/AnnotationRow.tsx
git commit -m "feat: 表格视图注释行组件"
```

---

## Task 10：TimelineTable 主组件

**Files:**

- Create: `src/components/TimelineTable/index.tsx`

- [ ] **Step 10.1: 创建主组件**

```typescript
// src/components/TimelineTable/index.tsx
/**
 * 表格视图主组件
 *
 * 数据流：
 * - useTimelineStore → timeline（伤害事件、注释、castEvents）
 * - useMitigationStore → actions（构造 actionsById Map）
 * - useSkillTracks() → 列顺序
 * - useDamageCalculationResults() → 编辑/回放模式的伤害数值
 * - useUIStore → showOriginalDamage / showActualDamage
 */

import { useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useUIStore } from '@/store/uiStore'
import { useSkillTracks } from '@/hooks/useSkillTracks'
import { useDamageCalculationResults } from '@/contexts/DamageCalculationContext'
import { computeLitCellsByEvent } from '@/utils/castWindow'
import { mergeAndSortRows } from '@/utils/tableRows'
import TableHeader from './TableHeader'
import TableDataRow from './TableDataRow'
import AnnotationRow from './AnnotationRow'

export default function TimelineTableView() {
  const timeline = useTimelineStore(s => s.timeline)
  const actions = useMitigationStore(s => s.actions)
  const showOriginalDamage = useUIStore(s => s.showOriginalDamage)
  const showActualDamage = useUIStore(s => s.showActualDamage)
  const skillTracks = useSkillTracks()
  const calculationResults = useDamageCalculationResults()

  const actionsById = useMemo(() => {
    const map = new Map<number, (typeof actions)[number]>()
    for (const a of actions) map.set(a.id, a)
    return map
  }, [actions])

  const litCellsByEvent = useMemo(() => {
    if (!timeline) return new Map<string, Set<string>>()
    return computeLitCellsByEvent(timeline.damageEvents, timeline.castEvents, actionsById)
  }, [timeline, actionsById])

  const rows = useMemo(() => {
    if (!timeline) return []
    return mergeAndSortRows(timeline.damageEvents, timeline.annotations ?? [])
  }, [timeline])

  if (!timeline) return null

  // AnnotationRow 的 colSpan = 除时间列以外的所有列数
  const restColSpan =
    1 /* 事件名 */ +
    (showOriginalDamage ? 1 : 0) +
    (showActualDamage ? 1 : 0) +
    skillTracks.length

  return (
    <div className="h-full w-full overflow-auto">
      <table className="border-collapse text-xs" style={{ borderSpacing: 0 }}>
        <TableHeader
          skillTracks={skillTracks}
          actionsById={actionsById}
          showOriginalDamage={showOriginalDamage}
          showActualDamage={showActualDamage}
        />
        <tbody>
          {rows.map(row =>
            row.kind === 'damage' ? (
              <TableDataRow
                key={`d-${row.id}`}
                event={row.event}
                timeline={timeline}
                skillTracks={skillTracks}
                litCells={litCellsByEvent.get(row.id) ?? new Set()}
                calculationResult={calculationResults.get(row.id)}
                showOriginalDamage={showOriginalDamage}
                showActualDamage={showActualDamage}
              />
            ) : (
              <AnnotationRow
                key={`a-${row.id}`}
                annotation={row.annotation}
                restColSpan={restColSpan}
              />
            )
          )}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 10.2: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无错误

- [ ] **Step 10.3: 运行所有测试**

Run: `pnpm test:run`
Expected: 所有测试通过

- [ ] **Step 10.4: 提交**

```bash
git add src/components/TimelineTable/index.tsx
git commit -m "feat: 表格视图主组件"
```

---

## Task 11：EditorPage 集成视图模式切换

**Files:**

- Modify: `src/pages/EditorPage.tsx`

- [ ] **Step 11.1: 修改 EditorPage**

在 `src/pages/EditorPage.tsx` 顶部 import 区补充：

```typescript
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import TimelineTableView from '@/components/TimelineTable'
```

（原 `useParams, useNavigate` 已存在，只需追加 `useSearchParams`。）

在 `EditorPage` 函数体内 `const { id } = useParams<{ id: string }>()` 下一行添加：

```typescript
const [searchParams, setSearchParams] = useSearchParams()
const viewMode: 'timeline' | 'table' = searchParams.get('view') === 'table' ? 'table' : 'timeline'
const handleViewModeChange = (mode: 'timeline' | 'table') => {
  const next = new URLSearchParams(searchParams)
  if (mode === 'table') next.set('view', 'table')
  else next.delete('view')
  setSearchParams(next, { replace: true })
}
```

找到 `<EditorToolbar ... />` 的调用（约第 306 行），在现有 props 基础上追加两个 prop：

```typescript
      <EditorToolbar
        onCreateCopy={isViewMode ? handleCreateCopy : undefined}
        forceReadOnly={isViewMode}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
      />
```

找到主内容区（约第 314-325 行）：

```typescript
          <div className="flex-1 overflow-hidden">
            <div ref={canvasContainerRef} className="h-full">
              {timeline ? (
                <ErrorBoundary>
                  <TimelineCanvas width={canvasSize.width} height={canvasSize.height} />
                </ErrorBoundary>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-muted-foreground">加载中...</p>
                </div>
              )}
            </div>
          </div>
```

替换为：

```typescript
          <div className="flex-1 overflow-hidden">
            <div ref={canvasContainerRef} className="h-full">
              {timeline ? (
                <ErrorBoundary>
                  {viewMode === 'table' ? (
                    <TimelineTableView />
                  ) : (
                    <TimelineCanvas width={canvasSize.width} height={canvasSize.height} />
                  )}
                </ErrorBoundary>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-muted-foreground">加载中...</p>
                </div>
              )}
            </div>
          </div>
```

- [ ] **Step 11.2: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: `EditorToolbar` 的 props 类型不匹配报错（因为 `viewMode` / `onViewModeChange` 尚未声明）。此报错会在 Task 12 中修复。

- [ ] **Step 11.3: 暂不提交，继续下一任务**

---

## Task 12：EditorToolbar 添加视图模式切换 UI

**Files:**

- Modify: `src/components/EditorToolbar.tsx`

- [ ] **Step 12.1: 修改 EditorToolbar props 接口**

找到 `interface EditorToolbarProps`（约第 55 行），追加两个字段：

```typescript
interface EditorToolbarProps {
  onCreateCopy?: () => void
  forceReadOnly?: boolean
  viewMode: 'timeline' | 'table'
  onViewModeChange: (mode: 'timeline' | 'table') => void
}
```

修改函数签名接收新 props：

```typescript
export default function EditorToolbar({
  onCreateCopy,
  forceReadOnly,
  viewMode,
  onViewModeChange,
}: EditorToolbarProps) {
```

- [ ] **Step 12.2: 在 dropdown-menu import 处添加 RadioGroup 项**

在 `src/components/EditorToolbar.tsx` 的 `@/components/ui/dropdown-menu` import 中追加：

```typescript
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
```

- [ ] **Step 12.3: 在视图菜单内容顶部插入 RadioGroup**

找到 `<DropdownMenuContent align="start">` 的开合（约第 245-264 行），修改为：

```typescript
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={viewMode}
                onValueChange={v => onViewModeChange(v as 'timeline' | 'table')}
              >
                <DropdownMenuRadioItem value="timeline">时间轴视图</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="table">表格视图</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>伤害事件</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuCheckboxItem
                    checked={showActualDamage}
                    onCheckedChange={toggleShowActualDamage}
                  >
                    实际伤害
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showOriginalDamage}
                    onCheckedChange={toggleShowOriginalDamage}
                  >
                    原始伤害
                  </DropdownMenuCheckboxItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
```

- [ ] **Step 12.4: 表格视图下禁用 zoom 滑块**

找到 `<Slider value={[zoomLevel]} ...>`（约第 133 行），添加 `disabled` 属性：

```typescript
            <Slider
              value={[zoomLevel]}
              onValueChange={handleZoomChange}
              min={10}
              max={100}
              className="w-24"
              disabled={viewMode === 'table'}
            />
```

- [ ] **Step 12.5: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无错误（Task 11 的报错也被修复）

- [ ] **Step 12.6: 运行全部测试**

Run: `pnpm test:run`
Expected: 所有测试通过

- [ ] **Step 12.7: 提交 Task 11 + 12 的改动**

```bash
git add src/pages/EditorPage.tsx src/components/EditorToolbar.tsx
git commit -m "feat: 编辑器集成表格视图切换"
```

---

## Task 13：手动冒烟测试与收尾

**Files:** 无文件改动。

- [ ] **Step 13.1: 启动开发服务器**

Run: `pnpm dev`
在浏览器打开一个已有的时间轴。

- [ ] **Step 13.2: 基本功能检查**

- 打开视图菜单（`Eye` 按钮），顶部应显示"时间轴视图 ● / 表格视图 ○"的单选组
- 切换到"表格视图"：
  - URL 变为 `?view=table`
  - 主内容区显示表格，列头为"时间 | 事件 | [原始 | 实际 |] 技能列..."
  - 时间格式 `m:ss.f`（一位小数）
  - 伤害事件按时间升序
  - 每个 cast 对应的单元格有淡淡的背景色（`bg-primary/20`）
  - 列头 hover 技能图标应弹出 tooltip
  - zoom 滑块变为 disabled 灰色
  - PropertyPanel 自动隐藏（未选中事件时）
- 切回"时间轴视图"：
  - URL `?view=table` 消失
  - 时间轴 Canvas 重新出现，minimap 可见
- 测试分享场景：
  - 表格视图下点分享/创建副本按钮，功能正常
  - 复制带 `?view=table` 的 URL，新标签页打开应直接进入表格视图
- 测试注释：
  - 先在时间轴视图添加一条注释，切回表格视图应看到注释独占行
- 测试回放模式：
  - 导入一场 FFLogs 报告，切换到表格视图
  - AoE 行的原始/实际伤害应显示具体数字
  - 死刑行显示目标坦克的数值

- [ ] **Step 13.3: 运行全部测试和 lint**

Run: `pnpm test:run && pnpm lint`
Expected: 全绿

- [ ] **Step 13.4: 查看 git log 确认提交序列**

Run: `git log --oneline feat/table-view ^main`
Expected: 能看到本次实现的 10-11 个提交

---

## 待 review 清单

以下问题在实现/测试过程中请留意，可能需要追加调整：

- 粘性列的 `z-index` 层叠：列头 `z-30`，数据行粘性列 `z-10`。列头数据行交界处（数据行的粘性列滚动到列头下方）应该是列头在上——验证一下 `z-30 > z-10` 是否足以保证这一点
- `formatTimeWithDecimal` 对负数 time 的处理（spec 没要求支持负时间，但若用户导入的 FFLogs 报告有 pull 前动作可能出现负值）
- 在 `SkillTracksCanvas.tsx` 如果 `SkillTrack` import 本就来自 `./SkillTrackLabels` 而未改路径，验证通过 re-export 依然可编译
- `computeLitCellsByEvent` 对 50 × 200 的规模是 O(10000)，未 memo 化可能每次 re-render 重算；已用 `useMemo` 缓存，依赖 `[timeline, actionsById]`，timeline 对象变化时重算——编辑模式下每次 autoSave 都会变，可接受
- `composition.players` 可能有未定义的极端情况（如 Composition 类型允许 `players: []`），`useSkillTracks` 已对 `composition` 为空做保护
