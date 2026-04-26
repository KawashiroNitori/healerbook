/**
 * 状态注册表测试
 */

import { describe, it, expect } from 'vitest'
import {
  buildStatusRegistry,
  getStatusById,
  getAllFriendlyStatuses,
  getAllEnemyStatuses,
  hasStatus,
} from './statusRegistry'
import type { StatusExtras } from '@/data/statusExtras'

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
      expect(statuses.every(s => s.isFriendly)).toBe(true)
    })
  })

  describe('getAllEnemyStatuses', () => {
    it('应该返回所有敌方状态', () => {
      const statuses = getAllEnemyStatuses()
      expect(statuses.length).toBeGreaterThan(0)
      expect(statuses.every(s => !s.isFriendly)).toBe(true)
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

  describe('buildStatusRegistry', () => {
    it('能注册仅在 STATUS_EXTRAS 中存在的 statusId', () => {
      const extras: Record<number, StatusExtras> = {
        99001: {
          name: '本地补丁状态',
          type: 'multiplier',
          isFriendly: true,
          performance: { physics: 0.8, magic: 0.8, darkness: 1 },
          isTankOnly: true,
          category: ['self', 'percentage'],
        },
      }
      const map = buildStatusRegistry([], extras)
      const status = map.get(99001)
      expect(status).toBeDefined()
      expect(status?.name).toBe('本地补丁状态')
      expect(status?.type).toBe('multiplier')
      expect(status?.isFriendly).toBe(true)
      expect(status?.performance.physics).toBe(0.8)
      expect(status?.performance.heal).toBe(1)
      expect(status?.performance.maxHP).toBe(1)
      expect(status?.isTankOnly).toBe(true)
    })

    it('缺少 name / isFriendly 时抛错', () => {
      const extras: Record<number, StatusExtras> = {
        99002: { isTankOnly: true } as StatusExtras,
      }
      expect(() => buildStatusRegistry([], extras)).toThrowError(/99002/)
    })

    it('type 可缺省，注册时不抛错且 metadata.type 为 undefined', () => {
      const extras: Record<number, StatusExtras> = {
        99004: {
          name: '延迟治疗状态',
          isFriendly: true,
          // 故意不写 type / performance，模拟纯 executor-driven 状态
        },
      }
      const map = buildStatusRegistry([], extras)
      const status = map.get(99004)
      expect(status).toBeDefined()
      expect(status?.type).toBeUndefined()
      // performance 走默认，physics/magic/darkness 都是 1（不减伤）
      expect(status?.performance.physics).toBe(1)
      expect(status?.performance.magic).toBe(1)
    })

    it('STATUS_EXTRAS 的 base 字段会覆盖第三方 keigenn 同名字段', () => {
      const fakeKeigenns = [
        {
          id: 99003,
          name: '原名',
          type: 'multiplier' as const,
          performance: { physics: 1, magic: 1, darkness: 1 },
          isFriendly: true,
          fullIcon: '',
        },
      ]
      const extras: Record<number, StatusExtras> = {
        99003: {
          name: '本地修正名',
          performance: { physics: 0.5, magic: 0.5, darkness: 1 },
        },
      }
      const map = buildStatusRegistry(fakeKeigenns, extras)
      expect(map.get(99003)?.name).toBe('本地修正名')
      expect(map.get(99003)?.performance.physics).toBe(0.5)
      expect(map.get(99003)?.isFriendly).toBe(true) // 未覆盖，回落 keigenn
    })
  })
})
