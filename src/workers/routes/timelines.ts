/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono'
import { vValidator } from '@hono/valibot-validator'
import * as v from 'valibot'
import type { AppEnv } from '../env'
import { requireAuth } from '../middleware/requireAuth'
import { tryReadAuth } from '../middleware/tryReadAuth'
import * as sensitiveWordFilter from '../sensitiveWordFilter'
import { generateId } from '@/utils/id'
import { fromBase64 } from 'lib0/buffer'
import type { TimelineDoc } from '../durable/TimelineDoc'
import type { SharedTimelineResponse } from '@/types/apiContracts'
import type { Timeline } from '@/types/timeline'

const PublishTimelineRequestSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  name: v.pipe(v.string(), v.maxLength(200)),
  // 发布时一并上传本地 Y.Doc 的全量 update（base64）。携带时服务端 seed DO + 预写
  // KV 快照，使公开读（含匿名 viewer）发布后立即可见，无需等作者首次 /connect。
  content: v.optional(v.pipe(v.string(), v.maxLength(2_000_000))),
})

const ID_GEN_MAX_ATTEMPTS = 32

/**
 * 生成一个不含敏感词的随机 id;连续 32 次都命中敏感词则抛错。
 * 客户端给的 id 命中敏感词时由发布端点据此换发(见设计文档 §3)。
 */
async function generateCleanId(env: AppEnv['Bindings']): Promise<string> {
  for (let i = 0; i < ID_GEN_MAX_ATTEMPTS; i++) {
    const candidate = generateId()
    if (!(await sensitiveWordFilter.containsBannedSubstring(candidate, env))) return candidate
  }
  throw new Error('id_generation_failed')
}

/**
 * 取该 timeline 的 DO stub。
 * DurableObjectNamespace binding 在 env.ts 中无具体类型，故 cast 为 TimelineDoc
 * 以调用其 RPC 方法（getSnapshotJson）及 fetch。
 */
export function docStub(env: AppEnv['Bindings'], id: string): TimelineDoc {
  return env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(id)) as unknown as TimelineDoc
}

const app = new Hono<AppEnv>()

// 发布:把一条本地时间轴注册为云端时间轴
app.post('/', requireAuth, vValidator('json', PublishTimelineRequestSchema), async c => {
  const auth = c.get('auth')!
  const { id: requestedId, name, content } = c.req.valid('json')

  // 客户端给的 id 命中敏感词时,服务端换发一个干净 id;
  // 前端 handlePublish 据返回的(可能变更过的)id 做 rekey。
  let id = requestedId
  if (await sensitiveWordFilter.containsBannedSubstring(id, c.env)) {
    try {
      id = await generateCleanId(c.env)
    } catch {
      return c.json({ error: 'id_generation_failed' }, 500)
    }
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

  // 携带初始内容时:把本地 Y.Doc seed 进 DO,并预写 KV 快照,
  // 使公开读(含匿名 viewer)发布后立即可见,无需等作者首次 /connect。
  // best-effort:seed/KV 失败不阻断发布,公开读会回退唤醒 DO 实时投影。
  if (content) {
    try {
      const stub = docStub(c.env, id)
      await stub.seed(fromBase64(content))
      const snapshot = await stub.getSnapshotJson()
      if (snapshot) {
        await c.env.healerbook_snapshots.put(`tl-snapshot:${id}`, JSON.stringify(snapshot))
      }
    } catch {
      // 忽略:不影响发布成功语义
    }
  }

  return c.json({ id, publishedAt: now }, 201)
})

// 公开读:返回 { role, authorName, isAuthor, allowEditRequests, hasPendingRequest, pendingRequestCount, snapshot? }
app.get('/:id', async c => {
  const id = c.req.param('id')

  const row = await c.env.healerbook_timelines
    .prepare('SELECT author_id, author_name, allow_edit_requests FROM timelines WHERE id = ?')
    .bind(id)
    .first<{ author_id: string; author_name: string; allow_edit_requests: number }>()
  if (!row) return c.json({ error: 'Not found' }, 404)

  const allowEditRequests = row.allow_edit_requests === 1
  const user = await tryReadAuth(c)
  let role: 'editor' | 'viewer' = 'viewer'
  let isAuthor = false
  let hasPendingRequest = false
  // 作者:当前待处理的申请数(供共享按钮角标显示);非作者恒 0
  let pendingRequestCount = 0
  if (user) {
    isAuthor = user.userId === row.author_id
    const editorRow = await c.env.healerbook_timelines
      .prepare('SELECT 1 FROM timeline_editors WHERE timeline_id = ? AND user_id = ?')
      .bind(id, user.userId)
      .first()
    if (editorRow) role = 'editor'
    if (role === 'viewer') {
      const reqRow = await c.env.healerbook_timelines
        .prepare('SELECT 1 FROM timeline_edit_requests WHERE timeline_id = ? AND user_id = ?')
        .bind(id, user.userId)
        .first()
      hasPendingRequest = reqRow != null
    }
    if (isAuthor) {
      const countRow = await c.env.healerbook_timelines
        .prepare('SELECT COUNT(*) AS n FROM timeline_edit_requests WHERE timeline_id = ?')
        .bind(id)
        .first<{ n: number }>()
      pendingRequestCount = countRow?.n ?? 0
    }
  }

  const base: Omit<SharedTimelineResponse, 'snapshot'> = {
    role,
    authorName: row.author_name,
    isAuthor,
    allowEditRequests,
    hasPendingRequest,
    pendingRequestCount,
  }

  // 三角色共用 KV snapshot 查询:editor / author 用于首屏兜底,viewer 用于只读渲染
  const cached = await c.env.healerbook_snapshots.get(`tl-snapshot:${id}`)
  const snapshot = cached
    ? (JSON.parse(cached) as object)
    : await docStub(c.env, id).getSnapshotJson()

  // viewer 角色:snapshot 缺失视为时间轴未生成内容快照(DO 空 + KV 空) → 404
  if (role === 'viewer' && !snapshot) return c.json({ error: 'Not found' }, 404)

  // editor / author:始终 private, no-cache(用户相关数据 + snapshot 跟随协同变化)
  // viewer:已登录(可能含 hasPendingRequest)用 private;匿名用 public;统一 no-cache
  const cacheControl =
    role === 'editor' ? 'private, no-cache' : user ? 'private, no-cache' : 'public, no-cache'

  // snapshot 为 undefined 时不写入 body(保持响应字段最小化)
  const body: SharedTimelineResponse = snapshot ? { ...base, snapshot: snapshot as Timeline } : base
  return c.json(body, 200, { 'Cache-Control': cacheControl })
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
  // 清空 Durable Object 存储:DO 经 idFromName 取得会被复用,
  // 不清空则同 id 重新发布会复活旧内容
  await docStub(c.env, id).purge()
  return c.body(null, 204)
})

export { app as timelinesRoutes }
