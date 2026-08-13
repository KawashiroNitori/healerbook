# 技能等级分歧系统设计

**日期**：2026-08-12
**分支**：feat/skill-level

## 1. 背景与目标

当前 `MitigationAction` 没有任何等级概念：所有技能一律按 100 级现行版本定义，只按 `jobs` 过滤。
这使得低等级同步副本（各代绝本、旧版零式）无法正确规划——技能可用性、CD、持续时间、
效果强度在历史版本中与现在不同。

本设计给技能引入**等级分歧**能力，覆盖四个维度：

1. **可用性门槛**：技能在某等级区间外不可用（含被升级技能顶掉的情况）
2. **数值变化**：同一技能在不同等级的 CD / 持续时间 / 减伤量不同
3. **额外效果**：到某等级后多挂状态、多一段治疗或盾（executor 行为变化）
4. **充能 / 资源变化**：等级带来的充能数变化，影响 `resourceEffects` 与资源池

### 支持的等级档位

`70 / 80 / 90 / 100`，对应各代绝本与零式的副本同步等级。不做 1–100 全精度。

### 非目标

- 不做技能升级替换关系的建模。医济→医养视为两个互不相干的技能，各管各的等级区间
  （见 §3.3）。
- 不做每玩家独立等级。等级是时间轴级别的全局值（FF14 副本 level sync 的实际语义）。
- 本期不补齐全部 ~150 个 action 的历史数据。机制完整交付 + 四类分歧各一个样例（见 §8）。

## 2. 等级档位类型

新建 `src/types/level.ts`：

```ts
export const SUPPORTED_LEVELS = [70, 80, 90, 100] as const
export type Level = (typeof SUPPORTED_LEVELS)[number]
export const DEFAULT_LEVEL: Level = 100
```

`DEFAULT_LEVEL` 是所有回退路径的唯一出口：存量时间轴无 level 字段、副本表查不到、
V1 格式迁移，一律回退 100。

## 3. 数据建模

### 3.1 MitigationAction 新增字段

```ts
export interface MitigationAction {
  // ... 现有字段不变

  /** 可用等级下限（闭区间）。省略 = 无下限 */
  minLevel?: number

  /**
   * 可用等级上限（闭区间）。省略 = 无上限。
   * 用于被升级技能顶掉的场景：医济 maxLevel: 95，医养 minLevel: 96。
   */
  maxLevel?: number

  /** 低等级覆盖层，必须按 upTo 升序排列 */
  levelOverrides?: LevelOverride[]
}

export interface LevelOverride {
  /** 本层生效的等级上限（闭区间）：level <= upTo 时命中 */
  upTo: number
  patch: LevelPatch
}

/** 允许被等级覆盖的字段白名单 */
export type LevelPatch = Partial<
  Pick<
    MitigationAction,
    'duration' | 'cooldown' | 'executor' | 'resourceEffects' | 'statDataEntries' | 'placement'
  >
>
```

**`minLevel` / `maxLevel` / `upTo` 用 `number` 而非 `Level`**：技能的学习等级与特性等级是
任意值（96、82、52…），不落在四个档位上。只有 `Timeline.level` 是 `Level` 枚举——
「用户能选什么」和「数据能写什么」是两件事，前者收窄到四档，后者保持真实等级。

### 3.2 刻意排除在 patch 之外的字段

`id` / `jobs` / `trackGroup` / `category` **不可被等级覆盖**：

| 字段         | 排除理由                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------ |
| `id`         | 技能身份，变了就不是同一个技能                                                             |
| `jobs`       | 技能不会随等级换职业                                                                       |
| `trackGroup` | 变了会让轨道在切等级时跳位，破坏 UI 连续性                                                 |
| `category`   | UI 过滤与 `calculate` 的目标减判定依赖它。允许变会把等级感知污染到一批本可保持静态的消费点 |

这四个字段保持静态，直接的收益是 §5 中约一半的消费点不必改签名——它们只关心
trackGroup 映射、actionId 识别、名称查找，与等级无关。

### 3.3 不建模升级替换关系

医济（133）在 96 级被医养（37010）替代，游戏里是同一个按钮。本设计**不**声明
`upgradesTo` 之类的关系，两者各写各的区间：

```ts
{ id: 133,   name: '医济', maxLevel: 95 }
{ id: 37010, name: '医养', minLevel: 96 }
```

后果：用户在 90 级摆好医济后切到 100 级，医济 cast 被清理（§6.2），不会自动改写为医养。
这是明确接受的取舍——换来数据层的简单，也避免了「自动改写 cast」在双向切换、
撤销栈、协作同步三条链路上的语义复杂度。

### 3.4 匹配规则：只命中一层，不叠加

**基线字段写 100 级**，即当前 `mitigationActions.ts` 的现状，存量数据零改动。

resolve 时按 `upTo` 升序找**第一个**满足 `level <= upTo` 的层，浅合并其 `patch`；
没有命中的层就用基线。

```ts
// 干预（示意，具体数值待核对）
{
  id: 7382,
  cooldown: 10,
  duration: 8,
  executor: interventionExecutor,
  levelOverrides: [
    { upTo: 81, patch: { duration: 6, executor: interventionExecutorLegacy } },
    { upTo: 87, patch: { resourceEffects: [/* 单充能版 */] } },
  ],
}
// level=70 → 命中 upTo:81 层（duration 6 + legacy executor）
// level=80 → 命中 upTo:81 层（同上）
// level=90 → 无层命中（90 > 87）→ 基线
```

**为什么不做链式累积**：每层是该等级段的完整快照，读数据时一眼看到 70 级到底是什么样，
不必在脑中叠加多层补丁。代价是相邻层之间字段重复——可接受，换来的是数据可读性与
调试时的确定性。

**数组字段整体替换**：`resourceEffects` / `statDataEntries` 是整体覆盖，不做元素级合并。

## 4. resolve 层

新建 `src/data/resolveAction.ts`：

```ts
/** 区间外返回 null */
export function resolveAction(action: MitigationAction, level: Level): MitigationAction | null

export interface ResolvedActionSet {
  /** 已滤掉区间外的技能，且 patch 已合并 */
  actions: MitigationAction[]
  actionMap: Map<number, MitigationAction>
}

/** memo 缓存，最多 4 份常驻（档位固定，开销可忽略） */
export function resolveActions(level: Level): ResolvedActionSet
```

`resolveAction` 语义：

1. `level < minLevel` 或 `level > maxLevel` → 返回 `null`
2. 否则按 §3.4 找到命中的覆盖层（至多一个），`{ ...action, ...patch }` 浅合并返回
3. 无命中层 → 返回原 action 引用（不复制，减少无谓分配）

`resolveActions` 用模块级 `Map<Level, ResolvedActionSet>` 缓存。静态数据不可变，缓存
永不失效。

### 4.1 现有静态导出的语义收窄

`ACTIONS` / `ACTION_MAP` **保留**，语义收窄为「全量基线表」，仅供不关心等级的消费点使用。
在其 JSDoc 中写明这一约束，避免后续误用。

## 5. 消费点改造清单

### 5.1 需要感知等级

| 文件                                             | 改法                                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/statDataUtils.ts`                     | 两处 `MITIGATION_DATA.actions` → 接收 level 参数后走 `resolveActions`                                                                   |
| `src/components/SettingsDialog.tsx`              | 技能数值区块列表走 resolved                                                                                                             |
| `src/components/FilterMenu/EditPresetDialog.tsx` | `ACTIONS` → resolved                                                                                                                    |
| `src/components/ActionTooltip.tsx`               | 显示 resolve 后的 CD / duration                                                                                                         |
| `src/utils/mitigationCalculator.ts`              | `SimulateInput` 加 `level`，`simulate` 内部用 resolved                                                                                  |
| `src/utils/simulation/timeAdvancer.ts`           | 从 `simulate` 透传 resolved actionMap                                                                                                   |
| `src/utils/autoMitigation/types.ts`              | `OptimizeInput` 加 `level`，自动减伤不得推荐当前等级不可用的技能                                                                        |
| `src/web-workers/calculator/index.ts`            | simulate 路径随消息自动带 level；optimize 路径需按 level 注入技能池（`OptimizeWireInput` 把 `actions` Omit 掉，技能池在 worker 内注入） |
| 技能轨道渲染组件                                 | 消费 `useResolvedActions()`                                                                                                             |

### 5.2 保持静态表（不改）

| 文件                                              | 理由                                                       |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `src/utils/normalizeActionId.ts`                  | 只用 trackGroup 映射，trackGroup 不可覆盖                  |
| `src/utils/fflogsImporter.ts` 的 `validActionIds` | 只做 actionId 识别（判断是否减伤技能），全量识别是正确行为 |
| `src/utils/soumaExporter.ts`                      | 只做名称查找                                               |

**注意**：`fflogsImporter.ts` 只有 `validActionIds` 那处保持静态表。同文件的 `parseStatData` 读的是
`statDataEntries`——该字段在 `LevelPatch` 白名单内，必须按等级 resolve。判断依据始终是
「消费哪些字段」而非「哪个文件」。
| `src/components/ExportSoumaDialog.tsx` | 同上 |
| `src/utils/simulation/hpPipeline.ts` | 只做 actionName 反查 |

### 5.3 UI 层 hook

```ts
// src/hooks/useResolvedActions.ts
export function useResolvedActions(): ResolvedActionSet
```

从 `timelineStore` 读当前 `timeline.level`（缺省 `DEFAULT_LEVEL`），返回 `resolveActions(level)`。
因 resolve 结果被缓存，返回引用稳定，可直接进 `useMemo` 依赖数组。

### 5.4 过滤预设不做数据清理

过滤预设是**用户全局配置**、跨时间轴复用。其中存的 actionId 若在当前等级不可用，
只在**渲染时**跳过，不修改预设本身。否则用户在 70 级本上打开一次编辑器，全局预设就被
永久削掉一批技能。

## 6. 时间轴的等级字段

### 6.1 存储与持久化

完全照 `gameZoneId` 的既有路径走一遍：

| 落点                                | 改动                                                            |
| ----------------------------------- | --------------------------------------------------------------- |
| `src/types/timeline.ts`             | `Timeline.level?: Level`，省略 = `DEFAULT_LEVEL`                |
| `src/utils/timelineFormat.ts`       | V2 短键 `lv`，仅在 `!== undefined` 时写；V1→V2 迁移不产出该字段 |
| `src/collab/docSchema.ts`           | `META_KEYS` 加 `'level'`，`readMeta` 读出                       |
| `src/collab/migration.ts`           | 随 meta 搬运                                                    |
| `src/collab/timelineToLocalInit.ts` | 随 meta 搬运                                                    |

存量时间轴无该字段 → 读作 100，**零迁移脚本**。

等级走 Y.Doc meta，因此多人协作时天然同步：A 改等级，B 收到 meta 变更 + castEvent 删除，
与其他编辑操作行为一致，无需特殊处理。

### 6.2 切换等级的副作用

`timelineStore` 新增 `setLevel(level: Level)`：

```
1. removedIds = 当前 castEvents 中，actionId 在新等级下 resolve 为 null 的那些
2. engine.doc.transact(() => {
     meta.set('level', level)
     删除 removedIds 对应的全部 castEvent
   })
3. 触发重算
```

**写 level 与删 cast 必须在同一个 `transact` 内**。这样 `Y.UndoManager` 视其为一步，
用户切错等级按一次 Ctrl+Z 即可完整恢复。这是「静默清理数据」这一决策成立的前提——
不可逆的静默删除是不可接受的，可一步撤销的则可以。

**不弹 toast、不弹确认框**。切等级时不可用技能的轨道直接消失，数据静默清理。

### 6.3 副本表推导默认等级

`RaidEncounter` 加 `level: Level` 字段（`raidEncounters.ts` 现有条目全部填 100）。用 `Level`
而非 `number`：这是人工维护字段，写错成 `95` / `9` 应该编译期报错，而不是被 `toLevel()`
静默兜底成 100。

- 新建时间轴 / FFLogs 导入：从静态表查表写入 `Timeline.level`，查不到则 `DEFAULT_LEVEL`。
  两条入口都要推导——只做其中一条会让同一副本从不同入口进来得到不同等级
- 新建时间轴对话框**不新增等级选择**，仍然只选副本

## 7. 设置对话框重构

`StatDataDialog` 更名为 `SettingsDialog`，标题「数值设置」改为「设置」，
`EditorToolbar` 的入口文案同步更新。i18n 三语（zh-CN / en / ko-KR）的 key 一并调整。

### 7.1 布局

改为左右两栏：

```
┌─────────────────────────────────────────────┐
│ 设置                                     ✕  │
├──────────┬──────────────────────────────────┤
│ ● 基本    │  基本                        ▲   │
│   安全血量 │    绑定副本  [ M12S      ▾ ]     │
│   技能数值 │    等级      [ 100       ▾ ]     │
│          │  ─────────────────────────────   │
│          │  安全血量                        │
│          │    非坦最低血量 [      ]          │
│          │    坦克最低血量 [      ]          │
│          │  ─────────────────────────────   │
│          │  技能数值                        │
│          │    ...                       ▼   │
└──────────┴──────────────────────────────────┘
```

- 右侧是**一个连续滚动容器**，不是 Tab 切换。三个 section 各持一个 ref。
- 点左侧菜单项 → 对应 section `scrollIntoView({ behavior: 'smooth', block: 'start' })`
- 右侧滚动 → `IntersectionObserver` 更新左侧高亮，使菜单始终反映当前阅读位置
- 窄屏（`sm` 以下）：左栏折成顶部横向 chip 条，避免两栏挤压

### 7.2 三个 section

| section  | 内容                                      |
| -------- | ----------------------------------------- |
| 基本     | 绑定副本（新增）、等级（新增）            |
| 安全血量 | 现有非坦 / 坦克最低血量，原样搬运         |
| 技能数值 | 现有盾 / 治疗数值表，列表额外叠加等级过滤 |

「技能数值」的技能列表本就按阵容职业过滤，现在再叠一层等级过滤——低等级下学不到的
技能不应出现在数值设置里。

### 7.3 改绑副本联动等级

在「基本」里改绑副本时：

1. 更新 `timeline.encounter` 元信息与 `gameZoneId`
2. **等级自动跳到新副本表里的 level**，不保留用户此前手动设的值
3. 等级变化触发 §6.2 的 cast 清理

三步同样包在**单个 `transact`** 内，一次 undo 全部回滚。

## 8. 数据校验

扩展 `mitigationActions.ts` 中的 `validateActions`：

### 8.1 新增规则

- `minLevel <= maxLevel`（两者都存在时）
- `levelOverrides` 的 `upTo` 严格升序、无重复值
- `upTo < minLevel` 的层是死代码 → 报错
- `patch` 为空对象的层 → 报错（无意义）

### 8.2 四档位全量重跑（关键）

现有的 trackGroup 互斥性、placement `validIntervals` 并集覆盖全时间轴等约束，
目前只在隐含的 100 级下验证过。

**必须对 `SUPPORTED_LEVELS` 的每个档位各跑一遍全部既有校验。**

理由：某个技能一旦声明 `maxLevel` 或 `minLevel`，它在部分档位会退出技能池，
同 `trackGroup` 的其余成员的 placement 就可能不再覆盖全时间轴，产生只在特定等级
才复现的放置 bug。这是本设计里最容易漏、漏了最难查的一处。

## 9. 测试计划

| 测试文件                                 | 覆盖内容                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/data/resolveAction.test.ts`         | 区间过滤（含边界值等于 min/max）、只命中一层不叠加、浅合并、数组整体替换、无命中层返回原引用 |
| `src/data/mitigationActions.test.ts`     | 四档位下 `validateActions` 全绿；新增校验规则的反例各一                                      |
| `src/store/timelineStore.test.ts`        | `setLevel` 清理不可用 cast；一次 undo 完整恢复 level 与 cast；改绑副本联动等级               |
| `src/utils/mitigationCalculator.test.ts` | 低等级下 `simulate` 走低等级 executor，产出的 status / 减伤量与高等级不同                    |
| `src/utils/timelineFormat.test.ts`       | `lv` 字段编解码往返；无字段时回退 100                                                        |

## 10. 样例数据

本期填四类分歧各至少一个真实案例，验证机制通路：

| 分歧类型             | 案例                                      |
| -------------------- | ----------------------------------------- |
| 区间门槛             | 医济 `maxLevel: 95` / 医养 `minLevel: 96` |
| 数值变化             | 实现阶段选定                              |
| 额外效果（executor） | 实现阶段选定                              |
| 充能 / 资源          | 实现阶段选定                              |

**数据准确性要求**：后三类的具体技能与数值在实现阶段从现有 `mitigationActions.ts` 条目中
选取，逐条核对 XIVAPI action 数据与游戏内特性表，并在 PR 描述中给出核对来源。医养的
actionId（37010）同样需要核对确认后再落地。

不确定的数值宁可不写——写错的历史数据比没有历史数据更有害，因为用户会信任它。

## 11. 实施顺序

1. `src/types/level.ts` + `MitigationAction` 字段扩展 + `LevelPatch` 白名单类型
2. `resolveAction.ts` + 单测（此时无任何数据使用新字段，纯增量）
3. `validateActions` 扩展 + 四档位重跑（守住后续所有数据改动）
4. `Timeline.level` 四处落点（类型 / 持久化 / Y.Doc meta / 迁移）
5. `timelineStore.setLevel` + 单事务清理 + 测试
6. 计算层透传（`SimulateInput` / web-worker / `statDataUtils`）
7. `useResolvedActions` + UI 消费点切换（轨道 / 过滤器 / tooltip）
8. `SettingsDialog` 重构（更名 + 左右布局 + 基本 section + 改绑副本联动）
9. 样例数据落地

第 1–3 步是纯增量，不改变任何现有行为；第 4 步起开始有可观察的行为变化。
