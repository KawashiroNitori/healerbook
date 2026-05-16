import { encodeStateAsUpdate } from 'yjs'
import type { Timeline } from '@/types/timeline'
import { getAllTimelineMetadata, getTimeline } from '@/utils/timelineStorage'
import { buildYDoc } from './docSchema'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
import { MIGRATION_FLAG } from './constants'
import type { TimelineContent, LocalDocMeta } from './types'

const STORAGE_KEY = 'healerbook_timelines'

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
 * 客户端一次性迁移:旧 localStorage 时间轴 → IndexedDB。
 *
 * - 纯本地(从未发布)时间轴 → buildYDoc 落 snapshot,meta.published=false。
 * - 已发布(曾 isShared)时间轴 → 不存本地 Y.Doc(服务端是唯一权威),
 *   只建 meta.published=true 行;首次打开走 editor/viewer 路径从 DO 拉取。
 *
 * 完成后清理旧 localStorage key。幂等 —— 靠 MIGRATION_FLAG 保证只跑一次。
 */
export async function runClientMigration(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG)) return

  const store = new IndexedDBDocStore()
  await store.open()

  const legacyIds: string[] = []

  for (const meta of getAllTimelineMetadata()) {
    legacyIds.push(meta.id)
    try {
      const timeline = getTimeline(meta.id)
      if (!timeline) continue
      const now = Math.floor(Date.now() / 1000)
      const published = !!timeline.isShared
      const docMeta: LocalDocMeta = {
        docId: meta.id,
        name: timeline.name,
        encounterId: timeline.encounter?.id ?? 0,
        createdAt: timeline.createdAt,
        updatedAt: timeline.updatedAt || now,
        composition: timeline.composition ?? null,
        published,
      }
      if (timeline.fflogsSource) docMeta.fflogsSource = timeline.fflogsSource
      await store.putMeta(docMeta)

      if (!published) {
        const doc = buildYDoc(toContent(timeline))
        await store.appendUpdate(meta.id, encodeStateAsUpdate(doc))
      }
    } catch (err) {
      console.error('[collab-migration] 跳过损坏条目', meta.id, err)
    }
  }

  for (const id of legacyIds) {
    localStorage.removeItem(`${STORAGE_KEY}_${id}`)
  }
  localStorage.removeItem(STORAGE_KEY)

  localStorage.setItem(MIGRATION_FLAG, '1')
}
