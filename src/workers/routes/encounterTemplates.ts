/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import type { AppEnv } from '../env'
import type { EncounterTemplateResponse } from '@/types/apiContracts'
import type { EncounterTemplate } from '../encounterTemplate'
import { getEncounterTemplateKVKey } from '../kvKeys'

const app = new Hono<AppEnv>()

// 返回副本模板（含预填充伤害事件）；KV 无数据时返回空列表
app.get('/:encounterId', async c => {
  const encounterId = parseInt(c.req.param('encounterId'), 10)
  if (isNaN(encounterId)) {
    return c.json({ error: 'Invalid encounter ID' }, 400)
  }

  const headers = { 'Cache-Control': 'public, max-age=3600' }
  const data = await c.env.healerbook.get(getEncounterTemplateKVKey(encounterId), 'json')
  if (!data) {
    const empty: EncounterTemplateResponse = {
      events: [],
      updatedAt: null,
      templateSourceDurationMs: null,
      kill: false,
    }
    return c.json(empty, 200, headers)
  }
  const template = data as EncounterTemplate
  // 裁掉内部字段 abilityId，使线上响应与契约一致
  const body: EncounterTemplateResponse = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    events: template.events.map(({ abilityId: _abilityId, ...e }) => e),
    updatedAt: template.updatedAt,
    templateSourceDurationMs: template.templateSourceDurationMs,
    kill: template.kill ?? false,
  }
  return c.json(body, 200, headers)
})

export { app as encounterTemplatesRoutes }
