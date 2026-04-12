# 导出 Souma 时间轴

**日期**：2026-04-13
**状态**：设计完成，待实现

## 背景

Healerbook 目前只支持导出 Excel 表格。用户希望把规划好的减伤时间轴导出为 Souma 格式（cactbot 风格文本）的压缩字符串，粘贴到 [ff14-overlay-vue](https://github.com/Souma-Sumire/ff14-overlay-vue) 的"时间轴"模块即可直接导入使用，实现跨工具的时间轴分享。

## 目标

- 在编辑器工具栏的"导出"下拉菜单中新增 `Souma 时间轴...` 项。
- 对话框中用户选择一个玩家、勾选要导出的技能、决定是否启用 TTS，**实时**生成压缩字符串展示在文本框中，支持一键复制。
- 压缩后的字符串可被 Souma 时间轴模块的"导入字符串"对话框直接解析。
- 复用 FFLogs 报告中的游戏区域 id (`gameZone.id`)，使 Souma 端能在副本内自动启用该时间轴；缺失时回退为"0"（全副本适用）。

## 非目标

- 不实现"导入 Souma 字符串"反向功能。
- 不为本地新建的时间轴提供手填 `gameZoneId` 的入口（值由静态表或 FFLogs 数据自动推导）。
- 不提供 JSON 明文导出（Souma 支持 JSON 导入，但我们只输出压缩格式，避免用户混淆）。

## Souma 时间轴格式回顾

文本行格式（cactbot 风格，参见 ff14-overlay-vue 的 `src/common/markdown/timeline.md`）：

```
时间 "提示文本" (tts ["语音文本"])
```

- **时间**：整数、浮点或 `mm:ss.d`（不支持负数表示）。
- **提示文本**：`"<技能名>~"` 语法会在悬浮窗内渲染为 `[技能图标] 技能名`。
- **TTS**：裸 `tts` 关键字代表沿用显示文本，提前 1 秒自动播报。

导入流程（ff14-overlay-vue 的 `src/pages/timelineSettings.vue`）：

```ts
const decompressed = LZString.decompressFromBase64(line)
const parsedData: ITimeline[] = JSON.parse(decompressed)
```

`ITimeline` 结构（`src/types/timeline.ts`）：

```ts
interface ITimeline {
  name: string
  condition: { zoneId: string; jobs: Job[] }
  timeline: string // 原始时间轴文本
  codeFight: string
  create: string
}
```

导出字符串为 `LZString.compressToBase64(JSON.stringify([itimeline]))`（数组包裹单对象，与现有"多时间轴同行导入"协议一致）。

## 数据层改动

### `Timeline` 接口新增 `gameZoneId?: number`

`src/types/timeline.ts` 的 `Timeline` 接口追加字段，记录 FFXIV 游戏内的区域 id：

```ts
interface Timeline {
  // ...
  /** FFXIV 游戏内 ZoneID，用于 Souma 时间轴导出时的自动副本识别。
   *  FFLogs 导入时从 `ReportFight.gameZone.id` 取值；本地新建时从
   *  `raidEncounters.ts` 静态表查表写入。存量时间轴无此字段，导出时回退 "0"。 */
  gameZoneId?: number
}
```

字段写入为**创建时一次性写入**策略（而非导出时动态查表），使 timeline 自描述：

- 存量时间轴即使未来静态表被缩减，仍能按原始 `gameZoneId` 正确导出。
- 导出路径只读取 `timeline.gameZoneId`，无需感知来源。

### `RaidEncounter` 接口新增 `gameZoneId: number`

`src/data/raidEncounters.ts`：

```ts
export interface RaidEncounter {
  id: number
  name: string
  shortName: string
  /** FFXIV 游戏内 ZoneID（人工维护） */
  gameZoneId: number
}
```

现有 6 个条目需人工补齐具体数值（M9S / M10S / M11S / M12S / M12S-P2 / FRU），在实现阶段通过 FFLogs GraphQL 逐个查验后填入。`RaidEncounter` 已有的 `RaidTier.zone` 字段是 FFLogs 的 zone id（用于 TOP100 同步），与 `gameZoneId` 语义不同，互不影响。

### FFLogs GraphQL 查询扩展

`src/workers/fflogsClientV2.ts` 内的 `fights { ... }` 选段追加：

```graphql
gameZone {
  id
}
```

经 introspection 验证：

- `ReportFight.gameZone: GameZone`（nullable OBJECT）
- `GameZone.id: Float!`（实际整数，存储时 `Math.floor` 转 `number`）

### `fflogsImporter` 写入 `gameZoneId`

`src/utils/fflogsImporter.ts` 解析 fights 时，从 `fight.gameZone?.id` 取值：

```ts
timeline.gameZoneId = fight.gameZone?.id != null ? Math.floor(fight.gameZone.id) : undefined
```

FFLogs 查询结果**优先**于静态表：对于静态表之外的新副本（用户通过 FFLogs 导入尚未补录的副本），此路径保证导出仍能产出有效 `zoneId`。

### `CreateTimelineDialog` 本地新建时写入

`src/components/CreateTimelineDialog.tsx` 创建新时间轴时，通过 `getEncounterById(encounterId)?.gameZoneId` 查静态表写入 `timeline.gameZoneId`。由于静态表 `gameZoneId` 为必填字段，这里查到的结果总是有值。

### Worker 校验 schema 同步

`src/workers/timelineSchema.ts`（Valibot）的 `TimelineSchema` 需要声明 `gameZoneId: v.optional(v.number())`。Valibot `v.object()` 会**静默剥离**未声明字段，不加这行会导致已发布时间轴同步到 D1 时字段丢失，再拉回又要走回退链路，前后状态不一致。

### 向后兼容

- 存量本地时间轴、存量已发布时间轴、共享时间轴 schema 均不做 migration——字段为可选。
- 导出路径三级 fallback 保证存量时间轴仍可得到正确 zoneId：
  1. 读 `timeline.gameZoneId`（新版创建/导入后写入）
  2. 查 `getEncounterById(timeline.encounter.id)?.gameZoneId`（静态表兜底）
  3. 回退 `"0"`（静态表之外的副本）
- D1 存储的 `TimelineRecord.data` 是 JSON blob，新增字段自然落库，无需修改 Worker 侧表结构。

## 导出逻辑

### 模块：`src/utils/soumaExporter.ts`

**纯函数模块**，不依赖任何 React/Zustand，方便单元测试。对外暴露：

```ts
interface ExportParams {
  timeline: Timeline
  playerId: number
  selectedActionIds: number[]
  ttsEnabled: boolean
}

export function exportSoumaTimeline(params: ExportParams): string
```

内部分层：

1. **`formatTime(t: number): string`**
   - `t >= 0`：转 `mm:ss.d`。`120.45` → `02:00.5`（小数一位四舍五入）。边界：`59.95` → `01:00.0`。
   - `t < 0`：直接 `t.toFixed(1)`，如 `-20` → `-20.0`。（Souma 时间字段允许纯浮点）。

2. **`buildTimelineText(timeline, playerId, selectedActionIds, ttsEnabled): string`**
   - 过滤 `timeline.castEvents`：`playerId` 匹配 + `actionId ∈ selectedActionIds`。
   - 按 `timestamp` 升序稳定排序；相同 timestamp 保持原顺序。
   - 每条生成一行：`${formatTime(cast.timestamp)} "<${actionName}>~"${ttsEnabled ? ' tts' : ''}`
   - `actionName` 通过 `getMitigationActionById(cast.actionId)?.name` 解析；查不到时跳过该行（静默）。
   - 用 `\n` 拼接，末尾不加换行。

3. **`wrapAsITimeline(timeline, playerId, timelineText): ITimelineLike`**
   - 这里定义一个本地最小类型 `ITimelineLike`（与 ff14-overlay-vue 的 `ITimeline` 结构对齐但不引入其类型依赖）。
   - `name`: `${timeline.name} - ${jobCode}`（jobCode 来自该玩家的 `composition.players[i].job`）。
   - `condition.zoneId`: **三级 fallback** —
     `String(timeline.gameZoneId ?? getEncounterById(timeline.encounter.id)?.gameZoneId ?? 0)`
     - 首选 timeline 自身字段（FFLogs 导入或新版创建时写入）
     - 其次查静态表（存量时间轴的兜底，副本在表内即可恢复正确 zoneId）
     - 最终回退 `"0"`（静态表之外的存量副本，Souma 端视为全副本可用）
   - `condition.jobs`: `[jobCode]`。
   - `codeFight`: `'Healerbook 导出'`。
   - `create`: `new Date().toLocaleString()`。

4. **`compress(iTimeline): string`**
   - `LZString.compressToBase64(JSON.stringify([iTimeline]))`。

### 依赖

新增 `lz-string`（自带 `.d.ts`）。

## 对话框：`src/components/ExportSoumaDialog.tsx`

### 触发

`src/components/EditorToolbar.tsx` 的导出 `DropdownMenu` 在 `Excel 表格...` 下方新增：

```tsx
<DropdownMenuItem
  onSelect={() => {
    track('souma-export-start')
    setShowSoumaDialog(true)
  }}
>
  Souma 时间轴...
</DropdownMenuItem>
```

`ExportSoumaDialog` 通过 `React.lazy` 懒加载（与 `ExportExcelDialog` 一致，不增加首屏包体）。

### 布局

```
┌─ 导出 Souma 时间轴 ──────────────────┐   max-w-lg
│                                      │
│ 玩家:  [ 白魔道士 ▾ ]                │   shadcn Select
│                                      │
│ 技能:                                │
│  ┌──┬──┬──┬──┬──┐                    │   flex-wrap 网格
│  │✓ │  │✓ │  │✓ │                    │   40x40 图标
│  └──┴──┴──┴──┴──┘                    │   选中高亮 + 右上角绿色对号
│                                      │   未选 opacity-40 grayscale
│ [⚫] 启用 TTS 播报                    │   shadcn Switch
│                                      │
│ ─────────────────────────────        │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ N4IgN...（实时更新）             │ │   readonly textarea
│ └──────────────────────────────────┘ │   h-32 font-mono text-xs
│                                      │
│              [ 关闭 ]  [📋 复制 ]    │
└──────────────────────────────────────┘
```

### 状态

```ts
const [playerId, setPlayerId] = useState<number>(firstPlayerId)
const [selectedActionIds, setSelectedActionIds] = useState<Set<number>>(new Set(allUsedActionIds))
const [ttsEnabled, setTtsEnabled] = useState<boolean>(false)

const exportString = useMemo(
  () =>
    exportSoumaTimeline({
      timeline,
      playerId,
      selectedActionIds: [...selectedActionIds],
      ttsEnabled,
    }),
  [timeline, playerId, selectedActionIds, ttsEnabled]
)
```

### 玩家下拉

- 遍历 `timeline.composition.players`，每项显示 `${jobName}${sameJobDuplicate ? ` #${n}` : ''}`（仅当同职业 ≥2 人时追加 `#n`）。
- `value` 是 `playerId`，`label` 是上述字符串。
- 首次打开：默认选中第一个有 `castEvents` 的玩家；若无，选第一个玩家。

### 技能图标网格

- `usedActionIds`：对当前 `playerId` 的 `castEvents`，distinct 出 `actionId` 列表。
- 列出这些技能的图标（`<SkillIcon />` 或 `<img src={iconUrl}>`，沿用项目现有图标渲染）。
- 切换玩家时自动重置 `selectedActionIds = new Set(usedActionIds)`（即默认全选新玩家所有用过的技能）。
- 点击图标 toggle 选中；视觉：
  - 选中：正常亮度 + 右上角叠加绿色对号角标（`<CheckCircle2 />` 或自绘小圆）。
  - 未选：`opacity-40 grayscale`。

### TTS 开关

`shadcn/ui` 的 `<Switch />`。

### 实时文本框

- `readonly`，内容为 `exportString`。
- 空选态（`selectedActionIds.size === 0`）：`exportString` 返回固定占位 `'请至少选择一个技能'`（非合法输出），同时 `复制` 按钮置灰。

### 复制按钮

```ts
async function handleCopy() {
  try {
    await navigator.clipboard.writeText(exportString)
    toast.success('已复制到剪贴板')
    track('souma-export-copy', {
      job: jobCode,
      skillCount: selectedActionIds.size,
      ttsEnabled,
    })
  } catch {
    toast.error('复制失败，请手动选中文本')
  }
}
```

不自动关闭对话框。

### 空数据处理

`timeline.castEvents.length === 0` 时对话框内容区域显示 `<Alert>无可导出的技能使用事件</Alert>`，不渲染表单。

## 测试

### 单元测试 `src/utils/soumaExporter.test.ts`

| 用例                                            | 断言                                                      |
| ----------------------------------------------- | --------------------------------------------------------- |
| `formatTime(0)`                                 | `"00:00.0"`                                               |
| `formatTime(125.45)`                            | `"02:05.5"`                                               |
| `formatTime(59.95)`                             | `"01:00.0"`（进位）                                       |
| `formatTime(-20)`                               | `"-20.0"`                                                 |
| `formatTime(-0.5)`                              | `"-0.5"`                                                  |
| `buildTimelineText` 基础                        | 多个 cast 按时间升序输出                                  |
| `buildTimelineText` TTS                         | 每行末尾 ` tts`（带空格）                                 |
| `buildTimelineText` 空选                        | 返回空字符串                                              |
| `buildTimelineText` 未知 actionId               | 跳过该行                                                  |
| `wrapAsITimeline` timeline 字段存在             | `zoneId === "1234"`                                       |
| `wrapAsITimeline` timeline 字段缺失，静态表命中 | `zoneId` 等于静态表值                                     |
| `wrapAsITimeline` 两者均缺失                    | `zoneId === "0"`                                          |
| `wrapAsITimeline` name                          | `${timeline.name} - WHM`                                  |
| `exportSoumaTimeline` roundtrip                 | `LZString.decompressFromBase64 → JSON.parse` 得到预期数组 |

### FFLogs 导入测试 `src/utils/fflogsImporter.test.ts` 扩展

| 用例                   | 断言                                |
| ---------------------- | ----------------------------------- |
| `gameZone.id = 1234.0` | `timeline.gameZoneId === 1234`      |
| `gameZone = null`      | `timeline.gameZoneId === undefined` |
| `gameZone` 字段缺失    | `timeline.gameZoneId === undefined` |

### Worker fflogs client 测试 `src/workers/fflogsClientV2.test.ts`

如已有该测试文件则增加对 `gameZone { id }` 查询字段的断言；若无则仅保证本地类型编译。

## 埋点

| 事件名               | 触发                          | 属性                                                       |
| -------------------- | ----------------------------- | ---------------------------------------------------------- |
| `souma-export-start` | 点击 `Souma 时间轴...` 菜单项 | —                                                          |
| `souma-export-copy`  | 点击对话框内"复制"成功        | `{ job: string, skillCount: number, ttsEnabled: boolean }` |

与现有 `excel-export-start` 埋点同一 `track(...)` 调用。

## 错误处理

- FFLogs 导入时 `gameZone` 为 null → 字段不写入（`undefined`）→ 导出时回退 `"0"`，对用户透明。
- `navigator.clipboard.writeText` 失败 → catch 后 Toast 错误提示，不 throw。
- 技能 id 在 `mitigationActions` 里找不到（理论不会发生，但保险起见）→ 静默跳过该行。

## 文件变更清单

| 文件                                      | 改动类型 | 说明                                                                |
| ----------------------------------------- | -------- | ------------------------------------------------------------------- |
| `package.json`                            | 修改     | 新增 `lz-string` 依赖                                               |
| `src/types/timeline.ts`                   | 修改     | `Timeline` 接口新增 `gameZoneId?: number`                           |
| `src/workers/timelineSchema.ts`           | 修改     | Valibot `TimelineSchema` 声明 `gameZoneId` 以避免字段被剥离         |
| `src/workers/timelines.test.ts`           | 修改     | 新增一个断言 `gameZoneId` 往返持久化的用例                          |
| `src/data/raidEncounters.ts`              | 修改     | `RaidEncounter` 新增 `gameZoneId: number`（必填），6 个条目人工补值 |
| `src/workers/fflogsClientV2.ts`           | 修改     | `fights { ... }` 查询追加 `gameZone { id }`                         |
| `src/utils/fflogsImporter.ts`             | 修改     | 解析并写入 `gameZoneId`                                             |
| `src/utils/fflogsImporter.test.ts`        | 修改     | 新增 3 个 gameZone 相关用例                                         |
| `src/components/CreateTimelineDialog.tsx` | 修改     | 新建时从静态表写入 `gameZoneId`                                     |
| `src/utils/soumaExporter.ts`              | 新增     | 导出核心逻辑                                                        |
| `src/utils/soumaExporter.test.ts`         | 新增     | 单元测试                                                            |
| `src/components/ExportSoumaDialog.tsx`    | 新增     | 对话框组件                                                          |
| `src/components/EditorToolbar.tsx`        | 修改     | 菜单项 + 懒加载 Dialog                                              |

## 开放问题

无。

## 附录：GraphQL introspection 结果

```
ReportFight.gameZone: GameZone (nullable OBJECT)
GameZone.id: Float! (SCALAR NON_NULL)
GameZone.name: String
```
