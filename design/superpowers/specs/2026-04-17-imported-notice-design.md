# 已导入提示设计

## 目标

在用户从 FFLogs 导入战斗记录时，如果该 reportCode + fightId 组合已经存在于本地时间轴列表，给出明确的视觉提示，避免重复导入。

覆盖两个入口：

1. **ImportFFLogsDialog**：URL 输入框解析出合法 reportCode + fightId 后，若本地已有匹配，显示提示文字 "该战斗记录已经导入过" + "查看" 按钮（新标签页打开已导入的时间轴）。
2. **Top100Section**：TOP100 表格每一行的"导入"按钮右侧，若本地已导入该 reportCode + fightID，渲染一个小 pill badge "已导入"（muted 色、不可点击，纯提示）。

## 非目标

- **不** 阻止用户继续导入——只是提示，原"导入"按钮和入口行为不变。
- **不** 把 `fflogsSource` 加到 `TimelineMetadata`（已有 spec `2026-03-24-timeline-description-fflogs-source-nanoid-design.md` 明确不加入，此处保持一致）。
- **不** 监听 `storage` 事件或跨 tab 同步；TOP100 页面刷新一次索引即可。
- **不** 在首页"我的时间轴"卡片上加 badge（本次不扩展到该位置）。
- **不** 为 `fight=last` 链接做重复检测（需要额外的 FFLogs 请求才能解析 fightId，不划算）。

## 设计

### 1. 核心工具：`buildFFLogsSourceIndex`

在 `src/utils/timelineStorage.ts` 新增：

```ts
/**
 * 构建 FFLogs 来源索引
 * key: `${reportCode}:${fightId}`
 * value: 该来源对应的最新一条（updatedAt 最大）TimelineMetadata
 */
export function buildFFLogsSourceIndex(): Map<string, TimelineMetadata>
```

**实现思路：**

1. 调用 `getAllTimelineMetadata()` 拿到所有 metadata。
2. 对每个 metadata，用 `getTimeline(m.id)` 读取完整时间轴数据。
3. 若 `timeline.fflogsSource` 存在，以 `${reportCode}:${fightId}` 为 key 写入 Map。
4. 若 key 已存在，比较 `updatedAt` 保留较新的那条 metadata。
5. 读取/解析失败的记录（损坏等）静默跳过。

**性能：**

- 每次构建全量遍历 localStorage；N = 用户本地时间轴数量。
- 典型场景 N ≤ 几十条，总耗时 < 50ms，可接受。
- 两个调用点（对话框、TOP100）各自按需构建；不在模块级缓存（保证每次展示都是最新状态）。

### 2. `ImportFFLogsDialog` 改动

**位置：** `src/components/ImportFFLogsDialog.tsx`

**逻辑：**

1. 用 `useMemo` 计算 `duplicate`，依赖 `[parsed?.reportCode, parsed?.fightId, parsed?.isLastFight]`：
   - 条件：`parsed?.reportCode && !parsed.isLastFight && parsed.fightId != null`
   - 若条件成立，调用 `buildFFLogsSourceIndex()` 并 `.get(${rc}:${fi})`
   - 否则 `duplicate = null`

2. 在 URL 输入框下方、`validationError` 同位置（优先级：重复提示显示在 `validationError` 之后；同时都显示时两条都渲染）新增提示块：

```tsx
{
  duplicate && (
    <div className="flex items-center gap-2 text-xs mt-1">
      <span className="text-muted-foreground">该战斗记录已经导入过</span>
      <button
        type="button"
        onClick={() => window.open(`/timeline/${duplicate.id}`, '_blank')}
        className="text-primary hover:underline"
      >
        查看
      </button>
    </div>
  )
}
```

**行为：**

- "查看" 按钮不关闭对话框，新标签页打开——与现有导入后跳转（`window.open` 新标签页）行为一致。
- 用户仍可继续点击"导入"按钮走正常流程。

### 3. `Top100Section` 改动

**位置：** `src/components/Top100Section.tsx`

**主组件改动：**

1. 新增状态 `refreshTick`（number），用于触发索引重建：
   ```tsx
   const [refreshTick, setRefreshTick] = useState(0)
   ```
2. 用 `useMemo` 构建 `importedSources: Set<string>`，依赖 `[refreshTick]`：
   ```tsx
   const importedSources = useMemo(() => {
     return new Set(buildFFLogsSourceIndex().keys())
   }, [refreshTick])
   ```
3. 导入成功回调里 bump refreshTick：
   ```tsx
   onImported={() => {
     setImportUrl(null)
     setRefreshTick(t => t + 1)
   }}
   ```
4. 将 `importedSources` 作为 prop 传给 `EncounterTable`。

**EncounterTable 改动：**

1. 新增 prop `importedSources: Set<string>`。
2. 每行渲染时，计算 `const isImported = importedSources.has(`${entry.reportCode}:${entry.fightID}`)`。
3. 在"操作"单元格里，`导入`按钮右侧条件渲染 badge：

```tsx
<td className="text-center px-3 py-2 align-middle">
  <div className="inline-flex items-center gap-2">
    <button ... >导入</button>
    {isImported && (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
        已导入
      </span>
    )}
  </div>
</td>
```

**Badge 特性：**

- `<span>` 非 `<button>`，不可交互，纯提示。
- muted 背景 + muted 文字色，低调不抢眼。
- 仅在 `isImported === true` 时渲染。

## 数据流

```
用户本地 localStorage (healerbook_timelines_*)
           │
           ▼
buildFFLogsSourceIndex()
  ├─ 遍历所有 metadata
  ├─ 读取每个 timeline 的 fflogsSource
  └─ 返回 Map<reportCode:fightId, TimelineMetadata>
           │
           ├──▶ ImportFFLogsDialog: .get(key) → 显示提示 + 查看按钮
           │
           └──▶ Top100Section: new Set(.keys()) → 传给 EncounterTable → row badge
```

## 边界场景

| 场景                               | 行为                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| 本地时间轴没有 `fflogsSource`      | 不纳入索引，不影响提示判断                                                              |
| 同一 reportCode+fightId 有多条     | 索引保留 `updatedAt` 最大的一条；对话框提示的"查看"跳转到这条                           |
| 本地时间轴已删除但 metadata 未同步 | `getTimeline` 返回 null，静默跳过                                                       |
| 用户粘贴 `fight=last` 链接         | `parsed.isLastFight === true`，不做重复检测（UI 无提示、无 badge）                      |
| 用户粘贴只有 reportCode 无 fightId | `parsed.fightId == null`，不做重复检测                                                  |
| 索引构建抛异常                     | 与现有 `getAllTimelineMetadata` / `getTimeline` 一致，在 `console.error` 后降级为空 Map |
| 重复导入（用户明知故犯）           | 允许；导入成功后 TOP100 索引会通过 `refreshTick` 刷新，badge 依旧显示（因为仍有匹配）   |

## 测试

手工验证（无需新增自动化测试）：

1. **对话框：** 本地已导入 reportCode=ABC, fightID=5 的时间轴，打开导入对话框粘贴 `https://www.fflogs.com/reports/ABC#fight=5`，应出现 "该战斗记录已经导入过" + "查看"。点击"查看"在新标签页打开对应 `/timeline/<id>`。
2. **TOP100：** 首页 TOP100 列表中，展开任意副本，找到本地已导入的 reportCode+fightID 对应的行，该行"导入"按钮右侧应显示"已导入" badge。
3. **刷新：** 从 TOP100 里导入一条新的战斗记录，导入成功对话框关闭后，该行应立即出现"已导入" badge（无需刷新页面）。
4. **`fight=last`：** 粘贴 `.../reports/ABC#fight=last`，即使本地有匹配 reportCode 的记录，也不显示提示。
5. **删除：** 删除本地时间轴后刷新首页，对应 TOP100 行的 badge 应消失。

## 涉及文件清单

| 文件                                    | 改动                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/utils/timelineStorage.ts`          | 新增导出函数 `buildFFLogsSourceIndex()`                                                              |
| `src/components/ImportFFLogsDialog.tsx` | 新增 `useMemo` 查索引 + 渲染 "已导入" 提示 + "查看" 按钮                                             |
| `src/components/Top100Section.tsx`      | 新增 `refreshTick` + `importedSources` memo + 传 prop；`EncounterTable` 接收 prop 并在每行渲染 badge |
