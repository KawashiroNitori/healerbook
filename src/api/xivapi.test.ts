import { describe, it, expect, afterEach, vi } from 'vitest'
import { getActionById, toApiLanguage } from './xivapi'

const RESP = {
  row_id: 16536,
  fields: {
    Name: '深仁厚泽',
    Icon: { path: 'ui/icon/002000/002645.tex', path_hr1: 'ui/icon/002000/002645_hr1.tex' },
    ClassJobLevel: 30,
    Range: 30,
    EffectRange: 0,
    Cast100ms: 0,
    Recast100ms: 900,
    PrimaryCostType: 0,
    PrimaryCostValue: 0,
    ClassJob: { value: 1 },
  },
  transient: { 'Description@as(html)': '<p>desc</p>' },
}
const okRes = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response
const badRes = () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response

describe('getActionById', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('返回 CafeMakerAction，Icon 为原始路径', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okRes(RESP))
    )
    const action = await getActionById(16536)
    expect(action?.Name).toBe('深仁厚泽')
    expect(action?.Icon).toBe('ui/icon/002000/002645.tex')
    expect(action?.IconHD).toBe('ui/icon/002000/002645_hr1.tex')
  })

  it('全部源失败返回 null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => badRes())
    )
    expect(await getActionById(16536)).toBeNull()
  })

  it('en/ja/de/fr 带 language 参数请求', async () => {
    const fetchMock = vi.fn(async () => okRes(RESP))
    vi.stubGlobal('fetch', fetchMock)
    await getActionById(16536, 'ja')
    expect(String(fetchMock.mock.calls[0][0])).toContain('language=ja')
  })

  it('zh-CN / zh-TW 不带 language 参数（取镜像默认简体）', async () => {
    const fetchMock = vi.fn(async () => okRes(RESP))
    vi.stubGlobal('fetch', fetchMock)
    await getActionById(16536, 'zh-CN')
    await getActionById(16536, 'zh-TW')
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('language=')
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('language=')
  })
})

describe('toApiLanguage', () => {
  it('en/ja/de/fr 原样返回，中文映射为 null', () => {
    expect(toApiLanguage('ja')).toBe('ja')
    expect(toApiLanguage('en')).toBe('en')
    expect(toApiLanguage('de')).toBe('de')
    expect(toApiLanguage('fr')).toBe('fr')
    expect(toApiLanguage('zh-CN')).toBeNull()
    expect(toApiLanguage('zh-TW')).toBeNull()
  })
})
