/**
 * 新技能数据测试
 */

import { describe, it, expect } from 'vitest'
import { MITIGATION_DATA } from './mitigationActions'
import type { PartyState } from '@/types/partyState'
import type { ActionExecutionContext } from '@/types/mitigation'

describe('mitigationActions', () => {
  const mockPartyState: PartyState = {
    players: [{ id: 1, job: 'PLD', maxHP: 100000 }],
    statuses: [],
    timestamp: 0,
  }

  describe('数据结构', () => {
    it('所有技能应该有 executor', () => {
      for (const action of MITIGATION_DATA.actions) {
        expect(action.executor).toBeDefined()
        expect(typeof action.executor).toBe('function')
      }
    })

    it('所有技能应该包含必需字段', () => {
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

      expect(newState.statuses).toHaveLength(1)
      expect(newState.statuses[0].statusId).toBe(1873)
    })

    it('行吟应该为玩家添加状态', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 7405)!
      const ctx: ActionExecutionContext = {
        actionId: 7405,
        useTime: 20,
        partyState: mockPartyState,
      }

      const newState = action.executor(ctx)

      expect(newState.statuses).toHaveLength(1)
      expect(newState.statuses[0].statusId).toBe(1934)
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

      expect(newState.statuses).toHaveLength(1)
      expect(newState.statuses[0].statusId).toBe(1193)
      expect(newState.statuses[0].startTime).toBe(30)
      expect(newState.statuses[0].endTime).toBe(45)
    })

    it('牵制应该为玩家添加状态', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 7549)!
      const ctx: ActionExecutionContext = {
        actionId: 7549,
        useTime: 40,
        partyState: mockPartyState,
      }

      const newState = action.executor(ctx)

      expect(newState.statuses).toHaveLength(1)
      expect(newState.statuses[0].statusId).toBe(1195)
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
      expect(newState.statuses[0].remainingBarrier).toBe(10000)
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

      expect(newState.statuses).toHaveLength(1)
      expect(newState.statuses[0].remainingBarrier).toBe(10000)
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

      expect(newState.statuses.length).toBeGreaterThan(0)
      expect(newState.statuses.some(s => s.statusId === 297)).toBe(true)
    })

    it('意气轩昂之策在炽天附体（buff 3885）激活时应使用 37016 的治疗量基础值', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 37013)!
      const stateWithSeraph: PartyState = {
        players: [{ id: 1, job: 'SCH', maxHP: 100000 }],
        statuses: [
          {
            instanceId: 'seraphism-1',
            statusId: 3885,
            startTime: 0,
            endTime: 30,
          },
        ],
        timestamp: 5,
      }
      const ctx: ActionExecutionContext = {
        actionId: 37013,
        useTime: 5,
        partyState: stateWithSeraph,
        sourcePlayerId: 1,
        statistics: {
          referenceMaxHP: 100000,
          shieldByAbility: {},
          critShieldByAbility: {},
          healByAbility: { 37013: 8000, 37016: 12000 },
          critHealByAbility: { 37013: 16000 },
        },
      }

      const newState = action.executor(ctx)

      // 炽天附体激活时应使用 37016 的 healByAbility（12000），而非 37013
      const shield = newState.statuses.find(s => s.statusId === 297)
      expect(shield).toBeDefined()
      expect(shield!.remainingBarrier).toBe(Math.round(12000 * 1.8)) // 21600
    })

    it('意气轩昂之策在无炽天附体时应继续使用 37013 的治疗量（含秘策判断）', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 37013)!
      const ctx: ActionExecutionContext = {
        actionId: 37013,
        useTime: 10,
        partyState: mockPartyState,
        sourcePlayerId: 1,
        statistics: {
          referenceMaxHP: 100000,
          shieldByAbility: {},
          critShieldByAbility: {},
          healByAbility: { 37013: 8000, 37016: 12000 },
          critHealByAbility: { 37013: 16000 },
        },
      }

      const newState = action.executor(ctx)

      // 无炽天附体时应使用 37013 的 healByAbility（8000）
      const shield = newState.statuses.find(s => s.statusId === 297)
      expect(shield).toBeDefined()
      expect(shield!.remainingBarrier).toBe(Math.round(8000 * 1.8)) // 14400
    })

    it('意气轩昂之策在秘策激活时应使用暴击治疗量并消耗秘策', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 37013)!
      const stateWithRecitation: PartyState = {
        players: [{ id: 1, job: 'SCH', maxHP: 100000 }],
        statuses: [{ instanceId: 'recitation-1', statusId: 1896, startTime: 0, endTime: 30 }],
        timestamp: 5,
      }
      const ctx: ActionExecutionContext = {
        actionId: 37013,
        useTime: 5,
        partyState: stateWithRecitation,
        sourcePlayerId: 1,
        statistics: {
          referenceMaxHP: 100000,
          shieldByAbility: {},
          critShieldByAbility: {},
          healByAbility: { 37013: 8000 },
          critHealByAbility: { 37013: 16000 },
        },
      }

      const newState = action.executor(ctx)

      // 秘策激活时使用暴击治疗量（16000）
      const shield = newState.statuses.find(s => s.statusId === 297)
      expect(shield).toBeDefined()
      expect(shield!.remainingBarrier).toBe(Math.round(16000 * 1.8)) // 28800
      // 秘策状态应被消耗
      expect(newState.statuses.some(s => s.statusId === 1896)).toBe(false)
    })

    it('降临之章应使用 37016 治疗量并添加鼓舞盾', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 37016)!
      const ctx: ActionExecutionContext = {
        actionId: 37016,
        useTime: 10,
        partyState: mockPartyState,
        sourcePlayerId: 1,
        statistics: {
          referenceMaxHP: 100000,
          shieldByAbility: {},
          critShieldByAbility: {},
          healByAbility: { 37016: 11000 },
          critHealByAbility: {},
        },
      }

      const newState = action.executor(ctx)

      const shield = newState.statuses.find(s => s.statusId === 297)
      expect(shield).toBeDefined()
      expect(shield!.remainingBarrier).toBe(Math.round(11000 * 1.8)) // 19800
    })

    it('阳星合相在中间学派激活时应添加盾值', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 37030)!
      const stateWithNeutralSect: PartyState = {
        players: [{ id: 1, job: 'AST', maxHP: 100000 }],
        statuses: [{ instanceId: 'neutral-1', statusId: 1892, startTime: 0, endTime: 30 }],
        timestamp: 5,
      }
      const ctx: ActionExecutionContext = {
        actionId: 37030,
        useTime: 5,
        partyState: stateWithNeutralSect,
        sourcePlayerId: 1,
        statistics: {
          referenceMaxHP: 100000,
          shieldByAbility: {},
          critShieldByAbility: {},
          healByAbility: { 37030: 20000 },
          critHealByAbility: {},
        },
      }

      const newState = action.executor(ctx)

      const shield = newState.statuses.find(s => s.statusId === 1921)
      expect(shield).toBeDefined()
      expect(shield!.remainingBarrier).toBe(Math.round(20000 * 1.25 * 1.2)) // 30000
    })

    it('阳星合相在无中间学派时不应添加盾值', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 37030)!
      const ctx: ActionExecutionContext = {
        actionId: 37030,
        useTime: 10,
        partyState: mockPartyState,
        sourcePlayerId: 1,
      }

      const newState = action.executor(ctx)

      expect(newState.statuses).toHaveLength(0)
    })

    it('均衡预后II应添加盾值并互斥鼓舞盾', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 37034)!
      const ctx: ActionExecutionContext = {
        actionId: 37034,
        useTime: 10,
        partyState: mockPartyState,
        sourcePlayerId: 1,
        statistics: {
          referenceMaxHP: 100000,
          shieldByAbility: { 2609: 15000 },
          critShieldByAbility: {},
          healByAbility: {},
          critHealByAbility: {},
        },
      }

      const newState = action.executor(ctx)

      const shield = newState.statuses.find(s => s.statusId === 2609)
      expect(shield).toBeDefined()
      expect(shield!.remainingBarrier).toBe(15000)
    })

    it('均衡预后II在活化激活时盾量应乘以 1.5 并消耗活化', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === 37034)!
      const stateWithZoe: PartyState = {
        players: [{ id: 1, job: 'SGE', maxHP: 100000 }],
        statuses: [{ instanceId: 'zoe-1', statusId: 2611, startTime: 0, endTime: 30 }],
        timestamp: 5,
      }
      const ctx: ActionExecutionContext = {
        actionId: 37034,
        useTime: 5,
        partyState: stateWithZoe,
        sourcePlayerId: 1,
        statistics: {
          referenceMaxHP: 100000,
          shieldByAbility: { 2609: 15000 },
          critShieldByAbility: {},
          healByAbility: {},
          critHealByAbility: {},
        },
      }

      const newState = action.executor(ctx)

      const shield = newState.statuses.find(s => s.statusId === 2609)
      expect(shield).toBeDefined()
      expect(shield!.remainingBarrier).toBe(Math.round(15000 * 1.5)) // 22500
      // 活化状态应被消耗
      expect(newState.statuses.some(s => s.statusId === 2611)).toBe(false)
    })
  })
})
