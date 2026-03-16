/**
 * 减伤计算器测试（基于状态）
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MitigationCalculator } from './mitigationCalculator'
import type { PartyState } from '@/types/partyState'
import type { StatusEvent } from '@/types/timeline'

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

      const result = calculator.calculate(100000, partyState, 10, 'magical')

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

      const result = calculator.calculate(10000, partyState, 10, 'physical')

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

      const result = calculator.calculate(10000, partyState, 10, 'physical')

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

      const result = calculator.calculate(10000, partyState, 10, 'physical')

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

      const result = calculator.calculate(10000, partyState, 10, 'physical')

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
          },
        ],
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical')

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
          },
        ],
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical')

      expect(result.finalDamage).toBe(7000)
      expect(result.mitigationPercentage).toBe(30)
    })

    it('应该正确处理百分比减伤 + 盾值', () => {
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
            statusId: 297,
            startTime: 0,
            endTime: 30,
            remainingBarrier: 2000,
          },
        ],
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical')

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
          },
          {
            instanceId: 'test-2',
            statusId: 2613,
            startTime: 0,
            endTime: 15,
            remainingBarrier: 4000,
          },
        ],
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical')

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
          },
        ],
      }

      const result = calculator.calculate(10000, partyState, 10, 'physical')

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
          },
          {
            instanceId: 'shield-1',
            statusId: 2613, // 野战治疗阵
            startTime: 5,
            endTime: 35,
            remainingBarrier: 2000,
          },
          {
            instanceId: 'shield-2',
            statusId: 1918, // 士气高扬之策
            startTime: 10,
            endTime: 40,
            remainingBarrier: 2500,
          },
        ],
      }

      const result = calculator.calculate(10000, partyState, 20, 'physical')

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
          },
          {
            instanceId: 'shield-1',
            statusId: 2613,
            startTime: 5,
            endTime: 35,
            remainingBarrier: 3000,
          },
        ],
      }

      const result = calculator.calculate(5000, partyState, 15, 'physical')

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

      const result = calculator.calculate(10000, partyState, 10, 'physical')

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

      const result = calculator.calculate(10000, partyState, 30, 'physical')

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

      const result = calculator.calculate(10000, partyState, 10, 'physical')

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

      const result = calculator.calculate(10000, partyState, 10, 'magical')

      expect(result.finalDamage).toBe(9500)
    })
  })

  describe('getActiveStatusesAtTime', () => {
    it('应该返回指定时间点所有生效的状态', () => {
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
            startTime: 25,
            endTime: 50,
          },
          {
            instanceId: 'test-3',
            statusId: 1193,
            startTime: 0,
            endTime: 15,
          },
        ],
      }

      const activeStatuses = calculator.getActiveStatusesAtTime(partyState, 10)

      expect(activeStatuses).toHaveLength(2)
      expect(activeStatuses.map(s => s.statusId)).toContain(1191)
      expect(activeStatuses.map(s => s.statusId)).toContain(1193)
    })
  })

  describe('MitigationCalculator.calculateFromSnapshot', () => {
    it('should calculate damage from status snapshot', () => {
      const calculator = new MitigationCalculator()

      const statusEvents: StatusEvent[] = [
        {
          statusId: 1193, // 雪仇 10% 减伤
          startTime: 0,
          endTime: 15,
          targetPlayerId: 1,
          packetId: 100,
        },
        {
          statusId: 1174, // 干预 10% 减伤
          startTime: 0,
          endTime: 30,
          targetPlayerId: 1,
          packetId: 100,
        },
      ]

      const result = calculator.calculateFromSnapshot(10000, statusEvents, 100, 'physical', 1)

      expect(result.finalDamage).toBe(8100) // 10000 * 0.9 * 0.9
      expect(result.appliedStatuses).toHaveLength(2)
      expect(result.updatedPartyState).toBeUndefined()
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

      const result = calculator.calculate(10000, partyState, 10, 'physical')

      expect(result.finalDamage).toBe(7650) // 10000 * 0.9 * 0.85
      expect(result.appliedStatuses).toHaveLength(2)
      expect(result.updatedPartyState).toBeDefined()
    })
  })

  describe('calculateFromSnapshot - 盾值消耗顺序', () => {
    it('应该按 startTime 顺序消耗盾值（即使 statusEvents 顺序不同）', () => {
      // 模拟 FFLogs 数据：statusEvents 顺序与 startTime 不一致
      const statusEvents: StatusEvent[] = [
        {
          statusId: 1191, // 雪仇 20% 减伤
          startTime: 0,
          endTime: 20,
          targetPlayerId: 1,
          packetId: 100,
        },
        {
          statusId: 297, // 鼓舞盾
          startTime: 5, // 后施放
          endTime: 35,
          targetPlayerId: 1,
          packetId: 100,
          absorb: 2000,
        },
        {
          statusId: 297, // 鼓舞盾
          startTime: 2, // 先施放
          endTime: 32,
          targetPlayerId: 1,
          packetId: 100,
          absorb: 1000,
        },
      ]

      const result = calculator.calculateFromSnapshot(10000, statusEvents, 100, 'physical', 1)

      // 计算过程：
      // 1. 百分比减伤：10000 * 0.8 = 8000
      // 2. 盾值消耗（按 startTime 排序）：
      //    - 先消耗 startTime=2 的盾：8000 - 1000 = 7000
      //    - 再消耗 startTime=5 的盾：7000 - 2000 = 5000
      expect(result.finalDamage).toBe(5000)
      expect(result.appliedStatuses).toHaveLength(3) // 1 个减伤 + 2 个盾
    })

    it('应该在盾值完全吸收伤害后停止消耗', () => {
      const statusEvents: StatusEvent[] = [
        {
          statusId: 297, // 鼓舞盾
          startTime: 5,
          endTime: 35,
          targetPlayerId: 1,
          packetId: 100,
          absorb: 3000,
        },
        {
          statusId: 297, // 鼓舞盾
          startTime: 2,
          endTime: 32,
          targetPlayerId: 1,
          packetId: 100,
          absorb: 10000, // 足够吸收所有伤害
        },
      ]

      const result = calculator.calculateFromSnapshot(5000, statusEvents, 100, 'physical', 1)

      // startTime=2 的盾先消耗，完全吸收伤害
      expect(result.finalDamage).toBe(0)
      expect(result.appliedStatuses).toHaveLength(1) // 只消耗了第一个盾
    })
  })
})
