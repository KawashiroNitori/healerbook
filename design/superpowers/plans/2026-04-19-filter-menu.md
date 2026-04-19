# 时间轴过滤菜单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 EditorPage 工具栏"视图"按钮之后新增"过滤"下拉菜单，支持 5 个预置过滤器 + 用户自定义预设（localStorage 持久化、可拖拽排序）。过滤纯视觉，不改动减伤计算与导出；同时拆除旧的 `uiStore.hiddenPlayerIds` 玩家显隐机制。

**Architecture:**

1. 给 `MitigationAction` 加 `category: MitigationCategory[]` 必填字段（`'shield' | 'percentage'`）。
2. 新建 `filterStore`（Zustand + persist）维护自定义预设与当前选中，`BUILTIN_PRESETS` 常量内联在 store 顶部。
3. 新建 `useFilteredTimelineView` hook 统一产出 `{ filteredDamageEvents, filteredCastEvents }`；`useSkillTracks` 内部集成过滤；三处 predicate 共用 `matchSingleAction` 基础函数以保证语义一致。
4. `FilterMenu` + `ManagePresetsDialog` + `EditPresetDialog` + `SortablePresetRow` 四个 UI 组件，挂入 `EditorToolbar`。
5. 拖拽排序用 `@dnd-kit/sortable`（新依赖）。
6. 同步移除 `uiStore.hiddenPlayerIds` 及其 UI（`CompositionPopover` 的 Eye/EyeOff/X 按钮）。

**Tech Stack:** React 19、TypeScript 5.9、Zustand 5 + persist、`@dnd-kit/core/sortable/utilities`（新增）、Vitest 4、Tailwind + shadcn/ui。

**Spec:** `design/superpowers/specs/2026-04-19-filter-menu-design.md`

---

## 文件结构

| 文件                                                | 角色                                                            | 变更类型 |
| --------------------------------------------------- | --------------------------------------------------------------- | -------- |
| `src/types/mitigation.ts`                           | 加 `MitigationCategory` 类型与 `category` 必填字段              | 修改     |
| `src/data/mitigationActions.ts`                     | 每个 action 补 `category`                                       | 修改     |
| `src/store/uiStore.ts`                              | 删除 `hiddenPlayerIds / togglePlayerVisibility / isolatePlayer` | 修改     |
| `src/components/CompositionPopover.tsx`             | 移除 Eye/EyeOff/X 按钮及相关 state                              | 修改     |
| `src/hooks/useSkillTracks.ts`                       | 集成过滤；不再读 uiStore                                        | 修改     |
| `src/components/Timeline/index.tsx`                 | 改走 `useSkillTracks()`；消费 `useFilteredTimelineView`         | 修改     |
| `src/components/Timeline/TimelineMinimap.tsx`       | 消费过滤后的 damage events                                      | 修改     |
| `src/components/TimelineTable/index.tsx`            | 消费过滤后的事件                                                | 修改     |
| `src/components/ExportExcelDialog.tsx`              | 删 `globalHiddenPlayerIds` 读取                                 | 修改     |
| `src/types/filter.ts`                               | 过滤预设类型定义                                                | 新增     |
| `src/store/filterStore.ts`                          | 预设 store + `BUILTIN_PRESETS`                                  | 新增     |
| `src/store/filterStore.test.ts`                     | filterStore 单测                                                | 新增     |
| `src/hooks/useFilteredTimelineView.ts`              | 事件过滤 hook + 共享 predicate                                  | 新增     |
| `src/hooks/useFilteredTimelineView.test.ts`         | 过滤 hook 单测                                                  | 新增     |
| `src/hooks/useSkillTracks.test.ts`                  | useSkillTracks 单测                                             | 新增     |
| `src/components/FilterMenu/FilterMenu.tsx`          | 过滤下拉菜单                                                    | 新增     |
| `src/components/FilterMenu/ManagePresetsDialog.tsx` | 预设管理 modal                                                  | 新增     |
| `src/components/FilterMenu/EditPresetDialog.tsx`    | 预设新建/编辑 modal                                             | 新增     |
| `src/components/FilterMenu/SortablePresetRow.tsx`   | dnd-kit 拖拽行封装                                              | 新增     |
| `src/components/EditorToolbar.tsx`                  | 挂载 `<FilterMenu />`                                           | 修改     |
| `package.json`                                      | 新增 `@dnd-kit/*` 依赖                                          | 修改     |

---

## 阶段 1：数据模型（加 `category`）

### Task 1：添加 `MitigationCategory` 类型与 `category` 可选字段

**Files:**

- Modify: `src/types/mitigation.ts`

- [ ] **Step 1.1: 修改 `src/types/mitigation.ts`**

在 `import` 之后、`MitigationType` 定义之前追加新类型：

```ts
/**
 * 减伤类别（UI 过滤用）
 * - shield: 盾值类
 * - percentage: 百分比减伤类（含目标/非目标减伤）
 */
export type MitigationCategory = 'shield' | 'percentage'
```

在 `MitigationAction` interface 的 `statDataEntries` 字段之前插入：

```ts
  /** 减伤类别（必填、非空）；hidden 技能也需标注 */
  category?: MitigationCategory[]
```

> 注：此步暂用可选 `?:`，阶段 1 全部 action 补完后在 Task 3 紧缩为必填。

- [ ] **Step 1.2: 验证 tsc 无错**

```bash
pnpm exec tsc --noEmit
```

Expected: PASS（已有代码不受新可选字段影响）

- [ ] **Step 1.3: 提交**

```bash
git add src/types/mitigation.ts
git commit -m "feat(types): add MitigationCategory type and optional category field"
```

---

### Task 2：为所有 action 补 `category` 字段

**Files:**

- Modify: `src/data/mitigationActions.ts`

- [ ] **Step 2.1: 按下表逐项添加 `category`**

在每个 action 对象里添加 `category: [...]` 字段（位置建议紧跟 `jobs` 之后）。下表为初步分类（实施后用户需审查）：

| id    | 名称              | category                   |
| ----- | ----------------- | -------------------------- |
| 7535  | 雪仇              | `['percentage']`           |
| 3540  | 圣光幕帘          | `['shield']`               |
| 7385  | 武装戍卫          | `['percentage']`           |
| 7388  | 摆脱              | `['shield']`               |
| 16471 | 暗黑布道          | `['percentage']`           |
| 16160 | 光之心            | `['percentage']`           |
| 16536 | 节制              | `['percentage']`           |
| 7433  | 全大赦            | `['percentage']`           |
| 37011 | 神爱抚            | `['shield']`               |
| 3585  | 展开战术          | `['shield']`               |
| 16542 | 秘策              | `['percentage']`           |
| 37013 | 意气轩昂之策      | `['shield']`               |
| 37014 | 炽天附体          | `['percentage']`           |
| 37016 | 降临之章 (hidden) | `['shield']`               |
| 188   | 野战治疗阵        | `['percentage']`           |
| 16538 | 异想的幻光        | `['percentage']`           |
| 25868 | 疾风怒涛之计      | `['percentage']`           |
| 16545 | 炽天召唤          | `['percentage']`           |
| 16546 | 慰藉              | `['shield']`               |
| 3613  | 命运之轮          | `['percentage']`           |
| 16559 | 中间学派          | `['percentage']`           |
| 37031 | 太阳星座          | `['percentage']`           |
| 37030 | 阳星合相          | `['shield']`               |
| 24311 | 泛输血            | `['shield']`               |
| 24310 | 整体论            | `['shield', 'percentage']` |
| 24298 | 坚角清汁          | `['percentage']`           |
| 24300 | 活化              | `['shield']`               |
| 37034 | 均衡预后II        | `['shield']`               |
| 7549  | 牵制              | `['percentage']`           |
| 7405  | 行吟              | `['percentage']`           |
| 16889 | 策动              | `['percentage']`           |
| 2887  | 武装解除          | `['percentage']`           |
| 16012 | 防守之桑巴        | `['percentage']`           |
| 7560  | 昏乱              | `['percentage']`           |
| 25857 | 抗死              | `['percentage']`           |

示例（以雪仇为例，其他 action 照此模式）：

```ts
    {
      id: 7535,
      name: '雪仇',
      icon: '/i/000000/000806.png',
      jobs: ['WAR', 'PLD', 'DRK', 'GNB'],
      category: ['percentage'],
      duration: 15,
      cooldown: 60,
      executor: createBuffExecutor(1193, 15),
    },
```

- [ ] **Step 2.2: 验证 tsc**

```bash
pnpm exec tsc --noEmit
```

Expected: PASS

- [ ] **Step 2.3: 跑全量测试**

```bash
pnpm test:run
```

Expected: 全部通过（新增字段不影响既有逻辑）

- [ ] **Step 2.4: 提交**

```bash
git add src/data/mitigationActions.ts
git commit -m "feat(data): annotate category on every mitigation action"
```

---

### Task 3：将 `category` 字段紧缩为必填

**Files:**

- Modify: `src/types/mitigation.ts`

- [ ] **Step 3.1: 修改 `src/types/mitigation.ts`**

把 `category?:` 改为 `category:`：

```ts
  /** 减伤类别（必填、非空）；hidden 技能也需标注 */
  category: MitigationCategory[]
```

- [ ] **Step 3.2: 验证 tsc**

```bash
pnpm exec tsc --noEmit
```

Expected: PASS。若失败说明 Task 2 漏了 action，回去补齐。

- [ ] **Step 3.3: 提交**

```bash
git add src/types/mitigation.ts
git commit -m "feat(types): make category field required"
```

---

## 阶段 2：清理旧 `hiddenPlayerIds`

### Task 4：`useSkillTracks.ts` 不再读 uiStore

**Files:**

- Modify: `src/hooks/useSkillTracks.ts`

- [ ] **Step 4.1: 替换 `src/hooks/useSkillTracks.ts` 全文**

```ts
/**
 * 技能轨道派生的响应式 hook，供时间轴视图和表格视图共用。
 */

import { useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { deriveSkillTracks, type SkillTrack } from '@/utils/skillTracks'

export function useSkillTracks(): SkillTrack[] {
  const composition = useTimelineStore(s => s.timeline?.composition)
  const actions = useMitigationStore(s => s.actions)

  return useMemo(() => {
    if (!composition) return []
    return deriveSkillTracks(composition, new Set(), actions)
  }, [composition, actions])
}
```

- [ ] **Step 4.2: 验证**

```bash
pnpm exec tsc --noEmit && pnpm test:run
```

Expected: PASS（`uiStore.hiddenPlayerIds` 还未删除，此处只是不再消费）

- [ ] **Step 4.3: 提交**

```bash
git add src/hooks/useSkillTracks.ts
git commit -m "refactor(hooks): drop uiStore hiddenPlayerIds dependency from useSkillTracks"
```

---

### Task 5：`Timeline/index.tsx` `layoutData` 不再读 `hiddenPlayerIds`

**Files:**

- Modify: `src/components/Timeline/index.tsx`

- [ ] **Step 5.1: 从 `useUIStore` 解构中移除 `hiddenPlayerIds`**

找到 `src/components/Timeline/index.tsx:164`：

```ts
const { hiddenPlayerIds, isDamageTrackCollapsed, toggleDamageTrackCollapsed } = useUIStore()
```

改为：

```ts
const { isDamageTrackCollapsed, toggleDamageTrackCollapsed } = useUIStore()
```

- [ ] **Step 5.2: 修改 `layoutData` useMemo 里的 `deriveSkillTracks` 调用**

找到 `src/components/Timeline/index.tsx:257`：

```ts
const skillTracks = deriveSkillTracks(composition, hiddenPlayerIds, actions)
```

改为：

```ts
const skillTracks = deriveSkillTracks(composition, new Set(), actions)
```

- [ ] **Step 5.3: 调整 `layoutData` useMemo 依赖数组**

找到该 useMemo 末尾（约 `src/components/Timeline/index.tsx:337`）：

```ts
}, [timeline, zoomLevel, actions, hiddenPlayerIds, isDamageTrackCollapsed])
```

改为：

```ts
}, [timeline, zoomLevel, actions, isDamageTrackCollapsed])
```

- [ ] **Step 5.4: 验证**

```bash
pnpm exec tsc --noEmit && pnpm test:run
```

Expected: PASS

- [ ] **Step 5.5: 提交**

```bash
git add src/components/Timeline/index.tsx
git commit -m "refactor(timeline): drop hiddenPlayerIds from layoutData dependencies"
```

---

### Task 6：`ExportExcelDialog` 不再读全局 `hiddenPlayerIds`

**Files:**

- Modify: `src/components/ExportExcelDialog.tsx`

- [ ] **Step 6.1: 删除 `src/components/ExportExcelDialog.tsx:29`**

```ts
const globalHiddenPlayerIds = useUIStore(s => s.hiddenPlayerIds)
```

直接删掉这行。

- [ ] **Step 6.2: 修改 `useEffect` 初始化（约 line 45）**

原：

```ts
setHiddenPlayerIds(new Set(globalHiddenPlayerIds))
```

改为：

```ts
setHiddenPlayerIds(new Set())
```

- [ ] **Step 6.3: 验证**

```bash
pnpm exec tsc --noEmit && pnpm test:run
```

Expected: PASS

- [ ] **Step 6.4: 提交**

```bash
git add src/components/ExportExcelDialog.tsx
git commit -m "refactor(export): drop globalHiddenPlayerIds initial value"
```

---

### Task 7：简化 `CompositionPopover.tsx`

**Files:**

- Modify: `src/components/CompositionPopover.tsx`

- [ ] **Step 7.1: 替换 `src/components/CompositionPopover.tsx` 全文**

```tsx
import { Users } from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import CompositionDialog from './CompositionDialog'
import JobIcon from './JobIcon'
import { sortJobsByOrder, getJobName } from '@/data/jobs'
import { MAX_PARTY_SIZE } from '@/types/timeline'
import type { Composition } from '@/types/timeline'

export default function CompositionPopover() {
  const { timeline, updateComposition } = useTimelineStore()
  const isReadOnly = useEditorReadOnly()

  const composition = timeline?.composition || { players: [] }
  const sortedPlayers = [...composition.players].sort((a, b) => {
    const jobs = sortJobsByOrder([a.job, b.job])
    return jobs.indexOf(a.job) - jobs.indexOf(b.job)
  })
  const handleSave = (newComposition: Composition) => updateComposition(newComposition)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex shrink-0 items-center gap-2 h-7 px-2 py-1 text-xs border rounded hover:bg-accent transition-colors whitespace-nowrap">
          <Users className="w-4 h-4 shrink-0" />
          <span className="hidden lg:inline">小队阵容</span>
          <span className="text-xs text-muted-foreground">
            {sortedPlayers.length}/{MAX_PARTY_SIZE}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="space-y-1 mb-2">
          {sortedPlayers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">暂无队员</p>
          ) : (
            sortedPlayers.map(player => (
              <div
                key={player.id}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50"
              >
                <JobIcon job={player.job} size="sm" />
                <span className="text-sm flex-1">{getJobName(player.job)}</span>
              </div>
            ))
          )}
        </div>
        {!isReadOnly && <CompositionDialog composition={composition} onSave={handleSave} />}
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 7.2: 验证**

```bash
pnpm exec tsc --noEmit && pnpm test:run
```

Expected: PASS

- [ ] **Step 7.3: 提交**

```bash
git add src/components/CompositionPopover.tsx
git commit -m "refactor(composition-popover): remove per-player visibility and remove buttons"
```

---

### Task 8：从 `uiStore.ts` 删除 `hiddenPlayerIds`

**Files:**

- Modify: `src/store/uiStore.ts`

- [ ] **Step 8.1: 验证所有引用已清除**

```bash
grep -r "hiddenPlayerIds\|togglePlayerVisibility\|isolatePlayer" src/ --include="*.ts" --include="*.tsx" | grep -v "uiStore.ts" | grep -v "ExportExcelDialog.tsx" | grep -v "skillTracks"
```

Expected: 只剩 uiStore.ts / ExportExcelDialog.tsx（局部 state）/ skillTracks（参数名）。

- [ ] **Step 8.2: 修改 `src/store/uiStore.ts` 的 `UIState` interface**

删除 3 行：

- `hiddenPlayerIds: Set<number>`
- `togglePlayerVisibility: (playerId: number) => void`
- `isolatePlayer: (playerId: number, allPlayerIds: number[]) => void`

- [ ] **Step 8.3: 从 store 实现里删除相关初值与 actions**

在 create 回调里删除：

- `hiddenPlayerIds: new Set<number>(),` 初值
- `togglePlayerVisibility: (playerId: number) => ...` 整个 action
- `isolatePlayer: (playerId: number, allPlayerIds: number[]) => ...` 整个 action

- [ ] **Step 8.4: 更新 `partialize`**

找到 `src/store/uiStore.ts:144`：

```ts
partialize: ({ hiddenPlayerIds, theme, ...rest }) => rest,
```

改为：

```ts
partialize: ({ theme, ...rest }) => rest,
```

（同时删除那行的 `eslint-disable-next-line` 注释因为不再需要过滤 hiddenPlayerIds）

- [ ] **Step 8.5: 验证**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test:run
```

Expected: 全 PASS

- [ ] **Step 8.6: 手动验证**

```bash
pnpm dev
```

- 打开一个本地时间轴
- 确认 CompositionPopover 里不再有眼睛和 X 按钮，只剩职业列表 + CompositionDialog 编辑入口
- 确认 Excel 导出对话框"导出阵容"勾选框初始全勾选（不受之前任何全局状态影响）

- [ ] **Step 8.7: 提交**

```bash
git add src/store/uiStore.ts
git commit -m "refactor(ui-store): remove hiddenPlayerIds and related actions"
```

---

## 阶段 3：过滤骨架

### Task 9：新建 `src/types/filter.ts`

**Files:**

- Create: `src/types/filter.ts`

- [ ] **Step 9.1: 创建 `src/types/filter.ts`**

```ts
/**
 * 时间轴过滤器类型定义
 */

import type { DamageEventType } from '@/types/timeline'
import type { Job, JobRole } from '@/data/jobs'
import type { MitigationCategory } from '@/types/mitigation'

/** 预置过滤器规则（声明式） */
export interface BuiltinFilterRule {
  damageTypes: DamageEventType[]
  jobRoles: JobRole[] | 'all'
  categories: MitigationCategory[]
}

/** 自定义预设规则（按 job 分桶的 action 白名单） */
export interface CustomFilterRule {
  damageTypes: DamageEventType[]
  /** 按职业分桶的 action ID 白名单；key 缺失或空数组都视为"该职业无技能被选中" */
  selectedActionsByJob: Partial<Record<Job, number[]>>
}

export type FilterPreset =
  | { kind: 'builtin'; id: string; name: string; rule: BuiltinFilterRule }
  | { kind: 'custom'; id: string; name: string; rule: CustomFilterRule }
```

- [ ] **Step 9.2: 验证**

```bash
pnpm exec tsc --noEmit
```

Expected: PASS

- [ ] **Step 9.3: 提交**

```bash
git add src/types/filter.ts
git commit -m "feat(types): add filter preset types"
```

---

### Task 10：新建 `filterStore` + 单测（TDD）

**Files:**

- Create: `src/store/filterStore.ts`
- Create: `src/store/filterStore.test.ts`

- [ ] **Step 10.1: 先写 `src/store/filterStore.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useFilterStore, BUILTIN_PRESETS } from './filterStore'

describe('filterStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useFilterStore.setState({
      customPresets: [],
      activeFilterId: 'builtin:all',
    })
  })

  describe('BUILTIN_PRESETS', () => {
    it('包含 5 个固定 id 的预置', () => {
      const ids = BUILTIN_PRESETS.map(p => p.id)
      expect(ids).toEqual([
        'builtin:all',
        'builtin:raidwide',
        'builtin:dps-raidwide',
        'builtin:tank',
        'builtin:healer',
      ])
    })
  })

  describe('getAllPresets', () => {
    it('builtin 在前，custom 在后', () => {
      const id = useFilterStore.getState().addPreset('我的', {
        damageTypes: ['aoe'],
        selectedActionsByJob: {},
      })
      const all = useFilterStore.getState().getAllPresets()
      expect(all.slice(0, 5).map(p => p.id)).toEqual(BUILTIN_PRESETS.map(p => p.id))
      expect(all[5].id).toBe(id)
    })
  })

  describe('getActivePreset', () => {
    it('默认返回 builtin:all', () => {
      expect(useFilterStore.getState().getActivePreset().id).toBe('builtin:all')
    })

    it('activeFilterId 不存在时回退到 builtin:all', () => {
      useFilterStore.setState({ activeFilterId: 'custom:nonexistent' })
      expect(useFilterStore.getState().getActivePreset().id).toBe('builtin:all')
    })
  })

  describe('addPreset', () => {
    it('返回唯一 id 并追加到末尾', () => {
      const a = useFilterStore
        .getState()
        .addPreset('A', { damageTypes: [], selectedActionsByJob: {} })
      const b = useFilterStore
        .getState()
        .addPreset('B', { damageTypes: [], selectedActionsByJob: {} })
      expect(a).not.toBe(b)
      const custom = useFilterStore.getState().customPresets
      expect(custom.map(p => p.id)).toEqual([a, b])
    })
  })

  describe('updatePreset', () => {
    it('修改 name', () => {
      const id = useFilterStore
        .getState()
        .addPreset('old', { damageTypes: [], selectedActionsByJob: {} })
      useFilterStore.getState().updatePreset(id, { name: 'new' })
      expect(useFilterStore.getState().customPresets[0].name).toBe('new')
    })

    it('不存在的 id 静默忽略', () => {
      expect(() => useFilterStore.getState().updatePreset('nope', { name: 'x' })).not.toThrow()
    })
  })

  describe('deletePreset', () => {
    it('删除时若当前选中，activeFilterId 回退到 builtin:all', () => {
      const id = useFilterStore
        .getState()
        .addPreset('X', { damageTypes: [], selectedActionsByJob: {} })
      useFilterStore.getState().setActiveFilter(id)
      useFilterStore.getState().deletePreset(id)
      expect(useFilterStore.getState().activeFilterId).toBe('builtin:all')
    })

    it('删除非当前选中时不影响 activeFilterId', () => {
      const a = useFilterStore
        .getState()
        .addPreset('A', { damageTypes: [], selectedActionsByJob: {} })
      const b = useFilterStore
        .getState()
        .addPreset('B', { damageTypes: [], selectedActionsByJob: {} })
      useFilterStore.getState().setActiveFilter(a)
      useFilterStore.getState().deletePreset(b)
      expect(useFilterStore.getState().activeFilterId).toBe(a)
    })
  })

  describe('reorderPresets', () => {
    it('交换两项', () => {
      const a = useFilterStore
        .getState()
        .addPreset('A', { damageTypes: [], selectedActionsByJob: {} })
      const b = useFilterStore
        .getState()
        .addPreset('B', { damageTypes: [], selectedActionsByJob: {} })
      const c = useFilterStore
        .getState()
        .addPreset('C', { damageTypes: [], selectedActionsByJob: {} })
      useFilterStore.getState().reorderPresets(0, 2)
      expect(useFilterStore.getState().customPresets.map(p => p.id)).toEqual([b, c, a])
    })

    it('越界时无变化', () => {
      const a = useFilterStore
        .getState()
        .addPreset('A', { damageTypes: [], selectedActionsByJob: {} })
      useFilterStore.getState().reorderPresets(0, 5)
      expect(useFilterStore.getState().customPresets.map(p => p.id)).toEqual([a])
    })
  })
})
```

- [ ] **Step 10.2: 跑测试验证失败**

```bash
pnpm test:run src/store/filterStore.test.ts
```

Expected: FAIL (filterStore 还不存在)

- [ ] **Step 10.3: 创建 `src/store/filterStore.ts`**

```ts
/**
 * 时间轴过滤器 store
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import type { FilterPreset, CustomFilterRule } from '@/types/filter'

export const BUILTIN_PRESETS: FilterPreset[] = [
  {
    kind: 'builtin',
    id: 'builtin:all',
    name: '全部',
    rule: {
      damageTypes: ['aoe', 'tankbuster'],
      jobRoles: 'all',
      categories: ['shield', 'percentage'],
    },
  },
  {
    kind: 'builtin',
    id: 'builtin:raidwide',
    name: '仅团减',
    rule: {
      damageTypes: ['aoe'],
      jobRoles: 'all',
      categories: ['shield', 'percentage'],
    },
  },
  {
    kind: 'builtin',
    id: 'builtin:dps-raidwide',
    name: '仅 DPS 团减',
    rule: {
      damageTypes: ['aoe'],
      jobRoles: ['melee', 'ranged', 'caster'],
      categories: ['shield', 'percentage'],
    },
  },
  {
    kind: 'builtin',
    id: 'builtin:tank',
    name: '仅坦克',
    rule: {
      damageTypes: ['tankbuster'],
      jobRoles: ['tank'],
      categories: ['shield', 'percentage'],
    },
  },
  {
    kind: 'builtin',
    id: 'builtin:healer',
    name: '仅治疗',
    rule: {
      damageTypes: ['aoe'],
      jobRoles: ['healer'],
      categories: ['shield', 'percentage'],
    },
  },
]

interface FilterStore {
  customPresets: FilterPreset[]
  activeFilterId: string

  getAllPresets: () => FilterPreset[]
  getActivePreset: () => FilterPreset

  addPreset: (name: string, rule: CustomFilterRule) => string
  updatePreset: (id: string, patch: { name?: string; rule?: CustomFilterRule }) => void
  deletePreset: (id: string) => void
  reorderPresets: (fromIndex: number, toIndex: number) => void

  setActiveFilter: (id: string) => void
}

export const useFilterStore = create<FilterStore>()(
  persist(
    (set, get) => ({
      customPresets: [],
      activeFilterId: 'builtin:all',

      getAllPresets: () => [...BUILTIN_PRESETS, ...get().customPresets],

      getActivePreset: () => {
        const all = get().getAllPresets()
        return all.find(p => p.id === get().activeFilterId) ?? BUILTIN_PRESETS[0]
      },

      addPreset: (name, rule) => {
        const id = `custom:${nanoid()}`
        set(state => ({
          customPresets: [...state.customPresets, { kind: 'custom', id, name, rule }],
        }))
        return id
      },

      updatePreset: (id, patch) => {
        set(state => ({
          customPresets: state.customPresets.map(p =>
            p.id === id && p.kind === 'custom'
              ? { ...p, name: patch.name ?? p.name, rule: patch.rule ?? p.rule }
              : p
          ),
        }))
      },

      deletePreset: id => {
        set(state => ({
          customPresets: state.customPresets.filter(p => p.id !== id),
          activeFilterId: state.activeFilterId === id ? 'builtin:all' : state.activeFilterId,
        }))
      },

      reorderPresets: (fromIndex, toIndex) => {
        set(state => {
          const { customPresets } = state
          if (
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= customPresets.length ||
            toIndex >= customPresets.length
          ) {
            return state
          }
          const next = [...customPresets]
          const [moved] = next.splice(fromIndex, 1)
          next.splice(toIndex, 0, moved)
          return { customPresets: next }
        })
      },

      setActiveFilter: id => set({ activeFilterId: id }),
    }),
    {
      name: 'healerbook-filter-store',
      version: 1,
      partialize: state => ({
        customPresets: state.customPresets,
        activeFilterId: state.activeFilterId,
      }),
    }
  )
)
```

- [ ] **Step 10.4: 跑测试验证通过**

```bash
pnpm test:run src/store/filterStore.test.ts
```

Expected: PASS

- [ ] **Step 10.5: 提交**

```bash
git add src/types/filter.ts src/store/filterStore.ts src/store/filterStore.test.ts
git commit -m "feat(store): add filterStore with builtin presets and CRUD"
```

---

### Task 11：新建 `useFilteredTimelineView` + 共享 predicate + 单测（TDD）

**Files:**

- Create: `src/hooks/useFilteredTimelineView.ts`
- Create: `src/hooks/useFilteredTimelineView.test.ts`

- [ ] **Step 11.1: 先写 `src/hooks/useFilteredTimelineView.test.ts`**

```tsx
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useFilterStore } from '@/store/filterStore'
import { useFilteredTimelineView } from './useFilteredTimelineView'
import type { Timeline } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

function makeTimeline(): Timeline {
  return {
    id: 't1',
    name: 'test',
    encounter: { id: 0, name: '', displayName: '', zone: '', damageEvents: [] },
    composition: {
      players: [
        { id: 1, job: 'PLD' },
        { id: 2, job: 'WHM' },
        { id: 3, job: 'BLM' },
      ],
    },
    damageEvents: [
      { id: 'd1', name: 'aoe1', time: 10, damage: 100, type: 'aoe', damageType: 'magical' },
      { id: 'd2', name: 'tb1', time: 20, damage: 200, type: 'tankbuster', damageType: 'physical' },
    ],
    castEvents: [
      { id: 'c1', actionId: 3540, timestamp: 5, playerId: 1 }, // PLD 圣光幕帘（shield）
      { id: 'c2', actionId: 16536, timestamp: 6, playerId: 2 }, // WHM 节制（percentage）
      { id: 'c3', actionId: 7560, timestamp: 7, playerId: 3 }, // BLM 昏乱（percentage）
    ],
    statusEvents: [],
    annotations: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

beforeEach(() => {
  localStorage.clear()
  useFilterStore.setState({ customPresets: [], activeFilterId: 'builtin:all' })
  useMitigationStore.getState().loadActions()
  useTimelineStore.setState({ timeline: makeTimeline() })
})

describe('useFilteredTimelineView', () => {
  it('builtin:all：两数组等于原数组', () => {
    const { result } = renderHook(() => useFilteredTimelineView())
    expect(result.current.filteredDamageEvents).toHaveLength(2)
    expect(result.current.filteredCastEvents).toHaveLength(3)
  })

  it('builtin:tank：只保留 tankbuster 与坦克玩家的 cast', () => {
    useFilterStore.setState({ activeFilterId: 'builtin:tank' })
    const { result } = renderHook(() => useFilteredTimelineView())
    expect(result.current.filteredDamageEvents.map(e => e.id)).toEqual(['d2'])
    expect(result.current.filteredCastEvents.map(e => e.id)).toEqual(['c1'])
  })

  it('builtin:dps-raidwide：只保留 aoe 与 DPS 玩家的 cast', () => {
    useFilterStore.setState({ activeFilterId: 'builtin:dps-raidwide' })
    const { result } = renderHook(() => useFilteredTimelineView())
    expect(result.current.filteredDamageEvents.map(e => e.id)).toEqual(['d1'])
    expect(result.current.filteredCastEvents.map(e => e.id)).toEqual(['c3'])
  })

  it('custom 预设按 (job, actionId) 白名单过滤', () => {
    const id = useFilterStore.getState().addPreset('仅 WHM 节制', {
      damageTypes: ['aoe', 'tankbuster'],
      selectedActionsByJob: { WHM: [16536] },
    })
    useFilterStore.getState().setActiveFilter(id)
    const { result } = renderHook(() => useFilteredTimelineView())
    expect(result.current.filteredCastEvents.map(e => e.id)).toEqual(['c2'])
  })
})
```

- [ ] **Step 11.2: 跑测试验证失败**

```bash
pnpm test:run src/hooks/useFilteredTimelineView.test.ts
```

Expected: FAIL（hook 文件不存在）

- [ ] **Step 11.3: 创建 `src/hooks/useFilteredTimelineView.ts`**

```ts
/**
 * 时间轴事件过滤 hook。
 *
 * 产出当前选中 FilterPreset 下应显示的 damage / cast 事件集合。
 * 不做减伤重算，纯视觉过滤。
 */

import { useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useFilterStore } from '@/store/filterStore'
import { getJobRole, type Job } from '@/data/jobs'
import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { FilterPreset } from '@/types/filter'
import type { SkillTrack } from '@/utils/skillTracks'

export interface FilteredView {
  filteredDamageEvents: DamageEvent[]
  filteredCastEvents: CastEvent[]
}

export function matchSingleAction(
  action: MitigationAction,
  playerJob: Job,
  preset: FilterPreset
): boolean {
  if (preset.kind === 'builtin') {
    const { categories, jobRoles } = preset.rule
    if (!categories.some(c => action.category.includes(c))) return false
    if (jobRoles === 'all') return true
    const role = getJobRole(playerJob)
    return role != null && jobRoles.includes(role)
  }
  return preset.rule.selectedActionsByJob[playerJob]?.includes(action.id) ?? false
}

export function matchDamageEvent(e: DamageEvent, preset: FilterPreset): boolean {
  return preset.rule.damageTypes.includes(e.type)
}

export function matchCastEvent(
  e: CastEvent,
  playerJob: Job,
  preset: FilterPreset,
  actionMap: Map<number, MitigationAction>
): boolean {
  const action = actionMap.get(e.actionId)
  if (!action) return false
  return matchSingleAction(action, playerJob, preset)
}

export function matchTrack(
  t: SkillTrack,
  preset: FilterPreset,
  actionMap: Map<number, MitigationAction>
): boolean {
  const action = actionMap.get(t.actionId)
  if (!action) return false
  return matchSingleAction(action, t.job, preset)
}

export function useFilteredTimelineView(): FilteredView {
  const timeline = useTimelineStore(s => s.timeline)
  const actions = useMitigationStore(s => s.actions)
  const activePreset = useFilterStore(s => s.getActivePreset())

  return useMemo(() => {
    if (!timeline) {
      return { filteredDamageEvents: [], filteredCastEvents: [] }
    }

    const actionMap = new Map(actions.map(a => [a.id, a]))
    const playerJobById = new Map<number, Job>(timeline.composition.players.map(p => [p.id, p.job]))

    const filteredDamageEvents = timeline.damageEvents.filter(e =>
      matchDamageEvent(e, activePreset)
    )

    const filteredCastEvents = timeline.castEvents.filter(e => {
      const job = playerJobById.get(e.playerId)
      if (!job) return false
      return matchCastEvent(e, job, activePreset, actionMap)
    })

    return { filteredDamageEvents, filteredCastEvents }
  }, [timeline, actions, activePreset])
}
```

- [ ] **Step 11.4: 跑测试验证通过**

```bash
pnpm test:run src/hooks/useFilteredTimelineView.test.ts
```

Expected: PASS

> 若 `@testing-library/react` 未安装，先运行 `pnpm add -D @testing-library/react`。但项目其他测试若已有类似 hook 测试，该依赖已在；先 `pnpm test:run` 验证一次。

- [ ] **Step 11.5: 提交**

```bash
git add src/hooks/useFilteredTimelineView.ts src/hooks/useFilteredTimelineView.test.ts
git commit -m "feat(hooks): add useFilteredTimelineView with shared predicates"
```

---

### Task 12：`useSkillTracks` 集成过滤 + 单测

**Files:**

- Modify: `src/hooks/useSkillTracks.ts`
- Create: `src/hooks/useSkillTracks.test.ts`

- [ ] **Step 12.1: 先写 `src/hooks/useSkillTracks.test.ts`**

```tsx
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useFilterStore } from '@/store/filterStore'
import { useSkillTracks } from './useSkillTracks'
import type { Timeline } from '@/types/timeline'

function makeTimeline(): Timeline {
  return {
    id: 't1',
    name: 'test',
    encounter: { id: 0, name: '', displayName: '', zone: '', damageEvents: [] },
    composition: {
      players: [
        { id: 1, job: 'PLD' },
        { id: 2, job: 'WHM' },
        { id: 3, job: 'BLM' },
      ],
    },
    damageEvents: [],
    castEvents: [],
    statusEvents: [],
    annotations: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

beforeEach(() => {
  localStorage.clear()
  useFilterStore.setState({ customPresets: [], activeFilterId: 'builtin:all' })
  useMitigationStore.getState().loadActions()
  useTimelineStore.setState({ timeline: makeTimeline() })
})

describe('useSkillTracks with filter', () => {
  it('builtin:all：每位玩家的所有非 hidden 技能都派生出轨道', () => {
    const { result } = renderHook(() => useSkillTracks())
    const jobs = new Set(result.current.map(t => t.job))
    expect(jobs.has('PLD')).toBe(true)
    expect(jobs.has('WHM')).toBe(true)
    expect(jobs.has('BLM')).toBe(true)
  })

  it('builtin:tank：非坦克玩家不再产生任何轨道', () => {
    useFilterStore.setState({ activeFilterId: 'builtin:tank' })
    const { result } = renderHook(() => useSkillTracks())
    const jobs = new Set(result.current.map(t => t.job))
    expect(jobs.has('PLD')).toBe(true)
    expect(jobs.has('WHM')).toBe(false)
    expect(jobs.has('BLM')).toBe(false)
  })

  it('custom 预设按 (job, actionId) 精确过滤', () => {
    const id = useFilterStore.getState().addPreset('only-pld-7535', {
      damageTypes: [],
      selectedActionsByJob: { PLD: [7535] }, // 雪仇
    })
    useFilterStore.getState().setActiveFilter(id)
    const { result } = renderHook(() => useSkillTracks())
    expect(result.current).toHaveLength(1)
    expect(result.current[0].job).toBe('PLD')
    expect(result.current[0].actionId).toBe(7535)
  })
})
```

- [ ] **Step 12.2: 修改 `src/hooks/useSkillTracks.ts`**

```ts
/**
 * 技能轨道派生的响应式 hook，集成过滤器。
 */

import { useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useFilterStore } from '@/store/filterStore'
import { deriveSkillTracks, type SkillTrack } from '@/utils/skillTracks'
import { matchTrack } from './useFilteredTimelineView'

export function useSkillTracks(): SkillTrack[] {
  const composition = useTimelineStore(s => s.timeline?.composition)
  const actions = useMitigationStore(s => s.actions)
  const activePreset = useFilterStore(s => s.getActivePreset())

  return useMemo(() => {
    if (!composition) return []
    const tracks = deriveSkillTracks(composition, new Set(), actions)
    const actionMap = new Map(actions.map(a => [a.id, a]))
    return tracks.filter(t => matchTrack(t, activePreset, actionMap))
  }, [composition, actions, activePreset])
}
```

- [ ] **Step 12.3: 跑测试**

```bash
pnpm test:run src/hooks/useSkillTracks.test.ts
```

Expected: PASS

- [ ] **Step 12.4: 跑全量**

```bash
pnpm test:run
```

Expected: 全绿

- [ ] **Step 12.5: 提交**

```bash
git add src/hooks/useSkillTracks.ts src/hooks/useSkillTracks.test.ts
git commit -m "feat(hooks): integrate filter into useSkillTracks"
```

---

### Task 13：`Timeline/index.tsx` 改走 `useSkillTracks()`

**Files:**

- Modify: `src/components/Timeline/index.tsx`

- [ ] **Step 13.1: import useSkillTracks**

在顶部 import 区加：

```ts
import { useSkillTracks } from '@/hooks/useSkillTracks'
```

- [ ] **Step 13.2: 在组件体内调用 hook**

在其它 hook 调用处（约 `src/components/Timeline/index.tsx:167` 附近）加一行：

```ts
const skillTracks = useSkillTracks()
```

- [ ] **Step 13.3: `layoutData` useMemo 内去掉内联 `deriveSkillTracks` 调用**

找到 `src/components/Timeline/index.tsx:256-257`：

```ts
const composition = timeline.composition || { players: [] }
const skillTracks = deriveSkillTracks(composition, new Set(), actions)
```

改为：

```ts
const composition = timeline.composition || { players: [] }
```

（删除 `const skillTracks = deriveSkillTracks(...)` 行；外层已经拿到 `skillTracks`）

- [ ] **Step 13.4: 更新 useMemo 依赖数组**

原（约 line 337）：

```ts
}, [timeline, zoomLevel, actions, isDamageTrackCollapsed])
```

改为：

```ts
}, [timeline, zoomLevel, skillTracks, isDamageTrackCollapsed])
```

- [ ] **Step 13.5: 删除 `deriveSkillTracks` 的未使用 import**

若此文件内无其它 `deriveSkillTracks` 使用，删除 line 43 的 import：

```ts
import { deriveSkillTracks } from '@/utils/skillTracks'
```

验证方法：`grep -n "deriveSkillTracks" src/components/Timeline/index.tsx`

- [ ] **Step 13.6: 验证**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test:run
```

Expected: PASS

- [ ] **Step 13.7: 提交**

```bash
git add src/components/Timeline/index.tsx
git commit -m "refactor(timeline): consume skill tracks via useSkillTracks hook"
```

---

### Task 14：三处消费点接入 `useFilteredTimelineView`

**Files:**

- Modify: `src/components/Timeline/index.tsx`
- Modify: `src/components/Timeline/TimelineMinimap.tsx`
- Modify: `src/components/TimelineTable/index.tsx`

- [ ] **Step 14.1: 修改 `Timeline/index.tsx`**

顶部 import：

```ts
import { useFilteredTimelineView } from '@/hooks/useFilteredTimelineView'
```

在组件体内加一行：

```ts
const { filteredDamageEvents, filteredCastEvents } = useFilteredTimelineView()
```

然后把所有访问 `timeline.damageEvents` 和 `timeline.castEvents` 的地方分为两类：

- **过滤相关**（渲染、泳道算法、视觉派生）→ 改用 `filteredDamageEvents / filteredCastEvents`
- **布局相关**（时间轴总长计算、minimap 锚点等需要全量数据的地方）→ 保持 `timeline.damageEvents / timeline.castEvents`

具体：

`src/components/Timeline/index.tsx:267` `for (const event of timeline.damageEvents)`（泳道算法 → 过滤后事件才参与视觉泳道）：

```ts
for (const event of filteredDamageEvents) {
```

`src/components/Timeline/index.tsx:313` `for (const castEvent of timeline.castEvents)`：

```ts
for (const castEvent of filteredCastEvents) {
```

`src/components/Timeline/index.tsx:291-292`（时间轴总长计算，需要全量数据 → 不改）：

```ts
...timeline.damageEvents.map(e => e.time),
...timeline.castEvents.map(ce => ce.timestamp)
```

保持原样。

在 useMemo 依赖中，把 `timeline` 替换为 `[filteredDamageEvents, filteredCastEvents, timeline, zoomLevel, skillTracks, isDamageTrackCollapsed]`（保留 `timeline` 用于总长等全量字段）。

- [ ] **Step 14.2: 修改 `src/components/Timeline/TimelineMinimap.tsx`**

找 `timeline.damageEvents.map(e => e.time)`（`TimelineMinimap.tsx:136`）：

改用 `useFilteredTimelineView` 的 `filteredDamageEvents`：

组件顶部 import：

```ts
import { useFilteredTimelineView } from '@/hooks/useFilteredTimelineView'
```

组件体内加：

```ts
const { filteredDamageEvents } = useFilteredTimelineView()
```

两处替换：

- `const damageEventTimes = timeline.damageEvents.map(e => e.time).filter(t => !isNaN(t))` → `filteredDamageEvents.map(...)`
- `...timeline.damageEvents.map(e => eventResults.get(e.id)?.finalDamage ?? e.damage)` → `...filteredDamageEvents.map(...)`

- [ ] **Step 14.3: 修改 `src/components/TimelineTable/index.tsx`**

类似地，定位对 `timeline.damageEvents / timeline.castEvents` 的访问，改为 `filteredDamageEvents / filteredCastEvents`。

顶部 import：

```ts
import { useFilteredTimelineView } from '@/hooks/useFilteredTimelineView'
```

```ts
const { filteredDamageEvents, filteredCastEvents } = useFilteredTimelineView()
```

根据实际代码替换消费点（具体行由实施者按 grep 结果处理）：

```bash
grep -n "timeline\.\(damageEvents\|castEvents\)" src/components/TimelineTable/index.tsx
```

- [ ] **Step 14.4: 验证**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test:run
```

Expected: PASS

- [ ] **Step 14.5: 手测**

```bash
pnpm dev
```

- 打开任意时间轴，默认"全部"行为与之前一致
- 后续 UI 落地后再做更完整测试

- [ ] **Step 14.6: 提交**

```bash
git add src/components/Timeline/index.tsx \
        src/components/Timeline/TimelineMinimap.tsx \
        src/components/TimelineTable/index.tsx
git commit -m "feat(timeline): consume filtered view in timeline/minimap/table"
```

---

## 阶段 4：UI 组件

### Task 15：安装 dnd-kit

**Files:**

- Modify: `package.json`、`pnpm-lock.yaml`

- [ ] **Step 15.1: 安装依赖**

```bash
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 15.2: 验证**

```bash
pnpm exec tsc --noEmit && pnpm build
```

Expected: PASS

- [ ] **Step 15.3: 提交**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add @dnd-kit for draggable preset list"
```

---

### Task 16：`SortablePresetRow` 组件

**Files:**

- Create: `src/components/FilterMenu/SortablePresetRow.tsx`

- [ ] **Step 16.1: 创建文件**

```tsx
/**
 * 单条可拖拽的预设行。
 */

import { GripVertical, Pencil, Trash2 } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import type { FilterPreset } from '@/types/filter'

interface Props {
  preset: FilterPreset
  onEdit: () => void
  onDelete: () => void
}

export default function SortablePresetRow({ preset, onEdit, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: preset.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-background"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
        aria-label="拖动"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex-1 text-sm truncate">{preset.name}</span>
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onEdit} aria-label="编辑">
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
        onClick={onDelete}
        aria-label="删除"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
```

- [ ] **Step 16.2: 验证**

```bash
pnpm exec tsc --noEmit
```

Expected: PASS

- [ ] **Step 16.3: 提交**

```bash
git add src/components/FilterMenu/SortablePresetRow.tsx
git commit -m "feat(filter-menu): add SortablePresetRow wrapper"
```

---

### Task 17：`EditPresetDialog` 组件

**Files:**

- Create: `src/components/FilterMenu/EditPresetDialog.tsx`

- [ ] **Step 17.1: 创建文件**

```tsx
/**
 * 新建 / 编辑过滤预设对话框。
 */

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useMitigationStore } from '@/store/mitigationStore'
import { useFilterStore } from '@/store/filterStore'
import {
  JOB_ORDER,
  ROLE_ORDER,
  ROLE_LABELS,
  getJobName,
  groupJobsByRole,
  type Job,
} from '@/data/jobs'
import { getIconUrl } from '@/utils/iconUtils'
import JobIcon from '../JobIcon'
import { cn } from '@/lib/utils'
import type { FilterPreset, CustomFilterRule } from '@/types/filter'
import type { DamageEventType } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

interface Props {
  open: boolean
  onClose: () => void
  preset?: FilterPreset // 仅 kind === 'custom' 时用于编辑
}

const MAX_NAME = 20

export default function EditPresetDialog({ open, onClose, preset }: Props) {
  const allActions = useMitigationStore(s => s.actions)
  const addPreset = useFilterStore(s => s.addPreset)
  const updatePreset = useFilterStore(s => s.updatePreset)

  const visibleActions = useMemo(() => allActions.filter(a => !a.hidden), [allActions])

  // 按 job 分组 actions（供 UI 显示）
  const actionsByJob = useMemo(() => {
    const map = new Map<Job, MitigationAction[]>()
    for (const job of JOB_ORDER) {
      map.set(
        job,
        visibleActions.filter(a => a.jobs.includes(job))
      )
    }
    return map
  }, [visibleActions])

  const defaultSelectedAll = useMemo(() => {
    const byJob: Partial<Record<Job, number[]>> = {}
    for (const job of JOB_ORDER) {
      byJob[job] = actionsByJob.get(job)!.map(a => a.id)
    }
    return byJob
  }, [actionsByJob])

  const [name, setName] = useState<string>(() => (preset?.kind === 'custom' ? preset.name : ''))
  const [damageTypes, setDamageTypes] = useState<DamageEventType[]>(() =>
    preset?.kind === 'custom' ? preset.rule.damageTypes : ['aoe', 'tankbuster']
  )
  const [selectedActionsByJob, setSelectedActionsByJob] = useState<Partial<Record<Job, number[]>>>(
    () => (preset?.kind === 'custom' ? preset.rule.selectedActionsByJob : defaultSelectedAll)
  )

  const toggleDamageType = (t: DamageEventType) => {
    setDamageTypes(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]))
  }

  const toggleAction = (job: Job, actionId: number) => {
    setSelectedActionsByJob(prev => {
      const current = prev[job] ?? []
      const next = current.includes(actionId)
        ? current.filter(id => id !== actionId)
        : [...current, actionId]
      return { ...prev, [job]: next }
    })
  }

  const toggleJobAll = (job: Job) => {
    const jobActionIds = actionsByJob.get(job)!.map(a => a.id)
    const currentIds = selectedActionsByJob[job] ?? []
    const allSelected = jobActionIds.every(id => currentIds.includes(id))
    setSelectedActionsByJob(prev => ({
      ...prev,
      [job]: allSelected ? [] : jobActionIds,
    }))
  }

  const canSave = name.trim().length > 0

  const handleSave = () => {
    if (!canSave) return
    const rule: CustomFilterRule = { damageTypes, selectedActionsByJob }
    if (preset?.kind === 'custom') {
      updatePreset(preset.id, { name: name.trim(), rule })
      toast.success('已保存')
    } else {
      addPreset(name.trim(), rule)
      toast.success('已创建')
    }
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="2xl">
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{preset?.kind === 'custom' ? '编辑过滤预设' : '新建过滤预设'}</ModalTitle>
        </ModalHeader>

        <div className="space-y-5 py-2">
          {/* 段 1：名称 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">预设名称</label>
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={e => setName(e.target.value.slice(0, MAX_NAME))}
                maxLength={MAX_NAME}
                placeholder="输入预设名称"
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {name.length} / {MAX_NAME}
              </span>
            </div>
          </div>

          {/* 段 2：伤害事件类型 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">伤害事件类型</label>
            <div className="flex items-center gap-6 px-2 py-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={damageTypes.includes('aoe')}
                  onCheckedChange={() => toggleDamageType('aoe')}
                />
                <span className="text-sm">AOE</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={damageTypes.includes('tankbuster')}
                  onCheckedChange={() => toggleDamageType('tankbuster')}
                />
                <span className="text-sm">死刑</span>
              </label>
            </div>
          </div>

          {/* 段 3：技能选择 */}
          <div className="space-y-3">
            <label className="text-sm font-medium">技能选择</label>
            <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
              {ROLE_ORDER.map(role => {
                const jobsInRole = groupJobsByRole(JOB_ORDER)[role]
                if (jobsInRole.length === 0) return null
                return (
                  <div key={role} className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground">
                      {ROLE_LABELS[role]}
                    </h4>
                    {jobsInRole.map(job => {
                      const jobActions = actionsByJob.get(job) ?? []
                      if (jobActions.length === 0) return null
                      const currentIds = selectedActionsByJob[job] ?? []
                      const allSelected = jobActions.every(a => currentIds.includes(a.id))
                      return (
                        <div
                          key={job}
                          className="flex items-center gap-2 py-1 border-t border-border/50 first:border-t-0"
                        >
                          <JobIcon job={job} size="sm" />
                          <span className="text-xs w-10 shrink-0">{getJobName(job)}</span>
                          <div className="flex flex-wrap gap-1.5 flex-1">
                            {jobActions.map(action => {
                              const isSelected = currentIds.includes(action.id)
                              return (
                                <button
                                  key={action.id}
                                  type="button"
                                  onClick={() => toggleAction(job, action.id)}
                                  title={action.name}
                                  className={cn(
                                    'relative h-8 w-8 overflow-hidden rounded-md border transition',
                                    isSelected
                                      ? 'border-primary ring-1 ring-primary'
                                      : 'border-border opacity-60 saturate-50 hover:opacity-90 hover:saturate-100'
                                  )}
                                >
                                  <img
                                    src={getIconUrl(action.icon)}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                  {isSelected && (
                                    <span className="absolute right-0 top-0 flex h-3 w-3 items-center justify-center rounded-tr-md rounded-bl-md bg-green-500 text-[8px] font-bold leading-none text-white">
                                      ✓
                                    </span>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs shrink-0"
                            onClick={() => toggleJobAll(job)}
                          >
                            {allSelected ? '取消全选' : '全选'}
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <ModalFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            保存
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
```

- [ ] **Step 17.2: 验证**

```bash
pnpm exec tsc --noEmit && pnpm lint
```

Expected: PASS

- [ ] **Step 17.3: 提交**

```bash
git add src/components/FilterMenu/EditPresetDialog.tsx
git commit -m "feat(filter-menu): add EditPresetDialog"
```

---

### Task 18：`ManagePresetsDialog` 组件

**Files:**

- Create: `src/components/FilterMenu/ManagePresetsDialog.tsx`

- [ ] **Step 18.1: 创建文件**

```tsx
/**
 * 预设管理对话框：列表 + 拖拽排序 + 新建 / 编辑 / 删除入口。
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useFilterStore } from '@/store/filterStore'
import SortablePresetRow from './SortablePresetRow'
import EditPresetDialog from './EditPresetDialog'
import type { FilterPreset } from '@/types/filter'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ManagePresetsDialog({ open, onClose }: Props) {
  const customPresets = useFilterStore(s => s.customPresets)
  const reorderPresets = useFilterStore(s => s.reorderPresets)
  const deletePreset = useFilterStore(s => s.deletePreset)

  const [editingPreset, setEditingPreset] = useState<FilterPreset | undefined>(undefined)
  const [editDialogOpen, setEditDialogOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = customPresets.findIndex(p => p.id === active.id)
    const to = customPresets.findIndex(p => p.id === over.id)
    if (from < 0 || to < 0) return
    reorderPresets(from, to)
  }

  const openNew = () => {
    setEditingPreset(undefined)
    setEditDialogOpen(true)
  }

  const openEdit = (preset: FilterPreset) => {
    setEditingPreset(preset)
    setEditDialogOpen(true)
  }

  return (
    <>
      <Modal open={open} onClose={onClose}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>管理预设</ModalTitle>
          </ModalHeader>

          <div className="space-y-2 py-2">
            {customPresets.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无自定义预设</div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={customPresets.map(p => p.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1.5">
                    {customPresets.map(preset => (
                      <SortablePresetRow
                        key={preset.id}
                        preset={preset}
                        onEdit={() => openEdit(preset)}
                        onDelete={() => deletePreset(preset.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>

          <ModalFooter>
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
            <Button onClick={openNew}>
              <Plus className="w-4 h-4 mr-1" />
              新增预设
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {editDialogOpen && (
        <EditPresetDialog
          open={editDialogOpen}
          onClose={() => setEditDialogOpen(false)}
          preset={editingPreset}
        />
      )}
    </>
  )
}
```

- [ ] **Step 18.2: 验证**

```bash
pnpm exec tsc --noEmit && pnpm lint
```

Expected: PASS

- [ ] **Step 18.3: 提交**

```bash
git add src/components/FilterMenu/ManagePresetsDialog.tsx
git commit -m "feat(filter-menu): add ManagePresetsDialog with dnd-kit sorting"
```

---

### Task 19：`FilterMenu` 组件

**Files:**

- Create: `src/components/FilterMenu/FilterMenu.tsx`

- [ ] **Step 19.1: 创建文件**

```tsx
/**
 * 工具栏上的"过滤"下拉菜单入口。
 */

import { useState } from 'react'
import { Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { useFilterStore } from '@/store/filterStore'
import { BUILTIN_PRESETS } from '@/store/filterStore'
import ManagePresetsDialog from './ManagePresetsDialog'
import { track } from '@/utils/analytics'

export default function FilterMenu() {
  const activeFilterId = useFilterStore(s => s.activeFilterId)
  const setActiveFilter = useFilterStore(s => s.setActiveFilter)
  const customPresets = useFilterStore(s => s.customPresets)

  const [menuOpen, setMenuOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  const handleChange = (id: string) => {
    track('filter-change', { id })
    setActiveFilter(id)
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip open={menuOpen ? false : undefined}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Filter className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">过滤</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" onCloseAutoFocus={e => e.preventDefault()}>
          <DropdownMenuRadioGroup value={activeFilterId} onValueChange={handleChange}>
            {BUILTIN_PRESETS.map(p => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                {p.name}
              </DropdownMenuRadioItem>
            ))}
            {customPresets.length > 0 && <DropdownMenuSeparator />}
            {customPresets.map(p => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                {p.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setManageOpen(true)}>管理预设…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {manageOpen && <ManagePresetsDialog open={manageOpen} onClose={() => setManageOpen(false)} />}
    </>
  )
}
```

- [ ] **Step 19.2: 验证**

```bash
pnpm exec tsc --noEmit && pnpm lint
```

Expected: PASS

- [ ] **Step 19.3: 提交**

```bash
git add src/components/FilterMenu/FilterMenu.tsx
git commit -m "feat(filter-menu): add FilterMenu dropdown entry"
```

---

### Task 20：把 `<FilterMenu />` 挂入 `EditorToolbar`

**Files:**

- Modify: `src/components/EditorToolbar.tsx`

- [ ] **Step 20.1: 添加 import**

```ts
import FilterMenu from './FilterMenu/FilterMenu'
```

- [ ] **Step 20.2: 在视图菜单的 `</DropdownMenu>` 结束标签**（约 line 320）**之后**插入 `<FilterMenu />`

原：

```tsx
            {/* 视图菜单 */}
            <DropdownMenu ...>
              ...
            </DropdownMenu>

            <div className="w-px h-6 bg-border mx-1" />

            {/* Party Composition */}
            <CompositionPopover />
```

改为：

```tsx
            {/* 视图菜单 */}
            <DropdownMenu ...>
              ...
            </DropdownMenu>

            {/* 过滤菜单 */}
            <FilterMenu />

            <div className="w-px h-6 bg-border mx-1" />

            {/* Party Composition */}
            <CompositionPopover />
```

- [ ] **Step 20.3: 验证**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test:run
```

Expected: PASS

- [ ] **Step 20.4: 手动冒烟**

```bash
pnpm dev
```

- 工具栏视图菜单后出现 Filter icon
- 点开下拉：5 个 builtin radio 项 + 「管理预设…」
- 切换 radio → 时间轴按预期过滤
- 点「管理预设…」打开 modal，显示"暂无自定义预设"
- 点「新增预设」输入名称（如"我的坦克"），默认全选，切到"仅坦克"语义后保存
- 下拉菜单出现自定义预设（与 builtin 之间有分隔线）
- 切换自定义预设正常工作
- 回到管理 modal，拖拽 / 编辑 / 删除都 OK
- 刷新页面：预设列表与当前选中的过滤器都保持

- [ ] **Step 20.5: 提交**

```bash
git add src/components/EditorToolbar.tsx
git commit -m "feat(toolbar): mount FilterMenu after view menu"
```

---

## 阶段 5：验收

### Task 21：全量质量门

- [ ] **Step 21.1: 类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: PASS

- [ ] **Step 21.2: Lint**

```bash
pnpm lint
```

Expected: PASS

- [ ] **Step 21.3: 全量测试**

```bash
pnpm test:run
```

Expected: 全绿

- [ ] **Step 21.4: 构建**

```bash
pnpm build
```

Expected: 无错误

---

### Task 22：手动验证清单

按下列清单逐项在浏览器里验证：

- [ ] 1. 默认"全部"，行为与实施前一致
- [ ] 2. 切"仅坦克"：只显示 tankbuster 伤害事件；非坦克玩家的技能行消失
- [ ] 3. 切"仅 DPS 团减"：只 AOE；坦克/治疗技能行消失
- [ ] 4. 新建自定义预设默认全选 → 等同"全部"；取消某 (job, action) 后对应轨道消失
- [ ] 5. 删除当前选中自定义预设 → 回退"全部"
- [ ] 6. 拖拽排序后刷新页面，顺序持久
- [ ] 7. 只读 / view / 回放模式下过滤菜单可用
- [ ] 8. Excel 导出不受过滤影响（全量导出）
- [ ] 9. `CompositionPopover` 不再有 Eye / EyeOff / X 按钮
- [ ] 10. 撤销/重做不受过滤影响；过滤切换不进 history

### Task 23：请用户审查 category 分类

Task 2 中的 category 分类来自 plan 作者的初步判断，属于 R1 风险点。
在最终 PR 前请用户通读 `src/data/mitigationActions.ts`，确认：

- 每个 action 的 category 数组是否准确
- 多分类 action（如"整体论"）是否遗漏

若用户发现不准确的分类，按用户意见修订后再提交。

---

## 风险点提醒

- **R1**：category 分类需用户 review（Task 23）
- **R2**：`matchSingleAction` 是三处 predicate 的单一源头；修改时注意不要让某处绕开它
- **R3**：`Timeline/index.tsx` 的 `skillTracks` 来源改为 hook，若 layoutData 出现闪烁或错位，检查 useMemo 依赖数组与引用稳定性
- **R4**：旧用户 localStorage 里可能残留 `ui-store.hiddenPlayerIds`，zustand persist 会自动忽略，不需要 migrate
- **R5**：dnd-kit 触屏支持：默认 `PointerSensor` 可用，无额外配置
