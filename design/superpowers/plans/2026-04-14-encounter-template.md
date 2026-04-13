# Encounter Template 预填充伤害事件 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建空白时间轴时，自动预填充对应副本的代表性 boss 伤害事件列表（从 TOP100 采样聚合产出）。

**Architecture:** 复用现有 TOP100 采样管线（`extractFightStatistics` → `aggregateStatistics`），在同一条流水线末尾额外产出 encounter template 并缓存到 KV。前端在新建时间轴对话框打开时用 TanStack Query 预取，submit 时从 cache 同步取出塞进新 timeline。采用"模板法"——挑本批次最长战斗作为结构模板，`abilityId` 出现 < 3 场的事件过滤，damage 数字用 `damageByAbility` p50 覆盖。

**Tech Stack:** TypeScript 5.9, Cloudflare Workers, KV, valibot 1.x, TanStack Query 5, Vitest 4, React 19, ky, nanoid.

**Spec:** `design/superpowers/specs/2026-04-14-encounter-template-design.md`

---

## File Structure

**Modified:**

- `src/types/timeline.ts` — `DamageEvent` 加 `abilityId?: number`
- `src/workers/top100Sync.ts` — `FightStatistics` 扩展；`extractFightStatistics` 调 `parseDamageEvents` 并 slim；`aggregateStatistics` 增 Step 5.5；新增 `EncounterTemplate` 类型 + `getEncounterTemplateKVKey` + `handleGetEncounterTemplate`
- `src/workers/top100Sync.test.ts` — 新增聚合和模板产出测试（引入轻量 in-memory KV mock）
- `src/workers/fflogs-proxy.ts` — 挂载 `/api/encounter-templates/:id` 路由
- `src/workers/timelines.test.ts` — 回归：`abilityId` 字段被 valibot 自动 strip
- `src/utils/timelineStorage.ts` — `createNewTimeline` 加第 3 参数 `initialDamageEvents`
- `src/utils/timelineStorage.test.ts` — 新增 3 个 case
- `src/components/CreateTimelineDialog.tsx` — prefetch on open/change + submit 取 cache

**Created:**

- `src/api/encounterTemplate.ts` — `fetchEncounterTemplate` + `EncounterTemplateResponse` 类型
- `src/hooks/useEncounterTemplate.ts` — TanStack Query hook

**Not touched:** `timelineSchema.ts`（不改——依赖 valibot v1 `v.object` 默认 strip 未知字段的行为），`fflogsImporter.ts`（只读）。

---

## Task 1: DamageEvent 类型扩展

**Files:**

- Modify: `src/types/timeline.ts:157-178`

- [ ] **Step 1: 加 optional abilityId 字段**

修改 `src/types/timeline.ts` 中 `DamageEvent` interface，在 `snapshotTime?` 之后新增：

```ts
export interface DamageEvent {
  /** 事件 ID */
  id: string
  /** 技能名称 */
  name: string
  /** 相对于阶段开始的时间（秒） */
  time: number
  /** 原始伤害（非坦克玩家平均值，如果只有坦克则为所有玩家平均值） */
  damage: number
  /** 攻击类型 */
  type: DamageEventType
  /** 伤害类型 */
  damageType: DamageType
  /** 目标玩家 ID（可选，用于单体伤害） */
  targetPlayerId?: number
  /** 每个玩家的伤害详情 */
  playerDamageDetails?: PlayerDamageDetail[]
  /** 伤害包 ID（回放模式，用于关联状态快照） */
  packetId?: number
  /** DOT 快照时间（秒）— 百分比减伤以此时刻为准而非 tick 时间 */
  snapshotTime?: number
  /** 采集/聚合阶段使用的技能 ID，不参与持久化（valibot schema 会自动 strip） */
  abilityId?: number
}
```

- [ ] **Step 2: 类型检查通过**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（新字段是 optional，现有代码不受影响）。

- [ ] **Step 3: Commit**

```bash
git add src/types/timeline.ts
git commit -m "feat(types): 添加 DamageEvent.abilityId optional 字段"
```

---

## Task 2: Worker 采集层 — FightStatistics 扩展 + extractFightStatistics slim

**Files:**

- Modify: `src/workers/top100Sync.ts:27-49, 296-351`
- Modify: `src/workers/top100Sync.test.ts`

这一步让单场战斗采集时同时提取 slim DamageEvent 列表和 fight duration，写进 fight-stats KV。

- [ ] **Step 1: 写 slim 化逻辑的 unit 测试**

在 `src/workers/top100Sync.test.ts` 末尾加新的 describe 块：

```ts
import { slimDamageEvents } from './top100Sync'
import type { DamageEvent } from '@/types/timeline'

describe('slimDamageEvents', () => {
  it('剥离 id / targetPlayerId / playerDamageDetails 并提取 abilityId', () => {
    const full: DamageEvent[] = [
      {
        id: 'event-123',
        name: '死刑',
        time: 12.3,
        damage: 80000,
        type: 'tankbuster',
        damageType: 'physical',
        targetPlayerId: 5,
        playerDamageDetails: [
          {
            timestamp: 12345,
            packetId: 1,
            sourceId: 99,
            playerId: 5,
            job: 'WAR',
            abilityId: 40000,
            skillName: '死刑',
            unmitigatedDamage: 80000,
            finalDamage: 40000,
            statuses: [],
          },
        ],
        packetId: 1,
      },
    ]
    const result = slimDamageEvents(full)
    expect(result).toEqual([
      {
        name: '死刑',
        time: 12.3,
        damage: 80000,
        type: 'tankbuster',
        damageType: 'physical',
        packetId: 1,
        abilityId: 40000,
        snapshotTime: undefined,
      },
    ])
  })

  it('playerDamageDetails 为空时 abilityId 为 0', () => {
    const full: DamageEvent[] = [
      {
        id: 'x',
        name: '未知',
        time: 0,
        damage: 0,
        type: 'aoe',
        damageType: 'magical',
      },
    ]
    const result = slimDamageEvents(full)
    expect(result[0].abilityId).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run top100Sync -t slimDamageEvents`
Expected: FAIL — `slimDamageEvents is not a function`

- [ ] **Step 3: 实现 StoredDamageEvent 类型 + slimDamageEvents 导出函数**

在 `src/workers/top100Sync.ts` 顶部 import 区域补充：

```ts
import type { DamageEvent } from '@/types/timeline'
import { parseDamageEvents } from '@/utils/fflogsImporter'
import type { FFLogsAbility } from '@/types/fflogs'
```

在文件顶部、`FightStatistics` interface 之前加类型别名和函数：

```ts
/** fight-stats 存储用的精简 DamageEvent，剥离 id / 玩家具体目标 / 明细 */
export type StoredDamageEvent = Omit<DamageEvent, 'id' | 'targetPlayerId' | 'playerDamageDetails'>

/**
 * 将 parseDamageEvents 输出的完整 DamageEvent 精简为存储格式
 * - 丢弃 id / targetPlayerId / playerDamageDetails
 * - 从 playerDamageDetails[0] 提取 abilityId（同 packetId 的 detail 共享 abilityId）
 */
export function slimDamageEvents(full: DamageEvent[]): StoredDamageEvent[] {
  return full.map(e => ({
    name: e.name,
    time: e.time,
    damage: e.damage,
    type: e.type,
    damageType: e.damageType,
    packetId: e.packetId,
    snapshotTime: e.snapshotTime,
    abilityId: e.playerDamageDetails?.[0]?.abilityId ?? 0,
  }))
}
```

- [ ] **Step 4: 扩展 FightStatistics**

修改 `src/workers/top100Sync.ts:27-35`：

```ts
/** 单场战斗的原始统计数据 */
export interface FightStatistics {
  encounterId: number
  reportCode: string
  fightID: number
  damageByAbility: Record<number, number[]>
  maxHPByJob: Record<Job, number[]>
  shieldByAbility: Record<number, number[]>
  healByAbility: Record<number, number[]>
  /** 战斗时长（毫秒）= fight.end_time - fight.start_time */
  durationMs: number
  /** 精简 DamageEvent 列表，用于后续 encounter template 聚合 */
  damageEvents: StoredDamageEvent[]
}
```

- [ ] **Step 5: 扩展 extractFightStatistics，调 parseDamageEvents**

修改 `src/workers/top100Sync.ts` 中 `extractFightStatistics` 函数（约 296 行起）。在 "提取各类数据" 之后、写入 KV 之前，新增 parseDamageEvents 调用：

```ts
// 提取各类数据
const damageData = extractDamageData(eventsResponse.events)
const shieldData = extractShieldData(eventsResponse.events)
const maxHPData = extractMaxHPData(eventsResponse.events, report)
const healData = extractHealData(eventsResponse.events)

// 构造 playerMap 和 abilityMap 以供 parseDamageEvents 使用
const playerMap = new Map<number, { id: number; name: string; type: string }>()
for (const actor of report.friendlies ?? []) {
  playerMap.set(actor.id, { id: actor.id, name: actor.name, type: actor.type })
}
const abilityMap = new Map<number, FFLogsAbility>()
for (const ability of report.abilities ?? []) {
  abilityMap.set(ability.guid, ability)
}

// 解析完整 DamageEvent 后精简存储
const fullDamageEvents = parseDamageEvents(
  eventsResponse.events,
  fight.start_time,
  playerMap,
  abilityMap
)
const slimEvents = slimDamageEvents(fullDamageEvents)
const durationMs = fight.end_time - fight.start_time

// 保存到临时 KV
const battleStats: FightStatistics = {
  encounterId,
  reportCode,
  fightID,
  damageByAbility: damageData,
  maxHPByJob: maxHPData,
  shieldByAbility: shieldData,
  healByAbility: healData,
  durationMs,
  damageEvents: slimEvents,
}
```

- [ ] **Step 6: 运行 Step 1 的测试确认通过**

Run: `pnpm test:run top100Sync -t slimDamageEvents`
Expected: PASS (2/2)

- [ ] **Step 7: 运行完整 top100Sync 测试集，确认无 regression**

Run: `pnpm test:run top100Sync`
Expected: 所有原有用例通过，新增 2 个 slimDamageEvents 用例通过。

- [ ] **Step 8: TypeScript 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 9: Commit**

```bash
git add src/types/timeline.ts src/workers/top100Sync.ts src/workers/top100Sync.test.ts
git commit -m "feat(worker): 采集 slim DamageEvent 到 fight-stats"
```

---

## Task 3: Worker 聚合层 — Step 5.5 产出 encounter template

**Files:**

- Modify: `src/workers/top100Sync.ts`（新增 `EncounterTemplate` 类型、`getEncounterTemplateKVKey`、`buildEncounterTemplate` 纯函数、`aggregateStatistics` 中的集成）
- Modify: `src/workers/top100Sync.test.ts`（为 `buildEncounterTemplate` 写单测）

核心算法先用一个可单测的纯函数 `buildEncounterTemplate` 隔离出来，`aggregateStatistics` 内部只负责读写 KV 和调用它。

- [ ] **Step 1: 写 buildEncounterTemplate 单测**

在 `src/workers/top100Sync.test.ts` 末尾加：

```ts
import { buildEncounterTemplate, type StoredDamageEvent } from './top100Sync'

describe('buildEncounterTemplate', () => {
  // 辅助：构造一条精简事件
  function makeEvent(
    partial: Partial<StoredDamageEvent> & { abilityId: number; time: number }
  ): StoredDamageEvent {
    return {
      name: partial.name ?? `ability-${partial.abilityId}`,
      time: partial.time,
      damage: partial.damage ?? 1000,
      type: partial.type ?? 'aoe',
      damageType: partial.damageType ?? 'magical',
      abilityId: partial.abilityId,
    }
  }

  it('返回 null 当候选场为空', () => {
    const result = buildEncounterTemplate({
      candidates: [],
      p50Map: {},
      threshold: 3,
    })
    expect(result).toBeNull()
  })

  it('挑选 durationMs 最大的战斗作为模板', () => {
    const candidates = [
      {
        durationMs: 100_000,
        events: [makeEvent({ abilityId: 1, time: 5 })],
      },
      {
        durationMs: 300_000,
        events: [makeEvent({ abilityId: 1, time: 5 }), makeEvent({ abilityId: 2, time: 15 })],
      },
      {
        durationMs: 200_000,
        events: [makeEvent({ abilityId: 1, time: 5 })],
      },
    ]
    const result = buildEncounterTemplate({
      candidates,
      p50Map: { 1: 500, 2: 800 },
      threshold: 2, // ability=1 出现 3 场 OK, ability=2 只出现 1 场被过滤
    })
    expect(result?.templateSourceDurationMs).toBe(300_000)
    expect(result?.events).toHaveLength(1)
    expect(result?.events[0].abilityId).toBe(1)
  })

  it('过滤 abilityId 出现场数 < threshold 的事件', () => {
    const candidates = [
      {
        durationMs: 100,
        events: [makeEvent({ abilityId: 1, time: 1 }), makeEvent({ abilityId: 2, time: 2 })],
      },
      {
        durationMs: 200, // 最长
        events: [
          makeEvent({ abilityId: 1, time: 1 }),
          makeEvent({ abilityId: 2, time: 2 }),
          makeEvent({ abilityId: 99, time: 3 }), // 只在本场出现
        ],
      },
      {
        durationMs: 150,
        events: [makeEvent({ abilityId: 1, time: 1 }), makeEvent({ abilityId: 2, time: 2 })],
      },
    ]
    const result = buildEncounterTemplate({
      candidates,
      p50Map: {},
      threshold: 3,
    })
    // ability 1 出现 3 场 ✓, ability 2 出现 3 场 ✓, ability 99 出现 1 场 ✗
    expect(result?.events.map(e => e.abilityId).sort()).toEqual([1, 2])
  })

  it('同一场内同 abilityId 多次出现只算一场（去重）', () => {
    const candidates = [
      {
        durationMs: 200,
        events: [
          makeEvent({ abilityId: 1, time: 1 }),
          makeEvent({ abilityId: 1, time: 2 }), // 同场同 ability，算 1 场
        ],
      },
      { durationMs: 100, events: [makeEvent({ abilityId: 1, time: 1 })] },
    ]
    const result = buildEncounterTemplate({
      candidates,
      p50Map: {},
      threshold: 3,
    })
    // ability 1 只在 2 场出现（场数去重），< 3 被过滤
    expect(result?.events).toHaveLength(0)
  })

  it('damage 字段用 p50Map 覆盖，无 p50 时保留原值', () => {
    const candidates = [
      {
        durationMs: 100,
        events: [
          makeEvent({ abilityId: 1, time: 1, damage: 9999 }),
          makeEvent({ abilityId: 2, time: 2, damage: 8888 }),
        ],
      },
      {
        durationMs: 100,
        events: [
          makeEvent({ abilityId: 1, time: 1, damage: 9999 }),
          makeEvent({ abilityId: 2, time: 2, damage: 8888 }),
        ],
      },
      {
        durationMs: 100,
        events: [
          makeEvent({ abilityId: 1, time: 1, damage: 9999 }),
          makeEvent({ abilityId: 2, time: 2, damage: 8888 }),
        ],
      },
    ]
    const result = buildEncounterTemplate({
      candidates,
      p50Map: { 1: 500 }, // 只有 ability 1 有 p50
      threshold: 3,
    })
    const byId = Object.fromEntries(result!.events.map(e => [e.abilityId!, e.damage]))
    expect(byId[1]).toBe(500) // 被 p50 覆盖
    expect(byId[2]).toBe(8888) // fallback 到原值
  })

  it('每个事件带不同的 nanoid id', () => {
    const candidates = [
      {
        durationMs: 100,
        events: [makeEvent({ abilityId: 1, time: 1 }), makeEvent({ abilityId: 2, time: 2 })],
      },
      {
        durationMs: 100,
        events: [makeEvent({ abilityId: 1, time: 1 }), makeEvent({ abilityId: 2, time: 2 })],
      },
      {
        durationMs: 100,
        events: [makeEvent({ abilityId: 1, time: 1 }), makeEvent({ abilityId: 2, time: 2 })],
      },
    ]
    const result = buildEncounterTemplate({
      candidates,
      p50Map: {},
      threshold: 3,
    })
    const ids = result!.events.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length) // 所有 id 唯一
    for (const id of ids) expect(id).toMatch(/\S+/) // 非空
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run top100Sync -t buildEncounterTemplate`
Expected: FAIL — `buildEncounterTemplate is not a function`

- [ ] **Step 3: 实现 EncounterTemplate 类型 + KV 键生成器 + 纯函数**

在 `src/workers/top100Sync.ts` 顶部 import 区补 `generateId`：

```ts
import { generateId } from '@/utils/id'
```

在 `FightStatistics` interface 之后新增：

```ts
/** 副本模板数据结构（KV 存储） */
export interface EncounterTemplate {
  encounterId: number
  /** 完整 DamageEvent（带 id）。targetPlayerId / playerDamageDetails 始终为空 */
  events: DamageEvent[]
  /** 模板战斗的时长（毫秒），用于覆盖策略比较 */
  templateSourceDurationMs: number
  updatedAt: string
}

/** 获取 encounter template 的 KV 键名 */
export function getEncounterTemplateKVKey(encounterId: number): string {
  return `encounter-template:${encounterId}`
}

interface BuildEncounterTemplateInput {
  /** 本批次所有战斗的 slim 事件列表 + 时长 */
  candidates: Array<{ durationMs: number; events: StoredDamageEvent[] }>
  /** abilityId → p50 伤害数字（来自 calculatePercentiles(mergedDamage)） */
  p50Map: Record<number, number>
  /** 过滤阈值：abilityId 必须在至少多少场中出现才保留 */
  threshold: number
}

/**
 * 从本批次候选场构建 encounter template
 * - 挑 durationMs 最大的一场为模板
 * - 过滤 abilityId 出现场数 < threshold 的事件（每场去重）
 * - 用 p50Map 覆盖每个保留事件的 damage；无 p50 时保留模板原值
 * - 生成 nanoid id 填入每个事件
 *
 * 返回 null 当 candidates 为空。
 */
export function buildEncounterTemplate(
  input: BuildEncounterTemplateInput
): { events: DamageEvent[]; templateSourceDurationMs: number } | null {
  const { candidates, p50Map, threshold } = input
  if (candidates.length === 0) return null

  // 挑最长战斗
  const templateFight = candidates.reduce((max, curr) =>
    curr.durationMs > max.durationMs ? curr : max
  )

  // 统计 abilityId 出现场数（每场去重）
  const abilityFightCount = new Map<number, number>()
  for (const fight of candidates) {
    const seenIds = new Set<number>()
    for (const ev of fight.events) seenIds.add(ev.abilityId ?? 0)
    for (const id of seenIds) {
      abilityFightCount.set(id, (abilityFightCount.get(id) ?? 0) + 1)
    }
  }

  // 过滤 + 组装完整 DamageEvent
  const events: DamageEvent[] = templateFight.events
    .filter(e => (abilityFightCount.get(e.abilityId ?? 0) ?? 0) >= threshold)
    .map(e => ({
      id: generateId(),
      name: e.name,
      time: e.time,
      damage: p50Map[e.abilityId ?? 0] ?? e.damage,
      type: e.type,
      damageType: e.damageType,
      packetId: e.packetId,
      snapshotTime: e.snapshotTime,
      abilityId: e.abilityId,
    }))

  return { events, templateSourceDurationMs: templateFight.durationMs }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run top100Sync -t buildEncounterTemplate`
Expected: PASS (6/6)

- [ ] **Step 5: 集成 buildEncounterTemplate 到 aggregateStatistics**

修改 `src/workers/top100Sync.ts` 的 `aggregateStatistics` 函数：

在 Step 1（遍历 fight-stats）里，增加一个 `fightTemplateCandidates` 累积：

```ts
async function aggregateStatistics(task: StatisticsTask, kv: KVNamespace): Promise<void> {
  console.log(`[Statistics] 开始汇总数据: encounter ${task.encounterId}`)

  const batchDamage: Record<number, number[]> = {}
  const batchMaxHP: Record<string, number[]> = {}
  const batchShield: Record<number, number[]> = {}
  const batchHeal: Record<number, number[]> = {}

  // 新增：encounter template 候选
  const fightTemplateCandidates: Array<{
    durationMs: number
    events: StoredDamageEvent[]
  }> = []

  // Step 1: 读取本批次所有临时战斗数据
  for (const battle of task.fights) {
    const key = getFightStatisticsKVKey(task.encounterId, battle.reportCode, battle.fightID)
    const data = await kv.get(key, 'json')
    if (!data) continue

    const battleStats = data as FightStatistics

    for (const [abilityId, damages] of Object.entries(battleStats.damageByAbility)) {
      const id = Number(abilityId)
      if (!batchDamage[id]) batchDamage[id] = []
      batchDamage[id].push(...(damages as number[]))
    }

    for (const [abilityId, shields] of Object.entries(battleStats.shieldByAbility)) {
      const id = Number(abilityId)
      if (!batchShield[id]) batchShield[id] = []
      batchShield[id].push(...(shields as number[]))
    }

    for (const [job, hps] of Object.entries(battleStats.maxHPByJob)) {
      if (!batchMaxHP[job]) batchMaxHP[job] = []
      batchMaxHP[job].push(...(hps as number[]))
    }

    for (const [abilityId, heals] of Object.entries(battleStats.healByAbility ?? {})) {
      const id = Number(abilityId)
      if (!batchHeal[id]) batchHeal[id] = []
      batchHeal[id].push(...(heals as number[]))
    }

    // 新增：累积 template 候选
    if (
      Array.isArray(battleStats.damageEvents) &&
      battleStats.damageEvents.length > 0 &&
      typeof battleStats.durationMs === 'number' &&
      battleStats.durationMs > 0
    ) {
      fightTemplateCandidates.push({
        durationMs: battleStats.durationMs,
        events: battleStats.damageEvents,
      })
    }
  }
```

在 Step 5 产出 `statistics` 之后、Step 6 清理之前，追加 Step 5.5：

```ts
await kv.put(getStatisticsKVKey(task.encounterId), JSON.stringify(statistics), {
  expirationTtl: 25 * 60 * 60,
})

// Step 5.5: 产出 encounter template（使用覆盖策略 A：新 batch 最长 >= 旧值才写）
const p50Map = calculatePercentiles(mergedDamage)
const built = buildEncounterTemplate({
  candidates: fightTemplateCandidates,
  p50Map,
  threshold: 3,
})
if (built) {
  const templateKey = getEncounterTemplateKVKey(task.encounterId)
  const oldTemplateRaw = await kv.get(templateKey, 'json')
  const oldTemplate = oldTemplateRaw as EncounterTemplate | null
  const shouldOverwrite =
    !oldTemplate || built.templateSourceDurationMs >= oldTemplate.templateSourceDurationMs

  if (shouldOverwrite) {
    const newTemplate: EncounterTemplate = {
      encounterId: task.encounterId,
      events: built.events,
      templateSourceDurationMs: built.templateSourceDurationMs,
      updatedAt: new Date().toISOString(),
    }
    await kv.put(templateKey, JSON.stringify(newTemplate), {
      expirationTtl: 25 * 60 * 60,
    })
    console.log(
      `[Template] ${task.encounterId}: 写入模板 (${built.events.length} 事件, duration ${built.templateSourceDurationMs}ms)`
    )
  } else {
    console.log(
      `[Template] ${task.encounterId}: 跳过写入 (新 ${built.templateSourceDurationMs}ms < 旧 ${oldTemplate!.templateSourceDurationMs}ms)`
    )
  }
}

// Step 6: 清理临时数据
```

- [ ] **Step 6: Export `aggregateStatistics` 便于集成测试**

`aggregateStatistics` 目前是非 export 的。为了从测试文件里直接调用，改签名：

修改 `src/workers/top100Sync.ts`：把 `async function aggregateStatistics` 改成 `export async function aggregateStatistics`（只加 export 关键字，函数体不动）。

- [ ] **Step 7: 写覆盖策略 A 的集成测试（in-memory KV mock）**

这一步验证 `aggregateStatistics` 在 KV 层面上正确遵守"新 < 旧时不写"的策略。

在 `src/workers/top100Sync.test.ts` 末尾加（`createMockKV` 放在 describe 块外，方便后续 Task 4 复用）：

```ts
import {
  aggregateStatistics,
  getEncounterTemplateKVKey,
  getFightStatisticsKVKey,
  type EncounterTemplate,
  type FightStatistics,
  type StatisticsTask,
} from './top100Sync'

// 轻量 in-memory KV mock（只覆盖 get/put/delete）— 模块级，供后续 describes 复用
function createMockKV(): KVNamespace & { _store: Map<string, string> } {
  const store = new Map<string, string>()
  const kv = {
    _store: store,
    async get(key: string, type?: 'json' | 'text') {
      const val = store.get(key)
      if (val === undefined) return null
      return type === 'json' ? JSON.parse(val) : val
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
    // 未使用的方法，塞 no-op
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null }
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null }
    },
  } as unknown as KVNamespace & { _store: Map<string, string> }
  return kv
}

describe('aggregateStatistics — encounter template 覆盖策略 A', () => {
  const encounterId = 1234

  function makeFightStat(
    reportCode: string,
    fightID: number,
    durationMs: number,
    events: StoredDamageEvent[]
  ): FightStatistics {
    return {
      encounterId,
      reportCode,
      fightID,
      damageByAbility: events.reduce<Record<number, number[]>>((acc, e) => {
        const id = e.abilityId ?? 0
        if (!acc[id]) acc[id] = []
        acc[id].push(e.damage)
        return acc
      }, {}),
      maxHPByJob: {} as FightStatistics['maxHPByJob'],
      shieldByAbility: {},
      healByAbility: {},
      durationMs,
      damageEvents: events,
    }
  }

  function makeSlim(abilityId: number, time: number, damage = 1000): StoredDamageEvent {
    return {
      name: `ability-${abilityId}`,
      time,
      damage,
      type: 'aoe',
      damageType: 'magical',
      abilityId,
    }
  }

  async function seedAndRun(
    kv: ReturnType<typeof createMockKV>,
    fights: Array<{ reportCode: string; fightID: number; stats: FightStatistics }>
  ) {
    for (const f of fights) {
      await kv.put(
        getFightStatisticsKVKey(encounterId, f.reportCode, f.fightID),
        JSON.stringify(f.stats)
      )
    }
    const task: StatisticsTask = {
      encounterId,
      encounterName: 'test',
      totalFights: fights.length,
      fights: fights.map(f => ({ reportCode: f.reportCode, fightID: f.fightID })),
      createdAt: new Date().toISOString(),
    }
    await aggregateStatistics(task, kv)
  }

  it('无旧模板 → 写入新模板', async () => {
    const kv = createMockKV()
    const events = [makeSlim(1, 1), makeSlim(2, 2)]
    await seedAndRun(kv, [
      { reportCode: 'a', fightID: 1, stats: makeFightStat('a', 1, 100_000, events) },
      { reportCode: 'b', fightID: 1, stats: makeFightStat('b', 1, 100_000, events) },
      { reportCode: 'c', fightID: 1, stats: makeFightStat('c', 1, 100_000, events) },
    ])
    const stored = await kv.get(getEncounterTemplateKVKey(encounterId), 'json')
    const template = stored as EncounterTemplate
    expect(template).not.toBeNull()
    expect(template.templateSourceDurationMs).toBe(100_000)
    expect(template.events).toHaveLength(2)
  })

  it('新 batch 更短 → 保持旧模板不动', async () => {
    const kv = createMockKV()
    const old: EncounterTemplate = {
      encounterId,
      events: [
        {
          id: 'old-1',
          name: 'old-event',
          time: 5,
          damage: 9999,
          type: 'aoe',
          damageType: 'magical',
          abilityId: 42,
        },
      ],
      templateSourceDurationMs: 500_000,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    await kv.put(getEncounterTemplateKVKey(encounterId), JSON.stringify(old))

    const events = [makeSlim(1, 1)]
    await seedAndRun(kv, [
      { reportCode: 'a', fightID: 1, stats: makeFightStat('a', 1, 100_000, events) },
      { reportCode: 'b', fightID: 1, stats: makeFightStat('b', 1, 100_000, events) },
      { reportCode: 'c', fightID: 1, stats: makeFightStat('c', 1, 100_000, events) },
    ])

    const stored = await kv.get(getEncounterTemplateKVKey(encounterId), 'json')
    const template = stored as EncounterTemplate
    expect(template.templateSourceDurationMs).toBe(500_000)
    expect(template.events[0].id).toBe('old-1') // 未动
  })

  it('新 batch 更长 → 覆盖旧模板', async () => {
    const kv = createMockKV()
    const old: EncounterTemplate = {
      encounterId,
      events: [],
      templateSourceDurationMs: 100_000,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    await kv.put(getEncounterTemplateKVKey(encounterId), JSON.stringify(old))

    const events = [makeSlim(1, 1)]
    await seedAndRun(kv, [
      { reportCode: 'a', fightID: 1, stats: makeFightStat('a', 1, 500_000, events) },
      { reportCode: 'b', fightID: 1, stats: makeFightStat('b', 1, 500_000, events) },
      { reportCode: 'c', fightID: 1, stats: makeFightStat('c', 1, 500_000, events) },
    ])

    const stored = await kv.get(getEncounterTemplateKVKey(encounterId), 'json')
    const template = stored as EncounterTemplate
    expect(template.templateSourceDurationMs).toBe(500_000)
    expect(template.events).toHaveLength(1)
  })
})
```

- [ ] **Step 8: 运行新集成测试，确认通过**

Run: `pnpm test:run top100Sync -t "覆盖策略"`
Expected: PASS (3/3)

- [ ] **Step 9: 运行完整 top100Sync 测试，类型检查**

Run: `pnpm test:run top100Sync && pnpm exec tsc --noEmit`
Expected: 全部通过。

- [ ] **Step 10: Commit**

```bash
git add src/workers/top100Sync.ts src/workers/top100Sync.test.ts
git commit -m "feat(worker): 聚合阶段产出 encounter template"
```

---

## Task 4: Worker API 端点 `/api/encounter-templates/:id`

**Files:**

- Modify: `src/workers/top100Sync.ts`（新增 `handleGetEncounterTemplate` 函数）
- Modify: `src/workers/fflogs-proxy.ts`（挂载路由）
- Modify: `src/workers/top100Sync.test.ts`（handler 单测）

- [ ] **Step 1: 写 handler 单测**

在 `src/workers/top100Sync.test.ts` 末尾追加（复用 Task 3 定义的 `createMockKV` 和 `getEncounterTemplateKVKey`）：

```ts
import { handleGetEncounterTemplate } from './top100Sync'

describe('handleGetEncounterTemplate', () => {
  it('KV 无数据 → 返回空事件列表', async () => {
    const kv = createMockKV()
    const res = await handleGetEncounterTemplate(9999, kv)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { events: unknown[]; updatedAt: string | null }
    expect(body.events).toEqual([])
    expect(body.updatedAt).toBeNull()
  })

  it('KV 有数据 → 返回 events + updatedAt', async () => {
    const kv = createMockKV()
    const template: EncounterTemplate = {
      encounterId: 1234,
      events: [
        {
          id: 'e1',
          name: '死刑',
          time: 10,
          damage: 80000,
          type: 'tankbuster',
          damageType: 'physical',
          abilityId: 40000,
        },
      ],
      templateSourceDurationMs: 500_000,
      updatedAt: '2026-04-14T00:00:00.000Z',
    }
    await kv.put(getEncounterTemplateKVKey(1234), JSON.stringify(template))

    const res = await handleGetEncounterTemplate(1234, kv)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      events: Array<{ id: string }>
      updatedAt: string | null
    }
    expect(body.events).toHaveLength(1)
    expect(body.events[0].id).toBe('e1')
    expect(body.updatedAt).toBe('2026-04-14T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run top100Sync -t handleGetEncounterTemplate`
Expected: FAIL — `handleGetEncounterTemplate is not a function`

- [ ] **Step 3: 实现 handler**

在 `src/workers/top100Sync.ts` 末尾添加：

```ts
/**
 * GET /api/encounter-templates/:encounterId
 * 返回副本模板（含预填充伤害事件）；KV 无数据时返回空列表
 */
export async function handleGetEncounterTemplate(
  encounterId: number,
  kv: KVNamespace
): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
  }
  const data = await kv.get(getEncounterTemplateKVKey(encounterId), 'json')
  if (!data) {
    return new Response(JSON.stringify({ events: [], updatedAt: null }), { headers })
  }
  const template = data as EncounterTemplate
  return new Response(JSON.stringify({ events: template.events, updatedAt: template.updatedAt }), {
    headers,
  })
}
```

- [ ] **Step 4: 运行 handler 单测通过**

Run: `pnpm test:run top100Sync -t handleGetEncounterTemplate`
Expected: PASS (2/2)

- [ ] **Step 5: 挂载路由到 fflogs-proxy.ts**

修改 `src/workers/fflogs-proxy.ts`：在 import 区增加：

```ts
import {
  // ... 现有 imports
  handleGetEncounterTemplate,
} from './top100Sync'
```

在路由分发链（约 114 行附近，`handleStatistics` 分支之后）加入新分支：

```ts
    } else if (path.startsWith('/api/statistics/')) {
      return await handleStatistics(request, env)
    } else if (path.startsWith('/api/encounter-templates/')) {
      return await handleEncounterTemplate(request, env)
    } else {
      return jsonResponse({ error: 'Not Found' }, 404)
    }
```

在文件末尾（`handleStatistics` 之后）新增包装函数：

```ts
/**
 * GET /api/encounter-templates/:encounterId
 */
async function handleEncounterTemplate(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const encounterIdStr = url.pathname.replace('/api/encounter-templates/', '')
  const encounterId = parseInt(encounterIdStr, 10)

  if (isNaN(encounterId)) {
    return jsonResponse({ error: 'Invalid encounter ID' }, 400)
  }

  return handleGetEncounterTemplate(encounterId, env.healerbook)
}
```

- [ ] **Step 6: 类型检查 + 完整 worker 测试**

Run: `pnpm exec tsc --noEmit && pnpm test:run workers`
Expected: 全部通过。

- [ ] **Step 7: Commit**

```bash
git add src/workers/top100Sync.ts src/workers/top100Sync.test.ts src/workers/fflogs-proxy.ts
git commit -m "feat(worker): GET /api/encounter-templates/:id 路由"
```

---

## Task 5: 前端 API 客户端 + TanStack Query hook

**Files:**

- Create: `src/api/encounterTemplate.ts`
- Create: `src/hooks/useEncounterTemplate.ts`

这两个文件很小，没有单独测试。类型正确性由 tsc 保证。

- [ ] **Step 1: 新建 API 客户端**

创建 `src/api/encounterTemplate.ts`：

```ts
/**
 * Encounter Template API 客户端
 *
 * 返回副本的预填充伤害事件列表，用于新建空白时间轴时填充初始 damageEvents。
 * 后端无数据时返回 { events: [], updatedAt: null }，前端无需特殊处理。
 */

import { apiClient } from './apiClient'
import type { DamageEvent } from '@/types/timeline'

export interface EncounterTemplateResponse {
  events: DamageEvent[]
  updatedAt: string | null
}

export async function fetchEncounterTemplate(
  encounterId: number
): Promise<EncounterTemplateResponse> {
  return apiClient.get(`encounter-templates/${encounterId}`).json<EncounterTemplateResponse>()
}
```

注意：`apiClient` 的 `prefixUrl` 已经是 `/api`，所以路径不写前导 `api/`。

- [ ] **Step 2: 新建 Query hook**

创建 `src/hooks/useEncounterTemplate.ts`：

```ts
/**
 * useEncounterTemplate — 获取指定副本的预填充伤害事件模板
 *
 * 缓存策略：staleTime 1 小时（后端数据由每日 cron 生成，变化频率低）
 */

import { useQuery } from '@tanstack/react-query'
import { fetchEncounterTemplate } from '@/api/encounterTemplate'

export function useEncounterTemplate(encounterId: number) {
  return useQuery({
    queryKey: ['encounter-template', encounterId],
    queryFn: () => fetchEncounterTemplate(encounterId),
    staleTime: 1000 * 60 * 60,
    enabled: encounterId > 0,
  })
}
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/api/encounterTemplate.ts src/hooks/useEncounterTemplate.ts
git commit -m "feat(frontend): encounter template API 客户端和 query hook"
```

---

## Task 6: `createNewTimeline` 签名扩展

**Files:**

- Modify: `src/utils/timelineStorage.ts:137-163`
- Modify: `src/utils/timelineStorage.test.ts`

- [ ] **Step 1: 写新参数的单测**

在 `src/utils/timelineStorage.test.ts` 的合适 describe 块里加：

```ts
import type { DamageEvent } from '@/types/timeline'

describe('createNewTimeline — initialDamageEvents', () => {
  it('未传第三参数时 damageEvents 为空数组', () => {
    const timeline = createNewTimeline('1234', 'test')
    expect(timeline.damageEvents).toEqual([])
  })

  it('传入事件数组时 damageEvents 被填充', () => {
    const events: DamageEvent[] = [
      {
        id: 'e1',
        name: '死刑',
        time: 10,
        damage: 80000,
        type: 'tankbuster',
        damageType: 'physical',
      },
    ]
    const timeline = createNewTimeline('1234', 'test', events)
    expect(timeline.damageEvents).toHaveLength(1)
    expect(timeline.damageEvents[0].id).toBe('e1')
  })

  it('浅 copy 防御：修改传入数组不影响新时间轴', () => {
    const events: DamageEvent[] = [
      {
        id: 'e1',
        name: '死刑',
        time: 10,
        damage: 80000,
        type: 'tankbuster',
        damageType: 'physical',
      },
    ]
    const timeline = createNewTimeline('1234', 'test', events)
    events.push({
      id: 'e2',
      name: 'extra',
      time: 20,
      damage: 1000,
      type: 'aoe',
      damageType: 'magical',
    })
    expect(timeline.damageEvents).toHaveLength(1)
  })
})
```

如果 `createNewTimeline` 已有 `import` 也无需重复。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run timelineStorage -t "createNewTimeline — initialDamageEvents"`
Expected: 第 2、3 个用例 FAIL（传入事件数组 → damageEvents 仍是空）

- [ ] **Step 3: 扩展函数签名**

修改 `src/utils/timelineStorage.ts:137-163`：

```ts
export function createNewTimeline(
  encounterId: string,
  name: string,
  initialDamageEvents?: DamageEvent[]
): Timeline {
  const now = Math.floor(Date.now() / 1000)
  const encounterIdNum = parseInt(encounterId) || 0
  const staticEncounter = getEncounterById(encounterIdNum)

  return {
    id: generateId(),
    name,
    encounter: {
      id: encounterIdNum,
      name: name,
      displayName: name,
      zone: '',
      damageEvents: [],
    },
    gameZoneId: staticEncounter?.gameZoneId,
    damageEvents: initialDamageEvents ? [...initialDamageEvents] : [],
    castEvents: [],
    statusEvents: [],
    annotations: [],
    composition: {
      players: [],
    },
    createdAt: now,
    updatedAt: now,
  }
}
```

顶部 import 区确认已有 `import type { DamageEvent } from '@/types/timeline'`；若无则加上（timelineStorage.ts 可能已经从 `@/types/timeline` 引入 `Timeline`，在同一行补 `DamageEvent`）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run timelineStorage -t "createNewTimeline — initialDamageEvents"`
Expected: PASS (3/3)

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `pnpm test:run timelineStorage && pnpm exec tsc --noEmit`
Expected: 所有用例通过。

- [ ] **Step 6: Commit**

```bash
git add src/utils/timelineStorage.ts src/utils/timelineStorage.test.ts
git commit -m "feat(frontend): createNewTimeline 支持 initialDamageEvents 参数"
```

---

## Task 7: `CreateTimelineDialog` 改造 — prefetch + submit 取 cache

**Files:**

- Modify: `src/components/CreateTimelineDialog.tsx`

- [ ] **Step 1: 完整重写 CreateTimelineDialog**

用下面的版本完整替换 `src/components/CreateTimelineDialog.tsx`：

```tsx
/**
 * 创建时间轴对话框
 *
 * 打开或切换副本时预取 encounter template；submit 时从 query cache 同步取数据
 * 并作为初始 damageEvents 传给 createNewTimeline。取不到数据就静默退化为空白时间轴。
 */

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { TIMELINE_NAME_MAX_LENGTH } from '@/constants/limits'
import { toast } from 'sonner'
import { createNewTimeline, saveTimeline } from '@/utils/timelineStorage'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RAID_TIERS } from '@/data/raidEncounters'
import { track } from '@/utils/analytics'
import { fetchEncounterTemplate, type EncounterTemplateResponse } from '@/api/encounterTemplate'

interface CreateTimelineDialogProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

export default function CreateTimelineDialog({
  open,
  onClose,
  onCreated,
}: CreateTimelineDialogProps) {
  const [name, setName] = useState('')
  const [encounterId, setEncounterId] = useState(RAID_TIERS[0]?.encounters[0]?.id.toString() || '')
  const queryClient = useQueryClient()

  // 对话框打开或副本切换时预取模板
  useEffect(() => {
    if (!open) return
    const encounterIdNum = parseInt(encounterId)
    if (encounterIdNum > 0) {
      queryClient.prefetchQuery({
        queryKey: ['encounter-template', encounterIdNum],
        queryFn: () => fetchEncounterTemplate(encounterIdNum),
        staleTime: 1000 * 60 * 60,
      })
    }
  }, [open, encounterId, queryClient])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('请输入时间轴名称')
      return
    }

    const encounterIdNum = parseInt(encounterId)
    const cached = queryClient.getQueryData<EncounterTemplateResponse>([
      'encounter-template',
      encounterIdNum,
    ])
    const initialEvents = cached?.events

    const timeline = createNewTimeline(encounterId, name.trim(), initialEvents)
    saveTimeline(timeline)
    track('timeline-create', { method: 'manual', encounterId: encounterIdNum })
    onCreated()
    window.open(`/timeline/${timeline.id}`, '_blank')
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>新建时间轴</ModalTitle>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              时间轴名称 <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={TIMELINE_NAME_MAX_LENGTH}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
              autoFocus
              autoComplete="off"
              data-1p-ignore
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">副本</label>
            <Select value={encounterId} onValueChange={setEncounterId}>
              <SelectTrigger>
                <SelectValue placeholder="选择副本" />
              </SelectTrigger>
              <SelectContent>
                {RAID_TIERS.map(tier => (
                  <SelectGroup key={tier.zone}>
                    <SelectLabel>
                      {tier.name} ({tier.patch})
                    </SelectLabel>
                    {tier.encounters.map(encounter => (
                      <SelectItem key={encounter.id} value={encounter.id.toString()}>
                        {encounter.shortName} - {encounter.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ModalFooter>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-md hover:bg-accent transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              创建
            </button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: 无错误。

- [ ] **Step 4: 手动 UI 回归**

启动开发服务器（如用户未已启动）：

Run: `pnpm dev`

在浏览器打开主页：

1. 点击"新建时间轴"按钮打开对话框
2. 切换下拉选择不同副本——观察网络面板应该看到 `GET /api/encounter-templates/:id` 请求被发起
3. 输入名称、选副本、点"创建"
4. 进入编辑器，观察 `damageEvents` 轨道上是否有预填充事件（如果对应副本 KV 里已经有数据）
5. 对一个 KV 里没有模板数据的副本重复上述步骤——编辑器应该正常打开为空时间轴，无 toast 报错

（如果 KV 里暂时没有数据，可以在 `wrangler dev` 终端手动 `wrangler kv:key put --binding healerbook encounter-template:<id> '{"encounterId":<id>,"events":[...],"templateSourceDurationMs":500000,"updatedAt":"2026-04-14T00:00:00.000Z"}'` 造一条）

- [ ] **Step 5: Commit**

```bash
git add src/components/CreateTimelineDialog.tsx
git commit -m "feat(frontend): 新建时间轴对话框预取并填充模板事件"
```

---

## Task 8: valibot abilityId strip 回归测试

**Files:**

- Modify: `src/workers/timelines.test.ts`

验证发布含 `abilityId` 的 timeline 时，valibot v1 `v.object` 的默认行为把该字段 strip 掉，D1 落地的是干净 DamageEvent。如果 valibot 实际行为不是 strip（而是保留或拒绝），这个测试会红灯并指示实现改动。

- [ ] **Step 1: 查找 timelines.test.ts 中测试 DamageEvent parse 的位置**

Run: `pnpm exec rg -n 'damageEvents.*abilityId|TimelineSchema|v\.parse.*Timeline' src/workers/timelines.test.ts`

根据结果把新测试加到合适的 describe 块附近（通常是发布/创建时间轴的 describe）。

- [ ] **Step 2: 写回归测试**

在 `src/workers/timelines.test.ts` 合适位置新增：

```ts
import * as v from 'valibot'

describe('TimelineSchema — abilityId strip 回归', () => {
  it('parse 时 DamageEvent.abilityId 应被自动忽略（不写入 D1）', async () => {
    // 构造含 abilityId 的 timeline payload（复用现有的 validTimeline / mockTimeline 辅助）
    const payload = {
      ...mockTimeline,
      damageEvents: [
        {
          id: 'e1',
          name: '死刑',
          time: 10,
          damage: 80000,
          type: 'tankbuster',
          damageType: 'physical',
          abilityId: 40000, // 未在 schema 中声明
        },
      ],
    }

    const parsed = v.parse(TimelineSchema, payload)
    const eventOut = parsed.damageEvents[0] as Record<string, unknown>
    expect(eventOut.id).toBe('e1')
    expect(eventOut.abilityId).toBeUndefined()
  })
})
```

**注意**：`mockTimeline` / `TimelineSchema` 的实际名称按现有 test 文件 + `timelineSchema.ts` export 来适配。若测试文件没有 import `TimelineSchema`，需补 `import { TimelineSchema } from './timelineSchema'`。

- [ ] **Step 3: 运行测试**

Run: `pnpm test:run timelines -t "abilityId strip"`
Expected A（valibot v1 默认行为符合预期）: PASS

如果 FAIL，说明 valibot v1 实际行为不是"silent strip"。可能结果：

- **a. parse 拒绝 unknown key**：测试会抛 ValiError。修复方案——把 `TimelineSchema` 里的相关 `v.object` 换成 `v.looseObject`（允许 unknown）并在 handler 里手动把 abilityId 剥掉；或更优：不用 abilityId 走持久化链路，前端 `createNewTimeline` 时手动 strip 每个事件的 abilityId 再塞进 timeline.damageEvents。
- **b. parse 保留 unknown key**：eventOut.abilityId === 40000，测试会 FAIL。修复方案——`v.strictObject` 拒绝，`v.object` 一般 strip；若确实保留，则在 handler 的 parse 后手动删 abilityId。

无论哪种结果，把修复落到代码里，再次运行测试直到 PASS。如果需要修改 `src/components/CreateTimelineDialog.tsx` 或其他文件以适配，一并完成。

- [ ] **Step 4: 全量 worker 测试**

Run: `pnpm test:run workers`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/workers/timelines.test.ts
# 如果修复过程中改了其他文件，也一并 add
git commit -m "test(worker): 回归 DamageEvent.abilityId 在 TimelineSchema parse 时被 strip"
```

---

## Final Verification

在所有 8 个 task 完成后，执行一次完整的发布前检查。

- [ ] **Step 1: 全量类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 2: 全量 Lint**

Run: `pnpm lint`
Expected: 无错误。

- [ ] **Step 3: 全量测试**

Run: `pnpm test:run`
Expected: 所有测试通过。

- [ ] **Step 4: 前端构建**

Run: `pnpm build`
Expected: 构建成功，无警告。

- [ ] **Step 5: 手动端到端验证**

见 Task 7 Step 4 的手动回归清单。对至少一个 KV 里有模板数据的副本和一个没有数据的副本各跑一次创建流程，确认行为一致。
