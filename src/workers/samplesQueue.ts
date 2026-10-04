/// <reference types="@cloudflare/workers-types" />

/**
 * D1 samples_queue 表的访问层。
 *
 * 表 DDL 见 migrations/0003_create_samples_queue.sql。
 */

import * as v from 'valibot'

export interface SampleQueueRow {
  id: number
  encounter_id: number
  report_code: string
  fight_id: number
  duration_ms: number
  sampled: number
  /** 整数秒（unix epoch），未采样时为 null */
  sampled_at: number | null
  /** 整数秒（unix epoch） */
  created_at: number
  /** 整数秒（unix epoch），应用层 UPDATE 时显式覆盖 */
  updated_at: number
}

export interface RankingEntryInput {
  reportCode: string
  fightID: number
  durationMs: number
}

export const ENQUEUE_SAMPLES_MAX_REPORTS = 20

/**
 * POST /api/samples-queue/enqueue 请求体 schema
 *
 * 调用方只提供 encounterId + 一批 reportCode；Worker 自行去 FFLogs 拉每个 report，
 * 从中挑 boss === encounterId 且 duration 最长的 fight 入队。
 */
export const EnqueueSamplesRequestSchema = v.object({
  encounterId: v.pipe(v.number(), v.integer()),
  reportCodes: v.pipe(
    v.array(v.pipe(v.string(), v.minLength(1))),
    v.minLength(1),
    v.maxLength(ENQUEUE_SAMPLES_MAX_REPORTS)
  ),
})

export function validateEnqueueSamplesRequest(
  input: unknown
): v.SafeParseResult<typeof EnqueueSamplesRequestSchema> {
  return v.safeParse(EnqueueSamplesRequestSchema, input)
}

/**
 * 批量入队。底层 INSERT OR IGNORE，重复 (reportCode, fightID) 自动跳过。
 * 返回真实写入条数（基于 D1 batch 各语句的 meta.changes 之和）。
 */
export async function enqueueRankings(
  db: D1Database,
  encounterId: number,
  entries: RankingEntryInput[]
): Promise<{ inserted: number }> {
  if (entries.length === 0) return { inserted: 0 }

  const stmts = entries.map(e =>
    db
      .prepare(
        'INSERT OR IGNORE INTO samples_queue (encounter_id, report_code, fight_id, duration_ms) VALUES (?, ?, ?, ?)'
      )
      .bind(encounterId, e.reportCode, e.fightID, e.durationMs)
  )

  const results = (await db.batch(stmts)) as Array<{ meta?: { changes?: number } }>
  const inserted = results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0)
  return { inserted }
}

/** 旧绝限期采样：北京时间 2026-10-12 01:47:29 起只采妖星乱舞。 */
export const LEGACY_SAMPLE_UNTIL = Date.parse('2026-10-11T17:47:29Z')

/** 旧绝采样期限内的统计采样范围。 */
export const SAMPLE_ENCOUNTER_IDS = [1085, 1073, 1074, 1075, 1076, 1077] as const

/**
 * 从采样范围内仍有未采样行的副本中随机选择一个，再挑该副本最新入队的一条。
 * 先选副本，避免队列较大的副本占据全部采样机会；范围外的队列保持不动。
 *
 * 非原子：选择与标记是独立 SQL；cron 单实例触发，实际并发概率近 0。
 */
export async function pickNextSample(db: D1Database): Promise<SampleQueueRow | null> {
  const encounterIds = Date.now() < LEGACY_SAMPLE_UNTIL ? SAMPLE_ENCOUNTER_IDS : [1085]
  const placeholders = encounterIds.map(() => '?').join(', ')
  const encounter = await db
    .prepare(
      `SELECT DISTINCT encounter_id FROM samples_queue
       WHERE sampled = 0 AND encounter_id IN (${placeholders})
       ORDER BY RANDOM()
       LIMIT 1`
    )
    .bind(...encounterIds)
    .first<{ encounter_id: number }>()
  if (!encounter) return null
  const encounterId = encounter.encounter_id

  const picked = await db
    .prepare(
      `SELECT id FROM samples_queue
       WHERE sampled = 0 AND encounter_id = ?
       ORDER BY id DESC
       LIMIT 1`
    )
    .bind(encounterId)
    .first<{ id: number }>()
  if (!picked) return null

  const now = Math.floor(Date.now() / 1000)
  const result = await db
    .prepare(
      `UPDATE samples_queue
       SET sampled = 1, sampled_at = ?, updated_at = ?
       WHERE id = ?
       RETURNING id, encounter_id, report_code, fight_id, duration_ms, sampled, sampled_at, created_at, updated_at`
    )
    .bind(now, now, picked.id)
    .first<SampleQueueRow>()

  return result ?? null
}
