/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import { vValidator } from '@hono/valibot-validator'
import type { AppEnv } from '../env'
import { createClient } from '../env'
import { requireSyncToken } from '../middleware/requireSyncToken'
import { EnqueueSamplesRequestSchema, enqueueRankings } from '../samplesQueue'

const app = new Hono<AppEnv>()

app.post('/enqueue', requireSyncToken, vValidator('json', EnqueueSamplesRequestSchema), async c => {
  const { encounterId, reportCodes } = c.req.valid('json')
  const client = createClient(c.env)

  type Pick =
    | { reportCode: string; status: 'ok'; fightID: number; durationMs: number }
    | { reportCode: string; status: 'no-match' }
    | { reportCode: string; status: 'error'; message: string }

  const picks: Pick[] = await Promise.all(
    reportCodes.map(async (reportCode): Promise<Pick> => {
      try {
        const report = await client.getReport({ reportCode })
        const matching = report.fights.filter(f => f.boss === encounterId)
        if (matching.length === 0) {
          return { reportCode, status: 'no-match' }
        }
        const kills = matching.filter(f => f.kill)
        const pool = kills.length > 0 ? kills : matching
        const longest = pool.reduce((best, f) =>
          f.end_time - f.start_time > best.end_time - best.start_time ? f : best
        )
        return {
          reportCode,
          status: 'ok',
          fightID: longest.id,
          durationMs: longest.end_time - longest.start_time,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[Enqueue] getReport(${reportCode}) failed: ${message}`)
        return { reportCode, status: 'error', message }
      }
    })
  )

  const entries = picks
    .filter((p): p is Extract<Pick, { status: 'ok' }> => p.status === 'ok')
    .map(p => ({ reportCode: p.reportCode, fightID: p.fightID, durationMs: p.durationMs }))

  const { inserted } = await enqueueRankings(c.env.healerbook_timelines, encounterId, entries)

  return c.json({
    received: reportCodes.length,
    matched: entries.length,
    inserted,
    skippedDuplicates: entries.length - inserted,
    noMatch: picks.filter(p => p.status === 'no-match').map(p => p.reportCode),
    errors: picks
      .filter((p): p is Extract<Pick, { status: 'error' }> => p.status === 'error')
      .map(p => ({ reportCode: p.reportCode, message: p.message })),
  })
})

export { app as samplesQueueRoutes }
