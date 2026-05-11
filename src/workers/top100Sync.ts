/**
 * TOP100 数据同步模块
 *
 * 通过 FFLogs V2 API 获取每个副本治疗 HPS 前 100 的战斗记录，存入 Cloudflare KV
 *
 * KV 键格式：top100:encounter:{encounterId}
 */

import { FFLogsClientV2, type RankingEntry } from './fflogsClientV2'
import { enqueueRankings, pickNextSample, type SampleQueueRow } from './samplesQueue'
import { ALL_ENCOUNTERS, type RaidEncounter } from '@/data/raidEncounters'
import type { FFLogsEvent, FFLogsV1Report, FFLogsAbility, FFLogsReport } from '@/types/fflogs'
import type { EncounterStatistics } from '@/types/mitigation'
import type { Job } from '@/data/jobs'
import { calculatePercentile } from '@/utils/stats'
import { JOB_MAP } from '@/data/jobMap'
import type { DamageEvent } from '@/types/timeline'
import { parseDamageEvents, parseComposition } from '@/utils/fflogsImporter'
import { generateId } from '@/utils/id'

/** KV 中存储的 TOP100 数据结构 */
export interface Top100Data {
  encounterId: number
  encounterName: string
  entries: RankingEntry[]
  /** ISO 8601 时间戳 */
  updatedAt: string
}

/** fight-stats 存储用的精简 DamageEvent，剥离 id / 明细，并额外附带 abilityId */
export type StoredDamageEvent = Omit<DamageEvent, 'id' | 'playerDamageDetails'> & {
  /** 从 playerDamageDetails[0] 提取的技能 ID，供后续 encounter template 聚合使用 */
  abilityId?: number
}

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
}

/**
 * 从单场 fight 的 report + events 提取四类原始样本 + slim damage events。
 * 不做任何 KV 写入，纯函数易于测试与复用。
 */
export function extractFightStats(
  report: FFLogsV1Report,
  fight: FFLogsV1Report['fights'][number],
  events: FFLogsEvent[]
): ExtractedFightData {
  const damageByAbility = extractDamageData(events)
  const shieldByAbility = extractShieldData(events)
  const maxHPByJob = extractMaxHPData(events, report)
  const healByAbility = extractHealData(events)

  const playerMap = new Map<number, { id: number; name: string; type: string }>()
  for (const actor of report.friendlies ?? []) {
    playerMap.set(actor.id, { id: actor.id, name: actor.name, type: actor.type })
  }
  const abilityMap = new Map<number, FFLogsAbility>()
  for (const ability of report.abilities ?? []) {
    abilityMap.set(ability.gameID, ability)
  }

  const composition = parseComposition(report as unknown as FFLogsReport, fight.id)
  const fullDamageEvents = parseDamageEvents(
    events,
    fight.start_time,
    playerMap,
    abilityMap,
    composition
  )
  const damageEvents = slimDamageEvents(fullDamageEvents)
  const durationMs = fight.end_time - fight.start_time

  return { damageByAbility, shieldByAbility, maxHPByJob, healByAbility, durationMs, damageEvents }
}

/** 模板事件：DamageEvent + abilityId（仅模板聚合/过滤内部使用，非持久化字段） */
export type EncounterTemplateEvent = DamageEvent & { abilityId?: number }

/** 副本模板数据结构（KV 存储） */
export interface EncounterTemplate {
  encounterId: number
  /** 完整 DamageEvent（带 id）+ abilityId。playerDamageDetails 始终为空 */
  events: EncounterTemplateEvent[]
  /** 模板战斗的时长（毫秒），用于覆盖策略比较 */
  templateSourceDurationMs: number
  updatedAt: string
}

/** 获取 encounter template 的 KV 键名 */
export function getEncounterTemplateKVKey(encounterId: number): string {
  return `encounter-template:${encounterId}`
}

interface BuildEncounterTemplateInput {
  /** 本场 fight 的时长（毫秒） */
  fightDurationMs: number
  /** 本场 fight 的 slim damage events */
  fightEvents: StoredDamageEvent[]
  /** abilityId → p50 伤害（来自最新 statistics 的 calculatePercentiles 输出） */
  p50Map: Record<number, number>
  /** 旧 template（KV 中的当前值），null 表示不存在 */
  oldTemplate: EncounterTemplate | null
}

/**
 * 单场版 encounter template 构建。
 *
 * 行为：
 * - 仅当 `fightDurationMs > oldTemplate.templateSourceDurationMs`（或旧 template 不存在）时返回新 template
 * - 不做 abilityId 出现场数过滤；前端可用 `EncounterStatistics.abilityFightCount` 自行过滤
 * - 每个保留事件的 `damage` 用 `p50Map[abilityId]` 覆盖；无 p50 时保留原 damage
 * - 每个事件重新 generateId
 *
 * 返回 null 表示"无需写入"（不是错误）。
 */
export function buildEncounterTemplate(input: BuildEncounterTemplateInput): {
  events: EncounterTemplateEvent[]
  templateSourceDurationMs: number
} | null {
  const { fightDurationMs, fightEvents, p50Map, oldTemplate } = input

  if (oldTemplate && fightDurationMs <= oldTemplate.templateSourceDurationMs) {
    return null
  }

  const events: EncounterTemplateEvent[] = fightEvents.map(e => ({
    id: generateId(),
    name: e.name,
    time: e.time,
    damage: p50Map[e.abilityId ?? 0] ?? e.damage,
    type: e.type,
    damageType: e.damageType,
    packetId: e.packetId,
    snapshotTime: e.snapshotTime,
    abilityId: e.abilityId,
  }))

  return { events, templateSourceDurationMs: fightDurationMs }
}

/** 样本存储（低频访问，供定时任务读写） */
export interface EncounterSamples {
  encounterId: number
  /** 每个伤害技能的原始样本值，每个 ability 独立限制 MAX_SAMPLES 条 */
  damageByAbility: Record<number, number[]>
  /** 每个职业（Job 枚举字符串，如 "WHM"）的原始最大 HP 样本值 */
  maxHPByJob: Record<Job, number[]>
  /** 每个盾值状态的原始样本值，每个 statusId 独立限制 MAX_SAMPLES 条 */
  shieldByAbility: Record<number, number[]>
  /** 每个治疗技能的原始样本值，每个 ability 独立限制 MAX_SAMPLES 条 */
  healByAbility: Record<number, number[]>
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

/** 获取样本数据的 KV 键名 */
export function getSamplesKVKey(encounterId: number): string {
  return `statistics-samples:encounter:${encounterId}`
}

/**
 * 从事件列表中提取治疗数据
 */
function extractHealData(events: FFLogsEvent[]): Record<number, number[]> {
  const healByAbility: Record<number, number[]> = {}

  for (const event of events) {
    if (event.type === 'heal' && !event.overheal && event.abilityGameID && event.amount) {
      if (!healByAbility[event.abilityGameID]) {
        healByAbility[event.abilityGameID] = []
      }
      healByAbility[event.abilityGameID].push(event.amount)
    }
  }

  return healByAbility
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
 * 从事件列表中提取盾值数据
 * 从 absorbed 类型的事件中提取盾值技能 ID 和数值
 * 注意：abilityGameID 需要减去 1000000 偏移值得到真实的状态 ID
 */
function extractShieldData(events: FFLogsEvent[]): Record<number, number[]> {
  const shieldByAbility: Record<number, number[]> = {}

  for (const event of events) {
    if (event.type === 'absorbed' && event.abilityGameID && event.amount) {
      // 不知为何，FFLogs 的 absorbed 事件会把泛输血（1002613）记录为泛血印（1002643）
      if (event.abilityGameID === 1002643) event.abilityGameID = 1002613
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
 * 从 heal 类型的事件中提取目标的最大生命值
 */
function extractMaxHPData(events: FFLogsEvent[], report: FFLogsV1Report): Record<Job, number[]> {
  const maxHPByJob: Partial<Record<Job, number[]>> = {}

  for (const event of events) {
    // absorbed 事件的 targetResources 包含 maxHitPoints 字段
    if (event.type === 'heal') {
      const targetResources = (
        event as FFLogsEvent & { targetResources?: { maxHitPoints?: number } }
      ).targetResources
      if (targetResources) {
        const maxHP = targetResources.maxHitPoints
        const targetID = event.targetID
        if (maxHP && maxHP > 0 && targetID) {
          const actor = report.friendlies?.find(a => a.id === targetID)
          if (actor && actor.type) {
            const job = JOB_MAP[actor.type.replace(/\s/g, '')]
            if (job) {
              if (!maxHPByJob[job]) maxHPByJob[job] = []
              maxHPByJob[job]!.push(maxHP)
            }
          }
        }
      }
    }
  }

  return maxHPByJob as Record<Job, number[]>
}

const MAX_SAMPLES = 500

/**
 * Reservoir Sampling（Algorithm R）
 * 从 reservoir + incoming 中均匀随机保留 max 条样本
 */
export function mergeWithReservoirSampling(
  reservoir: number[],
  incoming: number[],
  max: number = MAX_SAMPLES
): number[] {
  const combined = [...reservoir, ...incoming]
  if (combined.length <= max) return combined

  const result = combined.slice(0, max)
  for (let i = max; i < combined.length; i++) {
    const j = Math.floor(Math.random() * (i + 1))
    if (j < max) result[j] = combined[i]
  }
  return result
}

/**
 * 对 Record<K, number[]> 中每个 key 计算指定百分位数
 */
export function calculatePercentiles<T extends number | string>(
  data: Record<T, number[]>,
  percentile: number = 50
): Record<T, number> {
  const result: Record<string, number> = {}

  for (const [key, values] of Object.entries(data)) {
    if (Array.isArray(values) && values.length > 0) {
      result[key] = calculatePercentile(values as number[], percentile)
    }
  }

  return result as Record<T, number>
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
      start: fight.start_time,
      end: fight.end_time,
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
  })
  if (built) {
    const newTemplate: EncounterTemplate = {
      encounterId,
      events: built.events,
      templateSourceDurationMs: built.templateSourceDurationMs,
      updatedAt: new Date().toISOString(),
    }
    await kv.put(getEncounterTemplateKVKey(encounterId), JSON.stringify(newTemplate))
    console.log(
      `[Sample-tick] template 更新: encounter=${encounterId}, duration=${built.templateSourceDurationMs}ms, events=${built.events.length}`
    )
  }

  return true
}

/** 工具：reservoir merge `Record<K, number[]>`（K 为 string 或 number——运行时都是字符串键） */
function mergeRecord<K extends string | number>(
  base: Record<K, number[]>,
  incoming: Record<K, number[]>
): Record<K, number[]> {
  const out: Record<string, number[]> = { ...(base as unknown as Record<string, number[]>) }
  const entries = Object.entries(incoming as unknown as Record<string, number[]>)
  for (const [key, values] of entries) {
    out[key] = mergeWithReservoirSampling(out[key] ?? [], values)
  }
  return out as unknown as Record<K, number[]>
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

/**
 * GET /api/encounter-templates/:encounterId
 * 返回副本模板（含预填充伤害事件）；KV 无数据时返回空列表
 */
export async function handleGetEncounterTemplate(
  encounterId: number,
  kv: KVNamespace
): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
  }
  const data = await kv.get(getEncounterTemplateKVKey(encounterId), 'json')
  if (!data) {
    return new Response(JSON.stringify({ events: [], updatedAt: null }), { headers })
  }
  const template = data as EncounterTemplate
  return new Response(JSON.stringify({ events: template.events, updatedAt: template.updatedAt }), {
    headers,
  })
}
