/**
 * 状态注册表测试
 */

import { describe, it, expect } from 'vitest'
import {
  getStatusById,
  getAllFriendlyStatuses,
  getAllEnemyStatuses,
  hasStatus,
} from './statusRegistry'

describe('statusRegistry', () => {
  describe('getStatusById', () => {
    it('应该返回存在的状态', () => {
      const status = getStatusById(1191) // 铁壁
      expect(status).toBeDefined()
      expect(status?.name).toBe('铁壁')
      expect(status?.type).toBe('multiplier')
    })

    it('应该返回 undefined 对于不存在的状态', () => {
      const status = getStatusById(999999)
      expect(status).toBeUndefined()
    })
  })

  describe('getAllFriendlyStatuses', () => {
    it('应该返回所有友方状态', () => {
      const statuses = getAllFriendlyStatuses()
      expect(statuses.length).toBeGreaterThan(0)
      expect(statuses.every((s) => s.isFriendly)).toBe(true)
    })
  })

  describe('getAllEnemyStatuses', () => {
    it('应该返回所有敌方状态', () => {
      const statuses = getAllEnemyStatuses()
      expect(statuses.length).toBeGreaterThan(0)
      expect(statuses.every((s) => !s.isFriendly)).toBe(true)
    })
  })

  describe('hasStatus', () => {
    it('应该返回 true 对于存在的状态', () => {
      expect(hasStatus(1191)).toBe(true) // 铁壁
    })

    it('应该返回 false 对于不存在的状态', () => {
      expect(hasStatus(999999)).toBe(false)
    })
  })
})
