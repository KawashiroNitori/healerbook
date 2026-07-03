# 结构重构第一期：立即修复 + 死代码清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复三处已确认的行为缺陷（internal 端点无鉴权、切文档统计残留、框选/协作高亮几何错位），并删除约 700+ 行死代码与文档漂移，为后续重构清场。

**Architecture:** 全部任务互相独立、各自可交付。修复类任务（1-3）改行为，删除类任务（4-6）必须行为等价，文档任务（7）只动文档与注释。总路线图见 `2026-07-03-structure-refactor-roadmap.md`。

**Tech Stack:** React 19 + TypeScript 5.9 + Zustand 5 + Vitest 4 + Cloudflare Workers (Hono)，包管理必须用 pnpm。

## Global Constraints

- 所有验证命令：`pnpm test:run`（全量测试）、`pnpm exec tsc --noEmit`（类型）、`pnpm lint`（ESLint）。每个任务提交前三者必须全绿。
- 提交信息**不得包含 "claude" 字样**（大小写不敏感，`.husky/commit-msg` 会拒绝），不加任何 Co-Authored-By。
- 除 Task 1/2/3 明确描述的行为修复外，其余任务必须**行为等价**（纯删除/纯替换）。
- 本 plan 内声明的 `git commit` 步骤在 subagent-driven 流程内可自主执行（符合项目 CLAUDE.md 的例外条款）；`git push` 与任何破坏性 Git 操作**不在授权范围**。
- 减伤技能相关命名一律用 `action`，不用 `skill`。

---

### Task 1: `/api/internal/do-lookup` 补 sync token 鉴权

**Files:**

- Modify: `src/workers/routes/internalDiag.ts`

**Interfaces:**

- Consumes: `requireSyncToken`（既有中间件，`src/workers/middleware/requireSyncToken.ts`；同目录 `internalMigrate.ts:43` 有用法示范）
- Produces: 无（行为变化：缺 token 的请求由中间件拒绝）

- [ ] **Step 1: 加中间件**

`src/workers/routes/internalDiag.ts` 顶部加 import，并在路由注册处插入中间件（同时更新注释里的「暂不鉴权」）：

```typescript
import { requireSyncToken } from '../middleware/requireSyncToken'
```

```typescript
// 原：GET /api/internal/do-lookup?doId=<hex>  (暂不鉴权)
// 改为：GET /api/internal/do-lookup?doId=<hex>  (需 sync token，与 /migrate 一致)
app.get('/do-lookup', requireSyncToken, async c => {
```

其余代码不动。

- [ ] **Step 2: 验证**

Run: `pnpm exec tsc --noEmit && pnpm test:run && pnpm lint`
Expected: 全绿（该端点无既有测试；中间件行为已被 `internalMigrate` 等用例路径覆盖，不为诊断端点新增测试）

- [ ] **Step 3: Commit**

```bash
git add src/workers/routes/internalDiag.ts
git commit -m "fix(workers): internal do-lookup 端点补 sync token 鉴权"
```

---

### Task 2: 修复切换文档时 statistics/partyState 残留

**Files:**

- Modify: `src/store/timelineStore.ts:407-541`（`openTimeline` / `setViewerSnapshot` 的重置对象）
- Test: `src/store/timelineStore.test.ts`

**Interfaces:**

- Consumes: 既有测试基建（`fake-indexeddb`、`baseContent` fixture，见 `timelineStore.test.ts:1-46`）
- Produces: 模块级常量 `sessionResetFields`（仅 store 内部使用，不导出）

**背景**：`openTimeline`（timelineStore.ts:420-438）与 `setViewerSnapshot`（:512-530）各自手写重置字段清单，两者都**漏掉了 `statistics` 和 `partyState`**——切换文档后，上一个副本的统计数据残留，窗口期内伤害计算用的是旧副本 HP 基准（`reset()` 经 `initialUiState` 是干净的，只有这两条路径漏）。修法：抽共享常量消除三处手写清单的漂移可能。

- [ ] **Step 1: 写失败测试**

在 `src/store/timelineStore.test.ts` 的 `describe('timelineStore - 状态管理', ...)` 内新增（`EncounterStatistics` 类型按文件内既有 import 习惯从 `@/types` 引入；若测试文件尚未 import 该类型则补上）：

```typescript
describe('会话重置', () => {
  it('openTimeline 应清空上一文档残留的 statistics', async () => {
    const store = useTimelineStore.getState()
    // 模拟上一个文档留下的统计数据（仅需 truthy 对象，字段不参与断言）
    store.setStatistics({ players: [] } as unknown as EncounterStatistics)
    expect(useTimelineStore.getState().statistics).not.toBeNull()

    await store.openTimeline('doc-b', { role: 'local', seedContent: baseContent })

    expect(useTimelineStore.getState().statistics).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run timelineStore -t "openTimeline 应清空上一文档残留的 statistics"`
Expected: FAIL —— `expected { players: [] } to be null`（openTimeline 未重置 statistics）

- [ ] **Step 3: 实现**

在 `src/store/timelineStore.ts` 中 `initialUiState`（:235）之后新增模块级常量：

```typescript
/**
 * 打开 / 切换文档时必须清零的会话态。
 * openTimeline 与 setViewerSnapshot 共用，防止两处手写清单漂移
 * （历史 bug：两处都漏了 statistics/partyState，切文档后旧副本统计残留）。
 * 注意：不含 zoomLevel / 滚动等视口态——切文档保留视口是既有行为。
 */
const sessionResetFields = {
  engine: null,
  yDocProjection: null,
  yDocReady: false,
  canUndo: false,
  canRedo: false,
  connectionStatus: 'disconnected' as ConnectionStatus,
  pendingRequestCount: 0,
  peers: [] as PeerState[],
  partyState: null,
  statistics: null,
  selectedEventId: null,
  selectedCastEventId: null,
  selectedEventIds: [] as string[],
  selectedCastEventIds: [] as string[],
  selectedAnnotationIds: [] as string[],
  selectionFromSelectAll: false,
}
```

`openTimeline` 的 set（:420-438）改为：

```typescript
set({
  ...sessionResetFields,
  snapshot: opts.snapshot ?? null,
  isPublished: opts.role !== 'local',
  sessionRole: opts.role,
})
```

`setViewerSnapshot` 的 set（:512-530）改为：

```typescript
set({
  ...sessionResetFields,
  snapshot: timeline,
  isPublished: true,
  sessionRole: 'viewer',
})
```

`reset()`（:1007-1029）行为已正确（`initialUiState` 覆盖全部字段），保持不动。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run timelineStore`
Expected: 全部 PASS（新用例过，且既有 1140 行用例无回归——特别留意 `openTimeline 应该自动初始化小队状态`：openTimeline 末尾的 `initializePartyState` 会在重置后重建 partyState，该用例应保持绿色）

- [ ] **Step 5: 全量验证 + Commit**

Run: `pnpm exec tsc --noEmit && pnpm test:run && pnpm lint`
Expected: 全绿

```bash
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "fix(store): openTimeline/setViewerSnapshot 重置遗漏 statistics/partyState"
```

---

### Task 3: 框选与 PeerOverlay 卡片几何统一到 computeDamageCardGeometry

**Files:**

- Modify: `src/components/Timeline/index.tsx:1571-1595`（框选 hit-box）
- Modify: `src/components/Timeline/PeerOverlay.tsx:132-135, 179-182, 259-262`（三处 `CARD_W/CARD_H` 硬编码）

**Interfaces:**

- Consumes: `computeDamageCardGeometry(event, zoomLevel): { leftLocal, width, rawLeftSec, rawRightSec }`（`src/components/Timeline/cardGeometry.ts:15`；`index.tsx:74` 已 import，`PeerOverlay.tsx` 需新增 import）
- Produces: 无新接口（行为修复）

**背景**：伤害卡片真实几何由 `computeDamageCardGeometry` 决定——带读条窗口（`castStartTime/castEndTime`）的事件，卡片左缘在 `time + leftLocal`（可为负）、宽度可超 150px（`DamageEventCard.tsx:85` 是权威消费方）。但框选 hit-box 与 PeerOverlay 的选中高亮/拖动 ghost 写死 `150×30`，对宽卡片**命中盒/高亮框与实际渲染错位**。修复：统一改用几何函数。卡片高度 30 与 y 偏移是正确的，保持不动。

- [ ] **Step 1: 修复框选 hit-box（index.tsx）**

`src/components/Timeline/index.tsx` 删除 `:1571` 的 `const DAMAGE_CARD_WIDTH = 150`，并将伤害事件循环（:1583-1595）改为：

```typescript
// 伤害事件（固定区，y 不随垂直滚动）；只框选过滤后可见的事件，与渲染一致
for (const event of filteredDamageEvents) {
  const geom = computeDamageCardGeometry(event, zoomLevel)
  const x0 = canvasLeft + event.time * zoomLevel + geom.leftLocal - clampedScrollLeft
  const row = damageEventRowMap.get(event.id) ?? 0
  const y0 = timeRulerHeight + row * LANE_ROW_HEIGHT + DAMAGE_CARD_Y_OFFSET
  objs.push({
    id: event.id,
    kind: 'damage',
    x0,
    x1: x0 + geom.width,
    y0,
    y1: y0 + DAMAGE_CARD_RECT_HEIGHT,
  })
}
```

- [ ] **Step 2: 修复 PeerOverlay 三处硬编码**

`src/components/Timeline/PeerOverlay.tsx` 顶部新增：

```typescript
import { computeDamageCardGeometry } from './cardGeometry'
```

三处（选中高亮 :132-135、拖动 ghost :179-182、群组随动 ghost :259-262）按同一模式替换。以选中高亮为例，原：

```typescript
const CARD_W = 150
const CARD_H = 30
const cardX = ev.time * zoomLevel
const cardY = yOffset + row * rowHeight + (rowHeight - CARD_H) / 2
```

改为：

```typescript
const CARD_H = 30
const geom = computeDamageCardGeometry(ev, zoomLevel)
const cardX = ev.time * zoomLevel + geom.leftLocal
const cardY = yOffset + row * rowHeight + (rowHeight - CARD_H) / 2
```

对应 `<Rect width={CARD_W}>` 改为 `width={geom.width}`。拖动 ghost 处的锚点是拖动实时时间（如 `ghostX = dragTime * zoomLevel`）：卡片形状随卡片整体平移，同样改为 `dragTime * zoomLevel + geom.leftLocal`、宽度 `geom.width`（`geom` 仍由原 `ev` 计算——读条窗口相对卡片时间点的形状不随拖动变化）。第三处（群组随动 ghost）同理，以该处实际使用的时间变量为锚点。

- [ ] **Step 3: 验证**

Run: `pnpm exec tsc --noEmit && pnpm test:run && pnpm lint`
Expected: 全绿

手工回归（开发服务器通常已由用户启动，勿自行启动；若无法手工验证则在任务汇报中明确说明未验证项）：

1. 导入或构造一条带读条窗口的伤害事件（卡片宽 > 150px 或左缘在时间点左侧）；
2. 框选该卡片的左延伸区域 → 应能选中；框选卡片右侧超出 150px 的部分 → 应能选中；
3. 协作场景下另一用户选中/拖动宽卡片 → 高亮框与 ghost 应与卡片完全重合。

- [ ] **Step 4: Commit**

```bash
git add src/components/Timeline/index.tsx src/components/Timeline/PeerOverlay.tsx
git commit -m "fix(timeline): 框选与协作高亮改用 computeDamageCardGeometry，修复宽卡片错位"
```

---

### Task 4: 删除 workers 死代码

**Files:**

- Delete: `src/workers/timelineSchema.ts`、`src/workers/timelineSchema.test.ts`、`src/workers/fflogs-proxy.test.ts`
- Modify: `src/workers/routes/fflogs.ts:29,41`、`src/workers/fflogsClientV2.ts:35`、`src/api/fflogsClient.ts:44,49,58,79`、`wrangler.toml`

**Interfaces:**

- Consumes: 无
- Produces: 无（纯删除；`GetEventsParams` 减少 `lang` 字段）

**背景（逐条证据）**：

- `timelineSchema.ts` 全部 5 个导出在 src 内除自身测试外零引用（旧版 PUT 全量更新接口已在协同重构中移除）。
- `fflogs-proxy.test.ts` 不 import 任何被测代码，断言全部是在测 `Request` 对象自身行为，零覆盖价值；文件名对应的 `fflogs-proxy.ts` 已不存在。
- `lang` 参数三层穿透（前端 → 路由 → client 参数类型）但 `fflogsClientV2.ts:524` 的 `getEvents` 解构只取 `{ reportCode, start, end }`，GraphQL 硬编码 `translate: false`——从未生效。
- `wrangler.toml` 的 `FFLOGS_API_KEY` 注释与 `RATE_LIMIT_RPM`/`CACHE_TTL` vars 在 src 内零引用（连 `Env` 接口都未声明）。

- [ ] **Step 1: 删文件**

```bash
git rm src/workers/timelineSchema.ts src/workers/timelineSchema.test.ts src/workers/fflogs-proxy.test.ts
```

- [ ] **Step 2: 摘除 lang 假参数链**

- `src/workers/routes/fflogs.ts`：删 `:29` 的 `const lang = c.req.query('lang') || undefined` 与 `:41` 传参处的 `lang,`。
- `src/workers/fflogsClientV2.ts`：删 `GetEventsParams` 接口（:35 附近）中的 `lang?: string` 字段。
- `src/api/fflogsClient.ts`（dev-only 客户端）：删 `:44` 参数类型中的 `lang?: string`、`:49` 解构中的 `lang`、`:58` 调用传参中的 `lang`、`:79` `getEvents` 参数类型中的 `lang?: string`，及函数体内消费 `params.lang` 的行（编辑后 `pnpm exec tsc --noEmit` 会揪出漏网引用）。

- [ ] **Step 3: 清 wrangler.toml 残迹**

删除 `FFLOGS_API_KEY` 相关注释行（`# v1 API` / `wrangler secret put FFLOGS_API_KEY`），删除生产段 vars 中的 `RATE_LIMIT_RPM`、`CACHE_TTL` 两行。删前 grep 确认仍零引用：

```bash
grep -rn "RATE_LIMIT_RPM\|CACHE_TTL\|FFLOGS_API_KEY" src/
```

Expected: 无输出。

- [ ] **Step 4: 验证 + Commit**

Run: `pnpm exec tsc --noEmit && pnpm test:run && pnpm lint && pnpm build`
Expected: 全绿（含 build——本任务动了 wrangler.toml 与 api 客户端）

```bash
git add -A
git commit -m "chore(workers): 删除 timelineSchema 死模块、假测试与 lang 假参数链"
```

---

### Task 5: 删除 timelineStore 死成员

**Files:**

- Modify: `src/store/timelineStore.ts`（interface 声明、实现、`initialUiState`）
- Modify: `src/store/timelineStore.test.ts`（删对应用例）

**Interfaces:**

- Consumes: 无
- Produces: 无（纯删除）

**背景**：以下成员在 src 内（store 自身与测试之外）零消费方，是旧同步模拟方案的遗骸（模拟已迁 web worker 的 `CalculatorWorkerClient`）：`executeAction`、`updatePartyState`、`cleanupExpiredStatuses`、`zoomWithScrollPreservation`、`currentTime`/`setCurrentTime`。注意 `initializePartyState`/`setStatistics`/`partyState`/`statistics` **仍有消费方，保留**。

- [ ] **Step 1: 删除声明与实现**

`src/store/timelineStore.ts` 中删除：

- interface 里的 `executeAction`、`updatePartyState`、`cleanupExpiredStatuses`、`zoomWithScrollPreservation`、`currentTime`、`setCurrentTime` 声明；
- 实现体：`executeAction`（:566-590）、`updatePartyState`（:592-594）、`cleanupExpiredStatuses`（:596-607）、`zoomWithScrollPreservation`（:691-703 附近）、`setCurrentTime`；
- `initialUiState` 中的 `currentTime: 0,`；
- `openTimeline` 内 `set({ engine, currentTime: 0 })` 改为 `set({ engine })`；
- 随之失去消费方的 import（如 `MITIGATION_DATA`、`ActionExecutionContext`——以 tsc/eslint 报告为准，只删确实不再使用的）。

- [ ] **Step 2: 删对应测试**

`src/store/timelineStore.test.ts`：删除 `describe('executeAction', ...)` 整块（:80 起），并 grep 删除 `updatePartyState` / `cleanupExpiredStatuses` / `zoomWithScrollPreservation` / `setCurrentTime` 的用例块：

```bash
grep -n "executeAction\|updatePartyState\|cleanupExpiredStatuses\|zoomWithScrollPreservation\|setCurrentTime" src/store/timelineStore.test.ts
```

- [ ] **Step 3: 确认零消费方后验证**

```bash
grep -rn "executeAction\|updatePartyState\|cleanupExpiredStatuses\|zoomWithScrollPreservation\|setCurrentTime" src/ --include='*.ts' --include='*.tsx'
```

Expected: 无输出（注意 `currentTime` 一词在别处可能是无关局部变量，逐条人工确认与 timelineStore 无关即可）。

Run: `pnpm exec tsc --noEmit && pnpm test:run && pnpm lint`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "chore(store): 删除旧同步模拟遗留的死成员"
```

---

### Task 6: 删除 mitigationStore，静态数据改模块常量

**Files:**

- Modify: `src/data/mitigationActions.ts`（新增 `ACTIONS` / `ACTIONS_BY_ID` 导出）
- Modify: `src/components/ExportExcelDialog.tsx:35`、`src/components/ImportIntoTimelineDialog.tsx:75`、`src/components/FilterMenu/EditPresetDialog.tsx:46`、`src/components/Timeline/index.tsx:224,806`、`src/components/TimelineTable/index.tsx:7,66`、`src/hooks/useFilteredTimelineView.ts:69`、`src/hooks/useResourceHoverData.ts:25`、`src/hooks/useSkillTracks.ts:14`、`src/pages/EditorPage.tsx:79-80`、`src/store/index.ts:6`
- Delete: `src/store/mitigationStore.ts`（及同目录 `mitigationStore.test.ts` 如存在）

**Interfaces:**

- Consumes: `MITIGATION_DATA`（`src/data/mitigationActions.ts:44`，静态不可变数据源）
- Produces:
  - `export const ACTIONS: MitigationAction[]`（= `MITIGATION_DATA.actions`，直接引用）
  - `export const ACTIONS_BY_ID: Map<number, MitigationAction>`（id → action 索引，模块级建一次）

**背景**：`mitigationStore.actions` 只是静态 `MITIGATION_DATA.actions` 的镜像，还需 `EditorPage` 手动 `loadActions()` 才有值（加载前为空数组）；其余成员（`selectedActionId`/`selectAction`/`setJobFilter`/`getFilteredActions`/`resetFilters`）全部零消费方。静态数据不需要响应式——改模块常量后，"加载前空数组"的时序问题也随之消失（只会变好不会变坏）。`ACTIONS_BY_ID` 同时为后续第三期消除 7+ 处各自 `new Map(actions.map(...))` 铺路，本期只建不换。

- [ ] **Step 1: 在数据模块新增常量导出**

`src/data/mitigationActions.ts` 在 `MITIGATION_DATA` 定义之后新增：

```typescript
/** 全部技能（静态数据，直接 import 使用，无需经 store / loadActions） */
export const ACTIONS = MITIGATION_DATA.actions

/** id → action 索引（数据不可变，模块级建一次） */
export const ACTIONS_BY_ID: Map<number, MitigationAction> = new Map(
  MITIGATION_DATA.actions.map(a => [a.id, a])
)
```

（若该文件尚未 import `MitigationAction` 类型则补上。）

- [ ] **Step 2: 替换全部消费方**

每个文件的替换模式一致：删 `useMitigationStore` 相关 import，新增 `import { ACTIONS } from '@/data/mitigationActions'`，然后：

- `ExportExcelDialog.tsx:35`、`ImportIntoTimelineDialog.tsx:75`、`EditPresetDialog.tsx:46`、`TimelineTable/index.tsx:66`、`useFilteredTimelineView.ts:69`、`useResourceHoverData.ts:25`、`useSkillTracks.ts:14`：`const xxx = useMitigationStore(s => s.actions)` → `const xxx = ACTIONS`（保留原变量名，最小 diff）。
- `Timeline/index.tsx:224`：`const { actions } = useMitigationStore()` → `const actions = ACTIONS`。
- `Timeline/index.tsx:806`：`useMitigationStore.getState().actions` → `ACTIONS`。
- `TimelineTable/index.tsx:7`：更新文件头注释（`useMitigationStore → actions` 改为 `ACTIONS（构造 actionsById Map）`）。
- `EditorPage.tsx:79-80`：删除 `useMitigationStore` 两行；`mitigationActions` 变量的使用处改用 `ACTIONS`；删除调用 `loadMitigationActions()` 的 `useEffect`（grep `loadMitigationActions` 定位）。
- `src/store/index.ts:6`：删除 `export { useMitigationStore } from './mitigationStore'`。

- [ ] **Step 3: 删文件并确认零残留**

```bash
git rm src/store/mitigationStore.ts
ls src/store/mitigationStore.test.ts 2>/dev/null && git rm src/store/mitigationStore.test.ts
grep -rn "useMitigationStore\|mitigationStore\|loadActions" src/ --include='*.ts' --include='*.tsx'
```

Expected: grep 无输出。

- [ ] **Step 4: 验证 + Commit**

Run: `pnpm exec tsc --noEmit && pnpm test:run && pnpm lint && pnpm build`
Expected: 全绿

```bash
git add -A
git commit -m "refactor(data): 删除 mitigationStore，静态技能数据改模块常量 ACTIONS/ACTIONS_BY_ID"
```

---

### Task 7: 文档与命名同步

**Files:**

- Modify: `CLAUDE.md`（「Workers 路由结构」一节 + 「关键文件说明」表 + 最后更新日期）
- Modify: `src/workers/README.md`
- Rename: `src/workers/fflogsImportHandler.test.ts` → `src/workers/fflogsImportRoute.test.ts`

**Interfaces:**

- Consumes: `src/workers/index.ts:46-56` 的实际路由挂载（写文档前重新核对一遍 import 来源）
- Produces: 无（纯文档/改名）

- [ ] **Step 1: 更新 CLAUDE.md「Workers 路由结构」**

将现有段落（描述 `fflogs-proxy.ts` 顶层路由器的整段）替换为（挂载路径以 `src/workers/index.ts` 实际 import 为准核对后填入）：

````markdown
### Workers 路由结构

`src/workers/index.ts` 是 Hono 入口，全局 `app.onError` 统一兜错，按功能域挂载：

​`
/api/auth                → routes/auth.ts（FFLogs OAuth 回调 / Token 续期）
/api/timelines           → routes/timelines.ts（发布 / 公开读 / 删除）
/api/timelines           → routes/share.ts（协作分享 / 编辑权限）
/api/my                  → routes/my.ts（我的时间轴列表）
/api/fflogs              → routes/fflogs.ts（FFLogs 代理与导入）
/api/top100              → routes/top100.ts（TOP100 数据与同步）
/api/statistics          → routes/statistics.ts（副本统计）
/api/encounter-templates → routes/encounterTemplates.ts（副本模板）
/api/samples-queue       → routes/samplesQueue.ts（采样队列，sync token）
/api/internal            → routes/internalMigrate.ts / internalDiag.ts（sync token）
​`

中间件在 `src/workers/middleware/`：`requireAuth`（JWT 必需）、`tryReadAuth`（可选读取）、
`requireSyncToken`（内部/同步端点）。协作文档 Durable Object 在 `src/workers/durable/TimelineDoc.ts`。
````

- [ ] **Step 2: 更新 CLAUDE.md「关键文件说明」表**

- `src/workers/timelines.ts` 行改为 `src/workers/routes/timelines.ts`（说明不变）。
- 若表中存在 `fflogs-proxy.ts` 行，替换为 `src/workers/index.ts` | `Workers Hono 入口，按功能域挂载路由`。
- 文档末尾 `**最后更新**` 改为 `2026-07-03`。

- [ ] **Step 3: 重写 workers README**

`src/workers/README.md` 内容替换为与 Step 1 一致的路由总览 + 一句话说明每个子目录（`routes/`、`middleware/`、`durable/`、`db/`（如存在）），删除只描述 FFLogs 代理 + TOP100 的过时内容。不逐条重复 CLAUDE.md，指向即可。

- [ ] **Step 4: 测试文件改名**

```bash
git mv src/workers/fflogsImportHandler.test.ts src/workers/fflogsImportRoute.test.ts
```

（同目录内改名，文件内相对 import 不受影响；文件头部如有以旧名自称的注释一并更新。）

- [ ] **Step 5: 验证 + Commit**

Run: `pnpm test:run && pnpm lint`
Expected: 全绿（改名后的测试文件被 vitest 正常收集）

```bash
git add -A
git commit -m "docs: CLAUDE.md 与 workers README 同步 Hono 路由现状"
```
