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

/**
 * 原子地选出"最久未采样的 encounter"中一条随机未采样行，标记为 sampled=1，并返回行内容。
 * 没有任何未采样行时返回 null。
 *
 * 排序：encounter 内 MAX(sampled_at) NULLS FIRST 升序（从未采样过的 encounter 最优先）。
 */
export async function pickNextSample(db: D1Database): Promise<SampleQueueRow | null> {
  const now = Math.floor(Date.now() / 1000)
  const result = await db
    .prepare(
      `UPDATE samples_queue
       SET sampled = 1, sampled_at = ?, updated_at = ?
       WHERE id = (
         SELECT s.id
         FROM samples_queue s
         JOIN (
           SELECT encounter_id
           FROM samples_queue
           WHERE EXISTS (
             SELECT 1 FROM samples_queue x
             WHERE x.encounter_id = samples_queue.encounter_id AND x.sampled = 0
           )
           GROUP BY encounter_id
           ORDER BY (MAX(sampled_at) IS NULL) DESC, MAX(sampled_at) ASC
           LIMIT 1
         ) e ON e.encounter_id = s.encounter_id
         WHERE s.sampled = 0
         ORDER BY RANDOM()
         LIMIT 1
       )
       RETURNING id, encounter_id, report_code, fight_id, duration_ms, sampled, sampled_at, created_at, updated_at`
    )
    .bind(now, now)
    .first<SampleQueueRow>()

  return result ?? null
}
