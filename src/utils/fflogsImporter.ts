/**
 * FFLogs 数据解析工具（V2 API）
 */

import type {
  FFLogsReport,
  FFLogsAbility,
  FFLogsEvent,
  FFLogsReportActor,
  PlayerMap,
} from '@/types/fflogs'
import type { TimelineStatData } from '@/types/statData'
import type {
  Composition,
  DamageEvent,
  DamageEventType,
  CastEvent,
  PlayerDamageDetail,
  DamageType,
  SyncEvent,
} from '@/types/timeline'
import { SOUMA_SYNC_RULES } from '@/data/soumaSyncRules'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getStatusById, toStatusId, STATUS_ABILITY_OFFSET } from '@/utils/statusRegistry'
import actionChineseRaw from '@ff14-overlay/resources/generated/actionChinese.json'
import actionExtraRaw from '@/data/action.json'
import { JOB_MAP } from '@/data/jobMap'
import { getTankJobs, getJobRole, type Job } from '@/data/jobs'
import { calculatePercentile } from './stats'
import { normalizeActionId } from './normalizeActionId'
import { classifyPartialAOE } from './partialAoeClassifier'
import { TANK_BUSTER_ACTION_IDS, AUTO_ATTACK_ACTION_IDS } from '@/data/actionOverride'
import { getEncounterWithTier } from '@/data/raidEncounters'
import { extractBossCasts, attachCastWindows } from './castWindowImport'

// actionChinese.json 为上游全量映射；action.json 为本地补充的额外 actionId → 中文名
// （如 RSV 占位 id），后者覆盖前者以便就近修正翻译
const actionChinese: Record<string, string> = {
  ...actionChineseRaw,
  ...actionExtraRaw,
}

/**
 * 普通攻击名称匹配：boss 的 auto attack 在各语言 FFLogs 服务器下的统一命名
 * （含无中文/英文映射时的 unknown_<hex> fallback）
 */
const AUTO_ATTACK_PATTERN = /^(攻击|Attack|Attacke|Attaque|攻撃|공격|unknown_[0-9a-f]{4})$/i

function getActionChinese(actionId: number): string | undefined {
  return actionChinese[actionId.toString()]
}

/**
 * 从事件列表中找到第一个 calculateddamage 事件的时间戳，作为战斗零时间
 * 如果没有 calculateddamage，回退到第一个 damage 事件，最后回退到 fallback
 */
function findFirstDamageTimestamp(events: FFLogsEvent[], fallback: number): number {
  let firstDamage: number | undefined
  for (const event of events) {
    if (event.type === 'calculateddamage') return event.timestamp
    if (event.type === 'damage' && firstDamage === undefined) firstDamage = event.timestamp
  }
  return firstDamage ?? fallback
}

/**
 * 从事件列表中找到第一个 limitbreakupdate 事件的时间戳。
 * 极限技能槽在战斗真正开始（boss 可攻击）瞬间即产生首条更新，比"首次伤害落地"
 * 更贴近战斗起点，用作导入时间轴的零时间锚点。无此类事件时返回 undefined，
 * 内聚由 resolveFightStartTime 回退到 findFirstDamageTimestamp。
 */
function findLimitBreakTimestamp(events: FFLogsEvent[]): number | undefined {
  for (const event of events) {
    if (event.type === 'limitbreakupdate') return event.timestamp
  }
  return undefined
}

/**
 * 决定单场战斗的零时间：优先首个 limitbreakupdate（贴近战斗起点），
 * 无则回退首次伤害时间。limitbreakupdate 事件由 getEvents 在抓取阶段并入 events。
 */
function resolveFightStartTime(events: FFLogsEvent[], fallback: number): number {
  return findLimitBreakTimestamp(events) ?? findFirstDamageTimestamp(events, fallback)
}

/** 可选中状态切换点 */
export interface TargetabilityToggle {
  /** 报告相对毫秒（与伤害事件 timestamp 同域） */
  timestamp: number
  /** 该时刻起是否可选中 */
  targetable: boolean
}

/**
 * 可选中区间索引：按 actor 自身切换点 + 按名归并两套视图。
 *
 * 背景：FFLogs 会把同一个 boss 拆成多个同名 actor（真实实体 + gameID 2000000+ 系列的合成
 * "影子"）。boss 不可选中阶段的团伤常被记在没有自身 targetabilityupdate 的合成 actor 上，
 * 只按 actor id 查就查不到真实实体的不可选中区间 → 目标减误判有效。
 */
export interface TargetabilityIntervals {
  /** actorId → 自身切换点（仅含真正出现过 targetabilityupdate 的 actor），升序 */
  byActor: Map<number, TargetabilityToggle[]>
  /** name → 同名所有 actor 的切换点合并，升序（供无自身事件的合成 actor 回退） */
  byName: Map<string, TargetabilityToggle[]>
  /** actorId → name（全量 enemy，用于无自身事件时回退到 byName） */
  idToName: Map<number, string>
}

/**
 * 由 targetabilityupdate 事件重建敌方可选中区间。
 * 按 targetID 分组（sourceID===targetID，忽略 instance），按 timestamp 升序填 byActor。
 * 首切换点之前由 isTargetableAt 约定为"默认可选中"。无此类事件的 actor 不入 byActor。
 *
 * 传入 enemyNames（id→name）时额外构建按名归并视图：仅供**自身无任何 targetabilityupdate**
 * 的合成 actor 借用同名兄弟的区间（见 isTargetableAt）；自身有事件的 actor 始终信自己的。
 */
export function buildTargetabilityIntervals(
  events: FFLogsEvent[],
  enemyNames?: Map<number, string>
): TargetabilityIntervals {
  const byActor = new Map<number, TargetabilityToggle[]>()
  for (const e of events) {
    if (e.type !== 'targetabilityupdate' || e.targetID === undefined) continue
    const list = byActor.get(e.targetID) ?? []
    list.push({ timestamp: e.timestamp, targetable: e.targetable === 1 })
    byActor.set(e.targetID, list)
  }
  for (const list of byActor.values()) list.sort((a, b) => a.timestamp - b.timestamp)

  const idToName = enemyNames ? new Map(enemyNames) : new Map<number, string>()
  const byName = new Map<string, TargetabilityToggle[]>()
  // byName 仅从 byActor（有事件的 actor）合并：无事件的合成 actor 不贡献切换点，
  // 但能通过 idToName → byName 借到同名兄弟的区间。
  for (const [id, list] of byActor) {
    const name = idToName.get(id)
    if (name === undefined) continue
    const merged = byName.get(name) ?? []
    merged.push(...list)
    byName.set(name, merged)
  }
  for (const list of byName.values()) list.sort((a, b) => a.timestamp - b.timestamp)

  return { byActor, byName, idToName }
}

/**
 * 查询 actor 在某时刻（报告相对毫秒）是否可选中。
 * - 自身出现过 targetabilityupdate → 取自身区间最后一个 timestamp <= ts 的状态（信自己，
 *   不被同名兄弟污染）。
 * - 自身无任何切换点 → 回退到同名归并区间（合成 actor 借真实实体的不可选中区间）。
 * - 仍无可用区间（未跟踪 / 早于首切换点 / 无名字映射）→ 默认可选中。
 */
export function isTargetableAt(
  intervals: TargetabilityIntervals,
  actorId: number,
  timestamp: number
): boolean {
  let list = intervals.byActor.get(actorId)
  if (!list || list.length === 0) {
    const name = intervals.idToName.get(actorId)
    list = name !== undefined ? intervals.byName.get(name) : undefined
  }
  if (!list || list.length === 0) return true
  let state = true
  for (const toggle of list) {
    if (toggle.timestamp <= timestamp) state = toggle.targetable
    else break
  }
  return state
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
 * 构建 boss 实体 id 集合（用于目标减自动判定）。逐级 fallback：
 * type==='Boss' → 名称等于战斗名 → 仅一个敌人 → 按名扩展同名实体（分身/转场）。
 * 检测失败返回空集，调用方据此降级为不判定。
 */
export function buildBossIds(
  enemies: FFLogsReportActor[] | undefined,
  fightName: string
): Set<number> {
  const ids = new Set<number>()
  if (!enemies?.length) return ids
  for (const e of enemies) if (e.type === 'Boss') ids.add(e.id)
  if (ids.size === 0) for (const e of enemies) if (e.name === fightName) ids.add(e.id)
  if (ids.size === 0 && enemies.length === 1) ids.add(enemies[0].id)
  const bossNames = new Set([...ids].map(id => enemies.find(e => e.id === id)?.name))
  for (const e of enemies) if (bossNames.has(e.name)) ids.add(e.id)
  return ids
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
  playerMap: PlayerMap,
  abilityMap?: Map<number, FFLogsAbility>,
  composition?: Composition,
  bossIds?: Set<number>,
  /** sourceID → actor 名映射，编排层用 report.enemies 建好传入；仅用于填 damageSource */
  sourceNames?: Map<number, string>,
  /** 可选中区间索引；来源在伤害时刻不可选中时，目标减判无效 */
  targetability?: TargetabilityIntervals,
  bossCasts?: FFLogsEvent[]
): DamageEvent[] {
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
  const detailPacketIds = new Map<PlayerDamageDetail, number | undefined>()
  const detailSnapshotTimestamps = new Map<PlayerDamageDetail, number>()
  // 普攻标记：命名匹配任一语言 regex（abilityMap 原始名或中文回退名）即置 true
  const detailIsAutoAttack = new Map<PlayerDamageDetail, boolean>()

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
    // abilityGameID=500000 是 FFLogs 的合成事件（如全局攻击聚合），导入时丢弃
    if (event.abilityGameID === 500000) continue
    // 完全被盾吸收的伤害事件（amount=0）FFLogs 不下发 packetID，
    // 因此不能把 packetID 当必要条件。降级用 timestamp 做 key 兜底。
    if (!event.targetID) continue
    if (!playerMap.has(event.targetID)) continue
    // 来自队友的伤害（如反伤、友军误伤）不参与 boss 减伤规划，直接丢弃
    if (event.sourceID != null && playerMap.has(event.sourceID)) continue

    const abilityId = event.abilityGameID ?? 0
    const key = `${event.packetID ?? event.timestamp}-${event.targetID}-${abilityId}`
    let detail = detailByPacketAndTarget.get(key)

    // detail 不存在时创建（calculateddamage 先到则时间戳更准确，否则用 damage 的）
    if (!detail) {
      const abilityMeta = abilityMap?.get(abilityId)
      const abilityName = abilityMeta?.name ?? '未知技能'

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
      }

      playerDamageDetails.push(detail)
      detailByPacketAndTarget.set(key, detail)
      detailSkillNames.set(detail, skillName)
      detailSourceIds.set(detail, event.sourceID || 0)
      detailPacketIds.set(detail, event.packetID)
      // 两个名字都查一遍，因为 actionChinese 的翻译不一定能命中 regex
      if (AUTO_ATTACK_PATTERN.test(abilityName) || AUTO_ATTACK_PATTERN.test(skillName)) {
        detailIsAutoAttack.set(detail, true)
      }
      if (dotInfo?.timestamp !== undefined) {
        detailSnapshotTimestamps.set(detail, dotInfo.timestamp)
      }
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
        const statusId = toStatusId(buffId)
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
    const key = `${ts}-${detail.playerId}-${sourceId}-${detail.abilityId ?? 0}`
    detailByDamageTs.set(key, detail)
  }

  for (const event of events) {
    if (event.type !== 'absorbed') continue
    if (!event.amount) continue
    if (!event.targetID) continue

    // FFLogs 的 absorbed 事件会把泛输血（1002613）记录为泛血印（1002643）
    let statusId = event.abilityGameID
    if (statusId === 1002643) statusId = 1002613

    const actualStatusId = statusId ? toStatusId(statusId) : 0

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
    const firstSnapshotTimestamp = detailSnapshotTimestamps.get(firstDetail)
    const firstAbilityId = firstDetail.abilityId ?? 0
    const dotInfo =
      firstSnapshotTimestamp !== undefined
        ? dotDebuffMap.get(`${firstAbilityId}-${firstDetail.playerId}`)
        : undefined
    if (dotInfo) {
      const sourceAbilityMeta = abilityMap?.get(dotInfo.extraAbilityGameID)
      damageType = detectDamageTypeFromAbility(sourceAbilityMeta?.type ?? 0)
    } else {
      const abilityMeta = abilityMap?.get(firstAbilityId)
      damageType = detectDamageTypeFromAbility(abilityMeta?.type ?? 0)
    }

    // 计算代表伤害值：按伤害属性选取受该属性影响最大的职业组的最高值
    const representativeDamage = selectRepresentativeDamage(details, damageType, TANK_JOBS)

    // DOT 快照时间（秒）
    const snapshotTime =
      firstSnapshotTimestamp !== undefined
        ? Math.round((firstSnapshotTimestamp - fightStartTime) / 10) / 100
        : undefined

    const name = detailSkillNames.get(firstDetail) ?? ''
    const isAutoAttack = detailIsAutoAttack.get(firstDetail) ?? false

    const sourceId = detailSourceIds.get(firstDetail) ?? 0
    const sourceIsNonBoss =
      !!bossIds && bossIds.size > 0 && sourceId !== 0 && !bossIds.has(sourceId)
    // 来源已知且在该伤害时刻不可选中（用 raw timestamp，与 targetabilityupdate 同为报告相对毫秒域）
    const sourceUntargetable =
      !!targetability &&
      sourceId !== 0 &&
      !isTargetableAt(targetability, sourceId, firstDetail.timestamp)
    const targetMitigationDisabled = sourceIsNonBoss || sourceUntargetable ? true : undefined
    const damageSource = sourceId !== 0 ? sourceNames?.get(sourceId) : undefined

    damageEvents.push({
      id: `event-${firstDetail.timestamp}-${firstAbilityId}`,
      name,
      time: relativeTime,
      damage: representativeDamage,
      type: detectDamageType(details, TANK_JOBS, isAutoAttack),
      damageType,
      playerDamageDetails: details,
      packetId: detailPacketIds.get(firstDetail),
      snapshotTime,
      ...(targetMitigationDisabled && { targetMitigationDisabled }),
      ...(damageSource && { damageSource }),
    })
  }

  damageEvents.sort((a, b) => a.time - b.time)

  // 后处理：验证 tankbuster 分类
  refineTankbusterClassification(damageEvents)
  // 后处理：用"出现次数 × 全 T 比例"启发式补捞 regex 漏掉的普通攻击
  refineAutoAttackClassification(damageEvents, TANK_JOBS)
  // 后处理：把 type==='aoe' 的事件按非 T 命中集合细分为
  //   'aoe' / 'partial_aoe' / 'partial_final_aoe'
  // composition 缺失（既有 dev 调用方）时 no-op，保持向后兼容
  classifyPartialAOE(damageEvents, composition)
  // 流水线最后：按 actionOverride 表强制改写 type，权威覆盖上面所有启发式判别
  applyActionTypeOverride(damageEvents)
  // type 最终稳定后：把"部分 AOE（结算）"事件时间后移，使其稳定排在同刻全员 AOE 之后
  shiftPartialFinalAoeTime(damageEvents)
  if (bossCasts) {
    // 名称解析器与伤害事件命名同源（getActionChinese → abilityMap），
    // 供 castWindow 在「读条 id ≠ 伤害 id 但同名」时做名称兜底匹配
    const resolveActionName = (id: number): string | undefined =>
      getActionChinese(id) ?? abilityMap?.get(id)?.name
    attachCastWindows(damageEvents, bossCasts, fightStartTime, resolveActionName)
  }

  return damageEvents
}

/** "部分 AOE（结算）"事件相对同刻事件的时间后移量（秒） */
const PARTIAL_FINAL_AOE_TIME_SHIFT = 0.1

/**
 * 把 type === 'partial_final_aoe' 的事件时间后移 PARTIAL_FINAL_AOE_TIME_SHIFT 秒。
 *
 * 部分 AOE 段的结算波次常与同刻的全员 AOE 同时出现。若两者落在同一时间点，
 * 结算时先算全员 AOE（会清掉部分 AOE 段累计）再算部分 AOE 结算，就会按已被清掉的
 * 段重复累计，算出预期外的多余伤害。后移让结算事件稳定排在全员 AOE 之后，规避该顺序问题。
 *
 * 必须在 type 最终稳定（applyActionTypeOverride）之后调用：被 override 改写成
 * tankbuster / auto 的事件不应被后移。改时间后重新排序以维持 damageEvents 的升序不变量。
 */
function shiftPartialFinalAoeTime(damageEvents: DamageEvent[]): void {
  let shifted = false
  for (const event of damageEvents) {
    if (event.type === 'partial_final_aoe') {
      // 保留两位小数精度（与 relativeTime 一致），避免 0.1 浮点尾差
      event.time = Math.round((event.time + PARTIAL_FINAL_AOE_TIME_SHIFT) * 100) / 100
      shifted = true
    }
  }
  if (shifted) damageEvents.sort((a, b) => a.time - b.time)
}

/**
 * 硬覆盖：abilityId 命中 actionOverride 表的事件强制改写 type，绕过 detectDamageType /
 * refine / classifyPartialAOE 的全部启发式。放在流水线最后，确保不会被它们推翻。
 */
function applyActionTypeOverride(damageEvents: DamageEvent[]): void {
  for (const event of damageEvents) {
    const abilityId = event.playerDamageDetails?.[0]?.abilityId
    if (abilityId === undefined) continue
    if (TANK_BUSTER_ACTION_IDS.has(abilityId)) {
      event.type = 'tankbuster'
    } else if (AUTO_ATTACK_ACTION_IDS.has(abilityId)) {
      event.type = 'auto'
    }
  }
}

/**
 * 按伤害属性选取代表伤害值
 * 物理伤害 → 法系+治疗受伤最高（物防低）
 * 魔法伤害 → 近战+远物受伤最高（魔防低）
 * 其他 → 非坦克最高值
 *
 * 先按玩家把「窗口内同名多次命中」的 unmitigatedDamage 求和，再在各玩家的合计里选代表值。
 * 这样 AoE（每名玩家各挨一下）取单人受伤最高不变；同一玩家在窗口内被同名技能连打多下时，
 * 其受伤按累计计入（而非只取最大的一下）。
 */
function selectRepresentativeDamage(
  details: PlayerDamageDetail[],
  damageType: DamageType,
  tankJobs: Job[]
): number {
  // 按玩家聚合：同一玩家的多次命中求和，保留其职业用于后续按角色筛选
  const perPlayer = new Map<number, { job: Job; total: number }>()
  for (const d of details) {
    const cur = perPlayer.get(d.playerId)
    if (cur) cur.total += d.unmitigatedDamage
    else perPlayer.set(d.playerId, { job: d.job, total: d.unmitigatedDamage })
  }
  const sums = [...perPlayer.values()]

  // 若目标组内最大合计为 0（通常因为伤害被盾完全吸收，FFLogs 没有返回
  // unmitigatedAmount / multiplier），则 fallback 到更宽的候选集合，而不是直接返回 0。
  if (damageType === 'physical') {
    const targets = sums.filter(s => {
      const role = getJobRole(s.job)
      return role === 'caster' || role === 'healer'
    })
    const max = Math.max(0, ...targets.map(s => s.total))
    if (max > 0) return max
  } else if (damageType === 'magical') {
    const targets = sums.filter(s => {
      const role = getJobRole(s.job)
      return role === 'melee' || role === 'ranged'
    })
    const max = Math.max(0, ...targets.map(s => s.total))
    if (max > 0) return max
  }

  // fallback: 非坦克最高合计；若非坦克也全为 0，再退回全体
  const nonTankSums = sums.filter(s => !tankJobs.includes(s.job))
  const nonTankMax = Math.max(0, ...nonTankSums.map(s => s.total))
  if (nonTankMax > 0) return nonTankMax
  return Math.max(0, ...sums.map(s => s.total))
}

function detectDamageType(
  details: PlayerDamageDetail[],
  tankJobs: Job[],
  isAutoAttack: boolean
): DamageEventType {
  // 命名匹配普攻正则的直接判定为 auto（走 boss 自动攻击的统一命名）
  if (isAutoAttack) return 'auto'
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
 * 后处理：识别漏网的普通攻击
 *
 * 部分 boss 的 auto attack 在 FFLogs 侧并未使用 "攻击/Attack/unknown_<hex>"
 * 等规范命名（regex 无法命中），但其行为特征仍可用"出现频次 + 目标偏向"
 * 兜底：
 *   1. 同名事件组的出现次数 > 10
 *   2. 该组中 80%+ 的事件仅命中坦克职业
 *   3. 事件不能是 DOT（DOT 的 tick 频次天然高，不能被误判为普攻）
 */
const AUTO_ATTACK_MIN_OCCURRENCE = 10

function refineAutoAttackClassification(damageEvents: DamageEvent[], tankJobs: Job[]): void {
  const groupsByName = new Map<string, DamageEvent[]>()
  for (const event of damageEvents) {
    if (event.type === 'auto') continue
    if (event.snapshotTime !== undefined) continue // DOT 不进入启发式
    const bucket = groupsByName.get(event.name)
    if (bucket) bucket.push(event)
    else groupsByName.set(event.name, [event])
  }

  for (const group of groupsByName.values()) {
    if (group.length <= AUTO_ATTACK_MIN_OCCURRENCE) continue

    const tankOnlyCount = group.filter(event => {
      const details = event.playerDamageDetails ?? []
      return details.length > 0 && details.every(d => tankJobs.includes(d.job))
    }).length

    if (tankOnlyCount / group.length >= 0.8) {
      for (const event of group) event.type = 'auto'
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
  playerMap: PlayerMap
): CastEvent[] {
  const castEventsResult: CastEvent[] = []
  const validActionIds = new Set(MITIGATION_DATA.actions.map(a => a.id))

  for (const event of events) {
    if (event.type !== 'cast') continue

    const abilityGameID = event.abilityGameID
    if (!abilityGameID) continue

    if (!validActionIds.has(abilityGameID)) continue

    if (!event.sourceID) continue
    const player = playerMap.get(event.sourceID)
    if (!player) continue

    const job = JOB_MAP[player.type]
    if (!job) continue

    castEventsResult.push({
      id: `cast-${castEventsResult.length}`,
      // 导入即归一:子变体 id 归一为 trackGroup 父 id(变体运行时推导)
      actionId: normalizeActionId(abilityGameID),
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
  playerMap: PlayerMap,
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

/**
 * 从事件列表提取盾值原始样本（按 statusId = abilityGameID - 1000000 聚样）。
 *
 * 非变异：FFLogs 把泛输血（1002613）记成泛血印（1002643），此处用局部变量修正，
 * 不写回 event —— events 数组被多个解析器共享。
 */
export function extractShieldData(events: FFLogsEvent[]): Record<number, number[]> {
  const shieldByAbility: Record<number, number[]> = {}
  for (const event of events) {
    if (event.type === 'absorbed' && event.abilityGameID && event.amount) {
      const rawId = event.abilityGameID === 1002643 ? 1002613 : event.abilityGameID
      const statusId = rawId - STATUS_ABILITY_OFFSET
      if (!shieldByAbility[statusId]) shieldByAbility[statusId] = []
      shieldByAbility[statusId].push(event.amount)
    }
  }
  return shieldByAbility
}

/**
 * 从事件列表提取治疗原始样本（按 heal 事件原始 abilityGameID 聚样，排除 overheal）。
 */
export function extractHealData(events: FFLogsEvent[]): Record<number, number[]> {
  const healByAbility: Record<number, number[]> = {}
  for (const event of events) {
    if (event.type === 'heal' && !event.overheal && event.abilityGameID && event.amount) {
      if (!healByAbility[event.abilityGameID]) healByAbility[event.abilityGameID] = []
      healByAbility[event.abilityGameID].push(event.amount)
    }
  }
  return healByAbility
}

/**
 * 从 heal 事件的 targetResources.maxHitPoints 按职业聚样最大 HP。
 */
export function extractMaxHPData(
  events: FFLogsEvent[],
  playerMap: PlayerMap
): Record<Job, number[]> {
  const maxHPByJob: Partial<Record<Job, number[]>> = {}
  for (const event of events) {
    if (event.type !== 'heal') continue
    const targetResources = (event as FFLogsEvent & { targetResources?: { maxHitPoints?: number } })
      .targetResources
    const maxHP = targetResources?.maxHitPoints
    const targetID = event.targetID
    if (!maxHP || maxHP <= 0 || !targetID) continue
    const player = playerMap.get(targetID)
    if (!player?.type) continue
    const job = JOB_MAP[player.type.replace(/\s/g, '')]
    if (!job) continue
    if (!maxHPByJob[job]) maxHPByJob[job] = []
    maxHPByJob[job]!.push(maxHP)
  }
  return maxHPByJob as Record<Job, number[]>
}

/**
 * 从单场战斗事件提取 statData（供未收录副本导入时填充）。
 *
 * 仅保留当前阵容 statDataEntries 声明的 key；普通值取 p50、暴击值取 p90，
 * 与 top100Sync 的 statistics 口径一致。四类数值与 HP 全空时返回 undefined。
 */
export function parseStatData(
  events: FFLogsEvent[],
  playerMap: PlayerMap,
  composition: Composition
): TimelineStatData | undefined {
  // 1. 阵容内 action 的 statDataEntries → 按 type 分桶的合法 key 集合
  const jobs = new Set(composition.players.map(p => p.job))
  const entries = MITIGATION_DATA.actions
    .filter(a => a.statDataEntries && a.jobs.some(j => jobs.has(j)))
    .flatMap(a => a.statDataEntries!)
  const shieldKeys = new Set(entries.filter(e => e.type === 'shield').map(e => e.key))
  const critShieldKeys = new Set(entries.filter(e => e.type === 'critShield').map(e => e.key))
  const healKeys = new Set(entries.filter(e => e.type === 'heal').map(e => e.key))
  const critHealKeys = new Set(entries.filter(e => e.type === 'critHeal').map(e => e.key))

  // 2. 原始样本
  const rawShield = extractShieldData(events)
  const rawHeal = extractHealData(events)
  const rawMaxHP = extractMaxHPData(events, playerMap)

  // 3. 逐 key p50/p90，仅保留合法 key
  const shieldByAbility: Record<number, number> = {}
  const critShieldByAbility: Record<number, number> = {}
  const healByAbility: Record<number, number> = {}
  const critHealByAbility: Record<number, number> = {}

  for (const [k, samples] of Object.entries(rawShield)) {
    if (!samples.length) continue
    const key = Number(k)
    if (shieldKeys.has(key)) shieldByAbility[key] = calculatePercentile(samples, 50)
    if (critShieldKeys.has(key)) critShieldByAbility[key] = calculatePercentile(samples, 90)
  }
  for (const [k, samples] of Object.entries(rawHeal)) {
    if (!samples.length) continue
    const key = Number(k)
    if (healKeys.has(key)) healByAbility[key] = calculatePercentile(samples, 50)
    if (critHealKeys.has(key)) critHealByAbility[key] = calculatePercentile(samples, 90)
  }

  // 4. 血量：每职业 p50 → 非坦/坦克分别取 min
  const tankJobs = new Set<string>(getTankJobs())
  const nonTankHPs: number[] = []
  const tankHPs: number[] = []
  for (const [job, samples] of Object.entries(rawMaxHP)) {
    if (!samples.length) continue
    const hp = calculatePercentile(samples, 50)
    if (hp <= 0) continue
    if (tankJobs.has(job)) tankHPs.push(hp)
    else nonTankHPs.push(hp)
  }
  const referenceMaxHP = nonTankHPs.length ? Math.min(...nonTankHPs) : undefined
  const tankReferenceMaxHP = tankHPs.length ? Math.min(...tankHPs) : undefined

  // 5. 全空 → undefined（调用方不赋值，sd 不落盘，行为同现状）
  const hasAny =
    Object.keys(shieldByAbility).length > 0 ||
    Object.keys(critShieldByAbility).length > 0 ||
    Object.keys(healByAbility).length > 0 ||
    Object.keys(critHealByAbility).length > 0 ||
    referenceMaxHP !== undefined ||
    tankReferenceMaxHP !== undefined
  if (!hasAny) return undefined

  return {
    ...(referenceMaxHP !== undefined ? { referenceMaxHP } : {}),
    ...(tankReferenceMaxHP !== undefined ? { tankReferenceMaxHP } : {}),
    shieldByAbility,
    critShieldByAbility,
    healByAbility,
    critHealByAbility,
  }
}

/**
 * 单场 fight 导入解析的产物。两条导入路径（服务端 /import 与前端 dev-only
 * client_import）共用，差异仅剩 timeline 落地方式与服务端独有的 statData 提取。
 */
export interface FightImportResult {
  composition: Composition
  /** 战斗零时间（首个 limitbreakupdate，无则回退首次伤害时间戳，毫秒） */
  fightStartTime: number
  /** playerId → 基本信息，供调用方进一步提取 statData */
  playerMap: PlayerMap
  damageEvents: DamageEvent[]
  castEvents: CastEvent[]
  syncEvents: SyncEvent[]
}

/**
 * 从单场 fight 的 report + events 跑完整解析编排，产出 timeline 所需的核心数据。
 *
 * 把 playerMap / abilityMap / participantIds / boss 判定 / damage·cast·sync 解析
 * 收口为单一函数，避免服务端与前端两条导入路径各抄一份导致行为漂移。
 */
export function parseFightImport(
  report: FFLogsReport,
  fight: FFLogsReport['fights'][number],
  events: FFLogsEvent[]
): FightImportResult {
  const playerMap: PlayerMap = new Map()
  report.friendlies?.forEach(player => {
    playerMap.set(player.id, { id: player.id, name: player.name, type: player.type })
  })

  const abilityMap = new Map<number, FFLogsAbility>()
  report.abilities?.forEach(ability => {
    abilityMap.set(ability.gameID, ability)
  })

  const participantIds = new Set<number>()
  for (const event of events) {
    if (event.sourceID && playerMap.has(event.sourceID)) participantIds.add(event.sourceID)
    if (event.targetID && playerMap.has(event.targetID)) participantIds.add(event.targetID)
  }

  const composition = parseComposition(report, fight.id, participantIds)
  const fightStartTime = resolveFightStartTime(events, fight.startTime)
  const bossIds = buildBossIds(report.enemies, fight.name)
  const enemyNames = new Map<number, string>()
  report.enemies?.forEach(e => enemyNames.set(e.id, e.name))
  const targetability = buildTargetabilityIntervals(events, enemyNames)
  const bossCasts = extractBossCasts(events, playerMap)
  const damageEvents = parseDamageEvents(
    events,
    fightStartTime,
    playerMap,
    abilityMap,
    composition,
    bossIds,
    enemyNames,
    targetability,
    bossCasts
  )
  const castEvents = parseCastEvents(events, fightStartTime, playerMap)
  const syncEvents = parseSyncEvents(events, fightStartTime, playerMap, abilityMap)

  return { composition, fightStartTime, playerMap, damageEvents, castEvents, syncEvents }
}

/**
 * 由 fight 推导时间轴名称：优先查 raidEncounters 的 tier/encounter 组合名，
 * 未收录则回退战斗名 / `战斗 N`。两条导入路径共用。
 */
export function resolveImportTimelineName(fight: FFLogsReport['fights'][number]): string {
  let name = fight.name || `战斗 ${fight.id}`
  if (fight.encounterID) {
    const result = getEncounterWithTier(fight.encounterID)
    if (result) {
      // 单副本 tier（如绝境战）的 tier.name === encounter.name，避免拼成 "X - X"
      name =
        result.tier.name === result.encounter.name
          ? result.tier.name
          : `${result.tier.name} - ${result.encounter.name}`
    }
  }
  return name
}
