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

/** 单场战斗的原始统计数据 */
export interface FightStatistics {
  encounterId: number
  reportCode: string
  fightID: number
  damageByAbility: Record<number, number[]>
  maxHPByJob: Record<string, number[]>
  shieldByAbility: Record<number, number[]>
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

/** 获取单场战斗统计数据的临时 KV 键名 */
export function getFightStatisticsKVKey(encounterId: number, reportCode: string, fightID: number): string {
  return `fight-stats:${encounterId}:${reportCode}:${fightID}`
}

/** 获取遭遇战统计任务状态的 KV 键名 */
export function getStatisticsTaskKVKey(encounterId: number): string {
  return `stats-task:${encounterId}`
}

/** 统计任务状态 */
export interface StatisticsTask {
  encounterId: number
  encounterName: string
  totalFights: number
  completedFights: number
  fights: Array<{ reportCode: string; fightID: number }>
  createdAt: string
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
 * 注意：统计数据提取需要通过队列异步处理
 */
export async function syncEncounter(
  encounter: RaidEncounter,
  client: FFLogsClientV2,
  kv: KVNamespace,
  statisticsQueue?: Queue
): Promise<void> {
  console.log(`[TOP100] ��步遭遇战: ${encounter.shortName} (id=${encounter.id})`)

  // 获取排行榜数据
  const result = await client.getEncounterRankings({
    encounterId: encounter.id,
  })

  const encounterName = result.encounterName || encounter.name
  const now = new Date().toISOString()

  // 构建 TOP100 数据（立即保存）
  const top100Data: Top100Data = {
    encounterId: encounter.id,
    encounterName,
    entries: result.entries,
    updatedAt: now,
  }

  // 保存 TOP100 数据
  await kv.put(getTop100KVKey(encounter.id), JSON.stringify(top100Data), {
    expirationTtl: 25 * 60 * 60,
  })

  // 如果提供了队列，推送统计数据提取任务
  if (statisticsQueue && result.entries.length > 0) {
    // 随机抽取 10 场战斗
    const sampledEntries = result.entries
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(10, result.entries.length))

    // 创建���计任务状态
    const task: StatisticsTask = {
      encounterId: encounter.id,
      encounterName,
      totalFights: sampledEntries.length,
      completedFights: 0,
      fights: sampledEntries.map((e) => ({ reportCode: e.reportCode, fightID: e.fightID })),
      createdAt: now,
    }

    await kv.put(getStatisticsTaskKVKey(encounter.id), JSON.stringify(task), {
      expirationTtl: 2 * 60 * 60, // 2 小时过期
    })

    // 为每场战斗推送一个任务到队列
    const messages = sampledEntries.map((entry) => ({
      body: {
        type: 'extract-statistics',
        encounterId: encounter.id,
        encounterName,
        reportCode: entry.reportCode,
        fightID: entry.fightID,
      },
    }))

    await statisticsQueue.sendBatch(messages)
    console.log(`[TOP100] ${encounter.shortName}: 已推送 ${messages.length} 个统计任务到队列`)
  }

  console.log(`[TOP100] ${encounter.shortName}: 已同步 ${result.entries.length} 条记录`)
}

/**
 * 提取单场战斗的统计数据
 */
export async function extractFightStatistics(
  encounterId: number,
  reportCode: string,
  fightID: number,
  client: FFLogsClientV2,
  kv: KVNamespace
): Promise<void> {
  console.log(`[Statistics] 提取战斗数据: ${reportCode}/${fightID}`)

  try {
    // 获取战斗报告
    const report = await client.getReport({ reportCode })
    const fight = report.fights.find((f) => f.id === fightID)
    if (!fight) {
      throw new Error(`Fight ${fightID} not found`)
    }

    // 获取战斗事件
    const eventsResponse = await client.getEvents({
      reportCode,
      start: fight.startTime,
      end: fight.endTime,
    })

    // 提取各类数据
    const damageData = extractDamageData(eventsResponse.events)
    const shieldData = extractShieldData(eventsResponse.events)
    const maxHPData = extractMaxHPData(eventsResponse.events, report)

    // 保存到临时 KV
    const battleStats: FightStatistics = {
      encounterId,
      reportCode,
      fightID,
      damageByAbility: damageData,
      maxHPByJob: maxHPData,
      shieldByAbility: shieldData,
    }

    await kv.put(
      getFightStatisticsKVKey(encounterId, reportCode, fightID),
      JSON.stringify(battleStats),
      { expirationTtl: 2 * 60 * 60 } // 2 小时过期
    )

    // 更新任务状态
    await updateStatisticsTaskProgress(encounterId, reportCode, fightID, kv)

    console.log(`[Statistics] 完成战斗数据提取: ${reportCode}/${fightID}`)
  } catch (err) {
    console.error(`[Statistics] 提取失败 (${reportCode}/${fightID}):`, err)
    throw err
  }
}

/**
 * 更新统计任务进度，如果完成则汇总数据
 * 使用独立的 KV 键来标记完成状态，避免并发冲突
 */
async function updateStatisticsTaskProgress(
  encounterId: number,
  reportCode: string,
  fightID: number,
  kv: KVNamespace
): Promise<void> {
  // 标记这场战斗已完成
  const completionKey = `fight-completed:${encounterId}:${reportCode}:${fightID}`
  await kv.put(completionKey, '1', { expirationTtl: 2 * 60 * 60 })

  // 读取任务信息
  const taskData = await kv.get(getStatisticsTaskKVKey(encounterId), 'json')
  if (!taskData) return

  const task = taskData as StatisticsTask

  // 检查所有战斗是否都完成了
  const completionChecks = await Promise.all(
    task.fights.map(async (fight) => {
      const key = `fight-completed:${encounterId}:${fight.reportCode}:${fight.fightID}`
      const completed = await kv.get(key)
      return completed !== null
    })
  )

  const allCompleted = completionChecks.every((c) => c)

  if (allCompleted) {
    // 使用锁机制确保只有一个 Worker 执行汇总
    const lockKey = `stats-lock:${encounterId}`
    const existingLock = await kv.get(lockKey)

    if (!existingLock) {
      // 尝试获取锁（设置 30 秒过期）
      await kv.put(lockKey, Date.now().toString(), { expirationTtl: 30 })

      // 再次检查锁是否是我们设置的（简单的分布式锁）
      await new Promise((resolve) => setTimeout(resolve, 100))
      const currentLock = await kv.get(lockKey)

      // 如果锁还在，执行汇总
      if (currentLock) {
        await aggregateStatistics(task, kv)
      }
    }
  }
}

/**
 * 汇总所有战斗的统计数据并计算平均值
 */
async function aggregateStatistics(task: StatisticsTask, kv: KVNamespace): Promise<void> {
  console.log(`[Statistics] 开始汇总数据: encounter ${task.encounterId}`)

  const allDamageData: Record<number, number[]> = {}
  const allMaxHPData: Record<string, number[]> = {}
  const allShieldData: Record<number, number[]> = {}

  // 读取所有战斗的统计数据
  for (const battle of task.fights) {
    const key = getFightStatisticsKVKey(task.encounterId, battle.reportCode, battle.fightID)
    const data = await kv.get(key, 'json')
    if (!data) continue

    const battleStats = data as FightStatistics

    // 合并伤害数据
    for (const [abilityId, damages] of Object.entries(battleStats.damageByAbility)) {
      if (!allDamageData[Number(abilityId)]) {
        allDamageData[Number(abilityId)] = []
      }
      allDamageData[Number(abilityId)].push(...damages)
    }

    // 合并盾值数据
    for (const [abilityId, shields] of Object.entries(battleStats.shieldByAbility)) {
      if (!allShieldData[Number(abilityId)]) {
        allShieldData[Number(abilityId)] = []
      }
      allShieldData[Number(abilityId)].push(...shields)
    }

    // 合并最大生命值数据
    for (const [job, hps] of Object.entries(battleStats.maxHPByJob)) {
      if (!allMaxHPData[job]) {
        allMaxHPData[job] = []
      }
      allMaxHPData[job].push(...hps)
    }
  }

  // 计算平均值
  const avgDamageByAbility = calculateAverages(allDamageData)
  const avgShieldByAbility = calculateAverages(allShieldData)
  const avgMaxHPByJob = calculateAverages(allMaxHPData)

  // 保存最终统计数据
  const statistics: EncounterStatistics = {
    encounterId: task.encounterId,
    encounterName: task.encounterName,
    damageByAbility: avgDamageByAbility,
    maxHPByJob: avgMaxHPByJob,
    shieldByAbility: avgShieldByAbility,
    sampleSize: task.completedFights,
    updatedAt: new Date().toISOString(),
  }

  await kv.put(getStatisticsKVKey(task.encounterId), JSON.stringify(statistics), {
    expirationTtl: 25 * 60 * 60,
  })

  // 清理临时数据
  await Promise.all([
    kv.delete(getStatisticsTaskKVKey(task.encounterId)),
    kv.delete(`stats-lock:${task.encounterId}`),
    ...task.fights.map((f) =>
      kv.delete(getFightStatisticsKVKey(task.encounterId, f.reportCode, f.fightID))
    ),
    ...task.fights.map((f) =>
      kv.delete(`fight-completed:${task.encounterId}:${f.reportCode}:${f.fightID}`)
    ),
  ])

  console.log(`[Statistics] 汇总完成: encounter ${task.encounterId}, 采样 ${task.completedFights} 场战斗`)
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
