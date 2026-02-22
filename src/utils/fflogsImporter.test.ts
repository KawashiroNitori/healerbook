/**
 * FFLogs 导入工具测试
 */

import { describe, it, expect } from 'vitest'
import { parseFFLogsUrl } from './fflogsParser'
import {
  parseCastEventsFromFFLogs,
  parseStatusEvents,
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
      })
    })

    it('应该解析带 ?fight 的完整 URL', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123?fight=5')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 5,
      })
    })

    it('应该解析中文站点 URL', () => {
      const result = parseFFLogsUrl('https://zh.fflogs.com/reports/ABC123#fight=10')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 10,
      })
    })

    it('应该解析不带 fight 参数的 URL', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
      })
    })

    it('应该解析带其他查询参数的 URL', () => {
      const result = parseFFLogsUrl(
        'https://www.fflogs.com/reports/ABC123?translate=true&fight=3'
      )
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 3,
      })
    })
  })

  describe('简短格式', () => {
    it('应该解析纯报告代码', () => {
      const result = parseFFLogsUrl('ABC123')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
      })
    })

    it('应该解析报告代码 + #fight', () => {
      const result = parseFFLogsUrl('ABC123#fight=5')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 5,
      })
    })

    it('应该解析报告代码 + ?fight', () => {
      const result = parseFFLogsUrl('ABC123?fight=5')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 5,
      })
    })
  })

  describe('错误处理', () => {
    it('应该处理空字符串', () => {
      const result = parseFFLogsUrl('')
      expect(result).toEqual({
        reportCode: null,
        fightId: null,
      })
    })

    it('应该处理无效 URL', () => {
      const result = parseFFLogsUrl('not-a-valid-url')
      expect(result).toEqual({
        reportCode: null,
        fightId: null,
      })
    })

    it('应该处理无效的 fight 参数', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123#fight=abc')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
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

  it('应该正确计算相对时间（毫秒）', () => {
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
    expect(result[0].timestamp).toBe(5000) // 毫秒
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
    expect(result[0].startTime).toBe(5000)
    expect(result[0].endTime).toBe(20000)
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
    expect(result[0].startTime).toBe(5000)
    expect(result[0].endTime).toBe(35000) // 默认 30 秒
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
    expect(result[0].startTime).toBe(5000)
    expect(result[0].endTime).toBe(20000)
    expect(result[1].startTime).toBe(30000)
    expect(result[1].endTime).toBe(45000)
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
    expect(result[0].startTime).toBe(5000)
    expect(result[0].endTime).toBe(20000)
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
})
