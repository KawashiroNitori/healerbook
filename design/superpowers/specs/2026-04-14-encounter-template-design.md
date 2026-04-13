# Encounter Template（副本模板）预填充伤害事件 — 设计文档

**日期**：2026-04-14
**状态**：Draft

## 背景与目标

`CreateTimelineDialog` 现在创建的是完全空白的时间轴。用户在没有 FFLogs 记录可导入的情况下，必须从零手动添加伤害事件。目标：在"新建时间轴"对话框里选好副本后，创建出的时间轴自动预填充一组代表性的 boss 伤害事件。

数据来源：复用现有 TOP100 采样管线。每个副本每天随机抽 10 场 TOP100 战斗跑统计；我们在同一流程末尾额外聚合产出一套 "encounter template"，缓存到 KV，前端按 encounterId 拉取。

## 核心决策（grill 阶段确认）

1. **采集寄生于现有管线**：扩展 `extractFightStatistics` / `aggregateStatistics`，不新开 cron / 队列。FFLogs events 只拉一次。
2. **聚合用"模板法"，不用跨场对齐**：从本批次 10 场里挑 `durationMs` 最大的一场作为"模板战斗"，其 `DamageEvent[]` 即为候选结构。彻底回避"机制顺序不固定"的跨场对齐难题。
3. **事件过滤阈值 = 3**：模板战斗里的事件，只有当其 `abilityId` 在本批次 ≥ 3 场中出现过，才保留。剔除"某场机制处理失败补刀"这类一次性事件。
4. **伤害数字用 `damageByAbility` p50 覆盖**：复用现有 reservoir sampling + `calculatePercentiles`。接受系统性偏低（每玩家中位数 vs `selectRepresentativeDamage` 的目标职业组最高值）——用户可在 UI 手动调整。
5. **字段裁剪**：预填充事件丢 `targetPlayerId` / `playerDamageDetails`，保留 `type`（aoe/tankbuster）/ `damageType`。tankbuster 缺目标由用户事后指定。
6. **覆盖策略 A（整体锁定 + 不降级）**：每次 aggregation 读旧 template 的 `templateSourceDurationMs`，本批次最长 ≥ 旧值才写入；否则 template 完全不动。
7. **id 生成**：aggregation 阶段用 `generateId()` (nanoid) 给每个模板事件赋 id，存进 KV，前端原样用。不改 schema / 不做 runtime hydration。
8. **`abilityId` 字段走 TS 类型 + 自动 strip**：`DamageEvent` 加 optional `abilityId?: number`（仅采集/聚合链路用）。`TimelineSchema` 不改——valibot v1 的 `v.object` 默认忽略未声明字段，发布时间轴时自动被剥掉，D1 里落地的是干净 DamageEvent。需要 regression 测试保证这个行为。
9. **前端触发**：对话框打开时 `queryClient.prefetchQuery` 预热；下拉切换副本时重新 prefetch；submit 时从 cache 同步取数据，失败/空值静默退化为空白时间轴。
10. **无 UI 开关、无 UX 反馈**：预填充永远开启，对话框不显示"将填充 N 个事件"之类信息。

## 架构总览

```
[Cron daily]
    │
    ▼
syncAllTop100 ── syncEncounter ── 随机抽 10 场 ── 推 queue
                                                     │
                                                     ▼
                                      extractFightStatistics（每场一次）
                                      ├─ 现有：damageByAbility/shield/maxHP/heal
                                      └─ 新增：durationMs + damageEvents[]
                                                     │
                                                     ▼
                                 aggregateStatistics（所有场完成后）
                                 ├─ Step 1-5: 现有 statistics 产出
                                 └─ Step 5.5 (新): 产出 encounter-template
                                                     │
                                                     ▼
                                         KV: encounter-template:{id}

[GET /api/encounter-templates/:id]
    │
    ▼
handleGetEncounterTemplate ── KV 读取 ── { events, updatedAt }
                                              │
                                              ▼
                                    [前端 CreateTimelineDialog]
                                    prefetch → getQueryData → createNewTimeline(events)
```

## Worker 侧详细设计

### 类型扩展

**`types/timeline.ts`** — `DamageEvent` 加一个 optional 字段：

```ts
export interface DamageEvent {
  id: string
  name: string
  time: number
  damage: number
  type: DamageEventType
  damageType: DamageType
  targetPlayerId?: number
  playerDamageDetails?: PlayerDamageDetail[]
  packetId?: number
  snapshotTime?: number
  abilityId?: number // 新增：仅采集/聚合阶段使用
}
```

**`workers/top100Sync.ts` 内部** — 不新建 interface，用 local type alias：

```ts
type StoredDamageEvent = Omit<DamageEvent, 'id' | 'targetPlayerId' | 'playerDamageDetails'>

export interface FightStatistics {
  encounterId: number
  reportCode: string
  fightID: number
  damageByAbility: Record<number, number[]>
  maxHPByJob: Record<Job, number[]>
  shieldByAbility: Record<number, number[]>
  healByAbility: Record<number, number[]>
  // 新增
  durationMs: number
  damageEvents: StoredDamageEvent[]
}

export interface EncounterTemplate {
  encounterId: number
  events: DamageEvent[] // 完整 DamageEvent（带 id），但 targetPlayerId / playerDamageDetails 始终为空
  templateSourceDurationMs: number
  updatedAt: string
}
```

KV 键：`encounter-template:${encounterId}`，TTL 25 小时（每天 cron 续期，与 statistics 一致）。

### `extractFightStatistics` 扩展

在现有实现末尾（Step 提取各类数据后）追加：

```ts
// 构造 playerMap
const playerMap = new Map<number, { id: number; name: string; type: string }>()
for (const actor of report.friendlies ?? []) {
  playerMap.set(actor.id, { id: actor.id, name: actor.name, type: actor.type })
}

// 构造 abilityMap
const abilityMap = new Map<number, FFLogsAbility>()
for (const ability of report.abilities ?? []) {
  abilityMap.set(ability.guid, ability)
}

// 调 parseDamageEvents 得到完整 DamageEvent[]
const fullEvents = parseDamageEvents(eventsResponse.events, fight.start_time, playerMap, abilityMap)

// Slim 化
const slimEvents: StoredDamageEvent[] = fullEvents.map(e => ({
  name: e.name,
  time: e.time,
  damage: e.damage,
  type: e.type,
  damageType: e.damageType,
  packetId: e.packetId,
  snapshotTime: e.snapshotTime,
  abilityId: e.playerDamageDetails?.[0]?.abilityId ?? 0,
}))

const durationMs = fight.end_time - fight.start_time

// 写入 FightStatistics
const battleStats: FightStatistics = {
  // ... 现有字段
  durationMs,
  damageEvents: slimEvents,
}
```

**注意**：`parseDamageEvents` 依赖 `@ff14-overlay/resources/generated/actionChinese.json` / `mitigationActions` / `statusRegistry` 等前端常量。这些已经可以在 worker 打包（现有 `top100Sync.ts` 已引用 `@/data/raidEncounters` 等）。bundle size 会增加几百 KB，在 CF Workers 1MB 限制内。

### `aggregateStatistics` 扩展 — Step 5.5

在 Step 1 遍历 fight-stats 时额外收集：

```ts
const fightTemplateCandidates: Array<{
  durationMs: number
  events: StoredDamageEvent[]
}> = []

for (const battle of task.fights) {
  const key = getFightStatisticsKVKey(task.encounterId, battle.reportCode, battle.fightID)
  const data = (await kv.get(key, 'json')) as FightStatistics | null
  if (!data) continue

  // ... 现有的 damage/shield/maxHP/heal 收集

  if (data.damageEvents && data.damageEvents.length > 0 && data.durationMs > 0) {
    fightTemplateCandidates.push({
      durationMs: data.durationMs,
      events: data.damageEvents,
    })
  }
}
```

Step 5 产出 `statistics` 之后，追加 Step 5.5：

```ts
// Step 5.5: 产出 encounter template
if (fightTemplateCandidates.length > 0) {
  // a. 挑最长战斗作为模板
  const templateFight = fightTemplateCandidates.reduce((max, curr) =>
    curr.durationMs > max.durationMs ? curr : max
  )

  // b. 读旧 template，应用覆盖策略 A
  const oldTemplateRaw = await kv.get(`encounter-template:${task.encounterId}`, 'json')
  const oldTemplate = oldTemplateRaw as EncounterTemplate | null

  const shouldOverwrite =
    !oldTemplate || templateFight.durationMs >= oldTemplate.templateSourceDurationMs

  if (shouldOverwrite) {
    // c. 统计 abilityId 出现场数（每场去重）
    const abilityFightCount = new Map<number, number>()
    for (const fight of fightTemplateCandidates) {
      const seenIds = new Set<number>()
      for (const ev of fight.events) {
        seenIds.add(ev.abilityId)
      }
      for (const id of seenIds) {
        abilityFightCount.set(id, (abilityFightCount.get(id) ?? 0) + 1)
      }
    }

    // d. 过滤模板事件（阈值 3）
    const filtered = templateFight.events.filter(
      e => (abilityFightCount.get(e.abilityId) ?? 0) >= 3
    )

    // e. 计算 p50Map 并覆盖 damage
    const p50Map = calculatePercentiles(mergedDamage) // Step 3 之后已经有 mergedDamage
    const templateEvents: DamageEvent[] = filtered.map(e => ({
      id: generateId(),
      name: e.name,
      time: e.time,
      damage: p50Map[e.abilityId] ?? e.damage,
      type: e.type,
      damageType: e.damageType,
      packetId: e.packetId,
      snapshotTime: e.snapshotTime,
      abilityId: e.abilityId,
    }))

    // f. 写入 KV
    const newTemplate: EncounterTemplate = {
      encounterId: task.encounterId,
      events: templateEvents,
      templateSourceDurationMs: templateFight.durationMs,
      updatedAt: new Date().toISOString(),
    }
    await kv.put(`encounter-template:${task.encounterId}`, JSON.stringify(newTemplate), {
      expirationTtl: 25 * 60 * 60,
    })
  }
  // 否则：完全不动，连 updatedAt 都不更新
}
```

### API 端点

**`src/workers/fflogs-proxy.ts`** 顶层路由器挂载：

```ts
// GET /api/encounter-templates/:encounterId
if (method === 'GET' && path.startsWith('/api/encounter-templates/')) {
  const encounterId = Number(path.slice('/api/encounter-templates/'.length))
  if (!Number.isFinite(encounterId)) return new Response('Bad encounter id', { status: 400 })
  return handleGetEncounterTemplate(encounterId, env.KV)
}
```

**处理函数**（新文件 `src/workers/encounterTemplate.ts`，或并入 `top100Sync.ts`）：

```ts
export async function handleGetEncounterTemplate(
  encounterId: number,
  kv: KVNamespace
): Promise<Response> {
  const data = await kv.get(`encounter-template:${encounterId}`, 'json')
  if (!data) {
    return Response.json(
      { events: [], updatedAt: null },
      { headers: { 'Cache-Control': 'public, max-age=3600' } }
    )
  }
  const template = data as EncounterTemplate
  return Response.json(
    { events: template.events, updatedAt: template.updatedAt },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
```

## 前端侧详细设计

### API 客户端

**新文件 `src/api/encounterTemplate.ts`**：

```ts
import { apiClient } from './apiClient'
import type { DamageEvent } from '@/types/timeline'

export interface EncounterTemplateResponse {
  events: DamageEvent[]
  updatedAt: string | null
}

export async function fetchEncounterTemplate(
  encounterId: number
): Promise<EncounterTemplateResponse> {
  return apiClient.get(`api/encounter-templates/${encounterId}`).json()
}
```

### TanStack Query hook

**新文件 `src/hooks/useEncounterTemplate.ts`**：

```ts
import { useQuery } from '@tanstack/react-query'
import { fetchEncounterTemplate } from '@/api/encounterTemplate'

export function useEncounterTemplate(encounterId: number) {
  return useQuery({
    queryKey: ['encounter-template', encounterId],
    queryFn: () => fetchEncounterTemplate(encounterId),
    staleTime: 1000 * 60 * 60, // 1 小时
    enabled: encounterId > 0,
  })
}
```

### `createNewTimeline` 签名扩展

**`src/utils/timelineStorage.ts`**：

```ts
export function createNewTimeline(
  encounterId: string,
  name: string,
  initialDamageEvents?: DamageEvent[]
): Timeline {
  // ... 原逻辑
  return {
    // ...
    damageEvents: initialDamageEvents ? [...initialDamageEvents] : [],
    // ...
  }
}
```

浅 copy 防御：`[...initialDamageEvents]`，避免 query cache 数据被后续编辑突变。

### `CreateTimelineDialog` 改造

- `open` 变 true 或 `encounterId` 变化时，`queryClient.prefetchQuery(['encounter-template', encounterIdNum], fetchEncounterTemplate, { staleTime: 1h })`
- `handleSubmit` 里用 `queryClient.getQueryData<EncounterTemplateResponse>(['encounter-template', encounterIdNum])` 同步取缓存
- 取到就传给 `createNewTimeline`，没取到就传 `undefined`（等同于无预填充）
- 不显示任何 loading / count 指示——静默

## 测试策略

**Worker 测试**（`src/workers/`）：

1. `top100Sync.test.ts` 扩展：
   - `extractFightStatistics` 产出包含 `damageEvents` / `durationMs`
   - `aggregateStatistics` Step 5.5 覆盖策略 A：
     - 无旧 template → 写入
     - 新 batch 更短 → 不写（KV 值不变）
     - 新 batch ≥ 旧值 → 覆盖
     - abilityId 出现 < 3 场的事件被过滤
     - abilityId 出现 ≥ 3 场的事件被保留
     - 每个事件带不同 nanoid id
     - `p50Map` 覆盖 damage 字段，无 p50 时保留模板原值
   - `fightTemplateCandidates` 为空时跳过

2. `encounterTemplate.test.ts`（或并入 `fflogs-proxy.test.ts`）：
   - KV 有数据 → 返回 `{ events, updatedAt }`
   - KV 无数据 → 返回 `{ events: [], updatedAt: null }`

3. `timelines.test.ts` 回归：
   - 发布含 `abilityId` 字段的 DamageEvent → `v.parse(TimelineSchema, payload)` 输出不含 `abilityId`（验证 valibot v1 `v.object` 默认 strip 行为）
   - 若实测为 reject 或保留，实现阶段切换到其他 valibot API 或手动 strip

**前端测试**：

4. `timelineStorage.test.ts` 扩展：
   - `createNewTimeline(id, name, events)` 第三参传入数组 → 新时间轴 `damageEvents` 被填充
   - 不传第三参 → `damageEvents: []`
   - 浅 copy 防御：修改传入数组不影响新时间轴

组件层（`CreateTimelineDialog`）无现有测试，跳过，保持项目惯例。

## 实现顺序（建议 commit 划分）

1. **Commit 1**：`types/timeline.ts` 加 `abilityId?: number`
2. **Commit 2**：Worker 采集层——`FightStatistics` 扩展；`extractFightStatistics` 调用 `parseDamageEvents` 并 slim 化；test 更新
3. **Commit 3**：Worker 聚合层——Step 5.5；`EncounterTemplate` 类型；覆盖策略测试
4. **Commit 4**：Worker API 端点——路由 + handler + test
5. **Commit 5**：前端 API 客户端 + query hook
6. **Commit 6**：`createNewTimeline` 签名扩展 + 单测
7. **Commit 7**：`CreateTimelineDialog` prefetch + submit 改造
8. **Commit 8**：`timelines.test.ts` 的 `abilityId` strip 回归测试

## 已知限制

1. **晚期 phase 事件可能缺失**：10 场随机采样 + 阈值 3，当 TOP100 快通关占比高时，只有最慢通关能见到的事件会因样本数不足被过滤。用户需导入真实 logs 或手动补齐。
2. **伤害数字偏低**：`damageByAbility` p50 ≠ `selectRepresentativeDamage`，aoe 事件的数字会系统性偏低于真实"最需被减伤"职业的承伤。后续可切到 p75 调整。
3. **tankbuster 缺目标**：预填充事件无 `targetPlayerId`，用户加入小队后需手动指定。
4. **首次采样前预填充为空**：副本刚被 cron 触及时 template 尚未生成，前端静默退化为空白时间轴。

## 非目标

- 不做 encounter template 的实时热更新（跟随 cron）
- 不扩展 template 包含 composition / phases / 其他字段（YAGNI）
- 不重构 `DamageEvent.id` 生命周期（用 nanoid 直接生成）
- 不加 UI 开关 / 反馈
- 不做 method='template' analytics 埋点（所有空白时间轴都预填充，无 A/B 价值）
