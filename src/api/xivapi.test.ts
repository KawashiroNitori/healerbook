import { describe, it, expect, afterEach, vi } from 'vitest'
import { getActionById } from './xivapi'

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
})
