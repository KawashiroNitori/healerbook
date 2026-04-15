/**
 * FFLogs 数据解析工具（V2 API）
 */

import type { FFLogsReport, FFLogsV1Report, FFLogsAbility, FFLogsEvent } from '@/types/fflogs'
import type {
  Composition,
  DamageEvent,
  CastEvent,
  PlayerDamageDetail,
  DamageType,
  SyncEvent,
} from '@/types/timeline'
import { SOUMA_SYNC_RULES } from '@/data/soumaSyncRules'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getStatusById } from '@/utils/statusRegistry'
import actionChineseRaw from '@ff14-overlay/resources/generated/actionChinese.json'
import { JOB_MAP } from '@/data/jobMap'
import { getTankJobs, getJobRole, type Job } from '@/data/jobs'
import { calculatePercentile } from './stats'

const actionChinese: Record<string, string> = actionChineseRaw

/**
 * 将 Worker 返回的 V1 格式报告转换为 FFLogsReport
 */
export function convertV1ToReport(v1Report: FFLogsV1Report, reportCode: string): FFLogsReport {
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
      gameZoneId: fight.gameZoneID,
    })),
    friendlies: v1Report.friendlies,
    enemies: v1Report.enemies,
    abilities: v1Report.abilities,
  }
}

function getActionChinese(actionId: number): string | undefined {
  return actionChinese[actionId.toString()]
}

/**
 * 从事件列表中找到第一个 calculateddamage 事件的时间戳，作为战斗零时间
 * 如果没有 calculateddamage，回退到第一个 damage 事件，最后回退到 fallback
 */
export function findFirstDamageTimestamp(events: FFLogsEvent[], fallback: number): number {
  let firstDamage: number | undefined
  for (const event of events) {
    if (event.type === 'calculateddamage') return event.timestamp
    if (event.type === 'damage' && firstDamage === undefined) firstDamage = event.timestamp
  }
  return firstDamage ?? fallback
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

  // DOT 追踪：记录 applydebuff 事件的快照时间和来源技能
  // key: `${abilityGameID}-${targetID}`, value: { timestamp, extraAbilityGameID }
  const dotDebuffMap = new Map<string, { timestamp: number; extraAbilityGameID: number }>()

  // Step 1 & 2: 单次遍历事件
  // - applydebuff: 记录 DOT 快照信息
  // - calculateddamage: 创建 detail（时间戳最准确）
  // - damage: 填充数值，若无 calculateddamage 则同时创建 detail
  const playerDamageDetails: PlayerDamageDetail[] = []
  const damageTimestamps = new Map<PlayerDamageDetail, number>()
  const detailByPacketAndTarget = new Map<string, PlayerDamageDetail>()
  // 以 detail 对象身份为键的并行 Map，记录导入期使用的临时元数据。
  // PlayerDamageDetail 类型不再持有这些字段，但聚合阶段仍需要它们。
  const detailSkillNames = new Map<PlayerDamageDetail, string>()
  const detailSourceIds = new Map<PlayerDamageDetail, number>()
  const detailPacketIds = new Map<PlayerDamageDetail, number>()

  for (const event of events) {
    // 追踪 applydebuff 用于 DOT 快照
    if (event.type === 'applydebuff') {
      if (event.abilityGameID && event.targetID && event.extraAbilityGameID) {
        const debuffKey = `${event.abilityGameID}-${event.targetID}`
        dotDebuffMap.set(debuffKey, {
          timestamp: event.timestamp,
          extraAbilityGameID: event.extraAbilityGameID,
        })
      }
      continue
    }

    if (event.type !== 'calculateddamage' && event.type !== 'damage') continue
    if (!event.packetID || !event.targetID) continue
    if (!playerMap.has(event.targetID)) continue

    const abilityId = event.abilityGameID ?? 0
    const key = `${event.packetID}-${event.targetID}-${abilityId}`
    let detail = detailByPacketAndTarget.get(key)

    // detail 不存在时创建（calculateddamage 先到则时间戳更准确，否则用 damage 的）
    if (!detail) {
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

      // 检查是否为 DOT tick：需要 tick 标记且匹配已追踪的 applydebuff
      const debuffKey = `${abilityId}-${event.targetID}`
      const dotInfo = event.tick ? dotDebuffMap.get(debuffKey) : undefined

      detail = {
        timestamp: event.timestamp,
        playerId: event.targetID,
        job,
        abilityId,
        unmitigatedDamage: 0,
        finalDamage: 0,
        statuses: [],
        snapshotTimestamp: dotInfo?.timestamp,
      }

      playerDamageDetails.push(detail)
      detailByPacketAndTarget.set(key, detail)
      detailSkillNames.set(detail, skillName)
      detailSourceIds.set(detail, event.sourceID || 0)
      detailPacketIds.set(detail, event.packetID)
    }

    // calculateddamage 仅用于创建 detail，不携带数值字段
    if (event.type === 'calculateddamage') continue

    // 填充数值字段（从 damage 事件获取）
    let unmitigatedDamage = event.unmitigatedAmount ?? 0
    if (unmitigatedDamage === 0) {
      const finalAmount = event.amount ?? 0
      const absorbed = event.absorbed ?? 0
      const multiplier = event.multiplier
      if (multiplier && multiplier > 0 && (finalAmount > 0 || absorbed > 0)) {
        unmitigatedDamage = Math.round((finalAmount + absorbed) / multiplier)
      }
    }

    detail.unmitigatedDamage = unmitigatedDamage
    detail.finalDamage = event.amount || 0
    detail.overkill = event.overkill
    detail.multiplier = event.multiplier

    // 填充 buffs
    if (event.buffs) {
      const buffIds: number[] = (event.buffs as string).split('.').filter(Boolean).map(Number)
      for (const buffId of buffIds) {
        const statusId = buffId > 1_000_000 ? buffId - 1_000_000 : buffId
        const statusMeta = getStatusById(statusId)
        if (statusMeta) {
          detail.statuses.push({
            statusId,
            absorb: undefined,
          })
        }
      }
    }

    if (event.targetResources) {
      detail.hitPoints = event.targetResources.hitPoints
      detail.maxHitPoints = event.targetResources.maxHitPoints
    }

    // 记录 damage 时间戳，用于 absorbed 匹配
    damageTimestamps.set(detail, event.timestamp)

    // damage 已填充，从 map 中移除，避免 dot tick 等同 key 多次 damage 合并到同一 detail
    detailByPacketAndTarget.delete(key)
  }

  // Step 3: 从 absorbed 事件填充盾值状态
  // absorbed 的时间戳与 damage 一致，用 damage 时间戳做匹配 key
  const detailByDamageTs = new Map<string, PlayerDamageDetail>()
  for (const detail of playerDamageDetails) {
    const ts = damageTimestamps.get(detail) ?? detail.timestamp
    const sourceId = detailSourceIds.get(detail) ?? 0
    const key = `${ts}-${detail.playerId}-${sourceId}-${detail.abilityId}`
    detailByDamageTs.set(key, detail)
  }

  for (const event of events) {
    if (event.type !== 'absorbed') continue
    if (!event.amount) continue
    if (!event.targetID) continue

    // FFLogs 的 absorbed 事件会把泛输血（1002613）记录为泛血印（1002643）
    let statusId = event.abilityGameID
    if (statusId === 1002643) statusId = 1002613

    const actualStatusId = statusId && statusId > 1_000_000 ? statusId - 1_000_000 : statusId || 0

    // 使用 damage 时间戳匹配（absorbed 与 damage 时间戳一致）
    const key = `${event.timestamp}-${event.targetID}-${event.attackerID}-${event.extraAbilityGameID}`
    const detail = detailByDamageTs.get(key)

    if (detail) {
      const existingStatus = detail.statuses.find(s => s.statusId === actualStatusId)
      if (existingStatus) {
        existingStatus.absorb = event.amount
      }
    }
  }

  // Step 4: 按时间窗口（0.9秒）+ 技能名称汇总，构建 DamageEvent
  const TIME_WINDOW = 900

  // 按时间排序所有 PlayerDamageDetail
  playerDamageDetails.sort((a, b) => a.timestamp - b.timestamp)

  const damageEvents: DamageEvent[] = []
  const processedIndices = new Set<number>()

  for (let i = 0; i < playerDamageDetails.length; i++) {
    if (processedIndices.has(i)) continue

    const baseDetail = playerDamageDetails[i]
    const baseSkillName = detailSkillNames.get(baseDetail) ?? ''
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
      if (detailSkillNames.get(currentDetail) === baseSkillName) {
        details.push(currentDetail)
        processedIndices.add(j)
      }
    }

    // 注意：不要过滤低伤害事件。伤害为 0 表示数据缺失（如只有 calculateddamage 没有 damage），
    // 需要保留供用户在编辑器中手动填写。即使有数据但伤害值低，也不应过滤，
    // 因为某些机制伤害确实很低但对减伤规划仍有意义。

    // 找到最早的 detail
    const firstDetail = details.reduce((earliest, current) =>
      current.timestamp < earliest.timestamp ? current : earliest
    )
    const relativeTime = Math.round((firstDetail.timestamp - fightStartTime) / 10) / 100
    if (relativeTime < 0) continue

    // 伤害属性：DOT 从 applydebuff 的 extraAbilityGameID 获取，否则从自身 abilityId 获取
    let damageType: DamageType
    const dotInfo = firstDetail.snapshotTimestamp
      ? dotDebuffMap.get(`${firstDetail.abilityId}-${firstDetail.playerId}`)
      : undefined
    if (dotInfo) {
      const sourceAbilityMeta = abilityMap?.get(dotInfo.extraAbilityGameID)
      damageType = detectDamageTypeFromAbility(sourceAbilityMeta?.type ?? 0)
    } else {
      const abilityMeta = abilityMap?.get(firstDetail.abilityId)
      damageType = detectDamageTypeFromAbility(abilityMeta?.type ?? 0)
    }

    // 计算代表伤害值：按伤害属性选取受该属性影响最大的职业组的最高值
    const representativeDamage = selectRepresentativeDamage(details, damageType, TANK_JOBS)

    // DOT 快照时间（秒）
    const snapshotTime = firstDetail.snapshotTimestamp
      ? Math.round((firstDetail.snapshotTimestamp - fightStartTime) / 10) / 100
      : undefined

    damageEvents.push({
      id: `event-${firstDetail.timestamp}-${firstDetail.abilityId}`,
      name: detailSkillNames.get(firstDetail) ?? '',
      time: relativeTime,
      damage: representativeDamage,
      type: detectDamageType(details, TANK_JOBS),
      damageType,
      playerDamageDetails: details,
      packetId: detailPacketIds.get(firstDetail),
      snapshotTime,
    })
  }

  damageEvents.sort((a, b) => a.time - b.time)

  // 后处理：验证 tankbuster 分类
  refineTankbusterClassification(damageEvents)

  return damageEvents
}

/**
 * 按伤害属性选取代表伤害值
 * 物理伤害 → 法系+治疗受伤最高（物防低）
 * 魔法伤害 → 近战+远物受伤最高（魔防低）
 * 其他 → 非坦克最高值
 */
function selectRepresentativeDamage(
  details: PlayerDamageDetail[],
  damageType: DamageType,
  tankJobs: Job[]
): number {
  // 若目标组内最大 unmitigatedDamage 为 0（通常因为伤害被盾完全吸收，FFLogs 没有返回
  // unmitigatedAmount / multiplier），则 fallback 到更宽的候选集合，而不是直接返回 0。
  if (damageType === 'physical') {
    const targets = details.filter(d => {
      const role = getJobRole(d.job)
      return role === 'caster' || role === 'healer'
    })
    const max = Math.max(0, ...targets.map(d => d.unmitigatedDamage))
    if (max > 0) return max
  } else if (damageType === 'magical') {
    const targets = details.filter(d => {
      const role = getJobRole(d.job)
      return role === 'melee' || role === 'ranged'
    })
    const max = Math.max(0, ...targets.map(d => d.unmitigatedDamage))
    if (max > 0) return max
  }

  // fallback: 非坦克最高值；若非坦克也全为 0，再退回全体
  const nonTankDetails = details.filter(d => !tankJobs.includes(d.job))
  const nonTankMax = Math.max(0, ...nonTankDetails.map(d => d.unmitigatedDamage))
  if (nonTankMax > 0) return nonTankMax
  return Math.max(0, ...details.map(d => d.unmitigatedDamage))
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
    })
  }

  return castEventsResult
}

/**
 * 解析 boss 的关键技能 sync 锚点
 *
 * 扫描 events 流里的 boss cast/begincast，通过 SOUMA_SYNC_RULES
 * （见 src/data/soumaSyncRules.ts）匹配 window/syncOnce/battleOnce，
 * 消解 battleOnce 去重后产出 SyncEvent[]。
 *
 * 设计说明：
 * - battleOnce 是 "import 期 preprocessor flag"，不进 SyncEvent 存储层；与 Souma
 *   原生 FflogsImport.vue 的行为一致（它也从不把 battleOnce 写进 timeline 数据）
 * - syncOnce 是 "运行期匹配策略 flag"，每条 SyncEvent 独立存储（Souma 也这样）
 * - 规则匹配必须同时满足 actionId 与 type（begincast/cast 有别）
 * - time<0 的 pre-pull 读条保留，由调用方自行决定是否过滤
 */
export function parseSyncEvents(
  events: FFLogsEvent[],
  fightStartTime: number,
  playerMap: Map<number, { id: number; name: string; type: string }>,
  abilityMap?: Map<number, FFLogsAbility>
): SyncEvent[] {
  const battleOnceSeen = new Set<number>()
  const syncEvents: SyncEvent[] = []

  for (const event of events) {
    if (event.type !== 'cast' && event.type !== 'begincast') continue
    const actionId = event.abilityGameID
    if (!actionId) continue
    // 友方（包含召唤物/宠物）事件排除；非友方即 boss/NPC，命中规则表的才会保留
    if (event.sourceID != null && playerMap.has(event.sourceID)) continue

    // 规则匹配：同 actionId 且同 type 才算命中（与 submodule factory 行为一致）
    const rule = SOUMA_SYNC_RULES.get(actionId)
    if (!rule || rule.type !== event.type) continue

    const battleOnce = Boolean(rule.battleOnce)
    if (battleOnce) {
      if (battleOnceSeen.has(actionId)) continue
      battleOnceSeen.add(actionId)
    }

    const chineseName = getActionChinese(actionId)
    const abilityName = abilityMap?.get(actionId)?.name
    const actionName =
      chineseName ?? abilityName ?? `unknown_${actionId.toString(16).toUpperCase()}`

    syncEvents.push({
      time: (event.timestamp - fightStartTime) / 1000,
      type: event.type,
      actionId,
      actionName,
      window: rule.window,
      syncOnce: Boolean(rule.syncOnce),
    })
  }

  return syncEvents
}
