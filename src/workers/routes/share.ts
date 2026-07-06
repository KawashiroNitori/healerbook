/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono'
import { vValidator } from '@hono/valibot-validator'
import * as v from 'valibot'
import type { AppEnv } from '../env'
import { requireAuth } from '../middleware/requireAuth'
import { docStub } from './timelines'
import {
  deleteEditRequestStatement,
  findEditRequest,
  insertEditRequestStatement,
  insertEditorStatement,
  isEditor,
  listEditors,
  listEditRequests,
  removeEditor,
} from '../db/editors'

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

  const editors = await listEditors(c.env.healerbook_timelines, id, author.author_id)
  const applicants = await listEditRequests(c.env.healerbook_timelines, id)

  return c.json({
    allowEditRequests: author.allow_edit_requests === 1,
    editors,
    applicants,
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

  if (await isEditor(c.env.healerbook_timelines, id, auth.userId)) {
    return c.json({ error: 'already_editor' }, 409)
  }

  if (tl.allow_edit_requests !== 1) return c.json({ error: 'requests_disabled' }, 403)

  const inserted = await insertEditRequestStatement(
    c.env.healerbook_timelines,
    id,
    auth.userId,
    auth.username
  ).run()
  // 实际写入新行(非幂等重复)→ 经 DO 把最新申请数推给在线作者
  if (inserted.meta.changes > 0) {
    await docStub(c.env, id).notifyEditRequest(id)
  }
  return c.json({ ok: true }, 201)
})

// 作者通过申请:删 request 行 + 写 editors 行
app.post('/:id/edit-requests/:userId/approve', requireAuth, async c => {
  const auth = c.get('auth')!
  const id = c.req.param('id')
  const targetUserId = c.req.param('userId')
  const author = await findAuthor(c.env, id, auth.userId)
  if (!author) return c.json({ error: 'Forbidden' }, 403)

  const reqRow = await findEditRequest(c.env.healerbook_timelines, id, targetUserId)
  if (!reqRow) return c.json({ error: 'Not found' }, 404)

  await c.env.healerbook_timelines.batch([
    deleteEditRequestStatement(c.env.healerbook_timelines, id, targetUserId),
    insertEditorStatement(c.env.healerbook_timelines, id, targetUserId, reqRow.userName),
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

  const result = await deleteEditRequestStatement(
    c.env.healerbook_timelines,
    id,
    targetUserId
  ).run()
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

// 作者移除编辑者:删 timeline_editors 行 + 调 DO 断开该用户连接
app.delete('/:id/editors/:userId', requireAuth, async c => {
  const auth = c.get('auth')!
  const id = c.req.param('id')
  const targetUserId = c.req.param('userId')
  const author = await findAuthor(c.env, id, auth.userId)
  if (!author) return c.json({ error: 'Forbidden' }, 403)
  if (targetUserId === author.author_id) {
    return c.json({ error: 'cannot_remove_author' }, 400)
  }
  await removeEditor(c.env.healerbook_timelines, id, targetUserId)
  await docStub(c.env, id).kickUser(targetUserId)
  return c.json({ ok: true })
})

export { app as shareRoutes }
