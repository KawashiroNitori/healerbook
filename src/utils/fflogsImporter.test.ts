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
import type { FFLogsV1Actor } from '@/types/fflogs'
import type { DamageEvent } from '@/types/timeline'

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
  const mockPlayerMap = new Map<number, FFLogsV1Actor>([
    [1, { id: 1, name: 'Tank', type: 'Paladin', fights: [] }],
    [2, { id: 2, name: 'Healer', type: 'WhiteMage', fights: [] }],
  ])

  const fightStartTime = 1000000

  it('应该只保留有效的减伤技能', () => {
    const events = [
      // 有效技能：雪仇 (7535)
      {
        type: 'cast',
        ability: { guid: 7535 },
        sourceID: 1,
        sourceIsFriendly: true,
        timestamp: fightStartTime + 5000,
      },
      // 无效技能：随机技能 ID
      {
        type: 'cast',
        ability: { guid: 99999 },
        sourceID: 1,
        sourceIsFriendly: true,
        timestamp: fightStartTime + 10000,
      },
      // 有效技能：节制 (16536)
      {
        type: 'cast',
        ability: { guid: 16536 },
        sourceID: 2,
        sourceIsFriendly: true,
        timestamp: fightStartTime + 15000,
      },
    ]

    const damageEvents: DamageEvent[] = []

    const result = parseCastEventsFromFFLogs(events, fightStartTime, mockPlayerMap, damageEvents)

    // 应该只有 2 个有效技能
    expect(result).toHaveLength(2)
    expect(result[0].actionId).toBe(7535) // 雪仇
    expect(result[1].actionId).toBe(16536) // 节制
  })

  it('应该过滤掉非友方技能', () => {
    const events = [
      {
        type: 'cast',
        ability: { guid: 7535 },
        sourceID: 1,
        sourceIsFriendly: false, // 敌方
        timestamp: fightStartTime + 5000,
      },
    ]

    const damageEvents: DamageEvent[] = []

    const result = parseCastEventsFromFFLogs(events, fightStartTime, mockPlayerMap, damageEvents)
    expect(result).toHaveLength(0)
  })

  it('应该过滤掉未知玩家的技能', () => {
    const events = [
      {
        type: 'cast',
        ability: { guid: 7535 },
        sourceID: 999, // 不存在的玩家
        sourceIsFriendly: true,
        timestamp: fightStartTime + 5000,
      },
    ]

    const damageEvents: DamageEvent[] = []

    const result = parseCastEventsFromFFLogs(events, fightStartTime, mockPlayerMap, damageEvents)
    expect(result).toHaveLength(0)
  })

  it('应该正确计算相对时间（秒）', () => {
    const events = [
      {
        type: 'cast',
        ability: { guid: 7535 },
        sourceID: 1,
        sourceIsFriendly: true,
        timestamp: fightStartTime + 5000, // 5 秒后
      },
    ]

    const damageEvents: DamageEvent[] = []

    const result = parseCastEventsFromFFLogs(events, fightStartTime, mockPlayerMap, damageEvents)
    expect(result).toHaveLength(1)
    expect(result[0].timestamp).toBe(5) // 秒
  })
})

describe('parseStatusEvents', () => {
  const fightStartTime = 1000000

  it('应该配对 applybuff 和 removebuff 事件', () => {
    const events = [
      {
        type: 'applybuff',
        ability: { guid: 1007535 },
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 5000,
      },
      {
        type: 'removebuff',
        ability: { guid: 1007535 },
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 20000,
      },
    ]

    const result = parseStatusEvents(events, fightStartTime)
    expect(result).toHaveLength(1)
    expect(result[0].statusId).toBe(7535)
    expect(result[0].startTime).toBe(5) // 秒
    expect(result[0].endTime).toBe(20) // 秒
  })

  it('应该处理没有 remove 事件的 apply 事件（使用默认持续时间）', () => {
    const events = [
      {
        type: 'applybuff',
        ability: { guid: 1007535 },
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 5000,
      },
    ]

    const result = parseStatusEvents(events, fightStartTime)
    expect(result).toHaveLength(1)
    expect(result[0].statusId).toBe(7535)
    expect(result[0].startTime).toBe(5) // 秒
    expect(result[0].endTime).toBe(35) // 默认 30 秒
  })

  it('应该处理多个相同状态的事件', () => {
    const events = [
      {
        type: 'applybuff',
        ability: { guid: 1007535 },
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 5000,
      },
      {
        type: 'removebuff',
        ability: { guid: 1007535 },
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 20000,
      },
      {
        type: 'applybuff',
        ability: { guid: 1007535 },
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 30000,
      },
      {
        type: 'removebuff',
        ability: { guid: 1007535 },
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 45000,
      },
    ]

    const result = parseStatusEvents(events, fightStartTime)
    expect(result).toHaveLength(2)
    expect(result[0].startTime).toBe(5) // 秒
    expect(result[0].endTime).toBe(20) // 秒
    expect(result[1].startTime).toBe(30) // 秒
    expect(result[1].endTime).toBe(45) // 秒
  })

  it('应该处理 applydebuff 和 removedebuff 事件', () => {
    const events = [
      {
        type: 'applydebuff',
        ability: { guid: 1007535 },
        sourceID: 1,
        targetID: 999, // 敌方
        targetInstance: 1,
        timestamp: fightStartTime + 5000,
      },
      {
        type: 'removedebuff',
        ability: { guid: 1007535 },
        sourceID: 1,
        targetID: 999,
        targetInstance: 1,
        timestamp: fightStartTime + 20000,
      },
    ]

    const result = parseStatusEvents(events, fightStartTime)
    expect(result).toHaveLength(1)
    expect(result[0].statusId).toBe(7535)
    expect(result[0].startTime).toBe(5) // 秒
    expect(result[0].endTime).toBe(20) // 秒
  })

  it('应该过滤掉非状态事件', () => {
    const events = [
      {
        type: 'cast',
        ability: { guid: 1007535 },
        sourceID: 1,
        timestamp: fightStartTime + 5000,
      },
      {
        type: 'damage',
        ability: { guid: 1007535 },
        sourceID: 1,
        timestamp: fightStartTime + 5000,
      },
    ]

    const result = parseStatusEvents(events, fightStartTime)
    expect(result).toHaveLength(0)
  })

  it('应该过滤掉没有 ability.guid 的事件', () => {
    const events = [
      {
        type: 'applybuff',
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 5000,
      },
      {
        type: 'applybuff',
        ability: {},
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 5000,
      },
    ]

    const result = parseStatusEvents(events, fightStartTime)
    expect(result).toHaveLength(0)
  })

  it('应该解析盾值（absorb）字段', () => {
    const events = [
      {
        type: 'applybuff',
        ability: { guid: 1007535 },
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 5000,
        absorb: 15000, // 盾值
      },
      {
        type: 'removebuff',
        ability: { guid: 1007535 },
        sourceID: 1,
        targetID: 2,
        targetInstance: 1,
        timestamp: fightStartTime + 20000,
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

  it('应该解析基本伤害事件', () => {
    const playerMap = new Map<number, FFLogsV1Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin', fights: [] }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage', fights: [] }],
      [3, { id: 3, name: 'DPS1', type: 'Samurai', fights: [] }],
    ])

    const events = [
      {
        type: 'damage',
        packetID: 1,
        ability: { guid: 999999, name: 'Test Attack', type: 1024 }, // 使用不存在的技能 ID
        targetIsFriendly: true,
        targetID: 1,
        unmitigatedAmount: 10000,
        absorbed: 0,
        amount: 10000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        ability: { guid: 999999, name: 'Test Attack', type: 1024 },
        targetIsFriendly: true,
        targetID: 2,
        unmitigatedAmount: 12000,
        absorbed: 0,
        amount: 12000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        ability: { guid: 999999, name: 'Test Attack', type: 1024 },
        targetIsFriendly: true,
        targetID: 3,
        unmitigatedAmount: 11000,
        absorbed: 0,
        amount: 11000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(events, fightStartTime, playerMap)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Test Attack')
    expect(result[0].time).toBe(5)
    expect(result[0].damageType).toBe('magical')
    expect(result[0].playerDamageDetails).toHaveLength(3)
  })

  it('应该使用非坦克玩家的平均伤害', () => {
    const playerMap = new Map<number, FFLogsV1Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin', fights: [] }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage', fights: [] }],
      [3, { id: 3, name: 'DPS1', type: 'Samurai', fights: [] }],
    ])

    const events = [
      {
        type: 'damage',
        packetID: 1,
        ability: { guid: 999999, name: 'Test Attack', type: 1024 },
        targetIsFriendly: true,
        targetID: 1,
        unmitigatedAmount: 5000, // 坦克受到较少伤害
        absorbed: 0,
        amount: 5000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        ability: { guid: 999999, name: 'Test Attack', type: 1024 },
        targetIsFriendly: true,
        targetID: 2,
        unmitigatedAmount: 10000, // 非坦克
        absorbed: 0,
        amount: 10000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        ability: { guid: 999999, name: 'Test Attack', type: 1024 },
        targetIsFriendly: true,
        targetID: 3,
        unmitigatedAmount: 12000, // 非坦克
        absorbed: 0,
        amount: 12000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(events, fightStartTime, playerMap)
    expect(result).toHaveLength(1)
    // 平均伤害应该是非坦克玩家的平均值: (10000 + 12000) / 2 = 11000
    expect(result[0].damage).toBe(11000)
  })

  it('应该在只有坦克时使用所有玩家的平均伤害', () => {
    const playerMap = new Map<number, FFLogsV1Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin', fights: [] }],
      [2, { id: 2, name: 'Tank2', type: 'Warrior', fights: [] }],
    ])

    const events = [
      {
        type: 'damage',
        packetID: 1,
        ability: { guid: 999999, name: 'Tankbuster', type: 128 },
        targetIsFriendly: true,
        targetID: 1,
        unmitigatedAmount: 20000,
        absorbed: 0,
        amount: 20000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        ability: { guid: 999999, name: 'Tankbuster', type: 128 },
        targetIsFriendly: true,
        targetID: 2,
        unmitigatedAmount: 18000,
        absorbed: 0,
        amount: 18000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(events, fightStartTime, playerMap)
    expect(result).toHaveLength(1)
    // 只有坦克，使用所有玩家的平均值: (20000 + 18000) / 2 = 19000
    expect(result[0].damage).toBe(19000)
    expect(result[0].damageType).toBe('physical')
  })

  it('应该记录每个玩家的详细伤害信息', () => {
    const playerMap = new Map<number, FFLogsV1Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin', fights: [] }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage', fights: [] }],
    ])

    const events = [
      {
        type: 'damage',
        packetID: 1,
        ability: { guid: 999999, name: 'Test Attack', type: 1024 },
        targetIsFriendly: true,
        targetID: 1,
        unmitigatedAmount: 10000,
        absorbed: 2000,
        amount: 8000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        ability: { guid: 999999, name: 'Test Attack', type: 1024 },
        targetIsFriendly: true,
        targetID: 2,
        unmitigatedAmount: 12000,
        absorbed: 1000,
        amount: 11000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(events, fightStartTime, playerMap)
    expect(result).toHaveLength(1)
    expect(result[0].playerDamageDetails).toHaveLength(2)

    const detail1 = result[0].playerDamageDetails![0]
    expect(detail1.playerId).toBe(1)
    expect(detail1.job).toBe('PLD')
    expect(detail1.unmitigatedDamage).toBe(10000)
    expect(detail1.absorbedDamage).toBe(2000)
    expect(detail1.finalDamage).toBe(8000)

    const detail2 = result[0].playerDamageDetails![1]
    expect(detail2.playerId).toBe(2)
    expect(detail2.job).toBe('WHM')
    expect(detail2.unmitigatedDamage).toBe(12000)
    expect(detail2.absorbedDamage).toBe(1000)
    expect(detail2.finalDamage).toBe(11000)
  })

  it('应该过滤掉普通攻击', () => {
    const playerMap = new Map<number, FFLogsV1Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin', fights: [] }],
    ])

    const events = [
      {
        type: 'damage',
        packetID: 1,
        ability: { guid: 1, name: 'Attack', type: 128 },
        targetIsFriendly: true,
        targetID: 1,
        unmitigatedAmount: 10000,
        absorbed: 0,
        amount: 10000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(events, fightStartTime, playerMap)
    expect(result).toHaveLength(0)
  })

  it('应该过滤掉低伤害技能', () => {
    const playerMap = new Map<number, FFLogsV1Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin', fights: [] }],
    ])

    const events = [
      {
        type: 'damage',
        packetID: 1,
        ability: { guid: 12345, name: 'Weak Attack', type: 1024 },
        targetIsFriendly: true,
        targetID: 1,
        unmitigatedAmount: 5000, // 低于 10000 阈值
        absorbed: 0,
        amount: 5000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(events, fightStartTime, playerMap)
    expect(result).toHaveLength(0)
  })
})
