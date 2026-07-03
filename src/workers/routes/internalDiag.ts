/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono'
import type { AppEnv } from '../env'
import type { TimelineDoc } from '../durable/TimelineDoc'
import { requireSyncToken } from '../middleware/requireSyncToken'

const app = new Hono<AppEnv>()

/**
 * 由 DO id(hex)反查 timelineId。
 *
 * DO 经 `idFromName(timelineId)` 单向派生,无法从 id 反推 name;但 DO 自身在
 * /connect 时把 timelineId 存进了 storage('docId')。这里用 `idFromString(hex)`
 * 把日志里的 64 位 hex 还原成 DO 引用,直连后让它自报 docId,再补充 D1 元信息。
 *
 * GET /api/internal/do-lookup?doId=<hex>  (需 sync token，与 /migrate 一致)
 *   200 { doId, timelineId, name, authorId, authorName }
 *   404 { doId, timelineId: null }   —— 该 DO 从未 /connect(无对应 timeline)
 *   400 invalid / missing doId
 */
app.get('/do-lookup', requireSyncToken, async c => {
  const doId = c.req.query('doId')?.trim()
  if (!doId) return c.json({ error: 'missing doId' }, 400)

  let id: DurableObjectId
  try {
    id = c.env.TIMELINE_DOC.idFromString(doId)
  } catch {
    return c.json({ error: 'invalid doId' }, 400)
  }

  const stub = c.env.TIMELINE_DOC.get(id) as unknown as TimelineDoc
  const timelineId = await stub.getDocId()
  if (!timelineId) return c.json({ doId, timelineId: null }, 404)

  const row = await c.env.healerbook_timelines
    .prepare('SELECT name, author_id, author_name FROM timelines WHERE id = ?')
    .bind(timelineId)
    .first<{ name: string; author_id: string; author_name: string }>()

  return c.json({
    doId,
    timelineId,
    name: row?.name ?? null,
    authorId: row?.author_id ?? null,
    authorName: row?.author_name ?? null,
  })
})

export { app as internalDiagRoutes }
