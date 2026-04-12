# 撤销/重做功能设计

## 概述

为时间轴编辑器的所有编辑操作添加撤销（Undo）和重做（Redo）功能，让用户可以自由回退和恢复操作。

## 需要支持撤销/重做的操作

### 伤害事件（DamageEvent）

- 添加（双击伤害轨道 / AddEventDialog）
- 修改（拖拽移动时间 / 属性面板编辑 name、damage、damageType、type）
- 删除（属性面板删除按钮 / Delete 键）

### 技能使用事件（CastEvent）

- 添加（双击技能轨道）
- 拖拽移动时间
- 删除（右键菜单 / Delete 键）

### 元数据

- 修改时间轴名称
- 修改时间轴描述

### 阵容（Composition）

- 修改小队阵容（含级联删除不相关的 castEvents）

## 技术方案

### 核心：zundo 中间件

使用 [zundo](https://github.com/charkour/zundo)（Zustand 官方推荐的 undo 中间件），基于快照实现历史记录管理。

**选择 zundo 的理由：**

- 项目已使用 Zustand，zundo 是其生态的标准 undo 方案
- 快照式实现无需为每种操作编写反向逻辑，阵容修改等复合操作天然支持
- 内置 `partialize`（状态分区）、`limit`（容量限制）等能力
- 体积极小（< 700 bytes）

### 历史跟踪范围

**跟踪的状态：**

- `timeline` 对象整体（damageEvents、castEvents、composition、name、description、phases 等）

**排除的状态（通过 `partialize` 配置）：**

- `selectedEventId` / `selectedCastEventId` — 选中状态
- `currentTime` / `zoomLevel` / `pendingScrollProgress` / `currentScrollLeft` — 视口状态
- `currentTimelineWidth` / `currentViewportWidth` — 布局尺寸
- `partyState` — 派生计算结果，timeline 变化后由 `useDamageCalculation` 自动重算
- `statistics` — 服务端数据
- `autoSaveTimer` — 内部定时器

### 撤销/重做后的状态处理

- **选中状态**：一律清除 `selectedEventId` 和 `selectedCastEventId`，避免指向已不存在的事件
- **派生状态**：`partyState` 由 `useDamageCalculation` 自动重算，无需手动处理
- **自动保存**：在 `undo()` / `redo()` 调用点之后手动触发 `triggerAutoSave()`
- **已发布时间轴**：撤销/重做后同样标记 `hasLocalChanges: true`，与正常编辑行为一致

### 拖拽操作

当前拖拽实现中，`onDragMove` 只更新组件本地 `useState`（视觉跟随），仅 `onDragEnd` 才写入 store。因此不存在高频 store 更新问题，zundo 默认行为即可，无需配置 `handleSet` 节流。

### 快捷键：react-hotkeys-hook

引入 [react-hotkeys-hook](https://github.com/JohannesKlauss/react-hotkeys-hook) 统一管理快捷键。

**选择理由：**

- `mod+z` 语法自动适配 Mac（Cmd）和 Windows（Ctrl）
- 项目后续快捷键会增多，统一管理优于手动 addEventListener
- 约 2KB gzip，API 简洁

**快捷键定义：**

- `mod+z` — 撤销
- `mod+shift+z` — 重做

**迁移**：将现有的 Delete/Backspace 监听从手动 `addEventListener` 迁移到 `useHotkeys`，统一快捷键管理方式。

**只读模式**：`view` 模式下不绑定编辑相关快捷键。

### UI 入口

在 `EditorToolbar.tsx` 中添加撤销/重做按钮：

- 图标：Lucide 的 `Undo2` / `Redo2`
- 禁用状态：`pastStates.length === 0` 时禁用撤销，`futureStates.length === 0` 时禁用重做
- 只读模式下不渲染

## 改动文件清单

| 文件                            | 改动内容                                                        |
| ------------------------------- | --------------------------------------------------------------- |
| `package.json`                  | 添加 `zundo` 和 `react-hotkeys-hook` 依赖                       |
| `store/timelineStore.ts`        | 包装 `temporal` 中间件，配置 `partialize` 和 `limit: 50`        |
| `components/Timeline/index.tsx` | 用 `useHotkeys` 替换现有 `handleKeyDown`，添加 undo/redo 快捷键 |
| `components/EditorToolbar.tsx`  | 添加撤销/重做按钮，通过历史栈长度控制 disabled                  |

**不需要改动的文件：**

- 所有现有 action（addDamageEvent、updateCastEvent 等）无需修改
- `useDamageCalculation` 无需改动
- localStorage 自动保存逻辑无需改动
- PropertyPanel、CompositionDialog 等组件无需改动

## 配置示例

```typescript
// store/timelineStore.ts
import { temporal } from 'zundo'

const useTimelineStore = create<TimelineState>()(
  temporal(
    (set, get) => ({
      // 现有 store 定义不变...
    }),
    {
      partialize: state => ({ timeline: state.timeline }),
      limit: 50,
    }
  )
)

// 撤销/重做 API
const { undo, redo, pastStates, futureStates } = useTimelineStore.temporal.getState()
```

```typescript
// components/Timeline/index.tsx
import { useHotkeys } from 'react-hotkeys-hook'

// 撤销
useHotkeys(
  'mod+z',
  () => {
    const { undo } = useTimelineStore.temporal.getState()
    undo()
    clearSelection()
    triggerAutoSave()
  },
  { enabled: !isReadOnly }
)

// 重做
useHotkeys(
  'mod+shift+z',
  () => {
    const { redo } = useTimelineStore.temporal.getState()
    redo()
    clearSelection()
    triggerAutoSave()
  },
  { enabled: !isReadOnly }
)

// 迁移现有删除快捷键
useHotkeys(
  'delete, backspace',
  () => {
    if (selectedEventId) removeDamageEvent(selectedEventId)
    else if (selectedCastEventId) removeCastEvent(selectedCastEventId)
  },
  { enabled: !isReadOnly }
)
```

## 预估工作量

约 50-80 行新增代码，涉及 4 个文件。
