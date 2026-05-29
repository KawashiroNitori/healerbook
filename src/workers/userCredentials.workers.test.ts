import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

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
