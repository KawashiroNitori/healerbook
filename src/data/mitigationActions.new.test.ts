/**
 * 新技能数据测试
 */

import { describe, it, expect } from 'vitest'
import { MITIGATION_DATA } from './mitigationActions.new'
import type { PartyState } from '@/types/partyState'
import type { ActionExecutionContext } from '@/types/mitigation'

describe('mitigationActions.new', () => {
  const mockPartyState: PartyState = {
    players: [
      { id: 1, job: 'PLD', currentHP: 50000, maxHP: 100000, statuses: [] },
      { id: 2, job: 'WHM', currentHP: 40000, maxHP: 80000, statuses: [] },
      { id: 3, job: 'SCH', currentHP: 40000, maxHP: 80000, statuses: [] },
    ],
    enemy: { statuses: [] },
    timestamp: 0,
  }

  describe('数据结构', () => {
    it('应该包含版本信息', () => {
      expect(MITIGATION_DATA.version).toBe('7.1')
      expect(MITIGATION_DATA.source).toBe('CafeMaker API')
    })

    it('所有技能应该有 executor', () => {
      for (const action of MITIGATION_DATA.actions) {
        expect(action.executor).toBeDefined()
        expect(typeof action.executor).toBe('function')
      }
    })

    it('所有技能应该有必需字段', () => {
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
    it('节制应该为所有玩家添加状态', () => {
      const action = MITIGATION_DATA.actions.find((a) => a.id === 16536)!
      const ctx: ActionExecutionContext = {
        actionId: 16536,
        useTime: 10,
        partyState: mockPartyState,
      }

      const newState = action.executor(ctx)

      expect(newState.players[0].statuses).toHaveLength(1)
      expect(newState.players[1].statuses).toHaveLength(1)
      expect(newState.players[2].statuses).toHaveLength(1)
      expect(newState.players[0].statuses[0].statusId).toBe(1873)
    })

    it('行吟应该为所有玩家添加状态', () => {
      const action = MITIGATION_DATA.actions.find((a) => a.id === 7405)!
      const ctx: ActionExecutionContext = {
        actionId: 7405,
        useTime: 20,
        partyState: mockPartyState,
      }

      const newState = action.executor(ctx)

      expect(newState.players.every((p) => p.statuses.length === 1)).toBe(true)
      expect(newState.players[0].statuses[0].statusId).toBe(1934)
    })
  })

  describe('敌方 Debuff 技能', () => {
    it('雪仇应该为敌方添加 Debuff', () => {
      const action = MITIGATION_DATA.actions.find((a) => a.id === 7535)!
      const ctx: ActionExecutionContext = {
        actionId: 7535,
        useTime: 30,
        partyState: mockPartyState,
      }

      const newState = action.executor(ctx)

      expect(newState.enemy.statuses).toHaveLength(1)
      expect(newState.enemy.statuses[0].statusId).toBe(1193)
      expect(newState.enemy.statuses[0].startTime).toBe(30)
      expect(newState.enemy.statuses[0].endTime).toBe(45)
    })

    it('牵制应该为敌方添加 Debuff', () => {
      const action = MITIGATION_DATA.actions.find((a) => a.id === 7549)!
      const ctx: ActionExecutionContext = {
        actionId: 7549,
        useTime: 40,
        partyState: mockPartyState,
      }

      const newState = action.executor(ctx)

      expect(newState.enemy.statuses).toHaveLength(1)
      expect(newState.enemy.statuses[0].statusId).toBe(1195)
    })
  })

  describe('盾值技能', () => {
    it('泛输血应该为所有玩家添加盾值', () => {
      const action = MITIGATION_DATA.actions.find((a) => a.id === 24311)!
      const ctx: ActionExecutionContext = {
        actionId: 24311,
        useTime: 50,
        partyState: mockPartyState,
      }

      const newState = action.executor(ctx)

      expect(newState.players[0].statuses[0].remainingBarrier).toBe(10000)
      expect(newState.players[1].statuses[0].remainingBarrier).toBe(8000)
      expect(newState.players[2].statuses[0].remainingBarrier).toBe(8000)
    })

    it('鼓舞激励之策应该只为目标玩家添加盾值', () => {
      const action = MITIGATION_DATA.actions.find((a) => a.id === 185)!
      const ctx: ActionExecutionContext = {
        actionId: 185,
        useTime: 60,
        partyState: mockPartyState,
        targetPlayerId: 2,
      }

      const newState = action.executor(ctx)

      expect(newState.players[0].statuses).toHaveLength(0)
      expect(newState.players[1].statuses).toHaveLength(1)
      expect(newState.players[1].statuses[0].remainingBarrier).toBe(10000)
    })
  })

  describe('自定义 Executor', () => {
    it('展开战术应该复制目标的鼓舞盾', () => {
      // 先给目标添加鼓舞盾
      const partyWithShield: PartyState = {
        ...mockPartyState,
        players: mockPartyState.players.map((p) =>
          p.id === 2
            ? {
                ...p,
                statuses: [
                  {
                    instanceId: 'test-shield',
                    statusId: 297,
                    startTime: 0,
                    endTime: 30,
                    remainingBarrier: 5000,
                    sourceActionId: 185,
                    sourcePlayerId: 2,
                  },
                ],
              }
            : p
        ),
      }

      const action = MITIGATION_DATA.actions.find((a) => a.id === 3585)!
      const ctx: ActionExecutionContext = {
        actionId: 3585,
        useTime: 10,
        partyState: partyWithShield,
        targetPlayerId: 2,
      }

      const newState = action.executor(ctx)

      // 所有玩家都应该有鼓舞盾
      expect(newState.players.every((p) => p.statuses.length > 0)).toBe(true)
      expect(newState.players[0].statuses[0].statusId).toBe(297)
      expect(newState.players[0].statuses[0].remainingBarrier).toBe(5000)
    })

    it('气宇轩昂之策应该检测秘策状态', () => {
      // 施法者有秘策状态
      const partyWithRecitation: PartyState = {
        ...mockPartyState,
        players: mockPartyState.players.map((p) =>
          p.id === 3
            ? {
                ...p,
                statuses: [
                  {
                    instanceId: 'test-recitation',
                    statusId: 1896,
                    startTime: 0,
                    endTime: 15,
                    sourceActionId: 16545,
                    sourcePlayerId: 3,
                  },
                ],
              }
            : p
        ),
      }

      const action = MITIGATION_DATA.actions.find((a) => a.id === 37013)!
      const ctx: ActionExecutionContext = {
        actionId: 37013,
        useTime: 5,
        partyState: partyWithRecitation,
        targetPlayerId: 3,
      }

      const newState = action.executor(ctx)

      // 所有玩家应该有 2 个盾（鼓舞 + 激励）
      expect(newState.players[0].statuses).toHaveLength(2)
      expect(newState.players[0].statuses.some((s) => s.statusId === 297)).toBe(true)
      expect(newState.players[0].statuses.some((s) => s.statusId === 1918)).toBe(true)

      // 施法者的秘策应该被消耗
      const caster = newState.players.find((p) => p.id === 3)!
      expect(caster.statuses.some((s) => s.statusId === 1896)).toBe(false)
    })
  })
})
