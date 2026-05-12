/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { getStatisticsKVKey } from '../top100Sync'

const app = new Hono<AppEnv>()

app.get('/:encounterId', async c => {
  const encounterId = parseInt(c.req.param('encounterId'), 10)
  if (isNaN(encounterId)) {
    return c.json({ error: 'Invalid encounter ID' }, 400)
  }
  const data = await c.env.healerbook.get(getStatisticsKVKey(encounterId), 'json')
  if (!data) {
    return c.json({ error: 'Statistics not available yet. Sync may be pending.' }, 404)
  }
  return c.json(data)
})

export { app as statisticsRoutes }
