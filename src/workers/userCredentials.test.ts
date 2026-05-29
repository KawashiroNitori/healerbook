import { describe, it, expect } from 'vitest'
import {
  serializeOAuthData,
  parseOAuthData,
  isOAuthExpired,
  type OAuthData,
} from './userCredentials'

const sample: OAuthData = { access_token: 'tok', refresh_token: '', expires_at: 1000 }

describe('OAuth data 读写', () => {
  it('serialize → parse 往返一致', () => {
    const json = serializeOAuthData(sample)
    expect(parseOAuthData({ data: json })).toEqual(sample)
  })

  it('parse 缺字段时回退为安全默认', () => {
    expect(parseOAuthData({ data: '{}' })).toEqual({
      access_token: '',
      refresh_token: '',
      expires_at: 0,
    })
  })
})

describe('isOAuthExpired', () => {
  it('now 超过 expires_at 判过期', () => {
    expect(isOAuthExpired(sample, 1001)).toBe(true)
  })
  it('now 等于或早于 expires_at 不算过期', () => {
    expect(isOAuthExpired(sample, 1000)).toBe(false)
    expect(isOAuthExpired(sample, 999)).toBe(false)
  })
  it('expires_at=0 占位凭据恒判过期（文档化占位语义）', () => {
    expect(isOAuthExpired({ access_token: '', refresh_token: '', expires_at: 0 }, 1)).toBe(true)
  })
})
