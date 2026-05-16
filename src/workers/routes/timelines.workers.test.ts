import { describe, it, expect } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@/workers/jwt'

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
    expect(body.snapshot).toBeUndefined()
  })

  it('404 for unknown id', async () => {
    const res = await SELF.fetch('https://app/api/timelines/does-not-exist-00000001')
    expect(res.status).toBe(404)
  })
})
