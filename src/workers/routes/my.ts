/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { requireAuth } from '../middleware/requireAuth'

interface DbListRow {
  id: string
  name: string
  published_at: number
  updated_at: number
  version: number
  content: string
}

interface TimelineListItem {
  id: string
  name: string
  publishedAt: number
  updatedAt: number
  version: number
  composition: unknown
}

const app = new Hono<AppEnv>()

app.get('/timelines', requireAuth, async c => {
  const auth = c.get('auth')!

  const result = await c.env.healerbook_timelines
    .prepare(
      'SELECT id, name, published_at, updated_at, version, content FROM timelines WHERE author_id = ? ORDER BY updated_at DESC'
    )
    .bind(auth.userId)
    .all<DbListRow>()

  const items: TimelineListItem[] = result.results.map(r => {
    const content = JSON.parse(r.content) as { composition?: unknown; c?: string[] }
    // 优先用 DO 回写的 composition;回退到旧格式 c(按槽位排列的职业数组)
    const composition =
      content.composition ??
      (content.c
        ? { players: content.c.map((job, i) => ({ id: i, job })).filter(p => p.job !== '') }
        : null)
    return {
      id: r.id,
      name: r.name,
      publishedAt: r.published_at,
      updatedAt: r.updated_at,
      version: r.version,
      composition,
    }
  })

  return c.json(items)
})

export { app as myRoutes }
