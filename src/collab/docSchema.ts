import * as Y from 'yjs'
import { Y_MAP, LOCAL_ORIGIN, EXIT_REPLAY_ORIGIN } from './constants'
import type { TimelineContent } from './types'
import type { DamageEvent, CastEvent, Annotation, Timeline, Composition } from '@/types/timeline'
import { normalizeActionId } from '@/utils/normalizeActionId'

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

function ymapToObject<T>(ymap: Y.Map<unknown>): T {
  return Object.fromEntries(ymap.entries()) as T
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

/** 对单个集合做引用保持投影:内容相等的 entry 复用 prev 的对象 */
function projectCollection<T extends { id: string }>(
  ymaps: Iterable<Y.Map<unknown>>,
  prevById: Map<string, T> | undefined
): T[] {
  const out: T[] = []
  for (const ymap of ymaps) {
    const fresh = ymapToObject<T>(ymap)
    const prev = prevById?.get(fresh.id)
    out.push(
      prev && shallowEqual(prev as Record<string, unknown>, fresh as Record<string, unknown>)
        ? prev
        : fresh
    )
  }
  return out
}

// ─── granular mutators ───────────────────────────────────────────────────────

export function mapOf(doc: Y.Doc, name: string) {
  return doc.getMap<Y.Map<unknown>>(name)
}

// DamageEvent mutators

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
      // 显式 undefined 表示"清除该字段"（如关闭 DoT 快照、重新启用目标减）。
      // 必须 delete 而非跳过——跳过会让旧值残留，导致开关无法切回。
      if (v === undefined) ymap.delete(k)
      else ymap.set(k, v)
    }
  }, LOCAL_ORIGIN)
}

export function yRemoveDamageEvent(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    mapOf(doc, Y_MAP.damageEvents).delete(id)
  }, LOCAL_ORIGIN)
}

// CastEvent mutators

export function yAddCastEvent(doc: Y.Doc, ev: CastEvent): void {
  doc.transact(() => {
    mapOf(doc, Y_MAP.castEvents).set(ev.id, entryToYMap(ev as unknown as Record<string, unknown>))
  }, LOCAL_ORIGIN)
}

export function yUpdateCastEvent(doc: Y.Doc, id: string, patch: Partial<CastEvent>): void {
  doc.transact(() => {
    const ymap = mapOf(doc, Y_MAP.castEvents).get(id)
    if (!ymap) return
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) ymap.set(k, v)
    }
  }, LOCAL_ORIGIN)
}

export function yRemoveCastEvent(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    mapOf(doc, Y_MAP.castEvents).delete(id)
    // 级联:删掉锚定在这次 cast 上的备注
    const an = mapOf(doc, Y_MAP.annotations)
    for (const [aid, am] of [...an.entries()]) {
      const anchor = am.get('anchor') as { type: string; castId?: string }
      if (anchor?.type === 'cast' && anchor.castId === id) an.delete(aid)
    }
  }, LOCAL_ORIGIN)
}

// Annotation mutators

export function yAddAnnotation(doc: Y.Doc, ev: Annotation): void {
  doc.transact(() => {
    mapOf(doc, Y_MAP.annotations).set(ev.id, entryToYMap(ev as unknown as Record<string, unknown>))
  }, LOCAL_ORIGIN)
}

export function yUpdateAnnotation(doc: Y.Doc, id: string, patch: Partial<Annotation>): void {
  doc.transact(() => {
    const ymap = mapOf(doc, Y_MAP.annotations).get(id)
    if (!ymap) return
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) ymap.set(k, v)
    }
  }, LOCAL_ORIGIN)
}

export function yRemoveAnnotation(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    mapOf(doc, Y_MAP.annotations).delete(id)
  }, LOCAL_ORIGIN)
}

// Meta / composition / statData mutators

/** 改 meta 标量字段(name/description/isReplayMode 等) */
export function ySetMeta(doc: Y.Doc, patch: Record<string, unknown>): void {
  doc.transact(() => {
    const meta = doc.getMap(Y_MAP.meta)
    for (const [k, v] of Object.entries(patch)) meta.set(k, v)
  }, LOCAL_ORIGIN)
}

/**
 * 替换阵容,并级联清理:删掉不在新阵容的玩家的 castEvent / skillTrack 备注。
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
    const removedCastIds = new Set<string>()
    for (const [id, cm] of [...ce.entries()]) {
      if (!keepIds.has(cm.get('playerId') as number)) {
        ce.delete(id)
        removedCastIds.add(id)
      }
    }
    const an = mapOf(doc, Y_MAP.annotations)
    for (const [id, am] of [...an.entries()]) {
      const anchor = am.get('anchor') as { type: string; playerId?: number; castId?: string }
      if (anchor?.type === 'skillTrack' && !keepIds.has(anchor.playerId!)) an.delete(id)
      else if (anchor?.type === 'cast' && removedCastIds.has(anchor.castId!)) an.delete(id)
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

/**
 * 解除回放模式:把 meta.isReplayMode 置 false,并剥离每条伤害事件的
 * FFLogs 原始伤害明细(`playerDamageDetails`)——编辑模式不再需要这些数据。
 *
 * 该操作**不可撤销**:事务用 `EXIT_REPLAY_ORIGIN` 而非 `LOCAL_ORIGIN`,
 * 故 `SyncEngine` 的 `UndoManager`(只跟踪 `LOCAL_ORIGIN`)不会记录它。
 */
export function yExitReplayMode(doc: Y.Doc): void {
  doc.transact(() => {
    doc.getMap(Y_MAP.meta).set('isReplayMode', false)
    const de = mapOf(doc, Y_MAP.damageEvents)
    for (const ymap of de.values()) {
      if (ymap.has('playerDamageDetails')) ymap.delete('playerDamageDetails')
    }
  }, EXIT_REPLAY_ORIGIN)
}

// ─── projection ──────────────────────────────────────────────────────────────

/**
 * Y.Doc → Timeline 形状的普通对象。
 * 读路径强制跨集合不变量(sanitizer):丢弃引用了不存在玩家的 castEvent /
 * skillTrack 备注。见设计文档 §5.2。
 */
export function projectTimeline(doc: Y.Doc, prev?: Timeline): Timeline {
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

  const damageEvents = projectCollection<DamageEvent>(
    doc.getMap<Y.Map<unknown>>(Y_MAP.damageEvents).values(),
    indexById(prev?.damageEvents)
  ).sort((a, b) => a.time - b.time)

  const castEvents = projectCollection<CastEvent>(
    doc.getMap<Y.Map<unknown>>(Y_MAP.castEvents).values(),
    indexById(prev?.castEvents)
  )
    .filter(c => playerIds.has(c.playerId)) // sanitizer:丢孤儿 cast
    // 读取归一:旧 doc 持久化的子变体 id 投影即归一为 trackGroup 父 id(变体运行时推导)。
    // actionId 不变时保持引用,以兼容 projectCollection 的引用保持语义。
    .map(c => {
      const parentId = normalizeActionId(c.actionId)
      return parentId === c.actionId ? c : { ...c, actionId: parentId }
    })
    .sort((a, b) => a.timestamp - b.timestamp)

  const castIds = new Set(castEvents.map(c => c.id))
  const annotations = projectCollection<Annotation>(
    doc.getMap<Y.Map<unknown>>(Y_MAP.annotations).values(),
    indexById(prev?.annotations)
  ).filter(a => {
    if (a.anchor.type === 'skillTrack') return playerIds.has(a.anchor.playerId)
    if (a.anchor.type === 'cast') return castIds.has(a.anchor.castId)
    return true
  }) // sanitizer

  const statData =
    doc.getMap(Y_MAP.statData).size > 0
      ? ymapToObject<Timeline['statData']>(doc.getMap(Y_MAP.statData))
      : undefined

  return {
    id: '', // 由调用方(SyncEngine)用本地元数据填
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
