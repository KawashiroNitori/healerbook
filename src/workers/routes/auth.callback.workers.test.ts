import { describe, it, expect, vi, afterEach } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import { verifyToken } from '@/workers/jwt'

// 让 worker 内部对 fflogs 的两次 fetch 返回可控结果。
// 注意：vi.stubGlobal 仅在 worker 与测试运行于同一 isolate 时有效（当前非 service binding 模式）。
// 若将 auth worker 提取为独立 service binding，stub 将不再拦截内部 fetch，需改用 fetchMock / MSW。
function stubFFLogs(userId: number, name: string, expiresIn = 3600) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'ff-access',
            token_type: 'Bearer',
            expires_in: expiresIn,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (url.includes('/api/v2/user')) {
        return new Response(
          JSON.stringify({ data: { userData: { currentUser: { id: userId, name } } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
  )
}

async function callback(code: string) {
  return SELF.fetch('https://app/api/auth/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ code }),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('POST /api/auth/callback', () => {
  it('全新 fflogs 用户:建用户、sub=my-user-id(≥1000001)、token 落库', async () => {
    stubFFLogs(777001, 'Newbie')
    const res = await callback('any-code')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user_id: string; name: string; access_token: string }

    const myId = Number(body.user_id)
    expect(myId).toBeGreaterThanOrEqual(1000001)
    expect(body.name).toBe('Newbie')

    const verified = await verifyToken(body.access_token, 'test-secret')
    expect(verified.ok && verified.payload.sub).toBe(body.user_id)

    const cred = await env.healerbook_timelines
      .prepare(
        "SELECT user_id, data FROM user_credentials WHERE provider='fflogs' AND identifier='777001'"
      )
      .first<{ user_id: number; data: string }>()
    expect(cred?.user_id).toBe(myId)
    expect(JSON.parse(cred!.data).access_token).toBe('ff-access')
  })

  it('同一 fflogs 账号再次登录:复用 my-user-id', async () => {
    stubFFLogs(777002, 'Repeat')
    const first = (await (await callback('c1')).json()) as { user_id: string }
    stubFFLogs(777002, 'Repeat2')
    const second = (await (await callback('c2')).json()) as { user_id: string; name: string }
    expect(second.user_id).toBe(first.user_id)
    expect(second.name).toBe('Repeat2')
  })

  it('存量回填用户首次真实登录:复用存量 my-user-id、补写占位空 token', async () => {
    // 预置存量回填状态：users.id=500(<1e6,模拟存量 fflogs id 复用)，
    // user_credentials 一行占位凭据(空 token / expires_at=0)。
    await env.healerbook_timelines.batch([
      env.healerbook_timelines
        .prepare('INSERT INTO users (id, name, created_at, updated_at) VALUES (500, ?, 0, 0)')
        .bind('LegacyName'),
      env.healerbook_timelines.prepare(
        "INSERT INTO user_credentials (user_id, type, provider, identifier, data, created_at, updated_at) VALUES (500, 'oauth', 'fflogs', '500', json_object('access_token','','refresh_token','','expires_at',0), 0, 0)"
      ),
    ])

    stubFFLogs(500, 'LegacyName')
    const res = await callback('c')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user_id: string; name: string; access_token: string }

    // 复用存量 my-user-id，未分配新 ≥1000001 id。
    expect(body.user_id).toBe('500')

    const verified = await verifyToken(body.access_token, 'test-secret')
    expect(verified.ok && verified.payload.sub).toBe('500')

    // 占位空 token 被补写为真实 token。
    const cred = await env.healerbook_timelines
      .prepare("SELECT data FROM user_credentials WHERE provider='fflogs' AND identifier='500'")
      .first<{ data: string }>()
    expect(JSON.parse(cred!.data).access_token).toBe('ff-access')
  })
})
