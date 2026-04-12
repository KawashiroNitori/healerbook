# 时间轴右键上下文菜单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为时间轴四个区域（技能图标、技能轨道空白、伤害卡片、伤害轨道空白）添加右键上下文菜单，替代现有的右键确认删除框。

**Architecture:** 在 Konva Canvas 的 `onContextMenu` 事件中捕获右键，将菜单状态写入 Timeline 组件的局部 state，在 Canvas 外层渲染一个绝对定位的 DOM 菜单。菜单使用 shadcn/ui 的 `DropdownMenu` 受控模式。需要先安装 `@radix-ui/react-dropdown-menu` 并添加 shadcn/ui dropdown-menu 组件。

**Tech Stack:** React, shadcn/ui DropdownMenu, Radix UI, Konva onContextMenu, Zustand

---

## File Structure

| 文件                                              | 职责                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/components/ui/dropdown-menu.tsx`             | **新增** — shadcn/ui DropdownMenu 组件                                   |
| `src/components/Timeline/TimelineContextMenu.tsx` | **新增** — 上下文菜单渲染组件                                            |
| `src/components/Timeline/index.tsx`               | **修改** — 添加菜单/剪贴板 state，统一回调，挂载菜单，移除 ConfirmDialog |
| `src/components/Timeline/SkillTracksCanvas.tsx`   | **修改** — 空白区域 onContextMenu，改变 onContextMenu prop 签名          |
| `src/components/Timeline/CastEventIcon.tsx`       | **修改** — onContextMenu prop 类型变更                                   |
| `src/components/Timeline/DamageEventTrack.tsx`    | **修改** — 添加 onContextMenu props                                      |
| `src/components/Timeline/DamageEventCard.tsx`     | **修改** — 添加 onContextMenu prop                                       |

---

### Task 1: 使用 shadcn CLI 添加 DropdownMenu 组件

**Files:**

- Create: `src/components/ui/dropdown-menu.tsx`（由 CLI 自动生成）

- [ ] **Step 1: 使用 shadcn CLI 安装 dropdown-menu 组件**

```bash
pnpm dlx shadcn@latest add dropdown-menu
```

该命令会自动安装 `@radix-ui/react-dropdown-menu` 依赖并生成 `src/components/ui/dropdown-menu.tsx`。

- [ ] **Step 2: 验证生成的文件存在**

```bash
ls src/components/ui/dropdown-menu.tsx
```

Expected: 文件存在

- [ ] **Step 3: 提交**

```bash
git add src/components/ui/dropdown-menu.tsx package.json pnpm-lock.yaml
git commit -m "feat: 添加 shadcn/ui DropdownMenu 组件"
```

---

### Task 2: 创建 TimelineContextMenu 组件

**Files:**

- Create: `src/components/Timeline/TimelineContextMenu.tsx`

- [ ] **Step 1: 创建菜单组件**

创建 `src/components/Timeline/TimelineContextMenu.tsx`：

```tsx
/**
 * 时间轴右键上下文菜单
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { DamageEvent } from '@/types/timeline'

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

export type DamageEventClipboard = Omit<DamageEvent, 'id' | 'time'> | null

interface TimelineContextMenuProps {
  menu: ContextMenuState | null
  clipboard: DamageEventClipboard
  onClose: () => void
  onDeleteCast: (castEventId: string) => void
  onAddCast: (actionId: number, time: number) => void
  onEditDamageEvent: (eventId: string) => void
  onCopyDamageEvent: (eventId: string) => void
  onDeleteDamageEvent: (eventId: string) => void
  onAddDamageEvent: (time: number) => void
  onPasteDamageEvent: (time: number) => void
}

export default function TimelineContextMenu({
  menu,
  clipboard,
  onClose,
  onDeleteCast,
  onAddCast,
  onEditDamageEvent,
  onCopyDamageEvent,
  onDeleteDamageEvent,
  onAddDamageEvent,
  onPasteDamageEvent,
}: TimelineContextMenuProps) {
  if (!menu) return null

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  return (
    <DropdownMenu open={true} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <div
          className="fixed pointer-events-none"
          style={{ left: menu.x, top: menu.y, width: 1, height: 1 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="min-w-[140px]">
        {menu.type === 'castEvent' && (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => {
              onDeleteCast(menu.castEventId)
              onClose()
            }}
          >
            删除
          </DropdownMenuItem>
        )}

        {menu.type === 'skillTrackEmpty' && (
          <DropdownMenuItem
            onClick={() => {
              onAddCast(menu.actionId, menu.time)
              onClose()
            }}
          >
            添加
          </DropdownMenuItem>
        )}

        {menu.type === 'damageEvent' && (
          <>
            <DropdownMenuItem
              onClick={() => {
                onEditDamageEvent(menu.eventId)
                onClose()
              }}
            >
              编辑属性
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                onCopyDamageEvent(menu.eventId)
                onClose()
              }}
            >
              复制
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                onDeleteDamageEvent(menu.eventId)
                onClose()
              }}
            >
              删除
            </DropdownMenuItem>
          </>
        )}

        {menu.type === 'damageTrackEmpty' && (
          <>
            <DropdownMenuItem
              onClick={() => {
                onAddDamageEvent(menu.time)
                onClose()
              }}
            >
              添加伤害事件
            </DropdownMenuItem>
            {clipboard && (
              <DropdownMenuItem
                onClick={() => {
                  onPasteDamageEvent(menu.time)
                  onClose()
                }}
              >
                粘贴伤害事件
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
pnpm exec tsc --noEmit --pretty 2>&1 | head -20
```

Expected: 无错误（组件尚未被引用，不会有 import 问题）

- [ ] **Step 3: 提交**

```bash
git add src/components/Timeline/TimelineContextMenu.tsx
git commit -m "feat: 创建 TimelineContextMenu 组件"
```

---

### Task 3: DamageEventCard 添加 onContextMenu prop

**Files:**

- Modify: `src/components/Timeline/DamageEventCard.tsx`

- [ ] **Step 1: 添加 onContextMenu prop**

在 `DamageEventCardProps` 接口中添加：

```typescript
onContextMenu?: (e: KonvaEventObject<PointerEvent>) => void
```

在组件参数解构中添加 `onContextMenu`。

在 `<Group>` 元素上添加 `onContextMenu={onContextMenu}`。

具体修改 `src/components/Timeline/DamageEventCard.tsx`：

1. 添加 import：

```typescript
import type { KonvaEventObject } from 'konva/lib/Node'
```

2. 在 `DamageEventCardProps` 中添加：

```typescript
onContextMenu?: (e: KonvaEventObject<PointerEvent>) => void
```

3. 在解构中添加 `onContextMenu`。

4. 在 `<Group>` 的 props 中添加 `onContextMenu={onContextMenu}`（放在 `onDragEnd` 之后）。

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
pnpm exec tsc --noEmit --pretty 2>&1 | head -20
```

Expected: 无错误（prop 是可选的，现有调用方不受影响）

- [ ] **Step 3: 提交**

```bash
git add src/components/Timeline/DamageEventCard.tsx
git commit -m "feat: DamageEventCard 添加 onContextMenu prop"
```

---

### Task 4: DamageEventTrack 添加 onContextMenu 支持

**Files:**

- Modify: `src/components/Timeline/DamageEventTrack.tsx`

- [ ] **Step 1: 添加 props 和事件处理**

修改 `src/components/Timeline/DamageEventTrack.tsx`：

1. 在 `DamageEventTrackProps` 接口中添加：

```typescript
onContextMenu?: (e: { type: 'damageEvent'; eventId: string } | { type: 'damageTrackEmpty' }, clientX: number, clientY: number, time: number) => void
```

2. 在组件参数解构中添加 `onContextMenu`。

3. 在背景 `<Rect>`（`<Rect x={TIMELINE_START_TIME * zoomLevel} ...>`）上添加 onContextMenu 处理：

```tsx
onContextMenu={e => {
  if (isReadOnly || !onContextMenu) return
  e.evt.preventDefault()
  const layer = e.target.getLayer()
  if (!layer) return
  const pos = layer.getRelativePointerPosition()
  if (!pos) return
  const time = Math.max(TIMELINE_START_TIME, Math.round((pos.x / zoomLevel) * 10) / 10)
  onContextMenu({ type: 'damageTrackEmpty' }, e.evt.clientX, e.evt.clientY, time)
}}
```

4. 在 `<DamageEventCard>` 上传递 onContextMenu prop：

```tsx
onContextMenu={e => {
  if (isReadOnly || !onContextMenu) return
  e.evt.preventDefault()
  onContextMenu({ type: 'damageEvent', eventId: event.id }, e.evt.clientX, e.evt.clientY, event.time)
}}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
pnpm exec tsc --noEmit --pretty 2>&1 | head -20
```

Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/components/Timeline/DamageEventTrack.tsx
git commit -m "feat: DamageEventTrack 添加 onContextMenu 支持"
```

---

### Task 5: SkillTracksCanvas 和 CastEventIcon 改造 onContextMenu

**Files:**

- Modify: `src/components/Timeline/SkillTracksCanvas.tsx`
- Modify: `src/components/Timeline/CastEventIcon.tsx`

- [ ] **Step 1: 修改 SkillTracksCanvas 的 onContextMenu prop 签名**

将 `SkillTracksCanvasProps` 中的：

```typescript
onContextMenu: (castEventId: string) => void
```

改为：

```typescript
onContextMenu: (payload: { type: 'castEvent'; castEventId: string; actionId: number } | { type: 'skillTrackEmpty'; actionId: number }, clientX: number, clientY: number, time: number) => void
```

- [ ] **Step 2: 修改 CastEventIcon 的 onContextMenu 调用**

在 `SkillTracksCanvas.tsx` 中，CastEventIcon 的 onContextMenu 回调从：

```tsx
onContextMenu={e => {
  if (isReadOnly) return
  e.evt.preventDefault()
  onContextMenu(castEvent.id)
}}
```

改为：

```tsx
onContextMenu={e => {
  if (isReadOnly) return
  e.evt.preventDefault()
  onContextMenu(
    { type: 'castEvent', castEventId: castEvent.id, actionId: castEvent.actionId },
    e.evt.clientX,
    e.evt.clientY,
    castEvent.timestamp
  )
}}
```

- [ ] **Step 3: 为技能轨道背景 Rect 添加 onContextMenu**

在 `SkillTracksCanvas.tsx` 的技能轨道背景 `<Rect>`（已有 `onDblClick`）上添加：

```tsx
onContextMenu={e => {
  if (isReadOnly) return
  e.evt.preventDefault()
  const stage = e.target.getStage()
  if (!stage) return
  const pointerPos = stage.getPointerPosition()
  if (!pointerPos) return
  const time = Math.round(((pointerPos.x + scrollLeft) / zoomLevel) * 10) / 10
  onContextMenu(
    { type: 'skillTrackEmpty', actionId: track.actionId },
    e.evt.clientX,
    e.evt.clientY,
    time
  )
}}
```

- [ ] **Step 4: CastEventIcon 的 onContextMenu prop 类型不需要改变**

`CastEventIcon` 的 `onContextMenu` prop 类型已经是 `(e: KonvaContextMenuEvent) => void`，实际逻辑在 SkillTracksCanvas 的回调闭包中，所以 `CastEventIcon.tsx` 本身**不需要修改**。

- [ ] **Step 5: 验证 TypeScript 编译**

```bash
pnpm exec tsc --noEmit --pretty 2>&1 | head -20
```

Expected: 编译错误来自 `index.tsx` 中旧的 `onContextMenu` 调用签名不匹配（将在 Task 6 中修复）。

- [ ] **Step 6: 提交**

```bash
git add src/components/Timeline/SkillTracksCanvas.tsx
git commit -m "feat: SkillTracksCanvas 支持四种右键菜单触发"
```

---

### Task 6: 集成 — Timeline/index.tsx 挂载菜单并移除 ConfirmDialog

**Files:**

- Modify: `src/components/Timeline/index.tsx`

- [ ] **Step 1: 添加 import**

在 `index.tsx` 顶部添加：

```typescript
import TimelineContextMenu from './TimelineContextMenu'
import type { ContextMenuState, DamageEventClipboard } from './TimelineContextMenu'
```

移除不再需要的 import：

```typescript
import ConfirmDialog from '../ConfirmDialog'
```

- [ ] **Step 2: 替换 state**

移除以下 state：

```typescript
const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
const [castEventToDelete, setCastEventToDelete] = useState<string | null>(null)
```

添加新的 state：

```typescript
const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
const [clipboard, setClipboard] = useState<DamageEventClipboard>(null)
```

- [ ] **Step 3: 创建统一 onContextMenu 回调**

添加处理函数：

```typescript
const handleContextMenu = useCallback(
  (
    payload:
      | { type: 'castEvent'; castEventId: string; actionId: number }
      | { type: 'skillTrackEmpty'; actionId: number }
      | { type: 'damageEvent'; eventId: string }
      | { type: 'damageTrackEmpty' },
    clientX: number,
    clientY: number,
    time: number
  ) => {
    // 打开菜单时同时选中对应元素
    if (payload.type === 'castEvent') {
      selectCastEvent(payload.castEventId)
    } else if (payload.type === 'damageEvent') {
      selectEvent(payload.eventId)
    }

    setContextMenu({ ...payload, x: clientX, y: clientY, time })
  },
  [selectCastEvent, selectEvent]
)
```

- [ ] **Step 4: 创建菜单 action 回调**

```typescript
const handleContextMenuClose = useCallback(() => {
  setContextMenu(null)
}, [])

const handleContextMenuAddCast = useCallback(
  (actionId: number, time: number) => {
    if (!timeline) return
    // 找到对应的轨道信息
    const track = layoutData?.skillTracks.find(t => t.actionId === actionId)
    if (!track) return

    if (checkOverlap(time, track.playerId, actionId)) {
      toast.error('无法添加技能', { description: '该技能与已有技能重叠' })
      return
    }

    addCastEvent({
      id: `cast-${Date.now()}`,
      actionId,
      timestamp: time,
      playerId: track.playerId,
      job: track.job,
    })
  },
  [timeline, layoutData?.skillTracks, actions, addCastEvent]
)

const handleContextMenuEditDamageEvent = useCallback(
  (eventId: string) => {
    selectEvent(eventId)
  },
  [selectEvent]
)

const handleContextMenuCopyDamageEvent = useCallback(
  (eventId: string) => {
    if (!timeline) return
    const event = timeline.damageEvents.find(e => e.id === eventId)
    if (!event) return
    const { id: _, time: __, ...rest } = event
    setClipboard(rest)
    toast.success('已复制伤害事件')
  },
  [timeline]
)

const handleContextMenuAddDamageEvent = useCallback((time: number) => {
  setAddEventAt(time)
}, [])

const handleContextMenuPasteDamageEvent = useCallback(
  (time: number) => {
    if (!clipboard) return
    const { addDamageEvent } = useTimelineStore.getState()
    addDamageEvent({
      ...clipboard,
      id: `event-${Date.now()}`,
      time,
    })
    toast.success('已粘贴伤害事件')
  },
  [clipboard]
)
```

- [ ] **Step 5: 修改 SkillTracksCanvas 的 onContextMenu prop**

将现有的：

```tsx
onContextMenu={castEventId => {
  setCastEventToDelete(castEventId)
  setDeleteConfirmOpen(true)
}}
```

改为：

```tsx
onContextMenu = { handleContextMenu }
```

- [ ] **Step 6: 为 DamageEventTrack 添加 onContextMenu prop**

在 `<DamageEventTrack>` 上添加：

```tsx
onContextMenu = { handleContextMenu }
```

- [ ] **Step 7: 替换 ConfirmDialog 为 TimelineContextMenu**

移除 JSX 末尾的 `<ConfirmDialog>` 块：

```tsx
{
  /* 删除确认对话框 */
}
;<ConfirmDialog
  open={deleteConfirmOpen}
  onOpenChange={setDeleteConfirmOpen}
  onConfirm={() => {
    if (castEventToDelete) {
      removeCastEvent(castEventToDelete)
      setCastEventToDelete(null)
    }
  }}
  title="删除技能使用"
  description="确定要删除这个技能使用吗?"
  variant="destructive"
/>
```

替换为：

```tsx
{
  /* 右键上下文菜单 */
}
;<TimelineContextMenu
  menu={contextMenu}
  clipboard={clipboard}
  onClose={handleContextMenuClose}
  onDeleteCast={removeCastEvent}
  onAddCast={handleContextMenuAddCast}
  onEditDamageEvent={handleContextMenuEditDamageEvent}
  onCopyDamageEvent={handleContextMenuCopyDamageEvent}
  onDeleteDamageEvent={removeDamageEvent}
  onAddDamageEvent={handleContextMenuAddDamageEvent}
  onPasteDamageEvent={handleContextMenuPasteDamageEvent}
/>
```

- [ ] **Step 8: 验证 TypeScript 编译**

```bash
pnpm exec tsc --noEmit --pretty 2>&1 | head -20
```

Expected: 无错误

- [ ] **Step 9: 验证开发服务器运行**

```bash
pnpm dev
```

手动测试：右键技能图标应弹出菜单（而非旧的确认框），右键空白区域应弹出"添加"菜单，右键伤害卡片应弹出编辑/复制/删除菜单。

- [ ] **Step 10: 提交**

```bash
git add src/components/Timeline/index.tsx
git commit -m "feat: 集成右键上下文菜单，替换 ConfirmDialog"
```

---

### Task 7: 运行测试并验证

**Files:** 无修改

- [ ] **Step 1: 运行全量测试**

```bash
pnpm test:run
```

Expected: 所有 129 个测试通过。此次改动全部在 UI 组件层，不涉及被测试覆盖的 utils/workers 逻辑。

- [ ] **Step 2: 运行 lint**

```bash
pnpm lint
```

Expected: 无错误

- [ ] **Step 3: 运行构建**

```bash
pnpm build
```

Expected: 构建成功

- [ ] **Step 4: 提交修复（如有）**

如果测试/lint/构建发现问题，修复后提交。

---

### Task 8: 清理未使用的 ConfirmDialog import（如需要）

**Files:**

- Modify: `src/components/Timeline/index.tsx`（如 Task 6 中遗漏）

- [ ] **Step 1: 确认 ConfirmDialog 是否还在其他地方使用**

```bash
grep -r "ConfirmDialog" src/ --include="*.tsx" --include="*.ts"
```

如果 `ConfirmDialog` 仅在 `Timeline/index.tsx` 中使用，且已在 Task 6 中移除了 import，则此 task 无需操作。如果其他组件也引用了 `ConfirmDialog`，不要删除 `ConfirmDialog.tsx` 文件本身。

- [ ] **Step 2: 提交（如有改动）**

```bash
git add -A
git commit -m "refactor: 清理未使用的 import"
```
