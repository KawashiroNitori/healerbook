import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { findCredential, getCredential, loginWithOAuth, registerWithOAuth } from './userCredentials'

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

describe('loginWithOAuth', () => {
  const base = {
    provider: 'fflogs',
    providerUserId: 'login-1',
    name: 'First',
    accessToken: 'tok-1',
    refreshToken: '',
    expiresAt: 1000,
  }

  it('首次登录 isNew=true，再次登录 isNew=false、userId 不变、token 与 name 被更新', async () => {
    // 首次登录
    const r1 = await loginWithOAuth(env.healerbook_timelines, base)
    expect(r1.isNew).toBe(true)
    expect(r1.userId).toBeGreaterThanOrEqual(1000001)

    // 再次登录（同一 provider+identifier，更新 name 和 token）
    const r2 = await loginWithOAuth(env.healerbook_timelines, {
      ...base,
      name: 'Renamed',
      accessToken: 'tok-2',
      expiresAt: 2000,
    })
    expect(r2.isNew).toBe(false)
    expect(r2.userId).toBe(r1.userId)

    const cred = await findCredential(env.healerbook_timelines, 'fflogs', 'login-1')
    expect(JSON.parse(cred!.data).access_token).toBe('tok-2')
    expect(JSON.parse(cred!.data).expires_at).toBe(2000)
    const u = await env.healerbook_timelines
      .prepare('SELECT name FROM users WHERE id = ?')
      .bind(r2.userId)
      .first<{ name: string }>()
    expect(u?.name).toBe('Renamed')
  })

  it('命中存量占位凭据(空 token)时补写 token，复用其 user_id', async () => {
    // 模拟回填产生的存量：user_id=42 + 空 token 占位凭据
    const now = 1
    await env.healerbook_timelines
      .prepare('INSERT INTO users (id, name, created_at, updated_at) VALUES (42, ?, ?, ?)')
      .bind('Legacy', now, now)
      .run()
    await env.healerbook_timelines
      .prepare(
        "INSERT INTO user_credentials (user_id, type, provider, identifier, data, created_at, updated_at) VALUES (42, 'oauth', 'fflogs', '42', json_object('access_token','','refresh_token','','expires_at',0), ?, ?)"
      )
      .bind(now, now)
      .run()

    const r = await loginWithOAuth(env.healerbook_timelines, {
      ...base,
      providerUserId: '42',
      name: 'Legacy2',
      accessToken: 'filled',
      expiresAt: 9999,
    })
    expect(r).toEqual({ userId: 42, isNew: false })
    const cred = await findCredential(env.healerbook_timelines, 'fflogs', '42')
    expect(JSON.parse(cred!.data).access_token).toBe('filled')
  })
})

describe('getCredential', () => {
  it('按 (userId, provider) 取回该用户的凭据', async () => {
    const { userId } = await registerWithOAuth(env.healerbook_timelines, {
      provider: 'fflogs',
      providerUserId: 'get-1',
      name: 'G',
      accessToken: 'g-tok',
      refreshToken: '',
      expiresAt: 1,
    })
    const cred = await getCredential(env.healerbook_timelines, userId, 'fflogs')
    expect(cred?.identifier).toBe('get-1')
    expect(JSON.parse(cred!.data).access_token).toBe('g-tok')
  })

  it('无匹配返回 null', async () => {
    expect(await getCredential(env.healerbook_timelines, 999999999, 'fflogs')).toBeNull()
  })
})
