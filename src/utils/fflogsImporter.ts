/**
 * FFLogs 数据解析工具（V2 API）
 */

import type { FFLogsReport, FFLogsAbility } from '@/types/fflogs'
import type { Composition, Job, DamageEvent, CastEvent, StatusEvent } from '@/types/timeline'
import { MITIGATION_DATA } from '@/data/mitigationActions.new'
import actionChineseRaw from '@ff14-overlay/resources/generated/actionChinese.json'

const actionChinese: Record<string, string> = actionChineseRaw

function getActionChinese(actionId: number): string | undefined {
  return actionChinese[actionId.toString()]
}

const JOB_MAP: Record<string, Job> = {
  Paladin: 'PLD',
  Warrior: 'WAR',
  DarkKnight: 'DRK',
  Gunbreaker: 'GNB',
  WhiteMage: 'WHM',
  Scholar: 'SCH',
  Astrologian: 'AST',
  Sage: 'SGE',
  Monk: 'MNK',
  Dragoon: 'DRG',
  Ninja: 'NIN',
  Samurai: 'SAM',
  Reaper: 'RPR',
  Viper: 'VPR',
  Bard: 'BRD',
  Machinist: 'MCH',
  Dancer: 'DNC',
  BlackMage: 'BLM',
  Summoner: 'SMN',
  RedMage: 'RDM',
  Pictomancer: 'PCT',
}

/**
 * 解析小队阵容
 * V2: actors(type:"Player") 已过滤，无 fights 数组
 * participantIds: 实际参与战斗的玩家 ID 集合（从事件数据中提取）
 */
export function parseComposition(
  report: FFLogsReport,
  fightId: number,
  participantIds?: Set<number>
): Composition {
  const composition: Composition = { players: [] }
  if (!report.friendlies) return composition

  for (const actor of report.friendlies) {
    const job = JOB_MAP[actor.type]
    if (!job) continue
    if (participantIds && !participantIds.has(actor.id)) continue
    composition.players.push({ id: actor.id, job, name: actor.name })
  }

  return composition
}

function getJobRole(job: Job): 'tank' | 'healer' | 'dps' {
  const tanks: Job[] = ['PLD', 'WAR', 'DRK', 'GNB']
  const healers: Job[] = ['WHM', 'SCH', 'AST', 'SGE']
  if (tanks.includes(job)) return 'tank'
  if (healers.includes(job)) return 'healer'
  return 'dps'
}

/**
 * 解析伤害事件（只保留 Boss 技能）
 *
 * V2 事件字段：abilityGameID, packetID, sourceID, targetID, amount, unmitigatedAmount, absorbed
 * 聚合逻辑：
 * 1. 相同 packetID 视为同一个伤害
 * 2. targetID 在 playerMap 中的为友方目标
 * 3. 伤害量 = 非坦克玩家的平均值，如果只有坦克则为所有玩家平均值
 * 4. 0.9 秒内的同名伤害事件合并
 */
export function parseDamageEvents(
  events: any[],
  fightStartTime: number,
  playerMap: Map<number, { id: number; name: string; type: string }>,
  abilityMap?: Map<number, FFLogsAbility>
): DamageEvent[] {
  const AUTO_ATTACK_PATTERN = /^(攻击|Attack|Attacke|Attaque|攻撃|공격|unknown_[0-9a-f]{4})$/i
  const TANK_JOBS: Job[] = ['PLD', 'WAR', 'DRK', 'GNB']

  const packetMap = new Map<
    number,
    {
      name: string
      abilityId: number
      abilityType: string | number
      firstTime: number
      sourceID: number
      playerDamages: Map<number, {
        playerId: number
        job: string
        unmitigatedDamage: number
        absorbedDamage: number
        finalDamage: number
      }>
    }
  >()

  for (const event of events) {
    if (event.type !== 'damage') continue
    if (!playerMap.has(event.targetID)) continue

    const packetID = event.packetID
    if (!packetID) continue

    const abilityId = event.abilityGameID ?? 0
    const abilityMeta = abilityMap?.get(abilityId)
    const abilityName = abilityMeta?.name ?? '未知技能'
    const abilityType = abilityMeta?.type ?? 0

    if (AUTO_ATTACK_PATTERN.test(abilityName)) continue

    const targetId = event.targetID
    const unmitigatedAmount = event.unmitigatedAmount || event.amount || 0
    const absorbedAmount = event.absorbed || 0
    const finalAmount = event.amount || 0

    if (!packetMap.has(packetID)) {
      packetMap.set(packetID, {
        name: abilityName,
        abilityId,
        abilityType,
        firstTime: event.timestamp || 0,
        sourceID: event.sourceID || 0,
        playerDamages: new Map(),
      })
    }

    const packet = packetMap.get(packetID)!
    const player = playerMap.get(targetId)
    if (player) {
      packet.playerDamages.set(targetId, {
        playerId: targetId,
        job: player.type,
        unmitigatedDamage: unmitigatedAmount,
        absorbedDamage: absorbedAmount,
        finalDamage: finalAmount,
      })
    }
  }

  const damageEvents: DamageEvent[] = []
  let index = 0

  for (const [, data] of packetMap) {
    let totalUnmitigatedDamage = 0
    for (const pd of data.playerDamages.values()) {
      totalUnmitigatedDamage += pd.unmitigatedDamage
    }
    if (totalUnmitigatedDamage < 10000) continue

    const relativeTime = Math.round((data.firstTime - fightStartTime) / 10) / 100
    if (relativeTime < 0) continue

    const chineseName = getActionChinese(data.abilityId)
    const skillName = chineseName ?? data.name

    const playerDamageDetails: Array<{
      playerId: number
      job: Job
      skillName: string
      unmitigatedDamage: number
      absorbedDamage: number
      finalDamage: number
    }> = []

    for (const pd of data.playerDamages.values()) {
      const job = JOB_MAP[pd.job]
      if (!job) continue
      playerDamageDetails.push({
        playerId: pd.playerId,
        job,
        skillName,
        unmitigatedDamage: pd.unmitigatedDamage,
        absorbedDamage: pd.absorbedDamage,
        finalDamage: pd.finalDamage,
      })
    }

    const nonTankDamages = playerDamageDetails.filter((d) => !TANK_JOBS.includes(d.job))
    let averageDamage: number
    if (nonTankDamages.length > 0) {
      averageDamage = Math.floor(
        nonTankDamages.reduce((acc, d) => acc + d.unmitigatedDamage, 0) / nonTankDamages.length
      )
    } else {
      averageDamage = Math.floor(
        playerDamageDetails.reduce((acc, d) => acc + d.unmitigatedDamage, 0) / playerDamageDetails.length
      )
    }

    damageEvents.push({
      id: `event-${index++}`,
      name: skillName,
      time: relativeTime,
      damage: averageDamage,
      type: detectDamageType(data.playerDamages.size),
      damageType: detectDamageTypeFromAbility(data.abilityType),
      playerDamageDetails,
    })
  }

  damageEvents.sort((a, b) => a.time - b.time)

  // 合并 0.9 秒内的同名伤害事件
  const mergedEvents: DamageEvent[] = []
  let i = 0
  while (i < damageEvents.length) {
    const current = damageEvents[i]
    const toMerge: DamageEvent[] = [current]
    let j = i + 1
    while (j < damageEvents.length) {
      const next = damageEvents[j]
      if (next.time - current.time <= 0.9 && next.name === current.name) {
        toMerge.push(next)
        j++
      } else {
        break
      }
    }
    mergedEvents.push(toMerge.length === 1 ? current : mergeMultipleDamageEvents(toMerge))
    i = j
  }

  return mergedEvents
}

function mergeMultipleDamageEvents(events: DamageEvent[]): DamageEvent {
  if (events.length === 1) return events[0]

  const TANK_JOBS: Job[] = ['PLD', 'WAR', 'DRK', 'GNB']
  const playerDamageMap = new Map<number, {
    playerId: number
    job: Job
    skillName: string
    unmitigatedDamage: number
    absorbedDamage: number
    finalDamage: number
  }>()

  for (const event of events) {
    for (const detail of event.playerDamageDetails || []) {
      const existing = playerDamageMap.get(detail.playerId)
      if (existing) {
        existing.unmitigatedDamage += detail.unmitigatedDamage
        existing.absorbedDamage += detail.absorbedDamage
        existing.finalDamage += detail.finalDamage
      } else {
        playerDamageMap.set(detail.playerId, { ...detail })
      }
    }
  }

  const merged = Array.from(playerDamageMap.values())
  const nonTank = merged.filter((d) => !TANK_JOBS.includes(d.job))
  const src = nonTank.length > 0 ? nonTank : merged
  const averageDamage = Math.floor(
    src.reduce((acc, d) => acc + d.unmitigatedDamage, 0) / src.length
  )

  return { ...events[0], damage: averageDamage, playerDamageDetails: merged }
}

function detectDamageType(hitCount: number): 'aoe' | 'tankbuster' | 'raidwide' {
  if (hitCount >= 8) return 'raidwide'
  if (hitCount >= 4) return 'aoe'
  return 'tankbuster'
}

/**
 * 根据 ability.type 判断伤害类型
 * V2 API 返回字符串数字：'1024'=魔法，'128'=物理
 */
function detectDamageTypeFromAbility(abilityType: string | number): 'physical' | 'magical' | 'special' {
  const t = Number(abilityType)
  if (t === 1024) return 'magical'
  if (t === 128) return 'physical'
  return 'special'
}

/**
 * 解析状态附加/移除事件
 *
 * V2 事件字段：abilityGameID（带 1e6 偏移），duration（毫秒），sourceID，targetID
 */
export function parseStatusEvents(
  events: any[],
  fightStartTime: number
): StatusEvent[] {
  const statusEvents: StatusEvent[] = []

  const applyEventsMap = new Map<string, any[]>()

  for (const event of events) {
    if (
      event.type !== 'applybuff' &&
      event.type !== 'applydebuff'
    ) continue

    // abilityGameID 带 1e6 偏移
    const statusId = Math.max(0, (event.abilityGameID ?? 0) - 1e6)
    if (!statusId) continue

    const key = `${statusId}-${event.targetID || 0}-${event.targetInstance || 0}`
    if (!applyEventsMap.has(key)) applyEventsMap.set(key, [])
    applyEventsMap.get(key)!.push(event)
  }

  for (const applyEvents of applyEventsMap.values()) {
    for (const applyEvent of applyEvents) {
      const statusId = Math.max(0, (applyEvent.abilityGameID ?? 0) - 1e6)
      const startTime = (applyEvent.timestamp - fightStartTime) / 1000
      // V2 提供 duration 字段（毫秒）
      const endTime = applyEvent.duration != null
        ? startTime + applyEvent.duration / 1000
        : startTime + 30

      statusEvents.push({
        statusId,
        startTime,
        endTime,
        sourcePlayerId: applyEvent.sourceID,
        targetPlayerId: applyEvent.targetID,
        targetInstance: applyEvent.targetInstance,
        absorb: applyEvent.absorb,
      })
    }
  }

  return statusEvents
}

/**
 * 解析技能使用事件（CastEvent）
 *
 * V2 事件字段：abilityGameID，sourceID，targetID
 * 通过 playerMap 判断是否为友方玩家施放
 */
export function parseCastEventsFromFFLogs(
  events: any[],
  fightStartTime: number,
  playerMap: Map<number, { id: number; name: string; type: string }>
): CastEvent[] {
  const castEventsResult: CastEvent[] = []
  const validActionIds = new Set(MITIGATION_DATA.actions.map((a) => a.id))

  for (const event of events) {
    if (event.type !== 'cast') continue

    const abilityGameID = event.abilityGameID
    if (!abilityGameID) continue

    if (!validActionIds.has(abilityGameID)) continue

    const player = playerMap.get(event.sourceID)
    if (!player) continue

    const job = JOB_MAP[player.type]
    if (!job) continue

    castEventsResult.push({
      id: `cast-${castEventsResult.length}`,
      actionId: abilityGameID,
      timestamp: (event.timestamp - fightStartTime) / 1000,
      playerId: event.sourceID,
      job,
      targetPlayerId: event.targetID,
    })
  }

  return castEventsResult
}
