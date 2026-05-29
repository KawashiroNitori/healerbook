import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { findCredential, registerWithOAuth } from './userCredentials'

const db = () => env.healerbook_timelines

describe('migration 0005 schema', () => {
  it('users 与 user_credentials 表存在', async () => {
    const rows = await db()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','user_credentials')"
      )
      .all<{ name: string }>()
    const names = rows.results.map(r => r.name).sort()
    expect(names).toEqual(['user_credentials', 'users'])
  })

  it('seed 后 users 自增下一个值为 1000001', async () => {
    const seq = await db()
      .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'users'")
      .first<{ seq: number }>()
    expect(seq?.seq).toBe(1000000)
  })

  it('UNIQUE(provider, identifier) 拒重复', async () => {
    const now = 1
    await db()
      .prepare('INSERT INTO users (name, created_at, updated_at) VALUES (?, ?, ?)')
      .bind('u', now, now)
      .run()
    const uid = (await db().prepare('SELECT last_insert_rowid() AS id').first<{ id: number }>())!.id
    const ins = (id: string) =>
      db()
        .prepare(
          'INSERT INTO user_credentials (user_id, type, provider, identifier, data, created_at, updated_at) VALUES (?, \'oauth\', \'dupprov\', ?, \'{"access_token":"","refresh_token":"","expires_at":0}\', ?, ?)'
        )
        .bind(uid, id, now, now)
        .run()
    await ins('dup-1')
    await expect(ins('dup-1')).rejects.toThrow()
  })
})

describe('registerWithOAuth + findCredential', () => {
  const input = {
    provider: 'fflogs',
    providerUserId: 'reg-100',
    name: 'Reg',
    accessToken: 'a-tok',
    refreshToken: '',
    expiresAt: 5000,
  }

  it('注册分配自增 user_id ≥1000001 并写入凭据', async () => {
    const { userId } = await registerWithOAuth(env.healerbook_timelines, input)
    expect(userId).toBeGreaterThanOrEqual(1000001)

    const cred = await findCredential(env.healerbook_timelines, 'fflogs', 'reg-100')
    expect(cred).not.toBeNull()
    expect(cred!.user_id).toBe(userId)
    expect(cred!.type).toBe('oauth')
    expect(JSON.parse(cred!.data).access_token).toBe('a-tok')
  })

  it('users.name 取 register 传入的 name', async () => {
    const { userId } = await registerWithOAuth(env.healerbook_timelines, {
      ...input,
      providerUserId: 'reg-101',
      name: 'NameCheck',
    })
    const u = await env.healerbook_timelines
      .prepare('SELECT name FROM users WHERE id = ?')
      .bind(userId)
      .first<{ name: string }>()
    expect(u?.name).toBe('NameCheck')
  })

  it('findCredential 未命中返回 null', async () => {
    expect(await findCredential(env.healerbook_timelines, 'fflogs', 'no-such')).toBeNull()
  })

  it('重复注册同一 (provider, identifier) 抛错（唯一约束）', async () => {
    await registerWithOAuth(env.healerbook_timelines, { ...input, providerUserId: 'reg-dup' })
    await expect(
      registerWithOAuth(env.healerbook_timelines, { ...input, providerUserId: 'reg-dup' })
    ).rejects.toThrow()
  })
})
