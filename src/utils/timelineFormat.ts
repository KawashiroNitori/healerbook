/**
 * Timeline 持久化格式转换层。
 *
 * 职责：
 * - toV2 / hydrateFromV2：内存 Timeline ↔ V2
 * - serializeForServer：POST/PUT 用（不含运行时字段）
 * - toLocalStored：localStorage 用（V2 + 运行时元数据扁平内联）
 * - migrateV1ToV2 / parseFromAny：V1 遗留格式迁移 + 统一入站入口
 *
 * 设计：design/superpowers/specs/2026-04-16-timeline-format-v2-design.md
 */

import type {
  Annotation,
  CastEvent,
  Composition,
  DamageEvent,
  DamageEventType,
  DamageType,
  Job,
  PlayerDamageDetail,
  StatusSnapshot,
  SyncEvent,
  Timeline,
} from '@/types/timeline'
import { MAX_PARTY_SIZE } from '@/types/timeline'
import type {
  V2Annotation,
  V2CastEvents,
  V2DamageEvent,
  V2PlayerDamageDetail,
  V2StatusSnapshot,
  V2SyncEvent,
  V2Timeline,
} from '@/types/timelineV2'
import { getEncounterById } from '@/data/raidEncounters'
import { generateId } from '@/utils/id'
import { nextShortId, resetIdCounter } from '@/utils/shortId'

// ──────────────────────────────────────────────────────────────
// 枚举映射
// ──────────────────────────────────────────────────────────────

const DAMAGE_EVENT_TYPE_TO_NUM: Record<DamageEventType, 0 | 1> = {
  aoe: 0,
  tankbuster: 1,
}
const NUM_TO_DAMAGE_EVENT_TYPE: readonly DamageEventType[] = ['aoe', 'tankbuster']

const DAMAGE_TYPE_TO_NUM: Record<DamageType, 0 | 1 | 2> = {
  physical: 0,
  magical: 1,
  darkness: 2,
}
const NUM_TO_DAMAGE_TYPE: readonly DamageType[] = ['physical', 'magical', 'darkness']

const SYNC_TYPE_TO_NUM: Record<'begincast' | 'cast', 0 | 1> = {
  begincast: 0,
  cast: 1,
}
const NUM_TO_SYNC_TYPE: readonly ('begincast' | 'cast')[] = ['begincast', 'cast']

// ──────────────────────────────────────────────────────────────
// 内存 → V2
// ──────────────────────────────────────────────────────────────

function toV2StatusSnapshot(s: StatusSnapshot): V2StatusSnapshot {
  const out: V2StatusSnapshot = { s: s.statusId }
  if (s.absorb !== undefined) out.ab = s.absorb
  return out
}

function toV2PlayerDamageDetail(
  d: PlayerDamageDetail,
  remap: Map<number, number>
): V2PlayerDamageDetail {
  // 剥离 job 和 abilityId（内存保留但 V2 不持久化）
  const out: V2PlayerDamageDetail = {
    ts: d.timestamp,
    p: remap.get(d.playerId) ?? d.playerId,
    u: d.unmitigatedDamage,
    f: d.finalDamage,
    ss: d.statuses.map(toV2StatusSnapshot),
  }
  if (d.overkill !== undefined) out.o = d.overkill
  if (d.multiplier !== undefined) out.m = d.multiplier
  if (d.hitPoints !== undefined) out.hp = d.hitPoints
  if (d.maxHitPoints !== undefined) out.mhp = d.maxHitPoints
  return out
}

function toV2DamageEvent(e: DamageEvent, remap: Map<number, number>): V2DamageEvent {
  // 剥离 packetId（内存保留但 V2 不持久化）
  const out: V2DamageEvent = {
    n: e.name,
    t: e.time,
    d: e.damage,
    ty: DAMAGE_EVENT_TYPE_TO_NUM[e.type],
    dt: DAMAGE_TYPE_TO_NUM[e.damageType],
  }
  if (e.snapshotTime !== undefined) out.st = e.snapshotTime
  if (e.playerDamageDetails && e.playerDamageDetails.length > 0) {
    out.pdd = e.playerDamageDetails.map(d => toV2PlayerDamageDetail(d, remap))
  }
  return out
}

function toV2CastEvents(events: CastEvent[], remap: Map<number, number>): V2CastEvents {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
  return {
    a: sorted.map(e => e.actionId),
    t: sorted.map(e => e.timestamp),
    p: sorted.map(e => remap.get(e.playerId) ?? e.playerId),
  }
}

function toV2Annotation(a: Annotation, remap: Map<number, number>): V2Annotation {
  return {
    x: a.text,
    t: a.time,
    k:
      a.anchor.type === 'damageTrack'
        ? 0
        : [remap.get(a.anchor.playerId) ?? a.anchor.playerId, a.anchor.actionId],
  }
}

function toV2SyncEvent(e: SyncEvent): V2SyncEvent {
  const out: V2SyncEvent = {
    t: e.time,
    ty: SYNC_TYPE_TO_NUM[e.type],
    a: e.actionId,
    w: e.window,
  }
  if (e.actionName) out.nm = e.actionName
  if (e.syncOnce) out.so = 1
  return out
}

/** 最小化 composition 接口，同时兼容 V1（job: string）和内存（job: Job） */
interface CompositionLike {
  players: ReadonlyArray<{ id: number; job: string }>
}

/**
 * 构建 playerId 重映射表：原始 id → 0..N-1 连续索引。
 * 按原始 id 升序排列，确保映射稳定。
 */
function buildPlayerIdRemap(c: CompositionLike): Map<number, number> {
  const sorted = [...c.players].sort((a, b) => a.id - b.id)
  const remap = new Map<number, number>()
  sorted.forEach((p, i) => remap.set(p.id, i))
  return remap
}

function compositionToV2(c: CompositionLike, remap: Map<number, number>): string[] {
  const slots = Array<string>(MAX_PARTY_SIZE).fill('')
  for (const p of c.players) {
    const idx = remap.get(p.id) ?? p.id
    if (idx >= 0 && idx < MAX_PARTY_SIZE) {
      slots[idx] = p.job
    }
  }
  // 尾部 truncate
  let lastNonEmpty = slots.length - 1
  while (lastNonEmpty >= 0 && slots[lastNonEmpty] === '') lastNonEmpty--
  return slots.slice(0, lastNonEmpty + 1)
}

export function toV2(timeline: Timeline): V2Timeline {
  const remap = buildPlayerIdRemap(timeline.composition)
  const out: V2Timeline = {
    v: 2,
    n: timeline.name,
    e: timeline.encounter.id,
    c: compositionToV2(timeline.composition, remap),
    de: timeline.damageEvents.map(e => toV2DamageEvent(e, remap)),
    ce: toV2CastEvents(timeline.castEvents, remap),
    ca: timeline.createdAt,
    ua: timeline.updatedAt,
  }
  if (timeline.description !== undefined) out.desc = timeline.description
  if (timeline.fflogsSource) {
    out.fs = {
      rc: timeline.fflogsSource.reportCode,
      fi: timeline.fflogsSource.fightId,
    }
  }
  if (timeline.gameZoneId !== undefined) out.gz = timeline.gameZoneId
  const an = (timeline.annotations ?? []).map(a => toV2Annotation(a, remap))
  if (an.length > 0) out.an = an
  const se = (timeline.syncEvents ?? []).map(toV2SyncEvent)
  if (se.length > 0) out.se = se
  if (timeline.isReplayMode) out.r = 1
  if (timeline.statData !== undefined) out.sd = timeline.statData
  return out
}

export const serializeForServer = toV2

// ──────────────────────────────────────────────────────────────
// 本地存储形态
// ──────────────────────────────────────────────────────────────

export interface LocalStored extends V2Timeline {
  id: string
  isShared?: boolean
  serverVersion?: number
  hasLocalChanges?: boolean
  everPublished?: boolean
}

export function toLocalStored(timeline: Timeline): LocalStored {
  const out: LocalStored = { ...toV2(timeline), id: timeline.id }
  if (timeline.isShared !== undefined) out.isShared = timeline.isShared
  if (timeline.serverVersion !== undefined) out.serverVersion = timeline.serverVersion
  if (timeline.hasLocalChanges !== undefined) out.hasLocalChanges = timeline.hasLocalChanges
  if (timeline.everPublished !== undefined) out.everPublished = timeline.everPublished
  return out
}

// ──────────────────────────────────────────────────────────────
// V2 → 内存
// ──────────────────────────────────────────────────────────────

function fromV2StatusSnapshot(s: V2StatusSnapshot): StatusSnapshot {
  const out: StatusSnapshot = { statusId: s.s }
  if (s.ab !== undefined) out.absorb = s.ab
  return out
}

function fromV2PlayerDamageDetail(
  d: V2PlayerDamageDetail,
  composition: Composition
): PlayerDamageDetail {
  // job 从 composition 反查；abilityId 不持久化，hydrate 后为 undefined
  const job = (composition.players.find(p => p.id === d.p)?.job ?? 'PLD') as Job
  const out: PlayerDamageDetail = {
    timestamp: d.ts,
    playerId: d.p,
    job,
    unmitigatedDamage: d.u,
    finalDamage: d.f,
    statuses: d.ss.map(fromV2StatusSnapshot),
  }
  if (d.o !== undefined) out.overkill = d.o
  if (d.m !== undefined) out.multiplier = d.m
  if (d.hp !== undefined) out.hitPoints = d.hp
  if (d.mhp !== undefined) out.maxHitPoints = d.mhp
  return out
}

function fromV2DamageEvent(e: V2DamageEvent, composition: Composition): DamageEvent {
  const out: DamageEvent = {
    id: nextShortId(),
    name: e.n,
    time: e.t,
    damage: e.d,
    type: NUM_TO_DAMAGE_EVENT_TYPE[e.ty],
    damageType: NUM_TO_DAMAGE_TYPE[e.dt],
  }
  if (e.st !== undefined) out.snapshotTime = e.st
  if (e.pdd && e.pdd.length > 0) {
    out.playerDamageDetails = e.pdd.map(d => fromV2PlayerDamageDetail(d, composition))
  }
  // packetId 留 undefined；top100Sync 不走此路径
  return out
}

function fromV2CastEvents(ce: V2CastEvents): CastEvent[] {
  const len = ce.a.length
  const out: CastEvent[] = new Array(len)
  for (let i = 0; i < len; i++) {
    out[i] = {
      id: nextShortId(),
      actionId: ce.a[i],
      timestamp: ce.t[i],
      playerId: ce.p[i],
    }
  }
  return out
}

function fromV2Annotation(a: V2Annotation): Annotation {
  const anchor: Annotation['anchor'] =
    a.k === 0 ? { type: 'damageTrack' } : { type: 'skillTrack', playerId: a.k[0], actionId: a.k[1] }
  return {
    id: nextShortId(),
    text: a.x,
    time: a.t,
    anchor,
  }
}

function fromV2SyncEvent(e: V2SyncEvent): SyncEvent {
  return {
    time: e.t,
    type: NUM_TO_SYNC_TYPE[e.ty],
    actionId: e.a,
    actionName: e.nm ?? `unknown_${e.a.toString(16)}`,
    window: e.w,
    syncOnce: e.so === 1,
  }
}

function compositionFromSlots(c: string[]): Composition {
  const players: Composition['players'] = []
  for (let i = 0; i < c.length; i++) {
    const job = c[i]
    if (job) {
      players.push({ id: i, job: job as Job })
    }
  }
  return { players }
}

/**
 * 从 V2 持久化格式反序列化为内存 Timeline。
 *
 * 重要边界：从 V2 反序列化的 Timeline 里，`DamageEvent.packetId` 和
 * `PlayerDamageDetail.abilityId` 不被持久化，hydrate 后均为 `undefined`。
 * 此路径不应被 `top100Sync` 消费（top100Sync 总是处理 FFLogs import 新鲜产生的
 * 内存 Timeline，不走 V2 反序列化）。`PlayerDamageDetail.job` 从 composition
 * 反查填入。
 */
export function hydrateFromV2(v2: V2Timeline, overrides: Partial<Timeline> = {}): Timeline {
  resetIdCounter()
  const composition = compositionFromSlots(v2.c)
  const staticEncounter = getEncounterById(v2.e)

  const base: Timeline = {
    id: overrides.id ?? generateId(),
    name: v2.n,
    encounter: {
      id: v2.e,
      name: staticEncounter?.shortName ?? v2.n,
      displayName: staticEncounter?.name ?? v2.n,
      zone: '',
      damageEvents: [],
    },
    composition,
    damageEvents: v2.de.map(e => fromV2DamageEvent(e, composition)),
    castEvents: fromV2CastEvents(v2.ce),
    statusEvents: [],
    annotations: v2.an ? v2.an.map(fromV2Annotation) : [],
    createdAt: v2.ca,
    updatedAt: v2.ua,
  }

  if (v2.desc !== undefined) base.description = v2.desc
  if (v2.fs) base.fflogsSource = { reportCode: v2.fs.rc, fightId: v2.fs.fi }
  if (v2.gz !== undefined) base.gameZoneId = v2.gz
  if (v2.se) base.syncEvents = v2.se.map(fromV2SyncEvent)
  if (v2.r === 1) base.isReplayMode = true
  if (v2.sd !== undefined) base.statData = v2.sd

  return { ...base, ...overrides }
}

// ──────────────────────────────────────────────────────────────
// V1 遗留类型
// TODO(v2-sunset): remove after D1 bulk migration
// ──────────────────────────────────────────────────────────────

interface V1StatusSnapshot {
  statusId: number
  targetPlayerId?: number
  absorb?: number
}
interface V1PlayerDamageDetail {
  timestamp: number
  packetId?: number
  sourceId?: number
  playerId: number
  job?: string
  abilityId?: number
  skillName?: string
  unmitigatedDamage: number
  finalDamage: number
  overkill?: number
  multiplier?: number
  statuses: V1StatusSnapshot[]
  hitPoints?: number
  maxHitPoints?: number
  snapshotTimestamp?: number
}
interface V1DamageEvent {
  id?: string
  name: string
  time: number
  damage: number
  type: string // V1 data may have any value
  damageType: string // V1 data may have any value
  targetPlayerId?: number
  playerDamageDetails?: V1PlayerDamageDetail[]
  packetId?: number
  snapshotTime?: number
}
interface V1CastEvent {
  id?: string
  actionId: number
  timestamp: number
  playerId: number
  job?: string
  targetPlayerId?: number
}
interface V1Annotation {
  id?: string
  text: string
  time: number
  anchor: { type: string; playerId?: number; actionId?: number }
}
interface V1SyncEvent {
  time: number
  type: string
  actionId: number
  actionName: string
  window: [number, number]
  syncOnce: boolean
}
interface V1Composition {
  players: Array<{ id: number; job: string }>
}
interface V1Encounter {
  id: number
  name?: string
  displayName?: string
  zone?: string
  damageEvents?: unknown[]
}
interface V1Timeline {
  name: string
  description?: string
  fflogsSource?: { reportCode: string; fightId: number }
  gameZoneId?: number
  encounter: V1Encounter
  composition: V1Composition
  damageEvents: V1DamageEvent[]
  castEvents: V1CastEvent[]
  annotations?: V1Annotation[]
  syncEvents?: V1SyncEvent[]
  isReplayMode?: boolean
  createdAt: number
  updatedAt: number
}

// ──────────────────────────────────────────────────────────────
// V1 → V2 迁移
// ──────────────────────────────────────────────────────────────

function migrateV1StatusSnapshot(s: V1StatusSnapshot): V2StatusSnapshot {
  const out: V2StatusSnapshot = { s: s.statusId }
  if (s.absorb !== undefined) out.ab = s.absorb
  // strip targetPlayerId
  return out
}

function migrateV1PlayerDamageDetail(
  d: V1PlayerDamageDetail,
  remap: Map<number, number>
): V2PlayerDamageDetail {
  // strip: packetId, sourceId, skillName, job, abilityId
  const out: V2PlayerDamageDetail = {
    ts: d.timestamp,
    p: remap.get(d.playerId) ?? d.playerId,
    u: d.unmitigatedDamage,
    f: d.finalDamage,
    ss: d.statuses.map(migrateV1StatusSnapshot),
  }
  if (d.overkill !== undefined) out.o = d.overkill
  if (d.multiplier !== undefined) out.m = d.multiplier
  if (d.hitPoints !== undefined) out.hp = d.hitPoints
  if (d.maxHitPoints !== undefined) out.mhp = d.maxHitPoints
  return out
}

function migrateV1DamageEvent(e: V1DamageEvent, remap: Map<number, number>): V2DamageEvent {
  // strip: id, targetPlayerId, packetId
  const out: V2DamageEvent = {
    n: e.name,
    t: e.time,
    d: e.damage,
    ty: DAMAGE_EVENT_TYPE_TO_NUM[e.type as DamageEventType] ?? 0,
    dt: DAMAGE_TYPE_TO_NUM[e.damageType as DamageType] ?? 0,
  }
  if (e.snapshotTime !== undefined) out.st = e.snapshotTime
  if (e.playerDamageDetails && e.playerDamageDetails.length > 0) {
    out.pdd = e.playerDamageDetails.map(d => migrateV1PlayerDamageDetail(d, remap))
  }
  return out
}

function migrateV1Annotation(a: V1Annotation, remap: Map<number, number>): V2Annotation {
  return {
    x: a.text,
    t: a.time,
    k:
      a.anchor.type === 'damageTrack'
        ? 0
        : [remap.get(a.anchor.playerId ?? 0) ?? a.anchor.playerId ?? 0, a.anchor.actionId ?? 0],
  }
}

function migrateV1SyncEvent(e: V1SyncEvent): V2SyncEvent {
  const out: V2SyncEvent = {
    t: e.time,
    ty: SYNC_TYPE_TO_NUM[e.type as 'begincast' | 'cast'] ?? 0,
    a: e.actionId,
    w: e.window,
  }
  if (e.actionName) out.nm = e.actionName
  if (e.syncOnce) out.so = 1
  return out
}

export function migrateV1ToV2(v1: V1Timeline): V2Timeline {
  // 构建 playerId 重映射：原始 ID → 0..N-1
  const remap = buildPlayerIdRemap(v1.composition)

  const c = compositionToV2(v1.composition, remap)

  // CE sorted by timestamp
  const sortedCE = [...v1.castEvents].sort((a, b) => a.timestamp - b.timestamp)
  const ce: V2CastEvents = {
    a: sortedCE.map(e => e.actionId),
    t: sortedCE.map(e => e.timestamp),
    p: sortedCE.map(e => remap.get(e.playerId) ?? e.playerId),
  }

  const out: V2Timeline = {
    v: 2,
    n: v1.name,
    e: v1.encounter.id,
    c,
    de: v1.damageEvents.map(e => migrateV1DamageEvent(e, remap)),
    ce,
    ca: v1.createdAt,
    ua: v1.updatedAt,
  }

  if (v1.description !== undefined) out.desc = v1.description
  if (v1.fflogsSource) {
    out.fs = { rc: v1.fflogsSource.reportCode, fi: v1.fflogsSource.fightId }
  }
  if (v1.gameZoneId !== undefined) out.gz = v1.gameZoneId
  const an = (v1.annotations ?? []).map(a => migrateV1Annotation(a, remap))
  if (an.length > 0) out.an = an
  const se = (v1.syncEvents ?? []).map(migrateV1SyncEvent)
  if (se.length > 0) out.se = se
  if (v1.isReplayMode) out.r = 1

  return out
}

// ──────────────────────────────────────────────────────────────
// 统一入站入口
// ──────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseFromAny(raw: unknown, overrides: Partial<Timeline> = {}): Timeline {
  if (!isPlainObject(raw)) throw new Error('Invalid timeline: not a plain object')
  const v2 =
    raw.v === 2 ? (raw as unknown as V2Timeline) : migrateV1ToV2(raw as unknown as V1Timeline)
  return hydrateFromV2(v2, overrides)
}
