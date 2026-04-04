# 时间轴右键上下文菜单设计

## 概述

为时间轴的四个区域添加右键上下文菜单，作为现有交互方式（双击、Delete 键）的补充入口，提高操作可发现性。现有的技能图标右键确认删除框被替换为上下文菜单。

## 定位

- **补充型**：保留所有现有交互（双击添加、Delete 删除、拖拽移动）
- 唯一替换：CastEventIcon 现有的右键 → 确认删除框，改为右键 → 上下文菜单
- 只读模式下不显示菜单

## 菜单项

### 技能图标（CastEventIcon）右键

| 菜单项 | 行为                                          |
| ------ | --------------------------------------------- |
| 删除   | 调用 `removeCastEvent(castEventId)`，无确认框 |

### 技能轨道空白区域右键

| 菜单项 | 行为                                                      |
| ------ | --------------------------------------------------------- |
| 添加   | 调用 `addCastEvent`，时间取自右键位置，逻辑与双击添加一致 |

### 伤害事件卡片（DamageEventCard）右键

| 菜单项   | 行为                                          |
| -------- | --------------------------------------------- |
| 编辑属性 | 选中事件，聚焦 PropertyPanel                  |
| 复制     | 将事件数据（去掉 id 和 time）存入剪贴板 state |
| 删除     | 调用 `removeDamageEvent(eventId)`，无确认框   |

### 伤害事件轨道空白区域右键

| 菜单项       | 条件             | 行为                                             |
| ------------ | ---------------- | ------------------------------------------------ |
| 添加伤害事件 | 始终显示         | 打开 AddEventDialog，传入右键位置时间            |
| 粘贴伤害事件 | 剪贴板非空时显示 | 用剪贴板数据 + 右键位置时间调用 `addDamageEvent` |

## 状态管理

### 菜单状态

在 `Timeline/index.tsx` 内部用局部 state 管理，不放入 uiStore（瞬态 UI）：

```typescript
type ContextMenuState = {
  x: number // 相对于 viewport 的像素坐标
  y: number
  time: number // 右键位置对应的时间轴时间（秒）
} & (
  | { type: 'castEvent'; castEventId: string; actionId: number }
  | { type: 'skillTrackEmpty'; actionId: number }
  | { type: 'damageEvent'; eventId: string }
  | { type: 'damageTrackEmpty' }
)
```

### 剪贴板状态

同样使用局部 state，生命周期跟随编辑器：

```typescript
type ClipboardState = {
  damageEvent: Omit<DamageEvent, 'id' | 'time'>
} | null
```

### 行为细节

- 菜单打开时同时选中对应元素（cast event 或 damage event）
- 菜单关闭时不取消选中

## 实现方案

### DOM 浮层 + Konva 事件驱动

Konva `onContextMenu` 捕获右键事件 → 阻止浏览器默认菜单 → 将菜单信息写入 state → React 在 Canvas 外层渲染绝对定位的 DOM 菜单。

使用 shadcn/ui 的 `DropdownMenu` 受控模式（`open` + `onOpenChange`）。

### 组件结构

```
<div className="relative">              ← 已有的 Timeline 容器
  <Stage>...</Stage>                     ← Konva Canvas

  <TimelineContextMenu                   ← 新组件
    contextMenu={contextMenu}
    clipboard={clipboard}
    onClose={handleClose}
    onDeleteCast={...}
    onAddCast={...}
    onEditDamageEvent={...}
    onCopyDamageEvent={...}
    onDeleteDamageEvent={...}
    onAddDamageEvent={...}
    onPasteDamageEvent={...}
  />
</div>
```

`TimelineContextMenu` 内部结构：

```
<DropdownMenu open={!!contextMenu} onOpenChange={handleClose}>
  <DropdownMenuTrigger asChild>
    <div style={{ position: 'absolute', left: x, top: y }} />
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    {/* 根据 contextMenu.type 渲染对应菜单项 */}
  </DropdownMenuContent>
</DropdownMenu>
```

### 事件流

四个区域的 Konva 元素各自在 `onContextMenu` 中调用统一回调（由 Timeline/index.tsx 向下传递）：

```typescript
onContextMenu: (e: KonvaEventObject<PointerEvent>, payload: ContextMenuPayload) => void
```

各区域组装自己的 payload：

- **CastEventIcon** — `{ type: 'castEvent', castEventId, actionId }`
- **SkillTracksCanvas 空白区** — `{ type: 'skillTrackEmpty', actionId }`（由 y 坐标算出轨道）
- **DamageEventCard** — `{ type: 'damageEvent', eventId }`
- **DamageEventTrack 空白区** — `{ type: 'damageTrackEmpty' }`

统一回调内：`e.evt.preventDefault()` + 计算 viewport 坐标 + setState 打开菜单。

### 关闭时机

点击菜单项、点击外部、Escape 键 — 全部由 DropdownMenu `onOpenChange` 自动处理。

## 新增/修改文件

| 文件                                              | 变更                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/components/Timeline/TimelineContextMenu.tsx` | **新增**，菜单渲染组件                                                   |
| `src/components/Timeline/index.tsx`               | 添加 contextMenu/clipboard state，传递统一回调，挂载 TimelineContextMenu |
| `src/components/Timeline/SkillTracksCanvas.tsx`   | 空白区域添加 onContextMenu，技能图标传递 onContextMenu                   |
| `src/components/Timeline/CastEventIcon.tsx`       | 替换现有 onContextMenu 逻辑为调用统一回调                                |
| `src/components/Timeline/DamageEventTrack.tsx`    | 空白区域添加 onContextMenu，伤害卡片传递 onContextMenu                   |
| `src/components/Timeline/DamageEventCard.tsx`     | 添加 onContextMenu prop                                                  |

## 不做的事

- 不修改现有双击添加、Delete 删除、拖拽移动的交互
- 不为技能添加复制粘贴（与"添加"功能等价，无额外价值）
- 不在只读模式下显示菜单
- 删除操作不加确认框（与现有 Delete 键行为一致）
