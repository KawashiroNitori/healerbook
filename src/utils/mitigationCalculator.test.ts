/**
 * 减伤计算器测试（基于状态）
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MitigationCalculator } from './mitigationCalculator'
import type { PartyState } from '@/types/partyState'
import type { CastEvent, DamageEvent, DamageEventType, DamageType } from '@/types/timeline'
import { vi } from 'vitest'
import * as registry from '@/utils/statusRegistry'
import type { MitigationStatusMetadata } from '@/types/status'
import { updateStatus } from '@/executors/statusHelpers'

function makeEvent(
  damage: number,
  time: number,
  damageType: DamageType = 'physical',
  type: DamageEventType = 'tankbuster',
  snapshotTime?: number
): DamageEvent {
  return { id: 'e', name: 'e', damage, time, damageType, type, snapshotTime }
}

describe('MitigationCalculator', () => {
  let calculator: MitigationCalculator
  let basePartyState: PartyState

  beforeEach(() => {
    calculator = new MitigationCalculator()
    basePartyState = {
      players: [{ id: 1, job: 'PLD', maxHP: 100000 }],
      statuses: [],
      timestamp: 0,
    }
  })

  describe('百分比减伤计算', () => {
    it('应该正确计算节制的 10% 减伤', () => {
      const partyState: PartyState = {
        ...basePartyState,
        players: [{ id: 1, job: 'WHM', maxHP: 100000 }],
        statuses: [
          {
            instanceId: 'test-temperance',
            statusId: 1873,
            startTime: 0,
            endTime: 25,
            sourceActionId: 16536,
            sourcePlayerId: 2,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(100000, 10, 'magical'), partyState)

      expect(result.originalDamage).toBe(100000)
      expect(result.finalDamage).toBe(90000)
      expect(result.mitigationPercentage).toBe(10)
      expect(result.appliedStatuses).toHaveLength(1)
    })

    it('应该正确计算单个友方减伤', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'test-1',
            statusId: 1191,
            startTime: 0,
            endTime: 20,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 10, 'physical'), partyState)

      expect(result.finalDamage).toBe(8000)
      expect(result.mitigationPercentage).toBe(20)
      expect(result.appliedStatuses).toHaveLength(1)
    })

    it('应该正确计算多个友方减伤（乘算）', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'test-1',
            statusId: 1191,
            startTime: 0,
            endTime: 20,
          },
          {
            instanceId: 'test-2',
            statusId: 1873,
            startTime: 0,
            endTime: 25,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 10, 'physical'), partyState)

      expect(result.finalDamage).toBe(7200)
      expect(result.mitigationPercentage).toBe(28)
      expect(result.appliedStatuses).toHaveLength(2)
    })

    it('应该正确计算敌方 Debuff（统一放在 player.statuses）', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'test-1',
            statusId: 1193,
            startTime: 0,
            endTime: 15,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 10, 'physical'), partyState)

      expect(result.finalDamage).toBe(9000)
      expect(result.mitigationPercentage).toBe(10)
      expect(result.appliedStatuses).toHaveLength(1)
    })

    it('应该正确计算友方减伤 + 敌方 Debuff（统一在 player.statuses）', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'test-1',
            statusId: 1191,
            startTime: 0,
            endTime: 20,
          },
          {
            instanceId: 'test-2',
            statusId: 1193,
            startTime: 0,
            endTime: 15,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 10, 'physical'), partyState)

      expect(result.finalDamage).toBe(7200)
      expect(result.mitigationPercentage).toBe(28)
      expect(result.appliedStatuses).toHaveLength(2)
    })
  })

  describe('盾值减伤计算', () => {
    it('应该正确消耗盾值', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'test-1',
            statusId: 297,
            startTime: 0,
            endTime: 30,
            remainingBarrier: 5000,
            removeOnBarrierBreak: true,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 10, 'physical', 'aoe'), partyState)

      expect(result.finalDamage).toBe(5000)
      expect(result.mitigationPercentage).toBe(50)
      expect(result.appliedStatuses).toHaveLength(1)
      expect(result.updatedPartyState).toBeDefined()
      expect(result.updatedPartyState!.statuses).toHaveLength(0)
    })

    it('应该正确处理盾值不足的情况', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'test-1',
            statusId: 297,
            startTime: 0,
            endTime: 30,
            remainingBarrier: 3000,
            removeOnBarrierBreak: true,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 10, 'physical', 'aoe'), partyState)

      expect(result.finalDamage).toBe(7000)
      expect(result.mitigationPercentage).toBe(30)
    })

    it('应该正确处理百分比减伤 + 盾值', () => {
      // 死刑场景：铁壁（坦专 20%）+ 至黑之夜（坦专盾 2000）
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'test-1',
            statusId: 1191,
            startTime: 0,
            endTime: 20,
          },
          {
            instanceId: 'test-2',
            statusId: 1178,
            startTime: 0,
            endTime: 30,
            remainingBarrier: 2000,
            removeOnBarrierBreak: true,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 10, 'physical'), partyState)

      expect(result.finalDamage).toBe(6000)
      expect(result.mitigationPercentage).toBe(40)
      expect(result.appliedStatuses).toHaveLength(2)
    })

    it('应该正确处理多个盾值', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'test-1',
            statusId: 297,
            startTime: 0,
            endTime: 30,
            remainingBarrier: 3000,
            removeOnBarrierBreak: true,
          },
          {
            instanceId: 'test-2',
            statusId: 2613,
            startTime: 0,
            endTime: 15,
            remainingBarrier: 4000,
            removeOnBarrierBreak: true,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 10, 'physical', 'aoe'), partyState)

      expect(result.finalDamage).toBe(3000)
      expect(result.mitigationPercentage).toBe(70)
    })

    it('应该正确处理盾值完全吸收伤害', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'test-1',
            statusId: 297,
            startTime: 0,
            endTime: 30,
            remainingBarrier: 15000,
            removeOnBarrierBreak: true,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 10, 'physical', 'aoe'), partyState)

      expect(result.finalDamage).toBe(0)
      expect(result.mitigationPercentage).toBe(100)
      expect(result.updatedPartyState!.statuses[0].remainingBarrier).toBe(5000)
    })

    it('应该按 startTime 顺序消耗盾值', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          // 注意：数组顺序故意打乱，测试是否按 startTime 排序
          {
            instanceId: 'shield-3',
            statusId: 297, // 鼓舞
            startTime: 15,
            endTime: 45,
            remainingBarrier: 3000,
            removeOnBarrierBreak: true,
          },
          {
            instanceId: 'shield-1',
            statusId: 2613, // 野战治疗阵
            startTime: 5,
            endTime: 35,
            remainingBarrier: 2000,
            removeOnBarrierBreak: true,
          },
          {
            instanceId: 'shield-2',
            statusId: 1918, // 士气高扬之策
            startTime: 10,
            endTime: 40,
            remainingBarrier: 2500,
            removeOnBarrierBreak: true,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 20, 'physical', 'aoe'), partyState)

      // 预期消耗顺序：shield-1 (startTime=5) -> shield-2 (startTime=10) -> shield-3 (startTime=15)
      // 10000 - 2000 - 2500 - 3000 = 2500
      expect(result.finalDamage).toBe(2500)
      expect(result.mitigationPercentage).toBe(75)
      expect(result.appliedStatuses).toHaveLength(3)

      // 验证盾值消耗顺序
      const updatedStatuses = result.updatedPartyState!.statuses
      expect(updatedStatuses).toHaveLength(0) // 所有盾值都被消耗完
    })

    it('应该按 startTime 顺序消耗盾值（部分消耗）', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'shield-2',
            statusId: 297,
            startTime: 10,
            endTime: 40,
            remainingBarrier: 5000,
            removeOnBarrierBreak: true,
          },
          {
            instanceId: 'shield-1',
            statusId: 2613,
            startTime: 5,
            endTime: 35,
            remainingBarrier: 3000,
            removeOnBarrierBreak: true,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(5000, 15, 'physical', 'aoe'), partyState)

      // 预期消耗顺序：shield-1 (startTime=5) 先消耗 3000，shield-2 (startTime=10) 再消耗 2000
      expect(result.finalDamage).toBe(0)
      expect(result.mitigationPercentage).toBe(100)

      const updatedStatuses = result.updatedPartyState!.statuses
      expect(updatedStatuses).toHaveLength(1)
      expect(updatedStatuses[0].instanceId).toBe('shield-2')
      expect(updatedStatuses[0].remainingBarrier).toBe(3000) // 5000 - 2000
    })
  })

  describe('状态生效时间', () => {
    it('应该忽略未生效的状态', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'test-1',
            statusId: 1191,
            startTime: 20,
            endTime: 40,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 10, 'physical'), partyState)

      expect(result.finalDamage).toBe(10000)
      expect(result.mitigationPercentage).toBe(0)
      expect(result.appliedStatuses).toHaveLength(0)
    })

    it('应该忽略已过期的状态', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'test-1',
            statusId: 1191,
            startTime: 0,
            endTime: 20,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 30, 'physical'), partyState)

      expect(result.finalDamage).toBe(10000)
      expect(result.mitigationPercentage).toBe(0)
      expect(result.appliedStatuses).toHaveLength(0)
    })
  })

  describe('伤害类型', () => {
    it('应该正确处理物理伤害', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'test-1',
            statusId: 1195,
            startTime: 0,
            endTime: 15,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 10, 'physical'), partyState)

      expect(result.finalDamage).toBe(9000)
    })

    it('应该正确处理魔法伤害', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'test-1',
            statusId: 1195,
            startTime: 0,
            endTime: 15,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 10, 'magical'), partyState)

      expect(result.finalDamage).toBe(9500)
    })
  })

  describe('坦克专属状态过滤（按攻击类型）', () => {
    const partyStateWithTankMit = (): PartyState => ({
      ...basePartyState,
      statuses: [
        {
          instanceId: 'tank-rampart',
          statusId: 1191, // 铁壁：isTankOnly = true，20% 减伤
          startTime: 0,
          endTime: 20,
        },
        {
          instanceId: 'party-feint',
          statusId: 1195, // 牵制：isTankOnly = false，物理 10% 减伤
          startTime: 0,
          endTime: 15,
        },
      ],
    })

    it('死刑应包含坦克专属减伤', () => {
      const result = calculator.calculate(
        makeEvent(10000, 10, 'physical', 'tankbuster'),
        partyStateWithTankMit()
      )

      expect(result.finalDamage).toBe(7200) // 10000 * 0.8 * 0.9
      expect(result.appliedStatuses).toHaveLength(2)
    })

    it('普通攻击应包含坦克专属减伤', () => {
      const result = calculator.calculate(
        makeEvent(10000, 10, 'physical', 'auto'),
        partyStateWithTankMit()
      )

      expect(result.finalDamage).toBe(7200)
      expect(result.appliedStatuses).toHaveLength(2)
    })

    it('AOE 应忽略坦克专属减伤', () => {
      const result = calculator.calculate(
        makeEvent(10000, 10, 'physical', 'aoe'),
        partyStateWithTankMit()
      )

      expect(result.finalDamage).toBe(9000) // 只生效牵制 10%
      expect(result.appliedStatuses).toHaveLength(1)
      expect(result.appliedStatuses[0].instanceId).toBe('party-feint')
    })

    it('AOE 应忽略坦克专属盾值', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'tank-tbn',
            statusId: 1178, // 至黑之夜：isTankOnly = true
            startTime: 0,
            endTime: 7,
            remainingBarrier: 5000,
            removeOnBarrierBreak: true,
            initialBarrier: 5000,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 5, 'physical', 'aoe'), partyState)

      expect(result.finalDamage).toBe(10000)
      expect(result.mitigationPercentage).toBe(0)
      expect(result.appliedStatuses).toHaveLength(0)
      // 未被 AOE 消耗
      expect(result.updatedPartyState!.statuses[0].remainingBarrier).toBe(5000)
    })

    it('死刑应忽略非坦克专属盾值', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'party-shield',
            statusId: 297, // 鼓舞：isTankOnly = false
            startTime: 0,
            endTime: 30,
            remainingBarrier: 5000,
            removeOnBarrierBreak: true,
            initialBarrier: 5000,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 5, 'physical', 'tankbuster'), partyState)

      expect(result.finalDamage).toBe(10000)
      expect(result.appliedStatuses).toHaveLength(0)
      // 群盾保持不消耗
      expect(result.updatedPartyState!.statuses[0].remainingBarrier).toBe(5000)
    })

    it('普通攻击应忽略非坦克专属盾值', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'party-shield',
            statusId: 297,
            startTime: 0,
            endTime: 30,
            remainingBarrier: 5000,
            removeOnBarrierBreak: true,
            initialBarrier: 5000,
          },
        ],
      }

      const result = calculator.calculate(makeEvent(10000, 5, 'physical', 'auto'), partyState)

      expect(result.finalDamage).toBe(10000)
      expect(result.appliedStatuses).toHaveLength(0)
      expect(result.updatedPartyState!.statuses[0].remainingBarrier).toBe(5000)
    })
  })

  describe('StatusExecutor 钩子通路', () => {
    const FAKE_BUFF_ID = 999900
    const FAKE_SHIELD_ID = 999901

    function withFakeMeta(extra: Record<number, Partial<MitigationStatusMetadata>>) {
      const original = registry.getStatusById
      return vi.spyOn(registry, 'getStatusById').mockImplementation(id => {
        if (extra[id]) {
          return {
            id,
            name: `fake-${id}`,
            type: extra[id].type ?? 'multiplier',
            performance: { physics: 1, magic: 1, darkness: 1, heal: 1, maxHP: 1 },
            isFriendly: true,
            isTankOnly: false,
            ...extra[id],
          } as MitigationStatusMetadata
        }
        return original(id)
      })
    }

    it('onBeforeShield 被调用，返回的 PartyState 带入盾值阶段', () => {
      const onBeforeShield = vi.fn().mockImplementation(ctx => {
        return {
          ...ctx.partyState,
          statuses: [
            ...ctx.partyState.statuses,
            {
              instanceId: 'injected-shield',
              statusId: FAKE_SHIELD_ID,
              startTime: ctx.event.time,
              endTime: ctx.event.time,
              remainingBarrier: 5000,
              initialBarrier: 5000,
              removeOnBarrierBreak: true,
            },
          ],
        }
      })

      const spy = withFakeMeta({
        [FAKE_BUFF_ID]: { type: 'multiplier', isTankOnly: true, executor: { onBeforeShield } },
        [FAKE_SHIELD_ID]: { type: 'absorbed', isTankOnly: true },
      })

      try {
        const partyState: PartyState = {
          statuses: [
            {
              instanceId: 'trigger',
              statusId: FAKE_BUFF_ID,
              startTime: 0,
              endTime: 10,
              sourcePlayerId: 1,
            },
          ],
          timestamp: 0,
        }

        const result = calculator.calculate(
          makeEvent(10000, 5, 'physical', 'tankbuster'),
          partyState
        )

        expect(onBeforeShield).toHaveBeenCalledTimes(1)
        expect(onBeforeShield.mock.calls[0][0].candidateDamage).toBe(10000)
        expect(result.finalDamage).toBe(5000)
      } finally {
        spy.mockRestore()
      }
    })

    it('onConsume 在盾被完全打穿时被调用', () => {
      const onConsume = vi.fn().mockImplementation(ctx => ctx.partyState)

      const spy = withFakeMeta({
        [FAKE_SHIELD_ID]: { type: 'absorbed', isTankOnly: true, executor: { onConsume } },
      })

      try {
        const partyState: PartyState = {
          statuses: [
            {
              instanceId: 'shield',
              statusId: FAKE_SHIELD_ID,
              startTime: 0,
              endTime: 20,
              remainingBarrier: 3000,
              initialBarrier: 3000,
              removeOnBarrierBreak: true,
            },
          ],
          timestamp: 0,
        }

        calculator.calculate(makeEvent(5000, 5, 'physical', 'tankbuster'), partyState)

        expect(onConsume).toHaveBeenCalledTimes(1)
        expect(onConsume.mock.calls[0][0].absorbedAmount).toBe(3000)
      } finally {
        spy.mockRestore()
      }
    })

    it('onBeforeShield 可以通过 updateStatus 给 multiplier 状态实例加 barrier 使其当场参与盾吸收', () => {
      const onBeforeShield = vi.fn().mockImplementation(ctx => {
        return updateStatus(ctx.partyState, ctx.status.instanceId, {
          remainingBarrier: ctx.candidateDamage,
        })
      })

      const spy = withFakeMeta({
        [FAKE_BUFF_ID]: { type: 'multiplier', isTankOnly: true, executor: { onBeforeShield } },
      })

      try {
        const partyState: PartyState = {
          statuses: [
            {
              instanceId: 'ld',
              statusId: FAKE_BUFF_ID,
              startTime: 0,
              endTime: 10,
              sourcePlayerId: 1,
            },
          ],
          timestamp: 0,
        }

        const result = calculator.calculate(
          makeEvent(15000, 5, 'physical', 'tankbuster'),
          partyState
        )

        expect(onBeforeShield).toHaveBeenCalledTimes(1)
        expect(result.finalDamage).toBe(0)
        // multiplier 状态即使 barrier 被打穿仍保留在 state，供下一事件再次触发 onBeforeShield
        const ld = result.updatedPartyState!.statuses.find(s => s.instanceId === 'ld')
        expect(ld).toBeDefined()
        expect(ld!.remainingBarrier).toBe(0)
      } finally {
        spy.mockRestore()
      }
    })

    it('死斗 onBeforeShield 只统计 tankOnly 盾并给自身补足所需盾值', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'ld',
            statusId: 409,
            startTime: 0,
            endTime: 10,
            sourcePlayerId: 1,
          },
          {
            instanceId: 'team-shield',
            statusId: 297,
            startTime: 0,
            endTime: 20,
            remainingBarrier: 3000,
            removeOnBarrierBreak: true,
            initialBarrier: 3000,
          },
          {
            instanceId: 'tank-shield',
            statusId: 1178,
            startTime: 0,
            endTime: 20,
            remainingBarrier: 2000,
            removeOnBarrierBreak: true,
            initialBarrier: 2000,
          },
        ],
      }

      const event: DamageEvent = {
        id: 'e-ld',
        name: 'tankbuster',
        time: 5,
        damage: 20000,
        type: 'tankbuster',
        damageType: 'physical',
      }

      // 编辑模式以 referenceMaxHP 当作坦克满血（5000 模拟一个低 HP 坦克参考值）
      const result = calculator.calculate(event, partyState, { referenceMaxHP: 5000 })

      // 公式: required = candidate(20000) - tankOnlyShield(2000) - referenceMaxHP(5000) + 1 = 13001
      // 死刑事件下 Phase 3 只消耗坦专盾：20000 - 13001 - tank(2000) = 4999（team 盾 3000 保留）
      expect(result.finalDamage).toBe(4999)
    })

    it('死斗对同时段内多次伤害事件都能触发 onBeforeShield', () => {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'ld',
            statusId: 409,
            startTime: 0,
            endTime: 10,
            sourcePlayerId: 1,
          },
        ],
      }

      // 第一次 20000 伤害：LD 补盾 15001、把伤害挡到 4999
      const first = calculator.calculate(
        { id: 'e1', name: '', time: 3, damage: 20000, type: 'tankbuster', damageType: 'physical' },
        partyState,
        { referenceMaxHP: 5000 }
      )
      expect(first.finalDamage).toBe(4999)
      const ldAfterFirst = first.updatedPartyState!.statuses.find(s => s.instanceId === 'ld')
      expect(ldAfterFirst).toBeDefined()
      expect(ldAfterFirst!.remainingBarrier).toBe(0)

      // 第二次 18000 伤害：LD 应再次补盾 13001、把伤害挡到 4999
      const second = calculator.calculate(
        { id: 'e2', name: '', time: 6, damage: 18000, type: 'tankbuster', damageType: 'physical' },
        first.updatedPartyState!,
        { referenceMaxHP: 5000 }
      )
      expect(second.finalDamage).toBe(4999)
    })

    it('onConsume 在盾未打穿时不调用', () => {
      const onConsume = vi.fn()

      const spy = withFakeMeta({
        [FAKE_SHIELD_ID]: { type: 'absorbed', executor: { onConsume } },
      })

      try {
        const partyState: PartyState = {
          statuses: [
            {
              instanceId: 'shield',
              statusId: FAKE_SHIELD_ID,
              startTime: 0,
              endTime: 20,
              remainingBarrier: 10000,
              initialBarrier: 10000,
              removeOnBarrierBreak: true,
            },
          ],
          timestamp: 0,
        }

        calculator.calculate(makeEvent(3000, 5, 'physical', 'tankbuster'), partyState)

        expect(onConsume).not.toHaveBeenCalled()
      } finally {
        spy.mockRestore()
      }
    })

    it('onAfterDamage 在盾吸收后调用，能拿到 finalDamage', () => {
      const onAfterDamage = vi.fn().mockImplementation(ctx => ctx.partyState)

      const spy = withFakeMeta({
        [FAKE_BUFF_ID]: { type: 'multiplier', executor: { onAfterDamage } },
      })

      try {
        const partyState: PartyState = {
          statuses: [
            {
              instanceId: 'watcher',
              statusId: FAKE_BUFF_ID,
              startTime: 0,
              endTime: 10,
              sourcePlayerId: 1,
            },
          ],
          timestamp: 0,
        }

        calculator.calculate(makeEvent(4000, 5, 'physical', 'tankbuster'), partyState)

        expect(onAfterDamage).toHaveBeenCalledTimes(1)
        const passed = onAfterDamage.mock.calls[0][0]
        expect(passed.candidateDamage).toBe(4000)
        expect(passed.finalDamage).toBe(4000)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('MitigationCalculator with simplified PartyState', () => {
    it('should calculate damage using player.statuses only', () => {
      const partyState: PartyState = {
        players: [{ id: 1, job: 'WHM', maxHP: 50000 }],
        statuses: [
          {
            instanceId: 'status-1',
            statusId: 1193, // 雪仇 10% 减伤
            startTime: 0,
            endTime: 15,
          },
          {
            instanceId: 'status-2',
            statusId: 1176, // 武装 15% 减伤
            startTime: 0,
            endTime: 30,
          },
        ],
        timestamp: 10,
      }

      const result = calculator.calculate(makeEvent(10000, 10, 'physical'), partyState)

      expect(result.finalDamage).toBe(7650) // 10000 * 0.9 * 0.85
      expect(result.appliedStatuses).toHaveLength(2)
      expect(result.updatedPartyState).toBeDefined()
    })
  })
})

describe('多坦 per-victim 路径', () => {
  let calculator: MitigationCalculator
  let basePartyState: PartyState

  beforeEach(() => {
    calculator = new MitigationCalculator()
    basePartyState = {
      players: [
        { id: 1, job: 'PLD', maxHP: 100000 },
        { id: 2, job: 'WAR', maxHP: 100000 },
      ],
      statuses: [],
      timestamp: 0,
    }
  })

  it('双坦共受伤：死斗（self+shield）只在持有者分支生效', () => {
    const partyState: PartyState = {
      ...basePartyState,
      statuses: [
        {
          instanceId: 'ihd-1',
          statusId: 409,
          startTime: 0,
          endTime: 10,
          sourcePlayerId: 1,
          removeOnBarrierBreak: false,
        },
      ],
    }
    const result = calculator.calculate(
      makeEvent(200000, 5, 'physical', 'tankbuster'),
      partyState,
      { tankPlayerIds: [1, 2], baseReferenceMaxHP: 100000 }
    )
    expect(result.perVictim).toHaveLength(2)
    expect(result.perVictim![0].playerId).toBe(1)
    expect(result.perVictim![1].playerId).toBe(2)
    // MT 分支：死斗 onBeforeShield 计算 requiredShield = 200000 - 0 - 100000 + 1 = 100001
    // 吸收后 playerDamage = 200000 - 100001 = 99999
    expect(result.perVictim![0].finalDamage).toBe(99999)
    // OT 分支：死斗被 tankFilter 过滤（category 无 'target'），无减伤
    expect(result.perVictim![1].finalDamage).toBe(200000)
    expect(result.finalDamage).toBe(99999)
    expect(result.maxDamage).toBe(200000)
  })

  it('未标注 category 的状态对持有者和非持有者都生效（复仇 89 场景）', () => {
    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation((id: number) => {
      if (id === 89) {
        return {
          id: 89,
          name: '复仇',
          type: 'multiplier',
          performance: { physics: 0.7, magic: 0.7, darkness: 0.7 },
          isFriendly: true,
          isTankOnly: true,
        } as unknown as MitigationStatusMetadata
      }
      return undefined
    })
    try {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'v-1',
            statusId: 89,
            startTime: 0,
            endTime: 10,
            sourcePlayerId: 1,
          },
        ],
      }
      const result = calculator.calculate(
        makeEvent(10000, 5, 'physical', 'tankbuster'),
        partyState,
        { tankPlayerIds: [1, 2], baseReferenceMaxHP: 100000 }
      )
      expect(result.perVictim![0].finalDamage).toBe(7000)
      expect(result.perVictim![1].finalDamage).toBe(7000)
    } finally {
      spy.mockRestore()
    }
  })

  it('最优减伤分支 state 持久化：OT 自盾让 OT 分支胜出', () => {
    // OT 持有一块 self-only 盾（category 不含 target），MT 毫无防御。
    // → MT 分支因不满足 target 要求被过滤，吃满伤害；OT 分支吸收完全伤害。
    // → 最低 finalDamage 分支 = OT，updatedPartyState 反映 OT 分支的盾消耗。
    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation((id: number) => {
      if (id === 8888) {
        return {
          id: 8888,
          name: 'mock-self-shield',
          type: 'absorbed',
          performance: { physics: 1, magic: 1, darkness: 1 },
          isFriendly: true,
          isTankOnly: true,
          category: ['self', 'shield'],
        } as unknown as MitigationStatusMetadata
      }
      return undefined
    })
    try {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'sh-1',
            statusId: 8888,
            startTime: 0,
            endTime: 10,
            sourcePlayerId: 2, // OT 持有
            remainingBarrier: 5000,
            initialBarrier: 5000,
            removeOnBarrierBreak: true,
          },
        ],
      }
      const result = calculator.calculate(
        makeEvent(3000, 5, 'physical', 'tankbuster'),
        partyState,
        { tankPlayerIds: [1, 2], baseReferenceMaxHP: 100000 }
      )
      // perVictim 按 finalDamage 升序：OT (0) 在前，MT (3000) 在后
      expect(result.perVictim![0].playerId).toBe(2)
      expect(result.perVictim![0].finalDamage).toBe(0)
      expect(result.perVictim![1].playerId).toBe(1)
      expect(result.perVictim![1].finalDamage).toBe(3000)
      // 顶层取最优分支（OT）
      expect(result.finalDamage).toBe(0)
      expect(result.maxDamage).toBe(3000)
      // 持久化 state 来自 OT 分支：盾剩 5000 - 3000 = 2000
      const persistedShield = result.updatedPartyState!.statuses.find(s => s.instanceId === 'sh-1')
      expect(persistedShield?.remainingBarrier).toBe(2000)
    } finally {
      spy.mockRestore()
    }
  })

  it('maxHP 按 tank 个性化：MT 有战栗 1.2×，OT 没有', () => {
    const partyState: PartyState = {
      ...basePartyState,
      statuses: [
        {
          instanceId: 'tr-1',
          statusId: 87,
          startTime: 0,
          endTime: 10,
          sourcePlayerId: 1,
        },
      ],
    }
    const result = calculator.calculate(makeEvent(1, 5, 'physical', 'tankbuster'), partyState, {
      tankPlayerIds: [1, 2],
      baseReferenceMaxHP: 100000,
    })
    expect(result.perVictim![0].referenceMaxHP).toBe(120000)
    expect(result.perVictim![1].referenceMaxHP).toBe(100000)
  })

  it('单坦退化：tankPlayerIds 只有一个时 perVictim 长度=1', () => {
    const partyState: PartyState = {
      ...basePartyState,
      statuses: [
        {
          instanceId: 'br-1',
          statusId: 1191,
          startTime: 0,
          endTime: 10,
          sourcePlayerId: 1,
        },
      ],
    }
    const result = calculator.calculate(makeEvent(10000, 5, 'physical', 'tankbuster'), partyState, {
      tankPlayerIds: [1],
      baseReferenceMaxHP: 100000,
    })
    expect(result.perVictim).toHaveLength(1)
    expect(result.perVictim![0].playerId).toBe(1)
    expect(result.finalDamage).toBe(8000)
  })

  it('非坦专事件不走多坦路径：aoe 事件 perVictim undefined', () => {
    const partyState: PartyState = {
      ...basePartyState,
      statuses: [],
    }
    const result = calculator.calculate(makeEvent(10000, 5, 'magical', 'aoe'), partyState, {
      tankPlayerIds: [1, 2],
      baseReferenceMaxHP: 100000,
    })
    expect(result.perVictim).toBeUndefined()
  })

  it('非坦专盾（partywide shield）不进入坦专事件的 Phase 3 吸收', () => {
    // 保持旧口径：一份 partywide 盾代表单玩家份额，不该被坦专事件消耗
    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation((id: number) => {
      if (id === 9999) {
        return {
          id: 9999,
          name: 'mock-party-shield',
          type: 'absorbed',
          performance: { physics: 1, magic: 1, darkness: 1 },
          isFriendly: true,
          isTankOnly: false,
          category: ['partywide', 'shield'],
        } as unknown as MitigationStatusMetadata
      }
      return undefined
    })
    try {
      const partyState: PartyState = {
        ...basePartyState,
        statuses: [
          {
            instanceId: 'ps-1',
            statusId: 9999,
            startTime: 0,
            endTime: 10,
            sourcePlayerId: 3,
            remainingBarrier: 4000,
            initialBarrier: 4000,
            removeOnBarrierBreak: true,
          },
        ],
      }
      const result = calculator.calculate(
        makeEvent(2000, 5, 'physical', 'tankbuster'),
        partyState,
        { tankPlayerIds: [1, 2], baseReferenceMaxHP: 100000 }
      )
      // 两个分支都不消耗这块盾 → 吃满 2000
      expect(result.perVictim![0].finalDamage).toBe(2000)
      expect(result.perVictim![1].finalDamage).toBe(2000)
      // 持久化的 barrier 保持不变
      const persisted = result.updatedPartyState!.statuses.find(s => s.instanceId === 'ps-1')
      expect(persisted?.remainingBarrier).toBe(4000)
    } finally {
      spy.mockRestore()
    }
  })

  it('行尸走肉 → 出死入生 链路：sourcePlayerId 在 onConsume 中正确承接', () => {
    // 回归：810 onConsume 创建 3255 时必须传 sourcePlayerId，
    // 否则下一事件里 isStatusValidForTank 会把 category=['self','percentage'] 的 3255 判为
    // 非持有者（undefined !== tankId）+ 没 target → 过滤掉，出死入生效果丢失。
    const partyState0: PartyState = {
      ...basePartyState,
      statuses: [
        {
          instanceId: 'lzzr-1',
          statusId: 810, // 行尸走肉
          startTime: 0,
          endTime: 10,
          sourcePlayerId: 1, // MT 持有
        },
      ],
    }
    const e1 = makeEvent(200000, 5, 'physical', 'tankbuster')
    const r1 = calculator.calculate(e1, partyState0, {
      tankPlayerIds: [1, 2],
      baseReferenceMaxHP: 100000,
    })
    // MT 分支 810 吸收：finalDamage = 99999；onConsume 移除 810 并加 3255
    expect(r1.perVictim![0].playerId).toBe(1)
    expect(r1.perVictim![0].finalDamage).toBe(99999)
    const persisted3255 = r1.updatedPartyState!.statuses.find(s => s.statusId === 3255)
    expect(persisted3255).toBeDefined()
    expect(persisted3255!.sourcePlayerId).toBe(1) // sourcePlayerId 已承接

    // 下一死刑：3255 的 survival hook 仍应为 MT 分支生效
    const e2 = makeEvent(200000, 8, 'physical', 'tankbuster')
    const r2 = calculator.calculate(e2, r1.updatedPartyState!, {
      tankPlayerIds: [1, 2],
      baseReferenceMaxHP: 100000,
    })
    expect(r2.perVictim![0].playerId).toBe(1)
    expect(r2.perVictim![0].finalDamage).toBe(99999)
    expect(r2.perVictim![0].appliedStatuses.some(s => s.statusId === 3255)).toBe(true)
    // OT 分支：3255 category=['self','percentage']、sourcePlayerId!==OT → 被过滤 → 吃满
    expect(r2.perVictim![1].finalDamage).toBe(200000)
  })

  describe('simulate → statusTimelineByPlayer', () => {
    it('记录 cast executor attach 的 status interval（from = cast 时间，to = endTime）', () => {
      // 节制 16536：executor 会 attach 1873，duration 25s（不改 executor，仅用作 attach 验证样本）
      const castEvents = [
        { id: 'c1', actionId: 16536, playerId: 1, timestamp: 10 } as unknown as CastEvent,
      ]
      const calc = new MitigationCalculator()
      const { statusTimelineByPlayer } = calc.simulate({
        castEvents,
        damageEvents: [
          {
            id: 'd1',
            name: 'd1',
            time: 100,
            damage: 100000,
            type: 'aoe',
            damageType: 'physical',
          } as DamageEvent,
        ],
        initialState: { players: [], statuses: [], timestamp: 0 },
      })
      const list = statusTimelineByPlayer.get(1)?.get(1873) ?? []
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({
        from: 10,
        to: 35,
        sourcePlayerId: 1,
        sourceCastEventId: 'c1',
      })
    })

    it('炽天附体 37014 attach 3885，interval from = cast 时间、to = endTime', () => {
      const castEvents = [
        { id: 'c-seraph', actionId: 37014, playerId: 1, timestamp: 5 } as unknown as CastEvent,
      ]
      const calc = new MitigationCalculator()
      const { statusTimelineByPlayer } = calc.simulate({
        castEvents,
        damageEvents: [
          {
            id: 'd1',
            name: 'd1',
            time: 100,
            damage: 100000,
            type: 'aoe',
            damageType: 'physical',
          } as DamageEvent,
        ],
        initialState: { players: [], statuses: [], timestamp: 0 },
      })
      const list = statusTimelineByPlayer.get(1)?.get(3885) ?? []
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ from: 5, to: 35, sourceCastEventId: 'c-seraph' })
    })

    it('最后一个 damage event 之后的 cast 也会被处理并进入 statusTimelineByPlayer', () => {
      // 回归：damage event 的 for-of 内部 while 只追到 timestamp ≤ event.time 的 cast，
      // 此后剩余 casts 原先永远不会被 executor 执行——典型表现是把 37014 放在最后一个
      // damage event 之后，双击 37013 轨道时 buff 不在 statusTimelineByPlayer 中，
      // 37016 placement 为空导致"无法放置"。
      const castEvents = [
        { id: 'c-seraph', actionId: 37014, playerId: 1, timestamp: 20 } as unknown as CastEvent,
      ]
      const calc = new MitigationCalculator()
      const { statusTimelineByPlayer } = calc.simulate({
        castEvents,
        damageEvents: [
          {
            id: 'd-early',
            name: 'd-early',
            time: 5,
            damage: 100000,
            type: 'aoe',
            damageType: 'physical',
          } as DamageEvent,
        ],
        initialState: { players: [], statuses: [], timestamp: 0 },
      })
      const list = statusTimelineByPlayer.get(1)?.get(3885) ?? []
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ from: 20, to: 50, sourceCastEventId: 'c-seraph' })
    })

    it('完全无 damage event 时也能处理 casts', () => {
      // 回归：若时间轴完全没有 damage event，外层 for-of 不迭代，原先所有 casts 都被漏掉。
      const castEvents = [
        { id: 'c-seraph', actionId: 37014, playerId: 1, timestamp: 5 } as unknown as CastEvent,
      ]
      const calc = new MitigationCalculator()
      const { statusTimelineByPlayer } = calc.simulate({
        castEvents,
        damageEvents: [],
        initialState: { players: [], statuses: [], timestamp: 0 },
      })
      const list = statusTimelineByPlayer.get(1)?.get(3885) ?? []
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ from: 5, to: 35, sourceCastEventId: 'c-seraph' })
    })

    it('同一技能二次施放：旧 instance 被 createBuffExecutor 移除 → 旧 interval 在二次施放点收束，新 interval 自二次施放点开', () => {
      // 证明 simulate diff 机制对"status instance 从 statuses 列表消失"的处理
      // 覆盖未来 follow-up 中 consume 场景走的同一条 diff 路径：simulate 只看 instanceId 差异，
      // 不区分消失原因（refresh 覆盖 / consume / 自然过期），因此这里用 createBuffExecutor 现成的
      // "移除同 id 旧实例再 attach 新实例"行为作为 consume 语义的同构单元验证。
      const castEvents = [
        { id: 'first', actionId: 16536, playerId: 1, timestamp: 10 } as unknown as CastEvent,
        { id: 'second', actionId: 16536, playerId: 1, timestamp: 20 } as unknown as CastEvent,
      ]
      const calc = new MitigationCalculator()
      const { statusTimelineByPlayer } = calc.simulate({
        castEvents,
        damageEvents: [
          {
            id: 'd1',
            name: 'd1',
            time: 100,
            damage: 100000,
            type: 'aoe',
            damageType: 'physical',
          } as DamageEvent,
        ],
        initialState: { players: [], statuses: [], timestamp: 0 },
      })
      const list = statusTimelineByPlayer.get(1)?.get(1873) ?? []
      expect(list).toHaveLength(2)
      // 旧 interval：[10, 20)（二次施放时 createBuffExecutor 移除旧 instance → diff 关闭）
      expect(list[0]).toMatchObject({ from: 10, to: 20, sourceCastEventId: 'first' })
      // 新 interval：[20, 45)（二次施放 attach 新 instance）
      expect(list[1]).toMatchObject({ from: 20, to: 45, sourceCastEventId: 'second' })
    })
  })
})

describe('simulate → castEffectiveEndByCastEventId', () => {
  it('cast 一个 buff，无后续事件 → effectiveEnd = ts + duration', () => {
    // 节制 16536 attach 1873（25s）+ 3881（30s），max = 10 + 30 = 40
    const castEvents = [
      { id: 'c1', actionId: 16536, playerId: 1, timestamp: 10 } as unknown as CastEvent,
    ]
    const calc = new MitigationCalculator()
    const { castEffectiveEndByCastEventId } = calc.simulate({
      castEvents,
      damageEvents: [],
      initialState: { players: [], statuses: [], timestamp: 0 },
    })
    expect(castEffectiveEndByCastEventId.get('c1')).toBe(40)
  })

  it('盾被中途打穿但 buff 还活 → effectiveEnd = max（取 buff 的 to）', () => {
    // 极致防御 36920 给玩家 3829 buff (15s) + 3830 shield (15s)
    const castEvents = [
      { id: 'c1', actionId: 36920, playerId: 1, timestamp: 0 } as unknown as CastEvent,
    ]
    const calc = new MitigationCalculator()
    const { castEffectiveEndByCastEventId } = calc.simulate({
      castEvents,
      damageEvents: [
        {
          id: 'd1',
          name: 'd1',
          time: 5,
          damage: 1_000_000,
          type: 'tankbuster',
          damageType: 'physical',
        } as DamageEvent,
      ],
      initialState: { players: [{ id: 1, job: 'PLD', maxHP: 100000 }], statuses: [], timestamp: 0 },
      statistics: {
        shieldByAbility: { 3830: 5000 },
        damageByAbility: {},
        maxHPByJob: {},
        critShieldByAbility: {},
        healByAbility: {},
        critHealByAbility: {},
        sampleSize: 0,
        updatedAt: '',
        tankReferenceMaxHP: 100000,
        referenceMaxHP: 100000,
      } as never,
    })
    // 3830 在 t=5 被打穿且 removeOnBarrierBreak → interval to=5
    // 3829 buff 没人动 → interval to=15
    // max → 15
    expect(castEffectiveEndByCastEventId.get('c1')).toBe(15)
  })

  it('uniqueGroup 替换 → 第一条 effectiveEnd = 第二条 timestamp', () => {
    const castEvents = [
      { id: 'first', actionId: 16536, playerId: 1, timestamp: 10 } as unknown as CastEvent,
      { id: 'second', actionId: 16536, playerId: 1, timestamp: 20 } as unknown as CastEvent,
    ]
    const calc = new MitigationCalculator()
    const { castEffectiveEndByCastEventId } = calc.simulate({
      castEvents,
      damageEvents: [],
      initialState: { players: [], statuses: [], timestamp: 0 },
    })
    expect(castEffectiveEndByCastEventId.get('first')).toBe(20)
    // 节制 16536 attach 1873（25s）+ 3881（30s），second cast at t=20 → max = 20+30 = 50
    expect(castEffectiveEndByCastEventId.get('second')).toBe(50)
  })

  it('多 status cast → effectiveEnd = max(interval.to)', () => {
    // 干预 7382：buff 1174 (8s) + buff 2675 (4s)
    const castEvents = [
      { id: 'c1', actionId: 7382, playerId: 1, timestamp: 0 } as unknown as CastEvent,
    ]
    const calc = new MitigationCalculator()
    const { castEffectiveEndByCastEventId } = calc.simulate({
      castEvents,
      damageEvents: [],
      initialState: { players: [], statuses: [], timestamp: 0 },
    })
    expect(castEffectiveEndByCastEventId.get('c1')).toBe(8)
  })

  it('单纯盾击穿（无伴随 buff）→ effectiveEnd = damage event time', () => {
    // 意气轩昂之策 37013 只 attach shield 297（duration 30）
    const castEvents = [
      { id: 'c1', actionId: 37013, playerId: 1, timestamp: 0 } as unknown as CastEvent,
    ]
    const calc = new MitigationCalculator()
    const { castEffectiveEndByCastEventId } = calc.simulate({
      castEvents,
      damageEvents: [
        {
          id: 'd1',
          name: 'd1',
          time: 7,
          damage: 1_000_000,
          type: 'aoe',
          damageType: 'physical',
        } as DamageEvent,
      ],
      initialState: { players: [{ id: 1, job: 'SCH', maxHP: 100000 }], statuses: [], timestamp: 0 },
      statistics: {
        healByAbility: { 37013: 100 }, // shield = 100*1.8 = 180，必穿
        damageByAbility: {},
        maxHPByJob: {},
        shieldByAbility: {},
        critShieldByAbility: {},
        critHealByAbility: {},
        sampleSize: 0,
        updatedAt: '',
        tankReferenceMaxHP: 100000,
        referenceMaxHP: 100000,
      } as never,
    })
    expect(castEffectiveEndByCastEventId.get('c1')).toBe(7)
  })

  // 未实现的测试（等中期 extension / detonation executor 落地后补）：
  // - "executor 通过 updateStatus 延长 endTime → effectiveEnd 跟到新 endTime"
  // - "executor 通过 removeStatus 引爆 → effectiveEnd = 引爆 cast 时刻"
  // - "反例：filter 旧 + push 新 instanceId 的写法下，原 cast effectiveEnd 收束到
  //    transformation 时刻；新 cast 接管新 interval"
  //
  // 跳过原因：以上场景需要测试用 executor，但项目无运行时 action 注册；
  // 通过 mock MITIGATION_DATA.actions 实施代价高于本 task 收益。
  // 本 task 已通过 uniqueGroup 替换路径（仅仅是 instanceId diff 的另一面）
  // 间接验证了 "instance 消失即收束" 的核心机制。

  it('seeded buff（initialState 带的、无 cast 来源）不进 castEffectiveEnd', () => {
    const calc = new MitigationCalculator()
    const { castEffectiveEndByCastEventId } = calc.simulate({
      castEvents: [],
      damageEvents: [],
      initialState: {
        players: [],
        statuses: [
          {
            instanceId: 'seeded',
            statusId: 1873,
            startTime: 0,
            endTime: 30,
          },
        ],
        timestamp: 0,
      },
    })
    expect(castEffectiveEndByCastEventId.size).toBe(0)
  })
})

const mkDmg = (
  id: string,
  time: number,
  type: DamageEvent['type'],
  damage: number
): DamageEvent => ({
  id,
  name: id,
  time,
  damage,
  type,
  damageType: 'magical',
})

describe('HP 池演化 - partial 段累积', () => {
  const baseInitialState: PartyState = { statuses: [], timestamp: 0 }

  it('段内每次扣 max 增量；pfaoe 触发段结束', () => {
    const calculator = new MitigationCalculator()
    const damageEvents = [
      mkDmg('A', 10, 'aoe', 20000),
      mkDmg('B', 15, 'partial_aoe', 15000),
      mkDmg('D', 22, 'partial_aoe', 22000),
      mkDmg('E', 25, 'partial_aoe', 18000),
      mkDmg('G', 30, 'partial_final_aoe', 30000),
      mkDmg('I', 40, 'partial_aoe', 12000),
      mkDmg('J', 43, 'partial_aoe', 14000),
      mkDmg('L', 50, 'partial_aoe', 20000),
    ]
    const out = calculator.simulate({
      castEvents: [],
      damageEvents,
      initialState: baseInitialState,
      baseReferenceMaxHPForAoe: 100000,
    })
    const r = (id: string) => out.damageResults.get(id)!.hpSimulation!
    expect(r('A').hpAfter).toBe(80000)
    expect(r('B').hpAfter).toBe(65000)
    expect(r('D').hpAfter).toBe(58000)
    expect(r('E').hpAfter).toBe(58000) // 增量 0
    expect(r('G').hpAfter).toBe(50000) // pfaoe = partial_aoe + 段结束：dealt = max(0, 30k - 22k) = 8k
    expect(r('I').hpAfter).toBe(38000) // I 开新段 segMax=12k, dealt=12k
    expect(r('J').hpAfter).toBe(36000) // J segMax=14k, dealt=2k
    expect(r('L').hpAfter).toBe(30000) // L segMax=20k, dealt=6k
  })

  it('aoe 中段插入打断 partial 段', () => {
    const calculator = new MitigationCalculator()
    const damageEvents = [
      mkDmg('X1', 5, 'partial_aoe', 20000),
      mkDmg('X2', 10, 'partial_aoe', 25000),
      mkDmg('X3', 15, 'aoe', 30000),
      mkDmg('X4', 20, 'partial_aoe', 15000),
      mkDmg('X5', 25, 'partial_final_aoe', 28000),
    ]
    const out = calculator.simulate({
      castEvents: [],
      damageEvents,
      initialState: baseInitialState,
      baseReferenceMaxHPForAoe: 100000,
    })
    const r = (id: string) => out.damageResults.get(id)!.hpSimulation!
    expect(r('X1').hpAfter).toBe(80000)
    expect(r('X2').hpAfter).toBe(75000)
    expect(r('X3').hpAfter).toBe(45000)
    expect(r('X4').hpAfter).toBe(30000)
    expect(r('X5').hpAfter).toBe(17000)
  })

  it('tankbuster / auto 段穿透；tankbuster 接 partial_aoe 段不被打断', () => {
    const calculator = new MitigationCalculator()
    const damageEvents = [
      mkDmg('p1', 5, 'partial_aoe', 20000),
      mkDmg('t1', 10, 'tankbuster', 50000),
      mkDmg('p2', 15, 'partial_aoe', 25000),
    ]
    const out = calculator.simulate({
      castEvents: [],
      damageEvents,
      initialState: baseInitialState,
      baseReferenceMaxHPForAoe: 100000,
    })
    expect(out.damageResults.get('p1')!.hpSimulation!.hpAfter).toBe(80000)
    expect(out.damageResults.get('t1')!.hpSimulation).toBeUndefined()
    expect(out.damageResults.get('p2')!.hpSimulation!.hpAfter).toBe(75000)
  })

  it('overkill：aoe finalDamage > hp.current 时 hp clamp 到 0', () => {
    const calculator = new MitigationCalculator()
    const damageEvents = [mkDmg('A', 5, 'aoe', 50000), mkDmg('B', 10, 'aoe', 80000)]
    const out = calculator.simulate({
      castEvents: [],
      damageEvents,
      initialState: baseInitialState,
      baseReferenceMaxHPForAoe: 100000,
    })
    const r = out.damageResults.get('B')!.hpSimulation!
    expect(r.hpAfter).toBe(0)
    expect(r.overkill).toBe(30000)
  })

  it('段未收尾时 EOF 不强制结算', () => {
    const calculator = new MitigationCalculator()
    const damageEvents = [
      mkDmg('p1', 5, 'partial_aoe', 20000),
      mkDmg('p2', 10, 'partial_aoe', 30000),
    ]
    const out = calculator.simulate({
      castEvents: [],
      damageEvents,
      initialState: baseInitialState,
      baseReferenceMaxHPForAoe: 100000,
    })
    expect(out.damageResults.get('p2')!.hpSimulation!.hpAfter).toBe(70000)
  })
})

const MAX_HP_BUFF_ID = 999700

const mkMaxHpMeta = (multiplier: number, isTankOnly = false): MitigationStatusMetadata =>
  ({
    id: MAX_HP_BUFF_ID,
    name: 'mock-maxhp',
    type: 'multiplier',
    performance: { physics: 1, magic: 1, darkness: 1, maxHP: multiplier },
    isFriendly: true,
    isTankOnly,
  }) as MitigationStatusMetadata

describe('HP 池 - maxHP buff 同步伸缩', () => {
  it('initialState 已挂 +10% maxHP buff：hp.max=110k、hp.current=110k', () => {
    const spy = vi
      .spyOn(registry, 'getStatusById')
      .mockImplementation(id => (id === MAX_HP_BUFF_ID ? mkMaxHpMeta(1.1) : undefined))
    try {
      const calculator = new MitigationCalculator()
      const initialState: PartyState = {
        statuses: [
          {
            instanceId: 'maxhp',
            statusId: MAX_HP_BUFF_ID,
            startTime: 0,
            endTime: 60,
            sourcePlayerId: 1,
          },
        ],
        timestamp: 0,
      }
      const out = calculator.simulate({
        castEvents: [],
        damageEvents: [mkDmg('A', 10, 'aoe', 20000)],
        initialState,
        baseReferenceMaxHPForAoe: 100000,
      })
      const r = out.damageResults.get('A')!.hpSimulation!
      expect(r.hpMax).toBe(110000)
      expect(r.hpBefore).toBe(110000)
      expect(r.hpAfter).toBe(90000)
    } finally {
      spy.mockRestore()
    }
  })

  it('isTankOnly maxHP buff 永远不抬升非坦池上限', () => {
    const spy = vi
      .spyOn(registry, 'getStatusById')
      .mockImplementation(id => (id === MAX_HP_BUFF_ID ? mkMaxHpMeta(1.1, true) : undefined))
    try {
      const calculator = new MitigationCalculator()
      const initialState: PartyState = {
        statuses: [
          {
            instanceId: 'maxhp-tank',
            statusId: MAX_HP_BUFF_ID,
            startTime: 0,
            endTime: 60,
            sourcePlayerId: 1,
          },
        ],
        timestamp: 0,
      }
      const out = calculator.simulate({
        castEvents: [],
        damageEvents: [mkDmg('A', 10, 'aoe', 20000)],
        initialState,
        baseReferenceMaxHPForAoe: 100000,
      })
      const r = out.damageResults.get('A')!.hpSimulation!
      expect(r.hpMax).toBe(100000)
      expect(r.hpAfter).toBe(80000)
    } finally {
      spy.mockRestore()
    }
  })

  it('maxHP buff 在事件之间 expire：hp.max 还原、hp.current 按比例回缩', () => {
    const spy = vi
      .spyOn(registry, 'getStatusById')
      .mockImplementation(id => (id === MAX_HP_BUFF_ID ? mkMaxHpMeta(1.1) : undefined))
    try {
      const calculator = new MitigationCalculator()
      const initialState: PartyState = {
        statuses: [
          {
            instanceId: 'maxhp',
            statusId: MAX_HP_BUFF_ID,
            startTime: 0,
            endTime: 15,
            sourcePlayerId: 1,
          },
        ],
        timestamp: 0,
      }
      const out = calculator.simulate({
        castEvents: [],
        damageEvents: [mkDmg('A', 10, 'aoe', 20000), mkDmg('B', 20, 'aoe', 20000)],
        initialState,
        baseReferenceMaxHPForAoe: 100000,
      })
      expect(out.damageResults.get('A')!.hpSimulation!.hpAfter).toBe(90000)
      const rB = out.damageResults.get('B')!.hpSimulation!
      expect(rB.hpMax).toBe(100000)
      expect(rB.hpAfter).toBeCloseTo(61818.18, 1)
    } finally {
      spy.mockRestore()
    }
  })
})
