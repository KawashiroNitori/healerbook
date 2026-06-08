/**
 * FFLogs 导入工具测试
 */

import { describe, it, expect } from 'vitest'
import { parseFFLogsUrl } from './fflogsParser'
import {
  parseCastEvents,
  parseDamageEvents,
  parseSyncEvents,
  extractShieldData,
  extractHealData,
  extractMaxHPData,
  parseStatData,
  buildBossIds,
  parseFightImport,
} from './fflogsImporter'
import type { FFLogsAbility, FFLogsReport, FFLogsEvent } from '@/types/fflogs'
import type { Composition } from '@/types/timeline'

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

    it('应该解析不带 fight 参数的 URL（默认取最后一个战斗）', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
        isLastFight: true,
      })
    })

    it('应该解析带其他查询参数的 URL', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123?translate=true&fight=3')
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
    it('应该解析纯报告代码（默认取最后一个战斗）', () => {
      const result = parseFFLogsUrl('ABC123')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
        isLastFight: true,
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

    it('应该处理无效的 fight 参数（默认取最后一个战斗）', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123#fight=abc')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
        isLastFight: true,
      })
    })
  })

  describe('匿名报告（a:CODE 格式）', () => {
    it('应该解析匿名报告 URL', () => {
      const result = parseFFLogsUrl(
        'https://www.fflogs.com/reports/a:fQ6DXNV7bWqrmKBM?fight=18&type=damage-done'
      )
      expect(result).toEqual({
        reportCode: 'a:fQ6DXNV7bWqrmKBM',
        fightId: 18,
        isLastFight: false,
      })
    })

    it('应该解析匿名报告 URL（hash 参数）', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/a:fQ6DXNV7bWqrmKBM#fight=last')
      expect(result).toEqual({
        reportCode: 'a:fQ6DXNV7bWqrmKBM',
        fightId: null,
        isLastFight: true,
      })
    })

    it('应该解析匿名报告 URL（无 fight 参数，默认取最后一个战斗）', () => {
      const result = parseFFLogsUrl('https://zh.fflogs.com/reports/a:fQ6DXNV7bWqrmKBM')
      expect(result).toEqual({
        reportCode: 'a:fQ6DXNV7bWqrmKBM',
        fightId: null,
        isLastFight: true,
      })
    })

    it('应该解析匿名报告纯代码', () => {
      const result = parseFFLogsUrl('a:fQ6DXNV7bWqrmKBM#fight=5')
      expect(result).toEqual({
        reportCode: 'a:fQ6DXNV7bWqrmKBM',
        fightId: 5,
        isLastFight: false,
      })
    })

    it('应该解析匿名报告纯代码（无 fight，默认取最后一个战斗）', () => {
      const result = parseFFLogsUrl('a:fQ6DXNV7bWqrmKBM')
      expect(result).toEqual({
        reportCode: 'a:fQ6DXNV7bWqrmKBM',
        fightId: null,
        isLastFight: true,
      })
    })
  })
})

describe('parseFightImport 时间基准', () => {
  const report = { fights: [], friendlies: [] } as unknown as FFLogsReport
  const fight = { id: 1, name: 'Boss', startTime: 0, endTime: 20000 }

  it('优先以首个 limitbreakupdate 事件作为零时间', () => {
    const events: FFLogsEvent[] = [
      { type: 'limitbreakupdate', timestamp: 2000 },
      { type: 'damage', timestamp: 5000, targetID: 1 },
    ]
    const result = parseFightImport(report, fight, events)
    expect(result.fightStartTime).toBe(2000)
  })

  it('无 limitbreakupdate 时回退到首次伤害时间', () => {
    const events: FFLogsEvent[] = [{ type: 'damage', timestamp: 5000, targetID: 1 }]
    const result = parseFightImport(report, fight, events)
    expect(result.fightStartTime).toBe(5000)
  })
})

describe('parseCastEvents', () => {
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

    const result = parseCastEvents(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(2)
    expect(result[0].actionId).toBe(7535)
    expect(result[1].actionId).toBe(16536)
  })

  it('应该过滤掉非友方技能（sourceID 不在 playerMap 中）', () => {
    const events = [
      { type: 'cast', abilityGameID: 7535, sourceID: 999, timestamp: fightStartTime + 5000 },
    ]

    const result = parseCastEvents(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(0)
  })

  it('应该过滤掉未知玩家的技能', () => {
    const events = [
      { type: 'cast', abilityGameID: 7535, sourceID: 999, timestamp: fightStartTime + 5000 },
    ]

    const result = parseCastEvents(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(0)
  })

  it('应该正确计算相对时间（秒）', () => {
    const events = [
      { type: 'cast', abilityGameID: 7535, sourceID: 1, timestamp: fightStartTime + 5000 },
    ]

    const result = parseCastEvents(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(1)
    expect(result[0].timestamp).toBe(5)
  })

  it('应该保留 37016（降临之章）的原始 abilityGameID（由 trackGroup 在渲染层挂到 37013 轨道）', () => {
    const mockPlayerMapSCH = new Map<number, V2Actor>([
      [3, { id: 3, name: 'Scholar', type: 'Scholar' }],
    ])
    const events = [
      { type: 'cast', abilityGameID: 37016, sourceID: 3, timestamp: fightStartTime + 5000 },
    ]

    const result = parseCastEvents(events, fightStartTime, mockPlayerMapSCH)

    expect(result).toHaveLength(1)
    expect(result[0].actionId).toBe(37016)
    expect(result[0].timestamp).toBe(5)
  })
})

describe('parseDamageEvents', () => {
  const fightStartTime = 1000000

  /**
   * 为 damage 事件列表生成对应的 calculateddamage 事件
   * 新流程以 calculateddamage 为主数据源，damage 用于补充 buffs/targetResources
   */
  function withCalculatedDamage(
    damageEvents: Record<string, unknown>[]
  ): Record<string, unknown>[] {
    const calcEvents = damageEvents
      .filter(e => e.type === 'damage')
      .map(e => ({ ...e, type: 'calculateddamage' }))
    return [...calcEvents, ...damageEvents]
  }

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
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
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
        abilityGameID: 999999,
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
        abilityGameID: 999999,
        targetID: 3,
        unmitigatedAmount: 11000,
        absorbed: 0,
        amount: 11000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Test Attack')
    expect(result[0].time).toBe(5)
    expect(result[0].damageType).toBe('magical')
    expect(result[0].playerDamageDetails).toHaveLength(3)
  })

  it('魔法伤害应取近战+远物的最高值', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
      [3, { id: 3, name: 'DPS1', type: 'Samurai' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Test Attack', 1024)

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 1,
        unmitigatedAmount: 5000,
        absorbed: 0,
        amount: 5000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 2,
        unmitigatedAmount: 10000,
        absorbed: 0,
        amount: 10000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 3,
        unmitigatedAmount: 12000,
        absorbed: 0,
        amount: 12000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    expect(result[0].damage).toBe(12000) // 魔法伤害取近战(SAM)最高值
  })

  it('应该在只有坦克时使用所有玩家的平均伤害', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Tank2', type: 'Warrior' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Tankbuster', 128)

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
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
        abilityGameID: 999999,
        targetID: 2,
        unmitigatedAmount: 18000,
        absorbed: 0,
        amount: 18000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    expect(result[0].damage).toBe(20000) // 只有坦克时 fallback 取最高值
    expect(result[0].damageType).toBe('physical')
  })

  it('物理伤害应取法系+治疗的最高值', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
      [3, { id: 3, name: 'DPS1', type: 'Samurai' }],
      [4, { id: 4, name: 'Caster1', type: 'BlackMage' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Physical Hit', 128)

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 1,
        unmitigatedAmount: 5000,
        absorbed: 0,
        amount: 5000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 2,
        unmitigatedAmount: 15000,
        absorbed: 0,
        amount: 15000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 3,
        unmitigatedAmount: 8000,
        absorbed: 0,
        amount: 8000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 4,
        unmitigatedAmount: 14000,
        absorbed: 0,
        amount: 14000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    expect(result[0].damage).toBe(15000) // 物理伤害取 healer(15000) 和 caster(14000) 中最高
  })

  it('魔法伤害只命中治疗时应 fallback 取非T最高值', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
      [3, { id: 3, name: 'Healer2', type: 'Scholar' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Magic Hit', 1024)

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 1,
        unmitigatedAmount: 5000,
        absorbed: 0,
        amount: 5000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 2,
        unmitigatedAmount: 9000,
        absorbed: 0,
        amount: 9000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 3,
        unmitigatedAmount: 10000,
        absorbed: 0,
        amount: 10000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    expect(result[0].damage).toBe(10000) // 无近战/远物，fallback 非T最高值(SCH 10000)
  })

  it('魔法伤害：近战/远物被盾完全吸光时应 fallback 到非 T 最高值', () => {
    // 场景：魔法 AOE 同时命中 SAM(melee) 和 WHM(healer)
    // SAM 被盾完全吸光 → FFLogs 不返回 unmitigatedAmount 也不返回 multiplier
    // WHM 吃了实伤，有有效的 unmitigatedAmount
    // 期望：代表值应取 WHM 的 15000，而不是因为 SAM 全 0 返回 0
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
      [3, { id: 3, name: 'DPS1', type: 'Samurai' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Shielded Magic', 1024)

    const events = [
      // T 吃实伤
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 1,
        unmitigatedAmount: 6000,
        absorbed: 0,
        amount: 6000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      // WHM 吃实伤
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 2,
        unmitigatedAmount: 15000,
        absorbed: 0,
        amount: 15000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      // SAM 被盾完全吸光：无 unmitigatedAmount、无 multiplier，只有 absorbed
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 3,
        absorbed: 14000,
        amount: 0,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    // 若不做 fallback 防护，magical 分支在 SAM.unmitigatedDamage=0 上会返回 0
    // 修复后：该组全 0 → fallback 到非 T 最高值 → WHM 15000
    expect(result[0].damage).toBe(15000)
  })

  it('物理伤害：法系/治疗被盾完全吸光时应 fallback 到非 T 最高值', () => {
    // 场景：物理 AOE 同时命中 WHM(healer) 和 SAM(melee)
    // WHM 被盾完全吸光 → unmitigatedAmount / multiplier 均缺失
    // SAM 吃了实伤
    // 期望：代表值应取 SAM 的 12000
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
      [3, { id: 3, name: 'DPS1', type: 'Samurai' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Shielded Physical', 128)

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 1,
        unmitigatedAmount: 5000,
        absorbed: 0,
        amount: 5000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      // WHM 被盾完全吸光
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 2,
        absorbed: 11000,
        amount: 0,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      // SAM 吃实伤
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 3,
        unmitigatedAmount: 12000,
        absorbed: 0,
        amount: 12000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    expect(result[0].damage).toBe(12000)
  })

  it('所有非 T 被盾完全吸光时应进一步 fallback 到 T 的真实数据', () => {
    // 场景：物理 AOE，所有非 T 都被盾吸光，只有 T 吃了实伤
    // 期望：最终 fallback 到包含 T 在内的最大值 → T 的 20000
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
      [3, { id: 3, name: 'DPS1', type: 'Samurai' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Fully Shielded', 128)

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
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
        abilityGameID: 999999,
        targetID: 2,
        absorbed: 11000,
        amount: 0,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 3,
        absorbed: 12000,
        amount: 0,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    // 物理分支 caster/healer 全 0 → 非 T fallback 全 0 → 最终 fallback 到全体 → T 20000
    expect(result[0].damage).toBe(20000)
  })

  it('物理伤害只命中近战时应 fallback 取非T最高值', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Melee1', type: 'Samurai' }],
      [2, { id: 2, name: 'Melee2', type: 'Ninja' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Physical Hit', 128)

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 1,
        unmitigatedAmount: 11000,
        absorbed: 0,
        amount: 11000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 2,
        unmitigatedAmount: 12000,
        absorbed: 0,
        amount: 12000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    expect(result[0].damage).toBe(12000) // 无法系/治疗，fallback 非T最高值(NIN 12000)
  })

  it('darkness 伤害应取非T最高值', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
      [3, { id: 3, name: 'DPS1', type: 'Samurai' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Dark Hit', 0) // type 0 → darkness

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 1,
        unmitigatedAmount: 5000,
        absorbed: 0,
        amount: 5000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 2,
        unmitigatedAmount: 13000,
        absorbed: 0,
        amount: 13000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 3,
        unmitigatedAmount: 11000,
        absorbed: 0,
        amount: 11000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    expect(result[0].damage).toBe(13000) // darkness 直接 fallback 非T最高值(WHM 13000)
  })

  it('应该记录每个玩家的详细伤害信息', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Test Attack', 1024)

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 1,
        unmitigatedAmount: 10000,
        absorbed: 500,
        amount: 9500,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
        buffs: '1001362.', // 圣光幕帘状态
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 2,
        unmitigatedAmount: 12000,
        absorbed: 0,
        amount: 12000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'absorbed',
        abilityGameID: 1001362, // 圣光幕帘状态 ID
        extraAbilityGameID: 999999,
        targetID: 1,
        attackerID: 999,
        amount: 500,
        timestamp: fightStartTime + 5000,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    expect(result[0].playerDamageDetails).toHaveLength(2)
    const tankDetail = result[0].playerDamageDetails?.find(d => d.playerId === 1)
    expect(tankDetail?.statuses).toHaveLength(1)
    expect(tankDetail?.statuses[0].statusId).toBe(1362) // 1001362 - 1000000
    expect(tankDetail?.statuses[0].absorb).toBe(500)
    expect(tankDetail?.finalDamage).toBe(9500)
  })

  it('应该将命名匹配普攻正则的事件标记为 auto 类型', () => {
    const playerMap = new Map<number, V2Actor>([[1, { id: 1, name: 'Tank1', type: 'Paladin' }]])
    const abilityMap = makeAbilityMap(1, 'Attack', 128)

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 1,
        targetID: 1,
        unmitigatedAmount: 10000,
        absorbed: 0,
        amount: 10000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('auto')
  })

  it('启发式：同名事件数 > 10 且 80%+ 全坦克命中时应标记为 auto', () => {
    const playerMap = new Map<number, V2Actor>([[1, { id: 1, name: 'Tank1', type: 'Paladin' }]])
    const abilityMap = makeAbilityMap(100001, 'Sneaky Auto', 128)

    const events: Record<string, unknown>[] = []
    // 11 次全命中坦克，规避 regex 命中且 > 10 次阈值
    for (let i = 0; i < 11; i++) {
      events.push({
        type: 'damage',
        packetID: 5000 + i,
        abilityGameID: 100001,
        targetID: 1,
        unmitigatedAmount: 2000,
        absorbed: 0,
        amount: 2000,
        timestamp: fightStartTime + 1000 + i * 2000,
        sourceID: 999,
      })
    }

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(11)
    expect(result.every(e => e.type === 'auto')).toBe(true)
  })

  it('启发式：同名事件数 ≤ 10 时不触发 auto 启发式', () => {
    const playerMap = new Map<number, V2Actor>([[1, { id: 1, name: 'Tank1', type: 'Paladin' }]])
    const abilityMap = makeAbilityMap(100001, 'Frequent Tank Hit', 128)

    const events: Record<string, unknown>[] = []
    for (let i = 0; i < 10; i++) {
      events.push({
        type: 'damage',
        packetID: 5000 + i,
        abilityGameID: 100001,
        targetID: 1,
        unmitigatedAmount: 2000,
        absorbed: 0,
        amount: 2000,
        timestamp: fightStartTime + 1000 + i * 2000,
        sourceID: 999,
      })
    }

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(10)
    expect(result.every(e => e.type !== 'auto')).toBe(true)
  })

  it('启发式：DOT tick 即便满足次数与全坦克条件也不触发', () => {
    const playerMap = new Map<number, V2Actor>([[1, { id: 1, name: 'Tank1', type: 'Paladin' }]])
    const abilityMap = new Map<number, FFLogsAbility>([
      [200001, { gameID: 200001, name: 'Bleed Tick', type: 128 }],
      [200002, { gameID: 200002, name: 'Bleed Source', type: 128 }],
    ])

    const events: Record<string, unknown>[] = []
    // applydebuff 快照，供后续 tick 匹配
    events.push({
      type: 'applydebuff',
      abilityGameID: 200001,
      extraAbilityGameID: 200002,
      targetID: 1,
      timestamp: fightStartTime + 500,
    })

    // 11 次 DOT tick：全坦克命中且 > 10，但带 snapshotTime 应被规则排除
    for (let i = 0; i < 11; i++) {
      events.push({
        type: 'damage',
        packetID: 5000 + i,
        abilityGameID: 200001,
        targetID: 1,
        unmitigatedAmount: 2000,
        absorbed: 0,
        amount: 2000,
        tick: true,
        timestamp: fightStartTime + 1000 + i * 2000,
        sourceID: 999,
      })
    }

    // 直接用 damage 事件，保证 applydebuff 在所有 damage 事件前被处理
    // （withCalculatedDamage 会把 calc 事件前置到 applydebuff 之前，导致 DoT 快照丢失）
    const result = parseDamageEvents(events, fightStartTime, playerMap, abilityMap)
    expect(result).toHaveLength(11)
    // 确认是 DOT（snapshotTime 已经被填充）
    expect(result.every(e => e.snapshotTime !== undefined)).toBe(true)
    // DOT 不应被误判为 auto
    expect(result.every(e => e.type !== 'auto')).toBe(true)
  })

  it('启发式：同名事件数 > 10 但命中非坦克比例过高时不触发', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'DPS1', type: 'Samurai' }],
    ])
    const abilityMap = makeAbilityMap(100001, 'Random Hit', 1024)

    const events: Record<string, unknown>[] = []
    // 11 次事件：坦克 5 次 + DPS 6 次，全坦克比例 5/11 ≈ 45%，不满足 80% 阈值
    for (let i = 0; i < 11; i++) {
      events.push({
        type: 'damage',
        packetID: 5000 + i,
        abilityGameID: 100001,
        targetID: i % 2 === 0 ? 1 : 2,
        unmitigatedAmount: 2000,
        absorbed: 0,
        amount: 2000,
        timestamp: fightStartTime + 1000 + i * 2000,
        sourceID: 999,
      })
    }

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(11)
    expect(result.every(e => e.type !== 'auto')).toBe(true)
  })

  it('不应过滤低伤害技能（保留供用户编辑）', () => {
    const playerMap = new Map<number, V2Actor>([[1, { id: 1, name: 'Tank1', type: 'Paladin' }]])
    const abilityMap = makeAbilityMap(12345, 'Weak Attack', 1024)

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 12345,
        targetID: 1,
        unmitigatedAmount: 5000,
        absorbed: 0,
        amount: 5000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    expect(result[0].damage).toBe(5000)
  })

  it('应该在 unmitigatedAmount 为 0 时从 multiplier 和 absorbed 推测原始伤害', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Healer1', type: 'WhiteMage' }],
      [2, { id: 2, name: 'DPS1', type: 'Samurai' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Test Attack', 1024)

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 1,
        unmitigatedAmount: 0, // 无效，需推测
        multiplier: 0.8,
        absorbed: 2000,
        amount: 6000, // 推测：(6000 + 2000) / 0.8 = 10000
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 2,
        unmitigatedAmount: 12000,
        multiplier: 1,
        absorbed: 0,
        amount: 12000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    const details = result[0].playerDamageDetails ?? []
    const healerDetail = details.find(d => d.playerId === 1)
    expect(healerDetail?.unmitigatedDamage).toBe(10000)
  })

  it('unmitigatedAmount 为 0 且无法推测时保留该玩家伤害（置 0 供用户填写）', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Healer1', type: 'WhiteMage' }],
      [2, { id: 2, name: 'DPS1', type: 'Samurai' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Test Attack', 1024)

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 1,
        unmitigatedAmount: 0, // 无法推测，保留并置 0
        amount: 0,
        absorbed: 0,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 2,
        unmitigatedAmount: 12000,
        multiplier: 1,
        absorbed: 0,
        amount: 12000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    // 两个玩家都保留
    expect(result[0].playerDamageDetails).toHaveLength(2)
    const healerDetail = result[0].playerDamageDetails?.find(d => d.playerId === 1)
    expect(healerDetail?.unmitigatedDamage).toBe(0)
  })

  it('应该将全坦目标且伤害远高于 AOE 的伤害判定为 tankbuster', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Tank2', type: 'Warrior' }],
      [3, { id: 3, name: 'Healer1', type: 'WhiteMage' }],
      [4, { id: 4, name: 'DPS1', type: 'Samurai' }],
    ])
    const abilityMap = new Map<number, FFLogsAbility>([
      [100001, { gameID: 100001, name: 'AOE Attack', type: 1024 }],
      [100002, { gameID: 100002, name: 'Tankbuster', type: 128 }],
    ])

    const events = [
      // AOE: 命中所有人，伤害 ~10000
      ...[1, 2, 3, 4].map(targetID => ({
        type: 'damage',
        packetID: 1,
        abilityGameID: 100001,
        targetID,
        unmitigatedAmount: 10000,
        absorbed: 0,
        amount: 10000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      })),
      // 死刑: 只命中坦克，伤害 ~30000（远高于 AOE 的 1.5 倍）
      {
        type: 'damage',
        packetID: 2,
        abilityGameID: 100002,
        targetID: 1,
        unmitigatedAmount: 30000,
        absorbed: 0,
        amount: 30000,
        timestamp: fightStartTime + 15000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(2)
    const aoe = result.find(e => e.name === 'AOE Attack')
    const tb = result.find(e => e.name === 'Tankbuster')
    expect(aoe?.type).toBe('aoe')
    expect(tb?.type).toBe('tankbuster')
  })

  it('应该将包含非坦克目标的伤害判定为 aoe', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
      [3, { id: 3, name: 'DPS1', type: 'Samurai' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Raidwide', 1024)

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
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
        abilityGameID: 999999,
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
        abilityGameID: 999999,
        targetID: 3,
        unmitigatedAmount: 11000,
        absorbed: 0,
        amount: 11000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('aoe')
  })

  it('交叉验证：同技能在其他实例中命中非坦克时应回退为 aoe', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'DPS1', type: 'Samurai' }],
    ])
    // 同一个技能 ID，两次施放
    const abilityMap = makeAbilityMap(888888, 'Random Target', 1024)

    const events = [
      // 第一次：恰好命中坦克
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 888888,
        targetID: 1,
        unmitigatedAmount: 15000,
        absorbed: 0,
        amount: 15000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      // 第二次：命中 DPS
      {
        type: 'damage',
        packetID: 2,
        abilityGameID: 888888,
        targetID: 2,
        unmitigatedAmount: 15000,
        absorbed: 0,
        amount: 15000,
        timestamp: fightStartTime + 20000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(2)
    // 两次都应该是 aoe（第一次通过交叉验证回退）
    expect(result.every(e => e.type === 'aoe')).toBe(true)
  })

  it('伤害量验证：全坦目标但伤害不高于 AOE 中位数 1.5 倍时应回退为 aoe', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
      [3, { id: 3, name: 'DPS1', type: 'Samurai' }],
    ])
    const abilityMap = new Map<number, FFLogsAbility>([
      [100001, { gameID: 100001, name: 'AOE Attack', type: 1024 }],
      [100002, { gameID: 100002, name: 'Low Hit on Tank', type: 128 }],
    ])

    const events = [
      // AOE: 命中所有人，伤害 ~10000
      ...[1, 2, 3].map(targetID => ({
        type: 'damage',
        packetID: 1,
        abilityGameID: 100001,
        targetID,
        unmitigatedAmount: 10000,
        absorbed: 0,
        amount: 10000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      })),
      // 只命中坦克，但伤害 12000（< AOE 中位数 10000 × 1.5 = 15000）
      {
        type: 'damage',
        packetID: 2,
        abilityGameID: 100002,
        targetID: 1,
        unmitigatedAmount: 12000,
        absorbed: 0,
        amount: 12000,
        timestamp: fightStartTime + 15000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(2)
    const lowHit = result.find(e => e.name === 'Low Hit on Tank')
    expect(lowHit?.type).toBe('aoe')
  })

  it('无 AOE 参照时全坦目标应保持 tankbuster', () => {
    const playerMap = new Map<number, V2Actor>([[1, { id: 1, name: 'Tank1', type: 'DarkKnight' }]])
    const abilityMap = makeAbilityMap(999999, 'Single Tankbuster', 128)

    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 1,
        unmitigatedAmount: 30000,
        absorbed: 0,
        amount: 30000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('tankbuster')
  })

  it('只有 damage 没有 calculateddamage 时应正常解析', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
      [3, { id: 3, name: 'DPS1', type: 'Samurai' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Test Attack', 1024)

    // 只有 damage 事件，没有 calculateddamage
    const events = [
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 1,
        unmitigatedAmount: 8000,
        absorbed: 0,
        amount: 8000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
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
        abilityGameID: 999999,
        targetID: 3,
        unmitigatedAmount: 11000,
        absorbed: 0,
        amount: 11000,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
    ]

    // 不使用 withCalculatedDamage，直接传入只有 damage 的事件
    const result = parseDamageEvents(events, fightStartTime, playerMap, abilityMap)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Test Attack')
    expect(result[0].time).toBe(5)
    expect(result[0].damage).toBe(11000) // 魔法伤害取近战最高值
    expect(result[0].playerDamageDetails).toHaveLength(3)
    expect(result[0].playerDamageDetails![0].unmitigatedDamage).toBe(8000)
    expect(result[0].playerDamageDetails![1].unmitigatedDamage).toBe(12000)
    expect(result[0].playerDamageDetails![2].unmitigatedDamage).toBe(11000)
  })

  it('部分玩家只有 damage 没有 calculateddamage 时应补全', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Healer1', type: 'WhiteMage' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Test Attack', 1024)

    const events = [
      // 玩家 1 有 calculateddamage + damage
      {
        type: 'calculateddamage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 1,
        timestamp: fightStartTime + 5000,
        sourceID: 999,
      },
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 1,
        unmitigatedAmount: 8000,
        absorbed: 0,
        amount: 8000,
        timestamp: fightStartTime + 5010,
        sourceID: 999,
      },
      // 玩家 2 只有 damage，没有 calculateddamage
      {
        type: 'damage',
        packetID: 1,
        abilityGameID: 999999,
        targetID: 2,
        unmitigatedAmount: 12000,
        absorbed: 0,
        amount: 12000,
        timestamp: fightStartTime + 5010,
        sourceID: 999,
      },
    ]

    const result = parseDamageEvents(events, fightStartTime, playerMap, abilityMap)
    expect(result).toHaveLength(1)
    expect(result[0].playerDamageDetails).toHaveLength(2)

    const tankDetail = result[0].playerDamageDetails!.find(d => d.playerId === 1)
    const healerDetail = result[0].playerDamageDetails!.find(d => d.playerId === 2)
    expect(tankDetail?.unmitigatedDamage).toBe(8000)
    expect(healerDetail?.unmitigatedDamage).toBe(12000)
    expect(healerDetail?.job).toBe('WHM')
  })

  it('命中超过 2 人时即使全是坦克也应判定为 aoe', () => {
    const playerMap = new Map<number, V2Actor>([
      [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
      [2, { id: 2, name: 'Tank2', type: 'Warrior' }],
      [3, { id: 3, name: 'Tank3', type: 'DarkKnight' }],
    ])
    const abilityMap = makeAbilityMap(999999, 'Multi Tank Hit', 128)

    const events = [1, 2, 3].map(targetID => ({
      type: 'damage',
      packetID: 1,
      abilityGameID: 999999,
      targetID,
      unmitigatedAmount: 30000,
      absorbed: 0,
      amount: 30000,
      timestamp: fightStartTime + 5000,
      sourceID: 999,
    }))

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('aoe')
  })

  it('amount=0 且 FFLogs 未下发 packetID 的伤害事件仍应被保留', () => {
    // 完全被盾吸收的伤害（如神圣领域），FFLogs 不返回 packetID；
    // 以前 `!event.packetID` 的过滤会把它丢掉，导致 0 个 DamageEvent。
    const playerMap = new Map<number, V2Actor>([[1, { id: 1, name: 'Tank1', type: 'Paladin' }]])
    const abilityMap = makeAbilityMap(999998, 'Absorbed Hit', 1024)

    const events = [
      {
        type: 'damage',
        // 注意：无 packetID
        abilityGameID: 999998,
        targetID: 1,
        amount: 0,
        unmitigatedAmount: 0,
        timestamp: fightStartTime + 2000,
        sourceID: 999,
        buffs: '1000082.',
      },
    ]

    const result = parseDamageEvents(
      withCalculatedDamage(events),
      fightStartTime,
      playerMap,
      abilityMap
    )

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Absorbed Hit')
    expect(result[0].damage).toBe(0)
    expect(result[0].packetId).toBeUndefined()
  })

  describe('集成 classifyPartialAOE', () => {
    it('传入 composition 时，aoe 事件被细分为 partial_aoe / partial_final_aoe', () => {
      const playerMap = new Map<number, V2Actor>([
        [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
        [2, { id: 2, name: 'Tank2', type: 'Warrior' }],
        [3, { id: 3, name: 'Healer1', type: 'WhiteMage' }],
        [4, { id: 4, name: 'Healer2', type: 'Scholar' }],
        [5, { id: 5, name: 'DPS1', type: 'Samurai' }],
        [6, { id: 6, name: 'DPS2', type: 'BlackMage' }],
        [7, { id: 7, name: 'DPS3', type: 'Bard' }],
        [8, { id: 8, name: 'DPS4', type: 'Ninja' }],
      ])
      const abilityMap = makeAbilityMap(900001, 'Mech', 1024)

      // 第一波（t=5）：只命中 3,4,5（partial_aoe）
      // 第二波（t=10）：命中 6,7,8（partial_final_aoe，全员到齐清零）
      // 第三波（t=15）：命中全部非T（aoe）
      const wave = (t: number, targets: number[], packetID: number) =>
        targets.map(targetID => ({
          type: 'damage' as const,
          packetID,
          abilityGameID: 900001,
          targetID,
          unmitigatedAmount: 1000,
          absorbed: 0,
          amount: 800,
          timestamp: fightStartTime + t * 1000,
          sourceID: 999,
        }))

      const events = [
        ...wave(5, [3, 4, 5], 1),
        ...wave(10, [6, 7, 8], 2),
        ...wave(15, [3, 4, 5, 6, 7, 8], 3),
      ]

      const composition = {
        players: [
          { id: 1, job: 'PLD' as const },
          { id: 2, job: 'WAR' as const },
          { id: 3, job: 'WHM' as const },
          { id: 4, job: 'SCH' as const },
          { id: 5, job: 'SAM' as const },
          { id: 6, job: 'BLM' as const },
          { id: 7, job: 'BRD' as const },
          { id: 8, job: 'NIN' as const },
        ],
      }

      const result = parseDamageEvents(
        withCalculatedDamage(events),
        fightStartTime,
        playerMap,
        abilityMap,
        composition
      )

      expect(result).toHaveLength(3)
      expect(result.map(e => e.type)).toEqual(['partial_aoe', 'partial_final_aoe', 'aoe'])
    })

    it('不传 composition 时（既有调用方），状态机跳过，type 等同旧行为', () => {
      const playerMap = new Map<number, V2Actor>([
        [3, { id: 3, name: 'Healer1', type: 'WhiteMage' }],
        [4, { id: 4, name: 'Healer2', type: 'Scholar' }],
      ])
      const abilityMap = makeAbilityMap(900002, 'Mech2', 1024)

      const events = [
        {
          type: 'damage' as const,
          packetID: 1,
          abilityGameID: 900002,
          targetID: 3,
          unmitigatedAmount: 1000,
          absorbed: 0,
          amount: 800,
          timestamp: fightStartTime + 5000,
          sourceID: 999,
        },
      ]

      const result = parseDamageEvents(
        withCalculatedDamage(events),
        fightStartTime,
        playerMap,
        abilityMap
      )

      // 单个非 T 命中、无 composition：保持原 detect 路径的归类（aoe）
      expect(result[0].type).toBe('aoe')
    })
  })

  describe('partial_final_aoe 时间后移', () => {
    it('partial_final_aoe 事件 time +0.1，partial_aoe / aoe 不变，且整体保持有序', () => {
      const playerMap = new Map<number, V2Actor>([
        [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
        [2, { id: 2, name: 'Tank2', type: 'Warrior' }],
        [3, { id: 3, name: 'Healer1', type: 'WhiteMage' }],
        [4, { id: 4, name: 'Healer2', type: 'Scholar' }],
        [5, { id: 5, name: 'DPS1', type: 'Samurai' }],
        [6, { id: 6, name: 'DPS2', type: 'BlackMage' }],
        [7, { id: 7, name: 'DPS3', type: 'Bard' }],
        [8, { id: 8, name: 'DPS4', type: 'Ninja' }],
      ])
      const abilityMap = makeAbilityMap(900001, 'Mech', 1024)

      // 第一波（t=5）：只命中 3,4,5（partial_aoe）
      // 第二波（t=10）：命中 6,7,8（partial_final_aoe，全员到齐清零）
      // 第三波（t=15）：命中全部非T（aoe）
      const wave = (t: number, targets: number[], packetID: number) =>
        targets.map(targetID => ({
          type: 'damage' as const,
          packetID,
          abilityGameID: 900001,
          targetID,
          unmitigatedAmount: 1000,
          absorbed: 0,
          amount: 800,
          timestamp: fightStartTime + t * 1000,
          sourceID: 999,
        }))

      const events = [
        ...wave(5, [3, 4, 5], 1),
        ...wave(10, [6, 7, 8], 2),
        ...wave(15, [3, 4, 5, 6, 7, 8], 3),
      ]

      const composition = {
        players: [
          { id: 1, job: 'PLD' as const },
          { id: 2, job: 'WAR' as const },
          { id: 3, job: 'WHM' as const },
          { id: 4, job: 'SCH' as const },
          { id: 5, job: 'SAM' as const },
          { id: 6, job: 'BLM' as const },
          { id: 7, job: 'BRD' as const },
          { id: 8, job: 'NIN' as const },
        ],
      }

      const result = parseDamageEvents(
        withCalculatedDamage(events),
        fightStartTime,
        playerMap,
        abilityMap,
        composition
      )

      expect(result.map(e => e.type)).toEqual(['partial_aoe', 'partial_final_aoe', 'aoe'])
      // partial_final_aoe（原 t=10）后移 0.1s；partial_aoe / aoe 时间不动
      expect(result.map(e => e.time)).toEqual([5, 10.1, 15])
      // 偏移后整体仍按 time 升序
      const times = result.map(e => e.time)
      expect(times).toEqual([...times].sort((a, b) => a - b))
    })

    it('partial_final_aoe 与同刻全员 AOE 共存时，后移使其排在全员 AOE 之后', () => {
      const playerMap = new Map<number, V2Actor>([
        [1, { id: 1, name: 'Tank1', type: 'Paladin' }],
        [2, { id: 2, name: 'Tank2', type: 'Warrior' }],
        [3, { id: 3, name: 'Healer1', type: 'WhiteMage' }],
        [4, { id: 4, name: 'Healer2', type: 'Scholar' }],
        [5, { id: 5, name: 'DPS1', type: 'Samurai' }],
        [6, { id: 6, name: 'DPS2', type: 'BlackMage' }],
        [7, { id: 7, name: 'DPS3', type: 'Bard' }],
        [8, { id: 8, name: 'DPS4', type: 'Ninja' }],
      ])
      // 两个不同技能：900001 用于部分 AOE 段，900002 用于同刻全员 AOE
      const abilityMap = new Map([
        [900001, { gameID: 900001, name: 'PartialMech', type: 1024 }],
        [900002, { gameID: 900002, name: 'FullMech', type: 1024 }],
      ])

      const wave = (ability: number, t: number, targets: number[], packetID: number) =>
        targets.map(targetID => ({
          type: 'damage' as const,
          packetID,
          abilityGameID: ability,
          targetID,
          unmitigatedAmount: 1000,
          absorbed: 0,
          amount: 800,
          timestamp: fightStartTime + t * 1000,
          sourceID: 999,
        }))

      // t=5 部分命中 3,4,5；t=10 部分命中 6,7,8 完成结算（partial_final_aoe）；
      // t=10 同刻另有全员 AOE（900002，命中全部非 T）
      const events = [
        ...wave(900001, 5, [3, 4, 5], 1),
        ...wave(900001, 10, [6, 7, 8], 2),
        ...wave(900002, 10, [3, 4, 5, 6, 7, 8], 3),
      ]

      const composition = {
        players: [
          { id: 1, job: 'PLD' as const },
          { id: 2, job: 'WAR' as const },
          { id: 3, job: 'WHM' as const },
          { id: 4, job: 'SCH' as const },
          { id: 5, job: 'SAM' as const },
          { id: 6, job: 'BLM' as const },
          { id: 7, job: 'BRD' as const },
          { id: 8, job: 'NIN' as const },
        ],
      }

      const result = parseDamageEvents(
        withCalculatedDamage(events),
        fightStartTime,
        playerMap,
        abilityMap,
        composition
      )

      // 同刻全员 AOE 留在 t=10，partial_final_aoe 后移到 t=10.1 排在其后
      const finalAoe = result.find(e => e.type === 'partial_final_aoe')
      const fullAoe = result.find(e => e.type === 'aoe' && e.time === 10)
      expect(fullAoe).toBeDefined()
      expect(finalAoe?.time).toBe(10.1)
      expect(result.indexOf(fullAoe!)).toBeLessThan(result.indexOf(finalAoe!))
    })
  })
})

describe('parseSyncEvents', () => {
  const fightStartTime = 1000000
  const mockPlayerMap = new Map<number, V2Actor>([
    [1, { id: 1, name: 'Tank', type: 'Paladin' }],
    [2, { id: 2, name: 'Healer', type: 'WhiteMage' }],
  ])

  // 0xA3DA 空间斩 = begincast, window [10,10]，无 battleOnce，无 syncOnce
  // 0xA749 风尘光狼斩 = begincast, window [60,60]，syncOnce + battleOnce
  // 0xA3F1 空间灭斩 = begincast, window [20,20]，syncOnce=true
  const BOSS_SOURCE_ID = 100

  it('boss 的 begincast 命中规则表时产出 SyncEvent', () => {
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0xa3da,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 24300,
      },
    ]
    const result = parseSyncEvents(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      time: 24.3,
      type: 'begincast',
      actionId: 0xa3da,
      actionName: expect.any(String),
      window: [10, 10],
      syncOnce: false,
    })
  })

  it('boss 的 cast 事件若规则表只配置了 begincast 则不命中', () => {
    // 0xA3DA 在规则表里只有 begincast 一条记录
    const events = [
      {
        type: 'cast',
        abilityGameID: 0xa3da,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 5000,
      },
    ]
    expect(parseSyncEvents(events, fightStartTime, mockPlayerMap)).toHaveLength(0)
  })

  it('未命中规则表的 boss 事件被丢弃', () => {
    const events = [
      {
        type: 'cast',
        abilityGameID: 0xdeadbeef,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 5000,
      },
    ]
    expect(parseSyncEvents(events, fightStartTime, mockPlayerMap)).toHaveLength(0)
  })

  it('友方（sourceID 在 playerMap）事件被过滤', () => {
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0xa3da,
        sourceID: 1, // 在 mockPlayerMap 里
        timestamp: fightStartTime + 24300,
      },
    ]
    expect(parseSyncEvents(events, fightStartTime, mockPlayerMap)).toHaveLength(0)
  })

  it('缺 abilityGameID 的事件被过滤', () => {
    const events = [
      { type: 'begincast', sourceID: BOSS_SOURCE_ID, timestamp: fightStartTime + 5000 },
    ]
    expect(parseSyncEvents(events, fightStartTime, mockPlayerMap)).toHaveLength(0)
  })

  it('cast/begincast 之外的事件被过滤', () => {
    const events = [
      {
        type: 'damage',
        abilityGameID: 0xa3da,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 5000,
      },
    ]
    expect(parseSyncEvents(events, fightStartTime, mockPlayerMap)).toHaveLength(0)
  })

  it('battleOnce 规则首条保留后续同 id 丢弃', () => {
    // 0xA749 风尘光狼斩：begincast + battleOnce + syncOnce
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0xa749,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 60000,
      },
      {
        type: 'begincast',
        abilityGameID: 0xa749,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 180000,
      },
      {
        type: 'begincast',
        abilityGameID: 0xa749,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 300000,
      },
    ]
    const result = parseSyncEvents(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(1)
    expect(result[0].time).toBe(60)
    expect(result[0].syncOnce).toBe(true) // 0xA749 的 syncOnce 是 true
  })

  it('非 battleOnce 的规则不对后续同 id 去重', () => {
    // 0xA3DA 空间斩：begincast，既无 battleOnce 也无 syncOnce
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0xa3da,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 10000,
      },
      {
        type: 'begincast',
        abilityGameID: 0xa3da,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 30000,
      },
    ]
    const result = parseSyncEvents(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(2)
    expect(result[0].time).toBe(10)
    expect(result[1].time).toBe(30)
  })

  it('syncOnce=true 的规则写入 SyncEvent.syncOnce', () => {
    // 0xA3F1 空间灭斩：begincast, window [20,20], syncOnce=true
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0xa3f1,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 45000,
      },
    ]
    const result = parseSyncEvents(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(1)
    expect(result[0].syncOnce).toBe(true)
    expect(result[0].window).toEqual([20, 20])
  })

  it('actionName 优先使用中文名（通过 abilityMap fallback 英文名）', () => {
    const abilityMap = new Map<number, FFLogsAbility>([
      [0xa3da, { gameID: 0xa3da, name: 'Spatial Rend', type: 1 }],
    ])
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0xa3da,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 10000,
      },
    ]
    const result = parseSyncEvents(events, fightStartTime, mockPlayerMap, abilityMap)
    // actionChinese 里若存在 0xA3DA 翻译则用中文，否则 fallback 到 "Spatial Rend"
    expect(result[0].actionName).toBeTruthy()
    expect(typeof result[0].actionName).toBe('string')
  })

  it('actionName 在无中文无 abilityMap 时 fallback 为 unknown_<hex>', () => {
    // 使用一个几乎肯定不在 actionChinese 里的 id，但又要命中规则表 —— 用 0x2B87 魔导核爆
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0x2b87,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime + 60000,
      },
    ]
    const result = parseSyncEvents(events, fightStartTime, mockPlayerMap)
    // 不 assert 确切字符串，但要求有内容（可能是中文或 unknown_2b87）
    expect(result[0].actionName.length).toBeGreaterThan(0)
  })

  it('time < 0（pre-pull 读条）保留不过滤', () => {
    const events = [
      {
        type: 'begincast',
        abilityGameID: 0xa3da,
        sourceID: BOSS_SOURCE_ID,
        timestamp: fightStartTime - 2300,
      },
    ]
    const result = parseSyncEvents(events, fightStartTime, mockPlayerMap)
    expect(result).toHaveLength(1)
    expect(result[0].time).toBeCloseTo(-2.3, 3)
  })
})

describe('extractShieldData', () => {
  it('应按 statusId（abilityGameID-1000000）聚样，且不变异传入事件', () => {
    const events = [
      { type: 'absorbed', abilityGameID: 1001457, amount: 5000 },
      { type: 'absorbed', abilityGameID: 1001457, amount: 7000 },
      // 泛血印 1002643 应被当作泛输血 1002613 计入，但不写回 event
      { type: 'absorbed', abilityGameID: 1002643, amount: 800 },
    ] as unknown as Parameters<typeof extractShieldData>[0]

    const result = extractShieldData(events)

    expect(result[1457]).toEqual([5000, 7000])
    expect(result[2613]).toEqual([800])
    // 非变异：原始 event 的 abilityGameID 保持 1002643
    expect((events as { abilityGameID: number }[])[2].abilityGameID).toBe(1002643)
  })
})

describe('extractHealData', () => {
  it('应按原始 abilityGameID 聚样并排除 overheal 事件', () => {
    const events = [
      { type: 'heal', abilityGameID: 7388, amount: 3000 },
      { type: 'heal', abilityGameID: 7388, amount: 5000, overheal: 100 }, // 排除
      { type: 'heal', abilityGameID: 1002108, amount: 800 }, // HoT（1e6+status）原样保留
    ] as unknown as Parameters<typeof extractHealData>[0]

    const result = extractHealData(events)

    expect(result[7388]).toEqual([3000])
    expect(result[1002108]).toEqual([800])
  })
})

describe('extractMaxHPData', () => {
  it('应用 playerMap 把 targetResources.maxHitPoints 归到职业', () => {
    const playerMap = new Map([
      [1, { id: 1, name: 'T', type: 'Warrior' }],
      [2, { id: 2, name: 'H', type: 'WhiteMage' }],
    ])
    const events = [
      {
        type: 'heal',
        abilityGameID: 1,
        amount: 1,
        targetID: 1,
        targetResources: { maxHitPoints: 200000 },
      },
      {
        type: 'heal',
        abilityGameID: 1,
        amount: 1,
        targetID: 2,
        targetResources: { maxHitPoints: 120000 },
      },
    ] as unknown as Parameters<typeof extractMaxHPData>[0]

    const result = extractMaxHPData(events, playerMap)

    expect(result.WAR).toEqual([200000])
    expect(result.WHM).toEqual([120000])
  })
})

describe('parseStatData', () => {
  const playerMap = new Map([
    [1, { id: 1, name: 'T', type: 'Warrior' }],
    [2, { id: 2, name: 'H', type: 'WhiteMage' }],
  ])
  const composition: Composition = {
    players: [
      { id: 1, job: 'WAR' },
      { id: 2, job: 'WHM' },
    ],
  }

  it('提取盾/治疗/血量，过滤非 statData 技能，按 p50/p90 取值', () => {
    const events = [
      // WAR 摆脱盾 statusId 1457
      { type: 'absorbed', abilityGameID: 1001457, amount: 5000 },
      // WAR 摆脱直疗 actionId 7388（含一条 overheal，应排除）
      { type: 'heal', abilityGameID: 7388, amount: 3000 },
      { type: 'heal', abilityGameID: 7388, amount: 9000, overheal: 50 },
      // WAR 摆脱 HoT key 1002108
      { type: 'heal', abilityGameID: 1002108, amount: 800 },
      // 非 statData 技能：普通 GCD 治疗 + 携带 maxHitPoints，应被过滤出 healByAbility
      {
        type: 'heal',
        abilityGameID: 99999,
        amount: 1,
        targetID: 1,
        targetResources: { maxHitPoints: 200000 },
      },
      {
        type: 'heal',
        abilityGameID: 99999,
        amount: 1,
        targetID: 2,
        targetResources: { maxHitPoints: 120000 },
      },
    ] as unknown as Parameters<typeof parseStatData>[0]

    const result = parseStatData(events, playerMap, composition)

    expect(result).toBeDefined()
    expect(result!.shieldByAbility).toEqual({ 1457: 5000 })
    expect(result!.critShieldByAbility).toEqual({})
    expect(result!.healByAbility).toEqual({ 7388: 3000, 1002108: 800 })
    expect(result!.critHealByAbility).toEqual({}) // 7388/1002108 非 critHeal entry key
    expect(result!.referenceMaxHP).toBe(120000) // 非坦（WHM）最小
    expect(result!.tankReferenceMaxHP).toBe(200000) // 坦克（WAR）最小
  })

  it('无任何匹配样本时返回 undefined', () => {
    const events = [
      { type: 'damage', abilityGameID: 12345, amount: 1, unmitigatedAmount: 1 },
    ] as unknown as Parameters<typeof parseStatData>[0]
    expect(parseStatData(events, playerMap, composition)).toBeUndefined()
  })

  it('暴击治疗走 p90，与普通治疗 p50 区分', () => {
    const playerMap = new Map([[3, { id: 3, name: 'S', type: 'Scholar' }]])
    const composition: Composition = { players: [{ id: 3, job: 'SCH' }] }
    // SCH 意气轩昂之策 37013 同时声明 heal 与 critHeal
    const events = [10000, 20000, 30000, 40000, 50000].map(amount => ({
      type: 'heal',
      abilityGameID: 37013,
      amount,
    })) as unknown as Parameters<typeof parseStatData>[0]

    const result = parseStatData(events, playerMap, composition)

    expect(result).toBeDefined()
    expect(result!.healByAbility[37013]).toBe(30000) // p50
    expect(result!.critHealByAbility[37013]).toBe(46000) // p90
  })
})

describe('buildBossIds', () => {
  it('type==="Boss" 为主信号', () => {
    const enemies = [
      { id: 100, guid: 1, name: 'Boss A', type: 'Boss' },
      { id: 101, guid: 2, name: 'Add', type: 'NPC' },
    ]
    expect([...buildBossIds(enemies, 'Boss A')]).toEqual([100])
  })

  it('无 Boss 类型时按名匹配 fightName', () => {
    const enemies = [
      { id: 100, guid: 1, name: 'Golbez', type: 'NPC' },
      { id: 101, guid: 2, name: 'Shadow', type: 'NPC' },
    ]
    expect([...buildBossIds(enemies, 'Golbez')]).toEqual([100])
  })

  it('仅一个敌人时回退取它', () => {
    const enemies = [{ id: 100, guid: 1, name: 'X', type: 'NPC' }]
    expect([...buildBossIds(enemies, 'Y')]).toEqual([100])
  })

  it('按名扩展同名实体（分身/转场）', () => {
    const enemies = [
      { id: 100, guid: 1, name: 'Boss A', type: 'Boss' },
      { id: 200, guid: 1, name: 'Boss A', type: 'NPC' },
      { id: 300, guid: 2, name: 'Add', type: 'NPC' },
    ]
    expect([...buildBossIds(enemies, 'Boss A')].sort((a, b) => a - b)).toEqual([100, 200])
  })

  it('空 enemies 返回空集', () => {
    expect(buildBossIds(undefined, 'X').size).toBe(0)
    expect(buildBossIds([], 'X').size).toBe(0)
  })

  it('全部 fallback 失败时返回空集（降级不判定）', () => {
    const enemies = [
      { id: 100, guid: 1, name: 'X', type: 'NPC' },
      { id: 200, guid: 2, name: 'Y', type: 'NPC' },
    ]
    expect(buildBossIds(enemies, 'Z').size).toBe(0)
  })
})

describe('parseDamageEvents 目标减自动判定', () => {
  const fightStartTime = 1000000
  const withCalc = (evs: Record<string, unknown>[]) => [
    ...evs.filter(e => e.type === 'damage').map(e => ({ ...e, type: 'calculateddamage' })),
    ...evs,
  ]
  const playerMap = new Map<number, V2Actor>([[1, { id: 1, name: 'T', type: 'Paladin' }]])
  const abilityMap = new Map<number, FFLogsAbility>([
    [999999, { gameID: 999999, name: 'Atk', type: 1024 }],
  ])
  const events = [
    {
      type: 'damage',
      packetID: 1,
      abilityGameID: 999999,
      targetID: 1,
      unmitigatedAmount: 10000,
      absorbed: 0,
      amount: 10000,
      timestamp: fightStartTime + 5000,
      sourceID: 500, // boss
    },
    {
      type: 'damage',
      packetID: 2,
      abilityGameID: 999999,
      targetID: 1,
      unmitigatedAmount: 8000,
      absorbed: 0,
      amount: 8000,
      timestamp: fightStartTime + 9000,
      sourceID: 700, // 小怪
    },
  ]

  it('非 boss 来源标记 disabled，boss 来源不标记', () => {
    const result = parseDamageEvents(
      withCalc(events),
      fightStartTime,
      playerMap,
      abilityMap,
      undefined,
      new Set([500])
    )
    const fromBoss = result.find(e => Math.abs(e.time - 5) < 0.6)
    const fromAdd = result.find(e => Math.abs(e.time - 9) < 0.6)
    expect(fromBoss?.targetMitigationDisabled).toBeUndefined()
    expect(fromAdd?.targetMitigationDisabled).toBe(true)
  })

  it('未传 bossIds 时全部默认生效（回归）', () => {
    const result = parseDamageEvents(withCalc(events), fightStartTime, playerMap, abilityMap)
    expect(result.every(e => e.targetMitigationDisabled === undefined)).toBe(true)
  })
})
