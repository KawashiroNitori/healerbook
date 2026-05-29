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
