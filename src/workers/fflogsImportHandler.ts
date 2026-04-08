/**
 * FFLogs 导入处理器
 * GET /api/fflogs/import?reportCode=xxx&fightId=5
 * 将 FFLogs 数据获取和解析合并为一次请求，返回完整 Timeline 对象
 */

import { FFLogsClientV2 } from './fflogsClientV2'
import {
  parseComposition,
  parseDamageEvents,
  parseCastEvents,
  findFirstDamageTimestamp,
} from '@/utils/fflogsImporter'
import { getEncounterWithTier } from '@/data/raidEncounters'
import type { Timeline } from '@/types/timeline'
import type { FFLogsReport, FFLogsV1Report } from '@/types/fflogs'
import type { Env } from './fflogs-proxy'
import { customAlphabet } from 'nanoid'

const generateId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21
)

/**
 * 将 Worker 返回的 V1 格式报告转换为 FFLogsReport（复用前端 fflogsClient.ts 中的逻辑）
 */
function convertV1ToReport(v1Report: FFLogsV1Report, reportCode: string): FFLogsReport {
  return {
    code: reportCode,
    title: v1Report.title || '未命名报告',
    lang: v1Report.lang,
    startTime: v1Report.start,
    endTime: v1Report.end,
    fights: v1Report.fights.map(fight => ({
      id: fight.id,
      name: fight.name,
      difficulty: fight.difficulty,
      kill: fight.kill || false,
      startTime: fight.start_time,
      endTime: fight.end_time,
      encounterID: fight.boss,
    })),
    friendlies: v1Report.friendlies,
    enemies: v1Report.enemies,
    abilities: v1Report.abilities,
  }
}

export async function handleFFLogsImport(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const reportCode = url.searchParams.get('reportCode')
  const fightIdParam = url.searchParams.get('fightId')

  if (!reportCode) {
    return jsonResponse({ error: 'Missing reportCode parameter' }, 400)
  }

  if (!env.FFLOGS_CLIENT_ID || !env.FFLOGS_CLIENT_SECRET) {
    return jsonResponse({ error: 'FFLogs credentials not configured' }, 500)
  }

  const client = new FFLogsClientV2({
    clientId: env.FFLOGS_CLIENT_ID,
    clientSecret: env.FFLOGS_CLIENT_SECRET,
    kv: env.healerbook,
  })

  try {
    // 1. 获取报告元数据
    const v1Report = await client.getReport({ reportCode })
    const report = convertV1ToReport(v1Report, reportCode)

    // 2. 确定 fightId
    let fightId: number
    if (fightIdParam) {
      fightId = parseInt(fightIdParam, 10)
      if (isNaN(fightId)) {
        return jsonResponse({ error: 'Invalid fightId parameter' }, 400)
      }
    } else {
      if (!report.fights || report.fights.length === 0) {
        return jsonResponse({ error: '报告中没有战斗记录' }, 404)
      }
      fightId = report.fights[report.fights.length - 1].id
    }

    const fight = report.fights?.find(f => f.id === fightId)
    if (!fight) {
      return jsonResponse({ error: `战斗 #${fightId} 不存在` }, 404)
    }

    // 3. 获取全量事件
    const eventsData = await client.getEvents({
      reportCode,
      start: fight.startTime,
      end: fight.endTime,
    })

    // 4. 构建辅助映射
    const playerMap = new Map<number, { id: number; name: string; type: string }>()
    report.friendlies?.forEach(player => {
      playerMap.set(player.id, { id: player.id, name: player.name, type: player.type })
    })

    const abilityMap = new Map<number, { gameID: number; name: string; type: string | number }>()
    report.abilities?.forEach(ability => {
      abilityMap.set(ability.gameID, ability)
    })

    // 从事件中提取参与者
    const participantIds = new Set<number>()
    for (const event of eventsData.events || []) {
      if (event.sourceID && playerMap.has(event.sourceID)) participantIds.add(event.sourceID)
      if (event.targetID && playerMap.has(event.targetID)) participantIds.add(event.targetID)
    }

    // 5. 解析数据
    const composition = parseComposition(report, fightId, participantIds)
    const fightStartTime = findFirstDamageTimestamp(eventsData.events || [], fight.startTime)
    const damageEvents = parseDamageEvents(
      eventsData.events || [],
      fightStartTime,
      playerMap,
      abilityMap
    )
    const castEvents = parseCastEvents(eventsData.events || [], fightStartTime, playerMap)

    // 6. 构建时间轴名称
    let timelineName = fight.name || `战斗 ${fightId}`
    if (fight.encounterID) {
      const result = getEncounterWithTier(fight.encounterID)
      if (result) {
        timelineName = `${result.tier.name} - ${result.encounter.name}`
      }
    }

    // 7. 组装完整 Timeline
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
      composition,
      damageEvents,
      castEvents,
      statusEvents: [],
      annotations: [],
      isReplayMode: true,
      fflogsSource: { reportCode, fightId },
      createdAt: now,
      updatedAt: now,
    }

    return jsonResponse(timeline)
  } catch (error) {
    console.error('[FFLogs Import] Error:', error)
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'FFLogs API 调用失败' },
      502
    )
  }
}

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
