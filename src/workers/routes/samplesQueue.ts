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
        const matching = report.fights.filter(f => f.encounterID === encounterId)
        if (matching.length === 0) {
          return { reportCode, status: 'no-match' }
        }
        const kills = matching.filter(f => f.kill)
        const pool = kills.length > 0 ? kills : matching
        const longest = pool.reduce((best, f) =>
          f.endTime - f.startTime > best.endTime - best.startTime ? f : best
        )
        return {
          reportCode,
          status: 'ok',
          fightID: longest.id,
          durationMs: longest.endTime - longest.startTime,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[Enqueue] getReport(${reportCode}) failed: ${message}`)
        return { reportCode, status: 'error', message }
      }
    })
  )

  const okPicks = picks.filter((p): p is Extract<Pick, { status: 'ok' }> => p.status === 'ok')
  const entries = okPicks.map(p => ({
    reportCode: p.reportCode,
    fightID: p.fightID,
    durationMs: p.durationMs,
  }))

  const { inserted } = await enqueueRankings(c.env.healerbook_timelines, encounterId, entries)

  // 本批次 FFLogs 战斗记录中最长 duration（向下取整到整秒）；无匹配返回 0
  const maxDurationSec =
    okPicks.length === 0
      ? 0
      : Math.floor(okPicks.reduce((m, p) => (p.durationMs > m ? p.durationMs : m), 0) / 1000)

  return c.json({
    received: reportCodes.length,
    matched: entries.length,
    inserted,
    skippedDuplicates: entries.length - inserted,
    maxDurationSec,
    noMatch: picks.filter(p => p.status === 'no-match').map(p => p.reportCode),
    errors: picks
      .filter((p): p is Extract<Pick, { status: 'error' }> => p.status === 'error')
      .map(p => ({ reportCode: p.reportCode, message: p.message })),
  })
})

export { app as samplesQueueRoutes }
