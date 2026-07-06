/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { createClient } from '../env'
import { parseFightImport, resolveImportTimelineName, parseStatData } from '@/utils/fflogsImporter'
import { getStatisticsKVKey } from '../top100Sync'
import type { Timeline } from '@/types/timeline'
import { generateId } from '@/utils/id'
import { serializeForServer } from '@/utils/timelineFormat'

const app = new Hono<AppEnv>()

app.get('/report/:reportCode', async c => {
  const reportCode = c.req.param('reportCode')
  const client = createClient(c.env)
  const data = await client.getReport({ reportCode })
  return c.json(data)
})

app.get('/events/:reportCode', async c => {
  const reportCode = c.req.param('reportCode')
  const start = c.req.query('start')
  const end = c.req.query('end')

  if (!start || !end) {
    return c.json({ error: 'Missing start or end parameter' }, 400)
  }

  const client = createClient(c.env)
  const data = await client.getEvents({
    reportCode,
    start: parseFloat(start),
    end: parseFloat(end),
  })
  return c.json(data)
})

app.get('/import', async c => {
  const reportCode = c.req.query('reportCode')
  const fightIdParam = c.req.query('fightId')

  if (!reportCode) {
    return c.json({ error: 'Missing reportCode parameter' }, 400)
  }

  try {
    const client = createClient(c.env)
    const report = await client.getReport({ reportCode })

    let fightId: number
    if (fightIdParam) {
      fightId = parseInt(fightIdParam, 10)
      if (isNaN(fightId)) {
        return c.json({ error: 'Invalid fightId parameter' }, 400)
      }
    } else {
      if (!report.fights || report.fights.length === 0) {
        return c.json({ error: '报告中没有战斗记录' }, 404)
      }
      fightId = report.fights[report.fights.length - 1].id
    }

    const fight = report.fights?.find(f => f.id === fightId)
    if (!fight) {
      return c.json({ error: `战斗 #${fightId} 不存在` }, 404)
    }

    const eventsData = await client.getEvents({
      reportCode,
      start: fight.startTime,
      end: fight.endTime,
    })
    const events = eventsData.events || []

    const { composition, playerMap, damageEvents, castEvents, syncEvents } = parseFightImport(
      report,
      fight,
      events
    )

    const timelineName = resolveImportTimelineName(fight)

    // 未收录副本（KV 无聚合统计）→ 从本场事件提取 statData 填充数值设置。
    // KV 抖动按"已支持"保守处理，绝不阻断导入。
    let statData: ReturnType<typeof parseStatData>
    try {
      const statsExist = await c.env.healerbook.get(getStatisticsKVKey(fight.encounterID || 0))
      if (!statsExist) {
        statData = parseStatData(events, playerMap, composition)
      }
    } catch (err) {
      console.error('[FFLogs Import] statData 提取失败，跳过:', err)
    }

    const now = Math.floor(Date.now() / 1000)
    const timeline: Timeline = {
      id: generateId(),
      name: timelineName,
      encounter: {
        id: fight.encounterID || 0,
        name: fight.name,
        displayName: fight.name,
        zone: report.title || '',
        damageEvents: [],
      },
      // FFLogs 返回的游戏内 ZoneID，用于 Souma 导出时的副本识别（未预置在静态表的副本只能靠它）
      ...(fight.gameZoneId != null ? { gameZoneId: fight.gameZoneId } : {}),
      composition,
      damageEvents,
      castEvents,
      syncEvents,
      statusEvents: [],
      annotations: [],
      isReplayMode: true,
      fflogsSource: { reportCode, fightId },
      ...(statData ? { statData } : {}),
      createdAt: now,
      updatedAt: now,
    }

    return c.json(serializeForServer(timeline))
  } catch (error) {
    console.error('[FFLogs Import] Error:', error)
    return c.json({ error: error instanceof Error ? error.message : 'FFLogs API 调用失败' }, 502)
  }
})

export { app as fflogsRoutes }
