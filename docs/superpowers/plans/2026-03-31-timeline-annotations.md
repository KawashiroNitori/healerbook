# Timeline Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to add text annotations at any point on the timeline, anchored to damage or skill tracks, synced to server.

**Architecture:** New `Annotation` type added to `Timeline` data model. Store gets CRUD actions. Canvas renders annotation icons via Konva. HTML Popover overlays Canvas for view/edit. Right-click menu extended for create/delete. Server schema updated for sync.

**Tech Stack:** React, Zustand, Konva (react-konva), Valibot, Cloudflare Workers D1

---

### Task 1: Data Model & Constants

**Files:**

- Modify: `src/types/timeline.ts`
- Modify: `src/constants/limits.ts`

- [ ] **Step 1: Add ANNOTATION_TEXT_MAX_LENGTH constant**

In `src/constants/limits.ts`, add:

```typescript
export const ANNOTATION_TEXT_MAX_LENGTH = 200
```

- [ ] **Step 2: Add Annotation type and update Timeline interface**

In `src/types/timeline.ts`, add after the `CastEvent` interface (around line 188):

```typescript
/**
 * 注释锚定目标
 */
export type AnnotationAnchor =
  | { type: 'damageTrack' }
  | { type: 'skillTrack'; playerId: number; actionId: number }

/**
 * 注释
 */
export interface Annotation {
  /** 注释 ID */
  id: string
  /** 注释文本（最大 200 字符，允许换行） */
  text: string
  /** 锚定时间（秒） */
  time: number
  /** 锚定目标 */
  anchor: AnnotationAnchor
}
```

In the `Timeline` interface, add after `statusEvents`:

```typescript
  /** 注释列表 */
  annotations: Annotation[]
```

- [ ] **Step 3: Commit**

```bash
git add src/types/timeline.ts src/constants/limits.ts
git commit -m "feat: 添加 Annotation 类型定义和文本长度常量"
```

---

### Task 2: Store CRUD Actions

**Files:**

- Modify: `src/store/timelineStore.ts`
- Test: `src/store/timelineStore.test.ts`

- [ ] **Step 1: Write failing tests for annotation CRUD**

In `src/store/timelineStore.test.ts`, add a new describe block after the existing tests. The `mockTimeline` in the undo/redo block (line 129) already has the right shape — add `annotations: []` to both `mockTimeline` definitions in the file.

```typescript
describe('annotation CRUD', () => {
  const mockComposition: Composition = {
    players: [
      { id: 1, job: 'PLD' },
      { id: 2, job: 'WHM' },
    ],
  }

  const mockTimeline: Timeline = {
    id: 'test-annotations',
    name: '测试注释',
    encounter: {
      id: 1,
      name: '绝龙诗',
      displayName: '绝龙诗',
      zone: 'Ultimate',
      damageEvents: [],
    },
    composition: mockComposition,
    damageEvents: [],
    castEvents: [],
    statusEvents: [],
    annotations: [],
    createdAt: 1000,
    updatedAt: 1000,
  }

  beforeEach(() => {
    useTimelineStore.getState().reset()
    useTimelineStore.temporal.getState().clear()
  })

  it('addAnnotation 应该添加注释', () => {
    const store = useTimelineStore.getState()
    store.setTimeline(mockTimeline)

    store.addAnnotation({
      id: 'ann-1',
      text: '注意减伤',
      time: 10,
      anchor: { type: 'damageTrack' },
    })

    const annotations = useTimelineStore.getState().timeline!.annotations
    expect(annotations).toHaveLength(1)
    expect(annotations[0].id).toBe('ann-1')
    expect(annotations[0].text).toBe('注意减伤')
  })

  it('updateAnnotation 应该更新注释文本', () => {
    const store = useTimelineStore.getState()
    store.setTimeline({
      ...mockTimeline,
      annotations: [{ id: 'ann-1', text: '旧文本', time: 10, anchor: { type: 'damageTrack' } }],
    })

    store.updateAnnotation('ann-1', { text: '新文本' })

    const annotation = useTimelineStore.getState().timeline!.annotations[0]
    expect(annotation.text).toBe('新文本')
    expect(annotation.time).toBe(10) // time unchanged
  })

  it('removeAnnotation 应该删除注释', () => {
    const store = useTimelineStore.getState()
    store.setTimeline({
      ...mockTimeline,
      annotations: [{ id: 'ann-1', text: '测试', time: 10, anchor: { type: 'damageTrack' } }],
    })

    store.removeAnnotation('ann-1')
    expect(useTimelineStore.getState().timeline!.annotations).toHaveLength(0)
  })

  it('updateComposition 应该过滤掉不在新阵容中的 skillTrack 注释', () => {
    const store = useTimelineStore.getState()
    store.setTimeline({
      ...mockTimeline,
      annotations: [
        {
          id: 'ann-1',
          text: '坦克注释',
          time: 10,
          anchor: { type: 'skillTrack', playerId: 1, actionId: 100 },
        },
        {
          id: 'ann-2',
          text: '治疗注释',
          time: 20,
          anchor: { type: 'skillTrack', playerId: 2, actionId: 200 },
        },
        { id: 'ann-3', text: '伤害注释', time: 30, anchor: { type: 'damageTrack' } },
      ],
    })

    // 移除 PLD (playerId: 1)
    store.updateComposition({ players: [{ id: 2, job: 'WHM' }] })

    const annotations = useTimelineStore.getState().timeline!.annotations
    expect(annotations).toHaveLength(2)
    expect(annotations.map(a => a.id)).toEqual(['ann-2', 'ann-3'])
  })

  it('addAnnotation 应该支持撤销/重做', () => {
    const store = useTimelineStore.getState()
    store.setTimeline(mockTimeline)

    store.addAnnotation({
      id: 'ann-1',
      text: '测试撤销',
      time: 10,
      anchor: { type: 'damageTrack' },
    })
    expect(useTimelineStore.getState().timeline!.annotations).toHaveLength(1)

    useTimelineStore.temporal.getState().undo()
    expect(useTimelineStore.getState().timeline!.annotations).toHaveLength(0)

    useTimelineStore.temporal.getState().redo()
    expect(useTimelineStore.getState().timeline!.annotations).toHaveLength(1)
  })
})
```

Also add `annotations: []` to the existing `mockTimeline` definitions so they conform to the updated `Timeline` type — the one at line 22 and the one at line 129.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run src/store/timelineStore.test.ts`
Expected: Compilation errors — `annotations` not in `Timeline`, `addAnnotation`/`updateAnnotation`/`removeAnnotation` not in store.

- [ ] **Step 3: Implement store actions**

In `src/store/timelineStore.ts`:

Add the import for `Annotation`:

```typescript
import type { Timeline, DamageEvent, CastEvent, Composition, Annotation } from '@/types/timeline'
```

Add to the `TimelineState` interface (after `removeCastEvent`):

```typescript
  /** 添加注释 */
  addAnnotation: (annotation: Annotation) => void
  /** 更新注释 */
  updateAnnotation: (id: string, updates: Partial<Pick<Annotation, 'text' | 'time'>>) => void
  /** 删除注释 */
  removeAnnotation: (id: string) => void
```

Add implementations inside the `create` callback (after `removeCastEvent` implementation):

```typescript
      addAnnotation: annotation => {
        set(state => {
          if (!state.timeline) return state
          return {
            timeline: {
              ...state.timeline,
              annotations: [...state.timeline.annotations, annotation],
            },
          }
        })
        get().triggerAutoSave()
      },

      updateAnnotation: (id, updates) => {
        set(state => {
          if (!state.timeline) return state
          return {
            timeline: {
              ...state.timeline,
              annotations: state.timeline.annotations.map(a =>
                a.id === id ? { ...a, ...updates } : a
              ),
            },
          }
        })
        get().triggerAutoSave()
      },

      removeAnnotation: id => {
        set(state => {
          if (!state.timeline) return state
          return {
            timeline: {
              ...state.timeline,
              annotations: state.timeline.annotations.filter(a => a.id !== id),
            },
          }
        })
        get().triggerAutoSave()
      },
```

In `updateComposition`, add annotation filtering after the `filteredCastEvents` logic:

```typescript
// 过滤掉不在新阵容中的 skillTrack 注释
const filteredAnnotations = (state.timeline.annotations ?? []).filter(
  a => a.anchor.type !== 'skillTrack' || newPlayerIds.includes(a.anchor.playerId)
)
```

And include `annotations: filteredAnnotations` in the returned timeline object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/store/timelineStore.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "feat: 添加注释 CRUD store actions 及测试"
```

---

### Task 3: Server Schema & API Sync

**Files:**

- Modify: `src/workers/timelineSchema.ts`
- Modify: `src/api/timelineShareApi.ts`
- Test: `src/workers/timelines.test.ts`

- [ ] **Step 1: Write failing test for annotation validation**

In `src/workers/timelines.test.ts`, find the existing POST test and add a new test that includes annotations in the timeline payload. Add to the describe block for POST tests:

```typescript
it('POST 应该接受包含 annotations 的时间轴', async () => {
  const body = {
    timeline: {
      ...validTimelinePayload,
      annotations: [
        { id: 'ann-1', text: '注意', time: 10, anchor: { type: 'damageTrack' } },
        {
          id: 'ann-2',
          text: '减伤',
          time: 20,
          anchor: { type: 'skillTrack', playerId: 1, actionId: 100 },
        },
      ],
    },
  }

  const res = await handleTimelines(
    new Request('https://x/api/timelines', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}` },
      body: JSON.stringify(body),
    }),
    env,
    '/api/timelines'
  )

  expect(res.status).toBe(201)
})

it('POST 应该拒绝注释文本超过 200 字符', async () => {
  const body = {
    timeline: {
      ...validTimelinePayload,
      annotations: [
        { id: 'ann-1', text: 'a'.repeat(201), time: 10, anchor: { type: 'damageTrack' } },
      ],
    },
  }

  const res = await handleTimelines(
    new Request('https://x/api/timelines', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}` },
      body: JSON.stringify(body),
    }),
    env,
    '/api/timelines'
  )

  expect(res.status).toBe(400)
})
```

Note: You need to find the existing `validTimelinePayload` and `validToken` / `env` setup in the test file to place these tests correctly. Read the full test file first.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run src/workers/timelines.test.ts`
Expected: First test may pass (if `v.object` strips unknown keys) or fail. Second test should pass incorrectly (200 char text passes without validation).

- [ ] **Step 3: Add Valibot annotation schema**

In `src/workers/timelineSchema.ts`, add the import for the new constant:

```typescript
import {
  TIMELINE_NAME_MAX_LENGTH,
  TIMELINE_DESCRIPTION_MAX_LENGTH,
  DAMAGE_EVENT_NAME_MAX_LENGTH,
  ANNOTATION_TEXT_MAX_LENGTH,
} from '@/constants/limits'
```

Add before `TimelineSchema`:

```typescript
const AnnotationAnchorSchema = v.variant('type', [
  v.object({ type: v.literal('damageTrack') }),
  v.object({
    type: v.literal('skillTrack'),
    playerId: v.number(),
    actionId: v.number(),
  }),
])

const AnnotationSchema = v.object({
  id: v.string(),
  text: v.pipe(v.string(), v.maxLength(ANNOTATION_TEXT_MAX_LENGTH)),
  time: v.number(),
  anchor: AnnotationAnchorSchema,
})
```

In `TimelineSchema`, add after `castEvents`:

```typescript
  annotations: v.optional(v.array(AnnotationSchema)),
```

- [ ] **Step 4: Update API client payload**

In `src/api/timelineShareApi.ts`, add to `UploadPayload` interface:

```typescript
  annotations?: Timeline['annotations']
```

In `buildPayload` function, add after the `castEvents` line:

```typescript
    ...(timeline.annotations?.length ? { annotations: timeline.annotations } : {}),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:run src/workers/timelines.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/workers/timelineSchema.ts src/api/timelineShareApi.ts src/workers/timelines.test.ts
git commit -m "feat: 添加注释 Valibot schema 校验和 API payload 同步"
```

---

### Task 4: Context Menu Extensions

**Files:**

- Modify: `src/components/Timeline/TimelineContextMenu.tsx`
- Modify: `src/components/Timeline/SkillTracksCanvas.tsx`
- Modify: `src/components/Timeline/index.tsx`

- [ ] **Step 1: Extend ContextMenuState with annotation type and playerId**

In `src/components/Timeline/TimelineContextMenu.tsx`, update the `ContextMenuState` type. Add `playerId` to `skillTrackEmpty`, and add an `annotation` variant:

```typescript
export type ContextMenuState =
  | {
      x: number
      y: number
      time: number
      type: 'castEvent'
      castEventId: string
      actionId: number
    }
  | {
      x: number
      y: number
      time: number
      type: 'skillTrackEmpty'
      actionId: number
      playerId: number
    }
  | {
      x: number
      y: number
      time: number
      type: 'damageEvent'
      eventId: string
    }
  | {
      x: number
      y: number
      time: number
      type: 'damageTrackEmpty'
    }
  | {
      x: number
      y: number
      time: number
      type: 'annotation'
      annotationId: string
    }
```

- [ ] **Step 2: Add annotation menu callbacks to TimelineContextMenuProps**

```typescript
interface TimelineContextMenuProps {
  // ... existing props
  onAddAnnotation: (time: number, anchor: AnnotationAnchor) => void
  onDeleteAnnotation: (annotationId: string) => void
}
```

Add import at top:

```typescript
import type { DamageEvent, AnnotationAnchor } from '@/types/timeline'
```

- [ ] **Step 3: Add menu items for annotations**

In the component, destructure the new props and add menu items.

For `skillTrackEmpty`, add "添加注释" after the existing "添加" item:

```typescript
        {menu.type === 'skillTrackEmpty' && (
          <>
            <DropdownMenuItem
              onClick={() => {
                onAddCast(menu.actionId, menu.time)
                onClose()
              }}
            >
              添加
              <DropdownMenuShortcut>
                <MousePointerClick className="size-3" />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                onAddAnnotation(menu.time, { type: 'skillTrack', playerId: menu.playerId, actionId: menu.actionId })
                onClose()
              }}
            >
              添加注释
            </DropdownMenuItem>
          </>
        )}
```

For `damageTrackEmpty`, add "添加注释" after the existing items:

```typescript
            <DropdownMenuItem
              onClick={() => {
                onAddAnnotation(menu.time, { type: 'damageTrack' })
                onClose()
              }}
            >
              添加注释
            </DropdownMenuItem>
```

For `annotation` type, add delete option:

```typescript
        {menu.type === 'annotation' && (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => {
              onDeleteAnnotation(menu.annotationId)
              onClose()
            }}
          >
            删除注释
          </DropdownMenuItem>
        )}
```

Update the read-only guard to also allow `annotation` type through (for viewing — though annotation type won't have visible menu items in read-only, we simply don't render the menu):

```typescript
if (isReadOnly && menu.type !== 'damageEvent') return null
```

This already handles it — `annotation` type won't render any items in read-only mode since the delete item is the only option.

- [ ] **Step 4: Update SkillTracksCanvas to pass playerId in context menu**

In `src/components/Timeline/SkillTracksCanvas.tsx`, update the `onContextMenu` prop type to include `playerId`:

```typescript
  onContextMenu: (
    payload:
      | { type: 'castEvent'; castEventId: string; actionId: number }
      | { type: 'skillTrackEmpty'; actionId: number; playerId: number },
    clientX: number,
    clientY: number,
    time: number
  ) => void
```

Update the background Rect `onContextMenu` handler (around line 121) to include `playerId`:

```typescript
onContextMenu(
  { type: 'skillTrackEmpty', actionId: track.actionId, playerId: track.playerId },
  e.evt.clientX,
  e.evt.clientY,
  time
)
```

- [ ] **Step 5: Update index.tsx handleContextMenu type and add annotation handlers**

In `src/components/Timeline/index.tsx`, update the `handleContextMenu` callback's payload union to include `playerId` and `annotation`:

```typescript
    (
      payload:
        | { type: 'castEvent'; castEventId: string; actionId: number }
        | { type: 'skillTrackEmpty'; actionId: number; playerId: number }
        | { type: 'damageEvent'; eventId: string }
        | { type: 'damageTrackEmpty' }
        | { type: 'annotation'; annotationId: string },
      clientX: number,
      clientY: number,
      time: number
    ) => {
```

Add import for `Annotation` and `AnnotationAnchor`:

```typescript
import type { CastEvent, Annotation, AnnotationAnchor } from '@/types/timeline'
```

Add `addAnnotation` and `removeAnnotation` from store:

```typescript
const {
  // ... existing destructured actions
  addAnnotation,
  removeAnnotation,
} = useTimelineStore()
```

Add state for the annotation popover (we'll wire this up in a later task, but need the callback now):

```typescript
const [editingAnnotation, setEditingAnnotation] = useState<{
  annotation: Annotation | null // null = creating new
  time: number
  anchor: AnnotationAnchor
  screenX: number
  screenY: number
} | null>(null)
```

Add annotation handlers:

```typescript
const handleAddAnnotation = useCallback(
  (time: number, anchor: AnnotationAnchor) => {
    // We need screen position for the popover; use the context menu position
    const menuX = contextMenu?.x ?? 0
    const menuY = contextMenu?.y ?? 0
    setEditingAnnotation({
      annotation: null,
      time,
      anchor,
      screenX: menuX,
      screenY: menuY,
    })
  },
  [contextMenu]
)

const handleDeleteAnnotation = useCallback(
  (annotationId: string) => {
    removeAnnotation(annotationId)
  },
  [removeAnnotation]
)
```

Pass these to `TimelineContextMenu`:

```typescript
      <TimelineContextMenu
        // ... existing props
        onAddAnnotation={handleAddAnnotation}
        onDeleteAnnotation={handleDeleteAnnotation}
      />
```

- [ ] **Step 6: Verify the app compiles**

Run: `pnpm build`
Expected: Build succeeds (the `editingAnnotation` state is unused for now, but that's fine).

- [ ] **Step 7: Commit**

```bash
git add src/components/Timeline/TimelineContextMenu.tsx src/components/Timeline/SkillTracksCanvas.tsx src/components/Timeline/index.tsx
git commit -m "feat: 扩展右键菜单支持添加/删除注释"
```

---

### Task 5: Annotation Icon Konva Component

**Files:**

- Create: `src/components/Timeline/AnnotationIcon.tsx`

- [ ] **Step 1: Create AnnotationIcon component**

Create `src/components/Timeline/AnnotationIcon.tsx`:

```typescript
/**
 * 注释图标 Konva 组件
 */

import { Group, Rect, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'

interface AnnotationIconProps {
  x: number
  y: number
  onMouseEnter: (e: KonvaEventObject<MouseEvent>) => void
  onMouseLeave: () => void
  onClick: (e: KonvaEventObject<MouseEvent>) => void
  onContextMenu: (e: KonvaEventObject<PointerEvent>) => void
}

const ICON_SIZE = 16

export default function AnnotationIcon({
  x,
  y,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onContextMenu,
}: AnnotationIconProps) {
  return (
    <Group
      x={x - ICON_SIZE / 2}
      y={y - ICON_SIZE / 2}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {/* 背景气泡 */}
      <Rect
        width={ICON_SIZE}
        height={ICON_SIZE}
        cornerRadius={3}
        fill="rgba(59, 130, 246, 0.7)"
        shadowEnabled={false}
        perfectDrawEnabled={false}
      />
      {/* 文字符号 */}
      <Text
        x={0}
        y={1}
        width={ICON_SIZE}
        height={ICON_SIZE}
        text="✎"
        fontSize={11}
        fill="white"
        align="center"
        verticalAlign="middle"
        listening={false}
        perfectDrawEnabled={false}
      />
    </Group>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Timeline/AnnotationIcon.tsx
git commit -m "feat: 添加注释图标 Konva 组件"
```

---

### Task 6: Render Annotations on DamageEventTrack

**Files:**

- Modify: `src/components/Timeline/DamageEventTrack.tsx`

- [ ] **Step 1: Add annotation props and render icons**

In `src/components/Timeline/DamageEventTrack.tsx`, add import and props:

```typescript
import AnnotationIcon from './AnnotationIcon'
import type { DamageEvent, Annotation } from '@/types/timeline'
```

Add to `DamageEventTrackProps`:

```typescript
  annotations: Annotation[]
  onAnnotationHover: (annotation: Annotation, screenX: number, screenY: number) => void
  onAnnotationHoverEnd: () => void
  onAnnotationClick: (annotation: Annotation, screenX: number, screenY: number) => void
  onAnnotationContextMenu: (annotationId: string, clientX: number, clientY: number, time: number) => void
```

Destructure these new props in the component function.

Add annotation icon rendering after the damage events (before the closing `</>`):

```typescript
      {/* 注释图标 */}
      {annotations.map(annotation => {
        const x = annotation.time * zoomLevel
        // 放在轨道底部偏上位置
        const annotationY = yOffset + trackHeight - 20

        return (
          <AnnotationIcon
            key={`annotation-${annotation.id}`}
            x={x}
            y={annotationY}
            onMouseEnter={e => {
              const stage = e.target.getStage()
              if (!stage) return
              const box = stage.container().getBoundingClientRect()
              const absPos = e.target.getParent()!.getAbsolutePosition()
              onAnnotationHover(annotation, box.left + absPos.x + 8, box.top + absPos.y)
            }}
            onMouseLeave={onAnnotationHoverEnd}
            onClick={e => {
              const stage = e.target.getStage()
              if (!stage) return
              const box = stage.container().getBoundingClientRect()
              const absPos = e.target.getParent()!.getAbsolutePosition()
              onAnnotationClick(annotation, box.left + absPos.x + 8, box.top + absPos.y)
            }}
            onContextMenu={e => {
              e.evt.preventDefault()
              onAnnotationContextMenu(annotation.id, e.evt.clientX, e.evt.clientY, annotation.time)
            }}
          />
        )
      })}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Timeline/DamageEventTrack.tsx
git commit -m "feat: 在伤害事件轨道渲染注释图标"
```

---

### Task 7: Render Annotations on SkillTracksCanvas

**Files:**

- Modify: `src/components/Timeline/SkillTracksCanvas.tsx`

- [ ] **Step 1: Add annotation props and render icons**

Add import:

```typescript
import AnnotationIcon from './AnnotationIcon'
import type { Annotation } from '@/types/timeline'
```

Add to `SkillTracksCanvasProps`:

```typescript
  annotations: Annotation[]
  onAnnotationHover: (annotation: Annotation, screenX: number, screenY: number) => void
  onAnnotationHoverEnd: () => void
  onAnnotationClick: (annotation: Annotation, screenX: number, screenY: number) => void
  onAnnotationContextMenu: (annotationId: string, clientX: number, clientY: number, time: number) => void
```

Destructure these new props.

In the event Layer (the one with `ref={eventLayerRef}`), after the CastEventIcon map (before `</Layer>`), add:

```typescript
        {/* 注释图标 */}
        {annotations
          .filter(a => a.anchor.type === 'skillTrack')
          .map(annotation => {
            const anchor = annotation.anchor as { type: 'skillTrack'; playerId: number; actionId: number }
            const trackIndex = skillTracks.findIndex(
              t => t.playerId === anchor.playerId && t.actionId === anchor.actionId
            )
            if (trackIndex === -1) return null

            const x = annotation.time * zoomLevel
            const y = trackIndex * trackHeight + trackHeight / 2

            return (
              <AnnotationIcon
                key={`annotation-${annotation.id}`}
                x={x}
                y={y}
                onMouseEnter={e => {
                  const stage = e.target.getStage()
                  if (!stage) return
                  const box = stage.container().getBoundingClientRect()
                  const absPos = e.target.getParent()!.getAbsolutePosition()
                  onAnnotationHover(annotation, box.left + absPos.x + 8, box.top + absPos.y + 8)
                }}
                onMouseLeave={onAnnotationHoverEnd}
                onClick={e => {
                  const stage = e.target.getStage()
                  if (!stage) return
                  const box = stage.container().getBoundingClientRect()
                  const absPos = e.target.getParent()!.getAbsolutePosition()
                  onAnnotationClick(annotation, box.left + absPos.x + 8, box.top + absPos.y + 8)
                }}
                onContextMenu={e => {
                  e.evt.preventDefault()
                  onAnnotationContextMenu(annotation.id, e.evt.clientX, e.evt.clientY, annotation.time)
                }}
              />
            )
          })}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Timeline/SkillTracksCanvas.tsx
git commit -m "feat: 在技能轨道渲染注释图标"
```

---

### Task 8: Annotation Popover Component

**Files:**

- Create: `src/components/Timeline/AnnotationPopover.tsx`

- [ ] **Step 1: Create AnnotationPopover component**

This is an HTML overlay positioned absolutely over the Canvas, similar to `TooltipOverlay`. It has two modes: view (hover) and edit (click).

Create `src/components/Timeline/AnnotationPopover.tsx`:

```typescript
/**
 * 注释查看/编辑 Popover
 */

import { useState, useRef, useEffect } from 'react'
import { ANNOTATION_TEXT_MAX_LENGTH } from '@/constants/limits'

interface AnnotationPopoverProps {
  /** 显示模式 */
  mode: 'view' | 'edit'
  /** 注释文本（编辑模式为初始值，新建时为空字符串） */
  text: string
  /** Popover 定位屏幕坐标 */
  screenX: number
  screenY: number
  /** 确认编辑 */
  onConfirm?: (text: string) => void
  /** 关闭 */
  onClose: () => void
}

export default function AnnotationPopover({
  mode,
  text,
  screenX,
  screenY,
  onConfirm,
  onClose,
}: AnnotationPopoverProps) {
  const [editText, setEditText] = useState(text)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mode === 'edit' && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(editText.length, editText.length)
    }
  }, [mode])  // eslint-disable-line react-hooks/exhaustive-deps

  // 点击外部关闭（编辑模式）
  useEffect(() => {
    if (mode !== 'edit') return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [mode, onClose])

  const handleConfirm = () => {
    const trimmed = editText.trim()
    if (trimmed && onConfirm) {
      onConfirm(trimmed)
    }
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
    // Ctrl/Cmd + Enter to confirm
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleConfirm()
    }
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-50 bg-popover text-popover-foreground border rounded-md shadow-md"
      style={{ left: screenX, top: screenY }}
      onMouseLeave={mode === 'view' ? onClose : undefined}
    >
      {mode === 'view' ? (
        <div className="px-3 py-2 text-xs max-w-[240px] whitespace-pre-wrap break-words">
          {text}
        </div>
      ) : (
        <div className="p-2 flex flex-col gap-1.5">
          <textarea
            ref={textareaRef}
            className="w-[220px] h-[80px] text-xs p-1.5 border rounded resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            maxLength={ANNOTATION_TEXT_MAX_LENGTH}
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入注释..."
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {editText.length}/{ANNOTATION_TEXT_MAX_LENGTH}
            </span>
            <div className="flex gap-1">
              <button
                className="px-2 py-0.5 text-[11px] rounded border hover:bg-muted"
                onClick={onClose}
              >
                取消
              </button>
              <button
                className="px-2 py-0.5 text-[11px] rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={!editText.trim()}
                onClick={handleConfirm}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Timeline/AnnotationPopover.tsx
git commit -m "feat: 添加注释查看/编辑 Popover 组件"
```

---

### Task 9: Wire Everything in index.tsx

**Files:**

- Modify: `src/components/Timeline/index.tsx`

This is the integration task — connecting annotation icons, popover, and context menu in the main Timeline component.

- [ ] **Step 1: Add annotation state and imports**

Add imports:

```typescript
import AnnotationPopover from './AnnotationPopover'
import type { CastEvent, Annotation, AnnotationAnchor } from '@/types/timeline'
```

Add state for hover popover (the `editingAnnotation` state was added in Task 4):

```typescript
const [hoverAnnotation, setHoverAnnotation] = useState<{
  annotation: Annotation
  screenX: number
  screenY: number
} | null>(null)
```

- [ ] **Step 2: Add annotation event handlers**

```typescript
const handleAnnotationHover = useCallback(
  (annotation: Annotation, screenX: number, screenY: number) => {
    // Don't show hover popover if we're editing
    if (editingAnnotation) return
    setHoverAnnotation({ annotation, screenX, screenY })
  },
  [editingAnnotation]
)

const handleAnnotationHoverEnd = useCallback(() => {
  setHoverAnnotation(null)
}, [])

const handleAnnotationClick = useCallback(
  (annotation: Annotation, screenX: number, screenY: number) => {
    if (isReadOnly) {
      // In read-only, click also shows view popover (same as hover but sticky)
      setHoverAnnotation({ annotation, screenX, screenY })
      return
    }
    setHoverAnnotation(null)
    setEditingAnnotation({
      annotation,
      time: annotation.time,
      anchor: annotation.anchor,
      screenX,
      screenY,
    })
  },
  [isReadOnly]
)

const handleAnnotationContextMenu = useCallback(
  (annotationId: string, clientX: number, clientY: number, time: number) => {
    if (isReadOnly) return
    setContextMenu({ type: 'annotation', annotationId, x: clientX, y: clientY, time })
  },
  [isReadOnly]
)

const handleAnnotationConfirm = useCallback(
  (text: string) => {
    if (!editingAnnotation) return
    if (editingAnnotation.annotation) {
      // Editing existing
      updateAnnotation(editingAnnotation.annotation.id, { text })
    } else {
      // Creating new
      addAnnotation({
        id: crypto.randomUUID(),
        text,
        time: editingAnnotation.time,
        anchor: editingAnnotation.anchor,
      })
    }
    setEditingAnnotation(null)
  },
  [editingAnnotation, addAnnotation, updateAnnotation]
)
```

Add `updateAnnotation` to the store destructure.

- [ ] **Step 3: Filter annotations for each track area**

After the `layoutData` destructure (around line 855), compute filtered annotations:

```typescript
const damageTrackAnnotations =
  timeline.annotations?.filter(a => a.anchor.type === 'damageTrack') ?? []
const skillTrackAnnotations =
  timeline.annotations?.filter(a => a.anchor.type === 'skillTrack') ?? []
```

- [ ] **Step 4: Pass annotation props to DamageEventTrack**

In the `<DamageEventTrack>` JSX (around line 902), add:

```typescript
annotations = { damageTrackAnnotations }
onAnnotationHover = { handleAnnotationHover }
onAnnotationHoverEnd = { handleAnnotationHoverEnd }
onAnnotationClick = { handleAnnotationClick }
onAnnotationContextMenu = { handleAnnotationContextMenu }
```

- [ ] **Step 5: Pass annotation props to SkillTracksCanvas**

In the `<SkillTracksCanvas>` JSX (around line 983), add:

```typescript
annotations = { skillTrackAnnotations }
onAnnotationHover = { handleAnnotationHover }
onAnnotationHoverEnd = { handleAnnotationHoverEnd }
onAnnotationClick = { handleAnnotationClick }
onAnnotationContextMenu = { handleAnnotationContextMenu }
```

- [ ] **Step 6: Add Popover overlays to the JSX**

After the `<TimelineContextMenu>` component (around line 1050), add:

```typescript
      {/* 注释悬浮查看 */}
      {hoverAnnotation && !editingAnnotation && (
        <AnnotationPopover
          mode="view"
          text={hoverAnnotation.annotation.text}
          screenX={hoverAnnotation.screenX}
          screenY={hoverAnnotation.screenY}
          onClose={() => setHoverAnnotation(null)}
        />
      )}

      {/* 注释编辑 */}
      {editingAnnotation && (
        <AnnotationPopover
          mode="edit"
          text={editingAnnotation.annotation?.text ?? ''}
          screenX={editingAnnotation.screenX}
          screenY={editingAnnotation.screenY}
          onConfirm={handleAnnotationConfirm}
          onClose={() => setEditingAnnotation(null)}
        />
      )}
```

- [ ] **Step 7: Verify the app compiles and works**

Run: `pnpm build`
Expected: Build succeeds.

Run: `pnpm dev` and manually test:

1. Right-click on damage track → "添加注释" appears → click → popover opens → type text → confirm → icon appears
2. Right-click on skill track → "添加注释" → same flow
3. Hover annotation icon → view popover shows
4. Click annotation icon → edit popover shows
5. Right-click annotation icon → "删除注释" → annotation removed
6. Undo (Ctrl+Z) → annotation restored

- [ ] **Step 8: Commit**

```bash
git add src/components/Timeline/index.tsx
git commit -m "feat: 集成注释图标渲染和 Popover 交互到时间轴主组件"
```

---

### Task 10: Backward Compatibility & Server Sync

**Files:**

- Modify: `src/store/timelineStore.ts`
- Modify: `src/utils/timelineStorage.ts`

- [ ] **Step 1: Handle missing annotations on load**

In `src/store/timelineStore.ts`, in the `setTimeline` action, ensure `annotations` defaults to `[]`:

```typescript
      setTimeline: timeline => {
        const normalized = timeline
          ? { ...timeline, annotations: timeline.annotations ?? [] }
          : null
        set({
          timeline: normalized,
          selectedEventId: null,
          selectedCastEventId: null,
          currentTime: 0,
        })
```

In `applyServerTimeline`, ensure `annotations` is included when merging server data. The current code does:

```typescript
            timeline: {
              ...state.timeline,
              ...response.timeline,
              statusEvents: state.timeline.statusEvents,
              // ...
            },
```

Since `response.timeline` may or may not include `annotations`, add after the `statusEvents` line:

```typescript
              annotations: response.timeline.annotations ?? [],
```

- [ ] **Step 2: Run all tests**

Run: `pnpm test:run`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/store/timelineStore.ts
git commit -m "feat: 兼容旧时间轴数据，确保 annotations 默认为空数组"
```

---

### Task 11: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test:run`
Expected: All tests pass (existing 129 + new annotation tests).

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: No errors.

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 4: Manual testing checklist**

Run `pnpm dev` and verify:

- [ ] 伤害轨道空白处右键 → 显示"添加注释"
- [ ] 技能轨道空白处右键 → 显示"添加注释"
- [ ] 添加注释后图标在正确位置出现
- [ ] 悬浮图标 → 弹出只读 Popover
- [ ] 点击图标 → 弹出编辑 Popover，修改文本 → 确认
- [ ] 右键图标 → 显示"删除注释"
- [ ] Ctrl+Z 撤销注释操作
- [ ] 发布时间轴 → 注释数据随同步到服务器
- [ ] 只读模式 → 不显示添加/删除菜单项，点击图标只读
- [ ] 修改阵容移除玩家 → 对应 skillTrack 注释被过滤
