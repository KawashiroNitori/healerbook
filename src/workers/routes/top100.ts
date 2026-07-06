/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { createClient } from '../env'
import { requireSyncToken } from '../middleware/requireSyncToken'
import { syncAllTop100 } from '../top100Sync'
import { getTop100KVKey } from '../kvKeys'
import { ALL_ENCOUNTERS } from '@/data/raidEncounters'
import type { Top100Data } from '@/types/apiContracts'

const app = new Hono<AppEnv>()

app.get('/', async c => {
  const results: Record<number, Top100Data | null> = {}
  await Promise.all(
    ALL_ENCOUNTERS.map(async encounter => {
      const data = await c.env.healerbook.get(getTop100KVKey(encounter.id), 'json')
      results[encounter.id] = data as Top100Data | null
    })
  )
  return c.json(results)
})

app.post('/sync', requireSyncToken, async c => {
  const client = createClient(c.env)
  const result = await syncAllTop100(client, c.env.healerbook, c.env.healerbook_timelines)
  return c.json({
    message: `已完成同步：${result.success} 成功 / ${result.failed} 失败`,
    total: ALL_ENCOUNTERS.length,
    ...result,
  })
})

app.get('/:encounterId', async c => {
  const encounterId = parseInt(c.req.param('encounterId'), 10)
  if (isNaN(encounterId)) {
    return c.json({ error: 'Invalid encounter ID' }, 400)
  }
  const data = await c.env.healerbook.get(getTop100KVKey(encounterId), 'json')
  if (!data) {
    return c.json({ error: 'Data not available yet. Sync may be pending.' }, 404)
  }
  return c.json(data)
})

export { app as top100Routes }
