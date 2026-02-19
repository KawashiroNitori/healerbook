/**
 * FFLogs 数据解析工具
 */

import type {
  FFLogsEvent,
  FFLogsDamageTakenEvent,
  FFLogsActor,
} from '@/types/fflogs'
import type { DamageEvent, Composition, Job } from '@/types/timeline'

/**
 * 职业 ID 到职业名称的映射
 * TODO: 未来用于解析 FFLogs 数据
 */
// @ts-expect-error - 保留用于未来功能
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const JOB_ID_MAP: Record<number, Job> = {
  // 坦克
  19: 'PLD',
  21: 'WAR',
  32: 'DRK',
  37: 'GNB',
  // 治疗
  24: 'WHM',
  28: 'SCH',
  33: 'AST',
  40: 'SGE',
  // 近战 DPS
  22: 'MNK',
  20: 'DRG',
  30: 'NIN',
  34: 'SAM',
  39: 'RPR',
  41: 'VPR',
  // 远程物理 DPS
  23: 'BRD',
  31: 'MCH',
  38: 'DNC',
  // 远程魔法 DPS
  25: 'BLM',
  27: 'SMN',
  35: 'RDM',
  42: 'PCT',
}

/**
 * 解析伤害事件
 */
export function parseDamageEvents(
  rawEvents: FFLogsEvent[],
  phaseId: string
): DamageEvent[] {
  const damageEvents: DamageEvent[] = []
  const eventMap = new Map<string, { damage: number; count: number; time: number }>()

  // 聚合相同技能的伤害
  for (const event of rawEvents) {
    if (event.type !== 'damage') continue

    const damageEvent = event as FFLogsDamageTakenEvent
    const abilityId = damageEvent.abilityGameID?.toString() || 'unknown'
    const time = Math.floor(damageEvent.timestamp / 1000) // 转换为秒

    if (eventMap.has(abilityId)) {
      const existing = eventMap.get(abilityId)!
      existing.damage += damageEvent.amount
      existing.count += 1
    } else {
      eventMap.set(abilityId, {
        damage: damageEvent.amount,
        count: 1,
        time,
      })
    }
  }

  // 转换为 DamageEvent 数组
  let index = 0
  for (const [abilityId, data] of eventMap) {
    // 只保留造成显著伤害的技能（平均伤害 > 5000）
    const avgDamage = data.damage / data.count
    if (avgDamage < 5000) continue

    damageEvents.push({
      id: `damage_${index++}`,
      name: `技能 ${abilityId}`, // 实际应该从技能数据库查询
      time: data.time,
      damage: Math.floor(avgDamage),
      type: detectDamageType(data.count),
      damageType: 'physical', // 默认为物理伤害,TODO: 从技能数据库查询
      phaseId,
    })
  }

  // 按时间排序
  return damageEvents.sort((a, b) => a.time - b.time)
}

/**
 * 检测伤害类型
 */
function detectDamageType(hitCount: number): 'aoe' | 'tankbuster' | 'raidwide' {
  // 简单的启发式规则
  if (hitCount >= 8) {
    return 'raidwide' // 全团伤害
  } else if (hitCount >= 4) {
    return 'aoe' // AOE 伤害
  } else {
    return 'tankbuster' // 坦克死刑
  }
}

/**
 * 解析小队阵容
 */
export function parseComposition(actors: FFLogsActor[]): Composition {
  const tanks: Job[] = []
  const healers: Job[] = []
  const dps: Job[] = []

  for (const actor of actors) {
    if (actor.type !== 'Player') continue

    // @ts-expect-error - subType 属性在某些版本的 FFLogsActor 中可能不存在
    const job = getJobFromSubType(actor.subType)
    if (!job) continue

    const role = getJobRole(job)
    switch (role) {
      case 'tank':
        tanks.push(job)
        break
      case 'healer':
        healers.push(job)
        break
      case 'dps':
        dps.push(job)
        break
    }
  }

  return { tanks, healers, dps }
}

/**
 * 从 subType 获取职业
 */
function getJobFromSubType(subType?: string): Job | null {
  if (!subType) return null

  // FFLogs 使用职业名称作为 subType
  const jobMap: Record<string, Job> = {
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

  return jobMap[subType] || null
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
 * 从报告代码提取报告 ID
 */
export function extractReportCode(url: string): string | null {
  // 支持多种 URL 格式
  // https://www.fflogs.com/reports/ABC123
  // https://zh.fflogs.com/reports/ABC123
  // ABC123

  const match = url.match(/reports\/([a-zA-Z0-9]+)/)
  if (match) {
    return match[1]
  }

  // 如果是纯代码
  if (/^[a-zA-Z0-9]+$/.test(url)) {
    return url
  }

  return null
}

/**
 * 格式化时间戳
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * 计算战斗时长（秒）
 */
export function calculateDuration(startTime: number, endTime: number): number {
  return Math.floor((endTime - startTime) / 1000)
}
