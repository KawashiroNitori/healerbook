import * as Y from 'yjs'
import { Y_MAP, LOCAL_ORIGIN } from './constants'
import type { TimelineContent } from './types'
import type { DamageEvent, CastEvent, Annotation, Timeline, Composition } from '@/types/timeline'

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

/**
 * Y.Doc → Timeline 形状的普通对象。
 * 读路径强制跨集合不变量(sanitizer):丢弃引用了不存在玩家的 castEvent /
 * skillTrack 注释。见设计文档 §5.2。
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
    .sort((a, b) => a.timestamp - b.timestamp)

  const annotations = projectCollection<Annotation>(
    doc.getMap<Y.Map<unknown>>(Y_MAP.annotations).values(),
    indexById(prev?.annotations)
  ).filter(
    a =>
      a.anchor.type !== 'skillTrack' || playerIds.has((a.anchor as { playerId: number }).playerId)
  ) // sanitizer

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
