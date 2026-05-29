# 编辑器内"导入到当前时间轴"功能设计

## 概述

为时间轴编辑器（`EditorPage`）新增导入入口，允许把外部数据**追加**到当前时间轴：

- **来源**：FFLogs 战斗记录链接 / 当前副本的预设模板（`/api/encounter-templates/:id`）
- **可导入的数据**：伤害事件、技能使用记录、Souma sync 锚点（后者对用户透明、不展示选项）
- **范围**：可选"时间区间"或"全部"；默认区间，起始为当前时间轴最后一个事件时间
- **校验**：技能使用记录会按 placement engine 校验，不合法的静默跳过

与现有首页 `ImportFFLogsDialog` 的区别：那个是**新建本地副本**，本设计是**追加到当前时间轴**。两者代码路径独立，但解析层可共用。

## 用户故事

1. 用户在写一份未来"绝伊甸觉醒"的减伤规划时，看到队友刚发的同副本 FFLogs 链接 → 在编辑器内贴 URL → 选"时间区间 03:00.0 ~ ∞" → 把后半场的伤害事件并入当前轴
2. 用户新建空白时间轴 → 想用社区预设模板填充伤害事件 → 工具栏「导入」→ 选"副本模板"→ "全部" → 一键导入
3. 用户的轴已经有了前半场，想从一段 FFLogs 中**仅**拿后半场的技能使用，避免覆盖自己已规划的减伤 → 区间模式

## 入口与可见性

工具栏（`EditorToolbar.tsx`）在"导出"按钮**右侧**新增 `Upload` 图标按钮。

| 时间轴状态                                                      | 按钮            |
| --------------------------------------------------------------- | --------------- |
| `sessionRole === 'viewer'`                                      | **不渲染**      |
| `timeline.isReplayMode === true`                                | **不渲染**      |
| `editLock.can('content') === false`（offline / manual lock 等） | 渲染但 disabled |
| 其它                                                            | 渲染且可点      |

## UI：2 步 wizard

对话框组件：`src/components/ImportIntoTimelineDialog.tsx`（新文件），基于现有 `Modal`。

顶部 stepper：`① 选择来源 → ② 配置导入`；底部按钮栏 `[‹ 上一步] [取消] [下一步 / 确认导入]`。

### Step 1 · 选择来源

**当前时间轴有 encounter 且该副本有模板**：顶部 segmented 二选一（FFLogs 战斗 / 副本模板）。

**其它情况**：segmented 隐藏，只渲染 FFLogs 表单。"其它情况"指：

- 当前时间轴无 `encounter` 字段
- 或者 dialog open 时预 fetch `/encounter-templates/${encounter.id}` 返回 `events: []`

**FFLogs 形态**：

- 一个 URL `Input`，复用 `parseFFLogsUrl(url)` 校验
- 自动剪贴板探测（同现有 `ImportFFLogsDialog`）
- URL 不合法 → 「下一步」disabled

**模板形态**：

- 一行 info："将从模板「副本名」导入"
- 「下一步」立即可点

「下一步」语义 = "解析"。点击后：

- FFLogs：`POST /api/fflogs/import?reportCode=X&fightId=Y` → 等返回 → 进 Step 2
- 模板：直接使用 dialog open 时已 prefetch 的模板数据 → 进 Step 2

解析期间显示 spinner，按钮全禁。失败显示红色错误条，留在 Step 1。

### Step 2 · 配置导入

**已解析提示条**（蓝色 info）：

- FFLogs："已解析：报告 ABC123 / 战斗 #5「副本名」 · 62 伤害 / 41 技能"
- 模板："已加载模板「副本名」 · 30 伤害事件"

**encounter 不一致警告**（仅 FFLogs；当前时间轴有 encounter 且与解析出的不一致时）：黄色 `imp-warn` 横条，**不阻塞**继续。

**数据类型 checkbox**：

- FFLogs：`☑ 伤害事件 (62)` `☑ 技能使用 (41，可放置 38)`
- 模板：`☑ 伤害事件 (30)`（技能使用 row 不渲染）

**时间范围**：

- 模式 radio：`● 时间区间` / `○ 全部`
- 区间模式：两个 `TimeInput`（`src/components/ui/time-input.tsx`，mm:ss.f）+ 「至时间轴结尾」checkbox
  - 默认起始 = `max(damageEvents.time, castEvents.timestamp)`（sync 锚点对用户透明，不影响默认值）；时间轴为空则 `0`
  - "至时间轴结尾"勾选时禁用第二个 TimeInput 并显示 `∞`
- 全部模式：替换 TimeInput 行为红色 `imp-warn-strong` 警告条："全部模式可能与时间轴已有事件重复。建议改用「时间区间」并选择空白时间段。"

**预览计数（实时）**：

```
本次将导入：
　伤害事件　18 条
　技能使用　12 条 （跳过 3 条因 CD/状态冲突或玩家不在阵容）
```

- sync 锚点对用户透明：不出现在 checkbox 区，也不出现在计数行
- "可放置 N 条"的实际逻辑见 §"cast 校验"

**确认导入**按钮：

- 区间模式 + `start >= end` → disabled，TimeInput 标红
- 数据类型全未勾 → disabled
- 否则可点

「上一步」回到 Step 1，**保留已输入 URL / 已解析数据**。如果用户在 Step 1 改了 URL，「下一步」label 切回"解析"并触发重拉。

## 数据流

```
─── FFLogs 源 ─────────────────────────────────
Step 1 「下一步」
  → POST /api/fflogs/import?reportCode=X&fightId=Y
  → 返回完整 Timeline JSON
  → 客户端调 extractImportableFromTimeline(t)
    → { damageEvents, castEvents, syncEvents, encounter, sourceLabel }
  → 缓存 dialog state.parsed

─── 模板 源 ───────────────────────────────────
Dialog open
  → GET /api/encounter-templates/${currentEncounter.id}  (prefetch)
  → 缓存 { damageEvents: events, sourceLabel }
Step 1 「下一步」
  → 直接进 Step 2

─── Step 2 实时过滤 ──────────────────────────
useMemo 依赖 [parsed, range, typeChecks, currentTimeline]:
  damageEvents → filterByRange()
  castEvents   → filterByRange() → validateCastsForImport()  // 校验 + playerId 映射
  syncEvents   → filterByRange() → dedupeSyncEvents()        // 静默, by actionId vs current

─── 确认导入 ─────────────────────────────────
store.bulkImport({ damageEvents, castEvents (校验后), syncEvents (去重后) })
→ engine.doc.transact(() => {
    for d of damageEvents: yAddDamageEvent(doc, { ...d, id: generateId() })
    for c of castEvents:   yAddCastEvent(doc,   { ...c, id: generateId() })
    if syncEvents.length:  ySetMeta(doc, { syncEvents: [...current, ...new].sort(by time) })
  }, LOCAL_ORIGIN)
→ UndoManager 视为单步（一次 Ctrl+Z 全回滚）
→ toast "导入 X 伤害 / Y 技能（跳过 Z）"
→ 关闭 dialog
```

## 后端路由复用

**不新建** Worker 端点。`/api/fflogs/import` 已经返回完整 Timeline JSON，本功能只取其中三个事件数组，多余字段（`composition` / `statData` / `name` / 等）的 payload 开销远小于新建端点的工程成本。

> 已知性能权衡：未来若发现 FFLogs 报告 statData 过大、传输瓶颈明显，可加 `?fields=events_only` 查询串瘦身。本期不做。

## 状态层 API

**新增 store action**（`src/store/timelineStore.ts`）：

```ts
interface TimelineState {
  // ...
  bulkImport: (data: {
    damageEvents?: DamageEvent[]
    castEvents?: CastEvent[] // 调用方应已做过校验 + playerId 映射
    syncEvents?: SyncEvent[] // 调用方应已做过去重
  }) => void
}
```

实现：

- 所有写入包在 `engine.doc.transact(() => { ... }, LOCAL_ORIGIN)` 内
- 每条 damage / cast 写入前用 `generateId()` 覆盖 `id` 字段
- sync 写入用 `ySetMeta(doc, { syncEvents: merged })`（整个数组替换）
- 校验在调用方完成，store 只负责事务化写入

无需新增 `docSchema` mutator —— Yjs 事务可重入，外层 `engine.doc.transact` 包内层 `yAdd*` 已 transact 的实现会合并为单个事务，UndoManager 视为一个 step。

## 解析与校验逻辑

**新增 `src/utils/importAdapter.ts`**（纯函数，便于单测）：

```ts
import type {
  Timeline,
  DamageEvent,
  CastEvent,
  SyncEvent,
  Composition,
  Job,
} from '@/types/timeline'

/** /api/fflogs/import 返回的完整 Timeline → 可导入子集 */
export function extractImportableFromTimeline(t: Timeline): {
  damageEvents: DamageEvent[]
  castEvents: CastEvent[]
  syncEvents: SyncEvent[]
  encounter: Timeline['encounter']
  sourceLabel: string
}

/** 通用范围过滤，按事件携带的时间字段名（time vs timestamp）分别处理 */
export function filterByRange<T>(
  events: T[],
  range: { mode: 'all' } | { mode: 'range'; start: number; end: number | null },
  getTime: (e: T) => number
): T[]

/** Step 1：按职业位置映射 incoming.playerId → current.playerId */
export function buildPlayerIdMap(incoming: Composition, current: Composition): Map<number, number>
/* 规则：双方分别按 composition.players 的出现顺序分组 by job，
   第 i 个 job=X 的 incoming player 映射到第 i 个 job=X 的 current player；
   当前阵容不包含该 job、或第 i 个 incoming 在当前阵容里没有第 i 个对应 → 不入 map */

/** Step 2：cast 校验。返回保留集 + 跳过计数 */
export function validateCastsForImport(args: {
  incoming: CastEvent[]
  playerIdMap: Map<number, number>
  baseTimeline: Timeline
  mitigationActions: MitigationAction[]
  /** 由 useDamageCalculation 提供，placement engine 所需 */
  statusTimelineByPlayer: ReturnType<typeof useDamageCalculation>['statusTimelineByPlayer']
}): { kept: CastEvent[]; skipped: number }
/* 流程：
   1. 把 incoming 按 timestamp 升序
   2. 用 baseTimeline.castEvents 初始化一个虚拟 cast 列表
   3. 创建 placement engine
   4. 遍历 incoming：
      a. playerId 不在 map → skipped++
      b. 改写 playerId 为映射后的；actionId 不在 mitigationActions → skipped++
      c. canPlaceCastEvent(action, mappedPlayerId, timestamp, undefined).ok === false → skipped++
         (第 4 参数 excludeId 传 undefined，表示不排除任何已存在的 cast)
      d. 否则进 kept；并加入虚拟 cast 列表 → 重新构造 placement engine（O(n²) 但 n≈50）
*/

/** sync 去重：按 actionId 与当前 timeline.syncEvents 比对 */
export function dedupeSyncEvents(
  incoming: SyncEvent[],
  existing: SyncEvent[]
): { kept: SyncEvent[]; dedupedCount: number }
/* 规则：若 existing 中已有任何 entry.actionId === incoming.actionId，整条 incoming 丢弃；
   incoming 批内不做去重（同 actionId 多次发动是合法的） */
```

## 边界场景表

| 场景                                                                 | 行为                                                                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| viewer / replay mode                                                 | 工具栏按钮**不渲染**                                                        |
| 当前 editLock 不允许 content 写                                      | 按钮 disabled                                                               |
| 当前时间轴无 encounter                                               | Step 1 segmented 隐藏，只剩 FFLogs；Step 2 不显示 encounter 不一致警告      |
| 当前时间轴有 encounter 但该副本无模板                                | 同上（segmented 隐藏）                                                      |
| FFLogs encounter ≠ 当前 encounter（仅当双方都有 encounter 时才比较） | Step 2 黄色警告，**允许继续**                                               |
| FFLogs `reportCode` 与当前 `fflogsSource.reportCode` 相同            | 不特殊处理（用户可能就是想从同报告补另一时间段）                            |
| 解析失败（404 / 网络 / 鉴权）                                        | Step 1 红色错误条，留在 Step 1                                              |
| 模板返回 `events: []`                                                | dialog open 时的 prefetch 即知 → Step 1 的 segmented 隐藏，根本不暴露模板源 |
| 区间模式 `start >= end`                                              | 「确认导入」disabled，TimeInput 边框标红                                    |
| 数据类型全未勾                                                       | 「确认导入」disabled                                                        |
| 解析后用户切换 segmented 来源                                        | 已解析数据**清空**，回到 Step 1 初始态                                      |
| 解析后用户改 URL                                                     | 「下一步」label 切回"解析"，触发重拉                                        |
| 当前阵容缺某职业（如导入有 AST、当前无 AST）                         | 该玩家的所有 cast 进 skipped 计数                                           |
| Composition 内同职业人数不等（如导入 2 WHM、当前 1 WHM）             | 第 2 个 WHM 的 cast 进 skipped 计数                                         |

## 文件改动清单

**新增**：

- `src/components/ImportIntoTimelineDialog.tsx` — wizard 主组件
- `src/utils/importAdapter.ts` — 纯函数解析/校验/去重
- `src/utils/importAdapter.test.ts` — 单测

**修改**：

- `src/components/EditorToolbar.tsx` — 增 `Upload` 图标按钮 + 控制可见性
- `src/store/timelineStore.ts` — 增 `bulkImport` action
- `src/store/timelineStore.test.ts` — 测试 `bulkImport` 的事务原子性 + undo 单步性

**无改动**：

- `src/api/encounterTemplate.ts` — 复用 `fetchEncounterTemplate`
- `src/utils/fflogsImporter.ts` — 不涉及
- 既有 `ImportFFLogsDialog.tsx` —— 它是"新建副本"路径，不复用本设计

## 测试要点

`importAdapter.test.ts`：

- `extractImportableFromTimeline` 只提取三个字段
- `filterByRange` 边界：`start` 包含、`end` 排除（`end === null` 表示无上限）
- `buildPlayerIdMap` 6 个 case：1:1 全匹配 / 1:1 部分匹配 / 多对多有序匹配 / incoming 多余职业 / current 多余职业 / 完全无交集
- `validateCastsForImport`：
  - playerId 不在 map → 计入 skipped
  - actionId 不在 registry → 计入 skipped
  - 同 player 同 action 间隔 < CD → 第 2 个进 skipped（验证"逐条加入虚拟状态"生效）
  - 全合法 → kept = incoming
- `dedupeSyncEvents`：
  - existing 有 actionId=X → incoming 中所有 actionId=X 全部丢弃
  - existing 无 → incoming 全部保留
  - incoming 批内多个相同 actionId → 全部保留

`timelineStore.test.ts` 新增：

- `bulkImport` 后 `canUndo === true`，调一次 `undo()` 即清空所有刚导入的事件
- `bulkImport` 期间 reproject 只触发一次（事务合并验证）

`ImportIntoTimelineDialog`（可选 component test）：

- 无 encounter 时 segmented 不渲染
- 模板 prefetch `events: []` 时 segmented 不渲染
- 切换 segmented 来源 → parsed state 清空
- 区间模式 `start >= end` 时确认按钮 disabled

## 不在本期范围

- 撤销后的 "redo this import" UX（标准 redo 已经够用）
- 导入历史日志 / 重新导入
- 跨 encounter 的智能映射（不同副本的 boss action ID 不可比）
- 模板源支持 castEvents / syncEvents（后端模板目前只存 damage events）
- 导入时同步覆盖 statData（导入是追加，不动 statData）

## 最后更新

2026-05-29
