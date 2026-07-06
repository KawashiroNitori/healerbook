import { describe, it, expect } from 'vitest'
import { env, SELF } from 'cloudflare:test'

describe('GET /api/internal/do-lookup', () => {
  const authHeaders = { Authorization: 'Bearer test-sync-token' }

  it('缺 doId 返回 400', async () => {
    const res = await SELF.fetch('https://app/api/internal/do-lookup', {
      headers: authHeaders,
    })
    expect(res.status).toBe(400)
  })

  it('非法 doId 返回 400', async () => {
    const res = await SELF.fetch('https://app/api/internal/do-lookup?doId=not-a-valid-hex', {
      headers: authHeaders,
    })
    expect(res.status).toBe(400)
  })

  it('由 DO id 反查出 timelineId 并补全 D1 元信息', async () => {
    const docName = 'diagLookupDoc00000001'
    const now = Math.floor(Date.now() / 1000)
    await env.healerbook_timelines
      .prepare(
        'INSERT INTO timelines (id, name, author_id, author_name, published_at, updated_at, version, content) VALUES (?,?,?,?,?,?,?,?)'
      )
      .bind(docName, '查测标题', 'auth-diag', 'AuthDiag', now, now, 1, '{}')
      .run()

    // /connect 让 DO 把 timelineId 存进 storage('docId')
    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(docName))
    await stub.fetch('https://do/connect', {
      headers: { Upgrade: 'websocket', 'X-Timeline-Id': docName },
    })

    const hex = env.TIMELINE_DOC.idFromName(docName).toString()
    const res = await SELF.fetch(`https://app/api/internal/do-lookup?doId=${hex}`, {
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      doId: hex,
      timelineId: docName,
      name: '查测标题',
      authorId: 'auth-diag',
      authorName: 'AuthDiag',
    })
  })

  it('合法但从未 /connect 的 DO 返回 404', async () => {
    const hex = env.TIMELINE_DOC.idFromName('diagLookupNever0001').toString()
    const res = await SELF.fetch(`https://app/api/internal/do-lookup?doId=${hex}`, {
      headers: authHeaders,
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ timelineId: null })
  })

  it('缺少 Authorization 头返回 401', async () => {
    const res = await SELF.fetch(
      'https://app/api/internal/do-lookup?doId=00000000000000000000000000000000'
    )
    expect(res.status).toBe(401)
  })
})
