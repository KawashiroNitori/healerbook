/**
 * 新技能数据测试
 */

import { describe, it, expect } from 'vitest'
import { MITIGATION_DATA } from './mitigationActions'
import { RESOURCE_REGISTRY } from './resources'
import { findResourceExhaustedCasts } from '@/utils/resource/validator'
import { deriveResourceEvents, computeResourceAmount } from '@/utils/resource/compute'
import type { PartyState } from '@/types/partyState'
import type { ActionExecutionContext, MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { Level } from '@/types/level'
import { resolveActions } from './resolveAction'

describe('mitigationActions', () => {
  const mockPartyState: PartyState = {
    players: [{ id: 1, job: 'PLD', maxHP: 100000 }],
    statuses: [],
    timestamp: 0,
  }

  describe('数据结构', () => {
    it('技能若声明 executor 必须是函数（纯资源类技能可省略）', () => {
      for (const action of MITIGATION_DATA.actions) {
        if (action.executor !== undefined) {
          expect(typeof action.executor).toBe('function')
        }
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

      // 节制会同时附加主状态 1873 与"神爱抚可用"副状态 3881
      expect(newState.statuses).toHaveLength(2)
      expect(newState.statuses.map(s => s.statusId).sort()).toEqual([1873, 3881])
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

    it('意气轩昂之策默认使用 37013 的治疗量（含秘策判断）', () => {
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
        // sourcePlayerId 必填：中间学派 selfHeal=1.2 通过 computeFinalHeal 作用于
        // createShieldExecutor 出口的盾量，需要 status.sourcePlayerId === castSourcePlayerId
        statuses: [
          { instanceId: 'neutral-1', statusId: 1892, startTime: 0, endTime: 30, sourcePlayerId: 1 },
        ],
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

      // 无中间学派：HoT 3894 仍会被挂上，但不应该有盾 1921
      expect(newState.statuses.find(s => s.statusId === 1921)).toBeUndefined()
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

  describe('蛇胆资源池（贤者）', () => {
    const DRUOCHOLE = 24299 // 寄生清汁
    const IXOCHOLE = 24298 // 坚角清汁

    it('sge:addersgall 注册：初始 3 / 上限 3 / 每 20s 回 1 档', () => {
      const def = RESOURCE_REGISTRY['sge:addersgall']
      expect(def).toBeDefined()
      expect(def.job).toBe('SGE')
      expect(def.initial).toBe(3)
      expect(def.max).toBe(3)
      expect(def.regen).toEqual({ interval: 20, amount: 1 })
    })

    it('寄生清汁与坚角清汁走双门 gating：自身 __cd__ + 蛇胆池各消耗 1', () => {
      for (const id of [DRUOCHOLE, IXOCHOLE]) {
        const action = MITIGATION_DATA.actions.find(a => a.id === id)!
        // 自身 30s CD 门（显式 __cd__，required）
        const cd = action.resourceEffects?.find(
          e => e.resourceId === `__cd__:${id}` && e.delta === -1 && e.required === true
        )
        expect(cd, `action ${id} 应声明 __cd__:${id} required 自身 CD 门`).toBeDefined()
        // 蛇胆池门
        const addersgall = action.resourceEffects?.find(
          e => e.resourceId === 'sge:addersgall' && e.delta === -1
        )
        expect(addersgall, `action ${id} 应声明 sge:addersgall -1 消费者`).toBeDefined()
      }
    })

    const actionMap = new Map<number, MitigationAction>(MITIGATION_DATA.actions.map(a => [a.id, a]))
    const cast = (id: string, actionId: number, timestamp: number): CastEvent => ({
      id,
      actionId,
      timestamp,
      playerId: 1,
    })

    it('蛇胆充足但自身 CD 未转好（同技能间隔 20s < 30s）→ 第 2 次被自身 CD 拦截', () => {
      const casts = [cast('1', DRUOCHOLE, 0), cast('2', DRUOCHOLE, 20)]
      const result = findResourceExhaustedCasts(casts, actionMap, RESOURCE_REGISTRY)
      expect(result.map(r => r.castEventId)).toEqual(['2'])
      // 由自身 CD 门拦截，而非蛇胆（此刻蛇胆仍有库存）
      expect(result[0].resourceId).toBe(`__cd__:${DRUOCHOLE}`)
    })

    it('同技能恰好间隔 30s（自身 CD 边界）→ 都合法', () => {
      const casts = [cast('1', DRUOCHOLE, 0), cast('2', DRUOCHOLE, 30)]
      const result = findResourceExhaustedCasts(casts, actionMap, RESOURCE_REGISTRY)
      expect(result).toEqual([])
    })

    it('两技能 CD 独立、共享蛇胆池：背靠背各用一次（蛇胆 3→1）→ 都合法', () => {
      const casts = [cast('1', IXOCHOLE, 0), cast('2', DRUOCHOLE, 1)]
      const result = findResourceExhaustedCasts(casts, actionMap, RESOURCE_REGISTRY)
      expect(result).toEqual([])
    })

    const RHIZOMATA = 24309 // 根素

    it('根素：纯产出 +1 蛇胆、无 executor（纯资源技能）、自身 90s CD', () => {
      const action = MITIGATION_DATA.actions.find(a => a.id === RHIZOMATA)!
      expect(action).toBeDefined()
      // 纯资源生成器，游戏内无状态效果 → 省略 executor（不强塞空函数）
      expect(action.executor).toBeUndefined()
      expect(action.cooldown).toBe(90)
      const produce = action.resourceEffects?.find(e => e.resourceId === 'sge:addersgall')
      expect(produce?.delta).toBe(1)
      // 纯产出（无 delta<0 消费者）→ compute 层会为其合成 __cd__:24309 的 90s CD 门
      expect(action.resourceEffects?.some(e => e.delta < 0)).toBe(false)
    })

    it('根素回 1 档蛇胆：消耗 1 档后用根素 → 立即回到 3 档（封顶）', () => {
      const casts = [
        cast('1', DRUOCHOLE, 0), // 3 → 2，t=20 才自然回 1
        cast('2', RHIZOMATA, 5), // 2 → 3（根素 +1，clamp 到 max 3）
      ]
      const events = deriveResourceEvents(casts, actionMap)
      const key = '1:sge:addersgall'
      const def = RESOURCE_REGISTRY['sge:addersgall']
      // t=6：若无根素应为 2（自然回档在 t=20），有根素则为 3
      expect(computeResourceAmount(def, events.get(key) ?? [], 6)).toBe(3)
    })

    it('根素自身 90s CD：60s 内连用两次 → 第 2 次非法', () => {
      const casts = [cast('1', RHIZOMATA, 0), cast('2', RHIZOMATA, 60)]
      const result = findResourceExhaustedCasts(casts, actionMap, RESOURCE_REGISTRY)
      expect(result.map(r => r.castEventId)).toEqual(['2'])
      expect(result[0].resourceId).toBe(`__cd__:${RHIZOMATA}`)
    })
  })
})

describe('状态 ID 不变、数值随等级变化：覆盖层显式传入 performance', () => {
  const partyState = { statuses: [], timestamp: 0 } as unknown as PartyState
  const cast = (level: Level, actionId: number, statusId: number) => {
    const action = resolveActions(level).actionMap.get(actionId)!
    const next = action.executor!({ actionId, useTime: 0, partyState, sourcePlayerId: 1 })
    return { action, status: next.statuses.find(s => s.statusId === statusId) }
  }

  // 行吟 7405 / 策动 16889 / 防守之桑巴 16012：88 级前 CD 120s，98 级前减伤 10%
  for (const [actionId, statusId] of [
    [7405, 1934],
    [16889, 1951],
    [16012, 1826],
  ]) {
    it(`${actionId}：80 级 CD 120s + 10%，90 级 CD 90s + 10%，100 级沿用注册表`, () => {
      const lv80 = cast(80, actionId, statusId)
      expect(lv80.action.cooldown).toBe(120)
      expect(lv80.status?.performance).toEqual({ physics: 0.9, magic: 0.9, darkness: 1 })

      const lv90 = cast(90, actionId, statusId)
      expect(lv90.action.cooldown).toBe(90)
      expect(lv90.status?.performance).toEqual({ physics: 0.9, magic: 0.9, darkness: 1 })

      const lv100 = cast(100, actionId, statusId)
      expect(lv100.status?.performance).toBeUndefined()
    })
  }

  it('庇护所 3569：70 级 HoT 实例不带治疗增益，80 级沿用注册表', () => {
    expect(cast(70, 3569, 1911).status?.performance?.heal).toBeUndefined()
    expect(cast(80, 3569, 1911).status?.performance).toBeUndefined()
  })

  it('铁壁 7531：90 级保留 20% 减伤、不带受治疗增益，100 级沿用注册表', () => {
    expect(cast(90, 7531, 1191).status?.performance).toEqual({
      physics: 0.8,
      magic: 0.8,
      darkness: 1,
    })
    expect(cast(100, 7531, 1191).status?.performance).toBeUndefined()
  })

  it('战栗 40：70 级保留最大体力 +20%、不带受治疗增益，80 级沿用注册表', () => {
    const lv70 = cast(70, 40, 87).status?.performance
    expect(lv70?.maxHP).toBe(1.2)
    expect(lv70?.heal).toBeUndefined()
    expect(cast(80, 40, 87).status?.performance).toBeUndefined()
  })
})
