# 战斗资源悬浮窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在时间轴视图与表格视图中，鼠标悬停某时刻时弹出跟随光标的浮层，按成员展示该时刻持有的全部战斗资源（按样式类型分形态渲染）。

**Architecture:** 资源在 `ResourceDefinition` 上新增 `style` 字段分类（cooldown / progressBar / lights / lightsWithBar）。一个纯函数 `computeResourceSnapshots` 复用已有的 `useSkillTracks`（含 trackGroup 去重 + 过滤器 gating + mitigationActions 文件序）与资源 compute 层，按成员算出 `pools`（非 CD 多档共享池）与 `cooldowns`（每个可见技能一个 CD 部件）两段。hover 时刻经轻量 `resourceHoverStore` 在两个视图与浮层间打通。浮层挂在 `EditorPage` 的 `DamageCalculationContext.Provider` 内。

**Tech Stack:** React 19 + TypeScript、Zustand 5、Vitest 4、Tailwind v3、React-Konva（时间轴 mousemove 来源）。

## Global Constraints

- 必须用 **pnpm**。
- 提交信息 / 作者 / Co-Authored-By **禁止**包含 "Claude"（`.husky/commit-msg` 会拒绝，大小写不敏感）。
- 减伤技能相关命名用 `action`，不用 `skill`。
- 不可变更新 store / state（`set(s => ({...}))`，禁止直接 mutate）。
- 不修改资源 compute 层既有语义；新增函数与既有函数行为一致（单测锁定）。
- 测试文件与源文件同目录 `*.test.ts`；纯逻辑优先，组件不做渲染快照（仓库无 `.test.tsx` 先例）。
- 关联设计：`design/superpowers/specs/2026-06-26-resource-hover-panel-design.md`。

---

## File Structure

**新增：**

- `src/utils/resource/hoverSnapshot.ts` — 纯函数 `computeResourceSnapshots` + 类型 `ResourceWidget` / `MemberResourceSnapshot`（+ test）
- `src/store/resourceHoverStore.ts` — hover 瞬时态（time + cursor）（+ test）
- `src/hooks/useResourceHoverData.ts` — 组装 stores/context，产出 `getSnapshotAt`（+ test）
- `src/components/ResourceHover/widgetView.ts` — widget 纯视图模型（sweep/lit/label 派生）（+ test）
- `src/components/ResourceHover/{CooldownWidget,ProgressBarWidget,LightsWidget,LightsWithBarWidget}.tsx`
- `src/components/ResourceHover/panelPosition.ts` — `clampPanelPosition` 边界翻转（+ test）
- `src/components/ResourceHover/ResourceHoverPanel.tsx` — 浮层容器

**修改：**

- `src/types/resource.ts` — `ResourceStyle` 类型 + `ResourceDefinition.style`
- `src/data/resources.ts` — 7 个显式池补 `style`
- `src/utils/resource/compute.ts` — `syntheticCdDef` 写 `style: 'cooldown'`；新增 `computeResourceStateAt`，`computeResourceAmount` 改为委托
- 4 个既有资源测试补 `style` 字段（见 Task 1）
- `src/components/Timeline/index.tsx` — mousemove/leave 写 hover store
- `src/components/TimelineTable/TableDataRow.tsx` — 行 hover 写 hover store
- `src/pages/EditorPage.tsx` — 挂载 `ResourceHoverPanel`

---

## Task 1: `ResourceStyle` 字段 + 数据落地

**Files:**

- Modify: `src/types/resource.ts`
- Modify: `src/data/resources.ts`
- Modify: `src/utils/resource/compute.ts:220-229`（`syntheticCdDef`）
- Modify（补 `style` 字段，使必填类型编译通过）：
  - `src/utils/resource/validator.test.ts:103`（`consolationDef` 工厂返回的字面量）
  - `src/utils/resource/legalIntervals.test.ts:36,82,116,146`（`oblation` / `customPool` / 两个 `pool` 字面量）
  - `src/utils/resource/cdBar.test.ts:34,80`（`oblation` / `pool` 字面量）
  - `src/utils/resource/compute.test.ts`（`makeDef` 基对象 190、283；`makeCdDef` 335）
- Test: `src/data/resources.test.ts`（新建）

**Interfaces:**

- Produces:
  - `export type ResourceStyle = 'cooldown' | 'progressBar' | 'lights' | 'lightsWithBar'`
  - `ResourceDefinition.style: ResourceStyle`（必填）
  - `syntheticCdDef(...)` 返回值含 `style: 'cooldown'`

- [ ] **Step 1: 写失败测试** —— `src/data/resources.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { RESOURCE_REGISTRY } from './resources'
import { syntheticCdDef } from '@/utils/resource/compute'

describe('RESOURCE_REGISTRY style', () => {
  const expected: Record<string, string> = {
    'sch:aetherflow': 'lights',
    'whm:lily': 'lightsWithBar',
    'sge:addersgall': 'lightsWithBar',
    'sch:consolation': 'cooldown',
    'drk:oblation': 'cooldown',
    'ast:intersection': 'cooldown',
    'whm:divine': 'cooldown',
  }
  it('每个显式池声明了约定的样式', () => {
    for (const [id, style] of Object.entries(expected)) {
      expect(RESOURCE_REGISTRY[id]?.style).toBe(style)
    }
  })
  it('显式池数量与样式表一致（防止漏配新池）', () => {
    expect(Object.keys(RESOURCE_REGISTRY).sort()).toEqual(Object.keys(expected).sort())
  })
})

describe('syntheticCdDef', () => {
  it('合成 __cd__ 池恒为 cooldown 样式', () => {
    expect(syntheticCdDef('__cd__:188', 30).style).toBe('cooldown')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/data/resources.test.ts`
Expected: FAIL（`style` 不存在 / 编译错误）

- [ ] **Step 3: 加类型字段** —— `src/types/resource.ts`

在文件顶部 `import` 之后、`ResourceDefinition` 之前加：

```ts
/** 资源在悬浮窗中的渲染样式 */
export type ResourceStyle =
  | 'cooldown' // 技能图标 + 时钟 sweep 遮罩 + 倒计时（+ 多充能层数角标）
  | 'progressBar' // 进度条 + current/max（连续型；当前 registry 无使用，保留扩展）
  | 'lights' // N 个指示灯，亮 amount 个
  | 'lightsWithBar' // N 个指示灯 + 下一充能积累进度条
```

在 `ResourceDefinition` 接口内（`max: number` 之后）加：

```ts
/** 悬浮窗渲染样式（必填） */
style: ResourceStyle
```

- [ ] **Step 4: 填 registry 样式** —— `src/data/resources.ts`

给每个池对象加一行 `style`（放在 `max:` 之后即可）：

- `sch:consolation` → `style: 'cooldown',`
- `sch:aetherflow` → `style: 'lights',`
- `drk:oblation` → `style: 'cooldown',`
- `whm:lily` → `style: 'lightsWithBar',`
- `whm:divine` → `style: 'cooldown',`
- `ast:intersection` → `style: 'cooldown',`
- `sge:addersgall` → `style: 'lightsWithBar',`

- [ ] **Step 5: 合成池样式** —— `src/utils/resource/compute.ts`

在 `syntheticCdDef` 返回对象里加 `style: 'cooldown',`：

```ts
export function syntheticCdDef(resourceId: string, actionCooldown: number): ResourceDefinition {
  return {
    id: resourceId,
    name: `Synthetic CD ${resourceId}`,
    job: 'SCH',
    initial: 1,
    max: 1,
    regen: { interval: actionCooldown, amount: 1 },
    style: 'cooldown',
  }
}
```

- [ ] **Step 6: 修既有测试字面量编译**

`style` 现为必填，给以下文件中**每个 `ResourceDefinition` 对象字面量**补 `style: 'cooldown',`（这些测试与样式无关，cooldown 为中性填充）：

- `src/utils/resource/validator.test.ts:103` `consolationDef` 工厂返回的 `({ ... })`
- `src/utils/resource/legalIntervals.test.ts` 的 `oblation`(36) / `customPool`(82) / 两个内联 `pool`(116,146)
- `src/utils/resource/cdBar.test.ts` 的 `oblation`(34) / `pool`(80)
- `src/utils/resource/compute.test.ts`：两个 `makeDef` 的**基对象**（190、283，把 `style: 'cooldown',` 写进 `{ ...base, ...partial }` 的 base 部分，使 `Partial` 调用方无需逐个传）；`makeCdDef`(335) 返回的字面量

- [ ] **Step 7: 运行全量资源测试**

Run: `pnpm test:run src/utils/resource src/data/resources.test.ts && pnpm exec tsc --noEmit`
Expected: PASS，tsc 无报错

- [ ] **Step 8: Commit**

```bash
git add src/types/resource.ts src/data/resources.ts src/utils/resource/compute.ts src/utils/resource/*.test.ts src/data/resources.test.ts
git commit -m "feat(resource): ResourceDefinition 新增 style 样式字段并落地 registry"
```

---

## Task 2: `computeResourceStateAt`（amount + pending 快照）

**Files:**

- Modify: `src/utils/resource/compute.ts`（新增导出函数；重构 `computeResourceAmount` 委托）
- Test: `src/utils/resource/compute.test.ts`

**Interfaces:**

- Consumes: `ResourceDefinition`、`ResourceEvent`（Task 1 已带 `style`）
- Produces:
  - `export interface ResourceStateAt { amount: number; pending: number[] }`
  - `export function computeResourceStateAt(def: ResourceDefinition, events: ResourceEvent[], atTime: number): ResourceStateAt` —— `pending` 为 `atTime` 之后仍挂着的 refill 时刻升序数组，`pending[0]` 即最早一次回充。

- [ ] **Step 1: 写失败测试** —— 追加到 `src/utils/resource/compute.test.ts`

```ts
import { computeResourceStateAt } from './compute'

describe('computeResourceStateAt', () => {
  const def: ResourceDefinition = {
    id: 'p',
    name: 'p',
    job: 'SCH',
    initial: 3,
    max: 3,
    regen: { interval: 20, amount: 1 },
    style: 'lightsWithBar',
  }
  const events = deriveResourceEvents(
    [makeCast({ id: 'c1', actionId: 1, timestamp: 10 })],
    new Map([
      [1, makeAction({ id: 1, cooldown: 20, resourceEffects: [{ resourceId: 'p', delta: -1 }] })],
    ])
  ).get('10:p')!

  it('消耗后 amount 减 1，pending 含 +interval refill', () => {
    const s = computeResourceStateAt(def, events, 15)
    expect(s.amount).toBe(2)
    expect(s.pending).toEqual([30]) // 10 + 20
  })

  it('refill 时刻到点后 amount 恢复、pending 清空', () => {
    const s = computeResourceStateAt(def, events, 30)
    expect(s.amount).toBe(3)
    expect(s.pending).toEqual([])
  })

  it('amount 与 computeResourceAmount 一致', () => {
    for (const t of [0, 5, 10, 15, 25, 30, 40]) {
      expect(computeResourceStateAt(def, events, t).amount).toBe(
        computeResourceAmount(def, events, t)
      )
    }
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/utils/resource/compute.test.ts`
Expected: FAIL（`computeResourceStateAt is not a function`）

- [ ] **Step 3: 实现 + 重构委托** —— `src/utils/resource/compute.ts`

替换现有 `computeResourceAmount` 实现，新增 `ResourceStateAt` / `computeResourceStateAt`：

```ts
export interface ResourceStateAt {
  amount: number
  /** atTime 之后仍挂着的 refill 时刻（升序）；pending[0] = 最早一次回充 */
  pending: number[]
}

export function computeResourceStateAt(
  def: ResourceDefinition,
  events: ResourceEvent[],
  atTime: number
): ResourceStateAt {
  let amount = def.initial
  const pending: number[] = []
  const firePendingUpTo = (t: number) => {
    while (pending.length > 0 && pending[0] <= t) {
      pending.shift()
      amount = Math.min(amount + def.regen!.amount, def.max)
    }
  }
  for (const ev of events) {
    if (ev.timestamp > atTime) break
    firePendingUpTo(ev.timestamp)
    amount = Math.min(amount + ev.delta, def.max)
    if (ev.delta < 0 && def.regen) {
      const count = -ev.delta
      for (let k = 0; k < count; k++) pending.push(ev.timestamp + def.regen.interval)
    }
  }
  firePendingUpTo(atTime)
  return { amount, pending }
}

export function computeResourceAmount(
  def: ResourceDefinition,
  events: ResourceEvent[],
  atTime: number
): number {
  return computeResourceStateAt(def, events, atTime).amount
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/utils/resource/compute.test.ts`
Expected: PASS（含既有 `computeResourceAmount` 测试不回归）

- [ ] **Step 5: Commit**

```bash
git add src/utils/resource/compute.ts src/utils/resource/compute.test.ts
git commit -m "feat(resource): 新增 computeResourceStateAt 暴露 pending 回充快照"
```

---

## Task 3: `computeResourceSnapshots` 纯函数

**Files:**

- Create: `src/utils/resource/hoverSnapshot.ts`
- Test: `src/utils/resource/hoverSnapshot.test.ts`

**Interfaces:**

- Consumes: `effectsForAction`、`resolveDef`、`computeResourceStateAt`（Task 2）、`SkillTrack`、`RESOURCE_REGISTRY`、`ResourceStyle`（Task 1）
- Produces:
  - `interface ResourceWidget { resourceId: string; style: ResourceStyle; name: string; icon?: string; amount: number; max: number; countdownSec?: number; nextChargeProgress?: number }`
  - `interface MemberResourceSnapshot { playerId: number; job: Job; pools: ResourceWidget[]; cooldowns: ResourceWidget[] }`
  - `interface SnapshotInput { tracks: SkillTrack[]; actionsById: Map<number, MitigationAction>; registry: Record<string, ResourceDefinition>; resourceEventsByKey: Map<string, ResourceEvent[]> }`
  - `function computeResourceSnapshots(input: SnapshotInput, time: number): MemberResourceSnapshot[]`

- [ ] **Step 1: 写失败测试** —— `src/utils/resource/hoverSnapshot.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { computeResourceSnapshots, type SnapshotInput } from './hoverSnapshot'
import { deriveResourceEvents } from './compute'
import { makeAction, makeCast } from './__tests__/helpers'
import type { SkillTrack } from '@/utils/skillTracks'
import type { ResourceDefinition } from '@/types/resource'

// 慰藉：仅消耗 sch:consolation（cooldown 池，单技能）
const consolation = makeAction({
  id: 16547,
  name: '慰藉',
  icon: '/i/c.png',
  jobs: ['SCH'],
  cooldown: 30,
  resourceEffects: [{ resourceId: 'sch:consolation', delta: -1 }],
})
// 野战治疗阵：自身 __cd__ + 共享 aetherflow（lights 池）
const recitation = makeAction({
  id: 188,
  name: '野战治疗阵',
  icon: '/i/r.png',
  jobs: ['SCH'],
  cooldown: 30,
  resourceEffects: [
    { resourceId: '__cd__:188', delta: -1, required: true },
    { resourceId: 'sch:aetherflow', delta: -1 },
  ],
})
// 纯产出（无消费）→ 合成 __cd__:99
const transpose = makeAction({
  id: 99,
  name: '转化',
  icon: '/i/t.png',
  jobs: ['SCH'],
  cooldown: 60,
})

const registry: Record<string, ResourceDefinition> = {
  'sch:consolation': {
    id: 'sch:consolation',
    name: '慰藉充能',
    job: 'SCH',
    initial: 2,
    max: 2,
    regen: { interval: 30, amount: 1 },
    style: 'cooldown',
  },
  'sch:aetherflow': {
    id: 'sch:aetherflow',
    name: '以太超流',
    job: 'SCH',
    initial: 3,
    max: 3,
    regen: { interval: 60, amount: 3 },
    style: 'lights',
  },
}
const actionsById = new Map([consolation, recitation, transpose].map(a => [a.id, a]))
const tracks: SkillTrack[] = [
  { job: 'SCH', playerId: 10, actionId: 16547, actionName: '慰藉', actionIcon: '/i/c.png' },
  { job: 'SCH', playerId: 10, actionId: 188, actionName: '野战治疗阵', actionIcon: '/i/r.png' },
  { job: 'SCH', playerId: 10, actionId: 99, actionName: '转化', actionIcon: '/i/t.png' },
]

function input(casts = []): SnapshotInput {
  return {
    tracks,
    actionsById,
    registry,
    resourceEventsByKey: deriveResourceEvents(casts, actionsById),
  }
}

describe('computeResourcesnapshots', () => {
  it('成员只含有可见轨道的玩家；pools 为非 cooldown 池、cooldowns 每轨一个', () => {
    const [m] = computeResourceSnapshots(input(), 0)
    expect(m.playerId).toBe(10)
    // pools：aetherflow（lights），满档
    expect(m.pools.map(p => p.resourceId)).toEqual(['sch:aetherflow'])
    expect(m.pools[0]).toMatchObject({ style: 'lights', amount: 3, max: 3 })
    // cooldowns：慰藉(sch:consolation) / 野战(__cd__:188) / 转化(__cd__:99)，按 tracks 顺序
    expect(m.cooldowns.map(c => c.resourceId)).toEqual([
      'sch:consolation',
      '__cd__:188',
      '__cd__:99',
    ])
    expect(m.cooldowns.map(c => c.icon)).toEqual(['/i/c.png', '/i/r.png', '/i/t.png'])
  })

  it('未释放技能的 CD 池满档/就绪，无倒计时', () => {
    const [m] = computeResourceSnapshots(input(), 0)
    const cd = m.cooldowns.find(c => c.resourceId === '__cd__:188')!
    expect(cd.amount).toBe(1)
    expect(cd.countdownSec).toBeUndefined()
  })

  it('消耗后 cooldown 倒计时 = 下一回充剩余秒；进度 [0,1]', () => {
    const casts = [makeCast({ id: 'x', actionId: 188, timestamp: 10 })]
    const [m] = computeResourceSnapshots(input(casts), 25)
    const cd = m.cooldowns.find(c => c.resourceId === '__cd__:188')!
    expect(cd.amount).toBe(0)
    expect(cd.countdownSec).toBeCloseTo(15) // (10+30) - 25
    expect(cd.nextChargeProgress).toBeCloseTo(0.5) // (25 - 10) / 30
  })

  it('多档共享池消耗后 lights amount 递减', () => {
    const casts = [makeCast({ id: 'x', actionId: 188, timestamp: 10 })]
    const [m] = computeResourceSnapshots(input(casts), 12)
    expect(m.pools[0].amount).toBe(2) // aetherflow 3 → 2
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/utils/resource/hoverSnapshot.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** —— `src/utils/resource/hoverSnapshot.ts`

```ts
/**
 * 战斗资源悬浮窗：按成员算出某时刻的资源部件快照（纯函数）。
 *
 * - cooldowns：每个可见技能轨道一个 CD 部件。代表消耗优先取自身 __cd__，否则取首个 delta<0；
 *   仅当代表池 style==='cooldown' 才纳入（多档共享池由 pools 表达，跳过）。
 * - pools：该职业的非 cooldown 显式池（lights / lightsWithBar / progressBar），按 registry 顺序。
 * 成员顺序与 tracks 一致（useSkillTracks 已按职业序），仅含有可见轨道的玩家。
 */

import type { Job } from '@/data/jobs'
import type { MitigationAction } from '@/types/mitigation'
import type { ResourceDefinition, ResourceEvent, ResourceStyle } from '@/types/resource'
import type { SkillTrack } from '@/utils/skillTracks'
import { effectsForAction, resolveDef, computeResourceStateAt } from './compute'

export interface ResourceWidget {
  resourceId: string
  style: ResourceStyle
  name: string
  /** cooldown 样式：代表技能图标路径 */
  icon?: string
  amount: number
  max: number
  /** 仅 amount<max 且有 regen：距下一充能恢复剩余秒 */
  countdownSec?: number
  /** 仅 amount<max 且有 regen：下一充能积累进度 [0,1] */
  nextChargeProgress?: number
}

export interface MemberResourceSnapshot {
  playerId: number
  job: Job
  pools: ResourceWidget[]
  cooldowns: ResourceWidget[]
}

export interface SnapshotInput {
  tracks: SkillTrack[]
  actionsById: Map<number, MitigationAction>
  registry: Record<string, ResourceDefinition>
  resourceEventsByKey: Map<string, ResourceEvent[]>
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

function buildWidget(
  def: ResourceDefinition,
  events: ResourceEvent[],
  time: number,
  meta: { name: string; icon?: string }
): ResourceWidget {
  const { amount, pending } = computeResourceStateAt(def, events, time)
  const w: ResourceWidget = {
    resourceId: def.id,
    style: def.style,
    name: meta.name,
    icon: meta.icon,
    amount,
    max: def.max,
  }
  if (amount < def.max && def.regen && pending.length > 0) {
    const earliest = pending[0]
    w.countdownSec = earliest - time
    w.nextChargeProgress = clamp01((time - (earliest - def.regen.interval)) / def.regen.interval)
  }
  return w
}

export function computeResourceSnapshots(
  input: SnapshotInput,
  time: number
): MemberResourceSnapshot[] {
  const { tracks, actionsById, registry, resourceEventsByKey } = input

  // 按玩家分组，保留 tracks 顺序（= 职业序 + mitigationActions 文件序）
  const order: number[] = []
  const byPlayer = new Map<number, { job: Job; tracks: SkillTrack[] }>()
  for (const t of tracks) {
    let e = byPlayer.get(t.playerId)
    if (!e) {
      e = { job: t.job, tracks: [] }
      byPlayer.set(t.playerId, e)
      order.push(t.playerId)
    }
    e.tracks.push(t)
  }

  const result: MemberResourceSnapshot[] = []
  for (const playerId of order) {
    const { job, tracks: playerTracks } = byPlayer.get(playerId)!

    const cooldowns: ResourceWidget[] = []
    for (const tr of playerTracks) {
      const action = actionsById.get(tr.actionId)
      if (!action) continue
      const consumes = effectsForAction(action).filter(e => e.delta < 0)
      // 代表消耗：优先自身 __cd__，否则首个 delta<0
      const consume = consumes.find(e => e.resourceId.startsWith('__cd__:')) ?? consumes[0]
      if (!consume) continue
      const def = resolveDef(consume.resourceId, registry, action)
      if (!def || def.style !== 'cooldown') continue // 多档共享池由 pools 表达
      const events = resourceEventsByKey.get(`${playerId}:${consume.resourceId}`) ?? []
      cooldowns.push(buildWidget(def, events, time, { name: action.name, icon: action.icon }))
    }

    const pools: ResourceWidget[] = []
    for (const def of Object.values(registry)) {
      if (def.job !== job || def.style === 'cooldown') continue
      const events = resourceEventsByKey.get(`${playerId}:${def.id}`) ?? []
      pools.push(buildWidget(def, events, time, { name: def.name }))
    }

    result.push({ playerId, job, pools, cooldowns })
  }
  return result
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/utils/resource/hoverSnapshot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/resource/hoverSnapshot.ts src/utils/resource/hoverSnapshot.test.ts
git commit -m "feat(resource): computeResourceSnapshots 按成员算资源部件快照"
```

---

## Task 4: `resourceHoverStore`

**Files:**

- Create: `src/store/resourceHoverStore.ts`
- Test: `src/store/resourceHoverStore.test.ts`

**Interfaces:**

- Produces:
  - `interface ResourceHoverState { time: number | null; cursor: { x: number; y: number } | null; setHover(time: number, cursor: { x: number; y: number }): void; clearHover(): void }`
  - `export const useResourceHoverStore`

- [ ] **Step 1: 写失败测试** —— `src/store/resourceHoverStore.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useResourceHoverStore } from './resourceHoverStore'

describe('resourceHoverStore', () => {
  beforeEach(() => useResourceHoverStore.getState().clearHover())

  it('初始为空', () => {
    expect(useResourceHoverStore.getState().time).toBeNull()
    expect(useResourceHoverStore.getState().cursor).toBeNull()
  })

  it('setHover 写入 time + cursor', () => {
    useResourceHoverStore.getState().setHover(42.5, { x: 100, y: 200 })
    expect(useResourceHoverStore.getState().time).toBe(42.5)
    expect(useResourceHoverStore.getState().cursor).toEqual({ x: 100, y: 200 })
  })

  it('clearHover 复位', () => {
    useResourceHoverStore.getState().setHover(1, { x: 1, y: 1 })
    useResourceHoverStore.getState().clearHover()
    expect(useResourceHoverStore.getState().time).toBeNull()
    expect(useResourceHoverStore.getState().cursor).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/store/resourceHoverStore.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** —— `src/store/resourceHoverStore.ts`

```ts
/**
 * 战斗资源悬浮窗的 hover 瞬时态：当前悬停时刻 + 光标坐标。
 * 仅 UI 瞬时态，不持久化、不进 timeline 数据。
 */

import { create } from 'zustand'

interface ResourceHoverState {
  time: number | null
  cursor: { x: number; y: number } | null
  setHover: (time: number, cursor: { x: number; y: number }) => void
  clearHover: () => void
}

export const useResourceHoverStore = create<ResourceHoverState>(set => ({
  time: null,
  cursor: null,
  setHover: (time, cursor) => set({ time, cursor }),
  clearHover: () => set({ time: null, cursor: null }),
}))
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/store/resourceHoverStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/resourceHoverStore.ts src/store/resourceHoverStore.test.ts
git commit -m "feat(resource): 新增 resourceHoverStore 承载 hover 瞬时态"
```

---

## Task 5: `useResourceHoverData` hook

**Files:**

- Create: `src/hooks/useResourceHoverData.ts`
- Test: `src/hooks/useResourceHoverData.test.ts`

**Interfaces:**

- Consumes: `useSkillTracks`、`useTimelineStore`、`useMitigationStore`、`useStatusTimelineByPlayer`、`useResolvedVariantByCastId`、`deriveResourceEvents`、`computeResourceSnapshots`、`RESOURCE_REGISTRY`
- Produces: `function useResourceHoverData(): { getSnapshotAt: (time: number) => MemberResourceSnapshot[] }`

- [ ] **Step 1: 写失败测试** —— `src/hooks/useResourceHoverData.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useResourceHoverData } from './useResourceHoverData'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'

describe('useResourceHoverData', () => {
  beforeEach(() => {
    useTimelineStore.setState({ timeline: null })
    useMitigationStore.getState().loadActions()
  })

  it('无 timeline 时 getSnapshotAt 返回空数组', () => {
    const { result } = renderHook(() => useResourceHoverData())
    expect(result.current.getSnapshotAt(0)).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/hooks/useResourceHoverData.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** —— `src/hooks/useResourceHoverData.ts`

```ts
/**
 * 战斗资源悬浮窗数据源：组装 skillTracks / 资源事件，产出按时刻取快照的 getSnapshotAt。
 * 须在 DamageCalculationContext.Provider 作用域内使用（取 statusTimeline / resolvedVariant）。
 */

import { useCallback, useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useSkillTracks } from '@/hooks/useSkillTracks'
import {
  useStatusTimelineByPlayer,
  useResolvedVariantByCastId,
} from '@/contexts/DamageCalculationContext'
import { deriveResourceEvents } from '@/utils/resource/compute'
import {
  computeResourceSnapshots,
  type MemberResourceSnapshot,
} from '@/utils/resource/hoverSnapshot'
import { RESOURCE_REGISTRY } from '@/data/resources'

export function useResourceHoverData(): {
  getSnapshotAt: (time: number) => MemberResourceSnapshot[]
} {
  const timeline = useTimelineStore(s => s.timeline)
  const actions = useMitigationStore(s => s.actions)
  const tracks = useSkillTracks()
  const statusTimeline = useStatusTimelineByPlayer()
  const resolvedVariant = useResolvedVariantByCastId()

  const actionsById = useMemo(() => new Map(actions.map(a => [a.id, a])), [actions])

  const resourceEventsByKey = useMemo(() => {
    if (!timeline) return new Map()
    return deriveResourceEvents(timeline.castEvents, actionsById, statusTimeline, resolvedVariant)
  }, [timeline, actionsById, statusTimeline, resolvedVariant])

  return {
    getSnapshotAt: useCallback(
      (time: number) =>
        timeline
          ? computeResourceSnapshots(
              { tracks, actionsById, registry: RESOURCE_REGISTRY, resourceEventsByKey },
              time
            )
          : [],
      [timeline, tracks, actionsById, resourceEventsByKey]
    ),
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/hooks/useResourceHoverData.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useResourceHoverData.ts src/hooks/useResourceHoverData.test.ts
git commit -m "feat(resource): useResourceHoverData 组装悬浮窗数据源"
```

---

## Task 6: Widget 视图模型 + 4 个部件组件

**Files:**

- Create: `src/components/ResourceHover/widgetView.ts`
- Test: `src/components/ResourceHover/widgetView.test.ts`
- Create: `src/components/ResourceHover/CooldownWidget.tsx`
- Create: `src/components/ResourceHover/ProgressBarWidget.tsx`
- Create: `src/components/ResourceHover/LightsWidget.tsx`
- Create: `src/components/ResourceHover/LightsWithBarWidget.tsx`

**Interfaces:**

- Consumes: `ResourceWidget`（Task 3）
- Produces:
  - `function cooldownView(w: ResourceWidget): { showMask: boolean; sweepFraction: number; countdownLabel: string | null; stackBadge: number | null }`
  - `function lightsView(w: ResourceWidget): { total: number; lit: number }`
  - `function barView(w: ResourceWidget): { fraction: number; label: string }`
  - 4 个默认导出 React 组件，props 均为 `{ widget: ResourceWidget }`

- [ ] **Step 1: 写失败测试** —— `src/components/ResourceHover/widgetView.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { cooldownView, lightsView, barView } from './widgetView'
import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'

const base: ResourceWidget = { resourceId: 'r', style: 'cooldown', name: 'x', amount: 0, max: 1 }

describe('cooldownView', () => {
  it('amount=max 就绪：无遮罩、无倒计时', () => {
    const v = cooldownView({ ...base, amount: 1, max: 1 })
    expect(v.showMask).toBe(false)
    expect(v.countdownLabel).toBeNull()
  })
  it('冷却中：遮罩 sweep=1-progress，倒计时向上取整秒', () => {
    const v = cooldownView({
      ...base,
      amount: 0,
      max: 1,
      countdownSec: 14.2,
      nextChargeProgress: 0.5,
    })
    expect(v.showMask).toBe(true)
    expect(v.sweepFraction).toBeCloseTo(0.5)
    expect(v.countdownLabel).toBe('15')
  })
  it('多充能：layer 角标 = amount；max=1 时无角标', () => {
    expect(cooldownView({ ...base, amount: 1, max: 2 }).stackBadge).toBe(1)
    expect(cooldownView({ ...base, amount: 1, max: 1 }).stackBadge).toBeNull()
  })
})

describe('lightsView', () => {
  it('total=max，lit=amount', () => {
    expect(lightsView({ ...base, style: 'lights', amount: 2, max: 3 })).toEqual({
      total: 3,
      lit: 2,
    })
  })
})

describe('barView', () => {
  it('progressBar：fraction=amount/max，label=current/max', () => {
    expect(barView({ ...base, style: 'progressBar', amount: 30, max: 100 })).toEqual({
      fraction: 0.3,
      label: '30/100',
    })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/components/ResourceHover/widgetView.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现纯视图模型** —— `src/components/ResourceHover/widgetView.ts`

```ts
/** widget 纯视图模型：把 ResourceWidget 派生为各样式的渲染参数（无 JSX，便于单测）。 */

import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'

export function cooldownView(w: ResourceWidget): {
  showMask: boolean
  sweepFraction: number
  countdownLabel: string | null
  stackBadge: number | null
} {
  const onCooldown = w.amount < w.max && w.countdownSec != null
  return {
    showMask: onCooldown,
    // sweep = 剩余比例 = 1 - 下一充能进度
    sweepFraction: onCooldown ? 1 - (w.nextChargeProgress ?? 0) : 0,
    countdownLabel: onCooldown ? String(Math.ceil(w.countdownSec!)) : null,
    stackBadge: w.max > 1 ? w.amount : null,
  }
}

export function lightsView(w: ResourceWidget): { total: number; lit: number } {
  return { total: w.max, lit: w.amount }
}

export function barView(w: ResourceWidget): { fraction: number; label: string } {
  return { fraction: w.max > 0 ? w.amount / w.max : 0, label: `${w.amount}/${w.max}` }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/components/ResourceHover/widgetView.test.ts`
Expected: PASS

- [ ] **Step 5: 实现 4 个组件**

`src/components/ResourceHover/CooldownWidget.tsx`：

```tsx
import { getIconUrl } from '@/utils/iconUtils'
import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { cooldownView } from './widgetView'

export default function CooldownWidget({ widget }: { widget: ResourceWidget }) {
  const v = cooldownView(widget)
  return (
    <div className="relative w-8 h-8 rounded-sm overflow-hidden bg-muted" title={widget.name}>
      {widget.icon && (
        <img
          src={getIconUrl(widget.icon)}
          alt={widget.name}
          className="w-full h-full object-cover"
          onError={e => (e.currentTarget.style.display = 'none')}
        />
      )}
      {v.showMask && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `conic-gradient(rgba(0,0,0,0.6) ${v.sweepFraction * 360}deg, transparent 0deg)`,
          }}
        />
      )}
      {v.countdownLabel && (
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
          {v.countdownLabel}
        </span>
      )}
      {v.stackBadge != null && (
        <span className="absolute bottom-0 right-0 px-0.5 text-[10px] font-bold leading-none text-white bg-black/70 rounded-tl-sm tabular-nums">
          {v.stackBadge}
        </span>
      )}
    </div>
  )
}
```

`src/components/ResourceHover/LightsWidget.tsx`：

```tsx
import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { lightsView } from './widgetView'

export default function LightsWidget({ widget }: { widget: ResourceWidget }) {
  const { total, lit } = lightsView(widget)
  return (
    <div className="flex items-center gap-1" title={widget.name}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`w-2.5 h-2.5 rounded-full border ${
            i < lit ? 'bg-amber-400 border-amber-500' : 'bg-transparent border-muted-foreground/40'
          }`}
        />
      ))}
    </div>
  )
}
```

`src/components/ResourceHover/LightsWithBarWidget.tsx`：

```tsx
import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { lightsView } from './widgetView'

export default function LightsWithBarWidget({ widget }: { widget: ResourceWidget }) {
  const { total, lit } = lightsView(widget)
  const progress = widget.nextChargeProgress ?? (widget.amount >= widget.max ? 1 : 0)
  return (
    <div className="flex flex-col gap-0.5" title={widget.name}>
      <div className="flex items-center gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`w-2.5 h-2.5 rounded-full border ${
              i < lit
                ? 'bg-amber-400 border-amber-500'
                : 'bg-transparent border-muted-foreground/40'
            }`}
          />
        ))}
      </div>
      <div className="h-1 w-full rounded bg-muted overflow-hidden">
        <div className="h-full bg-sky-400" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  )
}
```

`src/components/ResourceHover/ProgressBarWidget.tsx`：

```tsx
import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { barView } from './widgetView'

export default function ProgressBarWidget({ widget }: { widget: ResourceWidget }) {
  const { fraction, label } = barView(widget)
  return (
    <div className="flex items-center gap-1" title={widget.name}>
      <div className="h-2 w-16 rounded bg-muted overflow-hidden">
        <div className="h-full bg-sky-400" style={{ width: `${fraction * 100}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">{label}</span>
    </div>
  )
}
```

- [ ] **Step 6: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错

- [ ] **Step 7: Commit**

```bash
git add src/components/ResourceHover/
git commit -m "feat(resource): 悬浮窗 4 种资源部件与纯视图模型"
```

---

## Task 7: 浮层定位 + 面板组装 + 两视图 hover 接线

**Files:**

- Create: `src/components/ResourceHover/panelPosition.ts`
- Test: `src/components/ResourceHover/panelPosition.test.ts`
- Create: `src/components/ResourceHover/ResourceHoverPanel.tsx`
- Modify: `src/pages/EditorPage.tsx:418`（`<PropertyPanel />` 之后挂载）
- Modify: `src/components/Timeline/index.tsx`（mousemove ~492 行写 store；leave ~579 行 clear）
- Modify: `src/components/TimelineTable/TableDataRow.tsx`（`<tr>` 加 hover 处理）

**Interfaces:**

- Consumes: `useResourceHoverStore`、`useResourceHoverData`、`formatTimeWithDecimal`、`JobIcon`、4 个 widget、`MemberResourceSnapshot`
- Produces: `function clampPanelPosition(cursor, size, viewport): { left: number; top: number }`

- [ ] **Step 1: 写失败测试** —— `src/components/ResourceHover/panelPosition.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { clampPanelPosition } from './panelPosition'

const size = { width: 200, height: 100 }
const vp = { width: 1000, height: 800 }

describe('clampPanelPosition', () => {
  it('默认偏移光标右下 +16/+16', () => {
    expect(clampPanelPosition({ x: 100, y: 100 }, size, vp)).toEqual({ left: 116, top: 116 })
  })
  it('近右边界翻转到光标左侧', () => {
    expect(clampPanelPosition({ x: 950, y: 100 }, size, vp).left).toBe(950 - 16 - 200)
  })
  it('近下边界翻转到光标上方', () => {
    expect(clampPanelPosition({ x: 100, y: 760 }, size, vp).top).toBe(760 - 16 - 100)
  })
  it('翻转后仍不越上/左边界（clamp 到 0）', () => {
    expect(clampPanelPosition({ x: 5, y: 5 }, { width: 200, height: 100 }, vp)).toEqual({
      left: 21,
      top: 21,
    })
    expect(clampPanelPosition({ x: 10, y: 10 }, { width: 2000, height: 2000 }, vp)).toEqual({
      left: 0,
      top: 0,
    })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/components/ResourceHover/panelPosition.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现定位** —— `src/components/ResourceHover/panelPosition.ts`

```ts
/** 跟随光标的浮层定位：默认右下偏移，近右/下边界翻转，最终 clamp 到视口内。 */

const OFFSET = 16

export function clampPanelPosition(
  cursor: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number } {
  let left = cursor.x + OFFSET
  if (left + size.width > viewport.width) left = cursor.x - OFFSET - size.width
  let top = cursor.y + OFFSET
  if (top + size.height > viewport.height) top = cursor.y - OFFSET - size.height
  return { left: Math.max(0, left), top: Math.max(0, top) }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/components/ResourceHover/panelPosition.test.ts`
Expected: PASS

- [ ] **Step 5: 实现面板** —— `src/components/ResourceHover/ResourceHoverPanel.tsx`

```tsx
import { useLayoutEffect, useRef, useState } from 'react'
import JobIcon from '@/components/JobIcon'
import { formatTimeWithDecimal } from '@/utils/formatters'
import { useResourceHoverStore } from '@/store/resourceHoverStore'
import { useResourceHoverData } from '@/hooks/useResourceHoverData'
import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { clampPanelPosition } from './panelPosition'
import CooldownWidget from './CooldownWidget'
import ProgressBarWidget from './ProgressBarWidget'
import LightsWidget from './LightsWidget'
import LightsWithBarWidget from './LightsWithBarWidget'

function renderWidget(w: ResourceWidget) {
  switch (w.style) {
    case 'cooldown':
      return <CooldownWidget widget={w} />
    case 'progressBar':
      return <ProgressBarWidget widget={w} />
    case 'lights':
      return <LightsWidget widget={w} />
    case 'lightsWithBar':
      return <LightsWithBarWidget widget={w} />
  }
}

export default function ResourceHoverPanel() {
  const time = useResourceHoverStore(s => s.time)
  const cursor = useResourceHoverStore(s => s.cursor)
  const { getSnapshotAt } = useResourceHoverData()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  const members = time != null ? getSnapshotAt(time) : []

  useLayoutEffect(() => {
    if (time == null || !cursor || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setPos(
      clampPanelPosition(
        cursor,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    )
  }, [time, cursor, members.length])

  if (time == null || !cursor || members.length === 0) return null

  return (
    <div
      ref={ref}
      className="fixed z-50 pointer-events-none rounded-md border bg-popover/95 shadow-lg p-2 text-popover-foreground backdrop-blur-sm"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="mb-1 text-[11px] font-semibold tabular-nums text-muted-foreground">
        T{formatTimeWithDecimal(time)}
      </div>
      <div className="flex flex-col gap-1.5">
        {members.map(m => (
          <div key={m.playerId} className="flex items-center gap-2">
            <JobIcon job={m.job} size="sm" />
            {m.pools.map(p => (
              <span key={p.resourceId}>{renderWidget(p)}</span>
            ))}
            {m.cooldowns.length > 0 && (
              <span className="flex flex-wrap items-center gap-0.5 pl-1 border-l border-border/60">
                {m.cooldowns.map(c => (
                  <span key={c.resourceId}>{renderWidget(c)}</span>
                ))}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: 挂载面板** —— `src/pages/EditorPage.tsx`

在文件顶部 import 区加 `import ResourceHoverPanel from '@/components/ResourceHover/ResourceHoverPanel'`，并在 `<PropertyPanel />`（约 418 行）之后、`</DamageCalculationContext.Provider>` 之前插入：

```tsx
        <PropertyPanel />
        <ResourceHoverPanel />
      </DamageCalculationContext.Provider>
```

- [ ] **Step 7: 时间轴视图写 store** —— `src/components/Timeline/index.tsx`

文件顶部 import 区加：

```ts
import { useResourceHoverStore } from '@/store/resourceHoverStore'
```

在 `createCrosshairMoveHandler` 内、`hoverTimeRef.current = time`（约 492 行）之后加：

```ts
useResourceHoverStore.getState().setHover(time, { x: e.clientX, y: e.clientY })
```

在 `handleCrosshairLeave` 内、`hoverTimeRef.current = null`（约 579 行）之后加：

```ts
useResourceHoverStore.getState().clearHover()
```

- [ ] **Step 8: 表格视图写 store** —— `src/components/TimelineTable/TableDataRow.tsx`

文件顶部 import 区加：

```ts
import { useResourceHoverStore } from '@/store/resourceHoverStore'
```

把 `<tr className="group" style={{ height: ROW_HEIGHT }}>`（约 151 行）改为：

```tsx
    <tr
      className="group"
      style={{ height: ROW_HEIGHT }}
      onMouseMove={e =>
        useResourceHoverStore.getState().setHover(event.time, { x: e.clientX, y: e.clientY })
      }
      onMouseLeave={() => useResourceHoverStore.getState().clearHover()}
    >
```

- [ ] **Step 9: 全量校验**

Run: `pnpm test:run && pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: 全部 PASS

- [ ] **Step 10: Commit**

```bash
git add src/components/ResourceHover/ src/pages/EditorPage.tsx src/components/Timeline/index.tsx src/components/TimelineTable/TableDataRow.tsx
git commit -m "feat(resource): 战斗资源悬浮窗组装与两视图 hover 接线"
```

---

## 人工验证（实现完成后）

`pnpm dev` 打开任一时间轴：

1. **时间轴视图**横向移动鼠标：浮层跟随光标，按职业序展示成员；左侧为多档共享池（以太超流指示灯等），右侧为紧凑 CD 部件网格。
2. 移到某减伤 cast 之后：对应技能 CD 部件出现灰色 sweep 遮罩 + 倒计时；多充能技能（如蛇胆/慰藉）显示层数与下一档进度。
3. 切换过滤器（仅治疗 / 仅团减 / 仅坦克）：浮层内成员与部件随之收敛——CD 部件仅显示过滤器允许的技能；共享池仅在该职业有可见技能时出现。
4. **表格视图**逐行 hover：浮层显示该行时刻的资源，行间切换实时更新。
5. 视口右/下边界附近：浮层翻转避免越界。

---

## Self-Review

**Spec coverage：**

- §2 样式字段 → Task 1 ✓
- §3.1 派生事件 memo → Task 5 ✓
- §3.2 资源宇宙（职业全部技能 CD + 显式池）→ Task 3（复用 useSkillTracks 覆盖全职业技能）✓
- §3.3 过滤器 gating（CD 按技能可见 / 共享池按职业有可见技能）→ Task 3 + useSkillTracks 的 matchTrack ✓
- §3.4/§3.5 pools/cooldowns 拆分与排序 → Task 3 ✓
- §3 倒计时/进度计算（pendingStateAt）→ Task 2 `computeResourceStateAt` + Task 3 buildWidget ✓
- §4 resourceHoverStore + 两视图写入 → Task 4 + Task 7 ✓
- §5 浮层 + 4 部件 + 跟随光标定位 → Task 6 + Task 7 ✓
- §6 测试 → 各 Task 内 TDD ✓

**Placeholder scan：** 无 TODO / “处理边界”空泛语；每个改动给出完整代码或精确锚点。

**Type consistency：** `ResourceWidget` / `MemberResourceSnapshot` / `SnapshotInput`（Task 3）→ Task 5/6/7 一致引用；`computeResourceStateAt` 返回 `{ amount, pending }`（Task 2）→ Task 3 解构一致；`ResourceStyle` 四值（Task 1）→ widgetView / renderWidget switch 全覆盖。

**偏离说明：** spec §6 原写“widget 渲染快照单测”，因仓库无 `.test.tsx` 先例，改为提取 `widgetView.ts` 纯视图模型单测（cooldownView/lightsView/barView）+ `panelPosition` 单测，组件本体由 tsc/lint/build 兜底。
