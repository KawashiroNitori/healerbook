import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '@/store/uiStore'
import { getStatusIconUrl, getStatusName } from './statusIconUtils'

describe('getStatusIconUrl', () => {
  beforeEach(() => useUIStore.setState({ iconLearned: 'cafemaker' }))

  it('已知 statusId 用首选源拼 URL', () => {
    // 眩晕 statusId=2（statusData[2] = ['眩晕', '215004', '1']）
    const url = getStatusIconUrl(2)
    expect(url).toMatch(/^https:\/\/cafemaker\.wakingsands\.com\/i\/\d{6}\/\d{6}\.png$/)
  })
  it('未知 statusId → undefined', () => {
    expect(getStatusIconUrl(999999999)).toBeUndefined()
    expect(getStatusName(999999999)).toBeUndefined()
  })
})
