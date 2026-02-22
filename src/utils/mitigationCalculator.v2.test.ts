/**
 * 减伤计算器测试（新版本 - 基于状态）
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MitigationCalculatorV2 } from './mitigationCalculator.v2'
import type { PartyState } from '@/types/partyState'

describe('MitigationCalculatorV2', () => {
  let calculator: MitigationCalculatorV2
  let basePartyState: PartyState

  beforeEach(() => {
    calculator = new MitigationCalculatorV2()
    basePartyState = {
      players: [
        {
          id: 1,
          job: 'PLD',
          currentHP: 50000,
          maxHP: 100000,
          statuses: [],
        },
        {
          id: 2,
          job: 'WHM',
          currentHP: 40000,
          maxHP: 80000,
          statuses: [],
        },
      ],
      enemy: {
        statuses: [],
      },
      timestamp: 0,
    }
  })

  describe('百分比减伤计算', () => {
    it('应该正确计算节制的 10% 减伤', () => {
      const partyState: PartyState = {
        ...basePartyState,
        players: [
          {
            ...basePartyState.players[1], // WHM
            statuses: [
              {
                instanceId: 'test-temperance',
                statusId: 1873, // 节制 (10% 减伤)
                startTime: 0,
                endTime: 25,
                sourceActionId: 16536,
                sourcePlayerId: 2,
              },
            ],
          },
        ],
      }

      const result = calculator.calculate(100000, partyState, 10, 'magical')

      expect(result.originalDamage).toBe(100000)
      expect(result.finalDamage).toBe(90000) // 100000 * 0.9 = 90000
      expect(result.mitigationPercentage).toBe(10)
      expect(result.appliedStatuses).toHaveLength(1)
    })

    it('应该正确计算单个友方减伤', () => {
      const partyState: PartyState = {
        ...basePartyState,
        players: [
          {
            ...basePartyState.players[0],
            statuses: [
              {
                instanceId: 'test-1',
                statusId: 1191, // 铁壁 (20% 减伤)
                startTime: 0,
                endTime: 20,
              },
            ],
          },
          basePartyState.players[1],
        ],
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical', 1)

      // 10000 * 0.8 = 8000
      expect(result.finalDamage).toBe(8000)
      expect(result.mitigationPercentage).toBe(20)
      expect(result.appliedStatuses).toHaveLength(1)
    })

    it('应该正确计算多个友方减伤（乘算）', () => {
      const partyState: PartyState = {
        ...basePartyState,
        players: [
          {
            ...basePartyState.players[0],
            statuses: [
              {
                instanceId: 'test-1',
                statusId: 1191, // 铁壁 (20% 减伤)
                startTime: 0,
                endTime: 20,
              },
              {
                instanceId: 'test-2',
                statusId: 1873, // 节制 (10% 减伤)
                startTime: 0,
                endTime: 25,
              },
            ],
          },
          basePartyState.players[1],
        ],
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical', 1)

      // 10000 * 0.8 * 0.9 = 7200
      expect(result.finalDamage).toBe(7200)
      expect(result.mitigationPercentage).toBe(28)
      expect(result.appliedStatuses).toHaveLength(2)
    })

    it('应该正确计算敌方 Debuff', () => {
      const partyState: PartyState = {
        ...basePartyState,
        enemy: {
          statuses: [
            {
              instanceId: 'test-1',
              statusId: 1193, // 雪仇 (10% 减伤)
              startTime: 0,
              endTime: 15,
            },
          ],
        },
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical', 1)

      // 10000 * 0.9 = 9000
      expect(result.finalDamage).toBe(9000)
      expect(result.mitigationPercentage).toBe(10)
      expect(result.appliedStatuses).toHaveLength(1)
    })

    it('应该正确计算友方减伤 + 敌方 Debuff', () => {
      const partyState: PartyState = {
        ...basePartyState,
        players: [
          {
            ...basePartyState.players[0],
            statuses: [
              {
                instanceId: 'test-1',
                statusId: 1191, // 铁壁 (20% 减伤)
                startTime: 0,
                endTime: 20,
              },
            ],
          },
          basePartyState.players[1],
        ],
        enemy: {
          statuses: [
            {
              instanceId: 'test-2',
              statusId: 1193, // 雪仇 (10% 减伤)
              startTime: 0,
              endTime: 15,
            },
          ],
        },
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical', 1)

      // 10000 * 0.8 * 0.9 = 7200
      expect(result.finalDamage).toBe(7200)
      expect(result.mitigationPercentage).toBe(28)
      expect(result.appliedStatuses).toHaveLength(2)
    })
  })

  describe('盾值减伤计算', () => {
    it('应该正确消耗盾值', () => {
      const partyState: PartyState = {
        ...basePartyState,
        players: [
          {
            ...basePartyState.players[0],
            statuses: [
              {
                instanceId: 'test-1',
                statusId: 297, // 鼓舞盾
                startTime: 0,
                endTime: 30,
                remainingBarrier: 5000,
              },
            ],
          },
          basePartyState.players[1],
        ],
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical', 1)

      // 10000 - 5000 = 5000
      expect(result.finalDamage).toBe(5000)
      expect(result.mitigationPercentage).toBe(50)
      expect(result.appliedStatuses).toHaveLength(1)

      // 检查盾值是否被消耗
      const updatedPlayer = result.updatedPartyState.players[0]
      expect(updatedPlayer.statuses[0].remainingBarrier).toBe(0)
    })

    it('应该正确处理盾值不足的情况', () => {
      const partyState: PartyState = {
        ...basePartyState,
        players: [
          {
            ...basePartyState.players[0],
            statuses: [
              {
                instanceId: 'test-1',
                statusId: 297, // 鼓舞盾
                startTime: 0,
                endTime: 30,
                remainingBarrier: 3000,
              },
            ],
          },
          basePartyState.players[1],
        ],
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical', 1)

      // 10000 - 3000 = 7000
      expect(result.finalDamage).toBe(7000)
      expect(result.mitigationPercentage).toBe(30)

      // 盾值应该耗尽
      const updatedPlayer = result.updatedPartyState.players[0]
      expect(updatedPlayer.statuses[0].remainingBarrier).toBe(0)
    })

    it('应该正确计算百分比减伤 + 盾值', () => {
      const partyState: PartyState = {
        ...basePartyState,
        players: [
          {
            ...basePartyState.players[0],
            statuses: [
              {
                instanceId: 'test-1',
                statusId: 1191, // 铁壁 (20% 减伤)
                startTime: 0,
                endTime: 20,
              },
              {
                instanceId: 'test-2',
                statusId: 297, // 鼓舞盾
                startTime: 0,
                endTime: 30,
                remainingBarrier: 2000,
              },
            ],
          },
          basePartyState.players[1],
        ],
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical', 1)

      // 10000 * 0.8 - 2000 = 6000
      expect(result.finalDamage).toBe(6000)
      expect(result.mitigationPercentage).toBe(40)
      expect(result.appliedStatuses).toHaveLength(2)
    })

    it('应该正确处理多个盾值', () => {
      const partyState: PartyState = {
        ...basePartyState,
        players: [
          {
            ...basePartyState.players[0],
            statuses: [
              {
                instanceId: 'test-1',
                statusId: 297, // 鼓舞盾
                startTime: 0,
                endTime: 30,
                remainingBarrier: 3000,
              },
              {
                instanceId: 'test-2',
                statusId: 2613, // 泛输血盾
                startTime: 0,
                endTime: 15,
                remainingBarrier: 4000,
              },
            ],
          },
          basePartyState.players[1],
        ],
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical', 1)

      // 10000 - 3000 - 4000 = 3000
      expect(result.finalDamage).toBe(3000)
      expect(result.mitigationPercentage).toBe(70)

      // 两个盾值都应该耗尽
      const updatedPlayer = result.updatedPartyState.players[0]
      expect(updatedPlayer.statuses[0].remainingBarrier).toBe(0)
      expect(updatedPlayer.statuses[1].remainingBarrier).toBe(0)
    })
  })

  describe('时间范围检查', () => {
    it('应该忽略未生效的状态', () => {
      const partyState: PartyState = {
        ...basePartyState,
        players: [
          {
            ...basePartyState.players[0],
            statuses: [
              {
                instanceId: 'test-1',
                statusId: 1191, // 铁壁
                startTime: 20, // 未来才生效
                endTime: 40,
              },
            ],
          },
          basePartyState.players[1],
        ],
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical', 1)

      // 没有减伤
      expect(result.finalDamage).toBe(10000)
      expect(result.mitigationPercentage).toBe(0)
      expect(result.appliedStatuses).toHaveLength(0)
    })

    it('应该忽略已过期的状态', () => {
      const partyState: PartyState = {
        ...basePartyState,
        players: [
          {
            ...basePartyState.players[0],
            statuses: [
              {
                instanceId: 'test-1',
                statusId: 1191, // 铁壁
                startTime: 0,
                endTime: 20, // 已过期
              },
            ],
          },
          basePartyState.players[1],
        ],
      }

      const result = calculator.calculate(10000, partyState, 30, 'physical', 1)

      // 没有减伤
      expect(result.finalDamage).toBe(10000)
      expect(result.mitigationPercentage).toBe(0)
      expect(result.appliedStatuses).toHaveLength(0)
    })
  })

  describe('伤害类型', () => {
    it('应该正确处理物理伤害', () => {
      const partyState: PartyState = {
        ...basePartyState,
        enemy: {
          statuses: [
            {
              instanceId: 'test-1',
              statusId: 1195, // 牵制 (物理 10%, 魔法 5%)
              startTime: 0,
              endTime: 15,
            },
          ],
        },
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical', 1)

      // 10000 * 0.9 = 9000 (物理减伤 10%)
      expect(result.finalDamage).toBe(9000)
    })

    it('应该正确处理魔法伤害', () => {
      const partyState: PartyState = {
        ...basePartyState,
        enemy: {
          statuses: [
            {
              instanceId: 'test-1',
              statusId: 1195, // 牵制 (物理 10%, 魔法 5%)
              startTime: 0,
              endTime: 15,
            },
          ],
        },
      }

      const result = calculator.calculate(10000, partyState, 10, 'magical', 1)

      // 10000 * 0.95 = 9500 (魔法减伤 5%)
      expect(result.finalDamage).toBe(9500)
    })
  })

  describe('getActiveStatusesAtTime', () => {
    it('应该返回指定时间点所有生效的状态', () => {
      const partyState: PartyState = {
        ...basePartyState,
        players: [
          {
            ...basePartyState.players[0],
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
                startTime: 25, // 未生效
                endTime: 50,
              },
            ],
          },
          basePartyState.players[1],
        ],
        enemy: {
          statuses: [
            {
              instanceId: 'test-3',
              statusId: 1193,
              startTime: 0,
              endTime: 15,
            },
          ],
        },
      }

      const activeStatuses = calculator.getActiveStatusesAtTime(partyState, 10)

      expect(activeStatuses).toHaveLength(2) // 铁壁 + 雪仇
      expect(activeStatuses.map((s) => s.statusId)).toContain(1191)
      expect(activeStatuses.map((s) => s.statusId)).toContain(1193)
    })
  })

  describe('AOE 伤害盾值去重', () => {
    it('AOE 伤害时相同盾值状态不应该被重复计算', () => {
      // 两个玩家都有相同的泛输血盾
      const partyState: PartyState = {
        ...basePartyState,
        players: [
          {
            ...basePartyState.players[0],
            statuses: [
              {
                instanceId: 'shield-1',
                statusId: 2613, // 泛输血盾
                startTime: 0,
                endTime: 15,
                remainingBarrier: 5000,
              },
            ],
          },
          {
            ...basePartyState.players[1],
            statuses: [
              {
                instanceId: 'shield-2',
                statusId: 2613, // 泛输血盾（相同状态 ID）
                startTime: 0,
                endTime: 15,
                remainingBarrier: 5000,
              },
            ],
          },
        ],
      }

      // AOE 伤害（没有指定 targetPlayerId）
      const result = calculator.calculate(10000, partyState, 10, 'physical')

      // 应该只消耗一次盾值：10000 - 5000 = 5000
      expect(result.finalDamage).toBe(5000)
      expect(result.mitigationPercentage).toBe(50)
      // 只应用一个盾值状态
      expect(result.appliedStatuses.filter((s) => s.statusId === 2613)).toHaveLength(1)
    })

    it('单体伤害时应该消耗目标玩家的盾值', () => {
      // 两个玩家都有相同的泛输血盾
      const partyState: PartyState = {
        ...basePartyState,
        players: [
          {
            ...basePartyState.players[0],
            statuses: [
              {
                instanceId: 'shield-1',
                statusId: 2613, // 泛输血盾
                startTime: 0,
                endTime: 15,
                remainingBarrier: 5000,
              },
            ],
          },
          {
            ...basePartyState.players[1],
            statuses: [
              {
                instanceId: 'shield-2',
                statusId: 2613, // 泛输血盾（相同状态 ID）
                startTime: 0,
                endTime: 15,
                remainingBarrier: 5000,
              },
            ],
          },
        ],
      }

      // 单体伤害（指定 targetPlayerId = 1）
      const result = calculator.calculate(10000, partyState, 10, 'physical', 1)

      // 应该消耗目标玩家的盾值：10000 - 5000 = 5000
      expect(result.finalDamage).toBe(5000)
      expect(result.mitigationPercentage).toBe(50)
      // 只应用目标玩家的盾值状态
      expect(result.appliedStatuses.filter((s) => s.statusId === 2613)).toHaveLength(1)
      expect(result.appliedStatuses[0].instanceId).toBe('shield-1')
    })
  })
})
