/**
 * 减伤计算器测试（基于状态）
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MitigationCalculator } from './mitigationCalculator'
import type { PartyState } from '@/types/partyState'
import type { DamageEvent, DamageEventType, DamageType } from '@/types/timeline'
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

  it('第一坦 state 持久化：OT 分支盾消耗不写回 updatedPartyState', () => {
    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation((id: number) => {
      if (id === 8888) {
        return {
          id: 8888,
          name: 'mock-shield',
          type: 'absorbed',
          performance: { physics: 1, magic: 1, darkness: 1 },
          isFriendly: true,
          isTankOnly: true,
          category: ['self', 'target', 'shield'],
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
            sourcePlayerId: 2,
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
      expect(result.perVictim![0].finalDamage).toBe(0)
      expect(result.perVictim![1].finalDamage).toBe(0)
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

  it('partywide 盾在坦专事件下被第一坦分支消耗', () => {
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
      expect(result.perVictim![0].finalDamage).toBe(0)
      expect(result.perVictim![1].finalDamage).toBe(0)
      const persisted = result.updatedPartyState!.statuses.find(s => s.instanceId === 'ps-1')
      expect(persisted?.remainingBarrier).toBe(2000)
    } finally {
      spy.mockRestore()
    }
  })
})
