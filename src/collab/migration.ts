import { encodeStateAsUpdate } from 'yjs'
import type { Timeline } from '@/types/timeline'
import { getAllTimelineMetadata, getTimeline } from '@/utils/timelineStorage'
import { buildYDoc } from './docSchema'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
import { MIGRATION_FLAG } from './constants'
import type { TimelineContent } from './types'

function toContent(t: Timeline): TimelineContent {
  const content: TimelineContent = {
    name: t.name,
    encounter: t.encounter,
    composition: t.composition,
    damageEvents: t.damageEvents,
    castEvents: t.castEvents,
    annotations: t.annotations,
    createdAt: t.createdAt,
  }
  if (t.description !== undefined) content.description = t.description
  if (t.fflogsSource !== undefined) content.fflogsSource = t.fflogsSource
  if (t.gameZoneId !== undefined) content.gameZoneId = t.gameZoneId
  if (t.syncEvents !== undefined) content.syncEvents = t.syncEvents
  if (t.isReplayMode !== undefined) content.isReplayMode = t.isReplayMode
  if (t.statData !== undefined) content.statData = t.statData
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
      await store.appendUpdate(meta.id, encodeStateAsUpdate(doc))
    } catch (err) {
      console.error('[collab-migration] 跳过损坏条目', meta.id, err)
    }
  }

  localStorage.setItem(MIGRATION_FLAG, '1')
}
