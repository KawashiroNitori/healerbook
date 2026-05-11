import { describe, it, expect } from 'vitest'
import {
  enqueueRankings,
  pickNextSample,
  validateEnqueueSamplesRequest,
  ENQUEUE_SAMPLES_MAX_REPORTS,
  type SampleQueueRow,
} from './samplesQueue'

/**
 * 内存 D1 mock：模拟本模块用到的两条 SQL：
 *   INSERT OR IGNORE INTO samples_queue (encounter_id, report_code, fight_id, duration_ms) VALUES (?,?,?,?)
 *   UPDATE samples_queue SET sampled = 1, sampled_at = ?, updated_at = ? WHERE id = (...) RETURNING ...
 */
function makeMockD1(initialRows: SampleQueueRow[] = []): D1Database {
  let nextId = initialRows.reduce((m, r) => Math.max(m, r.id), 0) + 1
  const rows: SampleQueueRow[] = [...initialRows]

  function pickAtomic(now: number): SampleQueueRow | null {
    const encounterMap = new Map<number, number | null>()
    for (const r of rows) {
      const cur = encounterMap.get(r.encounter_id)
      if (cur === undefined) encounterMap.set(r.encounter_id, r.sampled_at)
      else if (r.sampled_at !== null && (cur === null || r.sampled_at > cur)) {
        encounterMap.set(r.encounter_id, r.sampled_at)
      }
    }
    const encountersWithUnsampled = [...encounterMap.entries()].filter(([eid]) =>
      rows.some(r => r.encounter_id === eid && r.sampled === 0)
    )
    if (encountersWithUnsampled.length === 0) return null
    encountersWithUnsampled.sort((a, b) => {
      if (a[1] === null && b[1] !== null) return -1
      if (a[1] !== null && b[1] === null) return 1
      return (a[1] ?? 0) - (b[1] ?? 0)
    })
    const targetEncounter = encountersWithUnsampled[0][0]
    const candidates = rows.filter(r => r.encounter_id === targetEncounter && r.sampled === 0)
    const chosen = candidates[Math.floor(Math.random() * candidates.length)]
    chosen.sampled = 1
    chosen.sampled_at = now
    chosen.updated_at = now
    return { ...chosen }
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
          if (sql.startsWith('UPDATE samples_queue') && sql.includes('RETURNING')) {
            const [sampled_at] = args as [number, number]
            const result = pickAtomic(sampled_at)
            return (result as unknown as T) ?? null
          }
          throw new Error(`Unhandled first() SQL in mock: ${sql}`)
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

describe('pickNextSample', () => {
  it('无未采样行返回 null', async () => {
    const db = makeMockD1()
    const row = await pickNextSample(db)
    expect(row).toBeNull()
  })

  it('返回未采样行并标记 sampled=1', async () => {
    const db = makeMockD1()
    await enqueueRankings(db, 1001, [{ reportCode: 'AAA', fightID: 1, durationMs: 100_000 }])
    const row = await pickNextSample(db)
    expect(row).not.toBeNull()
    expect(row!.report_code).toBe('AAA')
    expect(row!.sampled).toBe(1)
    const second = await pickNextSample(db)
    expect(second).toBeNull()
  })

  it('优先返回 MAX(sampled_at) 最旧的 encounter', async () => {
    const db = makeMockD1()
    await enqueueRankings(db, 1001, [
      { reportCode: 'OLD', fightID: 1, durationMs: 100_000 },
      { reportCode: 'NEW', fightID: 2, durationMs: 100_000 },
    ])
    await pickNextSample(db)
    await enqueueRankings(db, 1002, [{ reportCode: 'NEVER', fightID: 1, durationMs: 100_000 }])
    const row = await pickNextSample(db)
    expect(row!.encounter_id).toBe(1002)
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

describe('pickNextSample - 多 encounter 排序', () => {
  it('两个 encounter 都已采样过时，MAX(sampled_at) 更旧的 encounter 优先', async () => {
    // 直接预置 4 行避开 wall-clock 依赖：encounter 1001 旧采样 + 1 未采样；encounter 1002 新采样 + 1 未采样
    const db = makeMockD1([
      {
        id: 1,
        encounter_id: 1001,
        report_code: 'A1',
        fight_id: 1,
        duration_ms: 100_000,
        sampled: 1,
        sampled_at: 1000, // 旧
        created_at: 1000,
        updated_at: 1000,
      },
      {
        id: 2,
        encounter_id: 1001,
        report_code: 'A2',
        fight_id: 2,
        duration_ms: 100_000,
        sampled: 0,
        sampled_at: null,
        created_at: 1000,
        updated_at: 1000,
      },
      {
        id: 3,
        encounter_id: 1002,
        report_code: 'B1',
        fight_id: 1,
        duration_ms: 100_000,
        sampled: 1,
        sampled_at: 2000, // 新
        created_at: 2000,
        updated_at: 2000,
      },
      {
        id: 4,
        encounter_id: 1002,
        report_code: 'B2',
        fight_id: 2,
        duration_ms: 100_000,
        sampled: 0,
        sampled_at: null,
        created_at: 2000,
        updated_at: 2000,
      },
    ])

    // 1001 的 MAX(sampled_at) = 1000 比 1002 的 2000 更旧 → 应优先 pick 1001 的未采样行
    const picked = await pickNextSample(db)
    expect(picked!.encounter_id).toBe(1001)
    expect(picked!.report_code).toBe('A2')
  })
})
