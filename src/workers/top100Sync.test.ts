import { describe, it, expect } from 'vitest'
import {
  mergeWithReservoirSampling,
  getSamplesKVKey,
  getStatisticsKVKey,
  calculatePercentiles,
  slimDamageEvents,
  buildEncounterTemplate,
  extractFightStats,
  getEncounterTemplateKVKey,
  getTop100KVKey,
  handleGetEncounterTemplate,
  processOneSample,
  syncEncounter,
  type StoredDamageEvent,
  type EncounterTemplate,
  type ExtractedFightData,
  type EncounterSamples,
  type Top100Data,
} from './top100Sync'
import type { SampleQueueRow } from './samplesQueue'
import { calculatePercentile } from '@/utils/stats'
import type { DamageEvent } from '@/types/timeline'
import type { FFLogsReport, FFLogsEvent } from '@/types/fflogs'
import type { EncounterStatistics } from '@/types/mitigation'
import type { Job } from '@/data/jobs'
import type { FFLogsClientV2, RankingEntry } from './fflogsClientV2'
import type { RaidEncounter } from '@/data/raidEncounters'

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
  it('剥离 id / playerDamageDetails 并提取 abilityId', () => {
    const full: DamageEvent[] = [
      {
        id: 'event-123',
        name: '死刑',
        time: 12.3,
        damage: 80000,
        type: 'tankbuster',
        damageType: 'physical',
        playerDamageDetails: [
          {
            timestamp: 12345,
            playerId: 5,
            job: 'WAR',
            abilityId: 40000,
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

describe('buildEncounterTemplate (single-fight)', () => {
  function makeSlim(abilityId: number, time: number, damage = 1000): StoredDamageEvent {
    return { name: `a-${abilityId}`, time, damage, type: 'aoe', damageType: 'magical', abilityId }
  }

  it('无旧模板 → 用本场骨架产出新模板', () => {
    const events = [makeSlim(1, 1, 100), makeSlim(2, 2, 200)]
    const result = buildEncounterTemplate({
      fightDurationMs: 120_000,
      fightEvents: events,
      p50Map: { 1: 555, 2: 666 },
      oldTemplate: null,
    })
    expect(result).not.toBeNull()
    expect(result!.templateSourceDurationMs).toBe(120_000)
    expect(result!.events).toHaveLength(2)
    const byId = Object.fromEntries(result!.events.map(e => [e.abilityId!, e.damage]))
    expect(byId[1]).toBe(555)
    expect(byId[2]).toBe(666)
  })

  it('本场更长 → 覆盖', () => {
    const oldTemplate = {
      encounterId: 1,
      events: [],
      templateSourceDurationMs: 100_000,
      updatedAt: 'x',
    }
    const result = buildEncounterTemplate({
      fightDurationMs: 100_001,
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate,
    })
    expect(result).not.toBeNull()
    expect(result!.templateSourceDurationMs).toBe(100_001)
  })

  it('本场等长 → 不覆盖（严格 >）', () => {
    const oldTemplate = {
      encounterId: 1,
      events: [],
      templateSourceDurationMs: 100_000,
      updatedAt: 'x',
    }
    const result = buildEncounterTemplate({
      fightDurationMs: 100_000,
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate,
    })
    expect(result).toBeNull()
  })

  it('本场更短 → 不覆盖', () => {
    const oldTemplate = {
      encounterId: 1,
      events: [],
      templateSourceDurationMs: 100_000,
      updatedAt: 'x',
    }
    const result = buildEncounterTemplate({
      fightDurationMs: 50_000,
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate,
    })
    expect(result).toBeNull()
  })

  it('damage 字段用 p50Map 覆盖，无 p50 时 fallback 到原值', () => {
    const result = buildEncounterTemplate({
      fightDurationMs: 100,
      fightEvents: [makeSlim(1, 1, 9999), makeSlim(2, 2, 8888)],
      p50Map: { 1: 500 },
      oldTemplate: null,
    })
    const byId = Object.fromEntries(result!.events.map(e => [e.abilityId!, e.damage]))
    expect(byId[1]).toBe(500)
    expect(byId[2]).toBe(8888)
  })

  it('每个事件带不同的 nanoid id', () => {
    const result = buildEncounterTemplate({
      fightDurationMs: 100,
      fightEvents: [makeSlim(1, 1), makeSlim(2, 2), makeSlim(3, 3)],
      p50Map: {},
      oldTemplate: null,
    })
    const ids = result!.events.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/\S+/)
  })

  it('空 events → 空 template（仍写）', () => {
    const result = buildEncounterTemplate({
      fightDurationMs: 100,
      fightEvents: [],
      p50Map: {},
      oldTemplate: null,
    })
    expect(result).not.toBeNull()
    expect(result!.events).toHaveLength(0)
  })

  it('产出 template 带 kill 字段（默认 false）', () => {
    const wipe = buildEncounterTemplate({
      fightDurationMs: 100,
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate: null,
    })
    expect(wipe!.kill).toBe(false)

    const kill = buildEncounterTemplate({
      fightDurationMs: 100,
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate: null,
      fightKill: true,
    })
    expect(kill!.kill).toBe(true)
  })

  it('kill 顶掉更长的 wipe（无视时长）', () => {
    const oldTemplate = {
      encounterId: 1,
      events: [],
      templateSourceDurationMs: 900_000,
      kill: false,
      updatedAt: 'x',
    }
    const result = buildEncounterTemplate({
      fightDurationMs: 500_000, // 比旧 wipe 短
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate,
      fightKill: true,
    })
    expect(result).not.toBeNull()
    expect(result!.kill).toBe(true)
    expect(result!.templateSourceDurationMs).toBe(500_000)
  })

  it('更长的 wipe 不顶掉已有 kill', () => {
    const oldTemplate = {
      encounterId: 1,
      events: [],
      templateSourceDurationMs: 500_000,
      kill: true,
      updatedAt: 'x',
    }
    const result = buildEncounterTemplate({
      fightDurationMs: 900_000, // 更长，但 wipe
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate,
      fightKill: false,
    })
    expect(result).toBeNull()
  })

  it('都是 kill → 本场更长才覆盖', () => {
    const oldTemplate = {
      encounterId: 1,
      events: [],
      templateSourceDurationMs: 500_000,
      kill: true,
      updatedAt: 'x',
    }
    expect(
      buildEncounterTemplate({
        fightDurationMs: 500_001,
        fightEvents: [makeSlim(1, 1)],
        p50Map: {},
        oldTemplate,
        fightKill: true,
      })
    ).not.toBeNull()
    expect(
      buildEncounterTemplate({
        fightDurationMs: 400_000,
        fightEvents: [makeSlim(1, 1)],
        p50Map: {},
        oldTemplate,
        fightKill: true,
      })
    ).toBeNull()
  })

  it('旧 template 无 kill 字段 → 按 wipe 处理，kill 仍可顶掉', () => {
    const legacyOld = {
      encounterId: 1,
      events: [],
      templateSourceDurationMs: 900_000,
      updatedAt: 'x',
    }
    const result = buildEncounterTemplate({
      fightDurationMs: 300_000,
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate: legacyOld,
      fightKill: true,
    })
    expect(result).not.toBeNull()
    expect(result!.kill).toBe(true)
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

describe('handleGetEncounterTemplate', () => {
  it('KV 无数据 → 返回空事件列表', async () => {
    const kv = createMockKV()
    const res = await handleGetEncounterTemplate(9999, kv)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      events: unknown[]
      updatedAt: string | null
      templateSourceDurationMs: number | null
      kill: boolean
    }
    expect(body.events).toEqual([])
    expect(body.updatedAt).toBeNull()
    expect(body.templateSourceDurationMs).toBeNull()
    expect(body.kill).toBe(false)
  })

  it('KV 有数据 → 返回 events + updatedAt + kill', async () => {
    const kv = createMockKV()
    const template: EncounterTemplate = {
      encounterId: 1234,
      events: [
        {
          id: 'e1',
          name: '死刑',
          time: 10,
          damage: 80000,
          type: 'tankbuster',
          damageType: 'physical',
          abilityId: 40000,
        },
      ],
      templateSourceDurationMs: 500_000,
      kill: true,
      updatedAt: '2026-04-14T00:00:00.000Z',
    }
    await kv.put(getEncounterTemplateKVKey(1234), JSON.stringify(template))

    const res = await handleGetEncounterTemplate(1234, kv)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      events: Array<{ id: string }>
      updatedAt: string | null
      templateSourceDurationMs: number | null
      kill: boolean
    }
    expect(body.events).toHaveLength(1)
    expect(body.events[0].id).toBe('e1')
    expect(body.updatedAt).toBe('2026-04-14T00:00:00.000Z')
    expect(body.templateSourceDurationMs).toBe(500_000)
    expect(body.kill).toBe(true)
  })

  it('KV 旧数据无 kill 字段 → 默认返回 false', async () => {
    const kv = createMockKV()
    await kv.put(
      getEncounterTemplateKVKey(1235),
      JSON.stringify({
        encounterId: 1235,
        events: [],
        templateSourceDurationMs: 100_000,
        updatedAt: '2026-04-14T00:00:00.000Z',
      })
    )
    const res = await handleGetEncounterTemplate(1235, kv)
    const body = (await res.json()) as { kill: boolean }
    expect(body.kill).toBe(false)
  })
})

describe('extractFightStats', () => {
  it('damage / heal / shield / maxHP 全提取，slim events 含 abilityId', () => {
    const fight = { id: 5, startTime: 1000, endTime: 121000 } as FFLogsReport['fights'][number]
    const report = {
      fights: [fight],
      friendlies: [{ id: 7, name: 'Healer', type: 'WhiteMage' }],
      abilities: [{ gameID: 50, name: 'Hit', type: 16 }],
      enemies: [],
      enemyPets: [],
      friendlyPets: [],
      lang: 'en',
      title: 't',
      owner: 'o',
      start: 0,
      end: 1,
      zone: 0,
    } as unknown as FFLogsReport

    const events = [
      {
        type: 'damage',
        timestamp: 1500,
        abilityGameID: 9999,
        unmitigatedAmount: 50000,
        sourceID: 99,
        targetID: 7,
      },
      {
        type: 'heal',
        timestamp: 1700,
        abilityGameID: 50,
        amount: 1000,
        sourceID: 7,
        targetID: 7,
        targetResources: { maxHitPoints: 80000 },
      },
      {
        type: 'absorbed',
        timestamp: 1800,
        abilityGameID: 1002613,
        amount: 3000,
        sourceID: 7,
        targetID: 7,
      },
    ] as unknown as FFLogsEvent[]

    const out = extractFightStats(report, fight, events)
    expect(out.durationMs).toBe(120000)
    expect(out.damageByAbility[9999]).toEqual([50000])
    expect(out.healByAbility[50]).toEqual([1000])
    expect(out.shieldByAbility[2613]).toEqual([3000])
    expect(Object.values(out.maxHPByJob).flat()).toContain(80000)
    expect(out.kill).toBe(false)
    if (out.damageEvents.length > 0) {
      expect(typeof out.damageEvents[0].abilityId).toBe('number')
    }
  })

  it('fight.kill=true → out.kill=true', () => {
    const fight = {
      id: 5,
      startTime: 1000,
      endTime: 121000,
      kill: true,
    } as FFLogsReport['fights'][number]
    const report = {
      fights: [fight],
      friendlies: [],
      abilities: [],
      enemies: [],
      enemyPets: [],
      friendlyPets: [],
      lang: 'en',
      title: 't',
      owner: 'o',
      start: 0,
      end: 1,
      zone: 0,
    } as unknown as FFLogsReport

    const out = extractFightStats(report, fight, [])
    expect(out.kill).toBe(true)
  })
})

describe('processOneSample', () => {
  const encounterId = 1234
  const encounterName = 'Test Encounter'

  it('队列空 → 直接返回 false，KV 无变更', async () => {
    const kv = createMockKV()
    const db = makeMockD1Empty()
    const ranOnce = await processOneSample({
      db,
      kv,
      fetchExtracted: async () => {
        throw new Error('should not be called')
      },
      lookupEncounterName: () => encounterName,
    })
    expect(ranOnce).toBe(false)
    expect(kv._store.size).toBe(0)
  })

  it('首次采样：写 samples / statistics / template，且累加 abilityFightCount', async () => {
    const kv = createMockKV()
    const db = makeMockD1WithRow({
      id: 1,
      encounter_id: encounterId,
      report_code: 'A',
      fight_id: 1,
      duration_ms: 120_000,
      sampled: 0,
      sampled_at: null,
      created_at: 0,
      updated_at: 0,
    })
    const extracted: ExtractedFightData = {
      damageByAbility: { 9999: [50_000, 60_000], 8888: [10_000] },
      shieldByAbility: { 2613: [3000] },
      maxHPByJob: { WHM: [80_000] } as Record<Job, number[]>,
      healByAbility: { 50: [1000, 1500] },
      durationMs: 120_000,
      kill: false,
      damageEvents: [
        {
          name: 'a-9999',
          time: 1,
          damage: 55_000,
          type: 'aoe',
          damageType: 'magical',
          abilityId: 9999,
        },
        {
          name: 'a-9999',
          time: 5,
          damage: 55_000,
          type: 'aoe',
          damageType: 'magical',
          abilityId: 9999,
        },
        {
          name: 'a-8888',
          time: 7,
          damage: 10_000,
          type: 'aoe',
          damageType: 'magical',
          abilityId: 8888,
        },
      ],
    }

    const ranOnce = await processOneSample({
      db,
      kv,
      fetchExtracted: async () => extracted,
      lookupEncounterName: () => encounterName,
    })
    expect(ranOnce).toBe(true)

    const samples = (await kv.get(getSamplesKVKey(encounterId), 'json')) as EncounterSamples
    expect(samples.damageByAbility[9999]).toEqual([50_000, 60_000])
    expect(samples.healByAbility[50]).toEqual([1000, 1500])

    const stats = (await kv.get(getStatisticsKVKey(encounterId), 'json')) as EncounterStatistics
    expect(stats.totalFightsSampled).toBe(1)
    expect(stats.abilityFightCount[9999]).toBe(1)
    expect(stats.abilityFightCount[8888]).toBe(1)
    expect(stats.damageByAbility[9999]).toBeGreaterThan(0)

    const tpl = (await kv.get(getEncounterTemplateKVKey(encounterId), 'json')) as EncounterTemplate
    expect(tpl.templateSourceDurationMs).toBe(120_000)
    expect(tpl.events.length).toBeGreaterThan(0)
    expect(tpl.kill).toBe(false)
  })

  it('kill 场：template.kill=true，且更短的 kill 也能顶掉更长的旧 wipe', async () => {
    const kv = createMockKV()
    await kv.put(
      getEncounterTemplateKVKey(encounterId),
      JSON.stringify({
        encounterId,
        events: [],
        templateSourceDurationMs: 900_000,
        kill: false,
        updatedAt: 'old',
      } satisfies EncounterTemplate)
    )
    const db = makeMockD1WithRow({
      id: 9,
      encounter_id: encounterId,
      report_code: 'K',
      fight_id: 1,
      duration_ms: 300_000,
      sampled: 0,
      sampled_at: null,
      created_at: 0,
      updated_at: 0,
    })

    await processOneSample({
      db,
      kv,
      fetchExtracted: async () => ({
        damageByAbility: { 9999: [50_000] },
        shieldByAbility: {},
        maxHPByJob: {} as Record<Job, number[]>,
        healByAbility: {},
        durationMs: 300_000, // 比旧 wipe 短
        kill: true,
        damageEvents: [
          {
            name: 'a-9999',
            time: 1,
            damage: 50_000,
            type: 'aoe',
            damageType: 'magical',
            abilityId: 9999,
          },
        ],
      }),
      lookupEncounterName: () => encounterName,
    })

    const tpl = (await kv.get(getEncounterTemplateKVKey(encounterId), 'json')) as EncounterTemplate
    expect(tpl.kill).toBe(true)
    expect(tpl.templateSourceDurationMs).toBe(300_000)
  })

  it('第二次采样：abilityFightCount/totalFightsSampled 累加，旧字段不丢', async () => {
    const kv = createMockKV()
    await kv.put(
      getStatisticsKVKey(encounterId),
      JSON.stringify({
        encounterId,
        encounterName,
        damageByAbility: { 9999: 50000 },
        maxHPByJob: {},
        shieldByAbility: {},
        critShieldByAbility: {},
        healByAbility: {},
        critHealByAbility: {},
        sampleSize: 2,
        abilityFightCount: { 9999: 1, 8888: 1 },
        totalFightsSampled: 1,
        updatedAt: 'old',
      } satisfies EncounterStatistics)
    )
    await kv.put(
      getSamplesKVKey(encounterId),
      JSON.stringify({
        encounterId,
        damageByAbility: { 9999: [50_000, 60_000], 8888: [10_000] },
        shieldByAbility: {},
        maxHPByJob: {},
        healByAbility: {},
        updatedAt: 'old',
      })
    )

    const db = makeMockD1WithRow({
      id: 2,
      encounter_id: encounterId,
      report_code: 'B',
      fight_id: 1,
      duration_ms: 100_000,
      sampled: 0,
      sampled_at: null,
      created_at: 0,
      updated_at: 0,
    })
    const extracted: ExtractedFightData = {
      damageByAbility: { 9999: [70_000], 7777: [20_000] },
      shieldByAbility: {},
      maxHPByJob: {} as Record<Job, number[]>,
      healByAbility: {},
      durationMs: 100_000,
      kill: false,
      damageEvents: [
        {
          name: 'a-9999',
          time: 1,
          damage: 70_000,
          type: 'aoe',
          damageType: 'magical',
          abilityId: 9999,
        },
        {
          name: 'a-7777',
          time: 2,
          damage: 20_000,
          type: 'aoe',
          damageType: 'magical',
          abilityId: 7777,
        },
      ],
    }

    await processOneSample({
      db,
      kv,
      fetchExtracted: async () => extracted,
      lookupEncounterName: () => encounterName,
    })

    const stats = (await kv.get(getStatisticsKVKey(encounterId), 'json')) as EncounterStatistics
    expect(stats.totalFightsSampled).toBe(2)
    expect(stats.abilityFightCount[9999]).toBe(2)
    expect(stats.abilityFightCount[8888]).toBe(1)
    expect(stats.abilityFightCount[7777]).toBe(1)
  })

  it('本场更短 → template 不更新', async () => {
    const kv = createMockKV()
    await kv.put(
      getEncounterTemplateKVKey(encounterId),
      JSON.stringify({
        encounterId,
        events: [],
        templateSourceDurationMs: 999_000,
        updatedAt: 'old',
      } satisfies EncounterTemplate)
    )

    const db = makeMockD1WithRow({
      id: 3,
      encounter_id: encounterId,
      report_code: 'C',
      fight_id: 1,
      duration_ms: 100_000,
      sampled: 0,
      sampled_at: null,
      created_at: 0,
      updated_at: 0,
    })

    await processOneSample({
      db,
      kv,
      fetchExtracted: async () => ({
        damageByAbility: {},
        shieldByAbility: {},
        maxHPByJob: {} as Record<Job, number[]>,
        healByAbility: {},
        durationMs: 100_000,
        kill: false,
        damageEvents: [],
      }),
      lookupEncounterName: () => encounterName,
    })
    const tpl = (await kv.get(getEncounterTemplateKVKey(encounterId), 'json')) as EncounterTemplate
    expect(tpl.templateSourceDurationMs).toBe(999_000)
  })
})

/**
 * pickNextSample 拆成三条 SQL：
 *   1. prepare(SELECT DISTINCT encounter_id ...).first()      ← 无 bind
 *   2. prepare(SELECT id ...).bind(encounterId).first()
 *   3. prepare(UPDATE ... RETURNING).bind(now, now, id).first()
 */
function makeMockD1Empty(): D1Database {
  return {
    prepare: () => ({
      first: async () => null,
      bind: () => ({ first: async () => null }),
    }),
  } as unknown as D1Database
}
function makeMockD1WithRow(row: SampleQueueRow): D1Database {
  let consumed = false
  return {
    prepare: (sql: string) => ({
      first: async () => {
        if (consumed) return null
        return { encounter_id: row.encounter_id }
      },
      bind: () => ({
        first: async () => {
          if (consumed) return null
          if (sql.includes('UPDATE')) {
            consumed = true
            const now = Math.floor(Date.now() / 1000)
            return { ...row, sampled: 1, sampled_at: now, updated_at: now }
          }
          return { id: row.id }
        },
      }),
    }),
  } as unknown as D1Database
}

describe('syncEncounter (new behavior)', () => {
  it('写 top100 KV（无 TTL）+ 入队所有 entries 到 D1', async () => {
    const kv = createMockKV()
    const inserted: Array<{
      encounterId: number
      reportCode: string
      fightID: number
      durationMs: number
    }> = []
    const db = {
      batch: async (stmts: Array<{ run: () => Promise<unknown> }>) => {
        return Promise.all(stmts.map(s => s.run()))
      },
      prepare: () => ({
        bind: (encounterId: number, reportCode: string, fightID: number, durationMs: number) => {
          inserted.push({ encounterId, reportCode, fightID, durationMs })
          return { run: async () => ({ meta: { changes: 1 } }) }
        },
      }),
    } as unknown as D1Database

    const fakeClient = {
      getEncounterRankings: async () => ({
        encounterName: 'TestE',
        entries: [
          { reportCode: 'R1', fightID: 1, duration: 100_000 } as unknown as RankingEntry,
          { reportCode: 'R2', fightID: 1, duration: 200_000 } as unknown as RankingEntry,
        ],
      }),
    } as unknown as FFLogsClientV2

    const encounter = { id: 1234, name: 'TestE', shortName: 'TE' } as RaidEncounter

    await syncEncounter(encounter, fakeClient, kv, db)

    const top100 = (await kv.get(getTop100KVKey(1234), 'json')) as Top100Data
    expect(top100.entries).toHaveLength(2)
    expect(inserted).toHaveLength(2)
    expect(inserted[0].reportCode).toBe('R1')
    expect(inserted[0].durationMs).toBe(100_000)
    expect(inserted[1].durationMs).toBe(200_000)
  })
})
