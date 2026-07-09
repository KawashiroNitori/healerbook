import { describe, it, expect, vi, afterEach } from 'vitest'
import { rewriteFFLogsUrl, fflogsFetch } from './fflogsProxy'

const BASE = 'https://ffproxy.example.com'

describe('rewriteFFLogsUrl', () => {
  it('proxyBase 未配置时原样返回', () => {
    const url = 'https://www.fflogs.com/oauth/token'
    expect(rewriteFFLogsUrl(url, undefined)).toBe(url)
    expect(rewriteFFLogsUrl(url, '')).toBe(url)
  })

  it('www 上游改写为 /www 前缀', () => {
    expect(rewriteFFLogsUrl('https://www.fflogs.com/oauth/token', BASE)).toBe(
      'https://ffproxy.example.com/www/oauth/token'
    )
    expect(rewriteFFLogsUrl('https://www.fflogs.com/api/v2/client', BASE)).toBe(
      'https://ffproxy.example.com/www/api/v2/client'
    )
    expect(rewriteFFLogsUrl('https://www.fflogs.com/api/v2/user', BASE)).toBe(
      'https://ffproxy.example.com/www/api/v2/user'
    )
  })

  it('cn 上游改写为 /cn 前缀', () => {
    expect(rewriteFFLogsUrl('https://cn.fflogs.com/api/v2/client', BASE)).toBe(
      'https://ffproxy.example.com/cn/api/v2/client'
    )
  })

  it('保留 query string', () => {
    expect(rewriteFFLogsUrl('https://www.fflogs.com/api/v2/client?a=1&b=2', BASE)).toBe(
      'https://ffproxy.example.com/www/api/v2/client?a=1&b=2'
    )
  })

  it('proxyBase 末尾斜杠被归一化', () => {
    expect(rewriteFFLogsUrl('https://www.fflogs.com/oauth/token', BASE + '/')).toBe(
      'https://ffproxy.example.com/www/oauth/token'
    )
  })

  it('非 fflogs.com 域名原样透传', () => {
    const url = 'https://example.org/api/v2/client'
    expect(rewriteFFLogsUrl(url, BASE)).toBe(url)
  })
})

describe('fflogsFetch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('未配置代理时直连原 URL 且不加 secret header', async () => {
    const spy = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', spy)
    await fflogsFetch('https://www.fflogs.com/oauth/token', { method: 'POST' }, {})
    const [target, init] = spy.mock.calls[0]
    expect(target).toBe('https://www.fflogs.com/oauth/token')
    expect(new Headers((init as RequestInit).headers).has('X-Proxy-Secret')).toBe(false)
  })

  it('配置代理时改写 URL 并注入 secret header', async () => {
    const spy = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', spy)
    await fflogsFetch(
      'https://cn.fflogs.com/api/v2/client',
      { method: 'POST', headers: { Authorization: 'Bearer t' } },
      { proxyBase: BASE, proxySecret: 'sekret' }
    )
    const [target, init] = spy.mock.calls[0]
    expect(target).toBe('https://ffproxy.example.com/cn/api/v2/client')
    const headers = new Headers((init as RequestInit).headers)
    expect(headers.get('X-Proxy-Secret')).toBe('sekret')
    expect(headers.get('Authorization')).toBe('Bearer t') // 原 header 保留
  })

  it('有 base 无 secret 时改写 URL 但不加 secret header', async () => {
    const spy = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', spy)
    await fflogsFetch('https://www.fflogs.com/api/v2/client', {}, { proxyBase: BASE })
    const [target, init] = spy.mock.calls[0]
    expect(target).toBe('https://ffproxy.example.com/www/api/v2/client')
    expect(new Headers((init as RequestInit).headers).has('X-Proxy-Secret')).toBe(false)
  })
})
