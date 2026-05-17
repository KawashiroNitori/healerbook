import { describe, it, expect } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@/workers/jwt'

const JWT_SECRET = 'test-secret'
const AUTHOR = { id: 'share-author', name: 'Author' }

async function publishOne(id: string): Promise<string> {
  const jwt = await signAccessToken(AUTHOR.id, AUTHOR.name, JWT_SECRET)
  const res = await SELF.fetch('https://app/api/timelines', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name: 'T' }),
  })
  if (res.status !== 201) throw new Error(`publish failed ${res.status}`)
  return id
}

const authHeader = async (userId: string, name: string) => ({
  Authorization: `Bearer ${await signAccessToken(userId, name, JWT_SECRET)}`,
})

describe('GET/PATCH /api/timelines/:id/share', () => {
  it('作者读到开关与空列表', async () => {
    const id = await publishOne('share-get-00000000001')
    const res = await SELF.fetch(`https://app/api/timelines/${id}/share`, {
      headers: await authHeader(AUTHOR.id, AUTHOR.name),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      allowEditRequests: boolean
      editors: unknown[]
      applicants: unknown[]
    }
    expect(body.allowEditRequests).toBe(false)
    expect(body.editors).toEqual([])
    expect(body.applicants).toEqual([])
  })

  it('非作者读 share 返回 403', async () => {
    const id = await publishOne('share-get-00000000002')
    const res = await SELF.fetch(`https://app/api/timelines/${id}/share`, {
      headers: await authHeader('intruder', 'X'),
    })
    expect(res.status).toBe(403)
  })

  it('作者 PATCH 开关后 GET 反映新值', async () => {
    const id = await publishOne('share-patch-0000000001')
    const patch = await SELF.fetch(`https://app/api/timelines/${id}/share`, {
      method: 'PATCH',
      headers: {
        ...(await authHeader(AUTHOR.id, AUTHOR.name)),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ allowEditRequests: true }),
    })
    expect(patch.status).toBe(200)
    const res = await SELF.fetch(`https://app/api/timelines/${id}/share`, {
      headers: await authHeader(AUTHOR.id, AUTHOR.name),
    })
    const body = (await res.json()) as { allowEditRequests: boolean }
    expect(body.allowEditRequests).toBe(true)
  })

  it('非作者 PATCH 开关返回 403', async () => {
    const id = await publishOne('share-patch-0000000002')
    const res = await SELF.fetch(`https://app/api/timelines/${id}/share`, {
      method: 'PATCH',
      headers: { ...(await authHeader('intruder', 'X')), 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowEditRequests: true }),
    })
    expect(res.status).toBe(403)
  })
})

describe('编辑权限申请生命周期', () => {
  it('开关开时可发起申请,写入 timeline_edit_requests', async () => {
    const id = await publishOne('share-req-00000000001')
    await SELF.fetch(`https://app/api/timelines/${id}/share`, {
      method: 'PATCH',
      headers: {
        ...(await authHeader(AUTHOR.id, AUTHOR.name)),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ allowEditRequests: true }),
    })
    const res = await SELF.fetch(`https://app/api/timelines/${id}/edit-requests`, {
      method: 'POST',
      headers: await authHeader('applicant-1', 'Applicant'),
    })
    expect(res.status).toBe(201)
    const row = await env.healerbook_timelines
      .prepare('SELECT user_name FROM timeline_edit_requests WHERE timeline_id = ? AND user_id = ?')
      .bind(id, 'applicant-1')
      .first<{ user_name: string }>()
    expect(row?.user_name).toBe('Applicant')
  })

  it('开关关时发起申请返回 403', async () => {
    const id = await publishOne('share-req-00000000002')
    const res = await SELF.fetch(`https://app/api/timelines/${id}/edit-requests`, {
      method: 'POST',
      headers: await authHeader('applicant-2', 'A'),
    })
    expect(res.status).toBe(403)
  })

  it('已是编辑者发起申请返回 409', async () => {
    const id = await publishOne('share-req-00000000003')
    const res = await SELF.fetch(`https://app/api/timelines/${id}/edit-requests`, {
      method: 'POST',
      headers: await authHeader(AUTHOR.id, AUTHOR.name), // 作者本身在 editors 表
    })
    expect(res.status).toBe(409)
  })

  it('作者通过申请:删 request 行 + 写 editors 行', async () => {
    const id = await publishOne('share-req-00000000004')
    await env.healerbook_timelines
      .prepare(
        'INSERT INTO timeline_edit_requests (timeline_id, user_id, user_name, created_at) VALUES (?,?,?,?)'
      )
      .bind(id, 'app-4', 'App4', Date.now())
      .run()
    const res = await SELF.fetch(`https://app/api/timelines/${id}/edit-requests/app-4/approve`, {
      method: 'POST',
      headers: await authHeader(AUTHOR.id, AUTHOR.name),
    })
    expect(res.status).toBe(200)
    const req = await env.healerbook_timelines
      .prepare('SELECT 1 FROM timeline_edit_requests WHERE timeline_id = ? AND user_id = ?')
      .bind(id, 'app-4')
      .first()
    expect(req).toBeNull()
    const editor = await env.healerbook_timelines
      .prepare('SELECT user_name FROM timeline_editors WHERE timeline_id = ? AND user_id = ?')
      .bind(id, 'app-4')
      .first<{ user_name: string }>()
    expect(editor?.user_name).toBe('App4')
  })

  it('作者拒绝申请:删 request 行,不写 editors', async () => {
    const id = await publishOne('share-req-00000000005')
    await env.healerbook_timelines
      .prepare(
        'INSERT INTO timeline_edit_requests (timeline_id, user_id, user_name, created_at) VALUES (?,?,?,?)'
      )
      .bind(id, 'app-5', 'App5', Date.now())
      .run()
    const res = await SELF.fetch(`https://app/api/timelines/${id}/edit-requests/app-5/reject`, {
      method: 'POST',
      headers: await authHeader(AUTHOR.id, AUTHOR.name),
    })
    expect(res.status).toBe(200)
    const req = await env.healerbook_timelines
      .prepare('SELECT 1 FROM timeline_edit_requests WHERE timeline_id = ? AND user_id = ?')
      .bind(id, 'app-5')
      .first()
    expect(req).toBeNull()
    const editor = await env.healerbook_timelines
      .prepare('SELECT 1 FROM timeline_editors WHERE timeline_id = ? AND user_id = ?')
      .bind(id, 'app-5')
      .first()
    expect(editor).toBeNull()
  })

  it('非作者 approve/reject 返回 403', async () => {
    const id = await publishOne('share-req-00000000006')
    const res = await SELF.fetch(`https://app/api/timelines/${id}/edit-requests/whoever/approve`, {
      method: 'POST',
      headers: await authHeader('intruder', 'X'),
    })
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/timelines/:id/editors/:userId', () => {
  it('作者移除编辑者:删 timeline_editors 行', async () => {
    const id = await publishOne('share-rm-000000000001')
    await env.healerbook_timelines
      .prepare(
        'INSERT INTO timeline_editors (timeline_id, user_id, user_name, created_at) VALUES (?,?,?,?)'
      )
      .bind(id, 'editor-x', 'EditorX', Date.now())
      .run()
    const res = await SELF.fetch(`https://app/api/timelines/${id}/editors/editor-x`, {
      method: 'DELETE',
      headers: await authHeader(AUTHOR.id, AUTHOR.name),
    })
    expect(res.status).toBe(200)
    const row = await env.healerbook_timelines
      .prepare('SELECT 1 FROM timeline_editors WHERE timeline_id = ? AND user_id = ?')
      .bind(id, 'editor-x')
      .first()
    expect(row).toBeNull()
  })

  it('不可移除作者本人,返回 400', async () => {
    const id = await publishOne('share-rm-000000000002')
    const res = await SELF.fetch(`https://app/api/timelines/${id}/editors/${AUTHOR.id}`, {
      method: 'DELETE',
      headers: await authHeader(AUTHOR.id, AUTHOR.name),
    })
    expect(res.status).toBe(400)
  })

  it('非作者移除编辑者返回 403', async () => {
    const id = await publishOne('share-rm-000000000003')
    const res = await SELF.fetch(`https://app/api/timelines/${id}/editors/whoever`, {
      method: 'DELETE',
      headers: await authHeader('intruder', 'X'),
    })
    expect(res.status).toBe(403)
  })
})
