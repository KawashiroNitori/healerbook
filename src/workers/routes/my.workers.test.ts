import { describe, it, expect } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@/workers/jwt'

const JWT_SECRET = 'test-secret'

async function jwtFor(userId: string, name: string): Promise<string> {
  return signAccessToken(userId, name, JWT_SECRET)
}

async function publishAs(userId: string, name: string, id: string): Promise<void> {
  const res = await SELF.fetch('https://app/api/timelines', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await jwtFor(userId, name)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id, name: `tl-${id}` }),
  })
  if (res.status !== 201) throw new Error(`publishAs failed: ${res.status}`)
}

describe('GET /api/my/timelines', () => {
  it('未登录返回 401', async () => {
    const res = await SELF.fetch('https://app/api/my/timelines')
    expect(res.status).toBe(401)
  })

  it('无记录返回空数组', async () => {
    const res = await SELF.fetch('https://app/api/my/timelines', {
      headers: { Authorization: `Bearer ${await jwtFor('nobody-1', 'Nobody')}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('只返回该用户的时间轴，按 updated_at 倒序', async () => {
    await publishAs('u1', 'User1', 'my-a1')
    await publishAs('u1', 'User1', 'my-a2')
    await publishAs('u2', 'User2', 'my-b1')
    // 发布在同一秒内 updated_at 相同，直接改 D1 制造确定顺序
    await env.healerbook_timelines
      .prepare('UPDATE timelines SET updated_at = ? WHERE id = ?')
      .bind(1000, 'my-a1')
      .run()
    await env.healerbook_timelines
      .prepare('UPDATE timelines SET updated_at = ? WHERE id = ?')
      .bind(2000, 'my-a2')
      .run()

    const res = await SELF.fetch('https://app/api/my/timelines', {
      headers: { Authorization: `Bearer ${await jwtFor('u1', 'User1')}` },
    })
    const items = (await res.json()) as { id: string }[]
    expect(items.map(i => i.id)).toEqual(['my-a2', 'my-a1'])
  })

  it('阵容优先读 content.composition，回退旧格式 content.c 并过滤空槽位', async () => {
    await publishAs('u3', 'User3', 'my-comp-new')
    await publishAs('u3', 'User3', 'my-comp-old')
    await env.healerbook_timelines
      .prepare('UPDATE timelines SET content = ? WHERE id = ?')
      .bind(JSON.stringify({ composition: { players: [{ id: 0, job: 'WHM' }] } }), 'my-comp-new')
      .run()
    await env.healerbook_timelines
      .prepare('UPDATE timelines SET content = ? WHERE id = ?')
      .bind(JSON.stringify({ c: ['SCH', '', 'AST'] }), 'my-comp-old')
      .run()

    const res = await SELF.fetch('https://app/api/my/timelines', {
      headers: { Authorization: `Bearer ${await jwtFor('u3', 'User3')}` },
    })
    const items = (await res.json()) as {
      id: string
      composition: { players: { id: number; job: string }[] } | null
    }[]
    const byId = new Map(items.map(i => [i.id, i]))
    expect(byId.get('my-comp-new')!.composition).toEqual({ players: [{ id: 0, job: 'WHM' }] })
    expect(byId.get('my-comp-old')!.composition).toEqual({
      players: [
        { id: 0, job: 'SCH' },
        { id: 2, job: 'AST' },
      ],
    })
  })
})
