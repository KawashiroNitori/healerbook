import type { DamageEvent } from '@/types/timeline'
import { generateObjectId } from '@/utils/shortId'
import type { StoredDamageEvent } from './top100Sync'

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
}

/**
 * 覆盖优先级：kill 优先，其次比时长。
 * - 新 kill vs 旧 wipe → 覆盖（kill 即完整时间轴，无视时长）
 * - 新 wipe vs 旧 kill → 不覆盖（kill 模板不被进度 wipe 顶掉）
 * - 结果相同（都 kill / 都 wipe）→ 本场更长才覆盖（严格 >）
 */
function shouldReplaceTemplate(
  oldTemplate: EncounterTemplate,
  newDurationMs: number,
  newKill: boolean
): boolean {
  const oldKill = oldTemplate.kill ?? false
  if (newKill !== oldKill) return newKill
  return newDurationMs > oldTemplate.templateSourceDurationMs
}

/**
 * 单场版 encounter template 构建。
 *
 * 行为：
 * - 覆盖策略见 `shouldReplaceTemplate`（kill 优先，其次比时长）；旧 template 不存在时总是产出
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
} | null {
  const { fightDurationMs, fightEvents, p50Map, oldTemplate, fightKill = false } = input

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

  return { events, templateSourceDurationMs: fightDurationMs, kill: fightKill }
}
