/// <reference types="@cloudflare/workers-types" />

export interface OAuthData {
  access_token: string
  refresh_token: string
  /** unix 秒;0 表示占位/未知 */
  expires_at: number
}

export function serializeOAuthData(d: OAuthData): string {
  return JSON.stringify({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: d.expires_at,
  })
}

export function parseOAuthData(row: { data: string }): OAuthData {
  const raw = JSON.parse(row.data) as Partial<OAuthData>
  return {
    access_token: raw.access_token ?? '',
    refresh_token: raw.refresh_token ?? '',
    expires_at: raw.expires_at ?? 0,
  }
}

/** now(秒) 严格大于 expires_at 即视为过期 */
export function isOAuthExpired(d: OAuthData, nowSec: number): boolean {
  return nowSec > d.expires_at
}

export interface CredentialRow {
  id: number
  user_id: number
  type: string
  provider: string
  identifier: string
  data: string
  created_at: number
  updated_at: number
}

export interface OAuthLoginInput {
  provider: string
  providerUserId: string
  name: string
  accessToken: string
  refreshToken: string
  /** unix 秒 */
  expiresAt: number
}

export async function findCredential(
  db: D1Database,
  provider: string,
  identifier: string
): Promise<CredentialRow | null> {
  return db
    .prepare(
      'SELECT id, user_id, type, provider, identifier, data, created_at, updated_at FROM user_credentials WHERE provider = ? AND identifier = ?'
    )
    .bind(provider, identifier)
    .first<CredentialRow>()
}

/**
 * register 流程：单条 batch（隐式事务）内 INSERT users + INSERT user_credentials。
 * 第二条用 last_insert_rowid() 引用刚建的 users.id（同一连接顺序执行）。
 * 唯一约束冲突或写库失败时整批回滚并抛错。
 */
export async function registerWithOAuth(
  db: D1Database,
  input: OAuthLoginInput
): Promise<{ userId: number }> {
  const now = Math.floor(Date.now() / 1000)
  const data = serializeOAuthData({
    access_token: input.accessToken,
    refresh_token: input.refreshToken,
    expires_at: input.expiresAt,
  })
  const [usersRes] = await db.batch([
    db
      .prepare('INSERT INTO users (name, created_at, updated_at) VALUES (?, ?, ?)')
      .bind(input.name, now, now),
    db
      .prepare(
        "INSERT INTO user_credentials (user_id, type, provider, identifier, data, created_at, updated_at) VALUES (last_insert_rowid(), 'oauth', ?, ?, ?, ?, ?)"
      )
      .bind(input.provider, input.providerUserId, data, now, now),
  ])
  return { userId: usersRes.meta.last_row_id as number }
}
