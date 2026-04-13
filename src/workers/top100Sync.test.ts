import { describe, it, expect } from 'vitest'
import {
  mergeWithReservoirSampling,
  getSamplesKVKey,
  calculatePercentiles,
  slimDamageEvents,
  buildEncounterTemplate,
  aggregateStatistics,
  getEncounterTemplateKVKey,
  getFightStatisticsKVKey,
  type StoredDamageEvent,
  type EncounterTemplate,
  type FightStatistics,
  type StatisticsTask,
} from './top100Sync'
import { calculatePercentile } from '@/utils/stats'
import type { DamageEvent } from '@/types/timeline'

describe('mergeWithReservoirSampling', () => {
  it('总量未超上限时直接追加', () => {
    const result = mergeWithReservoirSampling([1, 2, 3], [4, 5], 10)
    expect(result).toEqual([1, 2, 3, 4, 5])
  })

  it('总量超上限时结果长度等于 max', () => {
    const reservoir = Array.from({ length: 10 }, (_, i) => i)
    const incoming = Array.from({ length: 5 }, (_, i) => i + 100)
    const result = mergeWithReservoirSampling(reservoir, incoming, 10)
    expect(result).toHaveLength(10)
  })

  it('空旧样本时直接返回新数据（不超限）', () => {
    const result = mergeWithReservoirSampling([], [1, 2, 3], 10)
    expect(result).toEqual([1, 2, 3])
  })

  it('空新数据时返回旧样本', () => {
    const result = mergeWithReservoirSampling([1, 2, 3], [], 10)
    expect(result).toEqual([1, 2, 3])
  })
})

describe('calculatePercentile', () => {
  it('奇数个样本', () => {
    expect(calculatePercentile([3, 1, 2])).toBe(2)
  })

  it('偶数个样本', () => {
    expect(calculatePercentile([1, 2, 3, 4])).toBe(3) // round((2+3)/2)
  })

  it('偶数个样本，中间两值之和为奇数（.5 舍入）', () => {
    expect(calculatePercentile([1, 2])).toBe(2) // round((1+2)/2) = round(1.5) = 2
  })

  it('单个样本', () => {
    expect(calculatePercentile([42])).toBe(42)
  })

  it('空数组返回 0', () => {
    expect(calculatePercentile([])).toBe(0)
  })
})

describe('getSamplesKVKey', () => {
  it('返回正确格式', () => {
    expect(getSamplesKVKey(1234)).toBe('statistics-samples:encounter:1234')
  })
})

describe('calculatePercentiles', () => {
  it('计算每个 key 的中位数', () => {
    const result = calculatePercentiles({ 100: [1, 3, 5], 200: [2, 4] })
    expect(result[100]).toBe(3)
    expect(result[200]).toBe(3) // round((2+4)/2)
  })

  it('空数组的 key 不出现在结果中', () => {
    const result = calculatePercentiles({ 100: [], 200: [5] })
    expect(result[100]).toBeUndefined()
    expect(result[200]).toBe(5)
  })
})

describe('slimDamageEvents', () => {
  it('剥离 id / targetPlayerId / playerDamageDetails 并提取 abilityId', () => {
    const full: DamageEvent[] = [
      {
        id: 'event-123',
        name: '死刑',
        time: 12.3,
        damage: 80000,
        type: 'tankbuster',
        damageType: 'physical',
        targetPlayerId: 5,
        playerDamageDetails: [
          {
            timestamp: 12345,
            packetId: 1,
            sourceId: 99,
            playerId: 5,
            job: 'WAR',
            abilityId: 40000,
            skillName: '死刑',
            unmitigatedDamage: 80000,
            finalDamage: 40000,
            statuses: [],
          },
        ],
        packetId: 1,
      },
    ]
    const result = slimDamageEvents(full)
    expect(result).toEqual([
      {
        name: '死刑',
        time: 12.3,
        damage: 80000,
        type: 'tankbuster',
        damageType: 'physical',
        packetId: 1,
        abilityId: 40000,
        snapshotTime: undefined,
      },
    ])
  })

  it('playerDamageDetails 为空时 abilityId 为 0', () => {
    const full: DamageEvent[] = [
      {
        id: 'x',
        name: '未知',
        time: 0,
        damage: 0,
        type: 'aoe',
        damageType: 'magical',
      },
    ]
    const result = slimDamageEvents(full)
    expect(result[0].abilityId).toBe(0)
  })
})

describe('buildEncounterTemplate', () => {
  // 辅助：构造一条精简事件
  function makeEvent(
    partial: Partial<StoredDamageEvent> & { abilityId: number; time: number }
  ): StoredDamageEvent {
    return {
      name: partial.name ?? `ability-${partial.abilityId}`,
      time: partial.time,
      damage: partial.damage ?? 1000,
      type: partial.type ?? 'aoe',
      damageType: partial.damageType ?? 'magical',
      abilityId: partial.abilityId,
    }
  }

  it('返回 null 当候选场为空', () => {
    const result = buildEncounterTemplate({
      candidates: [],
      p50Map: {},
      threshold: 3,
    })
    expect(result).toBeNull()
  })

  it('挑选 durationMs 最大的战斗作为模板', () => {
    const candidates = [
      {
        durationMs: 100_000,
        events: [makeEvent({ abilityId: 1, time: 5 })],
      },
      {
        durationMs: 300_000,
        events: [makeEvent({ abilityId: 1, time: 5 }), makeEvent({ abilityId: 2, time: 15 })],
      },
      {
        durationMs: 200_000,
        events: [makeEvent({ abilityId: 1, time: 5 })],
      },
    ]
    const result = buildEncounterTemplate({
      candidates,
      p50Map: { 1: 500, 2: 800 },
      threshold: 2, // ability=1 出现 3 场 OK, ability=2 只出现 1 场被过滤
    })
    expect(result?.templateSourceDurationMs).toBe(300_000)
    expect(result?.events).toHaveLength(1)
    expect(result?.events[0].abilityId).toBe(1)
  })

  it('过滤 abilityId 出现场数 < threshold 的事件', () => {
    const candidates = [
      {
        durationMs: 100,
        events: [makeEvent({ abilityId: 1, time: 1 }), makeEvent({ abilityId: 2, time: 2 })],
      },
      {
        durationMs: 200, // 最长
        events: [
          makeEvent({ abilityId: 1, time: 1 }),
          makeEvent({ abilityId: 2, time: 2 }),
          makeEvent({ abilityId: 99, time: 3 }), // 只在本场出现
        ],
      },
      {
        durationMs: 150,
        events: [makeEvent({ abilityId: 1, time: 1 }), makeEvent({ abilityId: 2, time: 2 })],
      },
    ]
    const result = buildEncounterTemplate({
      candidates,
      p50Map: {},
      threshold: 3,
    })
    // ability 1 出现 3 场 ✓, ability 2 出现 3 场 ✓, ability 99 出现 1 场 ✗
    expect(result?.events.map(e => e.abilityId).sort()).toEqual([1, 2])
  })

  it('同一场内同 abilityId 多次出现只算一场（去重）', () => {
    const candidates = [
      {
        durationMs: 200,
        events: [
          makeEvent({ abilityId: 1, time: 1 }),
          makeEvent({ abilityId: 1, time: 2 }), // 同场同 ability，算 1 场
        ],
      },
      { durationMs: 100, events: [makeEvent({ abilityId: 1, time: 1 })] },
    ]
    const result = buildEncounterTemplate({
      candidates,
      p50Map: {},
      threshold: 3,
    })
    // ability 1 只在 2 场出现（场数去重），< 3 被过滤
    expect(result?.events).toHaveLength(0)
  })

  it('damage 字段用 p50Map 覆盖，无 p50 时保留原值', () => {
    const candidates = [
      {
        durationMs: 100,
        events: [
          makeEvent({ abilityId: 1, time: 1, damage: 9999 }),
          makeEvent({ abilityId: 2, time: 2, damage: 8888 }),
        ],
      },
      {
        durationMs: 100,
        events: [
          makeEvent({ abilityId: 1, time: 1, damage: 9999 }),
          makeEvent({ abilityId: 2, time: 2, damage: 8888 }),
        ],
      },
      {
        durationMs: 100,
        events: [
          makeEvent({ abilityId: 1, time: 1, damage: 9999 }),
          makeEvent({ abilityId: 2, time: 2, damage: 8888 }),
        ],
      },
    ]
    const result = buildEncounterTemplate({
      candidates,
      p50Map: { 1: 500 }, // 只有 ability 1 有 p50
      threshold: 3,
    })
    const byId = Object.fromEntries(result!.events.map(e => [e.abilityId!, e.damage]))
    expect(byId[1]).toBe(500) // 被 p50 覆盖
    expect(byId[2]).toBe(8888) // fallback 到原值
  })

  it('每个事件带不同的 nanoid id', () => {
    const candidates = [
      {
        durationMs: 100,
        events: [makeEvent({ abilityId: 1, time: 1 }), makeEvent({ abilityId: 2, time: 2 })],
      },
      {
        durationMs: 100,
        events: [makeEvent({ abilityId: 1, time: 1 }), makeEvent({ abilityId: 2, time: 2 })],
      },
      {
        durationMs: 100,
        events: [makeEvent({ abilityId: 1, time: 1 }), makeEvent({ abilityId: 2, time: 2 })],
      },
    ]
    const result = buildEncounterTemplate({
      candidates,
      p50Map: {},
      threshold: 3,
    })
    const ids = result!.events.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length) // 所有 id 唯一
    for (const id of ids) expect(id).toMatch(/\S+/) // 非空
  })
})

// 轻量 in-memory KV mock（只覆盖 get/put/delete）— 模块级，供后续 describes 复用
function createMockKV(): KVNamespace & { _store: Map<string, string> } {
  const store = new Map<string, string>()
  const kv = {
    _store: store,
    async get(key: string, type?: 'json' | 'text') {
      const val = store.get(key)
      if (val === undefined) return null
      return type === 'json' ? JSON.parse(val) : val
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
    // 未使用的方法，塞 no-op
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null }
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null }
    },
  } as unknown as KVNamespace & { _store: Map<string, string> }
  return kv
}

describe('aggregateStatistics — encounter template 覆盖策略 A', () => {
  const encounterId = 1234

  function makeFightStat(
    reportCode: string,
    fightID: number,
    durationMs: number,
    events: StoredDamageEvent[]
  ): FightStatistics {
    return {
      encounterId,
      reportCode,
      fightID,
      damageByAbility: events.reduce<Record<number, number[]>>((acc, e) => {
        const id = e.abilityId ?? 0
        if (!acc[id]) acc[id] = []
        acc[id].push(e.damage)
        return acc
      }, {}),
      maxHPByJob: {} as FightStatistics['maxHPByJob'],
      shieldByAbility: {},
      healByAbility: {},
      durationMs,
      damageEvents: events,
    }
  }

  function makeSlim(abilityId: number, time: number, damage = 1000): StoredDamageEvent {
    return {
      name: `ability-${abilityId}`,
      time,
      damage,
      type: 'aoe',
      damageType: 'magical',
      abilityId,
    }
  }

  async function seedAndRun(
    kv: ReturnType<typeof createMockKV>,
    fights: Array<{ reportCode: string; fightID: number; stats: FightStatistics }>
  ) {
    for (const f of fights) {
      await kv.put(
        getFightStatisticsKVKey(encounterId, f.reportCode, f.fightID),
        JSON.stringify(f.stats)
      )
    }
    const task: StatisticsTask = {
      encounterId,
      encounterName: 'test',
      totalFights: fights.length,
      fights: fights.map(f => ({ reportCode: f.reportCode, fightID: f.fightID })),
      createdAt: new Date().toISOString(),
    }
    await aggregateStatistics(task, kv)
  }

  it('无旧模板 → 写入新模板', async () => {
    const kv = createMockKV()
    const events = [makeSlim(1, 1), makeSlim(2, 2)]
    await seedAndRun(kv, [
      { reportCode: 'a', fightID: 1, stats: makeFightStat('a', 1, 100_000, events) },
      { reportCode: 'b', fightID: 1, stats: makeFightStat('b', 1, 100_000, events) },
      { reportCode: 'c', fightID: 1, stats: makeFightStat('c', 1, 100_000, events) },
    ])
    const stored = await kv.get(getEncounterTemplateKVKey(encounterId), 'json')
    const template = stored as EncounterTemplate
    expect(template).not.toBeNull()
    expect(template.templateSourceDurationMs).toBe(100_000)
    expect(template.events).toHaveLength(2)
  })

  it('新 batch 更短 → 保持旧模板不动', async () => {
    const kv = createMockKV()
    const old: EncounterTemplate = {
      encounterId,
      events: [
        {
          id: 'old-1',
          name: 'old-event',
          time: 5,
          damage: 9999,
          type: 'aoe',
          damageType: 'magical',
          abilityId: 42,
        },
      ],
      templateSourceDurationMs: 500_000,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    await kv.put(getEncounterTemplateKVKey(encounterId), JSON.stringify(old))

    const events = [makeSlim(1, 1)]
    await seedAndRun(kv, [
      { reportCode: 'a', fightID: 1, stats: makeFightStat('a', 1, 100_000, events) },
      { reportCode: 'b', fightID: 1, stats: makeFightStat('b', 1, 100_000, events) },
      { reportCode: 'c', fightID: 1, stats: makeFightStat('c', 1, 100_000, events) },
    ])

    const stored = await kv.get(getEncounterTemplateKVKey(encounterId), 'json')
    const template = stored as EncounterTemplate
    expect(template.templateSourceDurationMs).toBe(500_000)
    expect(template.events[0].id).toBe('old-1') // 未动
  })

  it('新 batch 更长 → 覆盖旧模板', async () => {
    const kv = createMockKV()
    const old: EncounterTemplate = {
      encounterId,
      events: [],
      templateSourceDurationMs: 100_000,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    await kv.put(getEncounterTemplateKVKey(encounterId), JSON.stringify(old))

    const events = [makeSlim(1, 1)]
    await seedAndRun(kv, [
      { reportCode: 'a', fightID: 1, stats: makeFightStat('a', 1, 500_000, events) },
      { reportCode: 'b', fightID: 1, stats: makeFightStat('b', 1, 500_000, events) },
      { reportCode: 'c', fightID: 1, stats: makeFightStat('c', 1, 500_000, events) },
    ])

    const stored = await kv.get(getEncounterTemplateKVKey(encounterId), 'json')
    const template = stored as EncounterTemplate
    expect(template.templateSourceDurationMs).toBe(500_000)
    expect(template.events).toHaveLength(1)
  })
})
