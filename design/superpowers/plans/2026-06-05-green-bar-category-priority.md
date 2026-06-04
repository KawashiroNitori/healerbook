# 绿条末端按 status 类别优先取值 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 绿条末端优先采用同一 cast 下的「主减伤」（percentage / shield）status 收束时刻，仅当 cast 不产生主减伤 status 时回退到「全部 instance 取 max」的现状。

**Architecture:** 把新逻辑抽成两个纯函数 `statusTier`（status → primary/other 分类）与 `reduceCastEffectiveEnds`（按 cast 聚合：有 primary 取 primary max，否则全部 max），放在新文件 `src/utils/castEffectiveEnd.ts`，确定性单测。`MitigationCalculator.simulate` 仅接线：`OpenRecord` 增加 `tier` 字段（open 时算定）、`pushInterval` 收集 `(castId, to, tier)` 条目、收尾用 reducer 合成 `castEffectiveEndByCastEventId`。消费端（castWindow / Canvas）不动。

**Tech Stack:** TypeScript、Vitest（`pnpm test:run`）。

设计文档：`design/superpowers/specs/2026-06-05-green-bar-category-priority-design.md`

---

## File Structure

- Create: `src/utils/castEffectiveEnd.ts` — `StatusTier` 类型、`statusTier()` 分类、`CastEndEntry` 类型、`reduceCastEffectiveEnds()` 聚合
- Create: `src/utils/castEffectiveEnd.test.ts` — 两个纯函数的单测
- Modify: `src/utils/mitigationCalculator.ts` — `OpenRecord.tier`、`captureTransition` open 时分类、`pushInterval` 收集条目、simulate 收尾合成；更新 `SimulateOutput.castEffectiveEndByCastEventId` 注释
- Modify: `src/utils/mitigationCalculator.test.ts` — 新增「摆脱盾被打穿 → 绿条取盾收束时刻而非更长 regen」集成测试

---

## Task 1: 纯函数 `statusTier` 与 `reduceCastEffectiveEnds`

**Files:**

- Create: `src/utils/castEffectiveEnd.ts`
- Test: `src/utils/castEffectiveEnd.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/utils/castEffectiveEnd.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { statusTier, reduceCastEffectiveEnds } from './castEffectiveEnd'
import type { MitigationStatus, MitigationStatusMetadata } from '@/types/status'

const mkStatus = (patch: Partial<MitigationStatus> = {}): MitigationStatus =>
  ({ instanceId: 'i', statusId: 1, startTime: 0, endTime: 1, ...patch }) as MitigationStatus

const mkMeta = (patch: Partial<MitigationStatusMetadata> = {}): MitigationStatusMetadata =>
  patch as MitigationStatusMetadata

describe('statusTier', () => {
  it('category 含 percentage → primary', () => {
    expect(statusTier(mkMeta({ category: ['partywide', 'percentage'] }), mkStatus())).toBe(
      'primary'
    )
  })

  it('category 含 shield → primary', () => {
    expect(statusTier(mkMeta({ category: ['partywide', 'shield'] }), mkStatus())).toBe('primary')
  })

  it('category 为 heal → other', () => {
    expect(statusTier(mkMeta({ category: ['partywide', 'heal'] }), mkStatus())).toBe('other')
  })

  it('category 仅 scope（self）无效果类 → other', () => {
    expect(statusTier(mkMeta({ category: ['self'] }), mkStatus())).toBe('other')
  })

  it('category 已标注但不含 percentage/shield 时不再叠加 type 兜底 → other', () => {
    // category 存在即权威：即便 type==='multiplier' 也按 category 判 other
    expect(statusTier(mkMeta({ category: ['self'], type: 'multiplier' }), mkStatus())).toBe('other')
  })

  it('category 缺省 + type===multiplier → 兜底 primary', () => {
    expect(statusTier(mkMeta({ type: 'multiplier' }), mkStatus())).toBe('primary')
  })

  it('category 缺省 + 实例带 remainingBarrier → 兜底 primary', () => {
    expect(statusTier(mkMeta({}), mkStatus({ remainingBarrier: 100 }))).toBe('primary')
  })

  it('category 缺省 + 实例带 initialBarrier → 兜底 primary', () => {
    expect(statusTier(mkMeta({}), mkStatus({ initialBarrier: 100 }))).toBe('primary')
  })

  it('category 缺省 + 无 type 无 barrier → other', () => {
    expect(statusTier(mkMeta({}), mkStatus())).toBe('other')
  })

  it('meta 为 undefined + 无 barrier → other', () => {
    expect(statusTier(undefined, mkStatus())).toBe('other')
  })

  it('meta 为 undefined + 有 barrier → primary', () => {
    expect(statusTier(undefined, mkStatus({ remainingBarrier: 50 }))).toBe('primary')
  })
})

describe('reduceCastEffectiveEnds', () => {
  it('有 primary 时取 primary 的 max，即使比 other 短', () => {
    const out = reduceCastEffectiveEnds([
      { castId: 'c1', to: 5, tier: 'primary' },
      { castId: 'c1', to: 15, tier: 'other' },
    ])
    expect(out.get('c1')).toBe(5)
  })

  it('多个 primary 取其 max', () => {
    const out = reduceCastEffectiveEnds([
      { castId: 'c1', to: 20, tier: 'primary' },
      { castId: 'c1', to: 30, tier: 'primary' },
      { castId: 'c1', to: 100, tier: 'other' },
    ])
    expect(out.get('c1')).toBe(30)
  })

  it('无 primary 时回退全部 max', () => {
    const out = reduceCastEffectiveEnds([
      { castId: 'c1', to: 10, tier: 'other' },
      { castId: 'c1', to: 24, tier: 'other' },
    ])
    expect(out.get('c1')).toBe(24)
  })

  it('多 cast 互不影响', () => {
    const out = reduceCastEffectiveEnds([
      { castId: 'a', to: 5, tier: 'primary' },
      { castId: 'a', to: 9, tier: 'other' },
      { castId: 'b', to: 7, tier: 'other' },
    ])
    expect(out.get('a')).toBe(5)
    expect(out.get('b')).toBe(7)
  })

  it('空输入 → 空 map', () => {
    expect(reduceCastEffectiveEnds([]).size).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run castEffectiveEnd`
Expected: FAIL —— 模块 `./castEffectiveEnd` 不存在 / `statusTier` 未导出。

- [ ] **Step 3: 实现纯函数**

创建 `src/utils/castEffectiveEnd.ts`：

```ts
/**
 * 绿条末端（castEffectiveEnd）的分类与聚合纯函数。
 *
 * 一个 cast 可附着多个 status；绿条末端优先采用「主减伤」层（percentage / shield）的
 * 实际收束时刻，仅当 cast 完全不产生主减伤 status 时回退到「全部 instance 取 max」。
 * 详见 design/superpowers/specs/2026-06-05-green-bar-category-priority-design.md
 */

import type { MitigationStatus, MitigationStatusMetadata } from '@/types/status'

/** status 在绿条聚合中的层级：primary = percentage/shield，other = 其余 */
export type StatusTier = 'primary' | 'other'

/**
 * 判定一个 status instance 归入主减伤层还是其它层。
 *
 * category 为主：`meta.category` 含 'percentage' 或 'shield' → primary，否则 other。
 * category 整体缺省（undefined）时兜底：`type === 'multiplier'`（百分比）或实例带
 * barrier（盾）→ primary。category 已标注即视为权威，不再叠加 type/barrier 兜底。
 */
export function statusTier(
  meta: MitigationStatusMetadata | undefined,
  status: MitigationStatus
): StatusTier {
  const category = meta?.category
  if (category) {
    return category.includes('percentage') || category.includes('shield') ? 'primary' : 'other'
  }
  const isPercentage = meta?.type === 'multiplier'
  const isShield = status.remainingBarrier !== undefined || status.initialBarrier !== undefined
  return isPercentage || isShield ? 'primary' : 'other'
}

/** 一条绿条区间收束记录（按 cast 聚合的输入单元） */
export interface CastEndEntry {
  castId: string
  /** 该区间实际收束时刻 */
  to: number
  tier: StatusTier
}

/**
 * 按 cast 聚合绿条末端：
 *   - 该 cast 有 primary 条目 → 取 primary 条目的 max
 *   - 否则 → 取全部条目的 max
 */
export function reduceCastEffectiveEnds(entries: CastEndEntry[]): Map<string, number> {
  const primary = new Map<string, number>()
  const any = new Map<string, number>()
  for (const e of entries) {
    any.set(e.castId, Math.max(any.get(e.castId) ?? -Infinity, e.to))
    if (e.tier === 'primary') {
      primary.set(e.castId, Math.max(primary.get(e.castId) ?? -Infinity, e.to))
    }
  }
  const result = new Map<string, number>()
  for (const castId of any.keys()) {
    result.set(castId, primary.get(castId) ?? any.get(castId)!)
  }
  return result
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run castEffectiveEnd`
Expected: PASS（全部用例绿）。

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add src/utils/castEffectiveEnd.ts src/utils/castEffectiveEnd.test.ts
git commit -m "feat(calc): add statusTier + reduceCastEffectiveEnds helpers"
```

---

## Task 2: simulate 接线 + 集成测试

**Files:**

- Modify: `src/utils/mitigationCalculator.ts`
- Test: `src/utils/mitigationCalculator.test.ts`

- [ ] **Step 1: 写失败的集成测试**

在 `src/utils/mitigationCalculator.test.ts` 的 `describe('simulate → castEffectiveEndByCastEventId', ...)` 块内（紧跟「单纯盾击穿」用例之后，约 line 1554）插入：

```ts
it('主减伤盾被打穿 → 绿条取盾收束时刻，而非更长的 regen', () => {
  // 摆脱 7388 attach shield 1457(30s) + regen 2108(15s)。
  // t=5 一发大 AOE 打穿盾（removeOnBarrierBreak）→ 盾区间 to=5、regen 仍活到 15。
  // 旧口径 max(5,15)=15；新口径优先 primary(盾) → 5。
  const castEvents = [
    { id: 'c1', actionId: 7388, playerId: 1, timestamp: 0 } as unknown as CastEvent,
  ]
  const calc = new MitigationCalculator()
  const { castEffectiveEndByCastEventId } = calc.simulate({
    castEvents,
    damageEvents: [
      {
        id: 'd1',
        name: 'd1',
        time: 5,
        damage: 1_000_000,
        type: 'aoe',
        damageType: 'physical',
      } as DamageEvent,
    ],
    initialState: { players: [{ id: 1, job: 'WAR', maxHP: 100000 }], statuses: [], timestamp: 0 },
    statistics: {
      shieldByAbility: { 1457: 5000 },
      damageByAbility: {},
      maxHPByJob: {},
      critShieldByAbility: {},
      healByAbility: {},
      critHealByAbility: {},
      sampleSize: 0,
      updatedAt: '',
      tankReferenceMaxHP: 100000,
      referenceMaxHP: 100000,
    } as never,
  })
  expect(castEffectiveEndByCastEventId.get('c1')).toBe(5)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run mitigationCalculator`
Expected: 新用例 FAIL，实际值 `15`（旧 max 口径）≠ 期望 `5`。其余用例仍 PASS。

- [ ] **Step 3: simulate 接线——`OpenRecord` 增加 tier + open 时分类**

在 `src/utils/mitigationCalculator.ts` 顶部 import 区加入（紧跟现有 `import { isStatusValidForTank } from './statusFilter'` 之后）：

```ts
import {
  statusTier,
  reduceCastEffectiveEnds,
  type StatusTier,
  type CastEndEntry,
} from './castEffectiveEnd'
```

把 `OpenRecord` 接口（约 line 536）改为带 `tier`：

```ts
interface OpenRecord {
  statusId: number
  targetPlayerId: number
  sourcePlayerId: number
  sourceCastEventId: string
  from: number
  stacks: number
  endTime: number
  tier: StatusTier
}
const open = new Map<string, OpenRecord>()
```

在 `captureTransition` 内新增 instance 的 `open.set(...)`（约 line 595）补 `tier`：

```ts
for (const s of next.statuses) {
  if (prevIds.has(s.instanceId)) continue
  const target = s.sourcePlayerId ?? castPlayerIdHint ?? 0
  open.set(s.instanceId, {
    statusId: s.statusId,
    targetPlayerId: target,
    sourcePlayerId: s.sourcePlayerId ?? castPlayerIdHint ?? target,
    sourceCastEventId: castEventIdHint ?? '',
    from: at,
    stacks: s.stack ?? 1,
    endTime: s.endTime,
    tier: statusTier(getStatusById(s.statusId), s),
  })
}
```

- [ ] **Step 4: simulate 接线——`pushInterval` 收集条目，收尾用 reducer 合成**

把 `pushInterval`（约 line 547-565）里维护 `castEffectiveEndByCastEventId` 的那段，改为收集到条目数组。先在 `const castEffectiveEndByCastEventId = new Map<string, number>()`（约 line 471）之后新增：

```ts
const castEndEntries: CastEndEntry[] = []
```

再把 `pushInterval` 末尾的 castEffectiveEnd 维护块替换：

```ts
// 维护绿条末端原始条目：seeded buff（sourceCastEventId 为空）跳过；
// 收尾按 tier 优先合成 castEffectiveEndByCastEventId。
if (rec.sourceCastEventId !== '') {
  castEndEntries.push({ castId: rec.sourceCastEventId, to, tier: rec.tier })
}
```

在 simulate 收尾、`open` 残留 flush 之后（现有 `for (const [, rec] of open) { pushInterval(rec, rec.endTime) }` 与 `open.clear()` 之后，约 line 924），合成结果：

```ts
for (const [castId, end] of reduceCastEffectiveEnds(castEndEntries)) {
  castEffectiveEndByCastEventId.set(castId, end)
}
```

- [ ] **Step 5: 更新 `SimulateOutput` 注释**

把 `castEffectiveEndByCastEventId` 字段注释（约 line 181-184）更新为反映新口径：

```ts
/**
 * castEvent.id → 该 cast 的绿条末端。优先取该 cast 附着的「主减伤」（percentage /
 * shield）instance 的实际收束 max；该 cast 不产生主减伤 status 时回退到全部 instance
 * 的 max。seeded buff（sourceCastEventId === ''）不进表。渲染层用此字段定位绿条末端，
 * miss 时回退到 cast.timestamp + action.duration。分类与聚合见 utils/castEffectiveEnd.ts。
 */
castEffectiveEndByCastEventId: Map<string, number>
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm test:run mitigationCalculator`
Expected: 全部 PASS——新用例得 `5`；既有用例不变（极致防御 36920 仍 15：buff 3829 与 shield 3830 同为 primary，max(15,5)=15；意气 37013 仍 7；节制/干预/uniqueGroup/seeded 不受影响）。

- [ ] **Step 7: 全量测试 + 类型 + lint**

Run: `pnpm test:run`
Expected: 全绿。

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

Run: `pnpm lint`
Expected: 无错误。

- [ ] **Step 8: Commit**

```bash
git add src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts
git commit -m "feat(calc): green bar end prefers percentage/shield status tier"
```

---

## Self-Review 备注

- **Spec 覆盖**：规则（primary 优先、并集 max、无 primary 回退）→ Task 1 `reduceCastEffectiveEnds` + Task 2 集成测试；分类口径（category 为主、type/barrier 兜底）→ Task 1 `statusTier`；单点改动（simulate 内部、消费端不动）→ Task 2；测试矩阵（percentage 短+regen 长 / percentage+shield 不等长 / 纯 regen 回退 / category 缺省 type 兜底）→ Task 1 reduce 用例 + statusTier 用例 + Task 2 摆脱集成。
- **类型一致**：`StatusTier` / `CastEndEntry` / `statusTier` / `reduceCastEffectiveEnds` 在 Task 1 定义，Task 2 原样 import 使用，`OpenRecord.tier: StatusTier`。
- **已知边界**（变身不重算 tier、蓝条连带变长）见 spec，本期不额外处理。
