/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono'
import { vValidator } from '@hono/valibot-validator'
import * as v from 'valibot'
import type { AppEnv } from '../env'
import { requireAuth } from '../middleware/requireAuth'
import * as sensitiveWordFilter from '../sensitiveWordFilter'
import type { TimelineDoc } from '../durable/TimelineDoc'

const PublishTimelineRequestSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  name: v.pipe(v.string(), v.maxLength(200)),
})

/**
 * 取该 timeline 的 DO stub。
 * DurableObjectNamespace binding 在 env.ts 中无具体类型，故 cast 为 TimelineDoc
 * 以调用其 RPC 方法（getSnapshotJson）及 fetch。
 */
function docStub(env: AppEnv['Bindings'], id: string): TimelineDoc {
  return env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(id)) as unknown as TimelineDoc
}

const app = new Hono<AppEnv>()

// 发布:把一条本地时间轴注册为云端时间轴
app.post('/', requireAuth, vValidator('json', PublishTimelineRequestSchema), async c => {
  const auth = c.get('auth')!
  const { id, name } = c.req.valid('json')

  if (await sensitiveWordFilter.containsBannedSubstring(id, c.env)) {
    return c.json({ error: 'id_rejected' }, 409)
  }

  const now = Math.floor(Date.now() / 1000)
  const inserted = await c.env.healerbook_timelines
    .prepare(
      'INSERT OR IGNORE INTO timelines (id, name, author_id, author_name, published_at, updated_at, version, content) VALUES (?,?,?,?,?,?,?,?)'
    )
    .bind(id, name, auth.userId, auth.username, now, now, 1, '{}')
    .run()
  if (inserted.meta.changes === 0) {
    return c.json({ error: 'id_taken' }, 409)
  }

  await c.env.healerbook_timelines
    .prepare(
      'INSERT OR IGNORE INTO timeline_editors (timeline_id, user_id, created_at) VALUES (?,?,?)'
    )
    .bind(id, auth.userId, Date.now())
    .run()
  return c.json({ id, publishedAt: now }, 201)
})

// 公开读:先 KV,未命中经 DO RPC
app.get('/:id', async c => {
  const id = c.req.param('id')

  const cached = await c.env.healerbook_snapshots.get(`tl-snapshot:${id}`)
  if (cached) {
    return c.json(JSON.parse(cached) as object, 200, { 'Cache-Control': 'public, max-age=60' })
  }
  const row = await c.env.healerbook_timelines
    .prepare('SELECT id FROM timelines WHERE id = ?')
    .bind(id)
    .first()
  if (!row) return c.json({ error: 'Not found' }, 404)
  const json = await docStub(c.env, id).getSnapshotJson()
  if (!json) return c.json({ error: 'Not found' }, 404)
  return c.json(json, 200, { 'Cache-Control': 'public, max-age=60' })
})

// WebSocket 升级:转发给 DO,注入 X-Timeline-Id
app.get('/:id/connect', async c => {
  if (c.req.header('Upgrade') !== 'websocket') {
    return c.json({ error: 'expected websocket' }, 400)
  }
  const id = c.req.param('id')
  // Construct a fresh request with explicit headers to avoid immutable-header issues
  // and to strip any client-supplied X-Timeline-Id before injecting our own.
  const fwd = new Request('https://do/connect', {
    method: 'GET',
    headers: {
      Upgrade: 'websocket',
      'X-Timeline-Id': id,
    },
  })
  return docStub(c.env, id).fetch(fwd)
})

// 删除:删 D1 行 + KV + timeline_editors
app.delete('/:id', requireAuth, async c => {
  const auth = c.get('auth')!
  const id = c.req.param('id')
  const result = await c.env.healerbook_timelines
    .prepare('DELETE FROM timelines WHERE id = ? AND author_id = ?')
    .bind(id, auth.userId)
    .run()
  if (result.meta.changes === 0) return c.json({ error: 'Not found or forbidden' }, 404)
  await c.env.healerbook_snapshots.delete(`tl-snapshot:${id}`)
  await c.env.healerbook_timelines
    .prepare('DELETE FROM timeline_editors WHERE timeline_id = ?')
    .bind(id)
    .run()
  return c.body(null, 204)
})

export { app as timelinesRoutes }
