import type { DamageEvent, RawPhase, StoredDamageEvent } from '@/types/timeline'
import { generateObjectId } from '@/utils/shortId'

/** 模板事件：DamageEvent + abilityId（仅模板聚合/过滤内部使用，非持久化字段） */
export type EncounterTemplateEvent = DamageEvent & { abilityId?: number }

/** 副本模板数据结构（KV 存储） */
export interface EncounterTemplate {
  encounterId: number
  /** 完整 DamageEvent（带 id）+ abilityId。playerDamageDetails 始终为空 */
  events: EncounterTemplateEvent[]
  /** 模板战斗的时长（毫秒），用于覆盖策略比较 */
  templateSourceDurationMs: number
  /**
   * 模板来源战斗是否为击杀。
   * 旧 template 无此字段（optional），读取时按 false（wipe）处理。
   * kill 模板代表完整时间轴，前端据此显示"已更新完成"而非时长进度条。
   */
  kill?: boolean
  /**
   * 阶段（未翻译的 FFLogs 原文），与 events 同源同零点，随模板整体替换。
   * 字段缺席 = 存量模板（阶段功能上线前写入）；[] = 来源战斗确认无阶段。
   */
  phases?: RawPhase[]
  updatedAt: string
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
  /** 本场是否击杀；默认 false（wipe） */
  fightKill?: boolean
  /** 本场阶段（未翻译、与 fightEvents 同零点）；无阶段传 [] */
  fightPhases: RawPhase[]
}

/**
 * 覆盖优先级：kill 优先，其次比时长。
 * - 新 kill vs 旧 wipe → 覆盖（kill 即完整时间轴，无视时长）
 * - 新 wipe vs 旧 kill → 不覆盖（kill 模板不被进度 wipe 顶掉）
 * - 都 kill 且旧模板缺 phases 字段 → 覆盖（借下一次 kill 采样给存量模板补上阶段）
 * - 结果相同（都 kill / 都 wipe）→ 本场更长才覆盖（严格 >）
 */
function shouldReplaceTemplate(
  oldTemplate: EncounterTemplate,
  newDurationMs: number,
  newKill: boolean
): boolean {
  const oldKill = oldTemplate.kill ?? false
  if (newKill !== oldKill) return newKill
  // 不作用于 wipe（避免短 wipe 顶掉长 wipe）；phases: [] 不触发（避免单阶段副本每次被覆盖）
  if (newKill && oldTemplate.phases === undefined) return true
  return newDurationMs > oldTemplate.templateSourceDurationMs
}

/**
 * 单场版 encounter template 构建。
 *
 * 行为：
 * - 覆盖策略见 `shouldReplaceTemplate`（kill 优先，存量 kill 模板缺阶段时补齐，其次比时长）；
 *   旧 template 不存在时总是产出
 * - 阶段与事件同源，随模板整体替换
 * - 不做 abilityId 出现场数过滤；前端可用 `EncounterStatistics.abilityFightCount` 自行过滤
 * - 每个保留事件的 `damage` 用 `p50Map[abilityId]` 覆盖；无 p50 时保留原 damage
 * - 每个事件重新 generateObjectId
 *
 * 返回 null 表示"无需写入"（不是错误）。
 */
export function buildEncounterTemplate(input: BuildEncounterTemplateInput): {
  events: EncounterTemplateEvent[]
  templateSourceDurationMs: number
  kill: boolean
  phases: RawPhase[]
} | null {
  const {
    fightDurationMs,
    fightEvents,
    p50Map,
    oldTemplate,
    fightKill = false,
    fightPhases,
  } = input

  if (oldTemplate && !shouldReplaceTemplate(oldTemplate, fightDurationMs, fightKill)) {
    return null
  }

  const events: EncounterTemplateEvent[] = fightEvents.map(e => ({
    id: generateObjectId(),
    name: e.name,
    time: e.time,
    damage: p50Map[e.abilityId ?? 0] ?? e.damage,
    type: e.type,
    damageType: e.damageType,
    packetId: e.packetId,
    snapshotTime: e.snapshotTime,
    damageSource: e.damageSource,
    abilityId: e.abilityId,
  }))

  return { events, templateSourceDurationMs: fightDurationMs, kill: fightKill, phases: fightPhases }
}
