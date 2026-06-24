# 自动减伤·最小前端入口 Implementation Plan（计划三·最小一键版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** 给 EditorPage 工具栏加一个「自动减伤」按钮：点击 → calculator worker 跑 `runOptimize` → 把 `addedCastEvents` 批量写回 timeline（单 undo）→ 用 toast 反馈 summary / infeasible。无幽灵预览（留待后续）。

**Architecture:** 复用现有 calculator worker（手写 postMessage + requestId 协议），新增独立的 `optimize` 消息通道（**绕开** simulate 的 `currentRequestId` silent-drop）。`OptimizeInput.actions` 含不可序列化的函数（executor），**不跨 worker 边界**——worker 内部用 `MITIGATION_DATA` 自建 actions Map；消息只传可序列化部分。前端用一个 `useAutoMitigate` hook 封装"组装输入→调 worker→写回→toast"，按钮只管触发。

**Tech Stack:** React 19 + TS、Zustand、Yjs（协同/undo）、sonner（toast）、Vite worker。复用 `runOptimize`（`@/utils/autoMitigation`）、`resolveStatData`、`MITIGATION_DATA`、`timelineStore`。

## Global Constraints

- 包管理器必须 **pnpm**（`pnpm test:run`、`pnpm exec tsc --noEmit`、`pnpm lint`）。测试同目录 `*.test.ts`。
- 提交信息**禁止**含 "Claude"；不得禁用 gpgsign。命名用 `action` 不用 `skill`。
- **`OptimizeInput.actions` 不可跨 worker**（`MitigationAction.executor` 等是函数，structured-clone 抛错）。worker 消息类型 = `Omit<OptimizeInput,'actions'>`；worker 内部 `new Map(MITIGATION_DATA.actions.map(a=>[a.id,a]))` 补回。
- optimize 响应**必须按 requestId resolve**，不参与 `currentRequestId` silent-drop（否则飞行中被 simulate 抢占则永不 resolve）。worker 崩溃时 optimize pending 也要 reject。
- 写回必须是**单 undo 单元**：外层 `engine.doc.transact(() => { ...loop yAddCastEvent... }, LOCAL_ORIGIN)`（Yjs 把嵌套 transact 合并为一个 stack item）。
- 按钮门控 = 仅可写模式可用：`!isReplayMode && sessionRole !== 'viewer'` + `disabled={!editLock.can('content') || isOptimizing}`（与导入按钮同款）。
- timeBudget 取 2000ms（worker 单线程，optimize 期间会阻塞 simulate；控制等待时长）。

## File Structure

| 文件                                        | 改动                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/web-workers/calculator/types.ts`       | 加 `kind` 判别字段、`OptimizeWireInput`、`OptimizeRequest`、`OptimizeResponse` |
| `src/web-workers/calculator/index.ts`       | `self.onmessage` 按 `kind` 分发，新增 optimize 分支                            |
| `src/web-workers/calculator/client.ts`      | 加 `optimize()` 方法 + 独立 pending；`onmessage`/`onerror` 兼顾                |
| `src/web-workers/calculator/client.test.ts` | optimize resolve-by-requestId、不被 simulate 抢占、崩溃 reject                 |
| `src/store/timelineStore.ts`                | 加 `addCastEventsBatch(casts)` 单 undo 批量写回                                |
| `src/store/timelineStore.test.ts`           | 批量写回 = 单步 undo                                                           |
| `src/hooks/useAutoMitigate.ts`              | 纯 `buildOptimizeWireInput` + hook（组装/调 worker/写回/toast）                |
| `src/hooks/useAutoMitigate.test.ts`         | `buildOptimizeWireInput` 字段映射正确                                          |
| `src/components/EditorToolbar.tsx`          | 加「自动减伤」按钮，接 hook                                                    |

---

### Task 1: Worker optimize 通道（协议 + worker 分发 + client 方法）

**Files:**

- Modify: `src/web-workers/calculator/types.ts`
- Modify: `src/web-workers/calculator/index.ts`
- Modify: `src/web-workers/calculator/client.ts`
- Test: `src/web-workers/calculator/client.test.ts`

**Interfaces:**

- Consumes: `runOptimize`, `OptimizeOutput`, `OptimizeInput` (`@/utils/autoMitigation`); `MITIGATION_DATA` (`@/data/mitigationActions`).
- Produces: `OptimizeWireInput = Omit<OptimizeInput,'actions'>`; `CalculatorWorkerClient.optimize(input: OptimizeWireInput): Promise<OptimizeOutput>`.

- [ ] **Step 1: 加协议类型** — `types.ts`

在文件末尾追加（保留现有 `SimulateRequest`/`SimulateResponse`/`SimulateBundle`）：

```ts
import type { OptimizeInput, OptimizeOutput } from '@/utils/autoMitigation'

/** actions 含 executor 等函数，不可 structured-clone，故 worker 消息剔除它，worker 内自建。 */
export type OptimizeWireInput = Omit<OptimizeInput, 'actions'>

export interface OptimizeRequest {
  requestId: string
  kind: 'optimize'
  input: OptimizeWireInput
}

export type OptimizeResponse =
  | { requestId: string; kind: 'optimize'; ok: true; output: OptimizeOutput }
  | { requestId: string; kind: 'optimize'; ok: false; error: { message: string; stack?: string } }
```

给现有 `SimulateRequest` 加可选判别字段（worker 据此分发；缺省视为 simulate 保持后向兼容）。在 `SimulateRequest` 接口里加一行：

```ts
  kind?: 'simulate'
```

并在 `SimulateResponse` 的两个分支对象里各加 `kind?: 'simulate'`（worker 回填，client 据此分流）。

- [ ] **Step 2: worker 分发 optimize** — `index.ts`

在文件顶部 import 处加：

```ts
import { runOptimize } from '@/utils/autoMitigation'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import type { OptimizeRequest, SimulateRequest } from './types'
```

把 `self.onmessage` 改成按 `kind` 分发。现有 simulate 逻辑整体搬进 `handleSimulate`，新增 optimize 分支：

```ts
self.onmessage = (e: MessageEvent<SimulateRequest | OptimizeRequest>) => {
  if ((e.data as OptimizeRequest).kind === 'optimize') {
    const { requestId, input } = e.data as OptimizeRequest
    try {
      const actions = new Map(MITIGATION_DATA.actions.map(a => [a.id, a]))
      const output = runOptimize({ ...input, actions })
      self.postMessage({ requestId, kind: 'optimize', ok: true, output })
    } catch (err) {
      self.postMessage({
        requestId,
        kind: 'optimize',
        ok: false,
        error: {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
      })
    }
    return
  }
  // —— 既有 simulate 路径（原样保留，回填 kind:'simulate'）——
  // ...existing simulate body... 末尾 postMessage 加 kind:'simulate'
}
```

> 注意：现有 simulate 的成功/失败 `self.postMessage({...})` 各加 `kind: 'simulate'`，以便 client 分流。

- [ ] **Step 3: client.optimize + 独立 pending** — `client.ts`

在类里加独立 pending map 与方法（保留现有 `simulate`/`currentRequestId`/`pending` 不动）：

```ts
private pendingOptimize = new Map<string, { resolve: (o: OptimizeOutput) => void; reject: (e: Error) => void }>()

optimize(input: OptimizeWireInput): Promise<OptimizeOutput> {
  const worker = this.ensureWorker()
  const requestId = nanoid()
  return new Promise<OptimizeOutput>((resolve, reject) => {
    this.pendingOptimize.set(requestId, { resolve, reject })
    worker.postMessage({ requestId, kind: 'optimize', input } satisfies OptimizeRequest)
  })
}
```

> 用 `ensureWorker()`（即现有 `simulate` 里 lazy-spawn worker 并挂 `onmessage`/`onerror` 的那段；若它是内联的，抽成一个私有 `ensureWorker()` 返回 `this.worker`，simulate 也改用它——保持单一 spawn 点）。

在 worker 的 `onmessage`（现有 handler）顶部加 optimize 分流，**先于** `currentRequestId` 判定：

```ts
const data = e.data as SimulateResponse | OptimizeResponse
if ((data as OptimizeResponse).kind === 'optimize') {
  const p = this.pendingOptimize.get(data.requestId)
  if (!p) return
  this.pendingOptimize.delete(data.requestId)
  if (data.ok) p.resolve(data.output)
  else p.reject(new Error(data.error.message))
  return
}
// —— 既有 simulate 分支（currentRequestId silent-drop 原样）——
```

在 `onerror`（worker 崩溃）里，除了 reject 现有 `this.pending`，也 reject `this.pendingOptimize`：

```ts
for (const { reject } of this.pendingOptimize.values()) reject(new Error('worker crashed'))
this.pendingOptimize.clear()
```

补 import：`import type { OptimizeWireInput, OptimizeRequest, OptimizeResponse } from './types'`、`import type { OptimizeOutput } from '@/utils/autoMitigation'`。

- [ ] **Step 4: 写失败测试** — `client.test.ts`（沿用现有 mock worker 风格）

```ts
it('optimize 按 requestId resolve，且不被后续 simulate 抢占（不 silent-drop）', async () => {
  const { client, post } = makeClientWithMockWorker() // 复用文件内现有 mock 工厂
  const p = client.optimize(MINIMAL_OPTIMIZE_INPUT)
  // 模拟用户在 optimize 飞行中又触发 simulate（改写 currentRequestId）
  client.simulate(MINIMAL_INPUT, [])
  // worker 回 optimize 响应
  post({ requestId: lastOptimizeRequestId, kind: 'optimize', ok: true, output: FAKE_OUTPUT })
  await expect(p).resolves.toEqual(FAKE_OUTPUT)
})

it('worker 崩溃时 reject 飞行中的 optimize', async () => {
  const { client, fireError } = makeClientWithMockWorker()
  const p = client.optimize(MINIMAL_OPTIMIZE_INPUT)
  fireError()
  await expect(p).rejects.toThrow()
})
```

> 实现者：参照 `client.test.ts` 既有 mock worker 工厂获取「最近一次 postMessage 的 requestId」与「手动 post 响应/触发 error」的能力；`MINIMAL_OPTIMIZE_INPUT` 用最小 `OptimizeWireInput`（空 damageEvents/lockedCastEvents、`composition:{players:[]}`、`initialState:{statuses:[],timestamp:0}`），`FAKE_OUTPUT` 用最小 `OptimizeOutput`。

- [ ] **Step 5: 跑测试 + tsc**

Run: `pnpm test:run src/web-workers/calculator/client.test.ts && pnpm exec tsc --noEmit`
Expected: PASS（含原有 simulate 测试不回归）

- [ ] **Step 6: 提交**

```bash
git add src/web-workers/calculator/
git commit -m "feat(auto-mitigation): worker optimize 通道（独立 requestId，绕开 simulate silent-drop）"
```

---

### Task 2: store 批量写回（单 undo）

**Files:**

- Modify: `src/store/timelineStore.ts`
- Test: `src/store/timelineStore.test.ts`

**Interfaces:**

- Produces: `addCastEventsBatch(casts: Omit<CastEvent, 'id'>[]): void`（store action）。

- [ ] **Step 1: 加接口声明** — `timelineStore.ts`（在 `pasteObjects` 声明附近，约 207 行）

```ts
  addCastEventsBatch: (casts: Omit<CastEvent, 'id'>[]) => void
```

- [ ] **Step 2: 写失败测试** — `timelineStore.test.ts`（沿用现有 store 测试初始化）

```ts
it('addCastEventsBatch 批量加 = 单步 undo', () => {
  const store = makeOpenedStore() // 复用文件内现有"打开一个 timeline"的辅助
  const before = store.getState().timeline.castEvents.length
  store.getState().addCastEventsBatch([
    { actionId: 7535, timestamp: 10, playerId: 1 },
    { actionId: 3540, timestamp: 20, playerId: 2 },
  ])
  expect(store.getState().timeline.castEvents.length).toBe(before + 2)
  store.getState().undo()
  expect(store.getState().timeline.castEvents.length).toBe(before) // 一步全撤
})
```

- [ ] **Step 3: 实现** — `timelineStore.ts`（仿 `pasteObjects` 的 cast 分支；`engine`/`generateObjectId`/`yAddCastEvent`/`LOCAL_ORIGIN` 均已在文件内 import）

```ts
  addCastEventsBatch: casts => {
    const engine = get().engine
    if (!engine || casts.length === 0) return
    engine.doc.transact(() => {
      for (const c of casts) {
        yAddCastEvent(engine.doc, { ...c, id: generateObjectId() })
      }
    }, LOCAL_ORIGIN)
  },
```

- [ ] **Step 4: 跑测试 + tsc**

Run: `pnpm test:run src/store/timelineStore.test.ts && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "feat(auto-mitigation): store 批量写回 castEvents（单 undo 单元）"
```

---

### Task 3: useAutoMitigate hook + 纯输入组装

**Files:**

- Create: `src/hooks/useAutoMitigate.ts`
- Test: `src/hooks/useAutoMitigate.test.ts`

**Interfaces:**

- Consumes: `workerClient`（`@/hooks/useDamageCalculation` 导出的单例）；`resolveStatData`（`@/utils/statDataUtils`）；`OptimizeWireInput`（`@/web-workers/calculator/types`）；`useTimelineStore`；`toast`（sonner）；`Timeline, PartyState, EncounterStatistics` 类型。
- Produces: `buildOptimizeWireInput(timeline, partyState, statistics): OptimizeWireInput`（纯函数）；`useAutoMitigate(): { isOptimizing: boolean; run: () => Promise<void> }`。

- [ ] **Step 1: 写失败测试** — `useAutoMitigate.test.ts`（只测纯函数 `buildOptimizeWireInput`）

```ts
import { describe, it, expect } from 'vitest'
import { buildOptimizeWireInput } from './useAutoMitigate'
import type { Timeline } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'

const timeline = {
  damageEvents: [
    { id: 'd1', name: 'x', time: 30, damage: 90000, type: 'aoe', damageType: 'magical' },
  ],
  castEvents: [{ id: 'c1', actionId: 7535, timestamp: 5, playerId: 1 }],
  composition: { players: [{ id: 1, job: 'WAR' }] },
  statData: undefined,
} as unknown as Timeline
const partyState = { statuses: [], timestamp: 0 } as PartyState

describe('buildOptimizeWireInput', () => {
  it('把 timeline/partyState/statistics 映射到 wire 输入，且不含 actions', () => {
    const wire = buildOptimizeWireInput(timeline, partyState, null)
    expect(wire.damageEvents).toBe(timeline.damageEvents)
    expect(wire.lockedCastEvents).toBe(timeline.castEvents) // 当前 casts 作 locked
    expect(wire.composition).toBe(timeline.composition)
    expect(wire.initialState).toBe(partyState)
    expect('actions' in wire).toBe(false) // actions 由 worker 补
    expect(typeof wire.baseReferenceMaxHPForAoe).toBe('number')
    expect(wire.options?.timeBudgetMs).toBe(2000)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/hooks/useAutoMitigate.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** — `useAutoMitigate.ts`

```ts
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useTimelineStore } from '@/store/timelineStore'
import { workerClient } from '@/hooks/useDamageCalculation'
import { resolveStatData } from '@/utils/statDataUtils'
import type { OptimizeWireInput } from '@/web-workers/calculator/types'
import type { Timeline } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'
import type { EncounterStatistics } from '@/types/statistics'

/** 纯函数：组装 worker 用的 OptimizeWireInput（不含 actions —— worker 内自建）。 */
export function buildOptimizeWireInput(
  timeline: Timeline,
  partyState: PartyState,
  statistics: EncounterStatistics | null
): OptimizeWireInput {
  const resolved = resolveStatData(timeline.statData, statistics, timeline.composition)
  return {
    damageEvents: timeline.damageEvents,
    lockedCastEvents: timeline.castEvents ?? [],
    composition: timeline.composition,
    initialState: partyState,
    statistics: resolved,
    baseReferenceMaxHPForAoe: resolved.referenceMaxHP!,
    baseReferenceMaxHPForTank: resolved.tankReferenceMaxHP!,
    options: { timeBudgetMs: 2000, seed: 1 },
  }
}

export function useAutoMitigate() {
  const [isOptimizing, setOptimizing] = useState(false)

  const run = useCallback(async () => {
    const state = useTimelineStore.getState()
    const timeline = state.timeline
    if (!timeline) return
    const wire = buildOptimizeWireInput(timeline, state.partyState, state.statistics)
    if (wire.damageEvents.length === 0) {
      toast.info('当前时间轴没有伤害事件，无法自动减伤')
      return
    }
    setOptimizing(true)
    try {
      const out = await workerClient.optimize(wire)
      if (out.addedCastEvents.length === 0) {
        toast.info('未找到可进一步降低伤害的放置')
        return
      }
      state.addCastEventsBatch(out.addedCastEvents.map(({ id: _id, ...rest }) => rest))
      const before = out.summary.totalDamageBefore
      const pct = before > 0 ? ((1 - out.summary.totalDamageAfter / before) * 100).toFixed(1) : '0'
      toast.success(`已自动放置 ${out.summary.castsAdded} 个减伤，承受总伤 -${pct}%`)
      if (out.infeasibleEvents.length > 0) {
        toast.warning(`${out.infeasibleEvents.length} 个伤害事件现有冷却无法覆盖，建议手动处理`)
      }
    } catch (e) {
      toast.error('自动减伤失败：' + (e instanceof Error ? e.message : '未知错误'))
    } finally {
      setOptimizing(false)
    }
  }, [])

  return { isOptimizing, run }
}
```

> 实现者注意：
>
> 1. 确认 `state.timeline` 的读法——若 store 没有直接 `timeline` 字段，改用 EditorPage 获取 timeline 的同一选择器（看 `EditorPage.tsx` 怎么拿 timeline，例如派生 `yDocProjection ?? snapshot`）。`buildOptimizeWireInput` 是纯函数不受影响，只调整 hook 内的读取。
> 2. 确认 `EncounterStatistics` 类型路径（看 `useDamageCalculation.ts` 里 `statistics` 的类型来源）；若不同，按实际修正 import，不要新造类型。
> 3. `resolved.referenceMaxHP` / `tankReferenceMaxHP` 可能为 undefined——`resolveStatData` 有 fallback（见 `statDataUtils.ts`）；若实测可能为空，加保护：为空时 `toast.error('请先设置参考血量')` 并 return（与设计 §6 边界一致：缺基准时阶段 1 空跑，但前端可提示）。按实际行为决定，并在 report 说明。

- [ ] **Step 4: 跑测试 + tsc**

Run: `pnpm test:run src/hooks/useAutoMitigate.test.ts && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/hooks/useAutoMitigate.ts src/hooks/useAutoMitigate.test.ts
git commit -m "feat(auto-mitigation): useAutoMitigate hook 与输入组装"
```

---

### Task 4: EditorToolbar 按钮

**Files:**

- Modify: `src/components/EditorToolbar.tsx`

**Interfaces:**

- Consumes: `useAutoMitigate`（Task 3）。

- [ ] **Step 1: 接 hook + 加按钮** — `EditorToolbar.tsx`

在组件顶部（其他 hook 旁）加：

```ts
const { isOptimizing, run: runAutoMitigate } = useAutoMitigate()
```

仿导入按钮（约 465-494 行）的门控与结构，在工具栏合适位置加一个按钮（用 lucide 的 `Wand2` 或 `Sparkles` 图标，import 自 `lucide-react`）：

```tsx
{
  !isReplayMode && sessionRole !== 'viewer' && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!editLock.can('content') || isOptimizing}
          onClick={runAutoMitigate}
          aria-label="自动减伤"
        >
          {isOptimizing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">自动放置减伤（最小化承受总伤）</TooltipContent>
    </Tooltip>
  )
}
```

补 import：`import { Wand2, Loader2 } from 'lucide-react'`（若 `Loader2` 已被 import 则复用），`import { useAutoMitigate } from '@/hooks/useAutoMitigate'`。

- [ ] **Step 2: 类型检查 + lint + 构建**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: 全 PASS（UI 改动以构建为兜底；本任务无单测）

- [ ] **Step 3: 手动验证（报告中描述，不阻塞）**

实现者在 report 中描述：按钮仅在 local/author 可写态出现、view 态隐藏；点击后进入 loading、worker 返回后落 cast、toast 出现；undo 一步撤销整批。若开发服务器不可用则跳过，仅以 `pnpm build` + 代码走查兜底。

- [ ] **Step 4: 提交**

```bash
git add src/components/EditorToolbar.tsx
git commit -m "feat(auto-mitigation): EditorToolbar 加自动减伤按钮"
```

---

## Self-Review

**Spec coverage（设计 §6 最小子集）：** worker optimize 通道（Task 1）✅；批量写回单 undo（Task 2）✅；输入组装与 toast 反馈、infeasible 提示（Task 3）✅；工具栏按钮 + 模式门控 + loading（Task 4）✅。**幽灵预览 / 应用-放弃两态**显式不在最小版（留后续）。

**Placeholder scan：** 无 TBD；每步给完整代码。两处"实现者注意"是具体核对指令（timeline 选择器、statistics 类型路径、refHP 为空兜底），非占位。

**Type consistency：** `OptimizeWireInput`（Task 1 定义）→ Task 3 组装 → client.optimize 消费一致；`addCastEventsBatch(Omit<CastEvent,'id'>[])`（Task 2）↔ hook 写回 `out.addedCastEvents.map(strip id)`（Task 3）一致；`kind` 判别字段在 types/worker/client 三处一致。

**关键风险已规避：** actions 不跨 worker（worker 内自建）；optimize 不被 simulate silent-drop（独立 pending + requestId resolve）；单 undo（外层 transact + LOCAL_ORIGIN）；worker 单线程阻塞用 2000ms budget + loading 态缓解。

## 后续（不在本计划）

- 幽灵预览态 + 应用/放弃（设计 §6 完整流程）。
- 独立 worker 或分片让 optimize 不阻塞 live simulate。
- infeasible 事件可点击定位、summary 卡片。
