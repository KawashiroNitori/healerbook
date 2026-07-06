/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { buildYDoc } from '@/collab/docSchema'
import { parseFromAny } from '@/utils/timelineFormat'
import type { TimelineContent } from '@/collab/types'
import { docStub } from '../durable/stub'
import { encodeStateAsUpdate } from 'yjs'
import { requireSyncToken } from '../middleware/requireSyncToken'
import { insertEditorStatement } from '../db/editors'

const app = new Hono<AppEnv>()

interface TimelineRow {
  id: string
  author_id: string
  name: string
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
    .prepare('SELECT id, author_id, name, content FROM timelines')
    .all<TimelineRow>()

  let migrated = 0
  let skipped = 0
  // repaired:存量 DO 缺 name 被回填的条数(seed 幂等,坏数据靠 ensureMetaName 修)
  let repaired = 0
  for (const row of rows.results) {
    try {
      const raw = JSON.parse(row.content) as Record<string, unknown>
      // 旧数据模型把显示名只存在 timelines.name 列,从未写进 content。
      // 必须用列里的 name 覆盖,否则迁移后 Y.Doc 的 meta.name 为空。
      const timeline = parseFromAny(raw, { id: row.id, name: row.name })
      const content = toContent(timeline)
      const bin = encodeStateAsUpdate(buildYDoc(content))
      const stub = docStub(c.env, row.id)
      await stub.seed(bin)
      // seed 幂等:旧版迁移已 seed 的 DO 不会被覆盖,缺 name 的坏数据靠此回填。
      // 回填后删掉可能陈旧(无 name)的 KV 快照,viewer 即回落到 DO 取最新。
      if (await stub.ensureMetaName(row.name)) {
        await c.env.healerbook_snapshots.delete(`tl-snapshot:${row.id}`)
        repaired++
      }
      await insertEditorStatement(c.env.healerbook_timelines, row.id, row.author_id).run()
      migrated++
    } catch (err) {
      console.error('[migrate] skip', row.id, err)
      skipped++
    }
  }
  return c.json({ migrated, skipped, repaired })
})

export { app as internalMigrateRoutes }
