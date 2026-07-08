/**
 * TOP100 数据同步模块
 *
 * 通过 FFLogs V2 API 获取每个副本治疗 HPS 前 100 的战斗记录，存入 Cloudflare KV
 *
 * KV 键格式：top100:encounter:{encounterId}
 */

import { FFLogsClientV2 } from './fflogsClientV2'
import { enqueueRankings, pickNextSample, type SampleQueueRow } from './samplesQueue'
import { ALL_ENCOUNTERS, type RaidEncounter } from '@/data/raidEncounters'
import type { FFLogsEvent, FFLogsAbility, FFLogsReport, PlayerMap } from '@/types/fflogs'
import type { EncounterStatistics } from '@/types/mitigation'
import type { Job } from '@/data/jobs'
import type { DamageEvent, StoredDamageEvent } from '@/types/timeline'
import type { Top100Data } from '@/types/apiContracts'
import {
  parseDamageEvents,
  parseComposition,
  extractShieldData,
  extractHealData,
  extractMaxHPData,
  resolveFightStartTime,
} from '@/utils/fflogsImporter'
import {
  getTop100KVKey,
  getStatisticsKVKey,
  getSamplesKVKey,
  getEncounterTemplateKVKey,
} from './kvKeys'
import { type EncounterSamples, calculatePercentiles, mergeRecord } from './encounterStats'
import { type EncounterTemplate, buildEncounterTemplate } from './encounterTemplate'

/**
 * 将 parseDamageEvents 输出的完整 DamageEvent 精简为存储格式
 * - 丢弃 id / playerDamageDetails
 * - 从 playerDamageDetails[0] 提取 abilityId（同 packetId 的 detail 共享 abilityId）
 */
export function slimDamageEvents(full: DamageEvent[]): StoredDamageEvent[] {
  return full.map(e => ({
    name: e.name,
    time: e.time,
    damage: e.damage,
    type: e.type,
    damageType: e.damageType,
    packetId: e.packetId,
    snapshotTime: e.snapshotTime,
    damageSource: e.damageSource,
    abilityId: e.playerDamageDetails?.[0]?.abilityId ?? 0,
  }))
}

/**
 * 单场 fight 提取后的纯数据（不含 reportCode/fightID/encounterId 三件套）
 */
export interface ExtractedFightData {
  damageByAbility: Record<number, number[]>
  maxHPByJob: Record<Job, number[]>
  shieldByAbility: Record<number, number[]>
  healByAbility: Record<number, number[]>
  durationMs: number
  damageEvents: StoredDamageEvent[]
  /** 本场战斗是否击杀（FFLogs fight.kill），用于 template 覆盖优先级与"已更新完成"展示 */
  kill: boolean
}

/**
 * 从单场 fight 的 report + events 提取四类原始样本 + slim damage events。
 * 不做任何 KV 写入，纯函数易于测试与复用。
 */
export function extractFightStats(
  report: FFLogsReport,
  fight: FFLogsReport['fights'][number],
  events: FFLogsEvent[]
): ExtractedFightData {
  const playerMap: PlayerMap = new Map()
  for (const actor of report.friendlies ?? []) {
    playerMap.set(actor.id, { id: actor.id, name: actor.name, type: actor.type })
  }
  const abilityMap = new Map<number, FFLogsAbility>()
  for (const ability of report.abilities ?? []) {
    abilityMap.set(ability.gameID, ability)
  }

  const damageByAbility = extractDamageData(events)
  const shieldByAbility = extractShieldData(events)
  const maxHPByJob = extractMaxHPData(events, playerMap)
  const healByAbility = extractHealData(events)

  // composition 必须按本场实际参战玩家过滤：report.friendlies 是整份 report
  // 所有 pull 的玩家并集，往往多于本场 8 人。不过滤会让 classifyPartialAOE 的
  // nonTankIds 被撑大，全员 AOE 永远凑不齐全覆盖 → 所有 aoe 退化成 partial_aoe。
  // 与前端 parseFightImport 的 participantIds 推导口径保持一致。
  const participantIds = new Set<number>()
  for (const event of events) {
    if (event.sourceID && playerMap.has(event.sourceID)) participantIds.add(event.sourceID)
    if (event.targetID && playerMap.has(event.targetID)) participantIds.add(event.targetID)
  }
  const composition = parseComposition(report, fight.id, participantIds)
  const enemyNames = new Map<number, string>()
  report.enemies?.forEach(e => enemyNames.set(e.id, e.name))
  // 有意少传 bossIds / targetability / bossCasts：它们在 parseDamageEvents 里只产出
  // targetMitigationDisabled / castStartTime / castEndTime，而本调用点最终经
  // slimDamageEvents 只保留统计字段，这些 enrichment 会被丢弃——传了是白算 +
  // 白扫全量事件重建区间，勿补全。
  // fightStartTime 用 resolveFightStartTime（与前端 parseFightImport 同口径）：模板事件
  // 时间会流向 slimDamageEvents.time / snapshotTime，零点须与用户导入时间轴同轴对齐。
  const fullDamageEvents = parseDamageEvents({
    events,
    fightStartTime: resolveFightStartTime(events, fight.startTime),
    playerMap,
    abilityMap,
    composition,
    sourceNames: enemyNames,
  })
  const damageEvents = slimDamageEvents(fullDamageEvents)
  const durationMs = fight.endTime - fight.startTime

  return {
    damageByAbility,
    shieldByAbility,
    maxHPByJob,
    healByAbility,
    durationMs,
    damageEvents,
    kill: fight.kill ?? false,
  }
}

/**
 * 从事件列表中提取伤害数据
 */
function extractDamageData(events: FFLogsEvent[]): Record<number, number[]> {
  const damageByAbility: Record<number, number[]> = {}

  // 仅采集敌方造成的伤害：FFLogs 仅在被命中方（友方）记录 unmitigatedAmount，
  // 玩家/宠物输出事件不会带这个字段。下面的 `event.unmitigatedAmount` 真值检查
  // 借此天然过滤掉了非敌方来源的 damage 事件。
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
 * 为单个遭遇战同步 TOP100 数据：
 * 1. 拉 rankings → 写 top100:encounter:{id}（无 TTL）
 * 2. 把所有 entries (reportCode, fightID, durationMs) 入 D1 samples_queue（INSERT OR IGNORE）
 *
 * 不再随机抽 10 场也不推 statistics queue。统计任务由短间隔 cron 通过 D1 队列驱动。
 */
export async function syncEncounter(
  encounter: RaidEncounter,
  client: FFLogsClientV2,
  kv: KVNamespace,
  db: D1Database
): Promise<void> {
  console.log(`[TOP100] 同步遭遇战: ${encounter.shortName} (id=${encounter.id})`)

  const result = await client.getEncounterRankings({ encounterId: encounter.id })

  const encounterName = result.encounterName || encounter.name
  const now = new Date().toISOString()

  const top100Data: Top100Data = {
    encounterId: encounter.id,
    encounterName,
    entries: result.entries,
    updatedAt: now,
  }
  await kv.put(getTop100KVKey(encounter.id), JSON.stringify(top100Data))

  if (result.entries.length > 0) {
    const enqueueInputs = result.entries.map(e => ({
      reportCode: e.reportCode,
      fightID: e.fightID,
      // RankingEntry.duration 在 FFLogs v2 schema 中是毫秒
      durationMs: e.duration ?? 0,
    }))
    const { inserted } = await enqueueRankings(db, encounter.id, enqueueInputs)
    console.log(`[TOP100] ${encounter.shortName}: 入队 ${inserted}/${enqueueInputs.length} 条`)
  }

  console.log(`[TOP100] ${encounter.shortName}: 已同步 ${result.entries.length} 条记录`)
}

interface ProcessOneSampleDeps {
  db: D1Database
  kv: KVNamespace
  /** 默认实现拉 fflogs report+events 并跑 extractFightStats；测试可注入纯函数 */
  fetchExtracted: (row: SampleQueueRow) => Promise<ExtractedFightData>
  /** encounterId → 显示名（默认查 ALL_ENCOUNTERS） */
  lookupEncounterName: (encounterId: number) => string
}

/** 真实环境用的默认 fetcher 工厂 */
export function makeDefaultFetchExtracted(client: FFLogsClientV2) {
  return async (row: SampleQueueRow): Promise<ExtractedFightData> => {
    const report = await client.getReport({ reportCode: row.report_code })
    const fight = report.fights.find(f => f.id === row.fight_id)
    if (!fight) throw new Error(`Fight ${row.fight_id} not found in ${row.report_code}`)
    const eventsResponse = await client.getEvents({
      reportCode: row.report_code,
      start: fight.startTime,
      end: fight.endTime,
    })
    return extractFightStats(report, fight, eventsResponse.events)
  }
}

export function defaultLookupEncounterName(encounterId: number): string {
  return ALL_ENCOUNTERS.find(e => e.id === encounterId)?.name ?? `encounter-${encounterId}`
}

/**
 * 单 cron tick 处理一条采样。
 *
 * 返回 true = 处理了一条；false = 队列空。
 */
export async function processOneSample(deps: ProcessOneSampleDeps): Promise<boolean> {
  const { db, kv, fetchExtracted, lookupEncounterName } = deps

  const row = await pickNextSample(db)
  if (!row) {
    console.log('[Sample-tick] 队列空，跳过')
    return false
  }

  const encounterId = row.encounter_id
  const encounterName = lookupEncounterName(encounterId)
  console.log(
    `[Sample-tick] 处理 encounter=${encounterId} report=${row.report_code} fight=${row.fight_id}`
  )

  const extracted = await fetchExtracted(row)

  // 1) reservoir merge → 写新 samples（无 TTL）
  const oldSamplesRaw = await kv.get(getSamplesKVKey(encounterId), 'json')
  const oldSamples = (oldSamplesRaw as EncounterSamples | null) ?? {
    encounterId,
    damageByAbility: {},
    maxHPByJob: {} as Record<Job, number[]>,
    shieldByAbility: {},
    healByAbility: {},
    updatedAt: '',
  }

  const mergedDamage = mergeRecord(oldSamples.damageByAbility, extracted.damageByAbility)
  const mergedShield = mergeRecord(oldSamples.shieldByAbility, extracted.shieldByAbility)
  const mergedHeal = mergeRecord(oldSamples.healByAbility ?? {}, extracted.healByAbility)
  const mergedMaxHP = mergeRecord<Job>(oldSamples.maxHPByJob, extracted.maxHPByJob)

  const newSamples: EncounterSamples = {
    encounterId,
    damageByAbility: mergedDamage,
    maxHPByJob: mergedMaxHP,
    shieldByAbility: mergedShield,
    healByAbility: mergedHeal,
    updatedAt: new Date().toISOString(),
  }
  await kv.put(getSamplesKVKey(encounterId), JSON.stringify(newSamples))

  // 2) 读旧 statistics → 累加 abilityFightCount + totalFightsSampled → 重算 percentile → 写
  const oldStatsRaw = await kv.get(getStatisticsKVKey(encounterId), 'json')
  const oldStats = oldStatsRaw as EncounterStatistics | null
  const oldAbilityFightCount = oldStats?.abilityFightCount ?? {}
  const oldTotalFights = oldStats?.totalFightsSampled ?? 0

  const distinctAbilityIds = new Set<number>(
    Object.keys(extracted.damageByAbility).map(k => Number(k))
  )
  const abilityFightCount: Record<number, number> = { ...oldAbilityFightCount }
  for (const id of distinctAbilityIds) {
    abilityFightCount[id] = (abilityFightCount[id] ?? 0) + 1
  }

  const statistics: EncounterStatistics = {
    encounterId,
    encounterName,
    damageByAbility: calculatePercentiles(mergedDamage),
    maxHPByJob: calculatePercentiles(mergedMaxHP),
    shieldByAbility: calculatePercentiles(mergedShield),
    healByAbility: calculatePercentiles(mergedHeal),
    critHealByAbility: calculatePercentiles(mergedHeal, 90),
    critShieldByAbility: calculatePercentiles(mergedShield, 90),
    sampleSize: Object.values(mergedDamage).reduce((sum, arr) => sum + arr.length, 0),
    abilityFightCount,
    totalFightsSampled: oldTotalFights + 1,
    updatedAt: new Date().toISOString(),
  }
  await kv.put(getStatisticsKVKey(encounterId), JSON.stringify(statistics))

  // 3) template：仅当本场更长才覆盖
  const oldTemplateRaw = await kv.get(getEncounterTemplateKVKey(encounterId), 'json')
  const oldTemplate = oldTemplateRaw as EncounterTemplate | null
  const built = buildEncounterTemplate({
    fightDurationMs: extracted.durationMs,
    fightEvents: extracted.damageEvents,
    p50Map: statistics.damageByAbility,
    oldTemplate,
    fightKill: extracted.kill,
  })
  if (built) {
    const newTemplate: EncounterTemplate = {
      encounterId,
      events: built.events,
      templateSourceDurationMs: built.templateSourceDurationMs,
      kill: built.kill,
      updatedAt: new Date().toISOString(),
    }
    await kv.put(getEncounterTemplateKVKey(encounterId), JSON.stringify(newTemplate))
    console.log(
      `[Sample-tick] template 更新: encounter=${encounterId}, duration=${built.templateSourceDurationMs}ms, kill=${built.kill}, events=${built.events.length}`
    )
  }

  return true
}

/**
 * 同步所有副本的 TOP100 数据
 * 串行执行
 */
export async function syncAllTop100(
  client: FFLogsClientV2,
  kv: KVNamespace,
  db: D1Database
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0
  let failed = 0
  const errors: string[] = []

  for (const encounter of ALL_ENCOUNTERS) {
    try {
      await syncEncounter(encounter, client, kv, db)
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
