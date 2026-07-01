# 伤害事件读条时间基准与卡片化渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `DamageEvent` 增加成对的读条开始/结束时间基准，并把伤害事件渲染成"宽度=读条窗口、判定时刻用菱形标记"的卡片。

**Architecture:** 数据模型新增 `castStartTime`/`castEndTime`（秒，both-or-neither）。导入侧用一个隔离后处理函数从 boss 的 `begincast`/`cast` 配对推导读条窗口。渲染侧保持 Konva Group 原点 = 判定时间不变，靠 Rect 负向局部 x 向左延伸成可变宽卡片，判定菱形固定在局部 0。

**Tech Stack:** React 19 + TypeScript 5.9、React-Konva、Vitest 4、Valibot（服务端校验）、Yjs（协同）。

**Spec:** `design/superpowers/specs/2026-06-30-damage-event-cast-window-design.md`

## Global Constraints

- 包管理器必须用 **pnpm**；测试用 **Vitest**（`pnpm test:run <pattern>` 单模块、`pnpm test:run` 全量）。
- 提交信息、作者、Co-Authored-By **禁止**出现 "claude" 字样（`.husky/commit-msg` 会拒绝）。
- 命名用 `action` 不用 `skill`。
- 状态更新走不可变模式。
- 类型检查 `pnpm exec tsc --noEmit`；`pnpm lint` 在声称完成前必跑。
- 所有读条时间字段单位为**秒**，与 `time`/`snapshotTime` 一致；导入侧换算复用 `Math.round((ms - fightStartTime) / 10) / 100`。
- `castStartTime`/`castEndTime` 永远**成对**写入或成对缺失（both-or-neither）。

---

## File Structure

- `src/types/timeline.ts` — `DamageEvent` 加两字段。
- `src/types/timelineV2.ts` — `V2DamageEvent` 加短键 `cs`/`ce`。
- `src/utils/timelineFormat.ts` — `toV2DamageEvent` / `fromV2DamageEvent` 透传（`migrateV1DamageEvent` 不动，V1 无读条概念）。
- `src/workers/timelineSchema.ts` — `V2DamageEventSchema` 加 `cs`/`ce`。
- `src/utils/castWindow.ts`（新建）— `extractBossCasts` / `buildCastPairs` / `attachCastWindows` 纯函数。
- `src/utils/fflogsImporter.ts` — `parseDamageEvents` 加可选参数并在流水线调用；`parseFightImport` 抽 `extractBossCasts` 传入。
- `src/components/Timeline/cardGeometry.ts`（新建）— `computeDamageCardGeometry` 纯几何函数。
- `src/components/Timeline/constants.ts` — 加 `MIN_CARD_WIDTH` 常量。
- `src/components/Timeline/DamageEventCard.tsx` — 可变宽 Rect + 菱形 + 文字重定位 + 菱形拖拽。
- `src/components/Timeline/DamageEventTrack.tsx` — 视口裁剪改用实际左缘+宽度。
- `src/components/Timeline/index.tsx` — 泳道占用区间改算法；`handleEventDragEnd`/`bulkMoveSelection` 平移读条时间。
- `src/components/AddEventDialog.tsx` — 读条开始 + 时长输入。

---

## Task 1: 数据模型与序列化 — 新增 castStartTime/castEndTime

**Files:**

- Modify: `src/types/timeline.ts:218-223`（在 `DamageEvent` 末尾加字段）
- Modify: `src/types/timelineV2.ts:73-74`（`V2DamageEvent` 加 `cs`/`ce`）
- Modify: `src/utils/timelineFormat.ts:119-121`（`toV2DamageEvent`）、`:271-273`（`fromV2DamageEvent`）
- Modify: `src/workers/timelineSchema.ts:44-45`（`V2DamageEventSchema`）
- Test: `src/utils/timelineFormat.test.ts`

**Interfaces:**

- Produces: `DamageEvent.castStartTime?: number`、`DamageEvent.castEndTime?: number`（秒）；`V2DamageEvent.cs?: number`、`V2DamageEvent.ce?: number`。

- [ ] **Step 1: 写失败测试**（roundtrip 保留 cs/ce，且未设置时不写键）

在 `src/utils/timelineFormat.test.ts` 末尾加（若文件已 import `toV2DamageEvent`/`fromV2DamageEvent` 则复用；否则用对外的 `serializeTimelineV2`/`deserializeTimelineV2` 同款现有测试模式 —— 先查文件里现有伤害事件 roundtrip 测试，照抄其结构，仅断言新增字段）：

```ts
import { describe, it, expect } from 'vitest'
import type { DamageEvent } from '@/types/timeline'

describe('castWindow 序列化', () => {
  it('toV2/fromV2 保留 castStartTime/castEndTime', () => {
    const ev: DamageEvent = {
      id: 'x',
      name: 'A',
      time: 10,
      damage: 1000,
      type: 'aoe',
      damageType: 'magical',
      castStartTime: 5.5,
      castEndTime: 9.7,
    }
    // 用文件内现有的 roundtrip 辅助；若现有测试直接调 toV2DamageEvent，需先 export 它。
    // 这里假设通过整条 timeline 序列化往返：
    const v2 = roundtripDamageEvent(ev) // 见 Step 3：在测试内联实现或复用现有 helper
    expect(v2.castStartTime).toBe(5.5)
    expect(v2.castEndTime).toBe(9.7)
  })

  it('未设置读条时不产生 cs/ce 键', () => {
    const ev: DamageEvent = {
      id: 'y',
      name: 'B',
      time: 3,
      damage: 50,
      type: 'auto',
      damageType: 'physical',
    }
    const back = roundtripDamageEvent(ev)
    expect(back.castStartTime).toBeUndefined()
    expect(back.castEndTime).toBeUndefined()
  })
})
```

> 实现者注：先 `grep -n "toV2DamageEvent\|damageEvent" src/utils/timelineFormat.test.ts` 看现有伤害事件 roundtrip 怎么写。优先复用现有"整条 timeline serialize→deserialize"路径作为 `roundtripDamageEvent`，避免 export 私有函数。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run timelineFormat`
Expected: FAIL（`castStartTime` 为 undefined / 类型不存在）。

- [ ] **Step 3: 类型 + 序列化实现**

`src/types/timeline.ts` 在 `damageSource?` 之后、`}` 之前加：

```ts
  /** 读条开始时间（秒）。与 castEndTime 成对存在；无读条时两者皆 undefined。 */
  castStartTime?: number
  /** 读条结束时间（秒）。与 castStartTime 成对存在。 */
  castEndTime?: number
```

`src/types/timelineV2.ts` 在 `ds?: string` 之后、`}` 之前加：

```ts
  /** castStartTime（读条开始，秒） */
  cs?: number
  /** castEndTime（读条结束，秒） */
  ce?: number
```

`src/utils/timelineFormat.ts` `toV2DamageEvent`，在 `if (e.damageSource) out.ds = e.damageSource` 之后加：

```ts
if (e.castStartTime !== undefined && e.castEndTime !== undefined) {
  out.cs = e.castStartTime
  out.ce = e.castEndTime
}
```

`fromV2DamageEvent`，在 `if (e.ds !== undefined) out.damageSource = e.ds` 之后加：

```ts
if (e.cs !== undefined && e.ce !== undefined) {
  out.castStartTime = e.cs
  out.castEndTime = e.ce
}
```

`src/workers/timelineSchema.ts` `V2DamageEventSchema`，在 `pdd: v.optional(...)` 之后加：

```ts
  cs: v.optional(v.number()),
  ce: v.optional(v.number()),
```

> `migrateV1DamageEvent` 不改：V1 时间轴从无读条概念。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run timelineFormat`
Expected: PASS。

- [ ] **Step 5: 类型检查 + 提交**

```bash
pnpm exec tsc --noEmit
git add src/types/timeline.ts src/types/timelineV2.ts src/utils/timelineFormat.ts src/workers/timelineSchema.ts src/utils/timelineFormat.test.ts
git commit -m "feat(damage-casting): DamageEvent 新增成对的 castStartTime/castEndTime 及序列化"
```

---

## Task 2: 导入侧读条窗口匹配

**Files:**

- Create: `src/utils/castWindow.ts`
- Create: `src/utils/castWindow.test.ts`
- Modify: `src/utils/fflogsImporter.ts:219-230`（`parseDamageEvents` 加参数）、`:513-515`（流水线调用）、`:978-987`（`parseFightImport` 抽取并传入）

**Interfaces:**

- Consumes: `DamageEvent`（Task 1）、`FFLogsEvent`（`src/types/fflogs.ts`）。
- Produces:
  - `extractBossCasts(events: FFLogsEvent[], playerMap: Map<number, {id:number;name:string;type:string}>): FFLogsEvent[]`
  - `attachCastWindows(damageEvents: DamageEvent[], bossCasts: FFLogsEvent[], fightStartTime: number): void`（原地写入）
  - `parseDamageEvents(..., bossCasts?: FFLogsEvent[])` 末位新增可选参数。

- [ ] **Step 1: 写失败测试**

Create `src/utils/castWindow.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { extractBossCasts, attachCastWindows } from './castWindow'
import type { FFLogsEvent } from '@/types/fflogs'
import type { DamageEvent } from '@/types/timeline'

const FS = 1000 // fightStartTime ms
const players = new Map([[24, { id: 24, name: 'P', type: 'WAR' }]])

function bc(
  type: 'begincast' | 'cast',
  src: number,
  id: number,
  tsMs: number,
  duration?: number
): FFLogsEvent {
  return {
    type,
    sourceID: src,
    targetID: src,
    abilityGameID: id,
    timestamp: tsMs,
    ...(duration ? { duration } : {}),
  }
}
function dmg(name: string, abilityId: number, tdMs: number): DamageEvent {
  return {
    id: name,
    name,
    time: (tdMs - FS) / 1000,
    damage: 1,
    type: 'aoe',
    damageType: 'magical',
    playerDamageDetails: [
      {
        timestamp: tdMs,
        playerId: 24,
        job: 'WAR',
        abilityId,
        unmitigatedDamage: 1,
        finalDamage: 1,
        statuses: [],
      },
    ],
  }
}

describe('extractBossCasts', () => {
  it('排除玩家施法，只留 boss begincast/cast', () => {
    const events = [bc('cast', 24, 999, 2000), bc('begincast', 50, 47877, 2100, 4700)]
    const out = extractBossCasts(events, players)
    expect(out).toHaveLength(1)
    expect(out[0].abilityGameID).toBe(47877)
  })
})

describe('attachCastWindows', () => {
  it('正常成对 → 写 castStartTime/castEndTime（秒）', () => {
    const boss = [bc('begincast', 50, 47877, 1500, 4700), bc('cast', 50, 47877, 6500)]
    const evs = [dmg('hit', 47877, 6600)]
    attachCastWindows(evs, boss, FS)
    expect(evs[0].castStartTime).toBe(0.5)
    expect(evs[0].castEndTime).toBe(5.5)
  })

  it('中断（仅 begincast 无 cast）→ 不写', () => {
    const boss = [bc('begincast', 50, 50718, 1500, 9700)]
    const evs = [dmg('hit', 50718, 12000)]
    attachCastWindows(evs, boss, FS)
    expect(evs[0].castStartTime).toBeUndefined()
    expect(evs[0].castEndTime).toBeUndefined()
  })

  it('瞬发（仅 cast 无 begincast）→ 不写', () => {
    const boss = [bc('cast', 50, 30000, 5000)]
    const evs = [dmg('hit', 30000, 5100)]
    attachCastWindows(evs, boss, FS)
    expect(evs[0].castStartTime).toBeUndefined()
  })

  it('中断悬挂 begincast 被之后瞬发 cast 误消费 → duration 校验丢弃', () => {
    // begincast@2s duration=9700，cast 出现在 +30s，远超 9700*1.5+1000 → 不配对
    const boss = [bc('begincast', 50, 70000, 2000, 9700), bc('cast', 50, 70000, 32000)]
    const evs = [dmg('hit', 70000, 32100)]
    attachCastWindows(evs, boss, FS)
    expect(evs[0].castStartTime).toBeUndefined()
  })

  it('多 boss 同技能并发 → 按 sourceID 分流，各自成对', () => {
    const boss = [
      bc('begincast', 50, 80000, 1000, 3000),
      bc('begincast', 51, 80000, 1200, 3000),
      bc('cast', 50, 80000, 4000),
      bc('cast', 51, 80000, 4200),
    ]
    const e1 = dmg('a', 80000, 4100) // 命中 source50 那对 [1000,4000]
    const e2 = dmg('b', 80000, 4300) // 命中 source51 那对 [1200,4200]
    attachCastWindows([e1, e2], boss, FS)
    expect(e1.castEndTime).toBe(3.0) // (4000-1000)/1000
    expect(e2.castEndTime).toBe(3.2) // (4200-1000)/1000
  })

  it('伤害技能 id ≠ 读条 id → 查不到，不写', () => {
    const boss = [bc('begincast', 50, 11111, 1000, 2000), bc('cast', 50, 11111, 3000)]
    const evs = [dmg('hit', 22222, 3100)]
    attachCastWindows(evs, boss, FS)
    expect(evs[0].castStartTime).toBeUndefined()
  })

  it('手动事件（无 playerDamageDetails）→ 跳过', () => {
    const boss = [bc('begincast', 50, 33333, 1000, 2000), bc('cast', 50, 33333, 3000)]
    const manual: DamageEvent = {
      id: 'm',
      name: 'M',
      time: 2,
      damage: 1,
      type: 'aoe',
      damageType: 'magical',
    }
    attachCastWindows([manual], boss, FS)
    expect(manual.castStartTime).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run castWindow`
Expected: FAIL（`./castWindow` 模块不存在）。

- [ ] **Step 3: 实现 castWindow.ts**

Create `src/utils/castWindow.ts`：

```ts
import type { FFLogsEvent } from '@/types/fflogs'
import type { DamageEvent } from '@/types/timeline'

type PlayerMap = Map<number, { id: number; name: string; type: string }>

/** 提取 boss/NPC 的 begincast/cast（排除玩家施法），保持原事件顺序（FFLogs 已时间升序）。 */
export function extractBossCasts(events: FFLogsEvent[], playerMap: PlayerMap): FFLogsEvent[] {
  const out: FFLogsEvent[] = []
  for (const ev of events) {
    if (ev.type !== 'begincast' && ev.type !== 'cast') continue
    if (!ev.abilityGameID) continue
    if (ev.sourceID != null && playerMap.has(ev.sourceID)) continue
    out.push(ev)
  }
  return out
}

interface CastPair {
  startMs: number
  endMs: number
}

/** 按 (sourceID, abilityGameID) 分流配对 begincast→cast；含 duration 合理性校验。 */
function buildCastPairs(bossCasts: FFLogsEvent[]): Map<number, CastPair[]> {
  const pairs = new Map<number, CastPair[]>()
  const pending = new Map<string, { startMs: number; durationMs: number }>()
  for (const ev of bossCasts) {
    const id = ev.abilityGameID!
    const pk = `${ev.sourceID ?? 0}:${id}`
    if (ev.type === 'begincast') {
      pending.set(pk, { startMs: ev.timestamp, durationMs: ev.duration ?? 0 })
    } else {
      const begin = pending.get(pk)
      if (begin === undefined) continue // 瞬发：无 pending
      pending.delete(pk)
      // 中断悬挂的 begincast 被之后瞬发 cast 误消费时，窗口会远超预期读条时长 → 丢弃
      if (begin.durationMs && ev.timestamp - begin.startMs > begin.durationMs * 1.5 + 1000) continue
      let arr = pairs.get(id)
      if (!arr) pairs.set(id, (arr = []))
      arr.push({ startMs: begin.startMs, endMs: ev.timestamp })
    }
  }
  for (const arr of pairs.values()) arr.sort((a, b) => a.endMs - b.endMs)
  return pairs
}

/** 给每个伤害事件回填读条窗口（原地，成对写入）。 */
export function attachCastWindows(
  damageEvents: DamageEvent[],
  bossCasts: FFLogsEvent[],
  fightStartTime: number
): void {
  const pairs = buildCastPairs(bossCasts)
  const toSec = (ms: number) => Math.round((ms - fightStartTime) / 10) / 100
  for (const ev of damageEvents) {
    const details = ev.playerDamageDetails
    if (!details || details.length === 0) continue
    let td = Infinity
    let abilityId = 0
    for (const d of details) {
      if (d.timestamp < td) {
        td = d.timestamp
        abilityId = d.abilityId ?? 0
      }
    }
    const list = pairs.get(abilityId)
    if (!list) continue
    let hit: CastPair | null = null
    for (let k = list.length - 1; k >= 0; k--) {
      if (list[k].endMs <= td) {
        hit = list[k]
        break
      }
    }
    if (!hit) continue
    ev.castStartTime = toSec(hit.startMs)
    ev.castEndTime = toSec(hit.endMs)
  }
}
```

> 注：`PlayerDamageDetail.abilityId` / `timestamp` 字段见 `src/types/timeline.ts`（`timestamp` 为毫秒）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run castWindow`
Expected: PASS（全部 8 个用例）。

- [ ] **Step 5: 接线到导入流水线**

`src/utils/fflogsImporter.ts`：

1. 顶部 import：`import { extractBossCasts, attachCastWindows } from './castWindow'`
2. `parseDamageEvents` 签名末尾加参数（在 `targetability?` 之后）：

```ts
  targetability?: TargetabilityIntervals,
  bossCasts?: FFLogsEvent[]
): DamageEvent[] {
```

3. 在流水线 `shiftPartialFinalAoeTime(damageEvents)`（`:515`）之后、`return damageEvents` 之前加：

```ts
if (bossCasts) attachCastWindows(damageEvents, bossCasts, fightStartTime)
```

4. `parseFightImport`（`:978`）在 `const damageEvents = parseDamageEvents(` 之前加：

```ts
const bossCasts = extractBossCasts(events, playerMap)
```

并把 `bossCasts` 作为末位实参传给 `parseDamageEvents(...)`：

```ts
const damageEvents = parseDamageEvents(
  events,
  fightStartTime,
  playerMap,
  abilityMap,
  composition,
  bossIds,
  enemyNames,
  targetability,
  bossCasts
)
```

- [ ] **Step 6: 回归 + 类型 + lint + 提交**

```bash
pnpm test:run fflogsImporter
pnpm exec tsc --noEmit && pnpm lint
git add src/utils/castWindow.ts src/utils/castWindow.test.ts src/utils/fflogsImporter.ts
git commit -m "feat(damage-casting): 导入时从 boss 读条配对推导伤害事件读条窗口"
```

Expected: `fflogsImporter` 测试全绿（无回归），tsc/lint 通过。

---

## Task 3: 卡片几何纯函数 + MIN_CARD_WIDTH 常量

**Files:**

- Create: `src/components/Timeline/cardGeometry.ts`
- Create: `src/components/Timeline/cardGeometry.test.ts`
- Modify: `src/components/Timeline/constants.ts`（加 `MIN_CARD_WIDTH`）

**Interfaces:**

- Consumes: `DamageEvent`（Task 1）。
- Produces:
  - `MIN_CARD_WIDTH = 150`（`constants.ts`）
  - `computeDamageCardGeometry(event: DamageEvent, zoomLevel: number): { leftLocal: number; width: number; rawLeftSec: number; rawRightSec: number }`
    - `leftLocal`：Rect 相对 group 原点（=判定时间）的局部 x（像素，≤0 表示向左延伸）。
    - `width`：卡片像素宽（已应用最小宽度）。
    - `rawLeftSec`/`rawRightSec`：占用区间（秒），供泳道/裁剪复用。

- [ ] **Step 1: 写失败测试**

Create `src/components/Timeline/cardGeometry.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { computeDamageCardGeometry } from './cardGeometry'
import { MIN_CARD_WIDTH } from './constants'
import type { DamageEvent } from '@/types/timeline'

const base: DamageEvent = {
  id: 'x',
  name: 'A',
  time: 10,
  damage: 1,
  type: 'aoe',
  damageType: 'magical',
}
const Z = 50 // 像素/秒

describe('computeDamageCardGeometry', () => {
  it('无读条 → 左缘=判定时间，宽=最小宽', () => {
    const g = computeDamageCardGeometry(base, Z)
    expect(g.leftLocal).toBe(0)
    expect(g.width).toBe(MIN_CARD_WIDTH)
    expect(g.rawLeftSec).toBe(10)
    expect(g.rawRightSec).toBe(10)
  })

  it('读条窗口宽于最小宽 → 按窗口宽，左缘负向延伸', () => {
    const ev = { ...base, castStartTime: 4, castEndTime: 10 } // 6s*50=300px
    const g = computeDamageCardGeometry(ev, Z)
    expect(g.leftLocal).toBe((4 - 10) * Z) // -300
    expect(g.width).toBe(300)
    expect(g.rawLeftSec).toBe(4)
    expect(g.rawRightSec).toBe(10)
  })

  it('读条窗口窄于最小宽 → 撑到最小宽，左缘仍在窗口左', () => {
    const ev = { ...base, castStartTime: 9.5, castEndTime: 10 } // 0.5s*50=25px < 150
    const g = computeDamageCardGeometry(ev, Z)
    expect(g.leftLocal).toBe((9.5 - 10) * Z) // -25
    expect(g.width).toBe(MIN_CARD_WIDTH)
  })

  it('判定时间晚于读条结束 → 区间含判定点，卡片撑大', () => {
    const ev = { ...base, castStartTime: 4, castEndTime: 8, time: 10 }
    const g = computeDamageCardGeometry(ev, Z)
    expect(g.rawLeftSec).toBe(4)
    expect(g.rawRightSec).toBe(10) // max(castEnd=8, time=10)
    expect(g.leftLocal).toBe((4 - 10) * Z)
    expect(g.width).toBe((10 - 4) * Z) // 300
  })

  it('判定点恒在卡片内：local 0 落于 [leftLocal, leftLocal+width]', () => {
    const ev = { ...base, castStartTime: 9.9, castEndTime: 9.95 }
    const g = computeDamageCardGeometry(ev, Z)
    expect(0).toBeGreaterThanOrEqual(g.leftLocal)
    expect(0).toBeLessThanOrEqual(g.leftLocal + g.width)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run cardGeometry`
Expected: FAIL（模块/常量不存在）。

- [ ] **Step 3: 实现常量 + 几何函数**

`src/components/Timeline/constants.ts` 末尾加：

```ts
/** 伤害事件卡片最小宽度（px）。无读条 / 读条极短时兜底，保证文字可读。 */
export const MIN_CARD_WIDTH = 150
```

Create `src/components/Timeline/cardGeometry.ts`：

```ts
import type { DamageEvent } from '@/types/timeline'
import { MIN_CARD_WIDTH } from './constants'

export interface DamageCardGeometry {
  /** Rect 相对 group 原点（=判定时间 time）的局部 x，px，≤0 表示向左延伸 */
  leftLocal: number
  /** 卡片像素宽（已应用最小宽度） */
  width: number
  /** 占用区间左端（秒），供泳道/裁剪复用 */
  rawLeftSec: number
  /** 占用区间右端（秒） */
  rawRightSec: number
}

export function computeDamageCardGeometry(
  event: DamageEvent,
  zoomLevel: number
): DamageCardGeometry {
  const { time, castStartTime, castEndTime } = event
  const hasCast = castStartTime != null && castEndTime != null
  const rawLeftSec = hasCast ? Math.min(castStartTime, time) : time
  const rawRightSec = hasCast ? Math.max(castEndTime, time) : time
  const leftLocal = (rawLeftSec - time) * zoomLevel
  const width = Math.max((rawRightSec - rawLeftSec) * zoomLevel, MIN_CARD_WIDTH)
  return { leftLocal, width, rawLeftSec, rawRightSec }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run cardGeometry`
Expected: PASS（全部 5 个用例）。

- [ ] **Step 5: 提交**

```bash
pnpm exec tsc --noEmit
git add src/components/Timeline/cardGeometry.ts src/components/Timeline/cardGeometry.test.ts src/components/Timeline/constants.ts
git commit -m "feat(damage-casting): 卡片几何纯函数与 MIN_CARD_WIDTH 常量"
```

---

## Task 4: DamageEventCard 可变宽卡片 + 判定菱形

**Files:**

- Modify: `src/components/Timeline/DamageEventCard.tsx`

**Interfaces:**

- Consumes: `computeDamageCardGeometry`、`MIN_CARD_WIDTH`（Task 3）。
- Produces: 渲染层改动，无新导出。

> Konva 渲染无法做单元测试，本任务以 `tsc`/`lint` + dev server 目视验证为准。

- [ ] **Step 1: 用几何函数替换固定 150 宽**

`DamageEventCard.tsx` 顶部 import：

```ts
import { Group, Rect, Text, RegularPolygon } from 'react-konva'
import { computeDamageCardGeometry } from './cardGeometry'
```

在 `const x = event.time * zoomLevel + dragOffsetX`（`:70`）之后加：

```ts
const geom = computeDamageCardGeometry(event, zoomLevel)
```

把 `:121` 的 `const nameAreaWidth = 150 - 5 - damageTextWidth` 改为基于实际宽：

```ts
const nameAreaWidth = geom.width - 5 - damageTextWidth
```

- [ ] **Step 2: 背景 Rect 改用 leftLocal + width**

把 `:166-179` 的 `<Rect>` 的 `x={0} width={150}` 改为：

```tsx
      <Rect
        x={geom.leftLocal}
        y={-15}
        width={geom.width}
        height={30}
        ...其余属性不变
      />
```

- [ ] **Step 3: 文字/emoji 整体平移 leftLocal**

- 技能名 `<Text>`（`:182`）：`x={nameXOffset}` → `x={geom.leftLocal + nameXOffset}`。
- 死亡 emoji（`:200`）、致死警示（`:214`）、危险警示（`:230`）三处 `x={3}` → `x={geom.leftLocal + 3}`。
- 伤害数值 `<Text>`（`:247`）：`x={150 - damageTextWidth}` → `x={geom.leftLocal + geom.width - damageTextWidth}`。

- [ ] **Step 4: 在 Group 内末尾加判定菱形**

在伤害数值 `<Text>` 之后、`</Group>` 之前加（`cardBottom = 15`，即卡片下沿 y）：

```tsx
{
  /* 伤害判定菱形：局部 x=0（=判定时间），骑在卡片下沿 */
}
;<RegularPolygon
  x={0}
  y={15}
  sides={4}
  radius={6}
  rotation={0}
  fill="#ef4444"
  stroke={isSelected ? '#3b82f6' : colors.cardBg}
  strokeWidth={isSelected ? 2 : 1}
  shadowEnabled={false}
  perfectDrawEnabled={false}
  listening={false}
/>
```

> `sides={4}` + `radius` 默认即菱形朝向（顶点朝上下左右）。`listening={false}` 暂不接收事件，拖拽在 Task 5 开启。

- [ ] **Step 5: 类型检查 + 目视验证**

```bash
pnpm exec tsc --noEmit && pnpm lint
```

dev server（用户已启动）目视确认：

1. 无读条事件卡片外观与改动前一致（左缘在判定时间，宽 150），下沿出现红色菱形。
2. 导入一场含读条 boss 技能的副本，对应卡片宽度横跨读条窗口，菱形在判定时刻处。
3. tankbuster/auto 卡片、选中蓝边、技能名/伤害数值位置正常。

- [ ] **Step 6: 提交**

```bash
git add src/components/Timeline/DamageEventCard.tsx
git commit -m "feat(damage-casting): 伤害卡片可变宽渲染与判定菱形"
```

---

## Task 5: 拖拽 — 卡片整体平移读条时间 + 单选拖菱形仅移判定

**Files:**

- Modify: `src/components/Timeline/index.tsx:1050-1066`（`handleEventDragEnd`）
- Modify: `src/store/timelineStore.ts`（`bulkMoveSelection` —— 先 grep 定位）
- Modify: `src/components/Timeline/DamageEventCard.tsx`（菱形 draggable）

**Interfaces:**

- Consumes: `updateDamageEvent`、`bulkMoveSelection`（store）。
- Produces: 无新导出。

> 交互无法单元测试，以 `tsc`/`lint` + 目视验证为准。

- [ ] **Step 1: 卡片本体拖动同步平移读条时间**

`index.tsx` `handleEventDragEnd`（`:1061`）单选分支，把：

```ts
s.updateDamageEvent(eventId, { time: newTime })
```

改为（按 delta 同步平移成对读条时间）：

```ts
const cur = timeline?.damageEvents.find(e => e.id === eventId)
const patch: { time: number; castStartTime?: number; castEndTime?: number } = { time: newTime }
if (cur?.castStartTime != null && cur?.castEndTime != null) {
  const delta = newTime - cur.time
  patch.castStartTime = cur.castStartTime + delta
  patch.castEndTime = cur.castEndTime + delta
}
s.updateDamageEvent(eventId, patch)
```

- [ ] **Step 2: 多选整体平移同步读条时间**

先定位实现：`grep -n "bulkMoveSelection" src/store/timelineStore.ts`。该函数对每个选中伤害事件做 `time += delta`。在同一处，对每个事件若 `castStartTime != null && castEndTime != null`，同样 `castStartTime += delta`、`castEndTime += delta`（保持不可变更新模式，与现有 `time` 平移写法并列）。

> 实现者注：读现有 `bulkMoveSelection` 里伤害事件 time 平移的确切写法，照其不可变模式追加两字段；勿改 cast/annotation 分支。

- [ ] **Step 3: 菱形改为单选可拖**

`DamageEventCard.tsx`：新增一个判断"是否单选且仅选中本事件"。组件已知 `isSelected`，但需知道"选中总数是否为 1"。从 `useTimelineStore` 读取选中计数（与文件现有 store 读取方式一致；若组件未订阅 store，加最小订阅）：

```ts
import { useTimelineStore } from '@/store/timelineStore'
// 组件内：
const soleSelected = useTimelineStore(
  s =>
    s.selectedEventIds.length === 1 &&
    s.selectedCastEventIds.length === 0 &&
    s.selectedAnnotationIds.length === 0
)
const diamondDraggable = isSelected && soleSelected && !isReadOnly
```

把 Task 4 的菱形 `listening={false}` 改为可拖：

```tsx
<RegularPolygon
  x={0}
  y={15}
  sides={4}
  radius={6}
  fill="#ef4444"
  stroke={diamondDraggable ? '#3b82f6' : colors.cardBg}
  strokeWidth={diamondDraggable ? 2 : 1}
  draggable={diamondDraggable}
  dragBoundFunc={pos => {
    // 锁 y 到卡片下沿绝对坐标，仅放开 x
    const stage = undefined // 用 group 绝对 y：见下方说明
    return { x: pos.x, y: groupAbsBottomY }
  }}
  onDragStart={e => {
    e.cancelBubble = true
  }}
  onDragMove={e => {
    e.cancelBubble = true
    const newTime = (x + e.target.x()) / zoomLevel // x=group 局部原点像素，e.target.x()=菱形相对 group 的局部 x
    reportDamageDrag?.(event.id, newTime * zoomLevel)
  }}
  onDragEnd={e => {
    e.cancelBubble = true
    const newTime = Math.max(
      TIMELINE_START_TIME,
      Math.round(((x + e.target.x()) / zoomLevel) * 10) / 10
    )
    onDiamondDragEnd?.(event.id, newTime)
    e.target.x(0) // 复位局部 x，commit 后 group 原点重定位
  }}
  shadowEnabled={false}
  perfectDrawEnabled={false}
/>
```

> 关键细节（实现者必须落实）：
>
> 1. `dragBoundFunc` 需要卡片下沿的**绝对** y。Konva 的 `dragBoundFunc` 用绝对坐标。简化方案：菱形不靠 dragBoundFunc 锁 y，而是 `onDragMove` 里 `e.target.y(15)` 强制回写局部 y（菱形是 group 子节点，局部 y 恒为 15），只接受新的局部 x。用这个更简单、无需绝对坐标换算。
> 2. `e.cancelBubble = true` 阻止冒泡到卡片 Group 的拖拽，确保拖菱形不触发整体平移。
> 3. 新增两个 props：`reportDamageDrag?: (eventId: string, x: number) => void` 与 `onDiamondDragEnd?: (eventId: string, newTime: number) => void`，由 `DamageEventTrack` 透传、`index.tsx` 提供（`onDiamondDragEnd` 内 `updateDamageEvent(eventId, { time: newTime })`，**只改 time**）。

修正后的 onDragMove/onDragEnd 用局部 y 回写：

```tsx
        onDragMove={e => {
          e.cancelBubble = true
          e.target.y(15) // 锁回卡片下沿
          const newTime = (x + e.target.x()) / zoomLevel
          reportDamageDrag?.(event.id, newTime * zoomLevel)
          e.target.getStage()?.batchDraw()
        }}
        onDragEnd={e => {
          e.cancelBubble = true
          const newTime = Math.max(TIMELINE_START_TIME, Math.round(((x + e.target.x()) / zoomLevel) * 10) / 10)
          onDiamondDragEnd?.(event.id, newTime)
          e.target.position({ x: 0, y: 15 })
        }}
```

- [ ] **Step 4: 透传新 props 并在 index.tsx 接线**

- `DamageEventCard` props 接口加 `reportDamageDrag?` 与 `onDiamondDragEnd?`。
- `DamageEventTrack.tsx` 在渲染 `<DamageEventCard>`（`:208`）处透传这两个回调（新增对应 props 到 `DamageEventTrackProps` 并从 `index.tsx` 传入）。
- `index.tsx` 挂载 `<DamageEventTrack>`（`:1861`）处提供：
  - `reportDamageDrag`：复用已存在的 `reportDamageDrag`（`:1069`）。
  - `onDiamondDragEnd`：新建 `const handleDiamondDragEnd = (id: string, newTime: number) => { if (isReadOnly) return; useTimelineStore.getState().updateDamageEvent(id, { time: newTime }); useTimelineStore.getState().setLocalDragging(null); setDraggingEventPosition(null) }`。

> `TIMELINE_START_TIME` 已在 `DamageEventCard` 可用？若未 import 则从 `./constants` 引入。

- [ ] **Step 5: 类型检查 + 目视验证**

```bash
pnpm exec tsc --noEmit && pnpm lint
```

目视确认：

1. 单选一个伤害事件 → 菱形描边变蓝、可单独拖动；拖动只改判定时间，读条窗口不动；判定移出读条窗口时卡片向该侧撑大。
2. 拖卡片本体 → 整张卡片（含读条窗口）整体平移，判定与读条相对关系不变。
3. 多选（≥2）→ 菱形不可拖（描边非蓝）；拖任一卡片本体 → 选中项整体等距平移，各自读条窗口同步平移。
4. 拖菱形时红色判定虚线实时跟随。

- [ ] **Step 6: 提交**

```bash
git add src/components/Timeline/index.tsx src/store/timelineStore.ts src/components/Timeline/DamageEventCard.tsx src/components/Timeline/DamageEventTrack.tsx
git commit -m "feat(damage-casting): 卡片整体平移读条时间，单选拖菱形仅移判定"
```

---

## Task 6: 视口裁剪与泳道占用区间适配可变宽

**Files:**

- Modify: `src/components/Timeline/DamageEventTrack.tsx:190-198`（视口裁剪）
- Modify: `src/components/Timeline/index.tsx:386-414`（泳道算法）

**Interfaces:**

- Consumes: `computeDamageCardGeometry`（Task 3）。

> 以 `tsc`/`lint` + 目视验证为准。

- [ ] **Step 1: 泳道占用区间改用几何函数**

`index.tsx` import `computeDamageCardGeometry`。把 `layoutData`（`:386`）泳道段（`:390-414`）改为：

- 删除 `const CARD_WIDTH_SECONDS = 150 / zoomLevel`。
- 排序键与占用计算改用每事件 `geom`：

```ts
const sortedDamageEvents = [...filteredDamageEvents]
  .map(event => ({ event, geom: computeDamageCardGeometry(event, zoomLevel) }))
  .sort((a, b) => a.geom.rawLeftSec - b.geom.rawLeftSec)
for (const { event, geom } of sortedDamageEvents) {
  const leftSec = geom.rawLeftSec
  const rightSec = geom.rawLeftSec + geom.width / zoomLevel
  const laneIndex = laneEndTimes.findIndex(endTime => endTime <= leftSec)
  if (laneIndex !== -1) {
    damageEventRowMap.set(event.id, laneIndex)
    laneEndTimes[laneIndex] = rightSec
  } else {
    damageEventRowMap.set(event.id, laneEndTimes.length)
    laneEndTimes.push(rightSec)
  }
}
```

> 折叠模式分支（`isDamageTrackCollapsed`）不变。

- [ ] **Step 2: 视口裁剪改用实际左缘+宽度**

`DamageEventTrack.tsx` import `computeDamageCardGeometry`。把伤害卡片渲染前的裁剪（`:190-198`）改为：

```ts
      {[...events]
        .filter(event => {
          if (peerDraggingIds?.has(event.id)) return false
          const geom = computeDamageCardGeometry(event, zoomLevel)
          const groupX = event.time * zoomLevel + (selectedEventIds.includes(event.id) ? groupDragDelta : 0)
          const leftX = groupX + geom.leftLocal
          return leftX + geom.width >= visibleMinX && leftX <= visibleMaxX
        })
```

> 排序与 `.map(...)` 渲染部分不变；只改 `.filter`。

- [ ] **Step 3: 类型检查 + 目视验证**

```bash
pnpm exec tsc --noEmit && pnpm lint
```

目视确认：

1. 多个读条窗口重叠的伤害事件分配到不同泳道，无视觉重叠、无多余空泳道。
2. 横向滚动到长读条卡片边缘时不被提前裁掉（左缘进入视口即渲染）。

- [ ] **Step 4: 提交**

```bash
git add src/components/Timeline/index.tsx src/components/Timeline/DamageEventTrack.tsx
git commit -m "feat(damage-casting): 视口裁剪与泳道占用区间适配可变宽卡片"
```

---

## Task 7: AddEventDialog 读条输入

**Files:**

- Modify: `src/components/AddEventDialog.tsx`

**Interfaces:**

- Consumes: `addDamageEvent`（store）。

> 以 `tsc`/`lint` + 目视验证为准。

- [ ] **Step 1: 加读条开始 + 时长两个可选输入**

先读 `AddEventDialog.tsx` 现有结构（`grep -n "snapshotTime\|isDot\|addDamageEvent\|useState" src/components/AddEventDialog.tsx`），照其受控输入/状态模式新增两个状态：

```ts
const [castStartInput, setCastStartInput] = useState('')
const [castDurationInput, setCastDurationInput] = useState('')
```

在 DOT/snapshot 输入附近加两个数字输入框（中文 label「读条开始时间(秒)」「读条时长(秒)」），样式复用现有输入框组件。

- [ ] **Step 2: 提交时 both-or-neither 组装**

在构造 `addDamageEvent({...})`（`:51-59` 附近）处，加：

```ts
const castStart = parseFloat(castStartInput)
const castDuration = parseFloat(castDurationInput)
const hasCast = Number.isFinite(castStart) && Number.isFinite(castDuration) && castDuration > 0
```

并在传给 `addDamageEvent` 的对象里成对加入：

```ts
  ...(hasCast && { castStartTime: castStart, castEndTime: castStart + castDuration }),
```

- [ ] **Step 3: 类型检查 + 目视验证**

```bash
pnpm exec tsc --noEmit && pnpm lint
```

目视确认：

1. 留空读条两输入 → 新增事件为无读条卡片（最小宽，左缘=判定）。
2. 填开始=5、时长=3 → 新增事件卡片横跨 [5s, 8s]，菱形在判定时间处。
3. 只填一个 → 视为无读条（不写字段）。

- [ ] **Step 4: 提交**

```bash
git add src/components/AddEventDialog.tsx
git commit -m "feat(damage-casting): 手动添加伤害事件支持读条开始+时长输入"
```

---

## Task 8: 全量回归

- [ ] **Step 1: 全量测试 + 类型 + lint + 构建**

```bash
pnpm test:run
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

Expected: 全绿。重点关注 `fflogsImporter`、`timelineFormat`、`timelineSchema`、`castWindow`、`cardGeometry`。

- [ ] **Step 2: 服务端 schema 回归**

```bash
pnpm test:workers
```

Expected: `timelineSchema` / `fflogsImportHandler` 通过（确认 `cs`/`ce` 不破坏服务端导入与校验）。

- [ ] **Step 3: 提交（如有未提交的回归修复）**

```bash
git add -A
git commit -m "test(damage-casting): 读条窗口功能全量回归"
```

---

## Task 9: PropertyPanel 读条时间编辑（补充）

**背景**：初版 plan 覆盖了 AddEventDialog（新增事件），漏了选中事件的属性面板 `PropertyPanel.tsx` —— 无法编辑既有事件的读条时间。本任务补上，镜像该文件已有的「DOT 快照」开关块（`Switch` + `TimeInput`）。

**Files:**

- Modify: `src/components/PropertyPanel.tsx`（在「DOT 快照设置」块 `~:590-617` 附近新增「读条」块）

**Interfaces:**

- Consumes: `updateDamageEvent`（store）、`TimeInput`（`@/components/ui/time-input`）、`Switch`；`DamageEvent.castStartTime/castEndTime`。

- [ ] **Step 1: 新增「读条」开关块（both-or-neither）**

在 DOT 快照块之后（`isReadOnly` 一致传入）加一个结构与 DOT 块同构的区块：

```tsx
{
  /* 读条窗口设置 */
}
;<div className="flex items-center gap-2 h-8">
  <Switch
    checked={event.castStartTime != null && event.castEndTime != null}
    onCheckedChange={checked => {
      if (checked) {
        // 开启默认：零宽窗口，起止都取判定时间，用户再编辑时长
        updateDamageEvent(event.id, { castStartTime: event.time, castEndTime: event.time })
      } else {
        updateDamageEvent(event.id, { castStartTime: undefined, castEndTime: undefined })
      }
    }}
    disabled={isReadOnly}
  />
  <span className="text-xs text-muted-foreground shrink-0">读条</span>
  {event.castStartTime != null && event.castEndTime != null && (
    <>
      <span className="text-xs text-muted-foreground shrink-0 ml-auto">开始</span>
      <TimeInput
        value={event.castStartTime}
        onChange={v =>
          updateDamageEvent(event.id, {
            castStartTime: v,
            // 保持时长不变：结束随开始平移
            castEndTime: v + (event.castEndTime! - event.castStartTime!),
          })
        }
        size="sm"
        disabled={isReadOnly}
        className="w-[72px]"
      />
      <span className="text-xs text-muted-foreground shrink-0">时长</span>
      <TimeInput
        value={Math.round((event.castEndTime - event.castStartTime) * 100) / 100}
        onChange={v =>
          updateDamageEvent(event.id, {
            castEndTime: event.castStartTime! + Math.max(0, v),
          })
        }
        min={0}
        size="sm"
        disabled={isReadOnly}
        className="w-[72px]"
      />
    </>
  )}
</div>
```

> 要点：both-or-neither —— 开关只在两字段成对写入/清除；「开始」onChange 平移结束以保持时长；「时长」onChange 用 `castStartTime + max(0,v)` 反算结束，保证 `castEndTime ≥ castStartTime`。默认开启为零宽窗口（起止=判定时间），与 DOT 块「默认取 event.time」的既有约定一致。TimeInput 的确切 props（是否支持负值 / `min`）以 `@/components/ui/time-input` 实际实现为准，读它确认。

- [ ] **Step 2: 类型检查 + 目视验证**

```bash
pnpm exec tsc --noEmit && pnpm lint
```

目视确认：

1. 选中一个无读条事件 → 「读条」开关关；打开后卡片出现（零宽→随时长变宽），起止字段可编辑。
2. 编辑「时长」→ 卡片右扩、判定菱形位置不变；编辑「开始」→ 卡片整体平移、时长不变。
3. 关闭开关 → 卡片回到无读条（左缘=判定、最小宽）。
4. 导入得到的带读条事件，选中后面板正确回显开始/时长。

- [ ] **Step 3: 提交**

```bash
git add src/components/PropertyPanel.tsx
git commit -m "feat(damage-casting): PropertyPanel 支持编辑事件读条开始/时长"
```

---

## Self-Review 记录

- **Spec 覆盖**：§2 数据模型→T1；§3 序列化→T1；§4 导入配对（extractBossCasts/buildCastPairs/attachCastWindows/duration 校验/多 boss/中断）→T2；§5 渲染（几何/文字/菱形/最小宽）→T3+T4；§6 交互（整体平移/单选拖菱形）→T5；§7 裁剪+泳道→T6；§8 AddEventDialog→T7；§9 测试→各任务内 + T8。全部有对应任务。
- **范围外项**（spec §10）：`scripts/fetch-events.ts` 的失效 import 已声明本 feature 不处理。
- **类型一致性**：`computeDamageCardGeometry` 返回 `{leftLocal,width,rawLeftSec,rawRightSec}` 在 T3 定义、T4/T6 一致消费；`attachCastWindows`/`extractBossCasts` 签名 T2 定义并接线一致。
- **已知不确定点**（执行时按实际代码校准）：`bulkMoveSelection`（T5S2）与 `AddEventDialog`（T7）的确切现有写法需 grep 后照搬；菱形 `dragBoundFunc` 采用"局部 y 回写"简化方案，绝对坐标方案废弃。
