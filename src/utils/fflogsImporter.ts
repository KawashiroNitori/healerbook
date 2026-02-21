/**
 * FFLogs 数据解析工具（完整版）
 */

import type { FFLogsReport, FFLogsV1Actor } from '@/types/fflogs'
import type { Composition, Job, DamageEvent, MitigationAssignment } from '@/types/timeline'

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
    tanks: [],
    healers: [],
    dps: [],
  }

  if (!report.friendlies) return composition

  // 找到参与该战斗的玩家
  const playersInFight = report.friendlies.filter((actor) =>
    actor.fights?.some((f) => f.id === fightId)
  )

  for (const player of playersInFight) {
    const job = JOB_MAP[player.type]
    if (!job) continue

    const role = getJobRole(job)
    switch (role) {
      case 'tank':
        composition.tanks.push(job)
        break
      case 'healer':
        composition.healers.push(job)
        break
      case 'dps':
        composition.dps.push(job)
        break
    }
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
 */
export function parseDamageEvents(
  events: any[],
  fightStartTime: number
): DamageEvent[] {
  // 按 packetID 聚合伤害
  const packetMap = new Map<
    number,
    {
      name: string
      abilityId: number
      abilityType: number
      totalUnmitigatedDamage: number
      hitCount: number
      firstTime: number
      sourceID: number
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
    const unmitigatedAmount = event.unmitigatedAmount || event.amount || 0
    const timestamp = event.timestamp || 0
    const sourceID = event.sourceID || 0

    if (packetMap.has(packetID)) {
      const existing = packetMap.get(packetID)!
      existing.totalUnmitigatedDamage += unmitigatedAmount
      existing.hitCount += 1
    } else {
      packetMap.set(packetID, {
        name: abilityName,
        abilityId,
        abilityType,
        totalUnmitigatedDamage: unmitigatedAmount,
        hitCount: 1,
        firstTime: timestamp,
        sourceID,
      })
    }
  }

  // 转换为 DamageEvent 数组
  const damageEvents: DamageEvent[] = []
  let index = 0

  for (const [, data] of packetMap) {
    // 只保留造成显著伤害的技能（总伤害 > 10000）
    if (data.totalUnmitigatedDamage < 10000) continue

    // 计算相对时间（秒）
    const relativeTime = Math.floor((data.firstTime - fightStartTime) / 1000)

    // 跳过负数时间
    if (relativeTime < 0) continue

    damageEvents.push({
      id: `event-${index++}`,
      name: data.name,
      time: relativeTime,
      damage: Math.floor(data.totalUnmitigatedDamage),
      type: detectDamageType(data.hitCount),
      damageType: detectDamageTypeFromAbility(data.abilityType),
    })
  }

  // 按时间排序
  return damageEvents.sort((a, b) => a.time - b.time)
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
 * 解析减伤技能使用记录
 */
export function parseMitigationAssignments(
  events: any[],
  fightStartTime: number,
  playerMap: Map<number, FFLogsV1Actor>,
  damageEvents: DamageEvent[]
): MitigationAssignment[] {
  const assignments: MitigationAssignment[] = []

  // 收集所有技能施放和 buff 应用事件
  const skillEvents = events.filter((event) => {
    // 处理技能施放、buff 应用、buff 刷新事件
    return (
      event.type === 'cast' ||
      event.type === 'applybuff' ||
      event.type === 'applydebuff' ||
      event.type === 'refreshbuff'
    )
  })

  for (const event of skillEvents) {
    const abilityId = Math.max(0, event.ability?.guid - 1e6)
    if (!abilityId) continue

    // 检查是否为友方玩家施放的技能
    if (event.sourceIsFriendly !== true) continue

    const sourceId = event.sourceID
    const player = playerMap.get(sourceId)
    if (!player) continue

    const job = JOB_MAP[player.type]
    if (!job) continue

    // 计算相对时间（秒）
    const relativeTime = Math.floor((event.timestamp - fightStartTime) / 1000)
    if (relativeTime < 0) continue

    // 查找最接近的伤害事件（前后 30 秒内）
    const nearestDamageEvent = damageEvents.find((dmgEvent) => {
      const timeDiff = Math.abs(dmgEvent.time - relativeTime)
      return timeDiff <= 30
    })

    // 如果没有找到最接近的伤害事件，仍然记录技能，但不关联到具体事件
    const damageEventId = nearestDamageEvent?.id || ''

    // 创建减伤分配记录
    assignments.push({
      id: `assignment-${assignments.length}`,
      actionId: abilityId,
      damageEventId,
      time: relativeTime,
      job,
    })
  }

  return assignments
}
