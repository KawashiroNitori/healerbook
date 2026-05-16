/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { buildYDoc } from '@/collab/docSchema'
import { parseFromAny } from '@/utils/timelineFormat'
import type { TimelineContent } from '@/collab/types'
import type { TimelineDoc } from '../durable/TimelineDoc'
import { encodeStateAsUpdate } from 'yjs'
import { requireSyncToken } from '../middleware/requireSyncToken'

const app = new Hono<AppEnv>()

interface TimelineRow {
  id: string
  author_id: string
  content: string
}

/**
 * 把 Timeline 内存对象提取为 TimelineContent（剔除外部寻址 / 本地元数据 / 派生字段）。
 * 显式字段复制以避免 ESLint no-unused-vars 在析构赋值上的误报。
 */
function toContent(timeline: ReturnType<typeof parseFromAny>): TimelineContent {
  return {
    name: timeline.name,
    encounter: timeline.encounter,
    composition: timeline.composition,
    damageEvents: timeline.damageEvents,
    castEvents: timeline.castEvents,
    annotations: timeline.annotations,
    createdAt: timeline.createdAt,
    ...(timeline.description !== undefined ? { description: timeline.description } : {}),
    ...(timeline.fflogsSource !== undefined ? { fflogsSource: timeline.fflogsSource } : {}),
    ...(timeline.gameZoneId !== undefined ? { gameZoneId: timeline.gameZoneId } : {}),
    ...(timeline.syncEvents !== undefined ? { syncEvents: timeline.syncEvents } : {}),
    ...(timeline.isReplayMode !== undefined ? { isReplayMode: timeline.isReplayMode } : {}),
    ...(timeline.statData !== undefined ? { statData: timeline.statData } : {}),
  }
}

/** 把旧 D1 timelines.content → Y.Doc → 灌入对应 DO。幂等（DO.seed 幂等）。 */
app.post('/migrate', requireSyncToken, async c => {
  const rows = await c.env.healerbook_timelines
    .prepare('SELECT id, author_id, content FROM timelines')
    .all<TimelineRow>()

  let migrated = 0
  let skipped = 0
  for (const row of rows.results) {
    try {
      const raw = JSON.parse(row.content) as Record<string, unknown>
      const timeline = parseFromAny(raw, { id: row.id })
      const content = toContent(timeline)
      const bin = encodeStateAsUpdate(buildYDoc(content))
      const stub = c.env.TIMELINE_DOC.get(
        c.env.TIMELINE_DOC.idFromName(row.id)
      ) as unknown as TimelineDoc
      await stub.seed(bin)
      await c.env.healerbook_timelines
        .prepare(
          'INSERT OR IGNORE INTO timeline_editors (timeline_id, user_id, created_at) VALUES (?,?,?)'
        )
        .bind(row.id, row.author_id, Date.now())
        .run()
      migrated++
    } catch (err) {
      console.error('[migrate] skip', row.id, err)
      skipped++
    }
  }
  return c.json({ migrated, skipped })
})

export { app as internalMigrateRoutes }
