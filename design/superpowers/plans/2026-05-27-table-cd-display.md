# 表格视图 CD 显示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在表格视图为每个技能列补充蓝色 CD 显示，复用时间轴 `PlacementEngine.cdBarEndFor` 的同一数据来源与语义。

**Architecture:** 新增纯函数 `computeCdCellsByEvent` 把每个 cast 的 CD 区间 `[greenEnd, rawEnd)` 离散映射到伤害事件单元格（照搬现有 `computeLitCellsByEvent` 套路）；`TableDataRow` 在绿底旁加一层更淡的蓝底（绿优先于蓝）；`index.tsx` 用 useMemo 接线，传入已构造的 engine 的 `cdBarEndFor`。

**Tech Stack:** React 19 + TypeScript，Vitest 4，pnpm。配色 Tailwind（emerald-500 / blue-500）。

设计文档：`design/superpowers/specs/2026-05-27-table-cd-display-design.md`

---

## 背景速览（实施者必读）

- 表格视图：行 = 伤害事件（`DamageEvent`，有 `time` 字段），列 = 技能轨道（`SkillTrack`，列 key 是 `trackGroup` id）。
- 单元格命中靠纯函数把「连续区间」映射成「某伤害事件时刻落在区间内 → 该格亮起」。绿底已有 `computeLitCellsByEvent`（`src/utils/castWindow.ts`）。
- CD 数据源：`PlacementEngine.cdBarEndFor(castEventId)` 返回 `number | null`：`null`=不画；`Infinity`=延伸到时间轴末；数值=CD 右端秒数。engine 已在 `TimelineTable/index.tsx` 构造。
- 每个 cast 的 CD 区间 = `[greenEnd, rawEnd)`，`greenEnd = cast.timestamp + action.duration`（与绿格同基准），`rawEnd = cdBarEndFor(ce.id)`。
- `castCellKey`（castWindow.ts 内私有函数）把 cast 按 `action.trackGroup ?? actionId` 归到列 key，变体（如 37016）归到 parent 列。`computeLitCellsByEvent` 用的就是它，CD 必须复用同一归类。

---

## File Structure

| 文件                                            | 责任                 | 改动                                 |
| ----------------------------------------------- | -------------------- | ------------------------------------ |
| `src/utils/castWindow.ts`                       | 单元格命中纯函数集合 | 新增 `computeCdCellsByEvent`         |
| `src/utils/castWindow.test.ts`                  | 上述纯函数的单测     | 新增 `computeCdCellsByEvent` 用例    |
| `src/components/TimelineTable/TableDataRow.tsx` | 渲染单行（含技能格） | 新增 `cdCells` prop + 蓝底层         |
| `src/components/TimelineTable/index.tsx`        | 表格主组件，数据接线 | 新增 `cdCellsByEvent` useMemo + 传参 |

---

## Task 1: `computeCdCellsByEvent` 纯函数（TDD）

**Files:**

- Modify: `src/utils/castWindow.ts`（在文件末尾、`computeCastMarkerCells` 之后新增函数；复用文件内已有的私有 `castCellKey`）
- Test: `src/utils/castWindow.test.ts`（新增一个 `describe` 块）

- [ ] **Step 1: 写失败测试**

在 `src/utils/castWindow.test.ts` 末尾、`describe('cellKey', ...)` 之前插入。先把顶部 import 改为同时引入新函数：

```ts
import { computeLitCellsByEvent, computeCdCellsByEvent, cellKey } from './castWindow'
```

新增 describe 块（复用文件已有的 `damage` / `cast` / `action` 工厂）：

```ts
describe('computeCdCellsByEvent', () => {
  // cdBarEndFor 桩：按 castEventId 返回预置的 rawEnd
  const stubCd = (map: Record<string, number | null>) => (id: string) => map[id] ?? null

  it('greenEnd <= damageTime < rawEnd 时标记为 CD', () => {
    const actionsById = new Map([[100, action(100, 10)]]) // duration=10
    const cd = stubCd({ c1: 30 }) // cast@0 → greenEnd=10, rawEnd=30 → CD 区间 [10,30)
    const result = computeCdCellsByEvent(
      [damage('d1', 15)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      cd
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
  })

  it('damageTime === greenEnd 当刻归 CD（左闭）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const cd = stubCd({ c1: 30 })
    const result = computeCdCellsByEvent(
      [damage('d1', 10)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      cd
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
  })

  it('damageTime === rawEnd 当刻不归 CD（右开）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const cd = stubCd({ c1: 30 })
    const result = computeCdCellsByEvent(
      [damage('d1', 30)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      cd
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false)
  })

  it('绿条覆盖区间内（< greenEnd）不归 CD', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const cd = stubCd({ c1: 30 })
    const result = computeCdCellsByEvent(
      [damage('d1', 5)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      cd
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false)
  })

  it('cdBarEndFor 返回 null 时该 cast 不产生 CD', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const cd = stubCd({ c1: null })
    const result = computeCdCellsByEvent(
      [damage('d1', 15)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      cd
    )
    expect(result.get('d1')?.size).toBe(0)
  })

  it('rawEnd 为 Infinity 时延伸到时间轴末（所有 t >= greenEnd 的后续行）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const cd = stubCd({ c1: Infinity }) // greenEnd=10
    const result = computeCdCellsByEvent(
      [damage('d1', 5), damage('d2', 50), damage('d3', 9999)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      cd
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false) // 还在绿条内
    expect(result.get('d2')?.has(cellKey(1, 100))).toBe(true)
    expect(result.get('d3')?.has(cellKey(1, 100))).toBe(true)
  })

  it('trackGroup 变体的 CD 归到 parent 列', () => {
    // 200 是 100 的变体（trackGroup=100），CD 应落在 cellKey(1,100) 而非 cellKey(1,200)
    const variant = { ...action(200, 10), trackGroup: 100 } as MitigationAction
    const actionsById = new Map<number, MitigationAction>([
      [100, action(100, 10)],
      [200, variant],
    ])
    const cd = stubCd({ c1: 30 })
    const result = computeCdCellsByEvent(
      [damage('d1', 15)],
      [cast('c1', 1, 200, 0)],
      actionsById,
      cd
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
    expect(result.get('d1')?.has(cellKey(1, 200))).toBe(false)
  })

  it('actionsById 中不存在的 actionId 被跳过', () => {
    const actionsById = new Map<number, MitigationAction>()
    const cd = stubCd({ c1: 30 })
    const result = computeCdCellsByEvent(
      [damage('d1', 15)],
      [cast('c1', 1, 999, 0)],
      actionsById,
      cd
    )
    expect(result.get('d1')?.size).toBe(0)
  })

  it('每个伤害事件都有一个 Set（可能为空）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const result = computeCdCellsByEvent(
      [damage('d1', 100), damage('d2', 200)],
      [],
      actionsById,
      () => null
    )
    expect(result.get('d1')).toEqual(new Set())
    expect(result.get('d2')).toEqual(new Set())
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run src/utils/castWindow.test.ts`
Expected: FAIL —— `computeCdCellsByEvent is not a function` / import 报错。

- [ ] **Step 3: 实现函数**

在 `src/utils/castWindow.ts` 末尾（`computeCastMarkerCells` 之后）新增。`castCellKey` 已在文件内定义，直接复用：

```ts
/**
 * 计算每个伤害事件落在哪些 cast 的"蓝色 CD 区间"内。
 *
 * 与时间轴蓝条同源：CD 右端来自 `cdBarEndFor(castEventId)`
 *   - null     → 此 cast 不画 CD
 *   - Infinity → CD 延伸到时间轴末尾
 *   - 数值     → CD 右端秒数
 *
 * 每个 cast 的 CD 区间 = [greenEnd, rawEnd)，greenEnd = cast.timestamp + action.duration
 * （与 computeLitCellsByEvent 的绿格同基准，保证绿/蓝衔接无缝、不重叠）。
 * 命中规则：greenEnd <= damageEvent.time < rawEnd（左闭右开；Infinity 恒真）。
 * 归列同绿格：按 castCellKey（trackGroup 变体归 parent 列）。
 *
 * @returns Map<damageEventId, Set<cellKey>>
 */
export function computeCdCellsByEvent(
  damageEvents: DamageEvent[],
  castEvents: CastEvent[],
  actionsById: Map<number, MitigationAction>,
  cdBarEndFor: (castEventId: string) => number | null
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  for (const event of damageEvents) result.set(event.id, new Set<string>())

  for (const castEvent of castEvents) {
    const action = actionsById.get(castEvent.actionId)
    if (!action) continue
    const rawEnd = cdBarEndFor(castEvent.id)
    if (rawEnd === null) continue
    const greenEnd = castEvent.timestamp + action.duration
    const key = castCellKey(castEvent, actionsById)
    for (const event of damageEvents) {
      if (greenEnd <= event.time && event.time < rawEnd) {
        result.get(event.id)!.add(key)
      }
    }
  }
  return result
}
```

> 注：`event.time < rawEnd` 在 `rawEnd === Infinity` 时恒为 true，无需特判。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run src/utils/castWindow.test.ts`
Expected: PASS（新 describe 全绿，原 `computeLitCellsByEvent` / `cellKey` 用例不受影响）。

- [ ] **Step 5: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit; if ($?) { pnpm lint }`
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add src/utils/castWindow.ts src/utils/castWindow.test.ts
git commit -m "feat(table): add computeCdCellsByEvent for CD cell mapping"
```

---

## Task 2: `TableDataRow` 渲染蓝色 CD 底

**Files:**

- Modify: `src/components/TimelineTable/TableDataRow.tsx`（`TableDataRowProps` 接口 + 函数签名解构 + 技能格渲染）

本任务为纯 UI 渲染，无独立单测（表格行渲染无现成测试基建）；正确性由 Task 3 接线后通过 `pnpm build` 与手动检查兜底。

- [ ] **Step 1: 给 props 接口加 `cdCells`**

在 `TableDataRowProps` 接口中，`litCells: Set<string>` 一行之后新增：

```ts
/** 处于蓝色 CD 区间的单元格（与 litCells 互斥优先级：绿优先于蓝） */
cdCells: Set<string>
```

- [ ] **Step 2: 函数签名解构里加 `cdCells`**

在 `export default function TableDataRow({ ... })` 的解构参数中，`litCells,` 之后新增一行：

```ts
  cdCells,
```

- [ ] **Step 3: 技能格内渲染蓝底层**

在技能列 `<td>` 内部，找到这一行：

```tsx
{
  isLit && <div className="absolute inset-0 bg-emerald-500/30" />
}
```

在其紧后新增一行（绿优先于蓝：仅当未亮绿且命中 CD 时画蓝）：

```tsx
{
  !isLit && cdCells.has(key) && (
    <div className="pointer-events-none absolute inset-0 bg-blue-500/15" />
  )
}
```

- [ ] **Step 4: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 报错 —— `index.tsx` 调用 `<TableDataRow>` 缺少必填 prop `cdCells`。这是预期的，Task 3 修复。

> 若希望本任务可独立编译通过，可临时将 prop 设为可选并在用法处 `cdCells={cdCells ?? new Set()}`；但本计划在 Task 3 立即补齐，保持必填更安全。本步骤确认报错点仅为 `index.tsx` 缺 prop 即可，先不 commit。

---

## Task 3: `index.tsx` 接线并传参

**Files:**

- Modify: `src/components/TimelineTable/index.tsx`（import + useMemo + JSX 传参）

- [ ] **Step 1: 引入 `computeCdCellsByEvent`**

找到这一行：

```ts
import { computeCastMarkerCells, computeLitCellsByEvent } from '@/utils/castWindow'
```

改为：

```ts
import {
  computeCastMarkerCells,
  computeCdCellsByEvent,
  computeLitCellsByEvent,
} from '@/utils/castWindow'
```

- [ ] **Step 2: 新增 `cdCellsByEvent` useMemo**

在 `markerCellsByEvent` 的 useMemo 块（以 `const markerCellsByEvent = useMemo(...)` 结尾，依赖数组 `[timeline, filteredDamageEvents, filteredCastEvents, actionsById]`）之后新增：

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

- [ ] **Step 3: 给 `<TableDataRow>` 传 `cdCells`**

找到渲染 `<TableDataRow ... />` 处，在这一行：

```tsx
                  litCells={litCellsByEvent.get(row.id) ?? new Set()}
```

紧后新增：

```tsx
                  cdCells={cdCellsByEvent.get(row.id) ?? new Set()}
```

- [ ] **Step 4: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit; if ($?) { pnpm lint }`
Expected: 无错误（Task 2 的缺 prop 报错此时消失）。

- [ ] **Step 5: 构建兜底 + 全量测试**

Run: `pnpm build; if ($?) { pnpm test:run }`
Expected: 构建成功；全量测试通过。

- [ ] **Step 6: Commit**

```bash
git add src/components/TimelineTable/TableDataRow.tsx src/components/TimelineTable/index.tsx
git commit -m "feat(table): render blue CD background in skill cells"
```

---

## Task 4: 手动验证（人工检查点）

无代码改动。实施者完成后由用户确认：

- [ ] **Step 1: 启动 / 复用 dev server**，打开一个有 FFLogs 导入数据或已排了长 CD 减伤的时间轴，切到表格视图。
- [ ] **Step 2: 对照时间轴视图**：找一个有蓝色 CD 条的技能（如长 CD 减伤），确认表格里同一技能列在「绿底之后、库存恢复之前」的行显示淡蓝底；恢复后的行无蓝底。
- [ ] **Step 3: 多充能技能**（如献奉 / 慰藉这类共享池）：确认蓝底只出现在「打空池子到恢复」的行，还有库存时不显示蓝底——与时间轴蓝条语义一致。
- [ ] **Step 4: 三种模式**（local / author / view）均能看到蓝底。

---

## Self-Review 记录

- **Spec 覆盖**：数据来源(Task 1/3)、离散映射(Task 1)、渲染绿优先于蓝(Task 2)、接线全模式(Task 3)、五类测试用例(Task 1 Step 1)、手动验证(Task 4) —— 全部覆盖。非目标（剩余秒数文本、greenEnd 基准统一、CD 格交互）均未引入。
- **占位符**：无 TBD / TODO，所有代码步骤含完整代码。
- **类型一致**：函数签名 `computeCdCellsByEvent(damageEvents, castEvents, actionsById, cdBarEndFor)` 在 Task 1 定义、Task 3 调用一致；prop `cdCells: Set<string>` 在 Task 2 定义、Task 3 传入一致；`engine.cdBarEndFor` 签名 `(castEventId: string) => number | null` 与参数类型一致。
