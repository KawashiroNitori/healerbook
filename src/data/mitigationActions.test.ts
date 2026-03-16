/**
 * 新技能数据测试
 */

import { describe, it, expect } from 'vitest'
import { MITIGATION_DATA } from './mitigationActions'
import type { PartyState } from '@/types/partyState'
import type { ActionExecutionContext } from '@/types/mitigation'

describe('mitigationActions', () => {
  const mockPartyState: PartyState = {
    player: { id: 1, job: 'PLD', currentHP: 50000, maxHP: 100000, statuses: [] },
    timestamp: 0,
  }

  describe('数据结构', () => {
    it('所有技能应该有 executor', () => {
      for (const action of MITIGATION_DATA.actions) {
        expect(action.executor).toBeDefined()
        expect(typeof action.executor).toBe('function')
      }
    })

    it('所有技能应该���必需字段', () => {
      for (const action of MITIGATION_DATA.actions) {
        expect(action.id).toBeGreaterThan(0)
        expect(action.name).toBeTruthy()
        expect(action.icon).toBeTruthy()
        expect(action.jobs).toBeInstanceOf(Array)
        expect(action.jobs.length).toBeGreaterThan(0)
      }
    })
  })

  describe('友方 Buff 技能', () => {
    it('节制应该为玩家添加状态', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 16536)!
      const ctx: ActionExecutionContext = {
        actionId: 16536,
        useTime: 10,
        partyState: mockPartyState,
      }

      const newState = action.executor(ctx)

      expect(newState.player.statuses).toHaveLength(1)
      expect(newState.player.statuses[0].statusId).toBe(1873)
    })

    it('行吟应该为玩家添加状态', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 7405)!
      const ctx: ActionExecutionContext = {
        actionId: 7405,
        useTime: 20,
        partyState: mockPartyState,
      }

      const newState = action.executor(ctx)

      expect(newState.player.statuses).toHaveLength(1)
      expect(newState.player.statuses[0].statusId).toBe(1934)
    })
  })

  describe('敌方 Debuff 技能', () => {
    it('雪仇应该为玩家添加状态', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 7535)!
      const ctx: ActionExecutionContext = {
        actionId: 7535,
        useTime: 30,
        partyState: mockPartyState,
      }

      const newState = action.executor(ctx)

      expect(newState.player.statuses).toHaveLength(1)
      expect(newState.player.statuses[0].statusId).toBe(1193)
      expect(newState.player.statuses[0].startTime).toBe(30)
      expect(newState.player.statuses[0].endTime).toBe(45)
    })

    it('牵制应该为玩家添加状态', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 7549)!
      const ctx: ActionExecutionContext = {
        actionId: 7549,
        useTime: 40,
        partyState: mockPartyState,
      }

      const newState = action.executor(ctx)

      expect(newState.player.statuses).toHaveLength(1)
      expect(newState.player.statuses[0].statusId).toBe(1195)
    })
  })

  describe('盾值技能', () => {
    it('泛输血应该为玩家添加盾值', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 24311)!
      const ctx: ActionExecutionContext = {
        actionId: 24311,
        useTime: 50,
        partyState: mockPartyState,
      }

      const newState = action.executor(ctx)

      // maxHP 100000 * 0.1 = 10000
      expect(newState.player.statuses[0].remainingBarrier).toBe(10000)
    })

    it('神爱抚应该为玩家添加盾值', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 37011)!
      const ctx: ActionExecutionContext = {
        actionId: 37011,
        useTime: 60,
        partyState: mockPartyState,
        sourcePlayerId: 1,
      }

      const newState = action.executor(ctx)

      expect(newState.player.statuses).toHaveLength(1)
      expect(newState.player.statuses[0].remainingBarrier).toBe(10000)
    })
  })

  describe('自定义 Executor', () => {
    it('展开战术应该为玩家添加鼓舞盾', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 3585)!
      const ctx: ActionExecutionContext = {
        actionId: 3585,
        useTime: 10,
        partyState: mockPartyState,
        sourcePlayerId: 1,
      }

      const newState = action.executor(ctx)

      expect(newState.player.statuses.length).toBeGreaterThan(0)
      expect(newState.player.statuses.some(s => s.statusId === 297)).toBe(true)
    })
  })
})
