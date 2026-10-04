import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  enqueueRankings,
  pickNextSample,
  validateEnqueueSamplesRequest,
  ENQUEUE_SAMPLES_MAX_REPORTS,
  SAMPLE_ENCOUNTER_IDS,
  LEGACY_SAMPLE_UNTIL,
  type SampleQueueRow,
} from './samplesQueue'

/**
 * 内存 D1 mock：模拟本模块用到的 SQL：
 *   INSERT OR IGNORE INTO samples_queue ...                                  (enqueue)
 *   SELECT DISTINCT encounter_id ... IN (...) ...                       (pick encounter)
 *   SELECT id FROM samples_queue WHERE sampled = 0 AND encounter_id = ? ORDER BY id DESC ... (pick step 1)
 *   UPDATE samples_queue SET sampled = 1, ... WHERE id = ? RETURNING ...    (pick step 2)
 */
function makeMockD1(initialRows: SampleQueueRow[] = []): D1Database {
  let nextId = initialRows.reduce((m, r) => Math.max(m, r.id), 0) + 1
  // 深拷贝避免后续 markSampled 改对象时污染调用方传入的 seed
  const rows: SampleQueueRow[] = initialRows.map(r => ({ ...r }))

  function pickLatestUnsampledId(encounterId: number): number | null {
    const candidates = rows.filter(r => r.encounter_id === encounterId && r.sampled === 0)
    if (candidates.length === 0) return null
    return candidates.reduce((max, r) => (r.id > max ? r.id : max), candidates[0].id)
  }

  function markSampled(id: number, now: number): SampleQueueRow | null {
    const row = rows.find(r => r.id === id)
    if (!row) return null
    row.sampled = 1
    row.sampled_at = now
    row.updated_at = now
    return { ...row }
  }

  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (sql.startsWith('INSERT OR IGNORE INTO samples_queue')) {
            const [encounter_id, report_code, fight_id, duration_ms] = args as [
              number,
              string,
              number,
              number,
            ]
            const dup = rows.some(r => r.report_code === report_code && r.fight_id === fight_id)
            if (dup) return { meta: { changes: 0 } }
            const now = Math.floor(Date.now() / 1000)
            rows.push({
              id: nextId++,
              encounter_id,
              report_code,
              fight_id,
              duration_ms,
              sampled: 0,
              sampled_at: null,
              created_at: now,
              updated_at: now,
            })
            return { meta: { changes: 1 } }
          }
          throw new Error(`Unhandled run() SQL in mock: ${sql}`)
        },
        first: async <T>(): Promise<T | null> => {
          if (sql.startsWith('SELECT DISTINCT encounter_id FROM samples_queue')) {
            const candidate = rows.find(r => r.sampled === 0 && args.includes(r.encounter_id))
            return candidate ? ({ encounter_id: candidate.encounter_id } as unknown as T) : null
          }
          if (
            sql.startsWith('SELECT id FROM samples_queue') &&
            sql.includes('encounter_id = ?') &&
            sql.includes('sampled = 0') &&
            sql.includes('ORDER BY id DESC')
          ) {
            const [encounterId] = args as [number]
            const id = pickLatestUnsampledId(encounterId)
            if (id === null) return null
            return { id } as unknown as T
          }
          if (sql.startsWith('UPDATE samples_queue') && sql.includes('RETURNING')) {
            const [sampled_at, , id] = args as [number, number, number]
            const result = markSampled(id, sampled_at)
            return (result as unknown as T) ?? null
          }
          throw new Error(`Unhandled bind().first() SQL in mock: ${sql}`)
        },
      }),
    }),
    batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
      const out: unknown[] = []
      for (const s of statements) out.push(await s.run())
      return out
    },
  } as unknown as D1Database
}

describe('enqueueRankings', () => {
  it('全新 entries 全部入队', async () => {
    const db = makeMockD1()
    const result = await enqueueRankings(db, 1001, [
      { reportCode: 'AAA', fightID: 1, durationMs: 100_000 },
      { reportCode: 'BBB', fightID: 2, durationMs: 200_000 },
    ])
    expect(result.inserted).toBe(2)
  })

  it('重复 (reportCode, fightID) 跳过', async () => {
    const db = makeMockD1()
    await enqueueRankings(db, 1001, [{ reportCode: 'AAA', fightID: 1, durationMs: 100_000 }])
    const result = await enqueueRankings(db, 1001, [
      { reportCode: 'AAA', fightID: 1, durationMs: 100_000 },
      { reportCode: 'CCC', fightID: 3, durationMs: 50_000 },
    ])
    expect(result.inserted).toBe(1)
  })

  it('空 entries 直接返回 inserted=0', async () => {
    const db = makeMockD1()
    const result = await enqueueRankings(db, 1001, [])
    expect(result.inserted).toBe(0)
  })
})

// 只测与选行策略无关的不变量：有可采行 → 返回并标记 sampled=1；没有 → null。
// "具体挑哪一行" 即策略本身，会随版本频繁改动，不在此固化。
describe('pickNextSample', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(LEGACY_SAMPLE_UNTIL - 1000)
  })

  afterEach(() => vi.useRealTimers())

  it.each([0, 1])('旧绝截止时间后自动跳过，妖星仍可采样（截止后 %i 毫秒）', async offset => {
    const db = makeMockD1()
    for (const encounterId of SAMPLE_ENCOUNTER_IDS) {
      await enqueueRankings(db, encounterId, [
        { reportCode: `EXPIRY-${encounterId}`, fightID: 1, durationMs: 100_000 },
      ])
    }
    vi.setSystemTime(LEGACY_SAMPLE_UNTIL + offset)
    expect((await pickNextSample(db))?.encounter_id).toBe(1085)
    expect(await pickNextSample(db)).toBeNull()
  })

  it.each([1085, 1073, 1074, 1075, 1076, 1077])('采样所选绝境战 %i', async encounterId => {
    const db = makeMockD1()
    await enqueueRankings(db, encounterId, [
      { reportCode: 'ULTIMATE', fightID: 1, durationMs: 100_000 },
    ])
    expect((await pickNextSample(db))?.encounter_id).toBe(encounterId)
  })

  it('范围外副本不采样，六个目标副本都有采样机会', async () => {
    const db = makeMockD1()
    for (const encounterId of [101, 1079, ...SAMPLE_ENCOUNTER_IDS]) {
      await enqueueRankings(db, encounterId, [
        { reportCode: `REPORT-${encounterId}`, fightID: 1, durationMs: 100_000 },
      ])
    }
    const sampled: number[] = []
    for (let i = 0; i < SAMPLE_ENCOUNTER_IDS.length; i++) {
      sampled.push((await pickNextSample(db))!.encounter_id)
    }
    expect(sampled.sort()).toEqual([...SAMPLE_ENCOUNTER_IDS].sort())
    expect(await pickNextSample(db)).toBeNull()
    expect(
      (
        await enqueueRankings(db, 101, [
          { reportCode: 'REPORT-101', fightID: 1, durationMs: 100_000 },
        ])
      ).inserted
    ).toBe(0)
  })

  it('同一副本优先采最新入队记录', async () => {
    const db = makeMockD1()
    await enqueueRankings(db, 1075, [
      { reportCode: 'OLD', fightID: 1, durationMs: 100_000 },
      { reportCode: 'NEW', fightID: 1, durationMs: 100_000 },
    ])
    expect((await pickNextSample(db))?.report_code).toBe('NEW')
    expect((await pickNextSample(db))?.report_code).toBe('OLD')
  })

  it('无可采行返回 null', async () => {
    const db = makeMockD1()
    const row = await pickNextSample(db)
    expect(row).toBeNull()
  })

  it('有可采行时返回该行并标记 sampled=1，采完返回 null', async () => {
    const db = makeMockD1()
    await enqueueRankings(db, SAMPLE_ENCOUNTER_IDS[0], [
      { reportCode: 'AAA', fightID: 1, durationMs: 100_000 },
    ])
    const row = await pickNextSample(db)
    expect(row).not.toBeNull()
    expect(row!.sampled).toBe(1)
    expect(row!.sampled_at).not.toBeNull()
    const second = await pickNextSample(db)
    expect(second).toBeNull()
  })
})

describe('validateEnqueueSamplesRequest', () => {
  it('合法 encounterId + reportCodes 通过', () => {
    const r = validateEnqueueSamplesRequest({
      encounterId: 101,
      reportCodes: ['AAA', 'BBB'],
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output.encounterId).toBe(101)
      expect(r.output.reportCodes).toEqual(['AAA', 'BBB'])
    }
  })

  it('reportCodes 为空数组报错', () => {
    const r = validateEnqueueSamplesRequest({ encounterId: 101, reportCodes: [] })
    expect(r.success).toBe(false)
  })

  it(`reportCodes 超过 ${ENQUEUE_SAMPLES_MAX_REPORTS} 条报错`, () => {
    const codes = Array.from({ length: ENQUEUE_SAMPLES_MAX_REPORTS + 1 }, (_, i) => `C${i}`)
    const r = validateEnqueueSamplesRequest({ encounterId: 101, reportCodes: codes })
    expect(r.success).toBe(false)
  })

  it('encounterId 非整数报错', () => {
    const r = validateEnqueueSamplesRequest({ encounterId: 1.5, reportCodes: ['A'] })
    expect(r.success).toBe(false)
  })

  it('缺失字段报错', () => {
    expect(validateEnqueueSamplesRequest({ reportCodes: ['A'] }).success).toBe(false)
    expect(validateEnqueueSamplesRequest({ encounterId: 101 }).success).toBe(false)
  })
})
