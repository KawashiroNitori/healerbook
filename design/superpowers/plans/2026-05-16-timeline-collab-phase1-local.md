# 时间轴协同编辑 — 阶段 1(纯本地)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把时间轴的内存真相源换成 Yjs `Y.Doc`,本地用 IndexedDB(snapshot + updates 双表)持久化,撤销改用 `Y.UndoManager`,并一次性把存量本地数据迁移到新格式 —— 全程无服务端,得到一个 Y.Doc 支撑的离线优先编辑器。

**Architecture:** `Y.Doc` 是内存唯一真相源;`timelineStore`(Zustand)降级为它的只读投影;`src/collab/` 是只碰 Y.Doc + 二进制的同步层。本阶段同步层只有「本地」一端(无 remote)。

**Tech Stack:** Yjs(CRDT)、IndexedDB、Zustand、Vitest、`fake-indexeddb`(测试)。

**前置文档:** `design/superpowers/specs/2026-05-16-timeline-collaborative-sync-design.md` 第 4、5、8(部分)、9、10、12 节、第 13 节阶段 1。

---

## 文件结构

| 文件                                      | 职责                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/collab/constants.ts`                 | Y.Doc 顶层 Map 名常量、本地存储常量                                                                      |
| `src/collab/types.ts`                     | `TimelineContent`(Y.Doc 内容子集)类型                                                                    |
| `src/collab/docSchema.ts`                 | 纯函数:`buildYDoc` / `projectTimeline`(含 sanitizer)/ granular mutators。客户端与(后续阶段的)Worker 共用 |
| `src/collab/storage/IndexedDBDocStore.ts` | 本地 snapshot + updates 双表,append / load / 惰性 squash                                                 |
| `src/collab/LocalSyncEngine.ts`           | 持有 Y.Doc + IndexedDBDocStore + UndoManager,wire update 事件(本阶段无 remote)                           |
| `src/collab/migration.ts`                 | 客户端一次性迁移:旧 localStorage 时间轴 → IndexedDB Y.Doc                                                |
| `src/store/timelineStore.ts`              | 改造:mutation → Y.Doc 事务;observer → 投影;移除 zundo                                                    |
| `src/main.tsx`                            | 启动时调用迁移                                                                                           |

测试文件与源文件同目录 `*.test.ts`(项目约定)。

---

## 约定

- 包管理器 **pnpm**。
- `TimelineContent` 是「进 Y.Doc 的内容」:`Timeline` 去掉 `id`、`isShared`、`everPublished`、`hasLocalChanges`、`serverVersion`、`statusEvents`(派生)、`updatedAt`。本阶段 `projectTimeline` 仍产出完整 `Timeline` 形状(`statusEvents` 置 `[]`、`updatedAt` 由本地元数据填),以免改动 UrI 消费方。
- Y.Doc 事务的 `origin`:本地编辑用字符串常量 `'local'`。
- 提交信息**禁止**出现 "claude"(`.husky/commit-msg` 会拒);不加 Co-Authored-By。

---

## Task 1: 依赖与 Y.Doc 常量、内容类型

**Files:**

- Modify: `package.json`
- Create: `src/collab/constants.ts`
- Create: `src/collab/types.ts`

- [ ] **Step 1: 安装依赖**

Run:

```bash
pnpm add yjs
pnpm add -D fake-indexeddb
```

Expected: `package.json` 出现 `yjs` 与 `fake-indexeddb`,`pnpm-lock.yaml` 更新。

- [ ] **Step 2: 写 Y.Doc 常量**

Create `src/collab/constants.ts`:

```typescript
/** Y.Doc 顶层 Map 名 —— 见设计文档 §4 */
export const Y_MAP = {
  meta: 'meta',
  damageEvents: 'damageEvents',
  castEvents: 'castEvents',
  annotations: 'annotations',
  composition: 'composition',
  statData: 'statData',
} as const

/** 本地 Y.Doc 事务 origin 标记 */
export const LOCAL_ORIGIN = 'local'

/** IndexedDB 数据库名与对象仓库名 */
export const IDB_NAME = 'healerbook_collab'
export const IDB_STORE_SNAPSHOTS = 'snapshots'
export const IDB_STORE_UPDATES = 'updates'

/** 客户端惰性 squash 阈值:updates 条数超过即合并 */
export const CLIENT_SQUASH_THRESHOLD = 100

/** 客户端迁移完成标志位(localStorage key) */
export const MIGRATION_FLAG = 'healerbook_collab_migrated_v1'
```

- [ ] **Step 3: 写内容类型**

Create `src/collab/types.ts`:

```typescript
import type { Timeline } from '@/types/timeline'

/**
 * 进 Y.Doc 的协同内容 —— Timeline 去掉外部寻址 / 本地元数据 / 派生字段。
 * 见设计文档 §4、§10。
 */
export type TimelineContent = Omit<
  Timeline,
  | 'id'
  | 'isShared'
  | 'everPublished'
  | 'hasLocalChanges'
  | 'serverVersion'
  | 'statusEvents'
  | 'updatedAt'
>

/** 本地元数据 —— 不进 Y.Doc,由本地存储层管理 */
export interface LocalDocMeta {
  /** 时间轴 id(外部寻址键) */
  id: string
  /** 是否已发布(本阶段恒为 false) */
  published: boolean
  /** 本地最近修改时间(Unix 秒) */
  updatedAt: number
}
```

- [ ] **Step 4: 提交**

```bash
git add package.json pnpm-lock.yaml src/collab/constants.ts src/collab/types.ts
git commit -m "feat(collab): add yjs dep, Y.Doc constants and content types"
```

---

## Task 2: `buildYDoc()` — TimelineContent → Y.Doc

把一份普通时间轴内容写进一个新 Y.Doc。客户端迁移、新建时间轴、(后续)服务端迁移共用。

**Files:**

- Create: `src/collab/docSchema.ts`
- Test: `src/collab/docSchema.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/collab/docSchema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { buildYDoc } from './docSchema'
import { Y_MAP } from './constants'
import type { TimelineContent } from './types'

const sample: TimelineContent = {
  name: '测试',
  encounter: { id: 1, name: 'E', displayName: 'E', zone: '', damageEvents: [] },
  composition: {
    players: [
      { id: 1, job: 'PLD' },
      { id: 2, job: 'WHM' },
    ],
  },
  damageEvents: [
    { id: 'd1', name: 'AOE', time: 10, damage: 1000, type: 'aoe', damageType: 'magical' },
  ],
  castEvents: [{ id: 'c1', actionId: 100, timestamp: 5, playerId: 1 }],
  annotations: [{ id: 'a1', text: '注释', time: 8, anchor: { type: 'damageTrack' } }],
  createdAt: 1000,
}

describe('buildYDoc', () => {
  it('把内容写进 Y.Doc 的对应 Map', () => {
    const doc = buildYDoc(sample)
    expect(doc.getMap(Y_MAP.meta).get('name')).toBe('测试')
    const de = doc.getMap(Y_MAP.damageEvents)
    expect(de.size).toBe(1)
    expect((de.get('d1') as Y.Map<unknown>).get('damage')).toBe(1000)
    expect(doc.getMap(Y_MAP.castEvents).size).toBe(1)
    expect(doc.getMap(Y_MAP.annotations).size).toBe(1)
    expect((doc.getMap(Y_MAP.composition).get('1') as Y.Map<unknown>).get('job')).toBe('PLD')
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm test:run src/collab/docSchema.test.ts`
Expected: FAIL —— `buildYDoc is not a function`。

- [ ] **Step 3: 实现 `buildYDoc`**

Create `src/collab/docSchema.ts`:

```typescript
import * as Y from 'yjs'
import { Y_MAP, LOCAL_ORIGIN } from './constants'
import type { TimelineContent } from './types'
import type { DamageEvent, CastEvent, Annotation } from '@/types/timeline'

/** meta Map 里存放的标量字段名 */
const META_KEYS = [
  'name',
  'description',
  'encounter',
  'fflogsSource',
  'gameZoneId',
  'syncEvents',
  'isReplayMode',
  'createdAt',
] as const

function entryToYMap(entry: Record<string, unknown>): Y.Map<unknown> {
  const ymap = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(entry)) {
    if (v !== undefined) ymap.set(k, v)
  }
  return ymap
}

/** 把一份时间轴内容构造成新的 Y.Doc(见设计文档 §4) */
export function buildYDoc(content: TimelineContent): Y.Doc {
  const doc = new Y.Doc()
  doc.transact(() => {
    const meta = doc.getMap(Y_MAP.meta)
    for (const key of META_KEYS) {
      const value = (content as Record<string, unknown>)[key]
      if (value !== undefined) meta.set(key, value)
    }

    const de = doc.getMap<Y.Map<unknown>>(Y_MAP.damageEvents)
    for (const ev of content.damageEvents) {
      de.set(ev.id, entryToYMap(ev as unknown as Record<string, unknown>))
    }

    const ce = doc.getMap<Y.Map<unknown>>(Y_MAP.castEvents)
    for (const ev of content.castEvents) {
      ce.set(ev.id, entryToYMap(ev as unknown as Record<string, unknown>))
    }

    const an = doc.getMap<Y.Map<unknown>>(Y_MAP.annotations)
    for (const a of content.annotations ?? []) {
      an.set(a.id, entryToYMap(a as unknown as Record<string, unknown>))
    }

    const comp = doc.getMap<Y.Map<unknown>>(Y_MAP.composition)
    for (const p of content.composition.players) {
      const pm = new Y.Map<unknown>()
      pm.set('job', p.job)
      comp.set(String(p.id), pm)
    }

    if (content.statData) {
      const sd = doc.getMap(Y_MAP.statData)
      for (const [k, v] of Object.entries(content.statData)) {
        if (v !== undefined) sd.set(k, v)
      }
    }
  }, LOCAL_ORIGIN)
  return doc
}

/** 占位:供后续 task 引用,避免 import 报错 —— Task 3 替换 */
export type { DamageEvent, CastEvent, Annotation }
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `pnpm test:run src/collab/docSchema.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/collab/docSchema.ts src/collab/docSchema.test.ts
git commit -m "feat(collab): buildYDoc — timeline content to Y.Doc"
```

---

## Task 3: `projectTimeline()` + sanitizer — Y.Doc → 内容

把 Y.Doc 投影回普通对象,并在读路径强制跨集合不变量(设计文档 §5.2)。本 task 先做全量投影,Task 4 再加引用保持。

**Files:**

- Modify: `src/collab/docSchema.ts`
- Test: `src/collab/docSchema.test.ts`

- [ ] **Step 1: 写失败测试(追加到 docSchema.test.ts)**

```typescript
import { projectTimeline } from './docSchema'

describe('projectTimeline', () => {
  it('round-trip:buildYDoc 后投影回等价内容', () => {
    const doc = buildYDoc(sample)
    const out = projectTimeline(doc)
    expect(out.name).toBe('测试')
    expect(out.damageEvents).toHaveLength(1)
    expect(out.damageEvents[0]).toEqual(sample.damageEvents[0])
    expect(out.castEvents[0]).toEqual(sample.castEvents[0])
    expect(out.composition.players).toEqual(sample.composition.players)
  })

  it('damageEvents / castEvents 按 time 字段升序', () => {
    const doc = buildYDoc({
      ...sample,
      damageEvents: [
        { id: 'd2', name: 'B', time: 30, damage: 1, type: 'aoe', damageType: 'magical' },
        { id: 'd1', name: 'A', time: 10, damage: 1, type: 'aoe', damageType: 'magical' },
      ],
    })
    const out = projectTimeline(doc)
    expect(out.damageEvents.map(e => e.id)).toEqual(['d1', 'd2'])
  })

  it('sanitizer:丢弃 playerId 不在 composition 内的孤儿 castEvent', () => {
    const doc = buildYDoc(sample)
    // 直接往 Y.Doc 塞一个属于不存在玩家 9 的 cast(模拟并发漏网)
    const orphan = new Y.Map<unknown>()
    orphan.set('id', 'c-orphan')
    orphan.set('actionId', 1)
    orphan.set('timestamp', 1)
    orphan.set('playerId', 9)
    doc.getMap<Y.Map<unknown>>(Y_MAP.castEvents).set('c-orphan', orphan)
    const out = projectTimeline(doc)
    expect(out.castEvents.find(c => c.id === 'c-orphan')).toBeUndefined()
    expect(out.castEvents).toHaveLength(1)
  })

  it('sanitizer:丢弃玩家已不在的 skillTrack 注释', () => {
    const doc = buildYDoc(sample)
    const orphan = new Y.Map<unknown>()
    orphan.set('id', 'a-orphan')
    orphan.set('text', 'x')
    orphan.set('time', 1)
    orphan.set('anchor', { type: 'skillTrack', playerId: 9, actionId: 1 })
    doc.getMap<Y.Map<unknown>>(Y_MAP.annotations).set('a-orphan', orphan)
    const out = projectTimeline(doc)
    expect(out.annotations.find(a => a.id === 'a-orphan')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm test:run src/collab/docSchema.test.ts`
Expected: FAIL —— `projectTimeline is not a function`。

- [ ] **Step 3: 实现 `projectTimeline` + sanitizer**

在 `src/collab/docSchema.ts` 末尾追加(并删除 Task 2 末尾的占位 export 行):

```typescript
import type { Timeline, Composition } from '@/types/timeline'

function ymapToObject<T>(ymap: Y.Map<unknown>): T {
  return Object.fromEntries(ymap.entries()) as T
}

/**
 * Y.Doc → Timeline 形状的普通对象。
 * 读路径强制跨集合不变量(sanitizer):丢弃引用了不存在玩家的 castEvent /
 * skillTrack 注释。见设计文档 §5.2。
 */
export function projectTimeline(doc: Y.Doc): Timeline {
  const meta = doc.getMap(Y_MAP.meta)

  const composition: Composition = {
    players: [...doc.getMap<Y.Map<unknown>>(Y_MAP.composition).entries()]
      .map(([id, pm]) => ({
        id: Number(id),
        job: pm.get('job') as Composition['players'][number]['job'],
      }))
      .sort((a, b) => a.id - b.id),
  }
  const playerIds = new Set(composition.players.map(p => p.id))

  const damageEvents = [...doc.getMap<Y.Map<unknown>>(Y_MAP.damageEvents).values()]
    .map(ymap => ymapToObject<DamageEvent>(ymap))
    .sort((a, b) => a.time - b.time)

  const castEvents = [...doc.getMap<Y.Map<unknown>>(Y_MAP.castEvents).values()]
    .map(ymap => ymapToObject<CastEvent>(ymap))
    .filter(c => playerIds.has(c.playerId)) // sanitizer:丢孤儿 cast
    .sort((a, b) => a.timestamp - b.timestamp)

  const annotations = [...doc.getMap<Y.Map<unknown>>(Y_MAP.annotations).values()]
    .map(ymap => ymapToObject<Annotation>(ymap))
    .filter(a => a.anchor.type !== 'skillTrack' || playerIds.has(a.anchor.playerId)) // sanitizer

  const statData =
    doc.getMap(Y_MAP.statData).size > 0
      ? ymapToObject<Timeline['statData']>(doc.getMap(Y_MAP.statData))
      : undefined

  return {
    id: '', // 由调用方(LocalSyncEngine)用本地元数据填
    name: (meta.get('name') as string) ?? '',
    description: meta.get('description') as string | undefined,
    encounter: meta.get('encounter') as Timeline['encounter'],
    fflogsSource: meta.get('fflogsSource') as Timeline['fflogsSource'],
    gameZoneId: meta.get('gameZoneId') as number | undefined,
    syncEvents: meta.get('syncEvents') as Timeline['syncEvents'],
    isReplayMode: meta.get('isReplayMode') as boolean | undefined,
    createdAt: (meta.get('createdAt') as number) ?? 0,
    composition,
    damageEvents,
    castEvents,
    annotations,
    statData,
    statusEvents: [], // 派生,不进 Y.Doc;由消费方重算
    updatedAt: 0, // 由调用方用本地元数据填
  }
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `pnpm test:run src/collab/docSchema.test.ts`
Expected: PASS(全部用例)。

- [ ] **Step 5: 提交**

```bash
git add src/collab/docSchema.ts src/collab/docSchema.test.ts
git commit -m "feat(collab): projectTimeline with cross-collection sanitizer"
```

---

## Task 4: 投影引用保持(Q4)

`projectTimeline` 现在每次全量新建对象。改成接收上一次投影、对未变 entity 复用对象引用,以维持 React memo 不退化(设计文档 §5.1)。

**Files:**

- Modify: `src/collab/docSchema.ts`
- Test: `src/collab/docSchema.test.ts`

- [ ] **Step 1: 写失败测试(追加)**

```typescript
describe('projectTimeline 引用保持', () => {
  it('未变动的 damageEvent 在两次投影间保持同一对象引用', () => {
    const doc = buildYDoc({
      ...sample,
      damageEvents: [
        { id: 'd1', name: 'A', time: 10, damage: 1, type: 'aoe', damageType: 'magical' },
        { id: 'd2', name: 'B', time: 20, damage: 2, type: 'aoe', damageType: 'magical' },
      ],
    })
    const first = projectTimeline(doc)
    // 只改 d2
    ;(doc.getMap<Y.Map<unknown>>(Y_MAP.damageEvents).get('d2') as Y.Map<unknown>).set('damage', 999)
    const second = projectTimeline(doc, first)
    const d1a = first.damageEvents.find(e => e.id === 'd1')
    const d1b = second.damageEvents.find(e => e.id === 'd1')
    expect(d1b).toBe(d1a) // d1 引用未变
    const d2b = second.damageEvents.find(e => e.id === 'd2')
    expect(d2b).not.toBe(first.damageEvents.find(e => e.id === 'd2')) // d2 是新对象
    expect(d2b?.damage).toBe(999)
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm test:run src/collab/docSchema.test.ts -t '引用保持'`
Expected: FAIL —— `d1b` 与 `d1a` 不是同一引用(当前实现每次全新建)。

- [ ] **Step 3: 改实现 —— `projectTimeline` 接收 prev、复用未变 entry**

把 `projectTimeline` 改为:

```typescript
/** 对单个集合做引用保持投影:内容相等的 entry 复用 prev 的对象 */
function projectCollection<T extends { id: string }>(
  ymaps: Iterable<Y.Map<unknown>>,
  prevById: Map<string, T> | undefined
): T[] {
  const out: T[] = []
  for (const ymap of ymaps) {
    const fresh = ymapToObject<T>(ymap)
    const prev = prevById?.get(fresh.id)
    out.push(prev && shallowEqual(prev, fresh) ? prev : fresh)
  }
  return out
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every(k => Object.is(a[k], b[k]))
}

function indexById<T extends { id: string }>(arr: T[] | undefined): Map<string, T> | undefined {
  if (!arr) return undefined
  return new Map(arr.map(x => [x.id, x]))
}
```

然后把 `projectTimeline(doc)` 签名改为 `projectTimeline(doc: Y.Doc, prev?: Timeline)`,三大集合改用 `projectCollection`:

```typescript
const damageEvents = projectCollection<DamageEvent>(
  doc.getMap<Y.Map<unknown>>(Y_MAP.damageEvents).values(),
  indexById(prev?.damageEvents)
).sort((a, b) => a.time - b.time)

const castEvents = projectCollection<CastEvent>(
  doc.getMap<Y.Map<unknown>>(Y_MAP.castEvents).values(),
  indexById(prev?.castEvents)
)
  .filter(c => playerIds.has(c.playerId))
  .sort((a, b) => a.timestamp - b.timestamp)

const annotations = projectCollection<Annotation>(
  doc.getMap<Y.Map<unknown>>(Y_MAP.annotations).values(),
  indexById(prev?.annotations)
).filter(a => a.anchor.type !== 'skillTrack' || playerIds.has(a.anchor.playerId))
```

> 注:`shallowEqual` 对 `playerDamageDetails`、`anchor` 这类引用字段做 `Object.is` 比较 —— 它们是不可变 plain 值,投影时 `ymapToObject` 直接取 Y.Map 内的同一引用,故未变时 `Object.is` 成立。

- [ ] **Step 4: 运行测试,确认通过**

Run: `pnpm test:run src/collab/docSchema.test.ts`
Expected: PASS(含引用保持与之前全部用例)。

- [ ] **Step 5: 提交**

```bash
git add src/collab/docSchema.ts src/collab/docSchema.test.ts
git commit -m "feat(collab): identity-preserving projection patch"
```

---

## Task 5: granular Y.Doc mutators

`timelineStore` 的 mutation 要落到 Y.Doc 上。把每种改动封装成纯函数,单事务、保持嵌套 Y.Map 的 instanceId 语义。

**Files:**

- Modify: `src/collab/docSchema.ts`
- Test: `src/collab/docSchema.test.ts`

- [ ] **Step 1: 写失败测试(追加)**

```typescript
import { yAddDamageEvent, yUpdateDamageEvent, yRemoveDamageEvent } from './docSchema'

describe('granular mutators', () => {
  it('yAddDamageEvent 往集合加一条', () => {
    const doc = buildYDoc(sample)
    yAddDamageEvent(doc, {
      id: 'd9',
      name: 'N',
      time: 50,
      damage: 5,
      type: 'aoe',
      damageType: 'magical',
    })
    expect(projectTimeline(doc).damageEvents.map(e => e.id)).toContain('d9')
  })

  it('yUpdateDamageEvent 只改给定字段、保留其余', () => {
    const doc = buildYDoc(sample)
    yUpdateDamageEvent(doc, 'd1', { time: 99 })
    const d1 = projectTimeline(doc).damageEvents.find(e => e.id === 'd1')!
    expect(d1.time).toBe(99)
    expect(d1.damage).toBe(1000) // 未动
  })

  it('yRemoveDamageEvent 删除一条', () => {
    const doc = buildYDoc(sample)
    yRemoveDamageEvent(doc, 'd1')
    expect(projectTimeline(doc).damageEvents).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm test:run src/collab/docSchema.test.ts -t 'granular mutators'`
Expected: FAIL —— mutator 未定义。

- [ ] **Step 3: 实现 mutators**

在 `src/collab/docSchema.ts` 追加:

```typescript
function mapOf(doc: Y.Doc, name: string) {
  return doc.getMap<Y.Map<unknown>>(name)
}

export function yAddDamageEvent(doc: Y.Doc, ev: DamageEvent): void {
  doc.transact(() => {
    mapOf(doc, Y_MAP.damageEvents).set(ev.id, entryToYMap(ev as unknown as Record<string, unknown>))
  }, LOCAL_ORIGIN)
}

export function yUpdateDamageEvent(doc: Y.Doc, id: string, patch: Partial<DamageEvent>): void {
  doc.transact(() => {
    const ymap = mapOf(doc, Y_MAP.damageEvents).get(id)
    if (!ymap) return
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) ymap.set(k, v)
    }
  }, LOCAL_ORIGIN)
}

export function yRemoveDamageEvent(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    mapOf(doc, Y_MAP.damageEvents).delete(id)
  }, LOCAL_ORIGIN)
}
```

> castEvent / annotation 的 add/update/remove mutator 形态完全相同,只是 Map 名换成 `Y_MAP.castEvents` / `Y_MAP.annotations`。在本 step 一并实现 `yAddCastEvent` / `yUpdateCastEvent` / `yRemoveCastEvent` / `yAddAnnotation` / `yUpdateAnnotation` / `yRemoveAnnotation`,代码与上面三个等价(逐字替换 Map 名与类型)。

- [ ] **Step 4: 实现 meta / composition / statData mutators**

继续追加:

```typescript
/** 改 meta 标量字段(name/description/isReplayMode 等) */
export function ySetMeta(doc: Y.Doc, patch: Record<string, unknown>): void {
  doc.transact(() => {
    const meta = doc.getMap(Y_MAP.meta)
    for (const [k, v] of Object.entries(patch)) meta.set(k, v)
  }, LOCAL_ORIGIN)
}

/**
 * 替换阵容,并级联清理:删掉不在新阵容的玩家的 castEvent / skillTrack 注释。
 * statData 的清理交由调用方在同事务内补充(本阶段先做引用清理)。
 */
export function yReplaceComposition(doc: Y.Doc, players: { id: number; job: string }[]): void {
  doc.transact(() => {
    const comp = mapOf(doc, Y_MAP.composition)
    const keep = new Set(players.map(p => String(p.id)))
    for (const key of [...comp.keys()]) {
      if (!keep.has(key)) comp.delete(key)
    }
    for (const p of players) {
      let pm = comp.get(String(p.id))
      if (!pm) {
        pm = new Y.Map<unknown>()
        comp.set(String(p.id), pm)
      }
      pm.set('job', p.job)
    }
    const keepIds = new Set(players.map(p => p.id))
    const ce = mapOf(doc, Y_MAP.castEvents)
    for (const [id, cm] of [...ce.entries()]) {
      if (!keepIds.has(cm.get('playerId') as number)) ce.delete(id)
    }
    const an = mapOf(doc, Y_MAP.annotations)
    for (const [id, am] of [...an.entries()]) {
      const anchor = am.get('anchor') as { type: string; playerId?: number }
      if (anchor?.type === 'skillTrack' && !keepIds.has(anchor.playerId!)) an.delete(id)
    }
  }, LOCAL_ORIGIN)
}

/** 整体替换 statData */
export function yReplaceStatData(doc: Y.Doc, statData: Record<string, unknown>): void {
  doc.transact(() => {
    const sd = doc.getMap(Y_MAP.statData)
    for (const key of [...sd.keys()]) sd.delete(key)
    for (const [k, v] of Object.entries(statData)) {
      if (v !== undefined) sd.set(k, v)
    }
  }, LOCAL_ORIGIN)
}
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `pnpm test:run src/collab/docSchema.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/collab/docSchema.ts src/collab/docSchema.test.ts
git commit -m "feat(collab): granular Y.Doc mutators"
```

---

## Task 6: CRDT 收敛测试

验证并发分叉编辑合并后投影一致(设计文档 §12)。这是协同正确性核心,纯 Yjs 测试。

**Files:**

- Test: `src/collab/convergence.test.ts`

- [ ] **Step 1: 写测试**

Create `src/collab/convergence.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { buildYDoc, projectTimeline, yUpdateDamageEvent, yAddCastEvent } from './docSchema'
import type { TimelineContent } from './types'

const base: TimelineContent = {
  name: 'base',
  encounter: { id: 1, name: 'E', displayName: 'E', zone: '', damageEvents: [] },
  composition: { players: [{ id: 1, job: 'PLD' }] },
  damageEvents: [
    { id: 'd1', name: 'A', time: 10, damage: 100, type: 'aoe', damageType: 'magical' },
  ],
  castEvents: [],
  annotations: [],
  createdAt: 0,
}

/** 从同一基线 update 派生两个 Y.Doc(共同祖先) */
function fork(content: TimelineContent): [Y.Doc, Y.Doc] {
  const seed = Y.encodeStateAsUpdate(buildYDoc(content))
  const a = new Y.Doc()
  Y.applyUpdate(a, seed)
  const b = new Y.Doc()
  Y.applyUpdate(b, seed)
  return [a, b]
}

function syncBothWays(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
}

describe('CRDT 收敛', () => {
  it('两端改同一事件的不同字段 → 合并后都保留', () => {
    const [a, b] = fork(base)
    yUpdateDamageEvent(a, 'd1', { time: 99 })
    yUpdateDamageEvent(b, 'd1', { damage: 555 })
    syncBothWays(a, b)
    const pa = projectTimeline(a).damageEvents[0]
    const pb = projectTimeline(b).damageEvents[0]
    expect(pa).toEqual(pb)
    expect(pa.time).toBe(99)
    expect(pa.damage).toBe(555)
  })

  it('两端各加不同 castEvent → 合并后都在', () => {
    const [a, b] = fork(base)
    yAddCastEvent(a, { id: 'ca', actionId: 1, timestamp: 1, playerId: 1 })
    yAddCastEvent(b, { id: 'cb', actionId: 2, timestamp: 2, playerId: 1 })
    syncBothWays(a, b)
    expect(
      projectTimeline(a)
        .castEvents.map(c => c.id)
        .sort()
    ).toEqual(['ca', 'cb'])
    expect(
      projectTimeline(b)
        .castEvents.map(c => c.id)
        .sort()
    ).toEqual(['ca', 'cb'])
  })
})
```

- [ ] **Step 2: 运行测试,确认通过**

Run: `pnpm test:run src/collab/convergence.test.ts`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add src/collab/convergence.test.ts
git commit -m "test(collab): CRDT convergence tests"
```

---

## Task 7: `IndexedDBDocStore` — append + load

本地 snapshot + updates 双表。

**Files:**

- Create: `src/collab/storage/IndexedDBDocStore.ts`
- Test: `src/collab/storage/IndexedDBDocStore.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/collab/storage/IndexedDBDocStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import * as Y from 'yjs'
import { IndexedDBDocStore } from './IndexedDBDocStore'

function freshDoc(name: string): Uint8Array {
  const d = new Y.Doc()
  d.getMap('meta').set('name', name)
  return Y.encodeStateAsUpdate(d)
}

describe('IndexedDBDocStore', () => {
  let store: IndexedDBDocStore
  beforeEach(async () => {
    indexedDB = new IDBFactory() // fake-indexeddb:每个用例独立 DB
    store = new IndexedDBDocStore()
    await store.open()
  })

  it('appendUpdate 后 loadDoc 能读回内容', async () => {
    await store.appendUpdate('t1', freshDoc('hello'))
    const bin = await store.loadDoc('t1')
    expect(bin).not.toBeNull()
    const d = new Y.Doc()
    Y.applyUpdate(d, bin!)
    expect(d.getMap('meta').get('name')).toBe('hello')
  })

  it('loadDoc 对不存在的 id 返回 null', async () => {
    expect(await store.loadDoc('nope')).toBeNull()
  })

  it('多条 update 合并读回', async () => {
    const d = new Y.Doc()
    d.getMap('meta').set('name', 'a')
    await store.appendUpdate('t1', Y.encodeStateAsUpdate(d))
    d.getMap('meta').set('extra', 1)
    await store.appendUpdate('t1', Y.encodeStateAsUpdate(d))
    const out = new Y.Doc()
    Y.applyUpdate(out, (await store.loadDoc('t1'))!)
    expect(out.getMap('meta').get('extra')).toBe(1)
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm test:run src/collab/storage/IndexedDBDocStore.test.ts`
Expected: FAIL —— `IndexedDBDocStore` 未定义。

- [ ] **Step 3: 实现**

Create `src/collab/storage/IndexedDBDocStore.ts`:

```typescript
import * as Y from 'yjs'
import {
  IDB_NAME,
  IDB_STORE_SNAPSHOTS,
  IDB_STORE_UPDATES,
  CLIENT_SQUASH_THRESHOLD,
} from '../constants'

interface SnapshotRow {
  docId: string
  bin: Uint8Array
  updatedAt: number
}
interface UpdateRow {
  docId: string
  seq: number
  bin: Uint8Array
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 本地 snapshot + updates 双表(设计文档 §5.3) */
export class IndexedDBDocStore {
  private db: IDBDatabase | null = null

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IDB_STORE_SNAPSHOTS)) {
          db.createObjectStore(IDB_STORE_SNAPSHOTS, { keyPath: 'docId' })
        }
        if (!db.objectStoreNames.contains(IDB_STORE_UPDATES)) {
          const us = db.createObjectStore(IDB_STORE_UPDATES, {
            keyPath: ['docId', 'seq'],
          })
          us.createIndex('docId', 'docId', { unique: false })
        }
      }
      req.onsuccess = () => {
        this.db = req.result
        resolve()
      }
      req.onerror = () => reject(req.error)
    })
  }

  private tx(stores: string[], mode: IDBTransactionMode): IDBTransaction {
    if (!this.db) throw new Error('IndexedDBDocStore not opened')
    return this.db.transaction(stores, mode)
  }

  /** append 一条 update;若 updates 累积超阈值则惰性 squash */
  async appendUpdate(docId: string, bin: Uint8Array): Promise<void> {
    const tx = this.tx([IDB_STORE_UPDATES], 'readwrite')
    const us = tx.objectStore(IDB_STORE_UPDATES)
    const existing = (await reqToPromise(us.index('docId').getAll(docId))) as UpdateRow[]
    const seq = existing.length === 0 ? 0 : Math.max(...existing.map(r => r.seq)) + 1
    await reqToPromise(us.put({ docId, seq, bin } as UpdateRow))
    if (existing.length + 1 > CLIENT_SQUASH_THRESHOLD) {
      await this.squash(docId)
    }
  }

  /** 读 doc:snapshot + 所有 updates 合并 */
  async loadDoc(docId: string): Promise<Uint8Array | null> {
    const tx = this.tx([IDB_STORE_SNAPSHOTS, IDB_STORE_UPDATES], 'readonly')
    const snap = (await reqToPromise(tx.objectStore(IDB_STORE_SNAPSHOTS).get(docId))) as
      | SnapshotRow
      | undefined
    const updates = (await reqToPromise(
      tx.objectStore(IDB_STORE_UPDATES).index('docId').getAll(docId)
    )) as UpdateRow[]
    if (!snap && updates.length === 0) return null
    const parts: Uint8Array[] = []
    if (snap) parts.push(snap.bin)
    updates.sort((a, b) => a.seq - b.seq).forEach(u => parts.push(u.bin))
    return Y.mergeUpdates(parts)
  }

  /** squash:snapshot + updates → 新 snapshot,清空 updates(Task 8 完善) */
  async squash(_docId: string): Promise<void> {
    // Task 8 实现
  }
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `pnpm test:run src/collab/storage/IndexedDBDocStore.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/collab/storage/IndexedDBDocStore.ts src/collab/storage/IndexedDBDocStore.test.ts
git commit -m "feat(collab): IndexedDBDocStore append + load"
```

---

## Task 8: `IndexedDBDocStore` — squash

**Files:**

- Modify: `src/collab/storage/IndexedDBDocStore.ts`
- Test: `src/collab/storage/IndexedDBDocStore.test.ts`

- [ ] **Step 1: 写失败测试(追加)**

```typescript
it('squash 后 updates 清空、内容不丢', async () => {
  const d = new Y.Doc()
  for (let i = 0; i < 5; i++) {
    d.getMap('meta').set('k' + i, i)
    await store.appendUpdate('t1', Y.encodeStateAsUpdate(d))
  }
  await store.squash('t1')
  const out = new Y.Doc()
  Y.applyUpdate(out, (await store.loadDoc('t1'))!)
  expect(out.getMap('meta').get('k4')).toBe(4)
  // squash 后 updates 表应为空 —— 再 append 一条,loadDoc 仍正确
  d.getMap('meta').set('k9', 9)
  await store.appendUpdate('t1', Y.encodeStateAsUpdate(d))
  const out2 = new Y.Doc()
  Y.applyUpdate(out2, (await store.loadDoc('t1'))!)
  expect(out2.getMap('meta').get('k9')).toBe(9)
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm test:run src/collab/storage/IndexedDBDocStore.test.ts -t squash`
Expected: FAIL —— squash 当前是空实现,后续 append 的 seq 计算会因残留 update 错乱 / 或断言 `k9` 时序问题。

- [ ] **Step 3: 实现 `squash`**

替换 `squash` 方法:

```typescript
async squash(docId: string): Promise<void> {
  const merged = await this.loadDoc(docId)
  if (!merged) return
  const tx = this.tx([IDB_STORE_SNAPSHOTS, IDB_STORE_UPDATES], 'readwrite')
  await reqToPromise(
    tx.objectStore(IDB_STORE_SNAPSHOTS).put({
      docId,
      bin: merged,
      updatedAt: Date.now(),
    } as SnapshotRow)
  )
  const us = tx.objectStore(IDB_STORE_UPDATES)
  const keys = (await reqToPromise(
    us.index('docId').getAllKeys(docId)
  )) as IDBValidKey[]
  for (const key of keys) await reqToPromise(us.delete(key))
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `pnpm test:run src/collab/storage/IndexedDBDocStore.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/collab/storage/IndexedDBDocStore.ts src/collab/storage/IndexedDBDocStore.test.ts
git commit -m "feat(collab): IndexedDBDocStore lazy squash"
```

---

## Task 9: `LocalSyncEngine` — 串起 Y.Doc + 存储 + 撤销

**Files:**

- Create: `src/collab/LocalSyncEngine.ts`
- Test: `src/collab/LocalSyncEngine.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/collab/LocalSyncEngine.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { LocalSyncEngine } from './LocalSyncEngine'
import { buildYDoc } from './docSchema'
import { yAddCastEvent, projectTimeline } from './docSchema'
import type { TimelineContent } from './types'

const content: TimelineContent = {
  name: 'eng',
  encounter: { id: 1, name: 'E', displayName: 'E', zone: '', damageEvents: [] },
  composition: { players: [{ id: 1, job: 'PLD' }] },
  damageEvents: [],
  castEvents: [],
  annotations: [],
  createdAt: 0,
}

describe('LocalSyncEngine', () => {
  beforeEach(() => {
    indexedDB = new IDBFactory()
  })

  it('本地编辑会持久化,重开引擎能读回', async () => {
    const e1 = await LocalSyncEngine.create('t1', buildYDoc(content))
    yAddCastEvent(e1.doc, { id: 'c1', actionId: 1, timestamp: 1, playerId: 1 })
    await e1.flush() // 等持久化完成
    e1.destroy()

    const e2 = await LocalSyncEngine.create('t1')
    expect(projectTimeline(e2.doc).castEvents.map(c => c.id)).toEqual(['c1'])
  })

  it('undo 撤销本地编辑', async () => {
    const e = await LocalSyncEngine.create('t2', buildYDoc(content))
    yAddCastEvent(e.doc, { id: 'c1', actionId: 1, timestamp: 1, playerId: 1 })
    expect(projectTimeline(e.doc).castEvents).toHaveLength(1)
    e.undoManager.undo()
    expect(projectTimeline(e.doc).castEvents).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm test:run src/collab/LocalSyncEngine.test.ts`
Expected: FAIL —— `LocalSyncEngine` 未定义。

- [ ] **Step 3: 实现**

Create `src/collab/LocalSyncEngine.ts`:

```typescript
import * as Y from 'yjs'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
import { Y_MAP, LOCAL_ORIGIN } from './constants'

/**
 * 本地同步引擎(阶段 1:无 remote)。
 * 持有 Y.Doc、本地持久化、UndoManager;把本地 update 落 IndexedDB。
 */
export class LocalSyncEngine {
  readonly doc: Y.Doc
  readonly undoManager: Y.UndoManager
  private readonly store: IndexedDBDocStore
  private pending: Promise<void> = Promise.resolve()

  private constructor(
    readonly docId: string,
    doc: Y.Doc,
    store: IndexedDBDocStore
  ) {
    this.doc = doc
    this.store = store
    this.undoManager = new Y.UndoManager(
      [
        Y_MAP.meta,
        Y_MAP.damageEvents,
        Y_MAP.castEvents,
        Y_MAP.annotations,
        Y_MAP.composition,
        Y_MAP.statData,
      ].map(n => doc.getMap(n)),
      { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 400 }
    )
    this.doc.on('update', this.onUpdate)
  }

  /**
   * 打开一条时间轴。
   * @param seed 仅在新建时间轴时传入(本地无持久化数据时用作初始 Y.Doc)
   */
  static async create(docId: string, seed?: Y.Doc): Promise<LocalSyncEngine> {
    const store = new IndexedDBDocStore()
    await store.open()
    const persisted = await store.loadDoc(docId)
    const doc = new Y.Doc()
    if (persisted) {
      Y.applyUpdate(doc, persisted, 'persisted')
    } else if (seed) {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed), 'persisted')
    }
    return new LocalSyncEngine(docId, doc, store)
  }

  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === 'persisted') return // 来自加载,无需再落盘
    this.pending = this.pending.then(() => this.store.appendUpdate(this.docId, update))
  }

  /** 等所有待持久化的 update 落盘 */
  flush(): Promise<void> {
    return this.pending
  }

  destroy(): void {
    this.doc.off('update', this.onUpdate)
    this.undoManager.destroy()
  }
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `pnpm test:run src/collab/LocalSyncEngine.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/collab/LocalSyncEngine.ts src/collab/LocalSyncEngine.test.ts
git commit -m "feat(collab): LocalSyncEngine — Y.Doc + IndexedDB + UndoManager"
```

---

## Task 10: `timelineStore` 改造为投影层

把 store 的 mutation 改成 Y.Doc 事务、用 observer 投影、移除 zundo。

**Files:**

- Modify: `src/store/timelineStore.ts`
- Modify: `src/store/timelineStore.test.ts`

- [ ] **Step 1: 读现有测试与消费方,确认改造面**

Run: `pnpm exec grep -rl "useTimelineStore.temporal" src/`
Expected: 列出所有引用 `temporal`(zundo)的文件 —— 这些引用都要随本 task 移除或改写。逐一记录。

- [ ] **Step 2: 改造 `timelineStore.ts`**

把 `timelineStore.ts` 改为:store 内部持有一个 `LocalSyncEngine`;`timeline` 字段是投影结果;mutation action 调 `docSchema` 的 mutator。完整骨架:

```typescript
import { create } from 'zustand'
import type { Timeline, DamageEvent, CastEvent, Annotation, Composition } from '@/types/timeline'
import { LocalSyncEngine } from '@/collab/LocalSyncEngine'
import { buildYDoc } from '@/collab/docSchema'
import {
  projectTimeline,
  yAddDamageEvent,
  yUpdateDamageEvent,
  yRemoveDamageEvent,
  yAddCastEvent,
  yUpdateCastEvent,
  yRemoveCastEvent,
  yAddAnnotation,
  yUpdateAnnotation,
  yRemoveAnnotation,
  ySetMeta,
  yReplaceComposition,
} from '@/collab/docSchema'
import type { TimelineContent } from '@/collab/types'

interface TimelineState {
  engine: LocalSyncEngine | null
  timeline: Timeline | null
  // ...沿用原有 UI 态字段:selectedEventId / currentTime / zoomLevel 等

  /** 打开一条时间轴(替代原 setTimeline) */
  openTimeline: (docId: string, seedContent?: TimelineContent) => Promise<void>
  addDamageEvent: (event: DamageEvent) => void
  updateDamageEvent: (id: string, updates: Partial<DamageEvent>) => void
  removeDamageEvent: (id: string) => void
  // ...castEvent / annotation 同形
  updateComposition: (composition: Composition) => void
  undo: () => void
  redo: () => void
  reset: () => void
}

export const useTimelineStore = create<TimelineState>()((set, get) => {
  /** observer:Y.Doc 变更 → 重投影(引用保持) */
  const reproject = () => {
    const engine = get().engine
    if (!engine) return
    const prev = get().timeline ?? undefined
    const next = projectTimeline(engine.doc, prev)
    next.id = engine.docId
    set({ timeline: next })
  }

  return {
    engine: null,
    timeline: null,
    // ...UI 态初值

    openTimeline: async (docId, seedContent) => {
      get().engine?.destroy()
      const engine = await LocalSyncEngine.create(
        docId,
        seedContent ? buildYDoc(seedContent) : undefined
      )
      engine.doc.on('update', reproject)
      set({ engine })
      reproject()
    },

    addDamageEvent: event => yAddDamageEvent(get().engine!.doc, event),
    updateDamageEvent: (id, updates) => yUpdateDamageEvent(get().engine!.doc, id, updates),
    removeDamageEvent: id => yRemoveDamageEvent(get().engine!.doc, id),
    // ...castEvent / annotation action 同形,调对应 mutator

    updateComposition: composition => yReplaceComposition(get().engine!.doc, composition.players),

    undo: () => get().engine?.undoManager.undo(),
    redo: () => get().engine?.undoManager.redo(),

    reset: () => {
      get().engine?.destroy()
      set({ engine: null, timeline: null /* ...UI 态初值 */ })
    },
  }
})
```

> mutation action 不再 `set` —— 改动经 Y.Doc `update` 事件 → `reproject` → `set({ timeline })` 流回。UI 态字段(`currentTime` 等)沿用原 `set` 写法,不变。

- [ ] **Step 3: 改写 `timelineStore.test.ts`**

把测试里 `useTimelineStore.temporal.getState().clear()` 全部删除;`setTimeline(mockTimeline)` 改为 `await openTimeline('test-timeline', mockContent)`(`mockContent` 为去掉 `id` 等字段的 `mockTimeline`)。`beforeEach` 引入 `import 'fake-indexeddb/auto'` 与 `indexedDB = new IDBFactory()`。逐个断言改为投影后的 `get().timeline`。

- [ ] **Step 4: 运行测试,确认通过**

Run: `pnpm test:run src/store/timelineStore.test.ts`
Expected: PASS。

- [ ] **Step 5: 全量类型检查与 lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 0 error。若有消费方仍引用 `temporal` / 已删字段,在此修正。

- [ ] **Step 6: 提交**

```bash
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "refactor(store): timelineStore as Y.Doc projection, drop zundo"
```

---

## Task 11: 客户端一次性迁移 + 启动接线

把存量 `localStorage` 时间轴一次性迁进 IndexedDB Y.Doc(设计文档 §9.2)。本阶段所有本地时间轴都是纯本地,全部迁移。

**Files:**

- Create: `src/collab/migration.ts`
- Test: `src/collab/migration.test.ts`
- Modify: `src/main.tsx`

- [ ] **Step 1: 写失败测试**

Create `src/collab/migration.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import * as Y from 'yjs'
import { runClientMigration } from './migration'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
import { MIGRATION_FLAG } from './constants'
import { projectTimeline } from './docSchema'

describe('runClientMigration', () => {
  beforeEach(() => {
    indexedDB = new IDBFactory()
    localStorage.clear()
  })

  it('把旧 localStorage 时间轴迁进 IndexedDB,并置标志位', async () => {
    // 旧格式:元数据列表 + 单条 timeline(V2 LocalStored)
    localStorage.setItem(
      'healerbook_timelines',
      JSON.stringify([{ id: 'old1', name: 'Old', encounterId: '1', createdAt: 0, updatedAt: 0 }])
    )
    localStorage.setItem(
      'healerbook_timelines_old1',
      JSON.stringify({
        v: 2,
        n: 'Old',
        e: 1,
        c: [],
        de: [],
        ce: { a: [], t: [], p: [] },
        ca: 0,
        ua: 0,
      })
    )

    await runClientMigration()

    expect(localStorage.getItem(MIGRATION_FLAG)).toBe('1')
    const store = new IndexedDBDocStore()
    await store.open()
    const bin = await store.loadDoc('old1')
    expect(bin).not.toBeNull()
    const d = new Y.Doc()
    Y.applyUpdate(d, bin!)
    expect(projectTimeline(d).name).toBe('Old')
  })

  it('已迁移过则跳过', async () => {
    localStorage.setItem(MIGRATION_FLAG, '1')
    localStorage.setItem('healerbook_timelines', JSON.stringify([{ id: 'x' }]))
    await runClientMigration() // 不应抛错、不应处理
    const store = new IndexedDBDocStore()
    await store.open()
    expect(await store.loadDoc('x')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm test:run src/collab/migration.test.ts`
Expected: FAIL —— `runClientMigration` 未定义。

- [ ] **Step 3: 实现**

Create `src/collab/migration.ts`:

```typescript
import { getAllTimelineMetadata, getTimeline } from '@/utils/timelineStorage'
import { buildYDoc } from './docSchema'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
import { MIGRATION_FLAG } from './constants'
import type { TimelineContent } from './types'
import type { Timeline } from '@/types/timeline'

function toContent(t: Timeline): TimelineContent {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const {
    id,
    isShared,
    everPublished,
    hasLocalChanges,
    serverVersion,
    statusEvents,
    updatedAt,
    ...content
  } = t
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return content
}

/**
 * 客户端一次性迁移:旧 localStorage 时间轴 → IndexedDB Y.Doc。
 * 幂等 —— 靠 MIGRATION_FLAG 标志位保证只跑一次。
 */
export async function runClientMigration(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG)) return

  const store = new IndexedDBDocStore()
  await store.open()

  for (const meta of getAllTimelineMetadata()) {
    try {
      const timeline = getTimeline(meta.id)
      if (!timeline) continue
      const doc = buildYDoc(toContent(timeline))
      await store.appendUpdate(meta.id, encodeDoc(doc))
    } catch (err) {
      console.error('[collab-migration] 跳过损坏条目', meta.id, err)
    }
  }

  localStorage.setItem(MIGRATION_FLAG, '1')
}

function encodeDoc(doc: import('yjs').Doc): Uint8Array {
  return encodeStateAsUpdate(doc)
}

import { encodeStateAsUpdate } from 'yjs'
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `pnpm test:run src/collab/migration.test.ts`
Expected: PASS。

- [ ] **Step 5: 启动时调用迁移**

在 `src/main.tsx` 渲染 React 树之前接线:

```typescript
import { runClientMigration } from '@/collab/migration'

await runClientMigration()
// ...随后 ReactDOM.createRoot(...).render(...)
```

若 `main.tsx` 当前不是顶层 `await` 结构,用 `runClientMigration().then(() => { /* render */ })` 包裹渲染。

- [ ] **Step 6: 类型检查 + lint + 全量测试**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test:run`
Expected: 全 0 error、全部测试 PASS。

- [ ] **Step 7: 提交**

```bash
git add src/collab/migration.ts src/collab/migration.test.ts src/main.tsx
git commit -m "feat(collab): one-time client migration to Y.Doc storage"
```

---

## 阶段 1 完成验收

- [ ] `pnpm test:run` 全绿。
- [ ] `pnpm exec tsc --noEmit` 0 error。
- [ ] `pnpm lint` 0 error。
- [ ] `pnpm build` 成功。
- [ ] 手动:编辑器可新建/打开时间轴、增删改伤害事件/cast/注释、撤销重做生效、刷新页面数据不丢、断网下编辑正常。

产出:一个 Y.Doc 支撑、IndexedDB 持久化的离线优先编辑器。引擎 N=0,无服务端。阶段 2 在此基础上接入 Durable Object 与 WebSocket。

---

## 自审记录

- **Spec 覆盖**:本计划覆盖 spec §13 阶段 1 的全部条目(Y.Doc schema、docSchema、投影改造、`Y.UndoManager`、IndexedDBDocStore 双表、惰性 squash、客户端一次性迁移)。§4 schema → Task 2/3;§5.1 投影引用保持 → Task 4;§5.2 sanitizer → Task 3;§5.3 存储/引擎 → Task 7/8/9;§5.4 撤销 → Task 9;§9.2 迁移 → Task 11;§12 测试 → Task 6 及各 task 的测试步骤。
- **未覆盖(属后续阶段,符合预期)**:DO、WebSocket、鉴权、KV 缓存、awareness、服务端迁移、`Timeline` 类型彻底拆分(本阶段以 `TimelineContent` 引入但 `projectTimeline` 仍产出兼容 `Timeline`)。
- **占位符扫描**:无 TBD/TODO;Task 7 的 `squash` 空实现是有意为之,由 Task 8 在同文件补全,已在 Task 7 Step 3 注明。
- **类型一致性**:`buildYDoc` / `projectTimeline` / mutators 的签名在 Task 2–5、9、10、11 间一致;`TimelineContent`(Task 1)被 Task 2/6/10/11 一致引用;`LocalSyncEngine.create` 签名在 Task 9 定义、Task 10 一致使用。
