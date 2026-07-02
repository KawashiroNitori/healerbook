import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useUIStore } from '@/store/uiStore'
import { requestWithFallback, onApiSuccess } from './apiProvider'

const okRes = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response
const badRes = () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response

describe('apiProvider', () => {
  beforeEach(() => useUIStore.setState({ apiLearned: 'xivcdn' }))
  afterEach(() => vi.unstubAllGlobals())

  it('首选成功返回 {data, provider}', async () => {
    const fetchMock = vi.fn(async () => okRes({ hello: 'world' }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await requestWithFallback<{ hello: string }>('/sheet/Action/1')
    expect(r).toEqual({ data: { hello: 'world' }, provider: 'xivcdn' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://xivapi-v2.xivcdn.com/api/sheet/Action/1')
  })

  it('首选失败回退到下一源', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(badRes())
      .mockResolvedValueOnce(okRes({ ok: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await requestWithFallback('/x')
    expect(r.provider).toBe('xivapi')
    expect(fetchMock.mock.calls[1][0]).toBe('https://v2.xivapi.com/api/x')
  })

  it('preferred 参数决定首选顺序', async () => {
    const fetchMock = vi.fn(async () => okRes({ ok: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    await requestWithFallback('/y', 'xivapi')
    expect(fetchMock.mock.calls[0][0]).toBe('https://v2.xivapi.com/api/y')
  })

  it('全部失败则抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => badRes())
    )
    await expect(requestWithFallback('/z')).rejects.toThrow()
  })

  it('onApiSuccess 与当前不同才写回', () => {
    onApiSuccess('xivcdn')
    expect(useUIStore.getState().apiLearned).toBe('xivcdn')
    onApiSuccess('xivapi')
    expect(useUIStore.getState().apiLearned).toBe('xivapi')
  })
})
