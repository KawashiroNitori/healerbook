/**
 * TOP100 数据同步模块
 *
 * 通过 FFLogs V2 API 获取每个副本治疗 HPS 前 100 的战斗记录，存入 Cloudflare KV
 *
 * KV 键格式：top100:encounter:{encounterId}
 */

import { FFLogsClientV2, type RankingEntry } from './fflogsClientV2'
import { ALL_ENCOUNTERS, type RaidEncounter } from '../src/data/raidEncounters'
import { KVNamespace } from '@cloudflare/workers-types/experimental'
import type { FFLogsEvent, FFLogsV1Report } from '../src/types/fflogs'

/** KV 中存储的 TOP100 数据结构 */
export interface Top100Data {
  encounterId: number
  encounterName: string
  entries: RankingEntry[]
  /** ISO 8601 时间戳 */
  updatedAt: string
}

/** 遭遇战统计数据 */
export interface EncounterStatistics {
  encounterId: number
  encounterName: string
  /** 每个伤害技能的平均伤害值 */
  damageByAbility: Record<number, number>
  /** 每个职业的平均最大生命值 */
  maxHPByJob: Record<string, number>
  /** 每个盾值技能的平均盾值 */
  shieldByAbility: Record<number, number>
  /** 采样战斗数量 */
  sampleSize: number
  /** ISO 8601 时间戳 */
  updatedAt: string
}

/** 获取 TOP100 数据的 KV 键名 */
export function getTop100KVKey(encounterId: number): string {
  return `top100:encounter:${encounterId}`
}

/** 获取统计数据的 KV 键名 */
export function getStatisticsKVKey(encounterId: number): string {
  return `statistics:encounter:${encounterId}`
}

/**
 * 从事件列表中提取伤害数据
 */
function extractDamageData(events: FFLogsEvent[]): Record<number, number[]> {
  const damageByAbility: Record<number, number[]> = {}

  for (const event of events) {
    if (event.type === 'damage' && event.abilityGameID && event.unmitigatedAmount) {
      if (!damageByAbility[event.abilityGameID]) {
        damageByAbility[event.abilityGameID] = []
      }
      damageByAbility[event.abilityGameID].push(event.unmitigatedAmount)
    }
  }

  return damageByAbility
}

/**
 * 从事件列表中提取盾值数据
 * 从 absorbed 类型的事件中提取盾值技能 ID 和数值
 * 注意：abilityGameID 需要减去 1000000 偏移值得到真实的状态 ID
 */
function extractShieldData(events: FFLogsEvent[]): Record<number, number[]> {
  const shieldByAbility: Record<number, number[]> = {}

  for (const event of events) {
    if (event.type === 'absorbed' && event.abilityGameID && event.amount) {
      // 减去 100 万偏移值得到真实的状态 ID
      const statusId = event.abilityGameID - 1000000
      if (!shieldByAbility[statusId]) {
        shieldByAbility[statusId] = []
      }
      shieldByAbility[statusId].push(event.amount)
    }
  }

  return shieldByAbility
}

/**
 * 从事件列表中提取最大生命值数据
 * 从 absorbed 类型的事件中提取目标的最大生命值
 */
function extractMaxHPData(
  events: FFLogsEvent[],
  report: FFLogsV1Report
): Record<string, number[]> {
  const maxHPByJob: Record<string, number[]> = {}

  for (const event of events) {
    // absorbed 事件的 targetResources 包含 maxHitPoints 字段
    if (event.type === 'absorbed') {
      const targetResources = (event as any).targetResources
      if (targetResources) {
        const maxHP = targetResources.maxHitPoints
        const targetID = event.targetID
        if (maxHP && maxHP > 0 && targetID) {
          const actor = report.friendlies?.find((a) => a.id === targetID)
          if (actor && actor.type) {
            if (!maxHPByJob[actor.type]) {
              maxHPByJob[actor.type] = []
            }
            maxHPByJob[actor.type].push(maxHP)
          }
        }
      }
    }
  }

  return maxHPByJob
}

/**
 * 计算平均值并取整
 */
function calculateAverages<T extends number | string>(
  data: Record<T, number[]>
): Record<T, number> {
  const averages: Record<string, number> = {}

  for (const [key, values] of Object.entries(data)) {
    if (values.length > 0) {
      const avg = values.reduce((sum, val) => sum + val, 0) / values.length
      averages[key] = Math.round(avg)
    }
  }

  return averages as Record<T, number>
}

/**
 * 从战斗记录中提取统计数据
 */
async function extractStatistics(
  client: FFLogsClientV2,
  entries: RankingEntry[],
  sampleSize: number = 10
): Promise<EncounterStatistics> {
  // 随机抽取战斗
  const sampledEntries = entries
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.min(sampleSize, entries.length))

  // 并行处理所有采样的战斗
  const results = await Promise.allSettled(
    sampledEntries.map(async (entry) => {
      // 获取战斗报告
      const report = await client.getReport({ reportCode: entry.reportCode })
      const fight = report.fights.find((f) => f.id === entry.fightID)
      if (!fight) {
        throw new Error(`Fight ${entry.fightID} not found`)
      }

      // 获取战斗事件
      const eventsResponse = await client.getEvents({
        reportCode: entry.reportCode,
        start: fight.startTime,
        end: fight.endTime,
      })

      // 提取各类数据
      return {
        damageData: extractDamageData(eventsResponse.events),
        shieldData: extractShieldData(eventsResponse.events),
        maxHPData: extractMaxHPData(eventsResponse.events, report),
      }
    })
  )

  // 合并所有成功的结果
  const allDamageData: Record<number, number[]> = {}
  const allMaxHPData: Record<string, number[]> = {}
  const allShieldData: Record<number, number[]> = {}

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { damageData, shieldData, maxHPData } = result.value

      // 合并伤害数据
      for (const [abilityId, damages] of Object.entries(damageData)) {
        if (!allDamageData[Number(abilityId)]) {
          allDamageData[Number(abilityId)] = []
        }
        allDamageData[Number(abilityId)].push(...damages)
      }

      // 合并盾值数据
      for (const [abilityId, shields] of Object.entries(shieldData)) {
        if (!allShieldData[Number(abilityId)]) {
          allShieldData[Number(abilityId)] = []
        }
        allShieldData[Number(abilityId)].push(...shields)
      }

      // 合并最大生命值数据
      for (const [job, hps] of Object.entries(maxHPData)) {
        if (!allMaxHPData[job]) {
          allMaxHPData[job] = []
        }
        allMaxHPData[job].push(...hps)
      }
    } else {
      console.error(`[TOP100] 提取统计数据失败:`, result.reason)
    }
  }

  // 计算平均值
  const avgDamageByAbility = calculateAverages(allDamageData)
  const avgShieldByAbility = calculateAverages(allShieldData)
  const avgMaxHPByJob = calculateAverages(allMaxHPData)

  return {
    damageByAbility: avgDamageByAbility,
    maxHPByJob: avgMaxHPByJob,
    shieldByAbility: avgShieldByAbility,
    sampleSize: results.filter((r) => r.status === 'fulfilled').length,
  }
}

/**
 * 为单个遭遇战同步 TOP100 数据到 KV
 */
async function syncEncounter(
  encounter: RaidEncounter,
  client: FFLogsClientV2,
  kv: KVNamespace
): Promise<void> {
  console.log(`[TOP100] 同步遭遇战: ${encounter.shortName} (id=${encounter.id})`)

  // 获取排行榜数据
  const result = await client.getEncounterRankings({
    encounterId: encounter.id,
  })

  // 提取统计数据（内部已并行化）
  const statistics = await extractStatistics(client, result.entries, 10)

  const encounterName = result.encounterName || encounter.name
  const now = new Date().toISOString()

  // 构建数据对象
  const top100Data: Top100Data = {
    encounterId: encounter.id,
    encounterName,
    entries: result.entries,
    updatedAt: now,
  }

  const statisticsData: EncounterStatistics = {
    encounterId: encounter.id,
    encounterName,
    damageByAbility: statistics.damageByAbility,
    maxHPByJob: statistics.maxHPByJob,
    shieldByAbility: statistics.shieldByAbility,
    sampleSize: statistics.sampleSize,
    updatedAt: now,
  }

  // 并行写入 KV
  await Promise.all([
    kv.put(getTop100KVKey(encounter.id), JSON.stringify(top100Data), {
      expirationTtl: 25 * 60 * 60,
    }),
    kv.put(getStatisticsKVKey(encounter.id), JSON.stringify(statisticsData), {
      expirationTtl: 25 * 60 * 60,
    }),
  ])

  console.log(
    `[TOP100] ${encounter.shortName}: 已同步 ${result.entries.length} 条记录，采样 ${statistics.sampleSize} 场战斗`
  )
}

/**
 * 同步所有副本的 TOP100 数据
 * 串行执行
 */
export async function syncAllTop100(
  client: FFLogsClientV2,
  kv: KVNamespace
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0
  let failed = 0
  const errors: string[] = []

  for (const encounter of ALL_ENCOUNTERS) {
    try {
      await syncEncounter(encounter, client, kv)
      success++
    } catch (err) {
      failed++
      const msg = `${encounter.shortName}: ${err instanceof Error ? err.message : String(err)}`
      errors.push(msg)
      console.error(`[TOP100] 同步失败 - ${msg}`)
    }
  }

  return { success, failed, errors }
}
