import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '@/store/uiStore'
import { getStatusIconUrl, getStatusName } from './statusIconUtils'

describe('getStatusIconUrl', () => {
  beforeEach(() => useUIStore.setState({ iconLearned: 'xivcdn' }))

  it('已知 statusId 用首选源拼 URL', () => {
    // 眩晕 statusId=2（statusData[2] = ['眩晕', '215004', '1']）
    const url = getStatusIconUrl(2)
    expect(url).toMatch(
      /^https:\/\/xivapi-v2\.xivcdn\.com\/api\/asset\?path=ui\/icon\/\d{6}\/\d{6}_hr1\.tex$/
    )
  })
  it('未知 statusId → undefined', () => {
    expect(getStatusIconUrl(999999999)).toBeUndefined()
    expect(getStatusName(999999999)).toBeUndefined()
  })
})
