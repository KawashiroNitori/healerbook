/**
 * FFLogs 数据解析工具（V2 API）
 */

import type { FFLogsReport, FFLogsAbility, FFLogsEvent } from '@/types/fflogs'
import type {
  Composition,
  DamageEvent,
  CastEvent,
  PlayerDamageDetail,
  StatusSnapshot,
  DamageType,
} from '@/types/timeline'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getStatusById } from '@/utils/statusRegistry'
import actionChineseRaw from '@ff14-overlay/resources/generated/actionChinese.json'
import { JOB_MAP } from '@/data/jobMap'
import { getTankJobs, type Job } from '@/data/jobs'
import { calculatePercentile } from './stats'

const actionChinese: Record<string, string> = actionChineseRaw

function getActionChinese(actionId: number): string | undefined {
  return actionChinese[actionId.toString()]
}

/**
 * 解析小队阵容
 * V2: actors(type:"Player") 已过滤，无 fights 数组
 * participantIds: 实际参与战斗的玩家 ID 集合（从事件数据中提取）
 */
export function parseComposition(
  report: FFLogsReport,
  _fightId: number,
  participantIds?: Set<number>
): Composition {
  const composition: Composition = { players: [] }
  if (!report.friendlies) return composition

  for (const actor of report.friendlies) {
    const job = JOB_MAP[actor.type]
    if (!job) continue
    if (participantIds && !participantIds.has(actor.id)) continue
    composition.players.push({ id: actor.id, job })
  }

  return composition
}

/**
 * 解析伤害事件（只保留 Boss 技能）
 *
 * V2 事件字段：abilityGameID, packetID, sourceID, targetID, amount, unmitigatedAmount, absorbed
 * 重构后的四步流程：
 * 1. 从 damage 事件中过滤出对玩家的伤害，构建原始 PlayerDamageDetail（缺少护盾数据）
 * 2. 从 absorbed 事件中构建耗盾事件四元组，匹配到对应的 PlayerDamageDetail
 * 3. 将护盾数据 push 到 PlayerDamageDetail 的护盾列表
 * 4. 按 packetID 汇总 PlayerDamageDetail，构建 DamageEvent
 */
export function parseDamageEvents(
  events: FFLogsEvent[],
  fightStartTime: number,
  playerMap: Map<number, { id: number; name: string; type: string }>,
  abilityMap?: Map<number, FFLogsAbility>
): DamageEvent[] {
  const AUTO_ATTACK_PATTERN = /^(攻击|Attack|Attacke|Attaque|攻撃|공격|unknown_[0-9a-f]{4})$/i
  const TANK_JOBS = getTankJobs()

  // Step 1: 从 damage 事件中构建原始 PlayerDamageDetail，并解析 buffs 字段
  const playerDamageDetails: PlayerDamageDetail[] = []

  for (const event of events) {
    if (event.type !== 'damage') continue
    if (!event.targetID || !playerMap.has(event.targetID)) continue
    if (!event.packetID) continue

    const abilityId = event.abilityGameID ?? 0
    const abilityMeta = abilityMap?.get(abilityId)
    const abilityName = abilityMeta?.name ?? '未知技能'

    if (AUTO_ATTACK_PATTERN.test(abilityName)) continue
    if (abilityId === 16152) continue // 超火流星

    const player = playerMap.get(event.targetID)
    if (!player) continue

    const job = JOB_MAP[player.type]
    if (!job) continue

    const chineseName = getActionChinese(abilityId)
    const skillName = chineseName ?? abilityName

    // 计算未减伤伤害：优先使用 unmitigatedAmount，为 0 时从 absorbed 和 multiplier 推测
    let unmitigatedDamage = event.unmitigatedAmount ?? 0
    if (unmitigatedDamage === 0) {
      const finalAmount = event.amount ?? 0
      const absorbed = event.absorbed ?? 0
      const multiplier = event.multiplier
      if (multiplier && multiplier > 0 && (finalAmount > 0 || absorbed > 0)) {
        unmitigatedDamage = Math.round((finalAmount + absorbed) / multiplier)
      } else {
        continue
      }
    }

    // 解析 buffs 字段，提取所有减伤状态（百分比减伤和盾值）
    const statuses: StatusSnapshot[] = []
    if (event.buffs) {
      const buffIds: number[] = (event.buffs as string).split('.').filter(Boolean).map(Number)

      for (const buffId of buffIds) {
        const statusId = buffId > 1_000_000 ? buffId - 1_000_000 : buffId
        const statusMeta = getStatusById(statusId)

        // 添加百分比减伤状态和盾值状态（盾值先留空，后续通过 absorbed 事件填充）
        if (statusMeta) {
          statuses.push({
            statusId,
            targetPlayerId: event.targetID,
            absorb: undefined, // 盾值状态的 absorb 字段后续填充
          })
        }
      }
    }

    playerDamageDetails.push({
      timestamp: event.timestamp || 0,
      packetId: event.packetID,
      sourceId: event.sourceID || 0,
      playerId: event.targetID,
      job,
      abilityId,
      skillName,
      unmitigatedDamage: unmitigatedDamage,
      finalDamage: event.amount || 0,
      overkill: event.overkill,
      multiplier: event.multiplier,
      statuses,
      hitPoints: event.targetResources?.hitPoints,
      maxHitPoints: event.targetResources?.maxHitPoints,
    })
  }

  // Step 2 & 3: 从 absorbed 事件中构建耗盾四元组，匹配并添加盾值状态
  // 构建查找 Map: key = `${timestamp}-${targetID}-${sourceID}-${abilityGameID}`
  const detailMap = new Map<string, PlayerDamageDetail>()
  for (const detail of playerDamageDetails) {
    const key = `${detail.timestamp}-${detail.playerId}-${detail.sourceId}-${detail.abilityId}`
    detailMap.set(key, detail)
  }

  for (const event of events) {
    if (event.type !== 'absorbed') continue
    if (!event.amount) continue
    if (!event.targetID) continue

    // FFLogs 的 absorbed 事件会把泛输血（1002613）记录为泛血印（1002643）
    let statusId = event.abilityGameID
    if (statusId === 1002643) statusId = 1002613

    const actualStatusId = statusId && statusId > 1_000_000 ? statusId - 1_000_000 : statusId || 0

    // 构建匹配 key: 使用 attackerID 匹配 damage 事件的 sourceID
    const key = `${event.timestamp}-${event.targetID}-${event.attackerID}-${event.extraAbilityGameID}`
    const detail = detailMap.get(key)

    if (detail) {
      // 查找 statuses 中是否已存在该盾值状态
      const existingStatus = detail.statuses.find(s => s.statusId === actualStatusId)
      if (existingStatus) {
        // 填充盾值字段
        existingStatus.absorb = event.amount
      }
    }
  }

  // Step 4: 按时间窗口（0.9秒）+ 技能名称汇总，构建 DamageEvent
  const TIME_WINDOW = 900 // 0.9秒 = 900毫秒

  // 按时间排序所有 PlayerDamageDetail
  playerDamageDetails.sort((a, b) => a.timestamp - b.timestamp)

  const damageEvents: DamageEvent[] = []
  const processedIndices = new Set<number>()

  for (let i = 0; i < playerDamageDetails.length; i++) {
    if (processedIndices.has(i)) continue

    const baseDetail = playerDamageDetails[i]
    const details: PlayerDamageDetail[] = [baseDetail]
    processedIndices.add(i)

    // 查找时间窗口内相同技能名称的其他伤害
    for (let j = i + 1; j < playerDamageDetails.length; j++) {
      if (processedIndices.has(j)) continue

      const currentDetail = playerDamageDetails[j]
      const timeDiff = currentDetail.timestamp - baseDetail.timestamp

      // 超出时间窗口，停止查找
      if (timeDiff > TIME_WINDOW) break

      // 相同技能名称，合并
      if (currentDetail.skillName === baseDetail.skillName) {
        details.push(currentDetail)
        processedIndices.add(j)
      }
    }

    // 过滤总伤害过低的事件
    const totalUnmitigatedDamage = details.reduce((sum, d) => sum + d.unmitigatedDamage, 0)
    if (totalUnmitigatedDamage < 10000) continue

    // 找到最早的 detail
    const firstDetail = details.reduce((earliest, current) =>
      current.timestamp < earliest.timestamp ? current : earliest
    )
    const relativeTime = Math.round((firstDetail.timestamp - fightStartTime) / 10) / 100
    if (relativeTime < 0) continue

    // 计算中位数伤害（非坦克优先）
    const nonTankDetails = details.filter(d => !TANK_JOBS.includes(d.job))
    const detailsForMedian = nonTankDetails.length > 0 ? nonTankDetails : details
    const medianDamage = calculatePercentile(detailsForMedian.map(d => d.unmitigatedDamage))

    const abilityMeta = abilityMap?.get(firstDetail.abilityId)
    damageEvents.push({
      id: `event-${firstDetail.timestamp}-${firstDetail.abilityId}`,
      name: firstDetail.skillName,
      time: relativeTime,
      damage: medianDamage,
      type: detectDamageType(details, TANK_JOBS),
      damageType: detectDamageTypeFromAbility(abilityMeta?.type ?? 0),
      playerDamageDetails: details,
      packetId: firstDetail.packetId,
    })
  }

  damageEvents.sort((a, b) => a.time - b.time)

  // 后处理：验证 tankbuster 分类
  refineTankbusterClassification(damageEvents)

  return damageEvents
}

function detectDamageType(details: PlayerDamageDetail[], tankJobs: Job[]): 'aoe' | 'tankbuster' {
  const uniquePlayerIds = new Set(details.map(d => d.playerId))
  if (uniquePlayerIds.size > 2) return 'aoe'
  if (uniquePlayerIds.size > 0 && details.every(d => tankJobs.includes(d.job))) return 'tankbuster'
  return 'aoe'
}

/**
 * 后处理：验证 tankbuster 分类
 *
 * 1. 交叉验证：同 abilityId 在其他实例中命中过非坦克 → 回退为 aoe
 * 2. 伤害量验证：人均伤害需显著高于本场 aoe 中位数（1.5x），否则回退为 aoe
 */
function refineTankbusterClassification(damageEvents: DamageEvent[]): void {
  // Step 1: 交叉验证 —— 同 abilityId 只要有一次命中非坦克就不是死刑
  const abilityHasNonTankTarget = new Set<number>()
  for (const event of damageEvents) {
    if (event.type === 'aoe') {
      const abilityId = event.playerDamageDetails?.[0]?.abilityId
      if (abilityId !== undefined) abilityHasNonTankTarget.add(abilityId)
    }
  }

  for (const event of damageEvents) {
    if (event.type !== 'tankbuster') continue
    const abilityId = event.playerDamageDetails?.[0]?.abilityId
    if (abilityId !== undefined && abilityHasNonTankTarget.has(abilityId)) {
      event.type = 'aoe'
    }
  }

  // Step 2: 伤害量验证 —— 人均伤害需显著高于 aoe 中位数
  const aoeDamages = damageEvents.filter(e => e.type === 'aoe').map(e => e.damage)
  if (aoeDamages.length > 0) {
    const medianAoeDamage = calculatePercentile(aoeDamages)
    for (const event of damageEvents) {
      if (event.type !== 'tankbuster') continue
      if (event.damage < medianAoeDamage * 1.5) {
        event.type = 'aoe'
      }
    }
  }
}

/**
 * 根据 ability.type 判断伤害类型
 * V2 API 返回字符串数字：'1024'=魔法，'128'=物理
 */
function detectDamageTypeFromAbility(abilityType: string | number): DamageType {
  const t = Number(abilityType)
  if (t === 1024) return 'magical'
  if (t === 128) return 'physical'
  return 'darkness'
}

/**
 * 解析技能使用事件（CastEvent）
 *
 * V2 事件字段：abilityGameID，sourceID，targetID
 * 通过 playerMap 判断是否为友方玩家施放
 */
export function parseCastEvents(
  events: FFLogsEvent[],
  fightStartTime: number,
  playerMap: Map<number, { id: number; name: string; type: string }>
): CastEvent[] {
  const castEventsResult: CastEvent[] = []
  const validActionIds = new Set(MITIGATION_DATA.actions.map(a => a.id))

  for (const event of events) {
    if (event.type !== 'cast') continue

    const abilityGameID = event.abilityGameID
    if (!abilityGameID) continue

    // 降临之章（37016）是意气轩昂之策（37013）在炽天附体激活时的变体，导入时统一归并为 37013
    const effectiveAbilityId = abilityGameID === 37016 ? 37013 : abilityGameID

    if (!validActionIds.has(effectiveAbilityId)) continue

    if (!event.sourceID) continue
    const player = playerMap.get(event.sourceID)
    if (!player) continue

    const job = JOB_MAP[player.type]
    if (!job) continue

    castEventsResult.push({
      id: `cast-${castEventsResult.length}`,
      actionId: effectiveAbilityId,
      timestamp: (event.timestamp - fightStartTime) / 1000,
      playerId: event.sourceID,
      job,
      targetPlayerId: event.targetID,
    })
  }

  return castEventsResult
}
