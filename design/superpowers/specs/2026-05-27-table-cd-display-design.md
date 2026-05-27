# 表格视图补充冷却（CD）显示

> 对应 issue #4。让表格视图与时间轴视图在 CD 信息上对齐：同一语义、同一数据来源。

## 背景

表格视图（`src/components/TimelineTable/`）当前每个技能列只显示两类信息：

- **绿底**：duration 覆盖区间（`computeLitCellsByEvent`）
- **cast 起点图标**（`computeCastMarkerCells`）

而时间轴视图（Canvas）在绿条之后还画一段**蓝色 CD 条**，表示「这次 cast 把资源池打空、直到恢复的时段」。两种视图信息不一致，排轴细调时表格难以判断技能是否还在冷却，只能靠点击确认。

## 目标

在表格视图为每个技能列补充 CD 显示，**复用时间轴的同一数据来源与同一语义**，所有编辑模式（local / author / view）一律展示。

## 数据来源（与时间轴同源）

时间轴蓝条右端的唯一可信源是 `PlacementEngine.cdBarEndFor(castEventId)`：

- `null` → 此 cast 不画 CD（无消费者，或资源池未被打空）
- `Infinity` → CD 延伸到时间轴末尾
- 数值 → CD 区间右端的秒数

`PlacementEngine` 已在 `TimelineTable/index.tsx` 中构造（用于单元格放置 / 变体选择），直接复用其 `cdBarEndFor`，无需新建引擎或新数据通路。

每个 cast 的 CD 区间定义为 `[greenEnd, rawEnd)`：

- `greenEnd = cast.timestamp + action.duration` —— 与表格现有绿格判定（`computeLitCellsByEvent`）**同一基准**，保证表格内绿 / 蓝衔接无缝、不重叠。
- `rawEnd = cdBarEndFor(ce.id)`（`Infinity` 表示延伸到时间轴末）。

> **关于 greenEnd 基准的说明**：Canvas 的 `greenEnd` 取 simulate 的 `castEffectiveEnd`（buff 实际存活区间），而表格绿格历来用 `action.duration`。这是表格**既有**的选择。本设计让蓝条起点对齐表格自己的绿格末端，不引入新的不一致；不去改表格绿格的基准（超出本 issue 范围）。

## 离散映射

表格是「行 = 伤害事件、列 = 技能轨道」的离散网格，没有连续时间轴。现有 `computeLitCellsByEvent` 已把连续覆盖区间映射成「某伤害事件时刻落在某 cast 窗口内 → 该格亮起」。CD 显示照搬此套路。

新增 `computeCdCellsByEvent` 于 `src/utils/castWindow.ts`，与 `computeLitCellsByEvent` 并列：

```
computeCdCellsByEvent(
  damageEvents,
  castEvents,
  actionsById,
  cdBarEndFor: (castEventId: string) => number | null
): Map<string, Set<string>>   // Map<damageEventId, Set<cellKey>>
```

逻辑：

1. 遍历每个 `castEvent`：
   - `rawEnd = cdBarEndFor(ce.id)`；`null` → 跳过。
   - `action = actionsById.get(ce.actionId)`；缺失 → 跳过。
   - `greenEnd = ce.timestamp + action.duration`。
   - `cdEnd = rawEnd === Infinity ? Infinity : rawEnd`。
2. 对每个满足 `greenEnd <= event.time < cdEnd` 的伤害事件，按 `castCellKey(ce, actionsById)`（按 `trackGroup` 归类，与绿格 / marker 完全一致，变体如 37016 归到 parent 37013 列）加入该事件的 cell 集合。
3. 返回 `Map<damageEventId, Set<cellKey>>`。

`Infinity` 天然无需 maxTime 钳制：`event.time < Infinity` 恒真，所有后续行都计入 CD。

## 渲染（`TableDataRow.tsx`）

新增 prop `cdCells: Set<string>`。在每个技能格内，绿底层旁追加一层蓝底层，**绿优先于蓝**（同格若既绿又蓝，只显绿——与时间轴「绿条压蓝条」一致；理论上二者区间不相交，此优先级仅作防御）：

```tsx
{
  isLit && <div className="absolute inset-0 bg-emerald-500/30" />
}
{
  !isLit && cdCells.has(key) && <div className="absolute inset-0 bg-blue-500/15" />
}
```

配色与时间轴对齐：绿 `#10b981`(emerald-500)、蓝 `#3b82f6`(blue-500)。蓝底透明度（`/15`）取得比绿底（`/30`）更淡，弱化为次要信息，确保 marker 图标与底色叠加后仍可读。marker `<img>` 的 z 序在底色 `div` 之上，不受影响。

## 接线（`TimelineTable/index.tsx`）

新增 `cdCellsByEvent` useMemo：

```ts
const cdCellsByEvent = useMemo(() => {
  if (!timeline || !engine) return new Map<string, Set<string>>()
  return computeCdCellsByEvent(
    filteredDamageEvents,
    filteredCastEvents,
    actionsById,
    engine.cdBarEndFor
  )
}, [timeline, engine, filteredDamageEvents, filteredCastEvents, actionsById])
```

向 `TableDataRow` 传 `cdCells={cdCellsByEvent.get(row.id) ?? new Set()}`。

不区分编辑模式，所有模式（local / author / view）一律显示，达成信息对齐。

## 测试

在 `src/utils/castWindow.test.ts` 补 `computeCdCellsByEvent` 用例：

- **基本区间映射**：`greenEnd <= t < rawEnd` 的伤害事件被标记，区间外不标。
- **`null` 不画**：`cdBarEndFor` 返回 `null` 时该 cast 不产生任何 CD 格。
- **`Infinity` 延伸到末尾**：所有 `t >= greenEnd` 的后续行都计入。
- **绿 / 蓝衔接边界**：`t === greenEnd` 当刻归蓝（不归绿），`t === rawEnd` 当刻不归蓝（左闭右开）。
- **trackGroup 变体归列**：变体 cast（挂在 parent 轨道）的 CD 归到 parent 列的 cellKey。

## 影响范围

| 文件                                            | 改动                                 |
| ----------------------------------------------- | ------------------------------------ |
| `src/utils/castWindow.ts`                       | 新增 `computeCdCellsByEvent`         |
| `src/utils/castWindow.test.ts`                  | 新增上述用例                         |
| `src/components/TimelineTable/TableDataRow.tsx` | 新增 `cdCells` prop + 蓝底渲染       |
| `src/components/TimelineTable/index.tsx`        | 新增 `cdCellsByEvent` useMemo + 传参 |

无新依赖、不改 Canvas、不改资源模型、不改 `cdBarEndFor` 本身。

## 非目标（YAGNI）

- 不在表格显示 CD 剩余秒数文本（时间轴蓝条末端有文本，但表格离散网格无合适落点；本 issue 只要求「能看出是否在冷却」）。
- 不统一表格绿格与 Canvas 绿条的 `greenEnd` 基准（`duration` vs `castEffectiveEnd`），属既有差异、超出范围。
- 不为 CD 格添加交互（点击行为维持现状：CD 格视作空白格，沿用 `handleCellToggle` 的放置 / 拒绝逻辑）。
