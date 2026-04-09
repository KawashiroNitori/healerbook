# 表格视图设计

> 状态：已就绪（待实现）
> 日期：2026-04-09
> 分支：`feat/table-view`

## 背景

当前编辑器页 `/timeline/:id` 只有一种视图——基于 Konva Canvas 的横向时间轴（`TimelineCanvas`）。该视图适合编辑与空间布局，但**阅览与分享**场景下存在以下问题：

- 横向滚动长、一屏看不完全貌
- 难以按"伤害事件"为单位对照查看"哪些减伤在此时生效"
- 对只想读懂他人方案的用户而言，交互成本过高

为此新增**表格视图**作为纯阅览模式，按伤害事件纵向列出，每一行直观展示该事件时刻各玩家的减伤技能覆盖情况。表格视图通过 URL query 参数 `?view=table` 激活，两种视图共享同一路由 `/timeline/:id`。

## 目标与非目标

### 目标

1. 在现有编辑器页提供"时间轴视图 / 表格视图"二选一切换
2. 表格视图按伤害事件纵向展示，一眼看清整场战斗的减伤分配
3. 表格视图完全只读、纯展示
4. 与时间轴视图的技能列顺序、职业显隐、伤害数值来源严格一致
5. 支持通过 URL 分享表格视图，便于传阅
6. 同时支持编辑模式（`local` / `author`）和 view 模式（他人时间轴）
7. 同时支持编辑态时间轴和回放态时间轴

### 非目标

- 不在表格视图内提供任何编辑操作（拖拽、点击编辑、快捷键等）
- 不在表格中显示技能的减伤百分比或盾值（简化实现，仅二元亮/不亮）
- 不做行虚拟化（数据量典型范围下无必要）
- 不提供专属的导出（PDF、截图）功能
- 不影响 `uiStore.isReadOnly` 或 `useEditorReadOnly` 的现有语义
- 不处理 `Seraphism → Accession` 等 cast 图标覆盖规则（对表格视图无影响）

## 设计决策

### 决策 1：视图模式的状态位置

**选择：URL query 参数 `?view=table`**

`EditorPage` 使用 `useSearchParams()` 读取 `viewMode`，不进 `uiStore`、不进组件 state、不进路由 path。

**理由：**

- 分享传阅是表格视图的核心场景，URL 参数天然支持带参分享
- 与 `/timeline/:id` 路由语义正交，不污染路由结构
- 刷新保持、浏览器前进后退保持，用户行为符合预期
- 不需要在 `uiStore` 中新增状态，减少 store 膨胀

**切换方式：** 视图菜单（`Eye` 按钮 `DropdownMenu`）顶部加 `DropdownMenuRadioGroup`：

```
时间轴视图  ●
表格视图    ○
─────────────
伤害事件  ▸
  实际伤害 ☑
  原始伤害 ☐
```

点击切换项调用 `setSearchParams({ view: 'table' })`，`replace: true` 不产生新的历史栈。

### 决策 2：只读语义

**选择：不触碰现有只读机制**

表格视图下：

- **不修改** `uiStore.isReadOnly`
- **不修改** `forceReadOnly` 的语义
- **不修改** `useEditorReadOnly()` hook

标题/描述保持可编辑（`EditorPage` 现有 `isViewMode` 分支即可），`PropertyPanel` 因 `selectedEventId === null` 天然 `return null`，工具栏上所有按钮（zoom/undo/redo/lock/composition/statData）原状保留、功能不变。

**理由：**

- 表格组件本身不暴露编辑交互，"只读"由组件自身特性保证，无需全局状态
- 切回时间轴视图时无需恢复任何状态，行为稳定
- 避免对现有 `useEditorReadOnly` 消费者（PropertyPanel/CompositionPopover/Timeline/EditorToolbar）造成副作用
- 实现最简，零侵入

**唯一例外：** zoom 滑块在表格视图下 **disabled**（表格视图无缩放概念，保留可交互会让用户困惑）。其他工具栏按钮（undo/redo/lock/composition/statData 等）原状保留，功能不变。实现方式：`EditorToolbar` 接收一个 `isTableView` prop，仅用来控制 zoom 滑块的 `disabled` 属性。

### 决策 3：单元格亮起规则

**选择：纯 castEvent 窗口判定**

```
亮起(damageEvent, playerA, actionX) ⟺
  ∃ castEvent : castEvent.playerId === playerA
             && castEvent.actionId === actionX
             && castEvent.timestamp ≤ damageEvent.time
             && damageEvent.time < castEvent.timestamp + action.duration
```

- 亮起样式：统一背景色 `bg-primary/20`，**无文字**
- 未亮起：透明背景

**理由：**

- 不依赖 `MitigationStatus` / `appliedStatuses`，避免编辑模式和回放模式数据来源不对称的复杂性
- 不需要引入 calculator 集成，也不需要抽取 executor 模拟
- 与时间轴视图"能看到该 cast 的卡片横条"一致——castEvent 横条覆盖的时间点，即表格中对应单元格亮起的时间点
- 二元状态（亮/不亮）实现最简，视觉上扫视最快

**覆盖逻辑排除：** `Timeline/index.tsx:296-319` 的 `Seraphism → Accession` 覆盖仅影响 cast 图标显示，不影响行归属和持续时间。降临之章 (37016) `hidden: true` 不在 `skillTracks` 中，表格视图无此列，覆盖逻辑完全忽略。

### 决策 4：技能列派生

**选择：抽取 `useSkillTracks(timeline, hiddenPlayerIds)` hook，两视图共用**

从 `Timeline/index.tsx:237-253` 提取以下逻辑到 `src/hooks/useSkillTracks.ts`：

```typescript
const sortedPlayers = sortJobsByOrder(composition.players, p => p.job)
const skillTracks: SkillTrack[] = []
sortedPlayers.forEach(player => {
  if (hiddenPlayerIds.has(player.id)) return
  const jobActions = actions.filter(a => a.jobs.includes(player.job) && !a.hidden)
  jobActions.forEach(action => {
    skillTracks.push({ job, playerId, actionId, actionName, actionIcon })
  })
})
```

`Timeline/index.tsx` 和 `TimelineTable` 都调用这个 hook，保证**顺序、过滤规则、响应的 store 状态完全一致**。

**职业/玩家显隐：** 直接复用 `uiStore.hiddenPlayerIds`，与时间轴视图共享同一份状态。用户通过现有 `CompositionPopover` 控制，不新增 UI。

### 决策 5：行结构与排序

**选择：所有伤害事件作为行，注释插入独立行**

- 所有 `timeline.damageEvents`（AoE 和 tankbuster）均作为行，不作类型筛选
- 所有 `timeline.annotations` 均作为独立行，忽略 `anchor.type`
- 按 `time` 升序排序
- 同一 `time` 下：**注释行排在伤害事件行之前**（用户可先读到上下文说明）

### 决策 6：伤害数值来源

| 模式 | 类型 | 原始伤害                                                     | 实际伤害                        |
| ---- | ---- | ------------------------------------------------------------ | ------------------------------- |
| 编辑 | AoE  | `CalculationResult.originalDamage`                           | `CalculationResult.finalDamage` |
| 编辑 | 死刑 | `event.damage`                                               | `—`（calculator 跳过死刑）      |
| 回放 | AoE  | `useDamageCalculation` 现有结果（`max(原始)` / `max(最终)`） | 同左                            |
| 回放 | 死刑 | 目标坦克的 `unmitigatedDamage`                               | 目标坦克的 `finalDamage`        |

**理由：** 与 `useDamageCalculation` 现有行为严格一致，避免表格与时间轴卡片出现数值差异。

### 决策 7：列结构与尺寸

| 列       | 宽度  | 粘性 | 显隐                         |
| -------- | ----- | ---- | ---------------------------- |
| 时间     | 72px  | 左   | 常显                         |
| 事件名   | 160px | 左   | 常显                         |
| 原始伤害 | 80px  | 左   | `uiStore.showOriginalDamage` |
| 实际伤害 | 80px  | 左   | `uiStore.showActualDamage`   |
| 技能列   | 40px  | 无   | `uiStore.hiddenPlayerIds`    |

**约束：**

- 技能单元格保持**正方形 40×40**
- 数据行高 **40px**（与技能单元格同高）
- 注释行高按内容自适应（`whitespace-pre-wrap`，文字可能含换行）
- 表头粘性顶部，前 2-4 列粘性左侧（粘性列数量随原始/实际列显隐动态变化）
- 列头渲染：职业小图标 + 技能图标，hover/click 触发现有 `ActionTooltip`
- 列按玩家分组，玩家内部列交替底色 (`bg-muted/20`)，玩家间加粗竖向分隔线

### 决策 8：交互

- **Hover 行**：整行背景 → `bg-muted/50`，纯视觉反馈
- **点击行**：无操作
- **点击单元格**：无操作
- **点击列头**：触发 `ActionTooltip`（与时间轴列头一致）
- **滚动**：原生浏览器滚动，表头和前几列通过 CSS `position: sticky` 固定

### 决策 9：时间格式

`mm:ss.f` 一位小数。例如 `0:32.5`、`10:08.3`。

**理由：** spec 原文使用单数 `.f`，FF14 GCD 2.5 秒量级，一位精度足够。

### 决策 10：空状态

无占位。

- 无伤害事件 → 表格只渲染列头
- 无阵容 / 无技能列 → 表格只渲染前 2-4 列

## 架构

### 新增文件

```
src/
├── components/
│   └── TimelineTable/
│       ├── index.tsx              # 主组件 TimelineTableView
│       ├── TableHeader.tsx        # 列头行（含粘性）
│       ├── TableRow.tsx           # 普通伤害事件行
│       ├── AnnotationRow.tsx      # 注释行
│       ├── constants.ts           # 布局常量
│       └── __tests__/
│           └── TimelineTable.test.tsx
├── hooks/
│   └── useSkillTracks.ts          # 技能列派生（Timeline 与 TimelineTable 共用）
└── utils/
    └── timeFormat.ts              # mm:ss.f 格式化（若不存在则新增；若存在则复用）
```

### 修改文件

- `src/pages/EditorPage.tsx`
  - 新增 `useSearchParams()` 读取 `viewMode`
  - 主内容区按 `viewMode` 条件渲染 `<TimelineCanvas>` / `<TimelineTableView>`
  - 注意：`TimelineMinimap` 是 `TimelineCanvas` 的内部子组件，替换在 `EditorPage` 层完成即可，表格视图天然占满原 TimelineCanvas + minimap 的完整区域，无需额外处理
- `src/components/EditorToolbar.tsx`
  - 视图菜单顶部加 `DropdownMenuRadioGroup`（时间轴视图 / 表格视图）
  - 从 `EditorPage` 通过 props 或 `useSearchParams()` 获取当前 viewMode
- `src/components/Timeline/index.tsx`
  - 将 `skillTracks` 派生逻辑替换为调用 `useSkillTracks()` hook
  - 验证替换后行为无变化（测试保证）

### 数据流

```
EditorPage
  ├─ useSearchParams() → viewMode
  ├─ useDamageCalculation(timeline) → Map<eventId, CalculationResult>
  └─ DamageCalculationContext.Provider
       ├─ viewMode === 'timeline' → <TimelineCanvas>
       │                                 └─ useSkillTracks()
       └─ viewMode === 'table'    → <TimelineTableView>
                                         ├─ useSkillTracks()
                                         ├─ useContext(DamageCalculationContext)
                                         └─ useUIStore(showActualDamage, showOriginalDamage)
```

`TimelineTableView` 内部派生出合并后的行列表（伤害事件 + 注释按 time 排序），遍历渲染。

### 组件职责

**`TimelineTableView`（`index.tsx`）**

- 读取 `timeline`、`skillTracks`、`calculationResults`、`uiStore`
- 合并并排序行：`mergeAndSortRows(damageEvents, annotations)`
- 渲染 `<table>` 结构：`<thead><TableHeader/></thead><tbody>{rows.map...}</tbody>`

**`TableHeader`**

- 渲染粘性顶部行
- 第一组：时间、事件名、原始、实际（前 2-4 列粘性左侧）
- 第二组：技能列头，复用 `ActionTooltip` hover/click 机制

**`TableRow`**

- 渲染一个伤害事件行
- 前 2-4 个单元格为粘性左侧
- 技能列遍历 `skillTracks`，每列判定 cast 窗口命中

**`AnnotationRow`**

- 渲染独占一行，文字跨全部列合并 (`colSpan`)
- 时间列显示 `mm:ss.f`
- 文字区斜体 + 前缀图标 + `whitespace-pre-wrap`

## 边界情况

- **castEvent 持续时间包含未来伤害事件**：正确，cast 窗口内所有伤害事件都命中该列
- **同一玩家同一技能在短时间内多次使用**：表格只看"某个伤害事件时刻是否处于某次 cast 窗口内"，多次使用不产生重复亮起（亮 or 不亮是二元的）
- **castEvent.timestamp 或 duration 为负值**：数据异常，亮起判定仍返回 false（无伤害事件会落在无效区间）
- **damageEvent.time === castEvent.timestamp + duration**：边界取 `<`（严格小于），cast 窗口不含结束时刻
- **伤害事件无 `playerDamageDetails`（回放 + AoE）**：`useDamageCalculation` 已跳过返回，表格数值列显示 `—`
- **`hidden: true` 的 action**：不进 `skillTracks`，无对应列。castEvent 指向 hidden action 时无法亮起任何列（对用户不可见，这是可接受的——降临之章就是这种情况）
- **composition 为空**：`skillTracks` 为空，表格只有前几列
- **annotations 与伤害事件 time 完全相等**：注释行排在伤害事件行前

## 测试计划

**文件：** `src/components/TimelineTable/__tests__/TimelineTable.test.tsx`

- cast 窗口边界判定
  - `castTime === damageTime` → 亮起
  - `castTime + duration === damageTime` → 不亮起（严格小于）
  - `castTime + duration > damageTime` → 亮起
  - 不同玩家 / 不同 actionId → 不亮起
- 行合并与排序
  - 只有伤害事件 → 按 time 升序
  - 只有注释 → 按 time 升序
  - 混合 → 按 time 升序，同 time 注释前置
- 死刑行的伤害显示
  - 编辑模式：原始 = `event.damage`，实际 = `—`
  - 回放模式：显示 `playerDamageDetails` 中目标坦克的数值
- AoE 行的伤害显示
  - 编辑 / 回放两种模式与 `useDamageCalculation` 结果一致
- `hiddenPlayerIds` 影响技能列
- `showOriginalDamage` / `showActualDamage` 影响列显隐
- 视图模式切换
  - `?view=table` → 渲染表格组件
  - 无参数 / `?view=timeline` → 渲染 Canvas 组件

**文件：** `src/hooks/__tests__/useSkillTracks.test.ts`（可选——若逻辑简单可并入上面的测试）

- 与 `Timeline/index.tsx` 原逻辑输出一致
- `hiddenPlayerIds` 正确过滤
- 按职业顺序排序正确
- `action.hidden` 正确过滤

**回归测试：** 确认修改 `Timeline/index.tsx` 后原有测试全部通过。

## 风险与取舍

| 风险                                                                        | 影响 | 缓解                                                                                                                               |
| --------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 单元格不显示数值 → 用户无法在表格内判断减伤强度                             | 中   | 这是明确的 YAGNI 取舍，未来可按需补充；用户需要精确数值时切回时间轴查看                                                            |
| 表格列数极多时横向滚动严重                                                  | 低   | 40px 列宽下 20 列才 800px，典型阵容（4-8 玩家，每人 3-5 技能）列数在 30 以内，1440 屏基本无压力；前几列粘性保证时间/事件名始终可见 |
| 视图模式切换时 `TimelineCanvas` / `TimelineTableView` 挂载/卸载可能造成闪烁 | 低   | 两者互斥渲染，React 重挂载成本可接受；若发现卡顿可改为 `display: none` 保留 DOM                                                    |
| `useSkillTracks` 抽取后 `Timeline/index.tsx` 可能丢失对某些依赖的 memo 优化 | 低   | 抽取时保持 `useMemo` 语义不变；运行测试验证                                                                                        |

## 未来扩展

- 按需加回单元格数值显示（百分比/盾值），需重新评估数据来源
- 导出为 PNG / PDF
- 列头固定勾选过滤（隐藏特定技能列，而不是隐藏整个玩家）
- 行勾选导出局部
