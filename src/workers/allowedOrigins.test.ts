import { describe, it, expect } from 'vitest'
import { isAllowedOrigin } from './allowedOrigins'

describe('isAllowedOrigin', () => {
  it('接受白名单 apex 域名', () => {
    expect(isAllowedOrigin('https://xivhealer.com')).toBe(true)
    expect(isAllowedOrigin('https://xivhealer.cn')).toBe(true)
  })

  it('接受白名单子域名（含多级子域）', () => {
    expect(isAllowedOrigin('https://www.xivhealer.com')).toBe(true)
    expect(isAllowedOrigin('https://beta.app.xivhealer.cn')).toBe(true)
  })

  it('hostname 大小写不敏感', () => {
    expect(isAllowedOrigin('https://WWW.XIVHEALER.COM')).toBe(true)
  })

  it('拒绝非白名单域名（含相似域名混淆）', () => {
    expect(isAllowedOrigin('https://evil.com')).toBe(false)
    expect(isAllowedOrigin('https://xivhealer.com.evil.com')).toBe(false)
    expect(isAllowedOrigin('https://notxivhealer.com')).toBe(false)
  })

  it('拒绝非 https 来源', () => {
    expect(isAllowedOrigin('http://www.xivhealer.com')).toBe(false)
    expect(isAllowedOrigin('http://localhost:5173')).toBe(false)
  })

  it('拒绝缺失或非法的 origin', () => {
    expect(isAllowedOrigin(null)).toBe(false)
    expect(isAllowedOrigin(undefined)).toBe(false)
    expect(isAllowedOrigin('')).toBe(false)
    expect(isAllowedOrigin('not-a-url')).toBe(false)
  })
})
