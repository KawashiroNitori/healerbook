# 视图菜单设计规格

## 概述

在编辑器工具栏添加「视图」下拉菜单按钮，控制伤害事件卡片上显示哪种伤害数值。

## 菜单结构

```
👁 视图按钮（Eye 图标，ghost variant）
└── 伤害事件（子菜单 DropdownMenuSub）
    ├── ☑ 实际伤害（DropdownMenuCheckboxItem）
    └── ☐ 原始伤害（DropdownMenuCheckboxItem）
```

- 两个子项均为多选（checkbox），可独立切换
- 允许全部取消勾选

## 工具栏位置

视图按钮位于锁定/回放按钮之后，阵容按钮之前：

```
缩放 | 撤销 重做 | 🔓 👁视图 | 👥阵容 ⚙设置 | 分享
```

## 伤害卡片显示逻辑

卡片固定宽度 150px，内部分为名称区域和数值区域。

| 勾选状态   | 数值显示     | 数值区域宽度 | 名称区域宽度     |
| ---------- | ------------ | ------------ | ---------------- |
| 仅实际伤害 | `6.0w`       | 50px         | 90px（当前默认） |
| 仅原始伤害 | `10.0w`      | 50px         | 90px             |
| 两者都选   | `6.0w/10.0w` | 80px         | 60px             |
| 都不选     | 无           | 0px          | 140px            |

- 单值格式：`Xw`（≥10000）或 `X,XXX`（<10000）
- 双值格式：`实际伤害/原始伤害`，使用相同的数值格式化规则
- 死刑事件始终显示「死刑」，不受视图设置影响
- 名称过长时通过 `truncateText()` 截断并加省略号

## 状态管理

在 `uiStore` 中新增：

```typescript
showActualDamage: boolean    // 默认 true
showOriginalDamage: boolean  // 默认 false
toggleShowActualDamage: () => void
toggleShowOriginalDamage: () => void
```

## 需修改的文件

1. **`src/store/uiStore.ts`** — 添加两个布尔状态和对应 toggle 方法
2. **`src/components/EditorToolbar.tsx`** — 添加视图下拉菜单（`DropdownMenu` + `DropdownMenuSub` + `DropdownMenuCheckboxItem`）
3. **`src/components/Timeline/DamageEventCard.tsx`** — 修改 `getDamageText()` 读取 UI 状态，支持双值显示和动态宽度调整

## 验证方式

1. `pnpm dev` 启动，确认视图按钮正确显示在工具栏
2. 点击视图按钮，确认子菜单弹出，checkbox 可切换
3. 4 种勾选组合下伤害卡片显示正确
4. 长名称事件在双值模式下正确截断
5. `pnpm test:run` 现有测试全部通过
