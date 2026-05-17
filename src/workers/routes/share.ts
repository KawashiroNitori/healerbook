/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono'
import { vValidator } from '@hono/valibot-validator'
import * as v from 'valibot'
import type { AppEnv } from '../env'
import { requireAuth } from '../middleware/requireAuth'

const app = new Hono<AppEnv>()

/**
 * 校验调用者是该时间轴作者;是则返回作者行（含 allow_edit_requests），否则 null。
 * 时间轴不存在或调用者非作者都返回 null;调用方统一回 403——
 * 作为作者专用端点的统一守卫,不区分两者。
 */
async function findAuthor(
  env: AppEnv['Bindings'],
  timelineId: string,
  userId: string
): Promise<{ author_id: string; allow_edit_requests: number } | null> {
  const row = await env.healerbook_timelines
    .prepare('SELECT author_id, allow_edit_requests FROM timelines WHERE id = ?')
    .bind(timelineId)
    .first<{ author_id: string; allow_edit_requests: number }>()
  if (!row || row.author_id !== userId) return null
  return row
}

// 作者读:申请开关 + 编辑者列表 + 申请者列表
app.get('/:id/share', requireAuth, async c => {
  const auth = c.get('auth')!
  const id = c.req.param('id')
  const author = await findAuthor(c.env, id, auth.userId)
  if (!author) return c.json({ error: 'Forbidden' }, 403)

  const editors = await c.env.healerbook_timelines
    .prepare(
      'SELECT user_id, user_name FROM timeline_editors WHERE timeline_id = ? AND user_id != ? ORDER BY created_at'
    )
    .bind(id, author.author_id)
    .all<{ user_id: string; user_name: string }>()

  const applicants = await c.env.healerbook_timelines
    .prepare(
      'SELECT user_id, user_name, created_at FROM timeline_edit_requests WHERE timeline_id = ? ORDER BY created_at'
    )
    .bind(id)
    .all<{ user_id: string; user_name: string; created_at: number }>()

  return c.json({
    allowEditRequests: author.allow_edit_requests === 1,
    editors: editors.results.map(r => ({ userId: r.user_id, userName: r.user_name })),
    applicants: applicants.results.map(r => ({
      userId: r.user_id,
      userName: r.user_name,
      createdAt: r.created_at,
    })),
  })
})

const ShareSettingsSchema = v.object({ allowEditRequests: v.boolean() })

// 作者写:申请开关
app.patch('/:id/share', requireAuth, vValidator('json', ShareSettingsSchema), async c => {
  const auth = c.get('auth')!
  const id = c.req.param('id')
  const author = await findAuthor(c.env, id, auth.userId)
  if (!author) return c.json({ error: 'Forbidden' }, 403)
  const { allowEditRequests } = c.req.valid('json')
  await c.env.healerbook_timelines
    .prepare('UPDATE timelines SET allow_edit_requests = ? WHERE id = ?')
    .bind(allowEditRequests ? 1 : 0, id)
    .run()
  return c.json({ allowEditRequests })
})

// 用户发起编辑权限申请
app.post('/:id/edit-requests', requireAuth, async c => {
  const auth = c.get('auth')!
  const id = c.req.param('id')

  const tl = await c.env.healerbook_timelines
    .prepare('SELECT allow_edit_requests FROM timelines WHERE id = ?')
    .bind(id)
    .first<{ allow_edit_requests: number }>()
  if (!tl) return c.json({ error: 'Not found' }, 404)

  const editor = await c.env.healerbook_timelines
    .prepare('SELECT 1 FROM timeline_editors WHERE timeline_id = ? AND user_id = ?')
    .bind(id, auth.userId)
    .first()
  if (editor) return c.json({ error: 'already_editor' }, 409)

  if (tl.allow_edit_requests !== 1) return c.json({ error: 'requests_disabled' }, 403)

  await c.env.healerbook_timelines
    .prepare(
      'INSERT OR IGNORE INTO timeline_edit_requests (timeline_id, user_id, user_name, created_at) VALUES (?,?,?,?)'
    )
    .bind(id, auth.userId, auth.username, Date.now())
    .run()
  return c.json({ ok: true }, 201)
})

// 作者通过申请:删 request 行 + 写 editors 行
app.post('/:id/edit-requests/:userId/approve', requireAuth, async c => {
  const auth = c.get('auth')!
  const id = c.req.param('id')
  const targetUserId = c.req.param('userId')
  const author = await findAuthor(c.env, id, auth.userId)
  if (!author) return c.json({ error: 'Forbidden' }, 403)

  const reqRow = await c.env.healerbook_timelines
    .prepare('SELECT user_name FROM timeline_edit_requests WHERE timeline_id = ? AND user_id = ?')
    .bind(id, targetUserId)
    .first<{ user_name: string }>()
  if (!reqRow) return c.json({ error: 'Not found' }, 404)

  await c.env.healerbook_timelines.batch([
    c.env.healerbook_timelines
      .prepare('DELETE FROM timeline_edit_requests WHERE timeline_id = ? AND user_id = ?')
      .bind(id, targetUserId),
    c.env.healerbook_timelines
      .prepare(
        'INSERT OR IGNORE INTO timeline_editors (timeline_id, user_id, user_name, created_at) VALUES (?,?,?,?)'
      )
      .bind(id, targetUserId, reqRow.user_name, Date.now()),
  ])
  return c.json({ ok: true })
})

// 作者拒绝申请:删 request 行
app.post('/:id/edit-requests/:userId/reject', requireAuth, async c => {
  const auth = c.get('auth')!
  const id = c.req.param('id')
  const targetUserId = c.req.param('userId')
  const author = await findAuthor(c.env, id, auth.userId)
  if (!author) return c.json({ error: 'Forbidden' }, 403)

  const result = await c.env.healerbook_timelines
    .prepare('DELETE FROM timeline_edit_requests WHERE timeline_id = ? AND user_id = ?')
    .bind(id, targetUserId)
    .run()
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

export { app as shareRoutes }
