import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUIStore } from '@/store/uiStore'
import { EMPTY_IMAGE, buildIconUrl, getNextIconProvider, onIconSuccess } from './iconProvider'

describe('iconProvider', () => {
  beforeEach(() => useUIStore.setState({ iconLearned: 'xivcdn' }))

  it('显式 provider 拼 URL', () => {
    expect(buildIconUrl(3253, 'xivcdn')).toBe(
      'https://xivapi-v2.xivcdn.com/api/asset?path=ui/icon/003000/003253_hr1.tex'
    )
    expect(buildIconUrl(3253, 'rpglogs')).toBe(
      'https://assets.rpglogs.cn/img/ff/abilities/003000-003253.png'
    )
  })
  it('省略 provider 时用 iconLearned', () => {
    useUIStore.setState({ iconLearned: 'rpglogs' })
    expect(buildIconUrl('/i/003000/003253.png')).toBe(
      'https://assets.rpglogs.cn/img/ff/abilities/003000-003253.png'
    )
  })
  it('无法解析 → EMPTY_IMAGE', () => {
    expect(buildIconUrl('', 'xivcdn')).toBe(EMPTY_IMAGE)
    expect(buildIconUrl('abc', 'xivcdn')).toBe(EMPTY_IMAGE)
  })
  it('getNextIconProvider 按顺序返回未试源', () => {
    expect(getNextIconProvider([])).toBe('xivcdn')
    expect(getNextIconProvider(['xivcdn'])).toBe('xivapi-asset')
    expect(getNextIconProvider(['xivcdn', 'xivapi-asset'])).toBe('rpglogs')
    expect(getNextIconProvider(['xivcdn', 'xivapi-asset', 'rpglogs'])).toBeUndefined()
  })
  it('onIconSuccess 与当前不同才写回', () => {
    onIconSuccess('xivcdn')
    expect(useUIStore.getState().iconLearned).toBe('xivcdn')
    onIconSuccess('rpglogs')
    expect(useUIStore.getState().iconLearned).toBe('rpglogs')
  })
  it('onIconSuccess 相同源不调用 setIconLearned（dedup）', () => {
    useUIStore.setState({ iconLearned: 'xivcdn' })
    const spy = vi.spyOn(useUIStore.getState(), 'setIconLearned')
    onIconSuccess('xivcdn')
    expect(spy).not.toHaveBeenCalled()
    onIconSuccess('rpglogs')
    expect(spy).toHaveBeenCalledWith('rpglogs')
    spy.mockRestore()
  })
  it('未知 provider 回退到 DEFAULT_ICON_PROVIDER', () => {
    expect(buildIconUrl(3253, 'nope' as never)).toBe(
      'https://xivapi-v2.xivcdn.com/api/asset?path=ui/icon/003000/003253_hr1.tex'
    )
  })
})
