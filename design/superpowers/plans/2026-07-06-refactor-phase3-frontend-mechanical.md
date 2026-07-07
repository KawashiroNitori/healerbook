# 结构重构第三期：前端机械抽取 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除前端重复样板（selector 化 14 处整对象订阅、抽取 8 个共享函数/hook、协议常量单源化、文件改名搬家），并清掉前两期积累的 7 项备忘。

**Architecture:** 全部是「抽函数/hook + 全局替换」型低风险重构，靠 tsc + 1143 个既有测试兜底；两个大文件（Timeline/index.tsx、EditorToolbar.tsx）的 selector 化与轨道索引抽取需人工回归提示。新共享代码归属既有概念文件（statusRegistry / skillTracks / formatters / kvKeys / apiContracts），仅在无自然归宿时新建文件。

**Tech Stack:** React 19 + TypeScript 5.9、Zustand 5（`useShallow` 自 `zustand/react/shallow`）、Vitest 4、nanoid。

## Global Constraints

- **验证命令**（每任务提交前）：`pnpm test:run`、`pnpm exec tsc -b --noEmit`（必须带 `-b`）、`pnpm lint`；触碰 `src/workers/` 的任务加 `pnpm test:workers`；Task 11 加 `pnpm build` + dist grep。
- **提交信息不得包含 "claude" 字样**（大小写不敏感，hook 会拒绝；"CLAUDE.md" 也命中——用「项目指南」指代）。不加 Co-Authored-By。
- plan 内声明的 `git commit` / `git mv` / `git rm` 可自主执行且必须执行（不要停在 staged）；`git push` 与破坏性 Git 操作任何时候禁止。
- 提交用 `git add <具体文件>`，不用 `git add -A`。
- **行为等价**，除以下声明的行为变更：
  1. **减伤展示口径修复**：`PlayerDamageDetails.tsx` 2 处与 `Timeline/index.tsx` 导出文本 3 处的乘率读取改为 `status.performance ?? meta.performance`（快照优先，与计算引擎及 PropertyPanel 口径一致；原实现只读 `meta.performance`，status 带 snapshot 时展示与实际计算不符）。
  2. **导入错误提示统一**：`ImportIntoTimelineDialog` 的 FFLogs 解析失败提示采用 `ImportFFLogsDialog` 的 API Token/Key 特判文案。
  3. **executors instanceId 字符集**从 nanoid 默认（含 `_-`）换为项目统一纯字母数字（21 位不变）——instanceId 纯运行时、不持久化、无格式断言，不可观察。
  4. `preloadIcons` 若核实零消费则删除（死代码）。
  5. `.env.example` 删除死配置 `VITE_API_BASE_URL`。
- **明确不做**（保持现状）：`TimeRuler.tsx` 的整数秒 `formatTime` 不接入 `splitDeciseconds`（无十分位需求，强行统一是过度抽象）；`data/mitigationActions.ts` 的 6 处 `__cd__:` 静态数据字面量不动；`autoMitigation/scope.ts:14` 的 `1_000_000` 是无关伤害阈值不并入 `STATUS_ABILITY_OFFSET`；所有 `useXxxStore.getState()` 命令式读取不改成响应式订阅（特别是 `TimelineMinimap.tsx` 的 `statistics` 读取是有意跳过订阅）；`AuthContext`/`AuthProvider` 三层包装结构与 `value` 对象构造不动（第五期）；测试文件中的 `tl-snapshot:` 字面量保留（黑盒契约断言价值）。
- 文中行号为 2026-07-06 研究快照，执行时以实际代码为准。

---

### Task 1: selector 化——9 处简单订阅

**Files:**

- Modify: `src/components/AddEventDialog.tsx:34`、`src/pages/CallbackPage.tsx:13`、`src/components/CompositionPopover.tsx:12`、`src/components/StatDataDialog.tsx:359`、`src/components/TimelineTable/TableHeader.tsx:40`、`src/components/TooltipOverlay.tsx:6`、`src/components/Timeline/TimelineMinimap.tsx:54`、`src/components/AuthProvider.tsx:12`、`src/components/PropertyPanel.tsx:49`

**Interfaces:**

- Consumes: `useShallow`（`zustand/react/shallow`，仓内已有用法样板 `Timeline/index.tsx:257`）
- Produces: 无新导出；订阅粒度收窄，行为等价

**通用规则**：action 在 zustand 中引用稳定，单独 `useStore(s => s.actionName)` 取；1-2 个 state 字段逐字段 selector；3+ state 字段用 `useShallow` 聚合对象。禁止把 `.getState()` 命令式读取改成响应式订阅。

- [ ] **Step 1: 逐文件替换**

单字段/双字段（直接替换整对象解构为逐行 selector）：

```tsx
// AddEventDialog.tsx
const addDamageEvent = useTimelineStore(s => s.addDamageEvent)

// CallbackPage.tsx（useEffect 空依赖数组的 eslint-disable 保持不动）
const setTokens = useAuthStore(s => s.setTokens)

// StatDataDialog.tsx
const timeline = useTimelineStore(s => s.timeline)
const updateStatData = useTimelineStore(s => s.updateStatData)

// TableHeader.tsx
const showTooltip = useTooltipStore(s => s.showTooltip)
const toggleTooltip = useTooltipStore(s => s.toggleTooltip)
const hideTooltip = useTooltipStore(s => s.hideTooltip)

// TimelineMinimap.tsx（209 行的 useTimelineStore.getState().statistics 不许动）
const timeline = useTimelineStore(s => s.timeline)

// AuthProvider.tsx（只改订阅行；Context 结构 / value 构造 / login/logout 闭包全部不动）
const username = useAuthStore(s => s.username)
const accessToken = useAuthStore(s => s.accessToken)
const clearTokens = useAuthStore(s => s.clearTokens)

// PropertyPanel.tsx
const timeline = useTimelineStore(s => s.timeline)
const selectedEventId = useTimelineStore(s => s.selectedEventId)
const updateDamageEvent = useTimelineStore(s => s.updateDamageEvent)
const removeDamageEvent = useTimelineStore(s => s.removeDamageEvent)
```

`CompositionPopover.tsx`——采用更细粒度版本（组件只消费 `timeline.composition`），同时删除组件内原有的 `const composition = timeline?.composition || { players: [] }` 派生行：

```tsx
const composition = useTimelineStore(s => s.timeline?.composition ?? { players: [] })
const updateComposition = useTimelineStore(s => s.updateComposition)
```

注意：该 selector 返回的兜底字面量 `{ players: [] }` 在 timeline 为 null 时每次返回新对象会导致重渲染循环风险——**改为模块级常量**：

```tsx
const EMPTY_COMPOSITION = { players: [] } as Composition
// selector 内用 ?? EMPTY_COMPOSITION
```

`TooltipOverlay.tsx`（4 state 用 useShallow + 2 action 逐个）：

```tsx
import { useShallow } from 'zustand/react/shallow'

const { action, anchorRect, placementPriority, noTransition } = useTooltipStore(
  useShallow(s => ({
    action: s.action,
    anchorRect: s.anchorRect,
    placementPriority: s.placementPriority,
    noTransition: s.noTransition,
  }))
)
const showTooltip = useTooltipStore(s => s.showTooltip)
const hideTooltip = useTooltipStore(s => s.hideTooltip)
```

- [ ] **Step 2: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。

```bash
git add src/components/AddEventDialog.tsx src/pages/CallbackPage.tsx src/components/CompositionPopover.tsx src/components/StatDataDialog.tsx src/components/TimelineTable/TableHeader.tsx src/components/TooltipOverlay.tsx src/components/Timeline/TimelineMinimap.tsx src/components/AuthProvider.tsx src/components/PropertyPanel.tsx
git commit -m "refactor(store): 9 处整对象订阅改逐字段 selector，收窄订阅粒度"
```

---

### Task 2: selector 化——EditorToolbar 与 Timeline/index 两个大文件

**Files:**

- Modify: `src/components/EditorToolbar.tsx:88-113`（两处订阅）
- Modify: `src/components/Timeline/index.tsx:202-219, 225, 281`（三处订阅）

**Interfaces:**

- Consumes: Task 1 同一套规则与 `useShallow`
- Produces: 无新导出

- [ ] **Step 1: EditorToolbar.tsx**

timelineStore 部分（2 state + 7 action，全部逐字段）：

```tsx
const timeline = useTimelineStore(s => s.timeline)
const zoomLevel = useTimelineStore(s => s.zoomLevel)
const exitReplayMode = useTimelineStore(s => s.exitReplayMode)
const setZoomLevel = useTimelineStore(s => s.setZoomLevel)
const setPendingScrollProgress = useTimelineStore(s => s.setPendingScrollProgress)
const selectEvent = useTimelineStore(s => s.selectEvent)
const selectCastEvent = useTimelineStore(s => s.selectCastEvent)
const undo = useTimelineStore(s => s.undo)
const redo = useTimelineStore(s => s.redo)
```

uiStore 部分（6 state 用 useShallow + 7 action 逐个）：

```tsx
import { useShallow } from 'zustand/react/shallow'

const {
  showActualDamage,
  showOriginalDamage,
  showCastStartTime,
  enableHpSimulation,
  showResourceHover,
  canvasTool,
} = useUIStore(
  useShallow(s => ({
    showActualDamage: s.showActualDamage,
    showOriginalDamage: s.showOriginalDamage,
    showCastStartTime: s.showCastStartTime,
    enableHpSimulation: s.enableHpSimulation,
    showResourceHover: s.showResourceHover,
    canvasTool: s.canvasTool,
  }))
)
const toggleManualLock = useUIStore(s => s.toggleManualLock)
const toggleShowActualDamage = useUIStore(s => s.toggleShowActualDamage)
const toggleShowOriginalDamage = useUIStore(s => s.toggleShowOriginalDamage)
const toggleShowCastStartTime = useUIStore(s => s.toggleShowCastStartTime)
const toggleEnableHpSimulation = useUIStore(s => s.toggleEnableHpSimulation)
const toggleShowResourceHover = useUIStore(s => s.toggleShowResourceHover)
const setCanvasTool = useUIStore(s => s.setCanvasTool)
```

- [ ] **Step 2: Timeline/index.tsx**

timelineStore 部分（3 state 用 useShallow + 13 action 逐个）：

```tsx
const { timeline, zoomLevel, pendingScrollProgress } = useTimelineStore(
  useShallow(s => ({
    timeline: s.timeline,
    zoomLevel: s.zoomLevel,
    pendingScrollProgress: s.pendingScrollProgress,
  }))
)
const selectEvent = useTimelineStore(s => s.selectEvent)
const selectCastEvent = useTimelineStore(s => s.selectCastEvent)
const addCastEvent = useTimelineStore(s => s.addCastEvent)
const removeDamageEvent = useTimelineStore(s => s.removeDamageEvent)
const removeCastEvent = useTimelineStore(s => s.removeCastEvent)
const setZoomLevel = useTimelineStore(s => s.setZoomLevel)
const setPendingScrollProgress = useTimelineStore(s => s.setPendingScrollProgress)
const updateScrollState = useTimelineStore(s => s.updateScrollState)
const undo = useTimelineStore(s => s.undo)
const redo = useTimelineStore(s => s.redo)
const addAnnotation = useTimelineStore(s => s.addAnnotation)
const updateAnnotation = useTimelineStore(s => s.updateAnnotation)
const removeAnnotation = useTimelineStore(s => s.removeAnnotation)
```

uiStore 部分与 tooltipStore 部分（逐字段）：

```tsx
const isDamageTrackCollapsed = useUIStore(s => s.isDamageTrackCollapsed)
const toggleDamageTrackCollapsed = useUIStore(s => s.toggleDamageTrackCollapsed)

const showTooltip = useTooltipStore(s => s.showTooltip)
const toggleTooltip = useTooltipStore(s => s.toggleTooltip)
const hideTooltip = useTooltipStore(s => s.hideTooltip)
```

`useShallow` import 若该文件已有（257 行样板在用）则复用。既有的 `useEffect`/`useMemo` 依赖数组不需要改（`timeline` 等引用语义不变）；文件内既有 `.getState()` 调用与单字段 selector 全部不动。

- [ ] **Step 3: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。报告中注明：本任务改动 Konva 交互核心，建议用户合并后手工回归 拖动/缩放/undo-redo/工具栏开关。

```bash
git add src/components/EditorToolbar.tsx src/components/Timeline/index.tsx
git commit -m "refactor(store): EditorToolbar 与 Timeline 主组件订阅 selector 化"
```

---

### Task 3: getMultiplierForDamageType 抽取 + 展示口径修复

**Files:**

- Modify: `src/utils/statusRegistry.ts`（新增函数）
- Test: `src/utils/statusRegistry.test.ts`（若存在则追加 describe；不存在则新建）
- Modify: `src/utils/mitigationCalculator.ts:1088, 1297-1306`（私有方法删除改调用）
- Modify: `src/components/PropertyPanel.tsx:405-411, 428-434`、`src/components/PlayerDamageDetails.tsx:187-193, 209-215`、`src/components/Timeline/index.tsx:1289-1295, 1299-1305, 1330-1336`

**Interfaces:**

- Consumes: `PerformanceType`（`@/types/status`）、`DamageType`（`@/types/timeline`）
- Produces: `getMultiplierForDamageType(performance: PerformanceType, damageType: DamageType): number`

**声明的行为变更**：`PlayerDamageDetails` 2 处与 `Timeline/index` 3 处原来只读 `meta.performance`，统一改为 `status.performance ?? meta.performance`（快照优先，见 Global Constraints 第 1 条）。

- [ ] **Step 1: 写失败测试**

```ts
// src/utils/statusRegistry.test.ts（追加或新建）
import { describe, it, expect } from 'vitest'
import { getMultiplierForDamageType } from './statusRegistry'

describe('getMultiplierForDamageType', () => {
  const perf = { physics: 0.9, magic: 0.8, darkness: 0.7 }

  it('physical 取 physics', () => {
    expect(getMultiplierForDamageType(perf, 'physical')).toBe(0.9)
  })
  it('magical 取 magic', () => {
    expect(getMultiplierForDamageType(perf, 'magical')).toBe(0.8)
  })
  it('darkness 取 darkness', () => {
    expect(getMultiplierForDamageType(perf, 'darkness')).toBe(0.7)
  })
})
```

Run: `pnpm test:run statusRegistry`
Expected: FAIL（函数不存在）。

- [ ] **Step 2: 实现**

```ts
// src/utils/statusRegistry.ts（追加）
import type { PerformanceType } from '@/types/status'
import type { DamageType } from '@/types/timeline'

/**
 * 按伤害类型取减伤表现的对应乘率字段。
 * performance 应传 status.performance ?? meta.performance（快照优先，与计算引擎口径一致）。
 */
export function getMultiplierForDamageType(
  performance: PerformanceType,
  damageType: DamageType
): number {
  switch (damageType) {
    case 'physical':
      return performance.physics
    case 'magical':
      return performance.magic
    case 'darkness':
      return performance.darkness
  }
}
```

Run: `pnpm test:run statusRegistry` → PASS。

- [ ] **Step 3: 替换 8 处**

- `mitigationCalculator.ts`：删除私有方法 `getDamageMultiplier`（1297-1306），1088 行调用点改 `getMultiplierForDamageType(...)`（import 追加到已有的 statusRegistry import 行）。
- `PropertyPanel.tsx` 2 处：三元链替换为 `getMultiplierForDamageType(perf, damageType)`（`perf = status.performance ?? meta.performance` 的既有行保留）。
- `PlayerDamageDetails.tsx` 2 处、`Timeline/index.tsx` 3 处：三元链替换为 `getMultiplierForDamageType(status.performance ?? meta.performance, damageType)`（**口径修复**——以实际变量名为准，`Timeline/index.tsx` 中 map 回调的 status 变量名是 `s`）。

Run: `grep -rn "damageType === 'physical'" src/components src/utils`
Expected: 零命中（三元链全部收敛）。

- [ ] **Step 4: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿（mitigationCalculator 2926 行测试锁行为等价）。

```bash
git add src/utils/statusRegistry.ts src/utils/statusRegistry.test.ts src/utils/mitigationCalculator.ts src/components/PropertyPanel.tsx src/components/PlayerDamageDetails.tsx src/components/Timeline/index.tsx
git commit -m "refactor(utils): 抽取 getMultiplierForDamageType，统一减伤展示的快照优先口径"
```

---

### Task 4: timelineToLocalInit + useCopyToClipboard 抽取

**Files:**

- Create: `src/collab/timelineToLocalInit.ts`、`src/hooks/useCopyToClipboard.ts`
- Test: `src/collab/timelineToLocalInit.test.ts`、`src/hooks/useCopyToClipboard.test.tsx`
- Modify: `src/pages/EditorPage.tsx:224-238`、`src/components/CreateTimelineDialog.tsx:86-100`、`src/components/ImportFFLogsDialog.tsx:121-135, 256-270`（4 处 13 字段透传）
- Modify: `src/components/SharePopoverAuthor.tsx`、`src/components/SharePopover.tsx`、`src/components/ExportSoumaDialog.tsx`（3 处复制回弹）

**Interfaces:**

- Consumes: `TimelineContent`（`@/collab/types`）、`Timeline`（`@/types/timeline`）
- Produces:
  - `timelineToLocalInit(timeline: Pick<Timeline, keyof TimelineContent>, overrides?: Partial<TimelineContent>): TimelineContent`
  - `useCopyToClipboard(options?: { resetDelayMs?: number; onCopied?: () => void; onError?: (err: unknown) => void }): { copied: boolean; copy: (text: string) => Promise<void> }`

- [ ] **Step 1: timelineToLocalInit 失败测试**

```ts
// src/collab/timelineToLocalInit.test.ts
import { describe, it, expect } from 'vitest'
import { timelineToLocalInit } from './timelineToLocalInit'
import type { Timeline } from '@/types/timeline'

const base = {
  name: 'T1',
  description: 'd',
  encounter: { id: 1, name: 'E', displayName: 'E', zone: 'Z', damageEvents: [] },
  fflogsSource: undefined,
  gameZoneId: undefined,
  syncEvents: undefined,
  isReplayMode: false,
  composition: { players: [] },
  damageEvents: [],
  castEvents: [],
  annotations: undefined,
  statData: undefined,
  createdAt: 100,
} as unknown as Timeline

describe('timelineToLocalInit', () => {
  it('13 字段透传，annotations 兜底空数组', () => {
    const r = timelineToLocalInit(base)
    expect(r.name).toBe('T1')
    expect(r.annotations).toEqual([])
    expect(r.createdAt).toBe(100)
    expect(Object.keys(r).sort()).toEqual(
      [
        'name',
        'description',
        'encounter',
        'fflogsSource',
        'gameZoneId',
        'syncEvents',
        'isReplayMode',
        'composition',
        'damageEvents',
        'castEvents',
        'annotations',
        'statData',
        'createdAt',
      ].sort()
    )
  })
  it('overrides 覆盖个别字段', () => {
    const r = timelineToLocalInit(base, { name: 'T1(副本)', createdAt: 200 })
    expect(r.name).toBe('T1(副本)')
    expect(r.createdAt).toBe(200)
  })
})
```

Run: `pnpm test:run timelineToLocalInit` → FAIL。

- [ ] **Step 2: 实现 timelineToLocalInit**

```ts
// src/collab/timelineToLocalInit.ts
import type { Timeline } from '@/types/timeline'
import type { TimelineContent } from './types'

/**
 * 把 Timeline-like 对象裁剪为 createLocalTimeline 所需的 TimelineContent，
 * 统一「本地新建 / 创建副本 / FFLogs 导入」的 13 字段透传口径，避免遗漏字段。
 * overrides 用于覆盖个别字段（创建副本时改名、重置 createdAt）。
 */
export function timelineToLocalInit(
  timeline: Pick<Timeline, keyof TimelineContent>,
  overrides: Partial<TimelineContent> = {}
): TimelineContent {
  return {
    name: timeline.name,
    description: timeline.description,
    encounter: timeline.encounter,
    fflogsSource: timeline.fflogsSource,
    gameZoneId: timeline.gameZoneId,
    syncEvents: timeline.syncEvents,
    isReplayMode: timeline.isReplayMode,
    composition: timeline.composition,
    damageEvents: timeline.damageEvents,
    castEvents: timeline.castEvents,
    annotations: timeline.annotations ?? [],
    statData: timeline.statData,
    createdAt: timeline.createdAt,
    ...overrides,
  }
}
```

Run: `pnpm test:run timelineToLocalInit` → PASS。

- [ ] **Step 3: 替换 4 处调用**

- `EditorPage.tsx` → `createLocalTimeline(timelineToLocalInit(timeline, { name: \`${timeline.name}(副本)\`, createdAt: Math.floor(Date.now() / 1000) }))`
- `CreateTimelineDialog.tsx` → `createLocalTimeline(timelineToLocalInit(base))`
- `ImportFFLogsDialog.tsx` 两处 → `createLocalTimeline(timelineToLocalInit(newTimeline))`

- [ ] **Step 4: useCopyToClipboard 失败测试**

```tsx
// src/hooks/useCopyToClipboard.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCopyToClipboard } from './useCopyToClipboard'

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })
  afterEach(() => vi.useRealTimers())

  it('复制成功置 copied，resetDelayMs 后回弹', async () => {
    const onCopied = vi.fn()
    const { result } = renderHook(() => useCopyToClipboard({ onCopied }))
    await act(() => result.current.copy('hello'))
    expect(result.current.copied).toBe(true)
    expect(onCopied).toHaveBeenCalledOnce()
    act(() => void vi.advanceTimersByTime(2000))
    expect(result.current.copied).toBe(false)
  })

  it('复制失败调用 onError 且 copied 保持 false', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    const onError = vi.fn()
    const { result } = renderHook(() => useCopyToClipboard({ onError }))
    await act(() => result.current.copy('x'))
    expect(result.current.copied).toBe(false)
    expect(onError).toHaveBeenCalledOnce()
  })
})
```

Run: `pnpm test:run useCopyToClipboard` → FAIL。

- [ ] **Step 5: 实现 useCopyToClipboard**

```ts
// src/hooks/useCopyToClipboard.ts
import { useCallback, useEffect, useRef, useState } from 'react'

interface UseCopyToClipboardOptions {
  /** 回弹延时（毫秒），默认 2000 */
  resetDelayMs?: number
  /** 复制成功后的副作用（埋点等） */
  onCopied?: () => void
  /** 复制失败时的处理（toast 等） */
  onError?: (err: unknown) => void
}

/**
 * 复制到剪贴板 + 延时回弹的 copied 状态。
 * 统一 SharePopover / SharePopoverAuthor / ExportSoumaDialog 三处重复实现：
 * 计时器经 ref 管理，卸载时清理，连续点击重置计时器。
 */
export function useCopyToClipboard({
  resetDelayMs = 2000,
  onCopied,
  onError,
}: UseCopyToClipboardOptions = {}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), resetDelayMs)
        onCopied?.()
      } catch (err) {
        onError?.(err)
      }
    },
    [resetDelayMs, onCopied, onError]
  )

  return { copied, copy }
}
```

Run: `pnpm test:run useCopyToClipboard` → PASS。

- [ ] **Step 6: 替换 3 处**

- `SharePopoverAuthor.tsx` / `SharePopover.tsx`：删本地 `copied` state + `handleCopy`，改 `const { copied, copy } = useCopyToClipboard({ onError: () => toast.error('复制失败，请手动复制链接') })`，按钮 `onClick={() => copy(shareUrl)}`。
- `ExportSoumaDialog.tsx`：删本地 state/ref/effect/handleCopy（255-278），改 `useCopyToClipboard({ onCopied: () => track('souma-export-copy', { job: currentJob, skillCount: selected.size, ttsEnabled }), onError: () => toast.error('复制失败，请手动选中文本') })`，`handleCopy` 处改 `() => { if (hasSelection) void copy(exportString) }`。onCopied 闭包依赖组件内变量——直接内联传入即可（hook 的 useCallback 依赖 onCopied，闭包每次渲染更新是预期行为）。

- [ ] **Step 7: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。

```bash
git add src/collab/timelineToLocalInit.ts src/collab/timelineToLocalInit.test.ts src/hooks/useCopyToClipboard.ts src/hooks/useCopyToClipboard.test.tsx src/pages/EditorPage.tsx src/components/CreateTimelineDialog.tsx src/components/ImportFFLogsDialog.tsx src/components/SharePopoverAuthor.tsx src/components/SharePopover.tsx src/components/ExportSoumaDialog.tsx
git commit -m "refactor: 抽取 timelineToLocalInit 与 useCopyToClipboard，消除 4+3 处逐字重复"
```

---

### Task 5: splitDeciseconds 基元 + ID 生成器整并

**Files:**

- Modify: `src/utils/formatters.ts`（新增 `splitDeciseconds`，改写 `formatTimeWithDecimal`）
- Modify: `src/utils/soumaExporter.ts:14-29`（`formatSoumaTime` 改用基元，负数分支不动）
- Test: `src/utils/formatters.test.ts`（追加 splitDeciseconds describe；既有边界用例锁改写等价）
- Create: `src/utils/nanoidAlphabet.ts`
- Modify: `src/utils/id.ts`、`src/utils/shortId.ts`（共享 alphabet 常量）
- Modify: `src/executors/utils.ts`（`generateId` 改名 `generateInstanceId` + 换字符集）、`src/executors/index.ts:7`（re-export 改名）、`src/executors/createBuffExecutor.ts`、`src/executors/createShieldExecutor.ts`、`src/executors/statusHelpers.ts`、`src/executors/createRegenExecutor.ts`（调用改名）

**Interfaces:**

- Produces:
  - `splitDeciseconds(t: number): { minutes: number; seconds: number; tenths: number }`（仅接受 t >= 0，调用方自理符号）
  - `ALPHANUMERIC_ALPHABET`（`src/utils/nanoidAlphabet.ts`）
  - `generateInstanceId(): string`（`@/executors`，替代原同名歧义 `generateId`）

**明确不做**：`TimeRuler.tsx` 的整数秒 `formatTime` 保持原样（见 Global Constraints）。

**声明的行为变更**：instanceId 字符集统一（Global Constraints 第 3 条，不可观察——已核实不持久化、测试仅断言非空）。

- [ ] **Step 1: splitDeciseconds 失败测试**

```ts
// formatters.test.ts 追加
import { splitDeciseconds } from './formatters'

describe('splitDeciseconds', () => {
  it('整体四舍五入后拆分，避免进位撕裂', () => {
    expect(splitDeciseconds(9.97)).toEqual({ minutes: 0, seconds: 10, tenths: 0 })
    expect(splitDeciseconds(59.97)).toEqual({ minutes: 1, seconds: 0, tenths: 0 })
    expect(splitDeciseconds(59.94)).toEqual({ minutes: 0, seconds: 59, tenths: 9 })
    expect(splitDeciseconds(125.45)).toEqual({ minutes: 2, seconds: 5, tenths: 5 })
    expect(splitDeciseconds(0)).toEqual({ minutes: 0, seconds: 0, tenths: 0 })
  })
})
```

Run: `pnpm test:run formatters` → FAIL。

- [ ] **Step 2: 实现基元并改写两个消费方**

```ts
// formatters.ts 追加
/**
 * 把非负秒数按 0.1s 精度四舍五入后拆分为 {分, 秒, 十分位}。
 * 先把 deciseconds 算成整体再拆，避免 9.97 → "9:60.0" 式进位撕裂。
 * 仅接受 t >= 0；符号与负数格式由调用方自理（各消费方负数口径不同）。
 */
export function splitDeciseconds(t: number): {
  minutes: number
  seconds: number
  tenths: number
} {
  const totalDeci = Math.round(t * 10)
  const totalSeconds = Math.floor(totalDeci / 10)
  const tenths = totalDeci % 10
  return { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60, tenths }
}

// formatTimeWithDecimal 改写（输出必须与既有测试逐字符一致）
export function formatTimeWithDecimal(seconds: number): string {
  const sign = seconds < 0 ? '-' : ''
  const { minutes, seconds: sec, tenths } = splitDeciseconds(Math.abs(seconds))
  return `${sign}${minutes}:${sec < 10 ? '0' : ''}${sec}.${tenths}`
}
```

```ts
// soumaExporter.ts formatSoumaTime 改写（负数分支原样保留）
export function formatSoumaTime(t: number): string {
  if (t < 0) return t.toFixed(1)
  const { minutes, seconds, tenths } = splitDeciseconds(t)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
}
```

Run: `pnpm test:run formatters && pnpm test:run soumaExporter`
Expected: PASS（既有边界用例 9.97/9.95/59.97/59.94/119.97/59.95/60 全部逐字符等价）。

- [ ] **Step 3: ID 生成器整并**

```ts
// src/utils/nanoidAlphabet.ts（新建）
/** 项目内 id 生成统一字符集：纯字母数字，避免 URL / 文件名转义问题 */
export const ALPHANUMERIC_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
```

- `utils/id.ts` 与 `utils/shortId.ts`：删除各自的 alphabet 字符串字面量，改 `customAlphabet(ALPHANUMERIC_ALPHABET, 21)` / `customAlphabet(ALPHANUMERIC_ALPHABET, 10)`（导出名 `generateId` / `generateObjectId` 与长度不变——两者语义不同不合并）。
- `executors/utils.ts`：

```ts
import { customAlphabet } from 'nanoid'
import { ALPHANUMERIC_ALPHABET } from '@/utils/nanoidAlphabet'

/** MitigationStatus.instanceId 生成器：纯运行时 diff key，不持久化，字符集与项目其余 id 统一 */
export const generateInstanceId = customAlphabet(ALPHANUMERIC_ALPHABET, 21)
```

- `executors/index.ts`：`export { generateInstanceId } from './utils'`；4 个 executor 文件的 import 与调用点同步改名。

Run: `grep -rn "generateId" src/executors/`
Expected: 零命中（全部改为 generateInstanceId）。

- [ ] **Step 4: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。

```bash
git add src/utils/formatters.ts src/utils/formatters.test.ts src/utils/soumaExporter.ts src/utils/nanoidAlphabet.ts src/utils/id.ts src/utils/shortId.ts src/executors/utils.ts src/executors/index.ts src/executors/createBuffExecutor.ts src/executors/createShieldExecutor.ts src/executors/statusHelpers.ts src/executors/createRegenExecutor.ts
git commit -m "refactor(utils): splitDeciseconds 统一时间拆分基元，ID 生成器共享字符集并消除同名歧义"
```

---

### Task 6: 常量/类型单源——PlayerMap、STATUS_ABILITY_OFFSET、DANGER_HP_PCT

**Files:**

- Modify: `src/types/fflogs.ts`（新增 `PlayerMap`）
- Modify: `src/utils/fflogsImporter.ts`（7 处签名 + import）、`src/utils/castWindowImport.ts:8`（删本地定义）、`src/workers/top100Sync.ts:81`（内联构造标注）
- Modify: `src/utils/statusRegistry.ts`（新增 `STATUS_ABILITY_OFFSET` + `toStatusId`）
- Modify: `src/utils/fflogsImporter.ts:349, 391, 826`、`src/utils/mitigationCalculator.ts:559-560`（4 处协议点改用常量）
- Modify: `src/utils/lethalDanger.ts:4`（`DANGER_HP_PCT` 加 export）、`src/utils/autoMitigation/optimizer.ts:182`（删 `DANGER_FRACTION` 改用 `1 - DANGER_HP_PCT`）

**Interfaces:**

- Produces:
  - `PlayerMap = Map<number, { id: number; name: string; type: string }>`（`@/types/fflogs`）
  - `STATUS_ABILITY_OFFSET = 1_000_000`、`toStatusId(abilityGameID: number): number`（`@/utils/statusRegistry`）
  - `DANGER_HP_PCT`（`@/utils/lethalDanger`，导出既有值 0.05）

**明确不做**：`autoMitigation/scope.ts:14` 的 `1_000_000` 是伤害阈值，语义无关，不动。

- [ ] **Step 1: PlayerMap 上移**

`types/fflogs.ts` 紧邻 `FFLogsReportActor` 之后追加：

```ts
/**
 * fflogsImporter 流水线用的精简 Actor 视图（playerId → 基本信息）。
 * FFLogsReportActor 的字段子集（省略 guid/server/icon/fights）。
 */
export type PlayerMap = Map<number, { id: number; name: string; type: string }>
```

- `fflogsImporter.ts`：import 追加 `PlayerMap`，7 处 `Map<number, { id: number; name: string; type: string }>`（签名 5 处 + FightImportResult 字段 + parseFightImport 内构造 `const playerMap: PlayerMap = new Map()`）全部替换。
- `castWindowImport.ts`：删本地 `type PlayerMap = ...`，改 import。
- `workers/top100Sync.ts:81`：`const playerMap: PlayerMap = new Map()` + import。
- 测试文件 `fflogsImporter.test.ts` 的本地 `V2Actor` 不动。

Run: `grep -rn "Map<number, { id: number; name: string; type: string }>" src/`
Expected: 零命中。

- [ ] **Step 2: STATUS_ABILITY_OFFSET + toStatusId**

`statusRegistry.ts` 追加：

```ts
/** FFLogs 把 buff/DoT 类事件的 abilityGameID 编码为 OFFSET + statusId */
export const STATUS_ABILITY_OFFSET = 1_000_000

/** abilityGameID → 裸 statusId（超过 OFFSET 才减，保持既有条件语义） */
export function toStatusId(abilityGameID: number): number {
  return abilityGameID > STATUS_ABILITY_OFFSET
    ? abilityGameID - STATUS_ABILITY_OFFSET
    : abilityGameID
}
```

- `fflogsImporter.ts:349`：`const statusId = toStatusId(buffId)`。
- `fflogsImporter.ts:391`：`const actualStatusId = statusId ? toStatusId(statusId) : 0`（保持 `|| 0` 兜底语义——以实际代码为准逐字核对改写前后等价）。
- `fflogsImporter.ts:826`：原文是**无条件相减** `rawId - 1000000`——改为 `rawId - STATUS_ABILITY_OFFSET`（只换常量，**不**换成 toStatusId，保持无条件语义不变）。
- `mitigationCalculator.ts:559-560`：`if (snap.actionId >= STATUS_ABILITY_OFFSET) { const status = getStatusById(snap.actionId - STATUS_ABILITY_OFFSET)`（DEV 日志，同样只换常量）。

- [ ] **Step 3: DANGER_HP_PCT 单源**

- `lethalDanger.ts:4`：`export const DANGER_HP_PCT = 0.05`。
- `optimizer.ts`：删除 `const DANGER_FRACTION = 0.95` 及其注释，`import { DANGER_HP_PCT } from '@/utils/lethalDanger'`，两处引用 `pe.referenceMaxHP * DANGER_FRACTION` 改 `pe.referenceMaxHP * (1 - DANGER_HP_PCT)`（`1 - 0.05 === 0.95` 浮点精确，行为等价；grep `DANGER_FRACTION` 确认零残留）。

- [ ] **Step 4: 验证 + Commit**

Run: `pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿（触碰了 workers/top100Sync.ts，必须跑 test:workers）。

```bash
git add src/types/fflogs.ts src/utils/fflogsImporter.ts src/utils/castWindowImport.ts src/workers/top100Sync.ts src/utils/statusRegistry.ts src/utils/mitigationCalculator.ts src/utils/lethalDanger.ts src/utils/autoMitigation/optimizer.ts
git commit -m "refactor: PlayerMap/STATUS_ABILITY_OFFSET/DANGER_HP_PCT 单源化，消除 9+4+1 处散写"
```

---

### Task 7: `__cd__:` 合成 CD 协议 helper

**Files:**

- Create: `src/utils/resource/synthCd.ts`
- Test: `src/utils/resource/synthCd.test.ts`
- Modify: `src/utils/resource/compute.ts:53, 238`、`src/utils/resource/validator.ts:41-42`、`src/utils/resource/hoverSnapshot.ts:116`、`src/data/resources.ts:103`

**Interfaces:**

- Produces:
  - `SYNTH_CD_PREFIX = '__cd__:'`
  - `synthCdResourceId(actionId: number): string`
  - `isSynthCdResource(resourceId: string): boolean`
  - `synthCdActionId(resourceId: string): number | undefined`

**明确不做**：`data/mitigationActions.ts` 6 处静态数据字面量不动（见 Global Constraints）。

- [ ] **Step 1: 失败测试**

```ts
// src/utils/resource/synthCd.test.ts
import { describe, it, expect } from 'vitest'
import { SYNTH_CD_PREFIX, synthCdResourceId, isSynthCdResource, synthCdActionId } from './synthCd'

describe('synthCd 协议 helper', () => {
  it('构造与判断', () => {
    expect(synthCdResourceId(7405)).toBe('__cd__:7405')
    expect(isSynthCdResource('__cd__:7405')).toBe(true)
    expect(isSynthCdResource('sch:consolation')).toBe(false)
  })
  it('剥前缀取 actionId，非法输入返回 undefined', () => {
    expect(synthCdActionId('__cd__:7405')).toBe(7405)
    expect(synthCdActionId('sch:consolation')).toBeUndefined()
    expect(synthCdActionId('__cd__:abc')).toBeUndefined()
  })
  it('前缀常量与协议一致', () => {
    expect(SYNTH_CD_PREFIX).toBe('__cd__:')
  })
})
```

Run: `pnpm test:run synthCd` → FAIL。

- [ ] **Step 2: 实现**

```ts
// src/utils/resource/synthCd.ts
/**
 * 合成 CD 资源池的 `__cd__:` 前缀协议 —— 单一定义点。
 * 无显式消费者（resourceEffects 不含 delta<0）的 action，compute 层
 * 合成一个 id 为 `__cd__:${actionId}` 的单充能池，强制走 cooldown 语义。
 */
export const SYNTH_CD_PREFIX = '__cd__:'

/** 构造合成 CD 资源 id */
export function synthCdResourceId(actionId: number): string {
  return `${SYNTH_CD_PREFIX}${actionId}`
}

/** 判断 resourceId 是否属于合成 CD 命名空间 */
export function isSynthCdResource(resourceId: string): boolean {
  return resourceId.startsWith(SYNTH_CD_PREFIX)
}

/** 从合成 CD 资源 id 剥出 actionId；非本命名空间或非数字返回 undefined */
export function synthCdActionId(resourceId: string): number | undefined {
  if (!isSynthCdResource(resourceId)) return undefined
  const n = Number(resourceId.slice(SYNTH_CD_PREFIX.length))
  return Number.isFinite(n) ? n : undefined
}
```

Run: `pnpm test:run synthCd` → PASS。

- [ ] **Step 3: 替换 5 处逻辑代码**

- `compute.ts:53`：`resourceId: synthCdResourceId(action.id)`；`:238`：`if (isSynthCdResource(resourceId))`。
- `validator.ts:41-42`：`if (!def && isSynthCdResource(resourceId)) { const actionId = synthCdActionId(resourceId); if (actionId === undefined) continue; const action = actions.get(actionId); ... }`（原 `Number(slice)` 对非数字产生 NaN → `actions.get(NaN)` 为 undefined → continue；新写法在 actionId undefined 时同样 continue，行为等价）。
- `hoverSnapshot.ts:116`：`consumes.find(e => isSynthCdResource(e.resourceId))`。
- `data/resources.ts:103`：`if (isSynthCdResource(id))`（synthCd.ts 零依赖，data→utils 此 import 无环；若 lint/项目分层检查报错则保留原字面量并在报告说明）。

Run: `grep -rn "'__cd__:'" src/ --include="*.ts" | grep -v synthCd | grep -v mitigationActions | grep -v ".test."`
Expected: 零命中（注释中的 `__cd__` 提法允许保留）。

- [ ] **Step 4: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿（resource/\*.test.ts 既有断言锁行为等价）。

```bash
git add src/utils/resource/synthCd.ts src/utils/resource/synthCd.test.ts src/utils/resource/compute.ts src/utils/resource/validator.ts src/utils/resource/hoverSnapshot.ts src/data/resources.ts
git commit -m "refactor(resource): __cd__ 前缀协议收敛 synthCd helper 单一定义点"
```

---

### Task 8: 文件改名与搬家——tableCellHitTest、useKonvaImage

**Files:**

- Rename: `src/utils/castWindow.ts` → `src/utils/tableCellHitTest.ts`；`src/utils/castWindow.test.ts` → `src/utils/tableCellHitTest.test.ts`
- Rename: `src/utils/useKonvaImage.ts` → `src/hooks/useKonvaImage.ts`；`src/utils/useKonvaImage.test.tsx` → `src/hooks/useKonvaImage.test.tsx`
- Modify: `src/utils/exportExcel.ts:16`、`src/components/TimelineTable/index.tsx:37`、`src/components/TimelineTable/TableDataRow.tsx:13`（castWindow import 改路径）
- Modify: `src/components/Timeline/SkillIcon.tsx:6`（useKonvaImage import 改路径）

**Interfaces:**

- Produces: 导出符号不变，仅路径变化：`@/utils/tableCellHitTest`、`@/hooks/useKonvaImage`

**声明的行为变更**：`preloadIcons` 若 grep 确认零消费（除定义与测试外）则随搬家删除（Global Constraints 第 4 条）。

- [ ] **Step 1: git mv + import 修复**

```bash
git mv src/utils/castWindow.ts src/utils/tableCellHitTest.ts
git mv src/utils/castWindow.test.ts src/utils/tableCellHitTest.test.ts
git mv src/utils/useKonvaImage.ts src/hooks/useKonvaImage.ts
git mv src/utils/useKonvaImage.test.tsx src/hooks/useKonvaImage.test.tsx
```

- 4 个消费者 import 改路径；测试文件内相对 import `'./castWindow'` → `'./tableCellHitTest'`、`'./useKonvaImage'` 保持（同目录相对路径搬家后仍成立，核对）。
- 两个文件头部如有以旧名自称的注释一并更新（`castWindow.ts` 文件头「表格视图单元格命中判定」描述本就准确，仅核对）。

- [ ] **Step 2: preloadIcons 处置**

Run: `grep -rn "preloadIcons" src/`
若仅命中定义处（及可能的测试）→ 从 `useKonvaImage.ts` 删除该函数（连同测试里对应 describe，若有）；若有真实消费者 → 保留并在报告注明。

- [ ] **Step 3: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿；`grep -rn "castWindow'" src/`（注意区分 `castWindowImport`）与 `grep -rn "utils/useKonvaImage" src/` 零命中。

```bash
git add -u
git add src/utils/tableCellHitTest.ts src/utils/tableCellHitTest.test.ts src/hooks/useKonvaImage.ts src/hooks/useKonvaImage.test.tsx
git commit -m "refactor: castWindow 更名 tableCellHitTest 消除概念撞名，useKonvaImage 归位 hooks/"
```

（本任务 `git add -u` 仅覆盖 rename 与 4 个 import 修复文件，改动前先 `git status` 核对无第三方文件混入。）

---

### Task 9: 轨道索引抽取——buildTrackIndexMap + groupCastEventsByTrack

**Files:**

- Modify: `src/utils/skillTracks.ts`（新增两个函数）
- Test: `src/utils/skillTracks.test.ts`（若存在则追加；不存在则新建）
- Modify: `src/components/Timeline/index.tsx:1541-1543, 1602-1604, 1635-1637`、`src/components/Timeline/PeerOverlay.tsx:395, 507-509, 581-583`、`src/components/Timeline/SkillTracksCanvas.tsx:174-191, 415-426, 569-571, 707-709`、`src/components/TimelineTable/index.tsx:183-191`

**Interfaces:**

- Consumes: `SkillTrack`（`@/utils/skillTracks` 已有）、`effectiveTrackGroup`（`@/types/mitigation` 已有）、`CastEvent`（`@/types/timeline`）、`MitigationAction`（`@/types/mitigation`）
- Produces:
  - `trackKey(playerId: number, actionId: number): string`（`` `${playerId}:${actionId}` ``）
  - `buildTrackIndexMap(skillTracks: SkillTrack[]): Map<string, number>`
  - `groupCastEventsByTrack(castEvents: CastEvent[], actionsById: Map<number, MitigationAction>): Map<string, CastEvent[]>`

**风险提示**：改动点在 Timeline 渲染热路径（8 处 findIndex + 3 处分组过滤），逐文件小步替换；每处调用方各自的 `groupId` 计算逻辑（`anchor.actionId` 直取 / `castAction?.trackGroup ?? ce.actionId` / `effectiveTrackGroup(action)`）**保持原样**，只换查表方式。顺手把被触碰行内手写的 `x.trackGroup ?? x.id` 替换为 `effectiveTrackGroup(x)`（仅限本任务触碰的行，不全仓扫）。

- [ ] **Step 1: 失败测试**

```ts
// src/utils/skillTracks.test.ts（追加或新建）
import { describe, it, expect } from 'vitest'
import { trackKey, buildTrackIndexMap, groupCastEventsByTrack } from './skillTracks'
import type { SkillTrack } from './skillTracks'
import type { CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

const tracks = [
  { playerId: 1, actionId: 100 },
  { playerId: 1, actionId: 200 },
  { playerId: 2, actionId: 100 },
] as SkillTrack[]

describe('buildTrackIndexMap', () => {
  it('(playerId, actionId) → 下标，未知键取 ?? -1 兜底', () => {
    const m = buildTrackIndexMap(tracks)
    expect(m.get(trackKey(1, 200))).toBe(1)
    expect(m.get(trackKey(2, 100))).toBe(2)
    expect(m.get(trackKey(9, 9)) ?? -1).toBe(-1)
  })
})

describe('groupCastEventsByTrack', () => {
  it('按 (playerId, effectiveTrackGroup) 分组，变体归并父轨道', () => {
    const actions = new Map<number, MitigationAction>([
      [100, { id: 100 } as MitigationAction],
      [101, { id: 101, trackGroup: 100 } as MitigationAction],
    ])
    const casts = [
      { id: 'a', playerId: 1, actionId: 100, timestamp: 5 },
      { id: 'b', playerId: 1, actionId: 101, timestamp: 3 },
      { id: 'c', playerId: 2, actionId: 100, timestamp: 1 },
      { id: 'd', playerId: 1, actionId: 999, timestamp: 2 }, // 未知 action 丢弃
    ] as CastEvent[]
    const g = groupCastEventsByTrack(casts, actions)
    expect(g.get(trackKey(1, 100))!.map(c => c.id)).toEqual(['a', 'b'])
    expect(g.get(trackKey(2, 100))!.map(c => c.id)).toEqual(['c'])
    expect(g.size).toBe(2)
  })
})
```

Run: `pnpm test:run skillTracks` → FAIL。

- [ ] **Step 2: 实现**

```ts
// skillTracks.ts 追加
import { effectiveTrackGroup, type MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'

/** (playerId, actionId/groupId) 复合键，与 buildTrackIndexMap/groupCastEventsByTrack 共用 */
export function trackKey(playerId: number, actionId: number): string {
  return `${playerId}:${actionId}`
}

/** 建 (playerId, actionId) → skillTracks 下标 查找表，替代散落的 findIndex 线性扫描 */
export function buildTrackIndexMap(skillTracks: SkillTrack[]): Map<string, number> {
  const map = new Map<string, number>()
  skillTracks.forEach((t, i) => map.set(trackKey(t.playerId, t.actionId), i))
  return map
}

/**
 * 按 (playerId, effectiveTrackGroup) 对 castEvents 分组——trackGroup 变体
 * 归并到父轨道分组；actionsById 查不到的 cast 丢弃。不排序，由调用方按需 sort。
 */
export function groupCastEventsByTrack(
  castEvents: CastEvent[],
  actionsById: Map<number, MitigationAction>
): Map<string, CastEvent[]> {
  const grouped = new Map<string, CastEvent[]>()
  for (const ce of castEvents) {
    const action = actionsById.get(ce.actionId)
    if (!action) continue
    const key = trackKey(ce.playerId, effectiveTrackGroup(action))
    const arr = grouped.get(key)
    if (arr) arr.push(ce)
    else grouped.set(key, [ce])
  }
  return grouped
}
```

Run: `pnpm test:run skillTracks` → PASS。

- [ ] **Step 3: 替换 8 处 findIndex**

每个消费组件在合适作用域建一次索引（`const trackIndexMap = useMemo(() => buildTrackIndexMap(skillTracks), [skillTracks])`），原 `skillTracks.findIndex(t => t.playerId === X && t.actionId === Y)` 改 `trackIndexMap.get(trackKey(X, Y)) ?? -1`：

- `Timeline/index.tsx` 3 处（1541 注释锚点 / 1602 框选 cast / 1635 框选注释——三处在同一函数域或相邻 useMemo，建一次表复用；以实际作用域为准）。
- `PeerOverlay.tsx` 3 处（395 的 useMemo 内部改查表——该 useMemo 依赖数组追加不需要，`trackIndexMap` 作为新依赖传入；507 / 581 两处同理）。
- `SkillTracksCanvas.tsx` 2 处（569 渲染 cast 图标 / 707 渲染注释图标——组件顶部建表）。

- [ ] **Step 4: 替换 3 处分组**

- `SkillTracksCanvas.tsx:174-191`（visibleBarsByTrack 的分组段）→ `const grouped = groupCastEventsByTrack(timeline.castEvents, actionMap)` + 每组 sort（原 sort 保留）。key 格式从 `` `${p}|${g}` `` 变为 `` `${p}:${g}` ``——该 Map 是 useMemo 内部实现细节，核对同函数内所有读取处同步用 `trackKey`。
- `SkillTracksCanvas.tsx:415-426`（空转提示）→ 复用上一步的 grouped（或再调一次函数），`grouped.get(trackKey(track.playerId, trackGroupId)) ?? []` 后接原 sort；`trackGroupId` 计算行顺手改 `effectiveTrackGroup`。
- `TimelineTable/index.tsx:183-191`（移除 marker）→ 分组判等部分改 `(ca ? effectiveTrackGroup(ca) : null) === groupId` 或改用 `groupCastEventsByTrack` 后组内过滤 `timestamp <= event.time`——取改动更小者，保持「取最近一条」语义逐字等价。

- [ ] **Step 5: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。报告中注明：建议用户手工回归 框选/协作 ghost/表格点击放置移除/空转提示。

```bash
git add src/utils/skillTracks.ts src/utils/skillTracks.test.ts src/components/Timeline/index.tsx src/components/Timeline/PeerOverlay.tsx src/components/Timeline/SkillTracksCanvas.tsx src/components/TimelineTable/index.tsx
git commit -m "refactor(timeline): 轨道索引与分组收敛 buildTrackIndexMap/groupCastEventsByTrack，消除 8+3 处线性扫描"
```

---

### Task 10: FFLogs 导入合并——fetchFFLogsImport + useFFLogsUrlInput

**Files:**

- Create: `src/api/fflogsImport.ts`、`src/hooks/useFFLogsUrlInput.ts`
- Modify: `src/components/ImportFFLogsDialog.tsx`（handleServerSubmit 请求段 + URL/剪贴板段）
- Modify: `src/components/ImportIntoTimelineDialog.tsx`（handleParse fflogs 分支 + URL/剪贴板段）

**Interfaces:**

- Consumes: `apiClient` / `parseApiError`（`@/api`）、`parseFromAny`（`@/utils/timelineFormat`）、`generateId`（`@/utils/id`）、`parseFFLogsUrl`（`@/utils/fflogsParser`）
- Produces:
  - `FFLogsImportTarget { reportCode: string; fightId: number | null; isLastFight: boolean }`
  - `fetchFFLogsImport(target: FFLogsImportTarget): Promise<Timeline>`
  - `useFFLogsUrlInput(options?: { initialUrl?: string; enabled?: boolean }): { inputRef, url, setUrl, parsed, isValid }`

**声明的行为变更**：`ImportIntoTimelineDialog` 错误提示统一 API Token/Key 特判（Global Constraints 第 2 条）。**不合并**的部分：两个 Dialog 拿到 Timeline 后的业务处理（新建 vs 抽取子集）、track 埋点粒度、loading 状态形态——保留各自组件内。

- [ ] **Step 1: 实现 `src/api/fflogsImport.ts`**

```ts
/**
 * FFLogs 导入 API 客户端 —— GET /api/fflogs/import 的唯一前端入口。
 * 供两个导入 Dialog 共用「请求 + 反序列化」段；拿到 Timeline 后的
 * 业务处理（新建独立时间轴 vs 合并到当前时间轴）留在各组件。
 */
import { apiClient } from './apiClient'
import { parseApiError } from './parseApiError'
import { parseFromAny } from '@/utils/timelineFormat'
import { generateId } from '@/utils/id'
import type { Timeline } from '@/types/timeline'

export interface FFLogsImportTarget {
  reportCode: string
  fightId: number | null
  isLastFight: boolean
}

/** 服务端一次性解析出完整 Timeline；120s 超时（FFLogs 事件抓取可能较慢） */
export async function fetchFFLogsImport(target: FFLogsImportTarget): Promise<Timeline> {
  const params = new URLSearchParams({ reportCode: target.reportCode })
  if (!target.isLastFight && target.fightId !== null) {
    params.set('fightId', String(target.fightId))
  }

  const response = await apiClient.get(`fflogs/import?${params}`, {
    timeout: 120000,
    throwHttpErrors: false,
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as unknown
    throw new Error(parseApiError(body, response.status))
  }

  const raw = await response.json()
  return parseFromAny(raw, { id: generateId() })
}
```

- [ ] **Step 2: 实现 `src/hooks/useFFLogsUrlInput.ts`**

```ts
/**
 * FFLogs URL 输入框公共状态：受控 value + 实时解析 + 剪贴板自动填充。
 * initialUrl 有值时跳过剪贴板（预填场景不覆盖）；enabled 供常驻挂载的
 * Dialog 用 open 控制生效时机。
 */
import { useEffect, useRef, useState } from 'react'
import { parseFFLogsUrl } from '@/utils/fflogsParser'

interface UseFFLogsUrlInputOptions {
  initialUrl?: string
  enabled?: boolean
}

export function useFFLogsUrlInput({ initialUrl, enabled = true }: UseFFLogsUrlInputOptions = {}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(initialUrl ?? '')

  const parsed = url ? parseFFLogsUrl(url) : null
  const isValid = !!parsed?.reportCode

  useEffect(() => {
    if (!enabled) return
    inputRef.current?.focus()
    if (initialUrl) return

    void (async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (text && /fflogs\.com\/reports\//.test(text)) setUrl(text)
      } catch (err) {
        console.debug('无法读取剪贴板:', err)
      }
    })()
  }, [enabled, initialUrl])

  return { inputRef, url, setUrl, parsed, isValid }
}
```

- [ ] **Step 3: 改造两个 Dialog**

- `ImportFFLogsDialog.tsx`：`useFFLogsUrlInput({ initialUrl })` 替换本地 inputRef/url/parsed/isValid 声明与剪贴板 useEffect；`handleServerSubmit` 的组参数→请求→反序列化段（研究快照 101-118 行）替换为 `const newTimeline = await fetchFFLogsImport({ reportCode: parsed.reportCode, fightId: parsed.fightId, isLastFight: parsed.isLastFight })`。其余（description 拼接、createLocalTimeline、track、错误特判、window.open）不动。**dev-only 的 `handleClientSubmit` 本任务不碰**（Task 11 处理）。
- `ImportIntoTimelineDialog.tsx`：`useFFLogsUrlInput({ enabled: open })` 替换本地段（组件的「关闭时重置」effect 用 hook 返回的 `setUrl('')` 实现，保留在组件内）；`handleParse` fflogs 分支请求段替换为 `fetchFFLogsImport(...)` + 原 `extractImportableFromTimeline`；catch 块升级为与 ImportFFLogsDialog 一致的 API Token/Key 特判（声明的行为变更）：

```ts
catch (err) {
  if (err instanceof Error) {
    if (err.message.includes('API Token') || err.message.includes('API Key')) {
      setError('FFLogs 连接配置错误，请联系开发者')
    } else {
      setError(err.message)
    }
  } else {
    setError('解析失败')
  }
}
```

- [ ] **Step 4: 验证 + Commit**

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。

```bash
git add src/api/fflogsImport.ts src/hooks/useFFLogsUrlInput.ts src/components/ImportFFLogsDialog.tsx src/components/ImportIntoTimelineDialog.tsx
git commit -m "refactor(import): 抽取 fetchFFLogsImport 与 useFFLogsUrlInput，合并两导入 Dialog 重复段"
```

---

### Task 11: dev-only 客户端导入下沉 devClientImport.ts

**Files:**

- Create: `src/utils/devClientImport.ts`
- Modify: `src/components/ImportFFLogsDialog.tsx`（handleClientSubmit 瘦身，研究快照 158-292 行）

**Interfaces:**

- Consumes: dynamic `import('@/api/fflogsClient')` / `import('@/utils/fflogsImporter')`、`createNewTimeline`（`@/utils/timelineStorage`）、`timelineToLocalInit`（Task 4 产物，经组件调用 createLocalTimeline）
- Produces: `runClientFFLogsImport(input): Promise<Timeline>`——纯数据函数，**返回组装好的 Timeline**，不做 createLocalTimeline/track/window.open（留在组件）

**DCE 硬约束**（生产 bundle 不得包含 fflogsClient/fflogsImporter）：

1. 函数体首行必须是 `if (!import.meta.env.DEV) throw new Error('dev only')`（常量折叠 → 死代码 → 连同 dynamic import 站点被 DCE）。
2. 两个 `import()` 必须保持在同一函数体内，不许拆分。
3. 组件侧调用点必须仍处于 `clientImport`（含 `import.meta.env.DEV`）守卫之内。

- [ ] **Step 1: 新建 `src/utils/devClientImport.ts`**

签名与骨架（函数体为原 handleClientSubmit 158-253 行的「取报告→定位 fight→组装 newTimeline」逻辑原样迁入，`setLoadingStep` 经参数注入）：

```ts
/**
 * FFLogs 前端直连导入（仅开发环境 ?client_import=1）。
 * 自 ImportFFLogsDialog 下沉：生产构建 import.meta.env.DEV 常量折叠为 false，
 * 本函数体成为死代码，内部两个 dynamic import 站点一并被 DCE，
 * fflogsClient / fflogsImporter 不进生产 bundle。
 */
import type { Timeline } from '@/types/timeline'
import { createNewTimeline } from '@/utils/timelineStorage'

export interface ClientImportInput {
  reportCode: string
  fightId: number | null
  isLastFight: boolean
  /** 导入来源 URL，写进 description */
  sourceUrl: string
  onStep: (step: string) => void
}

export async function runClientFFLogsImport(input: ClientImportInput): Promise<Timeline> {
  if (!import.meta.env.DEV) throw new Error('client import is dev-only')

  const [{ createFFLogsClient }, importer] = await Promise.all([
    import('@/api/fflogsClient'),
    import('@/utils/fflogsImporter'),
  ])
  const { parseFightImport, resolveImportTimelineName } = importer

  // ……以下为 ImportFFLogsDialog.handleClientSubmit 原 177-253 行逻辑原样迁入：
  // createFFLogsClient → getReport → 定位 fightId（isLastFight 取末场）→
  // resolveImportTimelineName → createNewTimeline → 填 encounter/gameZoneId →
  // onStep('正在获取战斗事件...') → getAllEvents → onStep('正在解析数据...') →
  // parseFightImport → 填 composition/damageEvents/castEvents/syncEvents/
  // isReplayMode/description(`导入自 ${input.sourceUrl}`)/fflogsSource →
  // return newTimeline
}
```

（“原样迁入”指逐字搬移该区间语句，仅把 `parsed.reportCode/fightId/isLastFight` → `input.*`、`url` → `input.sourceUrl`、`setLoadingStep` → `input.onStep` 三类引用改为参数；不改任何业务逻辑。）

- [ ] **Step 2: 组件瘦身**

`handleClientSubmit` 改为：

```ts
const handleClientSubmit = async (e: React.FormEvent) => {
  e.preventDefault()
  if (!import.meta.env.DEV) return
  if (!parsed?.reportCode) return
  setError('')
  setIsLoading(true)
  setLoadingStep('正在获取报告信息...')
  try {
    const { runClientFFLogsImport } = await import('@/utils/devClientImport')
    const newTimeline = await runClientFFLogsImport({
      reportCode: parsed.reportCode,
      fightId: parsed.fightId,
      isLastFight: parsed.isLastFight,
      sourceUrl: url,
      onStep: setLoadingStep,
    })
    const newId = await createLocalTimeline(timelineToLocalInit(newTimeline))
    track('fflogs-import', { success: true, encounterId: newTimeline.encounter?.id ?? 0 })
    window.open(`/timeline/${newId}`, '_blank')
    onImported()
    onClose()
  } catch (err) {
    track('fflogs-import', { success: false })
    if (err instanceof Error) {
      if (err.message.includes('API Token') || err.message.includes('API Key')) {
        setError('FFLogs 连接配置错误，请联系开发者')
      } else {
        setError(err.message)
      }
    } else {
      setError('导入失败，请稍后重试')
    }
  } finally {
    setIsLoading(false)
  }
}
```

（devClientImport 本身也走 dynamic import + DEV 守卫双保险；`timelineToLocalInit` 为 Task 4 产物。）

- [ ] **Step 3: DCE 验证 + 四件套 + Commit**

Run: `pnpm build && grep -rl "fflogsClientV2\|parseFightImport" dist/assets/*.js | head`
Expected: 主 chunk（非 lazy chunk）无命中；若 fflogsImporter 因服务端导入路径本来就在主链路（`parseFromAny` 不含它，但需核实），以 build 前后 chunk 对比为准——**验收标准是与本任务改动前的 build 产物等价（不新增引入）**，在报告中给出改动前后 `dist/assets` 中含 `parseFightImport` 的 chunk 清单对比。

Run: `pnpm test:run && pnpm exec tsc -b --noEmit && pnpm lint`
Expected: 全绿。

```bash
git add src/utils/devClientImport.ts src/components/ImportFFLogsDialog.tsx
git commit -m "refactor(import): dev-only 客户端导入编排下沉 devClientImport，保持 DCE"
```

---

### Task 12: 前两期备忘清理包

**Files:**

- Modify: `src/hooks/useSkillTracks.ts`、`src/hooks/useResourceHoverData.ts`、`src/hooks/useFilteredTimelineView.ts`（actions 死依赖）
- Modify: `.env.example`（删 VITE_API_BASE_URL）
- Modify: `src/workers/kvKeys.ts`（新增 `getTimelineSnapshotKVKey`）、`src/workers/routes/timelines.ts`（3 处）、`src/workers/routes/internalMigrate.ts`（1 处）、`src/workers/durable/TimelineDoc.ts`（1 处）
- Modify: `src/types/apiContracts.ts`（新增 `ShareState` / `PublishResult`）、`src/api/timelineShareApi.ts`（删本地定义改 import + re-export）、`src/workers/routes/share.ts`（GET /:id/share 响应标注）、`src/workers/routes/timelines.ts`（POST 响应标注）
- Modify: `src/types/timeline.ts`（新增 `StoredDamageEvent`）、`src/workers/top100Sync.ts`、`src/workers/encounterTemplate.ts`、`src/workers/encounterTemplate.test.ts`（import 改指向）
- Create: `src/utils/stats.test.ts`；Modify: `src/workers/encounterStats.test.ts`（搬走误归属 describe）
- Modify: `CLAUDE.md`（最后更新日期）

**Interfaces:**

- Produces:
  - `getTimelineSnapshotKVKey(id: string): string`（`@/workers/kvKeys`，返回 `` `tl-snapshot:${id}` ``）
  - `ShareState { allowEditRequests: boolean; editors: { userId: string; userName: string }[]; applicants: { userId: string; userName: string; createdAt: number }[] }`、`PublishResult { id: string; publishedAt: number }`（`@/types/apiContracts`）
  - `StoredDamageEvent`（`@/types/timeline`，定义原文迁自 top100Sync.ts）

**声明的行为变更**：仅 `.env.example` 删行（Global Constraints 第 5 条）；其余全部行为等价。测试文件中 `tl-snapshot:` 字面量保留（黑盒断言）。

- [ ] **Step 1: hooks actions 死依赖**

三个文件统一做法：删除 `const actions = ACTIONS` 别名行，函数体内直接引用 `ACTIONS`（模块常量），并把 `actions` 从各依赖数组删除（`useSkillTracks.ts:22`、`useResourceHoverData.ts:30`、`useFilteredTimelineView.ts:91`）。不需要 eslint-disable——模块常量不在 exhaustive-deps 检查范围。

- [ ] **Step 2: .env.example**

删除 `VITE_API_BASE_URL=/api/fflogs` 行及其上方两行注释（`# API 配置` 标题行若只服务于它则一并删，若还罩着别的变量则保留标题）。

- [ ] **Step 3: tl-snapshot key 收敛**

`kvKeys.ts` 追加：

```ts
/** 时间轴 KV 快照键 */
export function getTimelineSnapshotKVKey(id: string): string {
  return `tl-snapshot:${id}`
}
```

替换 5 处生产代码：`timelines.ts:85, 133, 178`、`internalMigrate.ts:66`、`TimelineDoc.ts:343`（`this.cachedDocId`）。测试文件字面量不动。

Run: `grep -rn "tl-snapshot" src/workers --include="*.ts" | grep -v kvKeys | grep -v ".test."`
Expected: 零命中。

- [ ] **Step 4: ShareState / PublishResult 进契约**

`apiContracts.ts` 追加：

```ts
/** GET /api/timelines/:id/share 的响应（作者面板数据） */
export interface ShareState {
  allowEditRequests: boolean
  editors: { userId: string; userName: string }[]
  applicants: { userId: string; userName: string; createdAt: number }[]
}

/** POST /api/timelines 的响应（id 可能因敏感词换发而与请求不同） */
export interface PublishResult {
  id: string
  publishedAt: number
}
```

- `timelineShareApi.ts`：删本地两定义，`import type { ShareState, PublishResult } from '@/types/apiContracts'` + `export type { ShareState, PublishResult }`（既有消费者 import 路径不破）。
- `share.ts` GET /:id/share：`const body: ShareState = { allowEditRequests: ..., editors, applicants }; return c.json(body)`（以实际字段构造为准，行为不变）。
- `timelines.ts` POST：`const result: PublishResult = { id, publishedAt: now }; return c.json(result, 201)`。

- [ ] **Step 5: StoredDamageEvent 移 types/timeline.ts**

- `types/timeline.ts` 在 `DamageEvent` 定义后追加（注释原文迁移）：

```ts
/** fight-stats 存储用的精简 DamageEvent，剥离 id / 明细，附带 abilityId（top100Sync.slimDamageEvents 产出） */
export type StoredDamageEvent = Omit<DamageEvent, 'id' | 'playerDamageDetails'> & {
  /** 从 playerDamageDetails[0] 提取的技能 ID，供 encounter template 聚合 */
  abilityId?: number
}
```

- `top100Sync.ts`：删本地定义，import type 自 `@/types/timeline`（并入既有 import 行）；`encounterTemplate.ts:3` 与 `encounterTemplate.test.ts:3` 改同源——`encounterTemplate.ts → top100Sync.ts` 的反向 type 边消除。

Run: `grep -rn "from './top100Sync'" src/workers/encounterTemplate*.ts`
Expected: 零命中。

- [ ] **Step 6: stats 测试归位**

- 新建 `src/utils/stats.test.ts`：把 `encounterStats.test.ts` 的 `describe('calculatePercentile', ...)` 整块原样搬入，import 改 `from './stats'`。
- `encounterStats.test.ts`：删该 describe 与 `import { calculatePercentile } from '@/utils/stats'` 行。

- [ ] **Step 7: 项目指南日期 + 验证 + Commit**

`CLAUDE.md` 末尾 `**最后更新**` 改为执行当日日期（其余内容如与本期改动无冲突则不动；`apiContracts.ts` 的关键文件表描述已存在，核对仍准确）。

Run: `pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint && pnpm build`
Expected: 全绿（本任务触碰 workers；build 兜底全期收尾）。

```bash
git add src/hooks/useSkillTracks.ts src/hooks/useResourceHoverData.ts src/hooks/useFilteredTimelineView.ts .env.example src/workers/kvKeys.ts src/workers/routes/timelines.ts src/workers/routes/internalMigrate.ts src/workers/durable/TimelineDoc.ts src/types/apiContracts.ts src/api/timelineShareApi.ts src/workers/routes/share.ts src/types/timeline.ts src/workers/top100Sync.ts src/workers/encounterTemplate.ts src/workers/encounterTemplate.test.ts src/utils/stats.test.ts src/workers/encounterStats.test.ts CLAUDE.md
git commit -m "chore: 清理前两期备忘——死依赖/死配置/tl-snapshot 单源/契约补全/类型环消除/测试归位"
```

---

## 任务依赖

- Task 1 → Task 2（同为 selector 化，先易后难；Task 2 与 Task 3/9 都改 `Timeline/index.tsx`，**必须串行**：1 → 2 → 3 → … → 9 按编号执行）。
- Task 4 产物 `timelineToLocalInit` 被 Task 11 消费；Task 10 先于 Task 11（同文件 `ImportFFLogsDialog.tsx`，10 改 server 路径、11 改 client 路径）。
- 其余任务无硬依赖，但按编号串行执行避免同文件冲突（`Timeline/index.tsx` 被 Task 2/3/9 触碰；`timelines.ts` 被 Task 12 触碰）。

## 验收

- 全部验证命令绿：`pnpm test:run` / `pnpm test:workers` / `pnpm exec tsc -b --noEmit` / `pnpm lint` / `pnpm build`。
- grep 验收汇总：无 `useXxxStore()` 无参订阅（`grep -rn "useTimelineStore()\|useUIStore()\|useAuthStore()\|useTooltipStore()" src/ --include="*.tsx" --include="*.ts" | grep -v getState | grep -v ".test."` 零命中）；`damageType === 'physical'` 三元链零残留；`Map<number, { id: number; name: string; type: string }>` 字面量零残留；`'__cd__:'` 逻辑代码零残留（mitigationActions/注释除外）；`tl-snapshot` 生产代码零散写；executors 内 `generateId` 零残留。
- 5 项声明的行为变更之外无行为变化；报告向用户提示手工回归项（拖动/缩放/undo-redo/框选/协作 ghost/表格点击/导入流程）。
