import { encodeStateAsUpdate } from 'yjs'
import type { Timeline } from '@/types/timeline'
import { getAllTimelineMetadata, getTimeline } from '@/utils/timelineStorage'
import { buildYDoc } from './docSchema'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
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
  if (t.level !== undefined) content.level = t.level
  if (t.syncEvents !== undefined) content.syncEvents = t.syncEvents
  if (t.isReplayMode !== undefined) content.isReplayMode = t.isReplayMode
  if (t.statData !== undefined) content.statData = t.statData
  return content
}

/**
 * 客户端一次性迁移:旧 localStorage 时间轴 → IndexedDB。
 *
 * - 纯本地(从未发布)时间轴 → buildYDoc 落 snapshot,meta.kind='local'。
 * - 已发布(曾 isShared)时间轴 → 不存本地 Y.Doc(服务端是唯一权威),
 *   只建 meta.kind='published' 行;首次打开走 editor/viewer 路径从 DO 拉取。
 *
 * 完成后清理旧 localStorage key(含旧索引键 STORAGE_KEY)。迁移后已无代码再写入
 * 该索引键,故「索引键是否存在」即可作为只跑一次的判据,无需额外标志位。
 */
export async function runClientMigration(): Promise<void> {
  if (!localStorage.getItem(STORAGE_KEY)) return

  const store = new IndexedDBDocStore()
  await store.open()

  const legacyIds: string[] = []

  for (const meta of getAllTimelineMetadata()) {
    try {
      const timeline = getTimeline(meta.id)
      if (!timeline) continue
      const now = Math.floor(Date.now() / 1000)
      // 故意用 isShared（当前状态）而非 everPublished：曾发布后取消共享的轴应作为纯本地轴迁移，会生成本地 Y.Doc
      const isPublished = !!timeline.isShared
      const docMeta: LocalDocMeta = {
        docId: meta.id,
        name: timeline.name,
        encounterId: timeline.encounter?.id ?? 0,
        createdAt: timeline.createdAt,
        updatedAt: timeline.updatedAt || now,
        composition: timeline.composition ?? null,
        kind: isPublished ? 'published' : 'local',
        lastViewedAt: now,
      }
      if (timeline.fflogsSource) docMeta.fflogsSource = timeline.fflogsSource
      await store.putMeta(docMeta)

      if (!isPublished) {
        const doc = buildYDoc(toContent(timeline))
        await store.appendUpdate(meta.id, encodeStateAsUpdate(doc))
      }
      legacyIds.push(meta.id) // 仅在该条目完全迁移成功后才标记可清理
    } catch (err) {
      console.error('[collab-migration] 跳过损坏条目', meta.id, err)
    }
  }

  for (const id of legacyIds) {
    localStorage.removeItem(`${STORAGE_KEY}_${id}`)
  }
  localStorage.removeItem(STORAGE_KEY)
}
