# Timeline Description / FFLogs Source / Nanoid ID 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为时间轴添加 `description` 字段、FFLogs 导入来源（reportCode + fightId）记录，并将 ID 生成改为 nanoid 纯字母数字格式。

**Architecture:** 先改类型定义（无运行时影响），再改存储逻辑（含测试），最后改 UI 组件（对话框 + 卡片）。所有新字段均为可选，已有 LocalStorage 数据无需迁移。

**Tech Stack:** TypeScript, React 19, Zustand, Vitest, nanoid（已安装 v5.1.6）

---

## 文件清单

| 文件                                      | 操作                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/types/timeline.ts`                   | 修改：新增 `description?` 和 `fflogsSource?` 到 `Timeline`                                                     |
| `src/utils/timelineStorage.ts`            | 修改：`TimelineMetadata` 新增 `description?`；`createNewTimeline` 改用 nanoid；`saveTimeline` 写入 description |
| `src/utils/timelineStorage.test.ts`       | 新建：测试 ID 格式和 description 元数据同步                                                                    |
| `src/components/CreateTimelineDialog.tsx` | 修改：新增可选 description 输入框                                                                              |
| `src/components/ImportFFLogsDialog.tsx`   | 修改：新增可选 description 输入框，赋值 fflogsSource                                                           |
| `src/components/TimelineCard.tsx`         | 修改：展示 description 和 FFLogs 来源标签                                                                      |

---

## Task 1：更新类型定义

**Files:**

- Modify: `src/types/timeline.ts:22-45`

- [ ] **Step 1：在 `Timeline` 接口中新增两个可选字段**

在 `src/types/timeline.ts` 第 40 行（`isReplayMode` 之前）插入：

```typescript
export interface Timeline {
  /** 时间轴 ID */
  id: string
  /** 时间轴名称 */
  name: string
  /** 时间轴说明（可选） */
  description?: string
  /** FFLogs 导入来源（仅从 FFLogs 导入的时间轴存在） */
  fflogsSource?: {
    reportCode: string
    fightId: number
  }
  /** 副本信息 */
  encounter: Encounter
  /** 小队阵容 */
  composition: Composition
  /** 阶段列表 */
  phases: Phase[]
  /** 伤害事件列表 */
  damageEvents: DamageEvent[]
  /** 技能使用事件列表 */
  castEvents: CastEvent[]
  /** 状态事件列表（编辑模式专用） */
  statusEvents: StatusEvent[]
  /** 是否为回放模式 */
  isReplayMode?: boolean
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}
```

- [ ] **Step 2：确认 TypeScript 编译无错误**

```bash
cd D:/programs/healerbook && pnpm tsc --noEmit 2>&1 | head -20
```

预期：无新增错误（只有类型定义变更，可选字段不破坏现有代码）

- [ ] **Step 3：Commit**

```bash
git add src/types/timeline.ts
git commit -m "feat: 在 Timeline 类型中新增 description 和 fflogsSource 字段"
```

---

## Task 2：更新存储逻辑（nanoid + description 元数据同步）

**Files:**

- Modify: `src/utils/timelineStorage.ts`
- Create: `src/utils/timelineStorage.test.ts`

- [ ] **Step 1：先写失败的测试**

新建 `src/utils/timelineStorage.test.ts`：

```typescript
// @vitest-environment jsdom
/**
 * 时间轴存储工具测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createNewTimeline, saveTimeline, getAllTimelineMetadata } from './timelineStorage'

describe('createNewTimeline', () => {
  it('应该生成纯字母数字的 nanoid（不含 - 和 _）', () => {
    const timeline = createNewTimeline('1001', '测试时间轴')
    expect(timeline.id).toMatch(/^[0-9A-Za-z]{21}$/)
  })

  it('每次调用应该生成不同的 ID', () => {
    const t1 = createNewTimeline('1001', '时间轴 A')
    const t2 = createNewTimeline('1001', '时间轴 B')
    expect(t1.id).not.toBe(t2.id)
  })
})

describe('saveTimeline - description 元数据同步', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('保存带 description 的时间轴时，元数据中应包含 description', () => {
    const timeline = createNewTimeline('1001', '测试')
    timeline.description = '这是一段说明'
    saveTimeline(timeline)

    const metadata = getAllTimelineMetadata()
    expect(metadata).toHaveLength(1)
    expect(metadata[0].description).toBe('这是一段说明')
  })

  it('保存不带 description 的时间轴时，元数据中 description 应为 undefined', () => {
    const timeline = createNewTimeline('1001', '测试')
    saveTimeline(timeline)

    const metadata = getAllTimelineMetadata()
    expect(metadata[0].description).toBeUndefined()
  })

  it('更新时间轴 description 后，元数据应同步更新', () => {
    const timeline = createNewTimeline('1001', '测试')
    timeline.description = '初始说明'
    saveTimeline(timeline)

    timeline.description = '更新后的说明'
    saveTimeline(timeline)

    const metadata = getAllTimelineMetadata()
    expect(metadata).toHaveLength(1)
    expect(metadata[0].description).toBe('更新后的说明')
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd D:/programs/healerbook && pnpm test:run src/utils/timelineStorage.test.ts
```

预期：FAIL（`createNewTimeline` 还在用旧格式 ID，`TimelineMetadata` 无 `description`）

- [ ] **Step 3：更新 `timelineStorage.ts`**

**3a. 在文件顶部 import 后添加 nanoid：**

```typescript
import { customAlphabet } from 'nanoid'

// 使用纯字母数字字母表（排除默认的 _ 和 -），避免 ID 包含特殊字符
const generateId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21
)
```

**3b. 更新 `TimelineMetadata` 接口（第 9-15 行）：**

```typescript
export interface TimelineMetadata {
  id: string
  name: string
  description?: string
  encounterId: string
  createdAt: string
  updatedAt: string
}
```

**3c. 更新 `saveTimeline` 中的 `newMetadata` 构建（第 57-63 行）：**

```typescript
const newMetadata: TimelineMetadata = {
  id: timeline.id,
  name: timeline.name,
  description: timeline.description,
  encounterId: timeline.encounter?.id?.toString() || 'unknown',
  createdAt: timeline.createdAt,
  updatedAt: new Date().toISOString(),
}
```

**3d. 更新 `createNewTimeline` 中的 ID 生成（第 103 行）：**

```typescript
id: generateId(),
```

- [ ] **Step 4：运行测试，确认通过**

```bash
cd D:/programs/healerbook && pnpm test:run src/utils/timelineStorage.test.ts
```

预期：全部 PASS

- [ ] **Step 5：运行全量测试，确认无回归**

```bash
cd D:/programs/healerbook && pnpm test:run
```

预期：全部 PASS

- [ ] **Step 6：Commit**

```bash
git add src/utils/timelineStorage.ts src/utils/timelineStorage.test.ts
git commit -m "feat: 改用 nanoid 生成时间轴 ID，saveTimeline 同步 description 到元数据"
```

---

## Task 3：CreateTimelineDialog 新增 description 输入

**Files:**

- Modify: `src/components/CreateTimelineDialog.tsx`

- [ ] **Step 1：新增 `description` state**

在第 33 行 `const [name, setName] = useState('')` 后添加：

```typescript
const [description, setDescription] = useState('')
```

- [ ] **Step 2：在 handleSubmit 中赋值 description**

将第 44 行的 `createNewTimeline` 调用块改为：

```typescript
const timeline = createNewTimeline(encounterId, name.trim())
if (description.trim()) {
  timeline.description = description.trim()
}
saveTimeline(timeline)
```

- [ ] **Step 3：在名称输入框后添加 description 输入框**

在第 71 行（`</div>` 后，副本 `<div>` 前）插入：

```tsx
<div>
  <label className="block text-sm font-medium mb-1">说明</label>
  <input
    type="text"
    value={description}
    onChange={e => setDescription(e.target.value)}
    placeholder="可选：为这个时间轴添加简短说明"
    className="w-full px-3 py-2 border rounded-md"
    autoComplete="off"
    data-1p-ignore
  />
</div>
```

- [ ] **Step 4：手动验证**

启动开发服务器（`pnpm dev`），点击新建时间轴，确认：

- 出现「说明」输入框
- 填写说明后创建，在时间轴卡片中能看到说明（Task 5 完成后可验证）
- 不填说明也能正常创建

- [ ] **Step 5：Commit**

```bash
git add src/components/CreateTimelineDialog.tsx
git commit -m "feat: 创建时间轴对话框新增可选 description 输入"
```

---

## Task 4：ImportFFLogsDialog 新增 description 输入 + 赋值 fflogsSource

**Files:**

- Modify: `src/components/ImportFFLogsDialog.tsx`

- [ ] **Step 1：新增 `description` state**

在第 29 行 `const [loadingStep, setLoadingStep] = useState('')` 后添加：

```typescript
const [description, setDescription] = useState('')
```

- [ ] **Step 2：在 `saveTimeline` 调用前赋值 description 和 fflogsSource**

在第 197 行（`newTimeline.isReplayMode = true` 后、`newTimeline.castEvents = castEvents` 前）插入：

```typescript
// 设置 description
if (description.trim()) {
  newTimeline.description = description.trim()
}

// 记录 FFLogs 来源（parsed.reportCode 已在 handleSubmit 开头验证非 null）
newTimeline.fflogsSource = {
  reportCode: parsed.reportCode!,
  fightId: fightId!,
}
```

- [ ] **Step 3：在 URL 输入框后（parsedInfo 展示块之后）添加 description 输入框**

在第 277 行（`</div>` 后，error 展示前）插入：

```tsx
<div>
  <label className="block text-sm font-medium mb-1">说明</label>
  <input
    type="text"
    value={description}
    onChange={e => setDescription(e.target.value)}
    placeholder="可选：为这个时间轴添加简短说明"
    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
    disabled={isLoading}
    autoComplete="off"
    data-1p-ignore
  />
</div>
```

- [ ] **Step 4：手动验证**

使用有效的 FFLogs URL 导入，确认：

- 出现「说明」输入框
- 导入后的时间轴存有 `fflogsSource.reportCode` 和 `fflogsSource.fightId`（在浏览器控制台 `localStorage.getItem('healerbook_timelines_<id>')` 验证）

- [ ] **Step 5：Commit**

```bash
git add src/components/ImportFFLogsDialog.tsx
git commit -m "feat: FFLogs 导入对话框新增 description 输入，记录 fflogsSource"
```

---

## Task 5：TimelineCard 展示 description 和 FFLogs 来源标签

**Files:**

- Modify: `src/components/TimelineCard.tsx`

- [ ] **Step 1：展示 description**

在第 32 行（`<h3>` 块）后添加 description 展示：

```tsx
<div className="flex items-start justify-between mb-2">
  <div>
    <h3 className="font-medium group-hover:text-primary">{timeline.name}</h3>
    {timeline.description && (
      <p className="text-sm text-muted-foreground mt-0.5">{timeline.description}</p>
    )}
  </div>
  <button
    onClick={onDelete}
    className="p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-colors"
  >
    <Trash2 className="w-4 h-4" />
  </button>
</div>
```

- [ ] **Step 2：展示 FFLogs 来源标签**

`fflogsSource` 存在于完整 Timeline 中，通过已有的 `fullTimeline` 读取。在第 52 行（更新时间 `<p>` 之前）插入：

```tsx
{
  fullTimeline?.fflogsSource && (
    <div className="flex items-center gap-1 mb-1">
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
        FFLogs
      </span>
      <span className="text-xs text-muted-foreground font-mono">
        {fullTimeline.fflogsSource.reportCode}#{fullTimeline.fflogsSource.fightId}
      </span>
    </div>
  )
}
```

- [ ] **Step 3：手动验证**

在首页：

- 确认有 description 的时间轴在标题下方显示说明文字
- 确认从 FFLogs 导入的时间轴显示蓝色 FFLogs 徽章和 `reportCode#fightId`
- 确认无 description、无 fflogsSource 的时间轴不显示额外内容

- [ ] **Step 4：运行全量测试，确认无回归**

```bash
cd D:/programs/healerbook && pnpm test:run
```

预期：全部 PASS

- [ ] **Step 5：Commit**

```bash
git add src/components/TimelineCard.tsx
git commit -m "feat: 时间轴卡片展示 description 和 FFLogs 来源标签"
```
