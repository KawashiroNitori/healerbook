# 时间轴过滤菜单设计

## 目标

在 EditorPage 工具栏"视图"菜单之后新增"过滤"下拉菜单，支持：

1. **5 个预置过滤器**（全部 / 仅团减 / 仅 DPS 团减 / 仅坦克 / 仅治疗），单选
2. **用户自定义预设**：新增、编辑、删除、拖拽排序，在 localStorage 持久化
3. 过滤**纯视觉**，不影响减伤计算，不影响导出结果
4. 同步移除 `uiStore.hiddenPlayerIds` 相关的玩家显隐机制（由过滤系统统一接管"哪些玩家/技能可见"）

## 非目标

- 不做 what-if 重算：过滤对 `MitigationCalculator` 透明
- 不影响 `TimelineExcel / Souma` 导出结果
- 不为过滤器提供快捷键（当前版本）
- 不为预设提供导入/导出或跨设备同步

## 作用范围

| 区域                                                  | 跟随过滤                                               |
| ----------------------------------------------------- | ------------------------------------------------------ |
| 时间轴主视图（Canvas）的伤害事件、技能轨道、cast 图标 | 是                                                     |
| 表格视图的行/列                                       | 是                                                     |
| 缩略图（TimelineMinimap）的 damage events             | 是                                                     |
| 伤害卡片上的数值（最终伤害 / 原始伤害）               | 否（仍由全量 castEvents 经 MitigationCalculator 算得） |
| Excel 导出 / Souma 导出                               | 否                                                     |
| 撤销/重做堆栈                                         | 否（过滤切换不进 history）                             |

所有模式均展示过滤按钮：编辑、只读、强制只读（view 模式）、回放模式。

## 数据模型

### `MitigationAction` 扩展

```ts
// src/types/mitigation.ts
export type MitigationCategory = 'shield' | 'percentage'

export interface MitigationAction {
  // ...既有字段...
  /** 减伤类别（必填、非空）；hidden 技能也需标注 */
  category: MitigationCategory[]
}
```

`src/data/mitigationActions.ts` 每一项 action 必须补 `category`，TypeScript 强制。

### 过滤预设类型

```ts
// src/types/filter.ts
import type { DamageEventType } from '@/types/timeline'
import type { Job, JobRole } from '@/data/jobs'
import type { MitigationCategory } from '@/types/mitigation'

/** 预置过滤器规则（声明式） */
export interface BuiltinFilterRule {
  damageTypes: DamageEventType[]
  jobRoles: JobRole[] | 'all'
  categories: MitigationCategory[]
}

/** 自定义预设规则（枚举式：按 job 分桶的 action 白名单） */
export interface CustomFilterRule {
  damageTypes: DamageEventType[]
  /** 按职业分桶的 action ID 白名单；key 缺失或空数组都视为"该职业无技能被选中" */
  selectedActionsByJob: Partial<Record<Job, number[]>>
}

export type FilterPreset =
  | { kind: 'builtin'; id: string; name: string; rule: BuiltinFilterRule }
  | { kind: 'custom'; id: string; name: string; rule: CustomFilterRule }
```

### Builtin 预设（定义在 `filterStore.ts`）

```ts
const BUILTIN_PRESETS: FilterPreset[] = [
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
    rule: { damageTypes: ['aoe'], jobRoles: 'all', categories: ['shield', 'percentage'] },
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
    rule: { damageTypes: ['tankbuster'], jobRoles: ['tank'], categories: ['shield', 'percentage'] },
  },
  {
    kind: 'builtin',
    id: 'builtin:healer',
    name: '仅治疗',
    rule: { damageTypes: ['aoe'], jobRoles: ['healer'], categories: ['shield', 'percentage'] },
  },
]
```

## 状态管理

### `src/store/filterStore.ts`（新增）

```ts
interface FilterStore {
  customPresets: FilterPreset[] // 仅 custom；builtin 不入 state
  activeFilterId: string // 默认 'builtin:all'

  getAllPresets: () => FilterPreset[] // [...BUILTIN_PRESETS, ...customPresets]
  getActivePreset: () => FilterPreset // 找不到回退 'builtin:all'

  addPreset: (name: string, rule: CustomFilterRule) => string // 返回新 id
  updatePreset: (id: string, patch: { name?: string; rule?: CustomFilterRule }) => void
  deletePreset: (id: string) => void // 若删除当前选中 → activeFilterId = 'builtin:all'
  reorderPresets: (fromIndex: number, toIndex: number) => void

  setActiveFilter: (id: string) => void
}
```

- `nanoid()` 生成 `id`（项目已依赖）
- `persist` 中间件持久化 `customPresets` 与 `activeFilterId`，`partialize` 排除瞬态字段
- `version: 1`，预留 `migrate` 兜底

localStorage key：`healerbook-filter-store`。

## 核心过滤逻辑

### `src/hooks/useFilteredTimelineView.ts`（新增）

```ts
interface FilteredView {
  filteredDamageEvents: DamageEvent[]
  filteredCastEvents: CastEvent[]
}

export function useFilteredTimelineView(): FilteredView
```

实现：

1. 读取 `timelineStore.timeline` 和 `filterStore.getActivePreset()`
2. 构造 `playerJobById: Map<number, Job>` 用于 cast 事件的 player → job 查询
3. 用 `matchDamageEvent(event)` 和 `matchCastEvent(event, playerJob)` 过滤
4. `useMemo` 依赖 `[timeline, activePreset]`

### `useSkillTracks` 集成过滤

```ts
// src/hooks/useSkillTracks.ts（改造）
export function useSkillTracks(): SkillTrack[] {
  const composition = useTimelineStore(s => s.timeline?.composition)
  const allActions = useMitigationStore(s => s.actions)
  const activePreset = useFilterStore(s => s.getActivePreset())

  return useMemo(() => {
    if (!composition) return []
    const tracks = deriveSkillTracks(composition, new Set(), allActions)
    const actionMap = new Map(allActions.map(a => [a.id, a]))
    return tracks.filter(t => matchTrack(t, activePreset, actionMap))
  }, [composition, allActions, activePreset])
}
```

### 共享 predicate 工具（放在 `useFilteredTimelineView.ts` 同文件，内部 export）

三处 predicate 共享同一个底层函数 `matchSingleAction(action, playerJob, preset)`，避免三处分别实现导致跨角色 action 显隐不一致：

```ts
function matchSingleAction(
  action: MitigationAction,
  playerJob: Job,
  preset: FilterPreset
): boolean {
  if (preset.kind === 'builtin') {
    const { categories, jobRoles } = preset.rule
    if (!categories.some(c => action.category.includes(c))) return false
    if (jobRoles === 'all') return true
    return jobRoles.includes(getJobRole(playerJob)!)
  }
  // custom
  return preset.rule.selectedActionsByJob[playerJob]?.includes(action.id) ?? false
}

function matchDamageEvent(e: DamageEvent, preset: FilterPreset): boolean {
  return preset.rule.damageTypes.includes(e.type)
}

function matchCastEvent(
  e: CastEvent,
  playerJob: Job,
  preset: FilterPreset,
  actionMap: Map<number, MitigationAction>
): boolean {
  const action = actionMap.get(e.actionId)
  if (!action) return false
  return matchSingleAction(action, playerJob, preset)
}

function matchTrack(
  t: SkillTrack,
  preset: FilterPreset,
  actionMap: Map<number, MitigationAction>
): boolean {
  const action = actionMap.get(t.actionId)
  if (!action) return false
  return matchSingleAction(action, t.job, preset)
}
```

调用方在 `useMemo` 里构建一次 `actionMap`（`new Map(actions.map(a => [a.id, a]))`），避免每条轨道 O(n) 查询。

### 关键语义：跨角色 action

`matchSingleAction` 判定使用**玩家的 job**（不是 action 的 jobs 数组）。这保证：

- 跨角色 action 在"仅坦克"模式下，仅坦克玩家使用时显示
- 自定义预设的 `(job, actionId)` 粒度天然生效

## UI 组件

### 组件树

```
EditorToolbar
  └─ <FilterMenu />  ← 插在视图菜单之后
       ├─ DropdownMenu（下拉主体）
       ├─ <ManagePresetsDialog />
       └─ <EditPresetDialog />
```

### `FilterMenu.tsx` —— 下拉菜单

结构：

- `Filter` icon（lucide-react），`h-7 w-7 variant="ghost"` 按钮
- `DropdownMenuRadioGroup` 绑定 `filterStore.activeFilterId`
  - [预置区] 5 个 `DropdownMenuRadioItem`
  - `DropdownMenuSeparator`（仅当 customPresets 非空时渲染）
  - [自定义区] custom preset radio items
- `DropdownMenuSeparator`
- `DropdownMenuItem`「管理预设…」→ 打开 `ManagePresetsDialog`

风格与 `EditorToolbar.tsx` 中现有"视图"菜单、"导出"菜单完全一致（Tooltip + DropdownMenu 组合、`onCloseAutoFocus={e => e.preventDefault()}`）。

### `ManagePresetsDialog.tsx` —— 预设管理

布局：

- `Modal` 标题"管理预设"
- 列表区：竖向排列 `SortablePresetRow`，每行 `[拖柄] 预设名 [编辑] [删除]`
  - 列表为空显示"暂无自定义预设"
- 底部 `[新增预设]` 按钮 → 打开 `EditPresetDialog`（不带 preset 参数）

拖拽：

```tsx
<DndContext onDragEnd={handleDragEnd} sensors={sensors}>
  <SortableContext items={presetIds} strategy={verticalListSortingStrategy}>
    {customPresets.map(p => (
      <SortablePresetRow key={p.id} preset={p} />
    ))}
  </SortableContext>
</DndContext>
```

`handleDragEnd` → `filterStore.reorderPresets(fromIndex, toIndex)`。

删除无二次确认（YAGNI）。

### `EditPresetDialog.tsx` —— 新建/编辑预设

`Modal` 标题："新建过滤预设" / "编辑过滤预设"（按 `preset` 参数切换）。

**段 1：预设名称**

- `<Input>`，`maxLength={20}`，必填
- 字符计数提示 `x / 20`
- 保存按钮在名称为空时 disabled

**段 2：伤害事件类型**

- 两个 `<Switch>`：AOE、死刑
- 状态同步到 `damageTypes: DamageEventType[]`

**段 3：技能选择**

- 按 `ROLE_ORDER` 分组显示（坦克 / 治疗 / 近战DPS / 远程物理DPS / 远程魔法DPS），每组有 role 标题
- 每组内按职业排列，每行：`JobIcon + 职业名 + 该职业非 hidden action 的 icon 列表 + [全选/取消全选]`
- icon 样式沿用 `ExportSoumaDialog` 的 "未选=灰度低透明，已选=饱和+✓ 角标"
- 点击 icon 切换 `selectedActionsByJob[job]` 数组中对应 id

**段 4：底部**

- `[取消] [保存]`

**新建默认值**

- `name = ''`
- `damageTypes = ['aoe', 'tankbuster']`
- `selectedActionsByJob = { [job]: [所有该 job 的非 hidden action id] }`（全选）

### `SortablePresetRow.tsx` —— dnd-kit 行封装

`@dnd-kit/sortable` 的 `useSortable`，把 `setNodeRef / listeners / attributes / transform / transition` 绑到 `GripVertical` 拖柄上。独立文件让 `ManagePresetsDialog` 的主体更清晰。

## 既有代码清理

### `uiStore.ts`（删除字段）

- `hiddenPlayerIds: Set<number>` 状态
- `togglePlayerVisibility` action
- `isolatePlayer` action
- persist `partialize` 中的相关字段引用

### `CompositionPopover.tsx`（简化）

删除：

- Eye / EyeOff / X 按钮
- `hoveredPlayerId` state 及 `onMouseEnter / onMouseLeave`
- `handleRemove` 函数
- `hiddenPlayerIds` 的 `line-through` 样式分支
- `Eye, EyeOff, X` 的 import
- 不再需要的 `useEditorReadOnly` import（如仍被 `CompositionDialog` 渲染条件消费则保留）

每行只保留 `JobIcon + 职业名`。增删玩家完全由 `CompositionDialog` 承担。

### `useSkillTracks.ts`（删除字段）

- `uiStore.hiddenPlayerIds` 的读取 —— `deriveSkillTracks` 改传 `new Set()`
- 新增过滤逻辑（见核心过滤逻辑段）

### `Timeline/index.tsx`（改走 hook）

- `layoutData` useMemo 里的 `deriveSkillTracks(...)` 直接调用替换为 `const skillTracks = useSkillTracks()`
- 依赖数组移除 `actions / hiddenPlayerIds`，加入 `skillTracks`

### `ExportExcelDialog.tsx`（两处改动）

- 删除 `const globalHiddenPlayerIds = useUIStore(s => s.hiddenPlayerIds)`
- `useEffect` 里初始化改为 `setHiddenPlayerIds(new Set())`
- 局部 `hiddenPlayerIds` state 与相关 UI、`deriveSkillTracks` 调用全部保留

### `deriveSkillTracks` 签名

**不改**。Excel 对话框继续传入局部 `hiddenPlayerIds`。时间轴侧传 `new Set()`。

### `skillTracks.test.ts / exportExcel.test.ts`

**不改**。

## 新增依赖

```
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

## 测试策略

### 单元测试

**`src/store/filterStore.test.ts`**

- `BUILTIN_PRESETS` 数量与 id 固定
- `getAllPresets()` 顺序：builtin 在前、custom 按存储顺序
- `getActivePreset()` 回退到 `builtin:all`
- `addPreset / updatePreset / deletePreset / reorderPresets` CRUD 正确
- 删除当前选中 → `activeFilterId` 回退
- persist 中间件仅存储 `customPresets` + `activeFilterId`

**`src/hooks/useFilteredTimelineView.test.ts`**（`renderHook`）

- `builtin:all`：两数组 = 原数组
- `builtin:tank`：仅 tankbuster damage；castEvent 过滤掉非坦克玩家的 cast
- 跨角色 action 边界：验证"按玩家 job 判断"而非"按 action.jobs 判断"
- `custom` 预设：按 `(job, actionId)` 白名单过滤

**`src/hooks/useSkillTracks.test.ts`**

- `builtin:all`：tracks = composition × non-hidden actions
- `builtin:tank`：非坦克玩家 tracks 全消失
- 跨角色 action：仅在目标 role 玩家处产生 track
- custom：按 `(job, actionId)` 精确过滤

### 组件冒烟测试（可选）

**`src/components/FilterMenu/FilterMenu.test.tsx`**

- 5 个 builtin radio 渲染正确
- 切换 radio → `filterStore.activeFilterId` 更新
- 点击"管理预设…"打开 `ManagePresetsDialog`

`ManagePresetsDialog` / `EditPresetDialog` 涉及 Modal + dnd-kit + icon 网格，本阶段**不强制**单测。

### 手动验证清单

spec 完稿后实施阶段手测：

1. 默认"全部"，行为与现状一致
2. 切换"仅坦克"：仅 tankbuster 伤害事件；非坦克玩家技能行消失
3. 切换"仅 DPS 团减"：仅 AOE；坦克/治疗技能行消失
4. 新建自定义预设，默认全选 → 等同"全部"；取消某 (job, action) 后对应轨道消失
5. 删除当前选中自定义预设 → 回退"全部"
6. 拖拽排序后刷新页面，顺序持久
7. 只读 / view / 回放模式下过滤菜单可用
8. Excel 导出不受过滤影响
9. `CompositionPopover` 不再有 Eye / EyeOff / X 按钮
10. 撤销/重做不受过滤影响；过滤切换不进 history

## 实施顺序

**阶段 1：数据模型**

1. `MitigationAction.category` 必填字段
2. `mitigationActions.ts` 逐项补 category
3. `tsc --noEmit` + `test:run` 全绿

**阶段 2：清理旧 `hiddenPlayerIds`** 4. `uiStore` 删除 3 个字段 + persist partialize 5. `useSkillTracks` 改传 `new Set()` 6. `ExportExcelDialog` 初始 `new Set()` 7. `CompositionPopover` 删按钮与 state 8. `Timeline/index.tsx` `deriveSkillTracks` 改传 `new Set()`（临时，阶段 3 再改走 hook）9. `lint` + `tsc` + `test:run` + 手测基础时间轴正常

**阶段 3：过滤骨架** 10. `src/types/filter.ts` 类型11. `src/store/filterStore.ts` + 单测 12. `src/hooks/useFilteredTimelineView.ts` + 单测 13. `useSkillTracks` 集成过滤 + 单测 14. `Timeline/index.tsx` 改走 `useSkillTracks()` 15. 三个消费点（Timeline/index.tsx、TimelineMinimap、TimelineTable）接入 `useFilteredTimelineView`

**阶段 4：UI** 16. `pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities` 17. `FilterMenu` + `SortablePresetRow` + `ManagePresetsDialog` + `EditPresetDialog` 18. `EditorToolbar` 插入 `<FilterMenu />` 19. （可选）`FilterMenu.test.tsx`

**阶段 5：验收** 20. `pnpm test:run && pnpm lint && pnpm exec tsc --noEmit && pnpm build` 21. 手动验证清单 10 项 22. 按 CLAUDE.md 规范提交

## 风险点

| ID  | 风险                                                    | 缓解                                                           |
| --- | ------------------------------------------------------- | -------------------------------------------------------------- |
| R1  | category 分类错误导致预置选项语义偏差                   | 实施阶段 1 完成后请用户通读 `mitigationActions.ts` 的 category |
| R2  | 三处 predicate 不一致                                   | 共享 `matchSingleAction`，单测覆盖跨角色 action 边界           |
| R3  | `Timeline/index.tsx` 的 `layoutData` useMemo 引用稳定性 | `useSkillTracks` 内部 `useMemo` 保证；单测验证同输入下同引用   |
| R4  | persist 旧 `hiddenPlayerIds` 残留                       | zustand persist 自动忽略未知字段；无需 migrate                 |
| R5  | dnd-kit 对触屏支持                                      | `PointerSensor` 默认兼容；桌面 Chrome 验证即可                 |
| R6  | 预设管理入口在 EditorToolbar，无时间轴时不可见          | 当前不考虑，若未来挪入口再评估                                 |

## 非决策备忘

- 预设名称**允许重复**
- 预设数量**不设上限**
- "管理预设" 每行只显示 **名称 + 操作按钮**，无摘要预览
- 删除预设**无二次确认**
- 新建预设**默认全选**
