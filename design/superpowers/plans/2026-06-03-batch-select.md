# 时间轴批量框选 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在时间轴画布编辑器中加入「框选模式」，支持矩形/标尺无限高度框选伤害事件·技能 cast·注释，并对多选对象整体拖动、批量删除、跨页/跨时间轴复制粘贴。

**Architecture:** 选中态由单选升级为三类数组（`timelineStore`，派生回旧的单选字段供面板复用）；批量改/删/粘贴各用单个 `engine.doc.transact()` 包裹复用既有 `y*` mutator，UndoManager 视作一步；剪贴板复用 V2 codec（`toV2`/`hydrateFromV2`）只写 web 自定义格式；跨时间轴粘贴复用导入流程的 `buildPlayerIdMap` 按职业映射。画布交互（工具切换、矩形选框、群组拖动）落在 Konva 层之上的 CSS overlay 与既有 pan/zoom 钩子。

**Tech Stack:** React 19 + TypeScript、Zustand 5、Yjs（协作 doc）、React-Konva、Vitest 4、pnpm。

**Spec:** `design/superpowers/specs/2026-06-03-batch-select-design.md`

---

## 文件结构

| 文件                                              | 职责                                                                                               | 改/建        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------ |
| `src/store/uiStore.ts`                            | 新增 `canvasTool` 画布工具模式（持久化 UI 偏好）                                                   | 改           |
| `src/store/timelineStore.ts`                      | 多选数组 + 派生单选 + selection actions + `bulkMoveSelection`/`bulkDeleteSelection`/`pasteObjects` | 改           |
| `src/store/timelineStore.test.ts`                 | 上述 store 逻辑的单测                                                                              | 改           |
| `src/collab/awarenessTypes.ts`                    | `selection` 字段升级为数组                                                                         | 改           |
| `src/utils/timelineClipboard.ts`                  | 剪贴板纯逻辑：构造/解析载荷、粘贴重映射                                                            | 建           |
| `src/utils/timelineClipboard.test.ts`             | 剪贴板纯逻辑单测                                                                                   | 建           |
| `src/components/Timeline/marqueeHitTest.ts`       | 框选相交判定纯函数                                                                                 | 建           |
| `src/components/Timeline/marqueeHitTest.test.ts`  | 相交判定单测                                                                                       | 建           |
| `src/components/Timeline/useMarqueeSelection.ts`  | 框选 overlay 状态 + 指针事件 hook                                                                  | 建           |
| `src/components/EditorToolbar.tsx`                | 拖动/框选模式切换按钮                                                                              | 改           |
| `src/components/Timeline/useTimelinePanZoom.ts`   | select 模式 / 标尺区禁用平移、放行框选                                                             | 改           |
| `src/components/Timeline/index.tsx`               | 接线：框选、群组拖动、多选高亮、热键、菜单、复制粘贴 glue                                          | 改           |
| `src/components/Timeline/DamageEventCard.tsx`     | `isSelected` 取自数组（无需改 props，仅调用侧改）                                                  | （调用侧改） |
| `src/components/Timeline/CastEventIcon.tsx`       | 同上                                                                                               | （调用侧改） |
| `src/components/Timeline/TimelineContextMenu.tsx` | 新增 `multiSelection` 变体（复制/删除）+ 粘贴可用探测                                              | 改           |

> 实现顺序：先纯逻辑/状态（Task 1–7，可 TDD），再协作字段（Task 8），最后画布交互（Task 9–14，手动验证 + tsc/lint 兜底）。每个 Task 末尾 commit。

---

## Task 1: uiStore 新增 canvasTool

**Files:**

- Modify: `src/store/uiStore.ts`

- [ ] **Step 1: 写失败测试**

新建/追加到 `src/store/uiStore.test.ts`（若不存在则创建，复用项目 vitest 范式）：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './uiStore'

describe('uiStore - canvasTool', () => {
  beforeEach(() => useUIStore.setState({ canvasTool: 'pan' }))

  it('默认是 pan', () => {
    expect(useUIStore.getState().canvasTool).toBe('pan')
  })

  it('setCanvasTool 切换到 select', () => {
    useUIStore.getState().setCanvasTool('select')
    expect(useUIStore.getState().canvasTool).toBe('select')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run src/store/uiStore`
Expected: FAIL（`canvasTool` / `setCanvasTool` 不存在）

- [ ] **Step 3: 实现**

`UIState` 接口内（如 `draggingId` 之后）加：

```ts
  /** 画布工具模式：pan=拖动平移（默认），select=矩形框选 */
  canvasTool: 'pan' | 'select'
  /** 设置画布工具模式 */
  setCanvasTool: (tool: 'pan' | 'select') => void
```

`create` 初值区（`draggingId: null,` 之后）加 `canvasTool: 'pan',`；actions 区（`setDraggingId` 之后）加：

```ts
      setCanvasTool: tool => set({ canvasTool: tool }),
```

`canvasTool` 应被持久化（记住偏好）：当前 `partialize: ({ theme, draggingId, manualLock, ...rest }) => rest` 已自动包含 `canvasTool`（它不在排除列表），无需改 partialize。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run src/store/uiStore`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/uiStore.ts src/store/uiStore.test.ts
git commit -m "feat(timeline): add canvasTool ui state for select mode"
```

---

## Task 2: 多选状态 + 派生单选 + selection actions

**Files:**

- Modify: `src/store/timelineStore.ts`
- Modify: `src/store/timelineStore.test.ts`

设计：`selectedEventIds/selectedCastEventIds/selectedAnnotationIds` 为真相源；保留旧 `selectedEventId/selectedCastEventId`，**仅当总选中数==1 且为该类型**时派生出对应 id（供 `PropertyPanel` 等单选消费方继续工作）。

- [ ] **Step 1: 写失败测试**

在 `timelineStore.test.ts` 末尾追加（复用文件顶部已有的 `baseContent`/`mockComposition`/`openTimeline` 范式）：

```ts
describe('多选 selection', () => {
  beforeEach(async () => {
    await useTimelineStore.getState().openTimeline('sel-test', {
      role: 'local',
      seedContent: baseContent,
    })
  })

  it('setSelection 写入数组并派生单选', () => {
    useTimelineStore.getState().setSelection({ eventIds: ['e1'] })
    const s = useTimelineStore.getState()
    expect(s.selectedEventIds).toEqual(['e1'])
    expect(s.selectedEventId).toBe('e1') // 单选派生
    expect(s.selectedCastEventId).toBeNull()
  })

  it('多选时派生单选为 null（面板不弹）', () => {
    useTimelineStore.getState().setSelection({ eventIds: ['e1', 'e2'] })
    const s = useTimelineStore.getState()
    expect(s.selectedEventIds).toEqual(['e1', 'e2'])
    expect(s.selectedEventId).toBeNull()
  })

  it('混合类型选中时派生单选为 null', () => {
    useTimelineStore.getState().setSelection({ eventIds: ['e1'], castEventIds: ['c1'] })
    expect(useTimelineStore.getState().selectedEventId).toBeNull()
    expect(useTimelineStore.getState().selectedCastEventId).toBeNull()
  })

  it('toggleSelection 切换单个对象', () => {
    useTimelineStore.getState().setSelection({ castEventIds: ['c1'] })
    useTimelineStore.getState().toggleSelection('cast', 'c2')
    expect(useTimelineStore.getState().selectedCastEventIds.sort()).toEqual(['c1', 'c2'])
    useTimelineStore.getState().toggleSelection('cast', 'c1')
    expect(useTimelineStore.getState().selectedCastEventIds).toEqual(['c2'])
  })

  it('addToSelection 求并集去重', () => {
    useTimelineStore.getState().setSelection({ eventIds: ['e1'] })
    useTimelineStore.getState().addToSelection({ eventIds: ['e1', 'e2'], annotationIds: ['a1'] })
    const s = useTimelineStore.getState()
    expect(s.selectedEventIds.sort()).toEqual(['e1', 'e2'])
    expect(s.selectedAnnotationIds).toEqual(['a1'])
  })

  it('clearSelection 清空全部', () => {
    useTimelineStore.getState().setSelection({ eventIds: ['e1'], castEventIds: ['c1'] })
    useTimelineStore.getState().clearSelection()
    const s = useTimelineStore.getState()
    expect(s.selectedEventIds).toEqual([])
    expect(s.selectedCastEventIds).toEqual([])
    expect(s.selectedAnnotationIds).toEqual([])
    expect(s.selectedEventId).toBeNull()
  })

  it('selectEvent(id) 等价单选；selectEvent(null) 清空', () => {
    useTimelineStore.getState().selectEvent('e9')
    expect(useTimelineStore.getState().selectedEventIds).toEqual(['e9'])
    useTimelineStore.getState().selectEvent(null)
    expect(useTimelineStore.getState().selectedEventIds).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/store/timelineStore`
Expected: FAIL（`setSelection` 等不存在）

- [ ] **Step 3: 实现**

3a. `TimelineState` 接口：在 `selectedCastEventId: string | null` 之后加数组与 actions 类型，并加一个选择补丁类型（放文件顶部 import 之后）：

```ts
export type SelectionKind = 'damage' | 'cast' | 'annotation'
export interface SelectionPatch {
  eventIds?: string[]
  castEventIds?: string[]
  annotationIds?: string[]
}
```

接口内（`selectedCastEventId` 字段之后）：

```ts
  /** 选中的伤害事件 ID 列表（多选真相源） */
  selectedEventIds: string[]
  /** 选中的技能使用事件 ID 列表 */
  selectedCastEventIds: string[]
  /** 选中的注释 ID 列表 */
  selectedAnnotationIds: string[]
```

actions 区（`selectCastEvent` 类型之后）：

```ts
  /** 整组替换选择 */
  setSelection: (sel: SelectionPatch) => void
  /** 与现有选择求并集（Shift 框选） */
  addToSelection: (sel: SelectionPatch) => void
  /** 切换单个对象选中态（Ctrl/Cmd 点击） */
  toggleSelection: (kind: SelectionKind, id: string) => void
  /** 清空全部选择 */
  clearSelection: () => void
```

3b. `initialUiState` 加三个空数组（在 `selectedCastEventId: null,` 之后）：

```ts
  selectedEventIds: [],
  selectedCastEventIds: [],
  selectedAnnotationIds: [],
```

3c. 模块内（`useTimelineStore` 外层，靠近其他 helper）加派生与写 awareness 的纯函数：

```ts
/** 由多选数组派生旧的单选字段：仅当总选中数==1 且为该类型时给出 id */
function deriveSingle(sel: {
  eventIds: string[]
  castEventIds: string[]
  annotationIds: string[]
}) {
  const total = sel.eventIds.length + sel.castEventIds.length + sel.annotationIds.length
  return {
    selectedEventId: total === 1 && sel.eventIds.length === 1 ? sel.eventIds[0] : null,
    selectedCastEventId: total === 1 && sel.castEventIds.length === 1 ? sel.castEventIds[0] : null,
  }
}
```

3d. 替换 `selectEvent`/`selectCastEvent` 实现，并新增四个 action（放在 `selectCastEvent` 附近）：

```ts
    setSelection: sel => {
      const next = {
        eventIds: sel.eventIds ?? [],
        castEventIds: sel.castEventIds ?? [],
        annotationIds: sel.annotationIds ?? [],
      }
      set({
        selectedEventIds: next.eventIds,
        selectedCastEventIds: next.castEventIds,
        selectedAnnotationIds: next.annotationIds,
        ...deriveSingle(next),
      })
      get().engine?.awareness.setLocalStateField('selection', next)
    },

    addToSelection: sel => {
      const s = get()
      get().setSelection({
        eventIds: [...new Set([...s.selectedEventIds, ...(sel.eventIds ?? [])])],
        castEventIds: [...new Set([...s.selectedCastEventIds, ...(sel.castEventIds ?? [])])],
        annotationIds: [...new Set([...s.selectedAnnotationIds, ...(sel.annotationIds ?? [])])],
      })
    },

    toggleSelection: (kind, id) => {
      const s = get()
      const key =
        kind === 'damage'
          ? 'selectedEventIds'
          : kind === 'cast'
            ? 'selectedCastEventIds'
            : 'selectedAnnotationIds'
      const cur = s[key]
      const nextArr = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
      get().setSelection({
        eventIds: s.selectedEventIds,
        castEventIds: s.selectedCastEventIds,
        annotationIds: s.selectedAnnotationIds,
        [key === 'selectedEventIds'
          ? 'eventIds'
          : key === 'selectedCastEventIds'
            ? 'castEventIds'
            : 'annotationIds']: nextArr,
      })
    },

    clearSelection: () => get().setSelection({}),

    selectEvent: eventId => {
      if (eventId == null) get().clearSelection()
      else get().setSelection({ eventIds: [eventId] })
    },

    selectCastEvent: castEventId => {
      if (castEventId == null) get().clearSelection()
      else get().setSelection({ castEventIds: [castEventId] })
    },
```

3e. `removeDamageEvent`/`removeCastEvent` 末尾的 `set({ selectedEventId: null })` 改为不破坏数组一致性——改成清相应数组项更稳：

`removeDamageEvent` 内 `if (get().selectedEventId === eventId) set({ selectedEventId: null })` 替换为：

```ts
if (get().selectedEventIds.includes(eventId)) {
  get().setSelection({
    eventIds: get().selectedEventIds.filter(x => x !== eventId),
    castEventIds: get().selectedCastEventIds,
    annotationIds: get().selectedAnnotationIds,
  })
}
```

`removeCastEvent` 内同理（过滤 `selectedCastEventIds`）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/store/timelineStore`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "feat(timeline): multi-selection state with derived single-select"
```

---

## Task 3: bulkMoveSelection

**Files:**

- Modify: `src/store/timelineStore.ts`
- Modify: `src/store/timelineStore.test.ts`

- [ ] **Step 1: 写失败测试**

在多选 describe 内追加。先准备含事件的 seed（在该 describe 顶部新增一个带数据的 content）：

```ts
const seedWithItems: TimelineContent = {
  ...baseContent,
  damageEvents: [
    { id: 'd1', name: 'AA', time: 10, damage: 1000, type: 'aoe', damageType: 'magical' },
  ],
  castEvents: [{ id: 'c1', actionId: 16536, timestamp: 12, playerId: 2 }],
  annotations: [{ id: 'a1', text: '注', time: 14, anchor: { type: 'damageTrack' } }],
}

describe('bulkMoveSelection', () => {
  beforeEach(async () => {
    await useTimelineStore
      .getState()
      .openTimeline('move-test', { role: 'local', seedContent: seedWithItems })
  })

  it('对全部选中对象施加同一 delta，下界夹紧', () => {
    const store = useTimelineStore.getState()
    store.setSelection({ eventIds: ['d1'], castEventIds: ['c1'], annotationIds: ['a1'] })
    store.bulkMoveSelection(5)
    const tl = useTimelineStore.getState().timeline!
    expect(tl.damageEvents.find(e => e.id === 'd1')!.time).toBe(15)
    expect(tl.castEvents.find(c => c.id === 'c1')!.timestamp).toBe(17)
    expect(tl.annotations!.find(a => a.id === 'a1')!.time).toBe(19)
  })

  it('伤害事件下界为 0', () => {
    const store = useTimelineStore.getState()
    store.setSelection({ eventIds: ['d1'] })
    store.bulkMoveSelection(-1000)
    expect(useTimelineStore.getState().timeline!.damageEvents.find(e => e.id === 'd1')!.time).toBe(
      0
    )
  })

  it('一次移动只产生一步 undo', () => {
    const store = useTimelineStore.getState()
    store.setSelection({ eventIds: ['d1'], castEventIds: ['c1'] })
    store.bulkMoveSelection(3)
    store.undo()
    const tl = useTimelineStore.getState().timeline!
    expect(tl.damageEvents.find(e => e.id === 'd1')!.time).toBe(10)
    expect(tl.castEvents.find(c => c.id === 'c1')!.timestamp).toBe(12)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/store/timelineStore`
Expected: FAIL（`bulkMoveSelection` 不存在）

- [ ] **Step 3: 实现**

文件顶部 import 区加（与其它 `@/` import 同处）：

```ts
import { TIMELINE_START_TIME } from '@/components/Timeline/constants'
```

接口 actions 区加类型：

```ts
  /** 批量平移选中对象的时间（同一事务，单步 undo） */
  bulkMoveSelection: (delta: number) => void
```

实现（放在 `bulkImport` 附近）：

```ts
    bulkMoveSelection: delta => {
      const engine = get().engine
      const tl = get().timeline
      if (!engine || !tl || delta === 0) return
      const { selectedEventIds, selectedCastEventIds, selectedAnnotationIds } = get()
      if (
        selectedEventIds.length === 0 &&
        selectedCastEventIds.length === 0 &&
        selectedAnnotationIds.length === 0
      )
        return
      const dmg = new Map(tl.damageEvents.map(e => [e.id, e]))
      const cast = new Map(tl.castEvents.map(c => [c.id, c]))
      const ann = new Map((tl.annotations ?? []).map(a => [a.id, a]))
      engine.doc.transact(() => {
        for (const id of selectedEventIds) {
          const e = dmg.get(id)
          if (e) yUpdateDamageEvent(engine.doc, id, { time: Math.max(0, e.time + delta) })
        }
        for (const id of selectedCastEventIds) {
          const c = cast.get(id)
          if (c)
            yUpdateCastEvent(engine.doc, id, {
              timestamp: Math.max(TIMELINE_START_TIME, c.timestamp + delta),
            })
        }
        for (const id of selectedAnnotationIds) {
          const a = ann.get(id)
          if (a) yUpdateAnnotation(engine.doc, id, { time: Math.max(TIMELINE_START_TIME, a.time + delta) })
        }
      }, LOCAL_ORIGIN)
    },
```

> 注：`yUpdateDamageEvent` 等已 import（store 顶部已有）；`LOCAL_ORIGIN` 同。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/store/timelineStore`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "feat(timeline): bulkMoveSelection in single transaction"
```

---

## Task 4: bulkDeleteSelection

**Files:**

- Modify: `src/store/timelineStore.ts`
- Modify: `src/store/timelineStore.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('bulkDeleteSelection', () => {
  beforeEach(async () => {
    await useTimelineStore
      .getState()
      .openTimeline('del-test', { role: 'local', seedContent: seedWithItems })
  })

  it('删除全部选中并清空 selection，单步 undo', () => {
    const store = useTimelineStore.getState()
    store.setSelection({ eventIds: ['d1'], castEventIds: ['c1'], annotationIds: ['a1'] })
    store.bulkDeleteSelection()
    let tl = useTimelineStore.getState().timeline!
    expect(tl.damageEvents).toHaveLength(0)
    expect(tl.castEvents).toHaveLength(0)
    expect(tl.annotations ?? []).toHaveLength(0)
    expect(useTimelineStore.getState().selectedEventIds).toEqual([])

    store.undo()
    tl = useTimelineStore.getState().timeline!
    expect(tl.damageEvents).toHaveLength(1)
    expect(tl.castEvents).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/store/timelineStore`
Expected: FAIL

- [ ] **Step 3: 实现**

接口：

```ts
  /** 批量删除选中对象（同一事务，单步 undo），随后清空选择 */
  bulkDeleteSelection: () => void
```

实现（`bulkMoveSelection` 旁）：

```ts
    bulkDeleteSelection: () => {
      const engine = get().engine
      if (!engine) return
      const { selectedEventIds, selectedCastEventIds, selectedAnnotationIds } = get()
      if (
        selectedEventIds.length === 0 &&
        selectedCastEventIds.length === 0 &&
        selectedAnnotationIds.length === 0
      )
        return
      engine.doc.transact(() => {
        for (const id of selectedEventIds) yRemoveDamageEvent(engine.doc, id)
        for (const id of selectedCastEventIds) yRemoveCastEvent(engine.doc, id)
        for (const id of selectedAnnotationIds) yRemoveAnnotation(engine.doc, id)
      }, LOCAL_ORIGIN)
      get().clearSelection()
    },
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/store/timelineStore`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "feat(timeline): bulkDeleteSelection in single transaction"
```

---

## Task 5: pasteObjects（批量写入新对象并选中）

**Files:**

- Modify: `src/store/timelineStore.ts`
- Modify: `src/store/timelineStore.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('pasteObjects', () => {
  beforeEach(async () => {
    await useTimelineStore
      .getState()
      .openTimeline('paste-test', { role: 'local', seedContent: baseContent })
  })

  it('以新 id 写入三类对象并选中它们，单步 undo', () => {
    const store = useTimelineStore.getState()
    store.pasteObjects({
      damageEvents: [{ name: 'X', time: 5, damage: 1, type: 'aoe', damageType: 'magical' }],
      castEvents: [{ actionId: 16536, timestamp: 6, playerId: 2 }],
      annotations: [{ text: '注', time: 7, anchor: { type: 'damageTrack' } }],
    })
    const s = useTimelineStore.getState()
    const tl = s.timeline!
    expect(tl.damageEvents).toHaveLength(1)
    expect(tl.castEvents).toHaveLength(1)
    expect(tl.annotations).toHaveLength(1)
    // 选中新对象
    expect(s.selectedEventIds).toEqual([tl.damageEvents[0].id])
    expect(s.selectedCastEventIds).toEqual([tl.castEvents[0].id])
    expect(s.selectedAnnotationIds).toEqual([tl.annotations![0].id])

    store.undo()
    expect(useTimelineStore.getState().timeline!.damageEvents).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/store/timelineStore`
Expected: FAIL

- [ ] **Step 3: 实现**

接口（顶部类型区可加别名，或直接内联 Omit）：

```ts
  /** 批量粘贴：以新 id 写入三类对象（单事务），并选中新对象 */
  pasteObjects: (objs: {
    damageEvents: Omit<DamageEvent, 'id'>[]
    castEvents: Omit<CastEvent, 'id'>[]
    annotations: Omit<Annotation, 'id'>[]
  }) => void
```

实现（`bulkImport` 旁；`generateId` 已在 store 内使用）：

```ts
    pasteObjects: objs => {
      const engine = get().engine
      if (!engine) return
      const eventIds: string[] = []
      const castEventIds: string[] = []
      const annotationIds: string[] = []
      engine.doc.transact(() => {
        for (const e of objs.damageEvents) {
          const id = generateId()
          yAddDamageEvent(engine.doc, { ...e, id })
          eventIds.push(id)
        }
        for (const c of objs.castEvents) {
          const id = generateId()
          yAddCastEvent(engine.doc, { ...c, id })
          castEventIds.push(id)
        }
        for (const a of objs.annotations) {
          const id = generateId()
          yAddAnnotation(engine.doc, { ...a, id })
          annotationIds.push(id)
        }
      }, LOCAL_ORIGIN)
      get().setSelection({ eventIds, castEventIds, annotationIds })
    },
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/store/timelineStore`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "feat(timeline): pasteObjects writes new ids and selects them"
```

---

## Task 6: 剪贴板载荷 构造 / 解析（纯逻辑）

**Files:**

- Create: `src/utils/timelineClipboard.ts`
- Create: `src/utils/timelineClipboard.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { CLIPBOARD_MIME, buildClipboardPayload, parseClipboardPayload } from './timelineClipboard'
import type { Timeline } from '@/types/timeline'

const timeline = {
  id: 't1',
  name: 'TL',
  encounter: { id: 1, name: 'E', displayName: 'E', zone: 'Z', damageEvents: [] },
  composition: {
    players: [
      { id: 1, job: 'PLD' },
      { id: 2, job: 'WHM' },
    ],
  },
  damageEvents: [
    { id: 'd1', name: 'AA', time: 10, damage: 1, type: 'aoe', damageType: 'magical' },
    { id: 'd2', name: 'BB', time: 20, damage: 2, type: 'aoe', damageType: 'magical' },
  ],
  castEvents: [{ id: 'c1', actionId: 16536, timestamp: 12, playerId: 2 }],
  annotations: [{ id: 'a1', text: 'n', time: 14, anchor: { type: 'damageTrack' } }],
  createdAt: 1,
  updatedAt: 1,
} as unknown as Timeline

describe('timelineClipboard 构造/解析', () => {
  it('buildClipboardPayload 仅含选中子集', () => {
    const p = buildClipboardPayload(timeline, {
      eventIds: ['d1'],
      castEventIds: ['c1'],
      annotationIds: ['a1'],
    })
    expect(p.__healerbook__).toBe('timeline-clipboard')
    expect(p.version).toBe(1)
    expect(p.v2.de).toHaveLength(1) // 只有 d1
    expect(p.v2.ce.t).toHaveLength(1)
  })

  it('CLIPBOARD_MIME 是 web 自定义格式', () => {
    expect(CLIPBOARD_MIME.startsWith('web ')).toBe(true)
  })

  it('parseClipboardPayload 校验标识', () => {
    const p = buildClipboardPayload(timeline, {
      eventIds: ['d1'],
      castEventIds: [],
      annotationIds: [],
    })
    expect(parseClipboardPayload(JSON.stringify(p))).not.toBeNull()
    expect(parseClipboardPayload('hello world')).toBeNull()
    expect(parseClipboardPayload(JSON.stringify({ foo: 1 }))).toBeNull()
  })
})
```

> 注：`v2.ce` 是 `V2CastEvents`（`{ t:number[], ... }` 形态，见 `timelineFormat.ts:toV2CastEvents`）。若结构断言细节不符，按实际 `V2Timeline` 形态调整断言字段名（`pnpm exec tsc` 会暴露类型）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/utils/timelineClipboard`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
/**
 * 时间轴批量复制粘贴 —— 剪贴板纯逻辑。
 * 载荷复用 V2 分享格式（toV2/hydrateFromV2），只走 web 自定义格式进系统剪贴板。
 */
import type { Timeline } from '@/types/timeline'
import type { V2Timeline } from '@/utils/timelineFormat'
import { toV2 } from '@/utils/timelineFormat'

/** web 自定义格式 MIME；外部应用粘贴看不到，避免污染 */
export const CLIPBOARD_MIME = 'web application/x-healerbook-timeline+json'

export interface TimelineClipboard {
  __healerbook__: 'timeline-clipboard'
  version: 1
  v2: V2Timeline
}

export interface ClipboardSelection {
  eventIds: string[]
  castEventIds: string[]
  annotationIds: string[]
}

/** 用选中子集拼一个合成 Timeline 并序列化为载荷 */
export function buildClipboardPayload(
  timeline: Timeline,
  sel: ClipboardSelection
): TimelineClipboard {
  const eventSet = new Set(sel.eventIds)
  const castSet = new Set(sel.castEventIds)
  const annSet = new Set(sel.annotationIds)
  const subset: Timeline = {
    ...timeline,
    damageEvents: timeline.damageEvents.filter(e => eventSet.has(e.id)),
    castEvents: timeline.castEvents.filter(c => castSet.has(c.id)),
    annotations: (timeline.annotations ?? []).filter(a => annSet.has(a.id)),
    syncEvents: [],
  }
  return { __healerbook__: 'timeline-clipboard', version: 1, v2: toV2(subset) }
}

/** 解析并校验剪贴板文本；非本格式返回 null */
export function parseClipboardPayload(text: string): TimelineClipboard | null {
  try {
    const obj = JSON.parse(text)
    if (obj && obj.__healerbook__ === 'timeline-clipboard' && obj.version === 1 && obj.v2) {
      return obj as TimelineClipboard
    }
  } catch {
    /* not our format */
  }
  return null
}
```

> 若 `V2Timeline` 未从 `timelineFormat.ts` 导出，先在该文件给 `V2Timeline` 加 `export`（仅导出类型，无运行时影响）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/utils/timelineClipboard`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/timelineClipboard.ts src/utils/timelineClipboard.test.ts
git commit -m "feat(timeline): clipboard payload build/parse reusing V2 codec"
```

---

## Task 7: 粘贴重映射（hydrate + 职业映射 + 时间平移）

**Files:**

- Modify: `src/utils/timelineClipboard.ts`
- Modify: `src/utils/timelineClipboard.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { remapClipboardForPaste } from './timelineClipboard'
import type { Composition } from '@/types/timeline'

describe('remapClipboardForPaste', () => {
  const validActionIds = new Set<number>([16536])

  function payloadFrom(t: Timeline, sel: ClipboardSelection) {
    return buildClipboardPayload(t, sel)
  }

  it('职业相同：cast 落回对应职业玩家，时间按最早对象对齐 targetTime', () => {
    const p = payloadFrom(timeline, {
      eventIds: ['d1', 'd2'],
      castEventIds: ['c1'],
      annotationIds: ['a1'],
    })
    // 当前阵容同职业（PLD, WHM）
    const cur: Composition = {
      players: [
        { id: 7, job: 'PLD' },
        { id: 9, job: 'WHM' },
      ],
    }
    const out = remapClipboardForPaste(p, {
      currentComposition: cur,
      targetTime: 100,
      validActionIds,
    })
    // 最早对象 d1.time=10 → baseTime=10；targetTime=100 → 偏移 +90
    expect(out.damageEvents.map(e => e.time).sort((a, b) => a - b)).toEqual([100, 110])
    // cast 原 playerId=WHM 槽 → 落到当前 WHM=9
    expect(out.castEvents[0].playerId).toBe(9)
    expect(out.castEvents[0].timestamp).toBe(102)
    expect(out.skipped).toBe(0)
  })

  it('目标缺职业：该 cast 跳过并计数；伤害事件仍保留', () => {
    const p = payloadFrom(timeline, { eventIds: ['d1'], castEventIds: ['c1'], annotationIds: [] })
    const cur: Composition = { players: [{ id: 7, job: 'PLD' }] } // 无 WHM
    const out = remapClipboardForPaste(p, {
      currentComposition: cur,
      targetTime: 0,
      validActionIds,
    })
    expect(out.castEvents).toHaveLength(0)
    expect(out.skipped).toBe(1)
    expect(out.damageEvents).toHaveLength(1)
  })

  it('actionId 不在注册表：跳过', () => {
    const p = payloadFrom(timeline, { eventIds: [], castEventIds: ['c1'], annotationIds: [] })
    const cur: Composition = {
      players: [
        { id: 7, job: 'PLD' },
        { id: 9, job: 'WHM' },
      ],
    }
    const out = remapClipboardForPaste(p, {
      currentComposition: cur,
      targetTime: 0,
      validActionIds: new Set(),
    })
    expect(out.castEvents).toHaveLength(0)
    expect(out.skipped).toBe(1)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/utils/timelineClipboard`
Expected: FAIL（`remapClipboardForPaste` 不存在）

- [ ] **Step 3: 实现**

`timelineClipboard.ts` 顶部补 import：

```ts
import type { Composition, DamageEvent, CastEvent, Annotation } from '@/types/timeline'
import { hydrateFromV2 } from '@/utils/timelineFormat'
import { buildPlayerIdMap } from '@/utils/importAdapter'
import { TIMELINE_START_TIME } from '@/components/Timeline/constants'
```

追加：

```ts
export interface PasteRemapArgs {
  currentComposition: Composition
  targetTime: number
  validActionIds: Set<number>
}

export interface PasteResult {
  damageEvents: Omit<DamageEvent, 'id'>[]
  castEvents: Omit<CastEvent, 'id'>[]
  annotations: Omit<Annotation, 'id'>[]
  skipped: number
}

/** 反序列化 + 职业映射 + 时间平移；落不了位的 cast/skillTrack 注释跳过并计数 */
export function remapClipboardForPaste(
  payload: TimelineClipboard,
  args: PasteRemapArgs
): PasteResult {
  const { currentComposition, targetTime, validActionIds } = args
  const hydrated = hydrateFromV2(payload.v2) // 新 id、composition、注释锚定
  const map = buildPlayerIdMap(hydrated.composition, currentComposition)

  // baseTime：所有 hydrate 出对象（含将被跳过的）的时间最小值，保证相对间距
  const allTimes = [
    ...hydrated.damageEvents.map(e => e.time),
    ...hydrated.castEvents.map(c => c.timestamp),
    ...(hydrated.annotations ?? []).map(a => a.time),
  ]
  if (allTimes.length === 0) {
    return { damageEvents: [], castEvents: [], annotations: [], skipped: 0 }
  }
  const baseTime = Math.min(...allTimes)
  const shift = (t: number) => targetTime + (t - baseTime)

  let skipped = 0

  const damageEvents: Omit<DamageEvent, 'id'>[] = hydrated.damageEvents.map(e => {
    const { id: _id, ...rest } = e
    return { ...rest, time: Math.max(0, shift(e.time)) }
  })

  const castEvents: Omit<CastEvent, 'id'>[] = []
  for (const c of hydrated.castEvents) {
    const mapped = map.get(c.playerId)
    if (mapped === undefined || !validActionIds.has(c.actionId)) {
      skipped++
      continue
    }
    const { id: _id, ...rest } = c
    castEvents.push({
      ...rest,
      playerId: mapped,
      timestamp: Math.max(TIMELINE_START_TIME, shift(c.timestamp)),
    })
  }

  const annotations: Omit<Annotation, 'id'>[] = []
  for (const a of hydrated.annotations ?? []) {
    if (a.anchor.type === 'skillTrack') {
      const mapped = map.get(a.anchor.playerId)
      if (mapped === undefined) {
        skipped++
        continue
      }
      const { id: _id, ...rest } = a
      annotations.push({
        ...rest,
        time: Math.max(TIMELINE_START_TIME, shift(a.time)),
        anchor: { ...a.anchor, playerId: mapped },
      })
    } else {
      const { id: _id, ...rest } = a
      annotations.push({ ...rest, time: Math.max(TIMELINE_START_TIME, shift(a.time)) })
    }
  }

  return { damageEvents, castEvents, annotations, skipped }
}
```

> `hydrateFromV2` 把 playerId 归一为「职业槽位索引」，故同页粘贴也需经 `buildPlayerIdMap` 落回真实 playerId（职业相同即一一落回）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/utils/timelineClipboard`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/timelineClipboard.ts src/utils/timelineClipboard.test.ts
git commit -m "feat(timeline): paste remap via V2 hydrate + job mapping"
```

---

## Task 8: awareness selection 升级为数组 + 消费端

**Files:**

- Modify: `src/collab/awarenessTypes.ts`
- Modify: `src/store/timelineStore.ts`（awareness 初始化 line ~323）
- Modify: `src/components/Timeline/index.tsx`、`src/components/Timeline/SkillTracksCanvas.tsx`、`src/components/Timeline/useSmoothedPeers.ts`（凡读 `selection.eventId`/`selection.castEventId` 处）

- [ ] **Step 1: 先定位所有消费端**

Run: `grep -rn "selection.eventId\|selection.castEventId\|\.selection\b" src/`
记录每个读取点。

- [ ] **Step 2: 改类型**

`awarenessTypes.ts` 第 19 行：

```ts
  /** 当前选中的对象 id 列表；未选中为空数组 */
  selection: { eventIds: string[]; castEventIds: string[]; annotationIds: string[] }
```

- [ ] **Step 3: 改写入端**

`timelineStore.ts` line ~323（`openTimeline` 内 awareness 初始化）：

```ts
engine.awareness.setLocalStateField('selection', {
  eventIds: [],
  castEventIds: [],
  annotationIds: [],
})
```

（`setSelection` 已在 Task 2 写入数组形态，无需再改。）

- [ ] **Step 4: 改消费端**

对 Step 1 找到的每个读取点，把 `peer.selection.eventId === id` 改为 `peer.selection.eventIds.includes(id)`，`castEventId` 同理；若有渲染单个 peer 选中高亮的逻辑，改为遍历数组。`useSmoothedPeers.ts` 若只平滑 `cursorTime`/`dragging` 不碰 `selection` 则无需改（按 Step 1 结果定）。

- [ ] **Step 5: 类型与构建兜底**

Run: `pnpm exec tsc --noEmit`
Expected: 0 error（所有 `selection` 旧字段引用都已改完）

Run: `pnpm test:run src/store/timelineStore`
Expected: PASS（确认 awareness 改动未破坏 store 测试）

- [ ] **Step 6: Commit**

```bash
git add src/collab/awarenessTypes.ts src/store/timelineStore.ts src/components/Timeline/
git commit -m "feat(collab): broadcast multi-selection via awareness arrays"
```

---

## Task 9: 工具栏 拖动/框选 模式切换

**Files:**

- Modify: `src/components/EditorToolbar.tsx`

- [ ] **Step 1: 实现**

在 `EditorToolbar.tsx` 顶部 import 加（lucide 图标）：

```ts
import { MousePointer2, BoxSelect } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
```

组件内读取：

```ts
const canvasTool = useUIStore(s => s.canvasTool)
const setCanvasTool = useUIStore(s => s.setCanvasTool)
```

在缩放滑块附近、仅 timeline 视图渲染（参考现有「缩放滑块在表格模式 disabled」的判断 `viewMode`/`isReadOnly`），加一组二态切换（沿用项目既有的 Button/ToggleGroup 写法；下例用两个 Button）：

```tsx
{
  viewMode !== 'table' && !isReadOnly && (
    <div className="flex items-center gap-1">
      <Button
        variant={canvasTool === 'pan' ? 'secondary' : 'ghost'}
        size="icon"
        title="拖动平移"
        onClick={() => setCanvasTool('pan')}
      >
        <MousePointer2 className="h-4 w-4" />
      </Button>
      <Button
        variant={canvasTool === 'select' ? 'secondary' : 'ghost'}
        size="icon"
        title="框选"
        onClick={() => setCanvasTool('select')}
      >
        <BoxSelect className="h-4 w-4" />
      </Button>
    </div>
  )
}
```

> `viewMode` / `isReadOnly` 用 `EditorToolbar` 现有的同名来源（若 props 未透传，按文件现状读取；参考缩放滑块 disabled 的判定写法）。

- [ ] **Step 2: 验证**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 0 error

手动（用户已开 `pnpm dev`）：打开时间轴编辑器，工具栏出现两个图标按钮，点击可切换高亮；表格视图 / 只读模式下不显示。

- [ ] **Step 3: Commit**

```bash
git add src/components/EditorToolbar.tsx
git commit -m "feat(timeline): add pan/select tool toggle in toolbar"
```

---

## Task 10: 框选相交判定（纯函数）

**Files:**

- Create: `src/components/Timeline/marqueeHitTest.ts`
- Create: `src/components/Timeline/marqueeHitTest.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { computeMarqueeSelection } from './marqueeHitTest'
import type { MarqueeObject } from './marqueeHitTest'

const objs: MarqueeObject[] = [
  { id: 'd1', kind: 'damage', x0: 100, x1: 140, y0: 0, y1: 40 },
  { id: 'c1', kind: 'cast', x0: 200, x1: 230, y0: 120, y1: 150 },
  { id: 'a1', kind: 'annotation', x0: 300, x1: 320, y0: 120, y1: 150 },
]

describe('computeMarqueeSelection', () => {
  it('相交即选中（碰到就选）', () => {
    const r = computeMarqueeSelection(objs, { x0: 130, y0: 10, x1: 210, y1: 130 }, false)
    expect(r.eventIds).toEqual(['d1'])
    expect(r.castEventIds).toEqual(['c1'])
    expect(r.annotationIds).toEqual([])
  })

  it('无限高度：忽略 y，只比时间(x)范围', () => {
    const r = computeMarqueeSelection(objs, { x0: 90, y0: 999, x1: 320, y1: 1000 }, true)
    expect(r.eventIds).toEqual(['d1'])
    expect(r.castEventIds).toEqual(['c1'])
    expect(r.annotationIds).toEqual(['a1'])
  })

  it('选框归一化（起点可在终点右下）', () => {
    const r = computeMarqueeSelection(objs, { x0: 210, y0: 130, x1: 130, y1: 10 }, false)
    expect(r.eventIds).toEqual(['d1'])
    expect(r.castEventIds).toEqual(['c1'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/components/Timeline/marqueeHitTest`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
/** 框选相交判定 —— 纯函数，坐标统一为画布容器屏幕坐标 */
export interface MarqueeBox {
  x0: number
  y0: number
  x1: number
  y1: number
}
export interface MarqueeObject {
  id: string
  kind: 'damage' | 'cast' | 'annotation'
  x0: number
  x1: number
  y0: number
  y1: number
}
export interface MarqueeSelection {
  eventIds: string[]
  castEventIds: string[]
  annotationIds: string[]
}

/**
 * @param infiniteHeight 标尺区拖动时为 true：忽略 y，只按时间(x)范围相交
 */
export function computeMarqueeSelection(
  objs: MarqueeObject[],
  box: MarqueeBox,
  infiniteHeight: boolean
): MarqueeSelection {
  const bx0 = Math.min(box.x0, box.x1)
  const bx1 = Math.max(box.x0, box.x1)
  const by0 = Math.min(box.y0, box.y1)
  const by1 = Math.max(box.y0, box.y1)
  const out: MarqueeSelection = { eventIds: [], castEventIds: [], annotationIds: [] }
  for (const o of objs) {
    const xHit = o.x1 >= bx0 && o.x0 <= bx1
    const yHit = infiniteHeight || (o.y1 >= by0 && o.y0 <= by1)
    if (xHit && yHit) {
      if (o.kind === 'damage') out.eventIds.push(o.id)
      else if (o.kind === 'cast') out.castEventIds.push(o.id)
      else out.annotationIds.push(o.id)
    }
  }
  return out
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/components/Timeline/marqueeHitTest`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/Timeline/marqueeHitTest.ts src/components/Timeline/marqueeHitTest.test.ts
git commit -m "feat(timeline): marquee intersection hit-test pure fn"
```

---

## Task 11: 框选交互接线（overlay + 标尺无限高度 + 平移让位）

**Files:**

- Create: `src/components/Timeline/useMarqueeSelection.ts`
- Modify: `src/components/Timeline/useTimelinePanZoom.ts`
- Modify: `src/components/Timeline/index.tsx`

> 本任务为画布交互核心，无单测，靠 `pnpm dev` 手动验证 + tsc/lint 兜底。框选用一个 CSS 绝对定位的虚线 `<div>` overlay（覆盖整个画布容器），避免跨两个 Konva Stage 的复杂度；hit-test 用 Task 10 的纯函数，坐标统一到「容器屏幕坐标」。

- [ ] **Step 1: 平移让位**

`useTimelinePanZoom.ts`：给 hook 入参加 `canvasTool: 'pan' | 'select'` 与 `rulerHeight: number`（标尺像素高度，来自 index.tsx 布局常量）。在其 pointerdown 处理最前面加早退：

```ts
// select 模式、或起点落在顶部时间标尺带内 → 交给框选，不平移
const localY = pointerY // 该 stage 容器内的 y
const onRuler = localY <= rulerHeight
if (canvasTool === 'select' || onRuler) return
```

> `pointerY`/`rulerHeight` 用该文件已有的指针坐标与 index.tsx 传入的标尺高度。pan 模式非标尺区行为保持不变。

- [ ] **Step 2: useMarqueeSelection hook**

```ts
import { useCallback, useRef, useState } from 'react'
import { computeMarqueeSelection, type MarqueeObject } from './marqueeHitTest'
import { useTimelineStore } from '@/store/timelineStore'

interface Args {
  /** 标尺带高度（容器内 y <= 此值 ⇒ 无限高度框选） */
  rulerHeight: number
  /** 实时构造当前所有对象的屏幕坐标盒（由 index.tsx 按布局算） */
  buildObjects: () => MarqueeObject[]
}

export interface MarqueeRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function useMarqueeSelection({ rulerHeight, buildObjects }: Args) {
  const [rect, setRect] = useState<MarqueeRect | null>(null)
  const startRef = useRef<{ x: number; y: number; infinite: boolean; additive: boolean } | null>(
    null
  )

  const onPointerDown = useCallback(
    (containerX: number, containerY: number, shiftKey: boolean) => {
      startRef.current = {
        x: containerX,
        y: containerY,
        infinite: containerY <= rulerHeight,
        additive: shiftKey,
      }
      setRect({ x0: containerX, y0: containerY, x1: containerX, y1: containerY })
    },
    [rulerHeight]
  )

  const onPointerMove = useCallback((containerX: number, containerY: number) => {
    if (!startRef.current) return
    setRect(r => (r ? { ...r, x1: containerX, y1: containerY } : null))
  }, [])

  const onPointerUp = useCallback(() => {
    const start = startRef.current
    startRef.current = null
    setRect(cur => {
      if (start && cur) {
        const sel = computeMarqueeSelection(buildObjects(), cur, start.infinite)
        const store = useTimelineStore.getState()
        if (start.additive) store.addToSelection(sel)
        else store.setSelection(sel)
      }
      return null
    })
  }, [buildObjects])

  return { rect, onPointerDown, onPointerMove, onPointerUp, active: rect !== null }
}
```

- [ ] **Step 3: index.tsx 接线**

3a. 读 `canvasTool`：`const canvasTool = useUIStore(s => s.canvasTool)`，传入 `useTimelinePanZoom({ ..., canvasTool, rulerHeight })`。

3b. 实现 `buildObjects(): MarqueeObject[]`——遍历 `timeline.damageEvents`/`castEvents`/`annotations`，按**与渲染相同的 x/y 公式**算屏幕盒：

- x：`x0 = time * zoomLevel - scrollLeft (+ 容器左偏移)`，`x1 = x0 + 卡片/图标宽度`。
- 伤害事件 / `damageTrack` 注释 y：顶部固定区伤害带的屏幕 y（不随 `scrollTop`）。
- 技能 cast / `skillTrack` 注释 y：`headerHeight + row(playerId,actionId)*rowHeight - scrollTop`。
  > 复用 index.tsx / `SkillTracksCanvas` 既有的「行 y / 卡片宽」布局值（搜索现有 `rowHeight`、伤害带 yOffset、`row` 计算处）。注释按 `anchor` 决定归属哪一区。

3c. `useMarqueeSelection({ rulerHeight, buildObjects })`；把指针事件接到画布容器：在最外层容器 `onPointerDown` 时，若 `canvasTool === 'select' || y <= rulerHeight`，调用 `marquee.onPointerDown(x, y, e.shiftKey)` 并 `window.addEventListener('pointermove'/'pointerup')` 驱动 move/up（参考 `useTimelinePanZoom` 既有的 window 监听写法）。坐标用 `e.clientX/Y - containerRect.left/top`。

3d. 渲染虚线 overlay（容器内绝对定位 div）：

```tsx
{
  marquee.rect && (
    <div
      className="pointer-events-none absolute z-20 border border-dashed border-primary bg-primary/10"
      style={{
        left: Math.min(marquee.rect.x0, marquee.rect.x1),
        top: marquee.rect.infinite ? 0 : Math.min(marquee.rect.y0, marquee.rect.y1),
        width: Math.abs(marquee.rect.x1 - marquee.rect.x0),
        height: marquee.rect.infinite ? '100%' : Math.abs(marquee.rect.y1 - marquee.rect.y0),
      }}
    />
  )
}
```

> `infinite` 标记：rect 上没有该字段，用 `marquee` 暴露的 `active` + 起点是否在标尺带判定；可在 hook 的 `rect` 里补 `infinite` 字段一并返回（推荐：给 `MarqueeRect` 加 `infinite: boolean`，`onPointerDown` 时写入）。

- [ ] **Step 4: 验证**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 0 error

手动验证：

1. 工具切到「框选」，在空白处拖动出现虚线框，松手选中框内伤害事件 + 技能（高亮，Task 12 后更明显）。
2. pan 模式下空白拖动仍平移；但在顶部时间标尺处拖动出现「全高度」虚线框，松手选中该时间范围内所有对象。
3. Shift + 拖框 = 叠加到已有选择。

- [ ] **Step 5: Commit**

```bash
git add src/components/Timeline/useMarqueeSelection.ts src/components/Timeline/useTimelinePanZoom.ts src/components/Timeline/index.tsx
git commit -m "feat(timeline): marquee selection overlay with ruler infinite-height"
```

---

## Task 12: 多选高亮 + 群组拖动

**Files:**

- Modify: `src/components/Timeline/index.tsx`（对象渲染的 `isSelected`、drag end 处理）

- [ ] **Step 1: 多选高亮**

把渲染 `DamageEventCard` 处的 `isSelected={selectedEventId === event.id}` 改为 `isSelected={selectedEventIds.includes(event.id)}`（`selectedEventIds = useTimelineStore(s => s.selectedEventIds)`）；`CastEventIcon` 同理用 `selectedCastEventIds.includes(cast.id)`；注释渲染处用 `selectedAnnotationIds.includes(a.id)`（若注释组件有选中态样式）。`draggable` 仍 `={isSelected}`，故多选项均可作为拖动抓手。

- [ ] **Step 2: 群组拖动（在 dragEnd 提交整体 delta）**

`handleEventDragEnd`（line ~836）：

```ts
const newTime = Math.max(TIMELINE_START_TIME, Math.round((x / zoomLevel) * 10) / 10)
const s = useTimelineStore.getState()
const totalSelected =
  s.selectedEventIds.length + s.selectedCastEventIds.length + s.selectedAnnotationIds.length
if (totalSelected > 1 && s.selectedEventIds.includes(eventId)) {
  const orig = timeline?.damageEvents.find(e => e.id === eventId)?.time ?? newTime
  s.bulkMoveSelection(newTime - orig) // 整体等距平移
} else {
  updateDamageEvent(eventId, { time: newTime }) // 既有单体逻辑
}
```

`handleCastEventDragEnd`（line ~910）：在计算出 `newTime` 后同样分支：

```ts
const s = useTimelineStore.getState()
const totalSelected =
  s.selectedEventIds.length + s.selectedCastEventIds.length + s.selectedAnnotationIds.length
if (totalSelected > 1 && s.selectedCastEventIds.includes(castEventId)) {
  const orig = timeline?.castEvents.find(c => c.id === castEventId)?.timestamp ?? newTime
  s.bulkMoveSelection(newTime - orig)
} else {
  // 既有单体逻辑（含 engine.pickUniqueMember 变体切换）保持不变
  updateCastEvent(castEventId, { timestamp: newTime, actionId })
}
```

> 群组拖动时不走 cast 的变体切换 / dragBound 合法夹紧——与第 3 节「整体平移、允许非法」一致。

- [ ] **Step 3:（可选增强）拖动中实时同步其余节点**

在被拖动节点 `onDragMove` 里命令式 `node.x(...)` 同步其余选中节点的 x（沿用本项目「拖动期间直接操作 Konva 节点」风格）。成本高可跳过——降级为「抓取项跟手、其余在松手时按 delta 归位」，功能完整。

- [ ] **Step 4: 验证**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 0 error

手动：框选多个对象 → 高亮；拖动其中一个 → 松手后所有选中对象整体平移同一时间量；单选拖动行为不变；选中数==1 时 `PropertyPanel` 仍正常弹出，>1 时不弹。

- [ ] **Step 5: Commit**

```bash
git add src/components/Timeline/index.tsx
git commit -m "feat(timeline): multi-select highlight and group drag"
```

---

## Task 13: 右键菜单 multiSelection 变体 + 粘贴可用探测

**Files:**

- Modify: `src/components/Timeline/TimelineContextMenu.tsx`
- Modify: `src/components/Timeline/index.tsx`（菜单状态判定 + 粘贴探测）

- [ ] **Step 1: 菜单类型与渲染**

`TimelineContextMenu.tsx` 的 `ContextMenuState` 联合（line ~17）加变体：

```ts
  | { type: 'multiSelection'; count: number }
```

props 加回调：

```ts
  onCopySelection: () => void
  onDeleteSelection: () => void
  /** 粘贴可用性：'checking' | true | false；用于空白菜单的粘贴项置灰 */
  pasteAvailable?: 'checking' | boolean
  onPasteSelection?: (time: number) => void
```

渲染区按 `menu.type === 'multiSelection'` 输出两项：

```tsx
{
  menu.type === 'multiSelection' && (
    <>
      <MenuItem
        onClick={() => {
          onCopySelection()
          close()
        }}
      >
        复制（{menu.count} 项）
      </MenuItem>
      <MenuItem
        onClick={() => {
          onDeleteSelection()
          close()
        }}
      >
        删除（{menu.count} 项）
      </MenuItem>
    </>
  )
}
```

> `MenuItem`/`close` 用本文件既有菜单项写法（参考现有 `damageEvent` 分支）。

`damageTrackEmpty` / `skillTrackEmpty` 分支里把「粘贴」项改为受 `pasteAvailable` 控制：

```tsx
<MenuItem
  disabled={pasteAvailable !== true}
  onClick={() => {
    onPasteSelection?.(menu.time)
    close()
  }}
>
  粘贴{pasteAvailable === 'checking' ? '…' : ''}
</MenuItem>
```

- [ ] **Step 2: index.tsx 菜单状态判定**

右键命中对象时（`handleContextMenu` 等处）：若该对象属于当前多选且总选中数 > 1，则 `setContextMenu({ type: 'multiSelection', count: totalSelected })`，否则维持现状单对象菜单。

- [ ] **Step 3: 粘贴探测**

菜单打开（`damageTrackEmpty`/`skillTrackEmpty`）时启动异步探测，存本地 state `pasteAvailable`：

```ts
const [pasteAvailable, setPasteAvailable] = useState<'checking' | boolean>(false)
const probePaste = useCallback(async () => {
  setPasteAvailable('checking')
  try {
    const items = await navigator.clipboard.read()
    setPasteAvailable(items.some(it => it.types.includes(CLIPBOARD_MIME)))
  } catch {
    setPasteAvailable(false)
  }
}, [])
```

在打开空白菜单的地方调用 `probePaste()`。`CLIPBOARD_MIME` 从 `@/utils/timelineClipboard` 导入。

- [ ] **Step 4: 验证**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 0 error

手动：多选后右键某选中项 → 菜单只有「复制（N 项）/删除（N 项）」；删除生效；空白处右键 → 「粘贴」在剪贴板含本格式时可点、否则置灰（首次可能弹剪贴板读取授权 / Safari 粘贴按钮，符合预期）。

- [ ] **Step 5: Commit**

```bash
git add src/components/Timeline/TimelineContextMenu.tsx src/components/Timeline/index.tsx
git commit -m "feat(timeline): multi-selection context menu + paste availability probe"
```

---

## Task 14: 复制粘贴 glue（系统剪贴板 + 热键）

**Files:**

- Modify: `src/components/Timeline/index.tsx`

> 串起 Task 6/7 纯逻辑与 Task 13 回调；替换既有单事件 `clipboard` state 与 `mod+c`/`mod+v` 处理。

- [ ] **Step 1: copySelection**

```ts
import {
  CLIPBOARD_MIME,
  buildClipboardPayload,
  parseClipboardPayload,
  remapClipboardForPaste,
} from '@/utils/timelineClipboard'
import { useMitigationStore } from '@/store/mitigationStore'

const copySelection = useCallback(async () => {
  const s = useTimelineStore.getState()
  if (!s.timeline) return
  const total =
    s.selectedEventIds.length + s.selectedCastEventIds.length + s.selectedAnnotationIds.length
  if (total === 0) return
  const payload = buildClipboardPayload(s.timeline, {
    eventIds: s.selectedEventIds,
    castEventIds: s.selectedCastEventIds,
    annotationIds: s.selectedAnnotationIds,
  })
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: CLIPBOARD_MIME })
    await navigator.clipboard.write([new ClipboardItem({ [CLIPBOARD_MIME]: blob })])
    toast.success(`已复制 ${total} 个对象`)
  } catch {
    toast.error('复制失败：当前浏览器不支持写入剪贴板')
  }
}, [])
```

- [ ] **Step 2: pasteAtTime**

```ts
const pasteAtTime = useCallback(async (targetTime: number) => {
  let text: string | null = null
  try {
    const items = await navigator.clipboard.read()
    const item = items.find(it => it.types.includes(CLIPBOARD_MIME))
    if (item) text = await (await item.getType(CLIPBOARD_MIME)).text()
  } catch {
    /* 无权限/不支持 */
  }
  const payload = text ? parseClipboardPayload(text) : null
  if (!payload) {
    toast.error('剪贴板没有可粘贴的时间轴对象')
    return
  }
  const validActionIds = new Set(useMitigationStore.getState().actions.map(a => a.id))
  const result = remapClipboardForPaste(payload, {
    currentComposition: useTimelineStore.getState().timeline!.composition,
    targetTime,
    validActionIds,
  })
  useTimelineStore.getState().pasteObjects({
    damageEvents: result.damageEvents,
    castEvents: result.castEvents,
    annotations: result.annotations,
  })
  if (result.skipped > 0) toast.warning(`已粘贴，跳过 ${result.skipped} 个无法落位的对象`)
  else toast.success('已粘贴')
}, [])
```

> `useMitigationStore.getState().actions` 用与 `ImportIntoTimelineDialog` 校验 cast 相同的来源；若字段名不同，按该对话框实际读取处对齐。

- [ ] **Step 3: 热键**

替换既有 `mod+c`（line ~735）与 `mod+v`（line ~746）处理：

```ts
useHotkeys(
  'mod+c',
  () => {
    void copySelection()
  },
  { enabled: !isReadOnly },
  [copySelection]
)
useHotkeys(
  'mod+v',
  () => {
    const t =
      hoverTimeRef.current ?? (clampedScrollRef.current.scrollLeft + viewportWidth / 2) / zoomLevel
    void pasteAtTime(Math.round(t * 10) / 10)
  },
  { enabled: !isReadOnly, preventDefault: true },
  [pasteAtTime, viewportWidth, zoomLevel]
)
```

更新删除热键（line ~717）：多选优先：

```ts
useHotkeys(
  'delete, backspace',
  () => {
    const s = useTimelineStore.getState()
    const total =
      s.selectedEventIds.length + s.selectedCastEventIds.length + s.selectedAnnotationIds.length
    if (total > 0) {
      s.bulkDeleteSelection()
      return
    }
    if (pinnedAnnotationId) {
      removeAnnotation(pinnedAnnotationId)
      setPinnedAnnotationId(null)
    }
  },
  { enabled: !isReadOnly },
  [pinnedAnnotationId]
)
```

> 移除旧的单事件 `clipboard` useState 与 `handleContextMenuCopyDamageEvent`/`handleContextMenuPasteDamageEvent`（line ~105、674–699）；其引用改为 `copySelection`/`pasteAtTime`。伤害事件专属的「复制文本」(`navigator.clipboard.writeText`) 保留不动。

- [ ] **Step 4: 接 Task 13 回调**

`<TimelineContextMenu>` 渲染（line ~1601）传：

```tsx
onCopySelection={() => void copySelection()}
onDeleteSelection={() => useTimelineStore.getState().bulkDeleteSelection()}
onPasteSelection={(t) => void pasteAtTime(t)}
pasteAvailable={pasteAvailable}
```

移除旧的 `clipboard`/`onCopyDamageEvent`/`onPasteDamageEvent` props（或保留「复制文本」相关，按 Task 13 后的 props 形态对齐）。

- [ ] **Step 5: 验证**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test:run`
Expected: 0 error，全部测试 PASS

手动验证（`pnpm dev`）：

1. 多选 → `Ctrl/Cmd+C` → toast「已复制 N 个对象」；外部文本编辑器粘贴**无内容**（零污染）。
2. `Ctrl/Cmd+V`（或空白右键「粘贴」）→ 以鼠标悬浮时间为锚，最早对象对齐，保留相对间距，新对象被选中。
3. 另开一个不同阵容的时间轴标签页粘贴 → cast 按职业落到对应轨道，缺职业的跳过并 toast 数量。
4. `Delete` → 多选时批量删除；undo 一步还原。

- [ ] **Step 6: Commit**

```bash
git add src/components/Timeline/index.tsx
git commit -m "feat(timeline): batch copy/paste via system clipboard custom format"
```

---

## 自检（计划作者已核对）

- **Spec 覆盖**：需求 1 工具切换→Task 9；矩形/标尺框选→Task 10/11；多选不弹面板→Task 2 派生单选；群组拖动→Task 12；右键只删除（+复制）→Task 13；批量删除/快捷键→Task 4/14；表格模式不动→未触及 TimelineTable；复制粘贴（V2 codec / 职业映射 / 只写自定义格式 / 无回退 / 菜单探测）→Task 6/7/13/14；awareness 广播全部→Task 8。
- **类型一致**：`selectedEventIds/selectedCastEventIds/selectedAnnotationIds`、`SelectionKind`、`SelectionPatch`、`CLIPBOARD_MIME`、`TimelineClipboard`、`remapClipboardForPaste`/`PasteResult`、`computeMarqueeSelection`/`MarqueeObject`/`MarqueeBox`、`canvasTool`/`setCanvasTool` 全程一致。
- **下界**：伤害事件 `≥0`、cast/注释 `≥TIMELINE_START_TIME`，Task 3/7 一致。
- **风险点**：Task 11（跨双 Stage 的对象屏幕坐标 `buildObjects`）需对齐既有渲染布局值，是最需要 `pnpm dev` 迭代的一步；Task 8 消费端需 grep 全量替换。
