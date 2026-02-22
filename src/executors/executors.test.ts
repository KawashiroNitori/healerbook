/**
 * 执行器工厂函数测试
 */

import { describe, it, expect } from 'vitest'
import { createFriendlyBuffExecutor } from './createFriendlyBuffExecutor'
import { createEnemyDebuffExecutor } from './createEnemyDebuffExecutor'
import { createShieldExecutor } from './createShieldExecutor'
import type { PartyState } from '@/types/partyState'
import type { ActionExecutionContext } from '@/types/mitigation'

describe('executors', () => {
  const mockPartyState: PartyState = {
    players: [
      { id: 1, job: 'PLD', currentHP: 50000, maxHP: 100000, statuses: [] },
      { id: 2, job: 'WHM', currentHP: 40000, maxHP: 80000, statuses: [] },
    ],
    enemy: { statuses: [] },
    timestamp: 0,
  }

  describe('createFriendlyBuffExecutor', () => {
    it('应该为所有玩家添加状态（团队技能）', () => {
      const executor = createFriendlyBuffExecutor(1191, 20, true) // 铁壁
      const ctx: ActionExecutionContext = {
        actionId: 7531,
        useTime: 10,
        partyState: mockPartyState,
      }

      const newState = executor(ctx)

      expect(newState.players[0].statuses).toHaveLength(1)
      expect(newState.players[1].statuses).toHaveLength(1)
      expect(newState.players[0].statuses[0].statusId).toBe(1191)
      expect(newState.players[0].statuses[0].startTime).toBe(10)
      expect(newState.players[0].statuses[0].endTime).toBe(30)
    })

    it('应该只为目标玩家添加状态（单体技能）', () => {
      const executor = createFriendlyBuffExecutor(1174, 10, false) // 干预
      const ctx: ActionExecutionContext = {
        actionId: 7382,
        useTime: 5,
        partyState: mockPartyState,
        targetPlayerId: 1,
      }

      const newState = executor(ctx)

      expect(newState.players[0].statuses).toHaveLength(1)
      expect(newState.players[1].statuses).toHaveLength(0)
    })
  })

  describe('createEnemyDebuffExecutor', () => {
    it('应该为敌方添加 Debuff 状态', () => {
      const executor = createEnemyDebuffExecutor(1193, 15) // 雪仇
      const ctx: ActionExecutionContext = {
        actionId: 7535,
        useTime: 20,
        partyState: mockPartyState,
      }

      const newState = executor(ctx)

      expect(newState.enemy.statuses).toHaveLength(1)
      expect(newState.enemy.statuses[0].statusId).toBe(1193)
      expect(newState.enemy.statuses[0].startTime).toBe(20)
      expect(newState.enemy.statuses[0].endTime).toBe(35)
    })
  })

  describe('createShieldExecutor', () => {
    it('应该为所有玩家添加盾值状态（团队技能）', () => {
      const executor = createShieldExecutor(2613, 15, true, 0.1) // 泛输血
      const ctx: ActionExecutionContext = {
        actionId: 24311,
        useTime: 30,
        partyState: mockPartyState,
      }

      const newState = executor(ctx)

      expect(newState.players[0].statuses).toHaveLength(1)
      expect(newState.players[0].statuses[0].remainingBarrier).toBe(10000) // 100000 * 0.1
      expect(newState.players[1].statuses[0].remainingBarrier).toBe(8000) // 80000 * 0.1
    })

    it('应该只为目标玩家添加盾值状态（单体技能）', () => {
      const executor = createShieldExecutor(297, 30, false, 0.125) // 鼓舞
      const ctx: ActionExecutionContext = {
        actionId: 185,
        useTime: 15,
        partyState: mockPartyState,
        targetPlayerId: 2,
      }

      const newState = executor(ctx)

      expect(newState.players[0].statuses).toHaveLength(0)
      expect(newState.players[1].statuses).toHaveLength(1)
      expect(newState.players[1].statuses[0].remainingBarrier).toBe(10000) // 80000 * 0.125
    })
  })
})
