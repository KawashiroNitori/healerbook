/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { createClient } from '../env'
import {
  parseComposition,
  parseDamageEvents,
  parseCastEvents,
  parseSyncEvents,
  findFirstDamageTimestamp,
  convertV1ToReport,
  parseStatData,
  buildBossIds,
} from '@/utils/fflogsImporter'
import { getEncounterWithTier } from '@/data/raidEncounters'
import { getStatisticsKVKey } from '../top100Sync'
import type { Timeline } from '@/types/timeline'
import { generateId } from '@/utils/id'
import { serializeForServer } from '@/utils/timelineFormat'

const app = new Hono<AppEnv>()

app.get('/report/:reportCode', async c => {
  const reportCode = c.req.param('reportCode')
  try {
    const client = createClient(c.env)
    const data = await client.getReport({ reportCode })
    return c.json(data)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
})

app.get('/events/:reportCode', async c => {
  const reportCode = c.req.param('reportCode')
  const start = c.req.query('start')
  const end = c.req.query('end')
  const lang = c.req.query('lang') || undefined

  if (!start || !end) {
    return c.json({ error: 'Missing start or end parameter' }, 400)
  }

  try {
    const client = createClient(c.env)
    const data = await client.getEvents({
      reportCode,
      start: parseFloat(start),
      end: parseFloat(end),
      lang,
    })
    return c.json(data)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
})

app.get('/import', async c => {
  const reportCode = c.req.query('reportCode')
  const fightIdParam = c.req.query('fightId')

  if (!reportCode) {
    return c.json({ error: 'Missing reportCode parameter' }, 400)
  }

  try {
    const client = createClient(c.env)
    const v1Report = await client.getReport({ reportCode })
    const report = convertV1ToReport(v1Report, reportCode)

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

    const playerMap = new Map<number, { id: number; name: string; type: string }>()
    report.friendlies?.forEach(player => {
      playerMap.set(player.id, { id: player.id, name: player.name, type: player.type })
    })

    const abilityMap = new Map<number, { gameID: number; name: string; type: string | number }>()
    report.abilities?.forEach(ability => {
      abilityMap.set(ability.gameID, ability)
    })

    const participantIds = new Set<number>()
    for (const event of eventsData.events || []) {
      if (event.sourceID && playerMap.has(event.sourceID)) participantIds.add(event.sourceID)
      if (event.targetID && playerMap.has(event.targetID)) participantIds.add(event.targetID)
    }

    const composition = parseComposition(report, fightId, participantIds)
    const fightStartTime = findFirstDamageTimestamp(eventsData.events || [], fight.startTime)
    const bossIds = buildBossIds(report.enemies, fight.name)
    const damageEvents = parseDamageEvents(
      eventsData.events || [],
      fightStartTime,
      playerMap,
      abilityMap,
      composition,
      bossIds
    )
    const castEvents = parseCastEvents(eventsData.events || [], fightStartTime, playerMap)
    const syncEvents = parseSyncEvents(
      eventsData.events || [],
      fightStartTime,
      playerMap,
      abilityMap
    )

    let timelineName = fight.name || `战斗 ${fightId}`
    if (fight.encounterID) {
      const result = getEncounterWithTier(fight.encounterID)
      if (result) {
        // 单副本 tier（如绝境战）的 tier.name === encounter.name，避免拼成 "X - X"
        timelineName =
          result.tier.name === result.encounter.name
            ? result.tier.name
            : `${result.tier.name} - ${result.encounter.name}`
      }
    }

    // 未收录副本（KV 无聚合统计）→ 从本场事件提取 statData 填充数值设置。
    // KV 抖动按"已支持"保守处理，绝不阻断导入。
    let statData: ReturnType<typeof parseStatData>
    try {
      const statsExist = await c.env.healerbook.get(getStatisticsKVKey(fight.encounterID || 0))
      if (!statsExist) {
        statData = parseStatData(eventsData.events || [], playerMap, composition)
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
