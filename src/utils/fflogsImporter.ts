/**
 * FFLogs 数据解析工具（完整版）
 */

import type { FFLogsReport, FFLogsV1Actor } from '@/types/fflogs'
import type { Composition, Job, DamageEvent, CastEvent, StatusEvent } from '@/types/timeline'
import { MITIGATION_DATA } from '@/data/mitigationActions.new'
// 直接导入 JSON 数据，避免引入 Vue 依赖
import actionChineseRaw from '@ff14-overlay/resources/generated/actionChinese.json'

// 技能 ID 到中文名的映射
const actionChinese: Record<string, string> = actionChineseRaw

/**
 * 获取技能中文名
 */
function getActionChinese(actionId: number): string | undefined {
  return actionChinese[actionId.toString()]
}

/**
 * 职业名称映射
 */
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
 */
export function parseComposition(
  report: FFLogsReport,
  fightId: number
): Composition {
  const composition: Composition = {
    players: [],
  }

  if (!report.friendlies) return composition

  // 找到参与该战斗的玩家
  const playersInFight = report.friendlies.filter((actor) =>
    actor.fights?.some((f) => f.id === fightId)
  )

  for (const player of playersInFight) {
    const job = JOB_MAP[player.type]
    if (!job) continue

    composition.players.push({
      id: player.id,
      job,
      name: player.name,
    })
  }

  return composition
}

/**
 * 获取职业角色
 */
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
 * 聚合逻辑：
 * 1. 相同 packetID 视为同一个伤害
 * 2. 多个 damage 事件为同一个伤害给每个玩家所造成的伤害
 * 3. 原始伤害对应的字段是 unmitigatedAmount
 * 4. ability.type 判断伤害类型：1024=魔法，128=物理
 * 5. 记录每个玩家的详细伤害信息
 * 6. 伤害量 = 非坦克玩家的平均值，如果只有坦克则为所有玩家平均值
 * 7. 时间精确到 0.1 秒
 * 8. 0.9 秒内的同名伤害事件合并
 */
export function parseDamageEvents(
  events: any[],
  fightStartTime: number,
  playerMap: Map<number, FFLogsV1Actor>
): DamageEvent[] {
  // 普通攻击技能名正则（多语言：中文/英文/德文/法文/日文/韩文）
  const AUTO_ATTACK_PATTERN = /^(攻击|Attack|Attacke|Attaque|攻撃|공격|unknown_[0-9a-f]{4})$/i

  // 坦克职业列表（使用 Job 类型）
  const TANK_JOBS: Job[] = ['PLD', 'WAR', 'DRK', 'GNB']

  // 按 packetID 聚合伤害
  const packetMap = new Map<
    number,
    {
      name: string
      abilityId: number
      abilityType: number
      firstTime: number
      sourceID: number
      playerDamages: Map<
        number,
        {
          playerId: number
          job: string
          unmitigatedDamage: number
          absorbedDamage: number
          finalDamage: number
        }
      >
    }
  >()

  // 聚合相同 packetID 的伤害
  for (const event of events) {
    if (event.type !== 'damage') continue

    // 只保留来自敌对单位的伤害
    if (!event.targetIsFriendly) continue

    const packetID = event.packetID
    if (!packetID) continue

    const abilityId = event.ability?.guid || 0
    const abilityName = event.ability?.name || '未知技能'
    const abilityType = event.ability?.type || 0
    const timestamp = event.timestamp || 0
    const sourceID = event.sourceID || 0

    // 忽略普通攻击（多语言匹配）
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
        firstTime: timestamp,
        sourceID,
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

  // 转换为 DamageEvent 数组
  const damageEvents: DamageEvent[] = []
  let index = 0

  for (const [, data] of packetMap) {
    // 计算总伤害（用于过滤）
    let totalUnmitigatedDamage = 0
    for (const playerDamage of data.playerDamages.values()) {
      totalUnmitigatedDamage += playerDamage.unmitigatedDamage
    }

    // 只保留造成显著伤害的技能（总伤害 > 10000）
    if (totalUnmitigatedDamage < 10000) continue

    // 计算相对时间（精确到 0.01 秒）
    const relativeTime = Math.round((data.firstTime - fightStartTime) / 10) / 100

    // 跳过负数时间
    if (relativeTime < 0) continue

    // 获取技能中文名，如果没有则使用原始名称
    const chineseName = getActionChinese(data.abilityId)
    const skillName = chineseName ?? data.name

    // 构建玩家伤害详情列表
    const playerDamageDetails: Array<{
      playerId: number
      job: Job
      skillName: string
      unmitigatedDamage: number
      absorbedDamage: number
      finalDamage: number
    }> = []

    for (const playerDamage of data.playerDamages.values()) {
      const job = JOB_MAP[playerDamage.job]
      if (!job) continue

      playerDamageDetails.push({
        playerId: playerDamage.playerId,
        job,
        skillName,
        unmitigatedDamage: playerDamage.unmitigatedDamage,
        absorbedDamage: playerDamage.absorbedDamage,
        finalDamage: playerDamage.finalDamage,
      })
    }

    // 计算平均伤害：优先使用非坦克玩家的平均值
    const nonTankDamages = playerDamageDetails.filter(
      (detail) => !TANK_JOBS.includes(detail.job)
    )

    let averageDamage: number
    if (nonTankDamages.length > 0) {
      // 有非坦克玩家，使用非坦克玩家的平均值
      const sum = nonTankDamages.reduce((acc, d) => acc + d.unmitigatedDamage, 0)
      averageDamage = Math.floor(sum / nonTankDamages.length)
    } else {
      // 只有坦克玩家，使用所有玩家的平均值
      const sum = playerDamageDetails.reduce((acc, d) => acc + d.unmitigatedDamage, 0)
      averageDamage = Math.floor(sum / playerDamageDetails.length)
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

  // 按时间排序
  damageEvents.sort((a, b) => a.time - b.time)

  // 合并 0.9 秒内的同名伤害事件
  const mergedEvents: DamageEvent[] = []
  let i = 0

  while (i < damageEvents.length) {
    const currentEvent = damageEvents[i]
    const eventsToMerge: DamageEvent[] = [currentEvent]

    // 查找 0.9 秒内的同名事件
    let j = i + 1
    while (j < damageEvents.length) {
      const nextEvent = damageEvents[j]
      const timeDiff = nextEvent.time - currentEvent.time

      if (timeDiff <= 0.9 && nextEvent.name === currentEvent.name) {
        eventsToMerge.push(nextEvent)
        j++
      } else {
        break
      }
    }

    if (eventsToMerge.length === 1) {
      // 没有需要合并的事件
      mergedEvents.push(currentEvent)
      i++
    } else {
      // 合并多个事件
      const mergedEvent = mergeMultipleDamageEvents(eventsToMerge)
      mergedEvents.push(mergedEvent)
      i = j
    }
  }

  return mergedEvents
}

/**
 * 合并多个伤害事件
 */
function mergeMultipleDamageEvents(events: DamageEvent[]): DamageEvent {
  if (events.length === 1) return events[0]

  // 使用第一个事件作为基础
  const baseEvent = events[0]

  // 合并所有玩家伤害详情
  const playerDamageMap = new Map<
    number,
    {
      playerId: number
      job: Job
      skillName: string
      unmitigatedDamage: number
      absorbedDamage: number
      finalDamage: number
    }
  >()

  for (const event of events) {
    for (const detail of event.playerDamageDetails || []) {
      const existing = playerDamageMap.get(detail.playerId)
      if (existing) {
        // 累加伤害
        existing.unmitigatedDamage += detail.unmitigatedDamage
        existing.absorbedDamage += detail.absorbedDamage
        existing.finalDamage += detail.finalDamage
      } else {
        playerDamageMap.set(detail.playerId, { ...detail })
      }
    }
  }

  const mergedPlayerDamageDetails = Array.from(playerDamageMap.values())

  // 重新计算平均伤害
  const TANK_JOBS: Job[] = ['PLD', 'WAR', 'DRK', 'GNB']
  const nonTankDamages = mergedPlayerDamageDetails.filter(
    (detail) => !TANK_JOBS.includes(detail.job)
  )

  let averageDamage: number
  if (nonTankDamages.length > 0) {
    const sum = nonTankDamages.reduce((acc, d) => acc + d.unmitigatedDamage, 0)
    averageDamage = Math.floor(sum / nonTankDamages.length)
  } else {
    const sum = mergedPlayerDamageDetails.reduce((acc, d) => acc + d.unmitigatedDamage, 0)
    averageDamage = Math.floor(sum / mergedPlayerDamageDetails.length)
  }

  return {
    ...baseEvent,
    damage: averageDamage,
    playerDamageDetails: mergedPlayerDamageDetails,
  }
}

/**
 * 检测伤害类型（根据命中次数）
 */
function detectDamageType(hitCount: number): 'aoe' | 'tankbuster' | 'raidwide' {
  if (hitCount >= 8) {
    return 'raidwide' // 全团伤害
  } else if (hitCount >= 4) {
    return 'aoe' // AOE 伤害
  } else {
    return 'tankbuster' // 坦克死刑
  }
}

/**
 * 根据 ability.type 判断伤害类型
 * @param abilityType - FFLogs ability.type 字段
 * @returns 'physical' | 'magical' | 'special'
 *
 * FFLogs ability.type 值：
 * - 1024: 魔法伤害
 * - 128: 物理伤害
 * - 其他: 特殊伤害（无视减伤、真实伤害等）
 */
function detectDamageTypeFromAbility(abilityType: number): 'physical' | 'magical' | 'special' {
  if (abilityType === 1024) {
    return 'magical'
  } else if (abilityType === 128) {
    return 'physical'
  }
  // 未知类型视为特殊伤害
  return 'special'
}

/**
 * 解析状态附加/移除事件，转换为 StatusEvent
 *
 * 逻辑：
 * 1. 遍历所有 applybuff/applydebuff 事件
 * 2. 查找对应的 removebuff/removedebuff 事件
 * 3. 生成带有 startTime/endTime 的 StatusEvent
 */
export function parseStatusEvents(
  events: any[],
  fightStartTime: number
): StatusEvent[] {
  const statusEvents: StatusEvent[] = []

  // 按状态 ID 和目标分组，存储 apply 事件
  const applyEventsMap = new Map<string, any[]>()
  const removeEventsMap = new Map<string, any[]>()

  // 第一遍：收集所有 apply 和 remove 事件
  for (const event of events) {
    if (
      event.type !== 'applybuff' &&
      event.type !== 'removebuff' &&
      event.type !== 'applydebuff' &&
      event.type !== 'removedebuff'
    ) {
      continue
    }

    // 提取状态 ID（去除 1000000 偏移）
    const statusId = event.ability?.guid
      ? Math.max(0, event.ability.guid - 1e6)
      : 0

    if (!statusId) continue

    // 生成唯一键：statusId + targetID + targetInstance
    const key = `${statusId}-${event.targetID || 0}-${event.targetInstance || 0}`

    if (event.type === 'applybuff' || event.type === 'applydebuff') {
      if (!applyEventsMap.has(key)) {
        applyEventsMap.set(key, [])
      }
      applyEventsMap.get(key)!.push(event)
    } else {
      if (!removeEventsMap.has(key)) {
        removeEventsMap.set(key, [])
      }
      removeEventsMap.get(key)!.push(event)
    }
  }

  // 第二遍：配对 apply 和 remove 事件
  for (const [key, applyEvents] of applyEventsMap) {
    const removeEvents = removeEventsMap.get(key) || []

    // 按时间排序
    applyEvents.sort((a, b) => a.timestamp - b.timestamp)
    removeEvents.sort((a, b) => a.timestamp - b.timestamp)

    let removeIndex = 0

    for (const applyEvent of applyEvents) {
      const statusId = Math.max(0, (applyEvent.ability?.guid || 0) - 1e6)
      const startTime = (applyEvent.timestamp - fightStartTime) / 1000 // 转换为秒

      // 查找对应的 remove 事件（时间晚于 apply）
      let endTime = startTime + 30 // 默认 30 秒

      while (removeIndex < removeEvents.length) {
        const removeEvent = removeEvents[removeIndex]
        const removeTime = (removeEvent.timestamp - fightStartTime) / 1000 // 转换为秒

        if (removeTime > startTime) {
          endTime = removeTime
          removeIndex++
          break
        }
        removeIndex++
      }

      statusEvents.push({
        statusId,
        startTime,
        endTime,
        sourcePlayerId: applyEvent.sourceID,
        targetPlayerId: applyEvent.targetID,
        targetInstance: applyEvent.targetInstance,
        absorb: applyEvent.absorb, // FFLogs 盾值字段
      })
    }
  }

  return statusEvents
}

/**
 * 从 FFLogs 数据解析技能使用事件（CastEvent）
 */
export function parseCastEventsFromFFLogs(
  events: any[],
  fightStartTime: number,
  playerMap: Map<number, FFLogsV1Actor>,
  damageEvents: DamageEvent[]
): CastEvent[] {
  const castEventsResult: CastEvent[] = []

  // 创建有效技能 ID 集合
  const validActionIds = new Set(MITIGATION_DATA.actions.map((a) => a.id))

  // 解析技能使用事件
  const rawCastEvents: Array<{
    timestamp: number
    abilityGameID: number
    sourceID: number
    targetID?: number
    sourceIsFriendly: boolean
  }> = []

  for (const event of events) {
    // 只处理技能使用事件
    if (event.type !== 'cast') {
      continue
    }

    // 提取技能 ID（技能 ID 没有偏移）
    const abilityGameID = event.ability?.guid
    if (!abilityGameID) continue

    rawCastEvents.push({
      timestamp: (event.timestamp - fightStartTime) / 1000, // 相对时间（秒）
      abilityGameID,
      sourceID: event.sourceID,
      targetID: event.targetID,
      sourceIsFriendly: event.sourceIsFriendly === true,
    })
  }

  for (const event of rawCastEvents) {
    // 只保留在我们技能列表中的技能
    if (!validActionIds.has(event.abilityGameID)) continue

    // 检查是否为友方玩家施放的技能
    if (!event.sourceIsFriendly) continue

    const sourceId = event.sourceID
    const player = playerMap.get(sourceId)
    if (!player) continue

    const job = JOB_MAP[player.type]
    if (!job) continue

    // 创建 CastEvent
    castEventsResult.push({
      id: `cast-${castEventsResult.length}`,
      actionId: event.abilityGameID,
      timestamp: event.timestamp,
      playerId: sourceId,
      job,
      targetPlayerId: event.targetID,
    })
  }

  return castEventsResult
}
