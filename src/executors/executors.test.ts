/**
 * 执行器工厂函数测试
 */

import { describe, it, expect } from 'vitest'
import { createBuffExecutor } from './createBuffExecutor'
import { createShieldExecutor } from './createShieldExecutor'
import type { PartyState } from '@/types/partyState'
import type { ActionExecutionContext } from '@/types/mitigation'

describe('executors', () => {
  const mockPartyState: PartyState = {
    players: [{ id: 1, job: 'PLD', maxHP: 100000 }],
    statuses: [],
    timestamp: 0,
  }

  describe('createBuffExecutor (simplified)', () => {
    it('should add buff to player statuses', () => {
      const executor = createBuffExecutor(1176, 5)

      const ctx: ActionExecutionContext = {
        actionId: 7382,
        useTime: 10,
        partyState: {
          players: [{ id: 1, job: 'PLD', maxHP: 50000 }],
          statuses: [],
          timestamp: 10,
        },
        sourcePlayerId: 1,
      }

      const result = executor(ctx)

      expect(result.statuses).toHaveLength(1)
      expect(result.statuses[0].statusId).toBe(1176)
      expect(result.statuses[0].startTime).toBe(10)
      expect(result.statuses[0].endTime).toBe(15)
    })

    it('should use sourcePlayerId from context', () => {
      const executor = createBuffExecutor(1176, 5)

      const ctx: ActionExecutionContext = {
        actionId: 7382,
        useTime: 10,
        partyState: {
          players: [{ id: 1, job: 'PLD', maxHP: 50000 }],
          statuses: [],
          timestamp: 10,
        },
        sourcePlayerId: 999, // 不同于 player.id
      }

      const result = executor(ctx)

      expect(result.statuses[0].sourcePlayerId).toBe(999)
    })

    it('支持 performance 快照：覆盖 metadata 默认值', () => {
      const executor = createBuffExecutor(1234, 20, {
        performance: { physics: 0.8, magic: 0.8, darkness: 0.8, heal: 1, maxHP: 1 },
      })

      const ctx: ActionExecutionContext = {
        actionId: 1,
        useTime: 0,
        sourcePlayerId: 1,
        partyState: {
          statuses: [],
          timestamp: 0,
        },
      }

      const result = executor(ctx)
      const added = result.statuses.find(s => s.statusId === 1234)
      expect(added?.performance?.physics).toBe(0.8)
    })

    it('未传 performance 时 status.performance 保持 undefined', () => {
      const executor = createBuffExecutor(1234, 20)

      const ctx: ActionExecutionContext = {
        actionId: 1,
        useTime: 0,
        sourcePlayerId: 1,
        partyState: {
          statuses: [],
          timestamp: 0,
        },
      }

      const result = executor(ctx)
      const added = result.statuses.find(s => s.statusId === 1234)
      expect(added?.performance).toBeUndefined()
    })

    it('新 buff 加入后同 uniqueGroup（默认 [statusId]）旧 buff 被移除，新实例 instanceId 不同', () => {
      const executor = createBuffExecutor(1176, 5)

      const partyState: PartyState = {
        players: [{ id: 1, job: 'PLD', maxHP: 50000 }],
        statuses: [{ instanceId: 'old', statusId: 1176, startTime: 0, endTime: 5 }],
        timestamp: 10,
      }
      const ctx: ActionExecutionContext = {
        actionId: 7382,
        useTime: 10,
        partyState,
        sourcePlayerId: 1,
      }

      const result = executor(ctx)

      // 旧的同 statusId 实例被移除，只剩新实例
      expect(result.statuses).toHaveLength(1)
      expect(result.statuses[0].statusId).toBe(1176)
      expect(result.statuses[0].startTime).toBe(10)
      expect(result.statuses[0].instanceId).not.toBe('old')
    })

    it('显式 uniqueGroup 覆盖多个 statusId：一并移除', () => {
      const executor = createBuffExecutor(1176, 5, { uniqueGroup: [1176, 2000] })

      const partyState: PartyState = {
        statuses: [
          { instanceId: 'a', statusId: 1176, startTime: 0, endTime: 5 },
          { instanceId: 'b', statusId: 2000, startTime: 0, endTime: 5 },
          { instanceId: 'c', statusId: 3000, startTime: 0, endTime: 5 },
        ],
        timestamp: 10,
      }
      const ctx: ActionExecutionContext = {
        actionId: 7382,
        useTime: 10,
        partyState,
        sourcePlayerId: 1,
      }

      const result = executor(ctx)

      // 1176 / 2000 被移除，3000 保留，加上新 1176
      const ids = result.statuses.map(s => s.statusId).sort((x, y) => x - y)
      expect(ids).toEqual([1176, 3000])
      expect(result.statuses.find(s => s.instanceId === 'c')).toBeDefined()
    })

    it('uniqueGroup 为空数组时关闭互斥：多实例共存', () => {
      const executor = createBuffExecutor(1176, 5, { uniqueGroup: [] })

      const partyState: PartyState = {
        statuses: [{ instanceId: 'old', statusId: 1176, startTime: 0, endTime: 5 }],
        timestamp: 10,
      }
      const ctx: ActionExecutionContext = {
        actionId: 7382,
        useTime: 10,
        partyState,
        sourcePlayerId: 1,
      }

      const result = executor(ctx)

      // 旧实例保留，新增一条同 statusId，共两条
      expect(result.statuses).toHaveLength(2)
      expect(result.statuses.filter(s => s.statusId === 1176)).toHaveLength(2)
      expect(result.statuses.find(s => s.instanceId === 'old')).toBeDefined()
    })
  })

  describe('createBuffExecutor (enemy debuff replaced)', () => {
    it('should add buff to player statuses', () => {
      const executor = createBuffExecutor(1193, 15) // 雪仇
      const ctx: ActionExecutionContext = {
        actionId: 7535,
        useTime: 20,
        partyState: mockPartyState,
      }

      const newState = executor(ctx)

      expect(newState.statuses).toHaveLength(1)
      expect(newState.statuses[0].statusId).toBe(1193)
      expect(newState.statuses[0].startTime).toBe(20)
      expect(newState.statuses[0].endTime).toBe(35)
    })
  })

  describe('createShieldExecutor', () => {
    it('should add shield to player statuses', () => {
      const executor = createShieldExecutor(2613, 15) // 泛输血
      const ctx: ActionExecutionContext = {
        actionId: 24311,
        useTime: 30,
        partyState: mockPartyState,
      }

      const newState = executor(ctx)

      expect(newState.statuses).toHaveLength(1)
      expect(newState.statuses[0].remainingBarrier).toBe(10000) // 兜底值
    })
  })

  describe('createShieldExecutor (simplified)', () => {
    it('should add shield to player statuses', () => {
      const executor = createShieldExecutor(1362, 30)

      const ctx: ActionExecutionContext = {
        actionId: 3540,
        useTime: 10,
        partyState: {
          players: [{ id: 1, job: 'PLD', maxHP: 50000 }],
          statuses: [],
          timestamp: 10,
        },
        sourcePlayerId: 1,
      }

      const result = executor(ctx)

      expect(result.statuses).toHaveLength(1)
      expect(result.statuses[0].statusId).toBe(1362)
      expect(result.statuses[0].remainingBarrier).toBe(10000) // 兜底值
    })

    it('同 uniqueGroup（默认 [statusId]）旧盾被替换，新实例 instanceId 不同', () => {
      const executor = createShieldExecutor(1362, 30)

      const partyState: PartyState = {
        statuses: [
          {
            instanceId: 'old',
            statusId: 1362,
            startTime: 0,
            endTime: 30,
            remainingBarrier: 5000,
            initialBarrier: 5000,
          },
        ],
        timestamp: 10,
      }
      const ctx: ActionExecutionContext = {
        actionId: 3540,
        useTime: 10,
        partyState,
        sourcePlayerId: 1,
      }

      const result = executor(ctx)

      expect(result.statuses).toHaveLength(1)
      expect(result.statuses[0].statusId).toBe(1362)
      expect(result.statuses[0].instanceId).not.toBe('old')
      expect(result.statuses[0].remainingBarrier).toBe(10000) // 兜底值，非旧盾的 5000
    })

    it('uniqueGroup 为空数组时关闭互斥：多盾共存', () => {
      const executor = createShieldExecutor(1362, 30, { uniqueGroup: [] })

      const partyState: PartyState = {
        statuses: [
          {
            instanceId: 'old',
            statusId: 1362,
            startTime: 0,
            endTime: 30,
            remainingBarrier: 5000,
            initialBarrier: 5000,
          },
        ],
        timestamp: 10,
      }
      const ctx: ActionExecutionContext = {
        actionId: 3540,
        useTime: 10,
        partyState,
        sourcePlayerId: 1,
      }

      const result = executor(ctx)

      expect(result.statuses).toHaveLength(2)
      expect(result.statuses.filter(s => s.statusId === 1362)).toHaveLength(2)
      expect(result.statuses.find(s => s.instanceId === 'old')).toBeDefined()
    })
  })
})
