# 暴击治疗量改用 hitType 真实区分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将治疗统计中的"暴击治疗量"从"全体治疗样本 p90 代理"改为按 FFLogs `hitType` 真实区分暴击/非暴击后各取 p50。

**Architecture:** 在叶子工具 `stats.ts` 落地暴击判定常量与计算辅助（单一真相）；共享提取器 `extractHealData` 改为按 `hitType` 双桶输出；前端单场导入 `parseStatData` 与 Worker TOP100 聚合 `top100Sync` 两路共用同一计算规则。样本结构新增暴击桶，旧混合样本平滑落入非暴击桶随 reservoir 自愈。

**Tech Stack:** TypeScript 5.9、Vitest 4、pnpm、Cloudflare Workers（KV 样本存储）。

## Global Constraints

- 包管理器 **必须用 pnpm**；测试命令 `pnpm test:run <pattern>`（单模块）/ `pnpm test:run`（全量）。
- 提交信息、作者、Co-Authored-By **禁止出现 "claude"（大小写不敏感）**，否则 `.husky/commit-msg` 拒绝提交。
- 声称完成前必跑：`pnpm test:run`、`pnpm lint`、`pnpm exec tsc --noEmit`。
- 治疗暴击判定值 `hitType === 2` 为常量 `HEAL_CRIT_HIT_TYPE`；**Task 1 需用 `scripts/fetch-events.ts` 对一份真实报告核验该枚举值**再固化（核验不可行时以 2 为假设并在常量注释标注"未实测"）。
- 不改 `EncounterStatistics` / `TimelineStatData` 的字段与类型；不改 FFLogs GraphQL 查询；不改采样队列；`critShield` 维持 p90 不变。
- 不可变更新、命名用 `action` 不用 `skill`（本计划不涉及但遵循）。

参考设计：`design/superpowers/specs/2026-07-19-crit-heal-hittype-design.md`

---

### Task 1: `stats.ts` 暴击判定常量与计算辅助

**Files:**

- Modify: `src/utils/stats.ts`（在 `calculatePercentile` 之后追加）
- Test: `src/utils/stats.test.ts`（追加 describe 块）

**Interfaces:**

- Consumes: `calculatePercentile(values: number[], percentile?: number): number`（同文件已存在）
- Produces:
  - `const HEAL_CRIT_HIT_TYPE = 2`
  - `computeNormalHeal(nonCrit: number[], crit: number[]): number` —— 非暴击桶非空取其 p50，否则回退全部 p50
  - `computeCritHeal(nonCrit: number[], crit: number[]): number` —— 暴击桶非空取其 p50，否则回退全部 p90
  - `computeHealStats(nonCritByAbility: Record<number, number[]>, critByAbility: Record<number, number[]>): { healByAbility: Record<number, number>; critHealByAbility: Record<number, number> }` —— 遍历两桶 key 并集，逐 key 调用上面两个函数；两桶该 key 都空则跳过

- [ ] **Step 1: 写失败测试**

在 `src/utils/stats.test.ts` 末尾追加，并把顶部 import 改为
`import { calculatePercentile, computeNormalHeal, computeCritHeal, computeHealStats, HEAL_CRIT_HIT_TYPE } from './stats'`：

```typescript
describe('computeNormalHeal', () => {
  it('非暴击桶非空取其 p50', () => {
    expect(computeNormalHeal([10000, 20000, 30000], [99999])).toBe(20000)
  })
  it('非暴击桶为空回退全部 p50', () => {
    expect(computeNormalHeal([], [10000, 20000, 30000])).toBe(20000)
  })
})

describe('computeCritHeal', () => {
  it('暴击桶非空取其 p50', () => {
    expect(computeCritHeal([1, 2, 3], [40000, 50000, 60000])).toBe(50000)
  })
  it('暴击桶为空回退全部 p90', () => {
    // 全部 = [10000,20000,30000,40000,50000]，p90 = 46000
    expect(computeCritHeal([10000, 20000, 30000, 40000, 50000], [])).toBe(46000)
  })
})

describe('computeHealStats', () => {
  it('逐 key 分别算普通/暴击，两桶 key 取并集', () => {
    const nonCrit = { 100: [10000, 20000, 30000], 200: [5000] }
    const crit = { 100: [40000, 50000, 60000], 300: [70000] }
    const { healByAbility, critHealByAbility } = computeHealStats(nonCrit, crit)
    expect(healByAbility[100]).toBe(20000) // p50 非暴击
    expect(critHealByAbility[100]).toBe(50000) // p50 暴击
    expect(healByAbility[200]).toBe(5000) // 仅非暴击 → 普通 p50
    expect(critHealByAbility[200]).toBe(5000) // 暴击桶空 → p90 全部（单样本 = 5000）
    expect(healByAbility[300]).toBe(70000) // 非暴击桶空 → 回退全部 p50
    expect(critHealByAbility[300]).toBe(70000) // 暴击桶非空 → p50
  })
  it('HEAL_CRIT_HIT_TYPE 为 2', () => {
    expect(HEAL_CRIT_HIT_TYPE).toBe(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/stats.test.ts`
Expected: FAIL —— `computeNormalHeal is not a function` 等（导出不存在）。

- [ ] **Step 3: 最小实现**

在 `src/utils/stats.ts` 的 `calculatePercentile` 函数之后追加：

```typescript
/** FFLogs 治疗事件暴击判定：hitType === 2。已对真实报告核验。 */
export const HEAL_CRIT_HIT_TYPE = 2

/** 普通治疗：非暴击样本 p50；非暴击桶为空则回退全部（非暴击 ∪ 暴击）p50。 */
export function computeNormalHeal(nonCrit: number[], crit: number[]): number {
  if (nonCrit.length > 0) return calculatePercentile(nonCrit, 50)
  return calculatePercentile([...nonCrit, ...crit], 50)
}

/** 暴击治疗：暴击样本 p50；暴击桶为空则回退全部 p90（沿用旧估算）。 */
export function computeCritHeal(nonCrit: number[], crit: number[]): number {
  if (crit.length > 0) return calculatePercentile(crit, 50)
  return calculatePercentile([...nonCrit, ...crit], 90)
}

/** 对两桶（非暴击 / 暴击）逐 ability key 计算普通与暴击治疗值。两桶该 key 都空则跳过。 */
export function computeHealStats(
  nonCritByAbility: Record<number, number[]>,
  critByAbility: Record<number, number[]>
): { healByAbility: Record<number, number>; critHealByAbility: Record<number, number> } {
  const keys = new Set<number>([
    ...Object.keys(nonCritByAbility).map(Number),
    ...Object.keys(critByAbility).map(Number),
  ])
  const healByAbility: Record<number, number> = {}
  const critHealByAbility: Record<number, number> = {}
  for (const key of keys) {
    const nonCrit = nonCritByAbility[key] ?? []
    const crit = critByAbility[key] ?? []
    if (!nonCrit.length && !crit.length) continue
    healByAbility[key] = computeNormalHeal(nonCrit, crit)
    critHealByAbility[key] = computeCritHeal(nonCrit, crit)
  }
  return { healByAbility, critHealByAbility }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run src/utils/stats.test.ts`
Expected: PASS（全部 describe 通过）。

- [ ] **Step 5: 核验 `hitType` 取值（人工确认）**

用 `scripts/fetch-events.ts` 拉一份真实报告的 `Healing` 事件，确认暴击治疗事件的 `hitType` 为 `2`（与普通 `1` 区分）。若核验发现不同值，改 `HEAL_CRIT_HIT_TYPE` 常量与 Step 1 中 `expect(HEAL_CRIT_HIT_TYPE).toBe(2)`，并重跑 Step 4。若无 FFLogs 凭据无法核验，保留 2 并把常量注释改为"未实测，假设值"。

- [ ] **Step 6: 提交**

```bash
git add src/utils/stats.ts src/utils/stats.test.ts
git commit -m "feat(stats): 治疗暴击判定常量与 hitType 双桶计算辅助"
```

---

### Task 2: `extractHealData` 双桶输出 + 前端 `parseStatData` 改口径

**Files:**

- Modify: `src/utils/fflogsImporter.ts`（`extractHealData` 约 920-929；`parseStatData` 约 962-1033；顶部 import 约 29）
- Modify: `src/workers/top100Sync.ts`（`extractFightStats` 第 88 行调用点，最小适配保持编译）
- Test: `src/utils/fflogsImporter.test.ts`（`extractHealData` 新用例；改写第 2258 行用例）

**Interfaces:**

- Consumes: `computeNormalHeal`、`computeCritHeal`、`HEAL_CRIT_HIT_TYPE`（Task 1）
- Produces: `extractHealData(events: FFLogsEvent[]): { healByAbility: Record<number, number[]>; critHealByAbility: Record<number, number[]> }`（非暴击桶 / 暴击桶）

- [ ] **Step 1: 写失败测试（extractHealData 分桶）**

在 `src/utils/fflogsImporter.test.ts` 中 `extractHealData` 已有测试附近（若无则在文件末尾新增 describe）追加。先确认顶部已 `import { ..., extractHealData } from './fflogsImporter'`：

```typescript
describe('extractHealData 按 hitType 分桶', () => {
  it('暴击(hitType=2)入暴击桶，其余入非暴击桶，overheal 整条剔除', () => {
    const events = [
      { type: 'heal', abilityGameID: 100, amount: 10000, hitType: 1 },
      { type: 'heal', abilityGameID: 100, amount: 30000, hitType: 2 },
      { type: 'heal', abilityGameID: 100, amount: 12000 }, // 无 hitType → 非暴击
      { type: 'heal', abilityGameID: 100, amount: 99999, hitType: 2, overheal: 500 }, // 剔除
    ] as unknown as Parameters<typeof extractHealData>[0]
    const { healByAbility, critHealByAbility } = extractHealData(events)
    expect(healByAbility[100]).toEqual([10000, 12000])
    expect(critHealByAbility[100]).toEqual([30000])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/utils/fflogsImporter.test.ts`
Expected: FAIL —— 现 `extractHealData` 返回扁平 Record，`healByAbility`/`critHealByAbility` 解构为 undefined。

- [ ] **Step 3: 改 `extractHealData` 双桶**

替换 `src/utils/fflogsImporter.ts:917-929`：

```typescript
/**
 * 从事件列表提取治疗原始样本，按 hitType 分暴击/非暴击两桶
 * （按 heal 事件原始 abilityGameID 聚样，排除 overheal）。
 */
export function extractHealData(events: FFLogsEvent[]): {
  healByAbility: Record<number, number[]>
  critHealByAbility: Record<number, number[]>
} {
  const healByAbility: Record<number, number[]> = {}
  const critHealByAbility: Record<number, number[]> = {}
  for (const event of events) {
    if (event.type === 'heal' && !event.overheal && event.abilityGameID && event.amount) {
      const bucket = event.hitType === HEAL_CRIT_HIT_TYPE ? critHealByAbility : healByAbility
      if (!bucket[event.abilityGameID]) bucket[event.abilityGameID] = []
      bucket[event.abilityGameID].push(event.amount)
    }
  }
  return { healByAbility, critHealByAbility }
}
```

在 `src/utils/fflogsImporter.ts:29` 的 stats import 补上新符号：

```typescript
import {
  calculatePercentile,
  computeNormalHeal,
  computeCritHeal,
  HEAL_CRIT_HIT_TYPE,
} from './stats'
```

- [ ] **Step 4: 改 `parseStatData` 治疗计算口径**

替换 `src/utils/fflogsImporter.ts` 中治疗样本提取与计算（约 979、994-999）。将 `const rawHeal = extractHealData(events)` 保留，把原 `for (const [k, samples] of Object.entries(rawHeal)) { ... }` 治疗循环替换为：

```typescript
const healKeysUnion = new Set<number>([
  ...Object.keys(rawHeal.healByAbility).map(Number),
  ...Object.keys(rawHeal.critHealByAbility).map(Number),
])
for (const key of healKeysUnion) {
  const nonCrit = rawHeal.healByAbility[key] ?? []
  const crit = rawHeal.critHealByAbility[key] ?? []
  if (!nonCrit.length && !crit.length) continue
  if (healKeys.has(key)) healByAbility[key] = computeNormalHeal(nonCrit, crit)
  if (critHealKeys.has(key)) critHealByAbility[key] = computeCritHeal(nonCrit, crit)
}
```

（`shieldByAbility` / `critShieldByAbility` 的盾值循环保持不变。）

- [ ] **Step 5: 最小适配 Worker 调用点保持编译**

在 `src/workers/top100Sync.ts:88`，把
`const healByAbility = extractHealData(events)`
改为
`const { healByAbility } = extractHealData(events)`
（本 Task 仅取非暴击桶，Worker 聚合逻辑暂不变；Task 3 再接暴击桶。）

- [ ] **Step 6: 改写旧用例为新口径**

替换 `src/utils/fflogsImporter.test.ts:2258-2273`：

```typescript
it('暴击/非暴击按 hitType 分别取 p50', () => {
  const playerMap = new Map([[3, { id: 3, name: 'S', type: 'Scholar' }]])
  const composition: Composition = { players: [{ id: 3, job: 'SCH' }] }
  // SCH 意气轩昂之策 37013 同时声明 heal 与 critHeal
  const nonCrit = [10000, 20000, 30000].map(amount => ({
    type: 'heal',
    abilityGameID: 37013,
    amount,
    hitType: 1,
  }))
  const crit = [40000, 50000, 60000].map(amount => ({
    type: 'heal',
    abilityGameID: 37013,
    amount,
    hitType: 2,
  }))
  const events = [...nonCrit, ...crit] as unknown as Parameters<typeof parseStatData>[0]

  const result = parseStatData(events, playerMap, composition)

  expect(result).toBeDefined()
  expect(result!.healByAbility[37013]).toBe(20000) // 非暴击 p50
  expect(result!.critHealByAbility[37013]).toBe(50000) // 暴击 p50
})
```

- [ ] **Step 7: 跑测试确认通过**

Run: `pnpm test:run src/utils/fflogsImporter.test.ts`
Expected: PASS。若其它 `extractHealData` 调用相关旧用例因返回结构变化失败，按新 `{ healByAbility, critHealByAbility }` 结构修正断言。

- [ ] **Step 8: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（确认 Step 5 的 Worker 调用点已适配）。

- [ ] **Step 9: 提交**

```bash
git add src/utils/fflogsImporter.ts src/utils/fflogsImporter.test.ts src/workers/top100Sync.ts
git commit -m "feat(stats): 治疗样本按 hitType 分桶，前端导入暴击治疗取真实 p50"
```

---

### Task 3: Worker TOP100 全链路接暴击桶

**Files:**

- Modify: `src/workers/encounterStats.ts`（`EncounterSamples` 接口约 5-16）
- Modify: `src/workers/top100Sync.ts`（`ExtractedFightData` 约 56-63；`extractFightStats` 约 88/123；`processOneSample` 样本默认值约 245-252、merge 约 256-267、聚合约 283-296；import 约 31）
- Test: `src/workers/top100Sync.test.ts`

**Interfaces:**

- Consumes: `extractHealData`（双桶，Task 2）、`computeHealStats`（Task 1）、`mergeRecord`（`encounterStats.ts` 已有）
- Produces: `EncounterSamples.critHealByAbility`、`ExtractedFightData.critHealByAbility`（均 `Record<number, number[]>`）

- [ ] **Step 1: 写失败测试（聚合口径）**

在 `src/workers/top100Sync.test.ts` 追加。先确保顶部从 `./top100Sync` 导入 `extractFightStats`、`processOneSample`（已存在），并按需构造 `FFLogsReport`/事件的既有 helper。核心断言 `extractFightStats` 分桶与 `processOneSample` 聚合：

```typescript
describe('暴击治疗全链路', () => {
  it('extractFightStats 按 hitType 分桶治疗样本', () => {
    const report = {
      friendlies: [{ id: 3, name: 'S', type: 'Scholar' }],
      abilities: [],
      fights: [{ id: 1, name: 'x', startTime: 0, endTime: 1000 }],
    } as unknown as Parameters<typeof extractFightStats>[0]
    const fight = report.fights[0]
    const events = [
      { type: 'heal', abilityGameID: 37013, amount: 10000, hitType: 1 },
      { type: 'heal', abilityGameID: 37013, amount: 40000, hitType: 2 },
    ] as unknown as Parameters<typeof extractFightStats>[2]
    const extracted = extractFightStats(report, fight, events)
    expect(extracted.healByAbility[37013]).toEqual([10000])
    expect(extracted.critHealByAbility[37013]).toEqual([40000])
  })
})
```

同时新增/调整一个 `processOneSample` 用例：注入 `fetchExtracted` 返回含 `critHealByAbility` 的 `ExtractedFightData`，断言写入 KV 的 `statistics.critHealByAbility` 为暴击桶 p50（而非旧 p90）。可参考文件内既有 `processOneSample` 测试的 KV mock 写法：

```typescript
it('processOneSample 暴击治疗取暴击桶 p50', async () => {
  // fetchExtracted 返回单场：37013 非暴击 [10000,20000,30000]、暴击 [40000,50000,60000]
  // 期望 statistics.healByAbility[37013]=20000, critHealByAbility[37013]=50000
  // （复用本文件既有 processOneSample 测试的 db/kv mock 与断言模式补全）
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run src/workers/top100Sync.test.ts`
Expected: FAIL —— `extracted.critHealByAbility` 为 undefined；聚合仍走 p90。

- [ ] **Step 3: `EncounterSamples` 增暴击桶字段**

在 `src/workers/encounterStats.ts` 的 `EncounterSamples` 接口中，`healByAbility` 之后追加：

```typescript
/** 每个治疗技能的暴击样本值（hitType===2），reservoir 独立限流 */
critHealByAbility: Record<number, number[]>
```

- [ ] **Step 4: `ExtractedFightData` 增字段并在 `extractFightStats` 填充**

在 `src/workers/top100Sync.ts:56-63` 的 `ExtractedFightData` 接口 `healByAbility` 后追加：

```typescript
critHealByAbility: Record<number, number[]>
```

改 `extractFightStats`（约 88）：

```typescript
const { healByAbility, critHealByAbility } = extractHealData(events)
```

并在其 return（约 123，与 `healByAbility` 并列）加入 `critHealByAbility,`。

- [ ] **Step 5: `processOneSample` merge 暴击桶 + 默认值**

`src/workers/top100Sync.ts` 中：

样本默认值对象（约 245-252）在 `healByAbility: {},` 后追加 `critHealByAbility: {},`。

merge 段（约 256）在 `mergedHeal` 后追加：

```typescript
const mergedCritHeal = mergeRecord(oldSamples.critHealByAbility ?? {}, extracted.critHealByAbility)
```

`newSamples` 对象（约 264）在 `healByAbility: mergedHeal,` 后追加 `critHealByAbility: mergedCritHeal,`。

- [ ] **Step 6: 聚合改用 `computeHealStats`**

替换聚合块（约 289-290）。在构造 `statistics` 对象前先算：

```typescript
const { healByAbility: healStat, critHealByAbility: critHealStat } = computeHealStats(
  mergedHeal,
  mergedCritHeal
)
```

并把 `statistics` 中的

```typescript
    healByAbility: calculatePercentiles(mergedHeal),
    critHealByAbility: calculatePercentiles(mergedHeal, 90),
```

改为

```typescript
    healByAbility: healStat,
    critHealByAbility: critHealStat,
```

在 `src/workers/top100Sync.ts:31` 的 `./encounterStats` import 中补 `computeHealStats`（若 `computeHealStats` 定义在 `@/utils/stats`，则从 `@/utils/stats` 引入；本计划将其定义在 `stats.ts`，故新增
`import { computeHealStats } from '@/utils/stats'`）。

- [ ] **Step 7: 跑测试确认通过**

Run: `pnpm test:run src/workers/top100Sync.test.ts`
Expected: PASS。若文件内其它构造 `EncounterSamples` / `ExtractedFightData` 的用例因缺 `critHealByAbility` 报类型错，补 `critHealByAbility: {}`。

- [ ] **Step 8: 全量校验**

Run: `pnpm exec tsc --noEmit && pnpm test:run && pnpm lint`
Expected: 三者均通过。重点确认所有构造 `EncounterSamples`（含 `top100Sync.test.ts`、其它 worker 测试）的地方都补齐了新字段。

- [ ] **Step 9: 提交**

```bash
git add src/workers/encounterStats.ts src/workers/top100Sync.ts src/workers/top100Sync.test.ts
git commit -m "feat(stats): TOP100 聚合按 hitType 真实区分暴击治疗量"
```

---

## Self-Review

**Spec 覆盖：**

- 暴击判定 `hitType===2` + 实测核验 → Task 1 Step 3/5 ✅
- `extractHealData` 双桶 → Task 2 Step 3 ✅
- 前端 `parseStatData` 新口径 → Task 2 Step 4 ✅
- 样本结构新增暴击桶 + 平滑过渡（旧混合入非暴击桶、`?? {}` 默认、reservoir merge）→ Task 3 Step 3/5 ✅
- 统一计算口径（普通=非暴击 p50 回退全部 p50；暴击=暴击 p50 回退全部 p90）→ Task 1 helpers，两路共用（Task 2 Step 4 / Task 3 Step 6）✅
- 消费方零改动（未列入任务）→ 类型不变，`tsc` 兜底 ✅
- `critShield` 维持 p90 → 未触碰盾值路径 ✅
- 测试覆盖 → 各 Task 均含 ✅

**占位符扫描：** Task 3 Step 1 第二个 `processOneSample` 用例以注释描述"复用既有 mock 模式"——因该文件既有 KV/DB mock 写法需就地参照，实现者须照搬同文件既有 `processOneSample` 测试骨架填充断言（`healByAbility[37013]=20000`、`critHealByAbility[37013]=50000`）。其余步骤均含完整代码。

**类型一致性：** `extractHealData` 返回 `{ healByAbility, critHealByAbility }` 在 Task 2/3 一致；`computeNormalHeal`/`computeCritHeal`/`computeHealStats` 签名在 Task 1 定义、Task 2/3 按同签名调用；`EncounterSamples`/`ExtractedFightData` 新字段名 `critHealByAbility` 全程一致。
