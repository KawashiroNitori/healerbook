/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { handleGetEncounterTemplate } from '../top100Sync'

const app = new Hono<AppEnv>()

app.get('/:encounterId', async c => {
  const encounterId = parseInt(c.req.param('encounterId'), 10)
  if (isNaN(encounterId)) {
    return c.json({ error: 'Invalid encounter ID' }, 400)
  }
  return handleGetEncounterTemplate(encounterId, c.env.healerbook)
})

export { app as encounterTemplatesRoutes }
