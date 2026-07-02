import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '@/store/uiStore'
import { EMPTY_IMAGE, buildIconUrl, getNextIconProvider, onIconSuccess } from './iconProvider'

describe('iconProvider', () => {
  beforeEach(() => useUIStore.setState({ iconLearned: 'cafemaker' }))

  it('显式 provider 拼 URL', () => {
    expect(buildIconUrl(3253, 'cafemaker')).toBe(
      'https://cafemaker.wakingsands.com/i/003000/003253.png'
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
    expect(buildIconUrl('', 'cafemaker')).toBe(EMPTY_IMAGE)
    expect(buildIconUrl('abc', 'cafemaker')).toBe(EMPTY_IMAGE)
  })
  it('getNextIconProvider 按顺序返回未试源', () => {
    expect(getNextIconProvider([])).toBe('cafemaker')
    expect(getNextIconProvider(['cafemaker'])).toBe('xivapi-asset')
    expect(getNextIconProvider(['cafemaker', 'xivapi-asset'])).toBe('rpglogs')
    expect(getNextIconProvider(['cafemaker', 'xivapi-asset', 'rpglogs'])).toBeUndefined()
  })
  it('onIconSuccess 与当前不同才写回', () => {
    onIconSuccess('cafemaker')
    expect(useUIStore.getState().iconLearned).toBe('cafemaker')
    onIconSuccess('rpglogs')
    expect(useUIStore.getState().iconLearned).toBe('rpglogs')
  })
})
