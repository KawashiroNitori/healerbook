/**
 * 状态图标工具函数测试
 */

import { describe, it, expect } from 'vitest'
import { getStatusIconUrl, getStatusName } from './statusIconUtils'

describe('statusIconUtils', () => {
  describe('getStatusIconUrl', () => {
    it('应该返回有效状态的图标 URL', () => {
      // 测试一个已知的状态 ID（石化）
      const url = getStatusIconUrl(1)
      expect(url).toBeDefined()
      expect(url).toContain('xivapi.com/i/')
      expect(url).toContain('.png')
    })

    it('应该对不存在的状态返回 undefined', () => {
      const url = getStatusIconUrl(999999)
      expect(url).toBeUndefined()
    })
  })

  describe('getStatusName', () => {
    it('应该返回有效状态的名称', () => {
      // 测试一个已知的状态 ID（石化）
      const name = getStatusName(1)
      expect(name).toBe('石化')
    })

    it('应该对不存在的状态返回 undefined', () => {
      const name = getStatusName(999999)
      expect(name).toBeUndefined()
    })

    it('应该返回常见减伤状态的名称', () => {
      // 测试一些常见的减伤状态
      const statuses = [
        { id: 1872, expectedName: '节制' },
        { id: 1193, expectedName: '雪仇' },
        { id: 1195, expectedName: '牵制' },
      ]

      for (const { id, expectedName } of statuses) {
        const name = getStatusName(id)
        expect(name).toBe(expectedName)
      }
    })
  })
})
