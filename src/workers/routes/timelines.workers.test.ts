import { describe, it, expect, vi } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import * as Y from 'yjs'
import { toBase64 } from 'lib0/buffer'
import { signAccessToken } from '@/workers/jwt'
import { app } from '@/workers/index'
import * as sensitiveWordFilter from '@/workers/sensitiveWordFilter'

// 作者固定 userId，与发布时一致（发布后自动入 timeline_editors）
const AUTHOR_USER_ID = 'author-1'
const AUTHOR_USERNAME = 'Author'
const JWT_SECRET = 'test-secret'

/** 用作者 JWT 发布一条时间轴，返回 id */
async function publishOne(id: string, name: string): Promise<string> {
  const jwt = await signAccessToken(AUTHOR_USER_ID, AUTHOR_USERNAME, JWT_SECRET)
  const res = await SELF.fetch('https://app/api/timelines', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name }),
  })
  if (res.status !== 201) {
    throw new Error(`publishOne failed: ${res.status} ${await res.text()}`)
  }
  return id
}

/** 作者 JWT */
async function authorJwt(): Promise<string> {
  return signAccessToken(AUTHOR_USER_ID, AUTHOR_USERNAME, JWT_SECRET)
}

describe('POST /api/timelines 携带初始内容', () => {
  it('携带 content 时 seed DO 并写 KV，匿名 viewer 立即拿到 snapshot', async () => {
    const id = 'publishWithContent0001'
    const doc = new Y.Doc()
    doc.getMap('meta').set('name', '带内容发布')
    const contentB64 = toBase64(Y.encodeStateAsUpdate(doc))

    const jwt = await authorJwt()
    const res = await SELF.fetch('https://app/api/timelines', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: '带内容发布', content: contentB64 }),
    })
    expect(res.status).toBe(201)

    // KV 快照已写入，使后续公开读无需唤醒 DO
    const kv = await env.healerbook_snapshots.get(`tl-snapshot:${id}`)
    expect(kv).not.toBeNull()

    // 匿名 viewer 立即 200 且带内容
    const get = await SELF.fetch(`https://app/api/timelines/${id}`)
    expect(get.status).toBe(200)
    const body = (await get.json()) as { role: string; snapshot?: { name?: string } }
    expect(body.role).toBe('viewer')
    expect(body.snapshot?.name).toBe('带内容发布')
  })

  it('不携带 content 时不写 KV，匿名 viewer 仍 404（维持原行为）', async () => {
    const id = 'publishNoContent00001'
    await publishOne(id, 'T')

    const kv = await env.healerbook_snapshots.get(`tl-snapshot:${id}`)
    expect(kv).toBeNull()

    const get = await SELF.fetch(`https://app/api/timelines/${id}`)
    expect(get.status).toBe(404)
  })
})

describe('timelines 路由', () => {
  it('POST /api/timelines 发布:建行 + 作者入白名单', async () => {
    const jwt = await signAccessToken('author-1', 'Author', 'test-secret')
    const res = await SELF.fetch('https://app/api/timelines', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'tlPublishTest000000001', name: '发布测试' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    const editor = await env.healerbook_timelines
      .prepare('SELECT 1 FROM timeline_editors WHERE timeline_id = ? AND user_id = ?')
      .bind(body.id, 'author-1')
      .first()
    expect(editor).not.toBeNull()
  })

  it('GET /api/timelines/:id 对不存在的返回 404', async () => {
    const res = await SELF.fetch('https://app/api/timelines/nonexistent000000001')
    expect(res.status).toBe(404)
  })

  it('GET /api/timelines/:id/connect 升级为 WebSocket', async () => {
    const res = await SELF.fetch('https://app/api/timelines/anydoc000000000000001/connect', {
      headers: { Upgrade: 'websocket' },
    })
    expect(res.status).toBe(101)
  })
})

describe('GET /api/timelines/:id role', () => {
  it('returns viewer role with snapshot for anonymous request', async () => {
    const id = await publishOne('view-role-test-0000001', 'T1')
    // seed KV snapshot so viewer path returns data (DO is empty on fresh publish)
    const snapshotData = { title: 'T1', events: [] }
    await env.healerbook_snapshots.put(`tl-snapshot:${id}`, JSON.stringify(snapshotData))

    const res = await SELF.fetch(`https://app/api/timelines/${id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { role: string; authorName: string; snapshot: unknown }
    expect(body.role).toBe('viewer')
    expect(body).toHaveProperty('authorName')
    expect(body.snapshot).toEqual(snapshotData)
  })

  it('returns editor role without snapshot for whitelisted user', async () => {
    const id = await publishOne('editor-role-test-000001', 'T2')
    // 作者发布时已自动入 timeline_editors，用作者 JWT 请求
    const res = await SELF.fetch(`https://app/api/timelines/${id}`, {
      headers: { Authorization: `Bearer ${await authorJwt()}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { role: string; snapshot?: unknown }
    expect(body.role).toBe('editor')
    // snapshot 字段是否有值取决于 KV/DO，本用例不关心；详见专门用例
  })

  it('editor 角色 KV 命中时响应携带 snapshot', async () => {
    const id = await publishOne('editor-snap-hit-00000001', 'T-edit')
    const snapshotData = { name: 'T-edit', composition: { players: [] }, damageEvents: [] }
    await env.healerbook_snapshots.put(`tl-snapshot:${id}`, JSON.stringify(snapshotData))

    const res = await SELF.fetch(`https://app/api/timelines/${id}`, {
      headers: { Authorization: `Bearer ${await authorJwt()}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { role: string; snapshot?: unknown }
    expect(body.role).toBe('editor')
    expect(body.snapshot).toEqual(snapshotData)
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache')
  })

  it('editor 角色 KV miss 时响应 snapshot 缺省，不报错', async () => {
    const id = await publishOne('editor-snap-miss-0000001', 'T-edit-miss')
    // 不写 KV;DO 也为空（新发布未灌入）→ getSnapshotJson() 返回 null
    const res = await SELF.fetch(`https://app/api/timelines/${id}`, {
      headers: { Authorization: `Bearer ${await authorJwt()}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { role: string; snapshot?: unknown }
    expect(body.role).toBe('editor')
    expect(body.snapshot).toBeUndefined()
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache')
  })

  it('404 for unknown id', async () => {
    const res = await SELF.fetch('https://app/api/timelines/does-not-exist-00000001')
    expect(res.status).toBe(404)
  })

  it('GET /:id 返回 isAuthor/allowEditRequests/hasPendingRequest/pendingRequestCount', async () => {
    const id = await publishOne('share-fields-0000000001', 'T')
    await env.healerbook_snapshots.put(`tl-snapshot:${id}`, JSON.stringify({ x: 1 }))

    // 匿名:全 false / 0
    const anon = (await (await SELF.fetch(`https://app/api/timelines/${id}`)).json()) as {
      isAuthor: boolean
      allowEditRequests: boolean
      hasPendingRequest: boolean
      pendingRequestCount: number
    }
    expect(anon.isAuthor).toBe(false)
    expect(anon.allowEditRequests).toBe(false)
    expect(anon.hasPendingRequest).toBe(false)
    expect(anon.pendingRequestCount).toBe(0)

    // 作者:isAuthor true, hasPendingRequest false（作者始终在编辑者名单中）, 无申请时计数 0
    const author = (await (
      await SELF.fetch(`https://app/api/timelines/${id}`, {
        headers: { Authorization: `Bearer ${await authorJwt()}` },
      })
    ).json()) as { isAuthor: boolean; hasPendingRequest: boolean; pendingRequestCount: number }
    expect(author.isAuthor).toBe(true)
    expect(author.hasPendingRequest).toBe(false)
    expect(author.pendingRequestCount).toBe(0)

    // allowEditRequests: true 时 GET 响应应反映该标志
    await env.healerbook_timelines
      .prepare('UPDATE timelines SET allow_edit_requests = 1 WHERE id = ?')
      .bind(id)
      .run()
    const withFlag = (await (await SELF.fetch(`https://app/api/timelines/${id}`)).json()) as {
      allowEditRequests: boolean
    }
    expect(withFlag.allowEditRequests).toBe(true)

    // 非编辑者且有待处理申请:hasPendingRequest true
    await env.healerbook_timelines
      .prepare(
        'INSERT INTO timeline_edit_requests (timeline_id, user_id, user_name, created_at) VALUES (?,?,?,?)'
      )
      .bind(id, 'viewer-1', 'Viewer', Date.now())
      .run()
    const viewerJwt = await signAccessToken('viewer-1', 'Viewer', JWT_SECRET)
    const viewer = (await (
      await SELF.fetch(`https://app/api/timelines/${id}`, {
        headers: { Authorization: `Bearer ${viewerJwt}` },
      })
    ).json()) as { role: string; hasPendingRequest: boolean }
    expect(viewer.role).toBe('viewer')
    expect(viewer.hasPendingRequest).toBe(true)

    // 作者:有 1 条待处理申请时 pendingRequestCount 为 1
    const authorWithReq = (await (
      await SELF.fetch(`https://app/api/timelines/${id}`, {
        headers: { Authorization: `Bearer ${await authorJwt()}` },
      })
    ).json()) as { pendingRequestCount: number }
    expect(authorWithReq.pendingRequestCount).toBe(1)
  })

  it('匿名查看者 GET /:id 响应不可被浏览器缓存,确保刷新即取最新', async () => {
    const id = await publishOne('share-cache-00000000001', 'T')
    await env.healerbook_snapshots.put(`tl-snapshot:${id}`, JSON.stringify({ x: 1 }))
    const res = await SELF.fetch(`https://app/api/timelines/${id}`)
    expect(res.status).toBe(200)
    // max-age 会让浏览器刷新时直接复用陈旧响应,导致协作编辑对查看者不可见
    const cacheControl = res.headers.get('Cache-Control') ?? ''
    expect(cacheControl).not.toContain('max-age')
    expect(cacheControl).toContain('no-cache')
  })
})

describe('POST 敏感词 id 换发', () => {
  it('客户端 id 命中敏感词时服务端换发干净 id', async () => {
    const spy = vi
      .spyOn(sensitiveWordFilter, 'containsBannedSubstring')
      .mockResolvedValueOnce(true) // 请求的 id 命中
      .mockResolvedValue(false) // 后续候选全部干净
    try {
      const res = await app.request(
        'https://app/api/timelines',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await authorJwt()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: 'banned-id', name: 'x' }),
        },
        env
      )
      expect(res.status).toBe(201)
      const body = (await res.json()) as { id: string }
      expect(body.id).not.toBe('banned-id')
    } finally {
      spy.mockRestore()
    }
  })

  it('重生成 32 次仍全命中时返回 500 id_generation_failed', async () => {
    const spy = vi.spyOn(sensitiveWordFilter, 'containsBannedSubstring').mockResolvedValue(true)
    try {
      const res = await app.request(
        'https://app/api/timelines',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await authorJwt()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: 'always-banned', name: 'x' }),
        },
        env
      )
      expect(res.status).toBe(500)
      expect(((await res.json()) as { error: string }).error).toBe('id_generation_failed')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('POST/DELETE 校验与鉴权（自手写 mock 套件迁移）', () => {
  it('POST 无 Authorization 头返回 401', async () => {
    const res = await SELF.fetch('https://app/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'no-auth-post', name: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  it('POST id 为空字符串返回 400', async () => {
    const res = await SELF.fetch('https://app/api/timelines', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await authorJwt()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '', name: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST id 超过 64 字符返回 400', async () => {
    const res = await SELF.fetch('https://app/api/timelines', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await authorJwt()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x'.repeat(65), name: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST id 已存在返回 409 id_taken', async () => {
    await publishOne('dup-id-409', 'first')
    const res = await SELF.fetch('https://app/api/timelines', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await authorJwt()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'dup-id-409', name: 'second' }),
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('id_taken')
  })

  it('DELETE 未登录返回 401', async () => {
    await publishOne('del-noauth', 'x')
    const res = await SELF.fetch('https://app/api/timelines/del-noauth', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/timelines/:id 取消发布', () => {
  it('删除 D1 行 + 编辑者名单,并清空 DO 存储', async () => {
    const id = await publishOne('del-purge-000000000001', '待取消')
    // 给 DO 灌入内容,模拟已积累的协同数据
    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(id))
    const doc = new Y.Doc()
    doc.getMap('meta').set('name', '待取消')
    await stub.seed(Y.encodeStateAsUpdate(doc))
    expect(await stub.getSnapshotJson()).not.toBeNull()

    const res = await SELF.fetch(`https://app/api/timelines/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${await authorJwt()}` },
    })
    expect(res.status).toBe(204)

    const row = await env.healerbook_timelines
      .prepare('SELECT 1 FROM timelines WHERE id = ?')
      .bind(id)
      .first()
    expect(row).toBeNull()
    const editor = await env.healerbook_timelines
      .prepare('SELECT 1 FROM timeline_editors WHERE timeline_id = ?')
      .bind(id)
      .first()
    expect(editor).toBeNull()

    // DO 存储已清空 —— 同 id 重新发布不会复活旧内容
    expect(await stub.getSnapshotJson()).toBeNull()
  })

  it('非作者删除返回 404,不影响时间轴', async () => {
    const id = await publishOne('del-forbidden-00000001', 'T')
    const otherJwt = await signAccessToken('other-user', 'Other', JWT_SECRET)
    const res = await SELF.fetch(`https://app/api/timelines/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${otherJwt}` },
    })
    expect(res.status).toBe(404)
    const row = await env.healerbook_timelines
      .prepare('SELECT 1 FROM timelines WHERE id = ?')
      .bind(id)
      .first()
    expect(row).not.toBeNull()
  })

  it('删除时间轴时一并清理待处理的编辑申请', async () => {
    await publishOne('del-cleanup-req', 'x')
    await env.healerbook_timelines
      .prepare(
        'INSERT INTO timeline_edit_requests (timeline_id, user_id, user_name, created_at) VALUES (?,?,?,?)'
      )
      .bind('del-cleanup-req', 'viewer-9', 'V9', Date.now())
      .run()

    const res = await SELF.fetch('https://app/api/timelines/del-cleanup-req', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${await authorJwt()}` },
    })
    expect(res.status).toBe(204)

    const left = await env.healerbook_timelines
      .prepare('SELECT COUNT(*) AS n FROM timeline_edit_requests WHERE timeline_id = ?')
      .bind('del-cleanup-req')
      .first<{ n: number }>()
    expect(left?.n).toBe(0)
  })
})
