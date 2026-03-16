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
  })
})
