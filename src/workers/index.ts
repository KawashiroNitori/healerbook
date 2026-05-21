/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppEnv, Env } from './env'
import { isAllowedOrigin } from './allowedOrigins'
import { authRoutes } from './routes/auth'
import { timelinesRoutes } from './routes/timelines'
import { myRoutes } from './routes/my'
import { fflogsRoutes } from './routes/fflogs'
import { top100Routes } from './routes/top100'
import { statisticsRoutes } from './routes/statistics'
import { encounterTemplatesRoutes } from './routes/encounterTemplates'
import { samplesQueueRoutes } from './routes/samplesQueue'
import { internalMigrateRoutes } from './routes/internalMigrate'
import { shareRoutes } from './routes/share'
import { handleScheduled } from './scheduled'
import { TimelineDoc } from './durable/TimelineDoc'

export type { Env }
export { TimelineDoc }

const app = new Hono<AppEnv>()

app.use(
  '*',
  cors({
    origin: (origin, c) => {
      if (c.env.ENVIRONMENT !== 'production') return '*'
      return isAllowedOrigin(origin) ? origin : null
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
)

app.onError((err, c) => {
  console.error('Worker error:', err)
  return c.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, 500)
})

app.notFound(c => c.json({ error: 'Not Found' }, 404))

app.route('/api/auth', authRoutes)
app.route('/api/timelines', timelinesRoutes)
app.route('/api/timelines', shareRoutes)
app.route('/api/my', myRoutes)
app.route('/api/fflogs', fflogsRoutes)
app.route('/api/top100', top100Routes)
app.route('/api/statistics', statisticsRoutes)
app.route('/api/encounter-templates', encounterTemplatesRoutes)
app.route('/api/samples-queue', samplesQueueRoutes)
app.route('/api/internal', internalMigrateRoutes)

export { app }

export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
}
