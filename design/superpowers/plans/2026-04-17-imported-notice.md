# 已导入提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 FFLogs 导入对话框和 TOP100 列表中显示"已导入"提示，避免用户重复导入同一战斗记录。

**Architecture:**

1. 新增 `buildFFLogsSourceIndex()` 工具函数：遍历 localStorage 中所有时间轴，构建 `${reportCode}:${fightId} → TimelineMetadata` 的索引。
2. `ImportFFLogsDialog`：URL 解析后查索引，匹配时在输入框下方显示"该战斗记录已经导入过 [查看]"。
3. `Top100Section`：挂载时构建索引，传给 `EncounterTable`，匹配行的"导入"按钮旁渲染"已导入" badge；导入成功后 bump refresh tick 重建索引。

**Tech Stack:** React 19、TypeScript、Vitest 4（jsdom 环境 for localStorage tests）、pnpm。

**Spec:** `design/superpowers/specs/2026-04-17-imported-notice-design.md`

---

## 文件结构

| 文件                                    | 角色                                                 | 变更类型 |
| --------------------------------------- | ---------------------------------------------------- | -------- |
| `src/utils/timelineStorage.ts`          | 新增导出 `buildFFLogsSourceIndex`                    | 修改     |
| `src/utils/timelineStorage.test.ts`     | 新增 `buildFFLogsSourceIndex` 相关单元测试           | 修改     |
| `src/components/ImportFFLogsDialog.tsx` | 查重 + 渲染提示块                                    | 修改     |
| `src/components/Top100Section.tsx`      | 构建索引 + `refreshTick` + 传 prop + 行内 badge 渲染 | 修改     |

---

## Task 1: 新增 `buildFFLogsSourceIndex` 工具函数（TDD）

**Files:**

- Modify: `src/utils/timelineStorage.ts`
- Test: `src/utils/timelineStorage.test.ts`

### Step 1.1: 在 `timelineStorage.test.ts` 末尾追加 `buildFFLogsSourceIndex` 测试套件

- [ ] 在 `src/utils/timelineStorage.test.ts` 末尾追加：

```ts
import { buildFFLogsSourceIndex } from './timelineStorage'

describe('buildFFLogsSourceIndex', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('无本地时间轴时返回空 Map', () => {
    const index = buildFFLogsSourceIndex()
    expect(index.size).toBe(0)
  })

  it('忽略没有 fflogsSource 的时间轴', () => {
    const timeline = createNewTimeline('1001', '纯本地')
    saveTimeline(timeline)

    const index = buildFFLogsSourceIndex()
    expect(index.size).toBe(0)
  })

  it('含 fflogsSource 的时间轴应加入索引', () => {
    const timeline = createNewTimeline('1001', '导入自 FFLogs')
    timeline.fflogsSource = { reportCode: 'ABC123', fightId: 5 }
    saveTimeline(timeline)

    const index = buildFFLogsSourceIndex()
    expect(index.size).toBe(1)
    const meta = index.get('ABC123:5')
    expect(meta).toBeDefined()
    expect(meta!.id).toBe(timeline.id)
    expect(meta!.name).toBe('导入自 FFLogs')
  })

  it('相同 reportCode+fightId 多条时保留 updatedAt 最大的一条', () => {
    const older = createNewTimeline('1001', '旧')
    older.fflogsSource = { reportCode: 'RPT', fightId: 3 }
    older.updatedAt = 1000
    saveTimeline(older)

    const newer = createNewTimeline('1001', '新')
    newer.fflogsSource = { reportCode: 'RPT', fightId: 3 }
    newer.updatedAt = 2000
    saveTimeline(newer)

    const index = buildFFLogsSourceIndex()
    expect(index.size).toBe(1)
    const meta = index.get('RPT:3')
    expect(meta!.id).toBe(newer.id)
    expect(meta!.name).toBe('新')
  })

  it('不同 reportCode+fightId 应分别索引', () => {
    const a = createNewTimeline('1001', 'A')
    a.fflogsSource = { reportCode: 'AAA', fightId: 1 }
    saveTimeline(a)

    const b = createNewTimeline('1002', 'B')
    b.fflogsSource = { reportCode: 'BBB', fightId: 2 }
    saveTimeline(b)

    const index = buildFFLogsSourceIndex()
    expect(index.size).toBe(2)
    expect(index.get('AAA:1')!.id).toBe(a.id)
    expect(index.get('BBB:2')!.id).toBe(b.id)
  })

  it('时间轴数据损坏时静默跳过（不抛异常）', () => {
    const good = createNewTimeline('1001', '正常')
    good.fflogsSource = { reportCode: 'GOOD', fightId: 1 }
    saveTimeline(good)

    // 手动注入一条损坏的 metadata 条目（指向不存在的 id）
    const metadata = JSON.parse(localStorage.getItem('healerbook_timelines')!)
    metadata.push({
      id: 'broken-id',
      name: '坏',
      encounterId: '1001',
      createdAt: 0,
      updatedAt: 0,
    })
    localStorage.setItem('healerbook_timelines', JSON.stringify(metadata))

    const index = buildFFLogsSourceIndex()
    expect(index.size).toBe(1)
    expect(index.has('GOOD:1')).toBe(true)
  })
})
```

### Step 1.2: 运行测试确认失败

- [ ] 运行：`pnpm test:run src/utils/timelineStorage.test.ts`
- [ ] 预期失败：`buildFFLogsSourceIndex is not defined` 或导入错误。

### Step 1.3: 实现 `buildFFLogsSourceIndex`

- [ ] 在 `src/utils/timelineStorage.ts` 末尾追加（紧跟已有 `deleteTimeline` 等函数之后）：

```ts
/**
 * 构建 FFLogs 来源索引
 *
 * 遍历本地所有时间轴，提取带 fflogsSource 的条目，按 `${reportCode}:${fightId}` 聚合。
 * 相同 key 有多条时保留 updatedAt 最大的一条。
 * 损坏或读取失败的条目静默跳过。
 */
export function buildFFLogsSourceIndex(): Map<string, TimelineMetadata> {
  const index = new Map<string, TimelineMetadata>()
  const metadataList = getAllTimelineMetadata()

  for (const metadata of metadataList) {
    const timeline = getTimeline(metadata.id)
    if (!timeline?.fflogsSource) continue

    const key = `${timeline.fflogsSource.reportCode}:${timeline.fflogsSource.fightId}`
    const existing = index.get(key)
    if (!existing || metadata.updatedAt > existing.updatedAt) {
      index.set(key, metadata)
    }
  }

  return index
}
```

### Step 1.4: 运行测试确认通过

- [ ] 运行：`pnpm test:run src/utils/timelineStorage.test.ts`
- [ ] 预期：全部测试通过（包括新增的 6 个用例 + 原有用例）。

### Step 1.5: TypeScript 与 lint 检查

- [ ] 运行：`pnpm exec tsc --noEmit`
- [ ] 预期：无错误输出。
- [ ] 运行：`pnpm lint`
- [ ] 预期：无错误。

### Step 1.6: 提交

- [ ] 运行：

```bash
git add src/utils/timelineStorage.ts src/utils/timelineStorage.test.ts
git commit -m "feat(storage): 新增 buildFFLogsSourceIndex 构建 FFLogs 来源索引"
```

---

## Task 2: `ImportFFLogsDialog` 显示重复提示

**Files:**

- Modify: `src/components/ImportFFLogsDialog.tsx`

### Step 2.1: 添加 import

- [ ] 在 `src/components/ImportFFLogsDialog.tsx` 顶部 import 区，把：

```ts
import { createNewTimeline, saveTimeline } from '@/utils/timelineStorage'
```

改为：

```ts
import { createNewTimeline, saveTimeline, buildFFLogsSourceIndex } from '@/utils/timelineStorage'
```

并在现有 `useState, useEffect, useRef` 同一行 import 中追加 `useMemo`：

```ts
import { useState, useEffect, useMemo, useRef } from 'react'
```

### Step 2.2: 在 `parsed` 变量之后计算 `duplicate`

- [ ] 在 `ImportFFLogsDialog` 组件内部，找到这一段：

```ts
// 实时解析 URL，判断是否合法
const parsed = url ? parseFFLogsUrl(url) : null
const isValid = !!parsed?.reportCode
const validationError = url && !isValid ? '无法识别 FFLogs 链接，请检查 URL 格式' : ''
```

在其下方追加：

```ts
// 查找本地是否已导入相同 reportCode+fightId 的时间轴
const duplicate = useMemo(() => {
  if (!parsed?.reportCode || parsed.isLastFight || parsed.fightId == null) {
    return null
  }
  const index = buildFFLogsSourceIndex()
  return index.get(`${parsed.reportCode}:${parsed.fightId}`) ?? null
}, [parsed?.reportCode, parsed?.fightId, parsed?.isLastFight])
```

### Step 2.3: 在 `validationError` 渲染块后新增提示块

- [ ] 找到 JSX 中这一段：

```tsx
{
  validationError && <p className="text-xs text-destructive mt-1">{validationError}</p>
}
```

在其下方追加：

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

### Step 2.4: TypeScript 与 lint 检查

- [ ] 运行：`pnpm exec tsc --noEmit`
- [ ] 预期：无错误。
- [ ] 运行：`pnpm lint`
- [ ] 预期：无错误。

### Step 2.5: 手工验证

- [ ] 确认 `pnpm dev` 正在运行（用户通常已启动；若未启动则请用户启动）。
- [ ] 在浏览器打开首页，先通过任意 FFLogs 链接（例如 `https://www.fflogs.com/reports/ABC123#fight=5`）导入一条测试时间轴（若当前没有线上有效链接，则用浏览器控制台 `localStorage` 手动注入一条含 `fflogsSource` 的时间轴）。
- [ ] 再次打开"从 FFLogs 导入"对话框，粘贴同一个 URL。
- [ ] 预期：URL 输入框下方出现 "该战斗记录已经导入过 [查看]"。
- [ ] 点击"查看"，应在新标签页打开 `/timeline/<id>`，对话框保持打开。
- [ ] 改为 `...#fight=last` 或换一个不存在的 `reportCode`，提示应消失。

### Step 2.6: 提交

- [ ] 运行：

```bash
git add src/components/ImportFFLogsDialog.tsx
git commit -m "feat(import-dialog): 显示本地已导入同战斗记录的提示与查看入口"
```

---

## Task 3: `Top100Section` 显示"已导入" badge

**Files:**

- Modify: `src/components/Top100Section.tsx`

### Step 3.1: 添加 import 与类型扩展

- [ ] 在 `src/components/Top100Section.tsx` 顶部 import 区，把：

```ts
import { useState } from 'react'
```

改为：

```ts
import { useMemo, useState } from 'react'
```

- [ ] 在 import 区追加：

```ts
import { buildFFLogsSourceIndex } from '@/utils/timelineStorage'
```

### Step 3.2: 扩展 `EncounterTable` 的 props 与行渲染

- [ ] 找到 `EncounterTable` 组件签名：

```tsx
function EncounterTable({
  encounter,
  data,
  filterMitigationKey,
  isFiltered,
  onImport,
}: {
  encounter: RaidEncounter
  data: Top100Data | null | undefined
  filterMitigationKey: number[] | null
  isFiltered: boolean
  onImport: (url: string) => void
}) {
```

改为：

```tsx
function EncounterTable({
  encounter,
  data,
  filterMitigationKey,
  isFiltered,
  importedSources,
  onImport,
}: {
  encounter: RaidEncounter
  data: Top100Data | null | undefined
  filterMitigationKey: number[] | null
  isFiltered: boolean
  importedSources: Set<string>
  onImport: (url: string) => void
}) {
```

- [ ] 找到渲染表格行的 `displayEntries.map(entry => (...))` 内部，其中"操作"单元格：

```tsx
<td className="text-center px-3 py-2 align-middle">
  <button
    onClick={() => {
      track('top100-import', {
        encounterId: encounter.id,
        rank: entry.rank,
        filtered: isFiltered,
      })
      onImport(buildFFLogsUrl(entry.reportCode, entry.fightID))
    }}
    className="text-xs px-2 py-1 rounded border hover:bg-accent transition-colors"
  >
    导入
  </button>
</td>
```

改为：

```tsx
<td className="text-center px-3 py-2 align-middle">
  <div className="inline-flex items-center gap-2">
    <button
      onClick={() => {
        track('top100-import', {
          encounterId: encounter.id,
          rank: entry.rank,
          filtered: isFiltered,
        })
        onImport(buildFFLogsUrl(entry.reportCode, entry.fightID))
      }}
      className="text-xs px-2 py-1 rounded border hover:bg-accent transition-colors"
    >
      导入
    </button>
    {importedSources.has(`${entry.reportCode}:${entry.fightID}`) && (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
        已导入
      </span>
    )}
  </div>
</td>
```

### Step 3.3: 在 `Top100Section` 主组件中构建索引并传递

- [ ] 找到 `Top100Section` 主组件开头：

```tsx
export default function Top100Section() {
  const [importUrl, setImportUrl] = useState<string | null>(null)
  const [activeTierIdx, setActiveTierIdx] = useState(RAID_TIERS.length - 1) // 默认最新赛季
```

在 `activeTierIdx` 声明之后追加：

```tsx
const [refreshTick, setRefreshTick] = useState(0)

const importedSources = useMemo(() => {
  return new Set(buildFFLogsSourceIndex().keys())
  // 依赖 refreshTick：导入成功后 bump，强制重建索引
}, [refreshTick])
```

- [ ] 找到 `EncounterTable` 调用处：

```tsx
{
  activeTier.encounters.map(encounter => (
    <EncounterTable
      key={encounter.id}
      encounter={encounter}
      data={data?.[encounter.id]}
      filterMitigationKey={filterMitigationKey}
      isFiltered={filterMitigationKey !== null}
      onImport={setImportUrl}
    />
  ))
}
```

改为：

```tsx
{
  activeTier.encounters.map(encounter => (
    <EncounterTable
      key={encounter.id}
      encounter={encounter}
      data={data?.[encounter.id]}
      filterMitigationKey={filterMitigationKey}
      isFiltered={filterMitigationKey !== null}
      importedSources={importedSources}
      onImport={setImportUrl}
    />
  ))
}
```

- [ ] 找到 `ImportFFLogsDialog` 调用处：

```tsx
{
  /* 导入对话框 */
}
{
  importUrl && (
    <ImportFFLogsDialog
      open={true}
      initialUrl={importUrl}
      onClose={() => setImportUrl(null)}
      onImported={() => setImportUrl(null)}
    />
  )
}
```

改为：

```tsx
{
  /* 导入对话框 */
}
{
  importUrl && (
    <ImportFFLogsDialog
      open={true}
      initialUrl={importUrl}
      onClose={() => setImportUrl(null)}
      onImported={() => {
        setImportUrl(null)
        setRefreshTick(t => t + 1)
      }}
    />
  )
}
```

### Step 3.4: TypeScript 与 lint 检查

- [ ] 运行：`pnpm exec tsc --noEmit`
- [ ] 预期：无错误。
- [ ] 运行：`pnpm lint`
- [ ] 预期：无错误。

### Step 3.5: 手工验证

- [ ] 在浏览器打开首页，展开任意有数据的 TOP100 副本。
- [ ] 本地通过"从 FFLogs 导入"或手动 localStorage 注入一条 `fflogsSource.reportCode = X, fightId = Y`，使其匹配表格中某一行的 `entry.reportCode:entry.fightID`。
- [ ] 刷新页面。预期：匹配的那一行在"导入"按钮右侧显示灰色的"已导入"小 badge。
- [ ] 点击任一条未导入行的"导入"按钮，走完导入流程。导入成功后（新标签页打开 / 对话框关闭），当前首页 TOP100 区的对应行应立即出现"已导入" badge（无需刷新）。
- [ ] 从首页"我的时间轴"列表删除这条导入的时间轴，刷新页面。对应 TOP100 行的"已导入" badge 应消失。

### Step 3.6: 提交

- [ ] 运行：

```bash
git add src/components/Top100Section.tsx
git commit -m "feat(top100): 本地已导入的战斗行显示已导入 badge"
```

---

## Task 4: 整体回归与收尾

### Step 4.1: 全量测试

- [ ] 运行：`pnpm test:run`
- [ ] 预期：所有测试套件通过；新增的 `buildFFLogsSourceIndex` 用例通过；无现有测试被破坏。

### Step 4.2: 全量类型检查与 lint

- [ ] 运行：`pnpm exec tsc --noEmit`
- [ ] 预期：无错误。
- [ ] 运行：`pnpm lint`
- [ ] 预期：无错误或警告。

### Step 4.3: 生产构建冒烟

- [ ] 运行：`pnpm build`
- [ ] 预期：构建成功，无告警。

### Step 4.4: 最终手工回归

- [ ] `pnpm dev` 下再次完整走一遍 spec 的"测试"小节 5 个场景（对话框提示、TOP100 badge、导入后立即刷新、`fight=last` 不提示、删除后 badge 消失）。

---

## 验收清单

- [ ] `buildFFLogsSourceIndex` 单元测试全部通过。
- [ ] `pnpm test:run` / `pnpm exec tsc --noEmit` / `pnpm lint` / `pnpm build` 全部通过。
- [ ] `ImportFFLogsDialog`：已导入的链接粘贴后，输入框下方显示 "该战斗记录已经导入过 [查看]"；点击"查看"新标签页打开已导入的时间轴；`fight=last` 链接不显示提示。
- [ ] `Top100Section`：已导入的 `reportCode+fightID` 行显示灰色 "已导入" badge；未导入的行不显示；导入成功后对应行立即显示 badge。
- [ ] 删除本地时间轴后刷新，对应 TOP100 行 badge 消失。
