import { describe, it, expect } from 'vitest'
import { resolveRedirectUri } from './auth'

describe('resolveRedirectUri', () => {
  describe('生产环境（isDev=false）', () => {
    it('接受白名单 apex 域名并返回 /callback', () => {
      expect(resolveRedirectUri('https://xivhealer.com', false)).toBe(
        'https://xivhealer.com/callback'
      )
      expect(resolveRedirectUri('https://xivhealer.cn', false)).toBe(
        'https://xivhealer.cn/callback'
      )
    })

    it('接受白名单子域名', () => {
      expect(resolveRedirectUri('https://www.xivhealer.com', false)).toBe(
        'https://www.xivhealer.com/callback'
      )
      expect(resolveRedirectUri('https://beta.app.xivhealer.cn', false)).toBe(
        'https://beta.app.xivhealer.cn/callback'
      )
    })

    it('忽略 origin 中的端口/路径，仅保留 origin 部分', () => {
      expect(resolveRedirectUri('https://www.xivhealer.com:443', false)).toBe(
        'https://www.xivhealer.com/callback'
      )
    })

    it('大小写不敏感匹配 hostname', () => {
      expect(resolveRedirectUri('https://WWW.XIVHEALER.COM', false)).toBe(
        'https://www.xivhealer.com/callback'
      )
    })

    it('拒绝非白名单域名', () => {
      expect(resolveRedirectUri('https://evil.com', false)).toBeNull()
      expect(resolveRedirectUri('https://xivhealer.com.evil.com', false)).toBeNull()
      expect(resolveRedirectUri('https://notxivhealer.com', false)).toBeNull()
    })

    it('拒绝非 https 来源', () => {
      expect(resolveRedirectUri('http://www.xivhealer.com', false)).toBeNull()
      expect(resolveRedirectUri('http://localhost:5173', false)).toBeNull()
    })

    it('拒绝缺失或非法的 origin', () => {
      expect(resolveRedirectUri(null, false)).toBeNull()
      expect(resolveRedirectUri(undefined, false)).toBeNull()
      expect(resolveRedirectUri('', false)).toBeNull()
      expect(resolveRedirectUri('not-a-url', false)).toBeNull()
    })
  })

  describe('开发模式（isDev=true）', () => {
    it('放行任意可解析来源', () => {
      expect(resolveRedirectUri('http://localhost:5173', true)).toBe(
        'http://localhost:5173/callback'
      )
      expect(resolveRedirectUri('https://evil.com', true)).toBe('https://evil.com/callback')
      expect(resolveRedirectUri('http://127.0.0.1:8787', true)).toBe(
        'http://127.0.0.1:8787/callback'
      )
    })

    it('仍拒绝缺失或非法的 origin', () => {
      expect(resolveRedirectUri(null, true)).toBeNull()
      expect(resolveRedirectUri('not-a-url', true)).toBeNull()
    })
  })
})
