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
