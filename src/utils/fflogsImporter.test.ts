/**
 * FFLogs 导入工具测试
 */

import { describe, it, expect } from 'vitest'
import { parseFFLogsUrl } from './fflogsParser'
import {
  parseCastEventsFromFFLogs,
  parseStatusEvents,
  parseDamageEvents,
} from './fflogsImporter'
import type { FFLogsAbility } from '@/types/fflogs'
import type { DamageEvent } from '@/types/timeline'

type V2Actor = { id: number; name: string; type: string }

describe('parseFFLogsUrl', () => {
  describe('完整 URL 格式', () => {
    it('应该解析带 #fight 的完整 URL', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123#fight=5')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 5,
        isLastFight: false,
      })
    })

    it('应该解析带 ?fight 的完整 URL', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123?fight=5')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 5,
        isLastFight: false,
      })
    })

    it('应该解析中文站点 URL', () => {
      const result = parseFFLogsUrl('https://zh.fflogs.com/reports/ABC123#fight=10')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 10,
        isLastFight: false,
      })
    })

    it('应该解析不带 fight 参数的 URL', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
        isLastFight: false,
      })
    })

    it('应该解析带其他查询参数的 URL', () => {
      const result = parseFFLogsUrl(
        'https://www.fflogs.com/reports/ABC123?translate=true&fight=3'
      )
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 3,
        isLastFight: false,
      })
    })

    it('应该解析 fight=last 的完整 URL', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123#fight=last')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
        isLastFight: true,
      })
    })

    it('应该解析 ?fight=last 的完整 URL', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123?fight=last')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
        isLastFight: true,
      })
    })
  })

  describe('简短格式', () => {
    it('应该解析纯报告代码', () => {
      const result = parseFFLogsUrl('ABC123')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
        isLastFight: false,
      })
    })

    it('应该解析报告代码 + #fight', () => {
      const result = parseFFLogsUrl('ABC123#fight=5')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 5,
        isLastFight: false,
      })
    })

    it('应该解析报告代码 + ?fight', () => {
      const result = parseFFLogsUrl('ABC123?fight=5')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 5,
        isLastFight: false,
      })
    })

    it('应该解析报告代码 + #fight=last', () => {
      const result = parseFFLogsUrl('ABC123#fight=last')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
        isLastFight: true,
      })
    })
  })

  describe('错误处理', () => {
    it('应该处理空字符串', () => {
      const result = parseFFLogsUrl('')
      expect(result).toEqual({
        reportCode: null,
        fightId: null,
        isLastFight: false,
      })
    })

    it('应该处理无效 URL', () => {
      const result = parseFFLogsUrl('not-a-valid-url')
      expect(result).toEqual({
        reportCode: null,
        fightId: null,
        isLastFight: false,
      })
    })

    it('应该处理无效的 fight 参数', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123#fight=abc')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
        isLastFight: false,
      })
    })
  })

  describe('实际案例', () => {
    it('应该解析真实的 FFLogs URL', () => {
      const result = parseFFLogsUrl(
        'https://www.fflogs.com/reports/a:1234567890abcdef#fight=12&type=damage-done'
      )
      expect(result.reportCode).toBeTruthy()
      expect(result.fightId).toBe(12)
      expect(result.isLastFight).toBe(false)
    })
  })
})

describe('parseCastEventsFromFFLogs', () => {
  const mockPlayerMap = new Map<number, V2Actor>([
    [1, { id: 1, name: 'Tank', type: 'Paladin' }],
    [2, { id: 2, name: 'Healer', type: 'WhiteMage' }],
  ])

  const fightStartTime = 1000000

  it('应该只保留有效的减伤技能', () => {
    const events = [
      // 有效技能：雪仇 (7535)
      { type: 'cast', abilityGameID: 7535, sourceID: 1, timestamp: fightStartTime + 5000 },
      // 无效技能：随机技能 ID
      { type: 'cast', abilityGameID: 99999, sourceID: 1, timestamp: fightStartTime + 10000 },
      // 有效技能：节制 (16536)
      { type: 'cast', abilityGameID: 16536, sourceID: 2, timestamp: fightStartTime + 15000 },
    ]

    const result = parseCastEventsFromFFLogs(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(2)
    expect(result[0].actionId).toBe(7535)
    expect(result[1].actionId).toBe(16536)
  })

  it('应该过滤掉非友方技能（sourceID 不在 playerMap 中）', () => {
    const events = [
      { type: 'cast', abilityGameID: 7535, sourceID: 999, timestamp: fightStartTime + 5000 },
    ]

    const result = parseCastEventsFromFFLogs(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(0)
  })

  it('应该过滤掉未知玩家的技能', () => {
    const events = [
      { type: 'cast', abilityGameID: 7535, sourceID: 999, timestamp: fightStartTime + 5000 },
    ]

    const result = parseCastEventsFromFFLogs(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(0)
  })

  it('应该正确计算相对时间（秒）', () => {
    const events = [
      { type: 'cast', abilityGameID: 7535, sourceID: 1, timestamp: fightStartTime + 5000 },
    ]

    const result = parseCastEventsFromFFLogs(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(1)
    expect(result[0].timestamp).toBe(5)
  })
})

describe('parseStatusEvents', () => {
  const fightStartTime = 1000000

  it('应该使用 duration 字段计算 endTime', () => {
    const events = [
      {
        type: 'applybuff',
        abilityGameID: 1007535, // statusId = 7535
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 5000,
        duration: 15000, // 15 秒
      },
    ]

    const result = parseStatusEvents(events, fightStartTime)
    expect(result).toHaveLength(1)
    expect(result[0].statusId).toBe(7535)
    expect(result[0].startTime).toBe(5)
    expect(result[0].endTime).toBe(20)
  })

  it('应该在没有 duration 时使用默认 30 秒', () => {
    const events = [
      {
        type: 'applybuff',
        abilityGameID: 1007535,
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 5000,
      },
    ]

    const result = parseStatusEvents(events, fightStartTime)
    expect(result).toHaveLength(1)
    expect(result[0].statusId).toBe(7535)
    expect(result[0].startTime).toBe(5)
    expect(result[0].endTime).toBe(35)
  })

  it('应该处理多个相同状态的事件', () => {
    const events = [
      {
        type: 'applybuff',
        abilityGameID: 1007535,
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 5000,
        duration: 15000,
      },
      {
        type: 'applybuff',
        abilityGameID: 1007535,
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 30000,
        duration: 15000,
      },
    ]

    const result = parseStatusEvents(events, fightStartTime)
    expect(result).toHaveLength(2)
    expect(result[0].startTime).toBe(5)
    expect(result[0].endTime).toBe(20)
    expect(result[1].startTime).toBe(30)
    expect(result[1].endTime).toBe(45)
  })

  it('应该处理 applydebuff 事件', () => {
    const events = [
      {
        type: 'applydebuff',
        abilityGameID: 1007535,
        sourceID: 1,
        targetID: 999,
        targetInstance: 1,
        timestamp: fightStartTime + 5000,
        duration: 15000,
      },
    ]

    const result = parseStatusEvents(events, fightStartTime)
    expect(result).toHaveLength(1)
    expect(result[0].statusId).toBe(7535)
    expect(result[0].startTime).toBe(5)
    expect(result[0].endTime).toBe(20)
  })

  it('应该过滤掉非状态事件', () => {
    const events = [
      { type: 'cast', abilityGameID: 1007535, sourceID: 1, timestamp: fightStartTime + 5000 },
      { type: 'damage', abilityGameID: 1007535, sourceID: 1, timestamp: fightStartTime + 5000 },
    ]

    const result = parseStatusEvents(events, fightStartTime)
    expect(result).toHaveLength(0)
  })

  it('应该过滤掉没有 abilityGameID 的事件', () => {
    const events = [
      { type: 'applybuff', sourceID: 1, targetID: 2, targetInstance: 1, timestamp: fightStartTime + 5000 },
    ]

    const result = parseStatusEvents(events, fightStartTime)
    expect(result).toHaveLength(0)
  })

  it('应该解析盾值（absorb）字段', () => {
    const events = [
      {
        type: 'applybuff',
        abilityGameID: 1007535,
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 5000,
        duration: 15000,
        absorb: 15000,
      },
    ]

    const result = parseStatusEvents(events, fightStartTime)
    expect(result).toHaveLength(1)
    expect(result[0].statusId).toBe(7535)
    expect(result[0].absorb).toBe(15000)
  })
})

describe('parseDamageEvents', () => {
  const fightStartTime = 1000000

  const makeAbilityMap = (id: number, name: string, type: number): Map<number, FFLogsAbility> =>
    new Map([[id, { gameID: id, name, type }]])

  it('应该解析基本伤害事件', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
      [3, { id: 3, name: 'DPS1', type: 'Samurai' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Test Attack', 1024)

    const events = [
      { type: 'damage', packetID: 1, abilityGameID: 999999, targetID: 1, unmitigatedAmount: 10000, absorbed: 0, amount: 10000, timestamp: fightStartTime + 5000, sourceID: 999 },
      { type: 'damage', packetID: 1, abilityGameID: 999999, targetID: 2, unmitigatedAmount: 12000, absorbed: 0, amount: 12000, timestamp: fightStartTime + 5000, sourceID: 999 },
      { type: 'damage', packetID: 1, abilityGameID: 999999, targetID: 3, unmitigatedAmount: 11000, absorbed: 0, amount: 11000, timestamp: fightStartTime + 5000, sourceID: 999 },
    ]

    const result = parseDamageEvents(events, fightStartTime, playerMap, abilityMap)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Test Attack')
    expect(result[0].time).toBe(5)
    expect(result[0].damageType).toBe('magical')
    expect(result[0].playerDamageDetails).toHaveLength(3)
  })

  it('应该使用非坦克玩家的平均伤害', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
      [3, { id: 3, name: 'DPS1', type: 'Samurai' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Test Attack', 1024)

    const events = [
      { type: 'damage', packetID: 1, abilityGameID: 999999, targetID: 1, unmitigatedAmount: 5000, absorbed: 0, amount: 5000, timestamp: fightStartTime + 5000, sourceID: 999 },
      { type: 'damage', packetID: 1, abilityGameID: 999999, targetID: 2, unmitigatedAmount: 10000, absorbed: 0, amount: 10000, timestamp: fightStartTime + 5000, sourceID: 999 },
      { type: 'damage', packetID: 1, abilityGameID: 999999, targetID: 3, unmitigatedAmount: 12000, absorbed: 0, amount: 12000, timestamp: fightStartTime + 5000, sourceID: 999 },
    ]

    const result = parseDamageEvents(events, fightStartTime, playerMap, abilityMap)
    expect(result).toHaveLength(1)
    expect(result[0].damage).toBe(11000) // (10000 + 12000) / 2
  })

  it('应该在只有坦克时使用所有玩家的平均伤害', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Tank2', type: 'Warrior' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Tankbuster', 128)

    const events = [
      { type: 'damage', packetID: 1, abilityGameID: 999999, targetID: 1, unmitigatedAmount: 20000, absorbed: 0, amount: 20000, timestamp: fightStartTime + 5000, sourceID: 999 },
      { type: 'damage', packetID: 1, abilityGameID: 999999, targetID: 2, unmitigatedAmount: 18000, absorbed: 0, amount: 18000, timestamp: fightStartTime + 5000, sourceID: 999 },
    ]

    const result = parseDamageEvents(events, fightStartTime, playerMap, abilityMap)
    expect(result).toHaveLength(1)
    expect(result[0].damage).toBe(19000) // (20000 + 18000) / 2
    expect(result[0].damageType).toBe('physical')
  })

  it('应该记录每个玩家的详细伤害信息', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Test Attack', 1024)

    const events = [
      { type: 'damage', packetID: 1, abilityGameID: 999999, targetID: 1, unmitigatedAmount: 10000, absorbed: 500, amount: 9500, timestamp: fightStartTime + 5000, sourceID: 999 },
      { type: 'damage', packetID: 1, abilityGameID: 999999, targetID: 2, unmitigatedAmount: 12000, absorbed: 0, amount: 12000, timestamp: fightStartTime + 5000, sourceID: 999 },
    ]

    const result = parseDamageEvents(events, fightStartTime, playerMap, abilityMap)
    expect(result).toHaveLength(1)
    expect(result[0].playerDamageDetails).toHaveLength(2)
    const tankDetail = result[0].playerDamageDetails?.find((d) => d.playerId === 1)
    expect(tankDetail?.absorbedDamage).toBe(500)
    expect(tankDetail?.finalDamage).toBe(9500)
  })

  it('应该过滤掉普通攻击', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
    ])
    const abilityMap = makeAbilityMap(1, 'Attack', 128)

    const events = [
      { type: 'damage', packetID: 1, abilityGameID: 1, targetID: 1, unmitigatedAmount: 10000, absorbed: 0, amount: 10000, timestamp: fightStartTime + 5000, sourceID: 999 },
    ]

    const result = parseDamageEvents(events, fightStartTime, playerMap, abilityMap)
    expect(result).toHaveLength(0)
  })

  it('应该过滤掉低伤害技能', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
    ])
    const abilityMap = makeAbilityMap(12345, 'Weak Attack', 1024)

    const events = [
      { type: 'damage', packetID: 1, abilityGameID: 12345, targetID: 1, unmitigatedAmount: 5000, absorbed: 0, amount: 5000, timestamp: fightStartTime + 5000, sourceID: 999 },
    ]

    const result = parseDamageEvents(events, fightStartTime, playerMap, abilityMap)
    expect(result).toHaveLength(0)
  })
})
