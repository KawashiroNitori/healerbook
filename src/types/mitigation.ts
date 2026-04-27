/**
 * 减伤技能类型定义
 */

import type { Job } from '@/data/jobs'
import type { PartyState } from './partyState'
import type { TimelineStatData, StatDataEntry } from './statData'

export type { Job }

/**
 * 减伤类型
 * - target_percentage: 目标百分比减伤（降低 boss 造成的伤害）
 * - non_target_percentage: 非目标百分比减伤（降低玩家受到的伤害）
 * - barrier: 盾值减伤（临时生命值）
 */
export type MitigationType = 'target_percentage' | 'non_target_percentage' | 'barrier'

/**
 * 减伤类别（UI 过滤用）
 * - shield: 盾值类
 * - percentage: 百分比减伤类（含目标/非目标减伤）
 * - partywide: 群体生效
 * - self: 可对自身生效
 * - target: 可对目标生效
 */
export type MitigationCategory = 'shield' | 'percentage' | 'heal' | 'partywide' | 'self' | 'target'

/**
 * 副本统计数据
 */
export interface EncounterStatistics {
  encounterId: number
  encounterName: string
  /** 每个伤害技能的中位伤害值 */
  damageByAbility: Record<number, number>
  /** 每个职业的平均最大生命值 */
  maxHPByJob: Record<Job, number>
  /** 每个盾值技能的中位盾值（按 actionId 索引） */
  shieldByAbility: Record<number, number>
  /** 每个盾值技能的暴击盾值（p90） */
  critShieldByAbility: Record<number, number>
  /** 每个治疗技能的中位治疗量 */
  healByAbility: Record<number, number>
  /** 每个治疗技能的暴击治疗量（p90） */
  critHealByAbility: Record<number, number>
  /** 采样战斗数量 */
  sampleSize: number
  /** ISO 8601 时间戳 */
  updatedAt: string
}

/**
 * 技能执行器上下文
 */
export interface ActionExecutionContext {
  /** 技能 ID */
  actionId: number
  /** 使用时间（秒） */
  useTime: number
  /** 当前小队状态 */
  partyState: PartyState
  /** 使用技能的玩家 ID（对应 FFLogsActor.id） */
  sourcePlayerId: number
  /** 时间轴统计数据（可选，用于盾值计算） */
  statistics?: TimelineStatData
  /** 触发本次 executor 的 castEvent.id（治疗 executor 用于 healSnapshot.castEventId） */
  castEventId?: string
  /** simulator 注入的治疗 snapshot 收集器（一次性治疗在 cast 时记录） */
  recordHeal?: (snap: import('./healSnapshot').HealSnapshot) => void
}

/**
 * 技能执行器函数
 * 接收执行上下文，返回新的小队状态
 */
export type ActionExecutor = (context: ActionExecutionContext) => PartyState

/**
 * 减伤技能
 */
export interface MitigationAction {
  /** 技能 ID */
  id: number
  /** 技能名称（中文） */
  name: string
  /** 技能描述 */
  description?: string
  /** 技能图标 URL */
  icon: string
  /** 技能高清图标 URL */
  iconHD?: string
  /** 可使用的职业列表 */
  jobs: Job[]
  /** 持续时间（秒） */
  duration: number
  /** 冷却时间（秒） */
  cooldown: number
  /** 技能执行器（可选，无执行器的技能不产生状态效果） */
  executor?: ActionExecutor
  /** 隐藏技能（不在技能轨道中显示，仅供内部数据引用） */
  hidden?: boolean
  /** 减伤类别（必填、非空）；hidden 技能也需标注 */
  category: MitigationCategory[]
  /** 技能统计数据条目声明（有此字段 → 出现在数值设置模态框） */
  statDataEntries?: StatDataEntry[]
  /**
   * 渲染轨道归属。默认 = id（独立成轨）。
   * 设置后，本 action 的 castEvent 渲染到 trackGroup 指向的 action 轨道上。
   * 约束：trackGroup 指向的 action 本身 `trackGroup` 必须是 undefined（禁止链式挂载）。
   */
  trackGroup?: number
  /**
   * 额外放置约束。未声明时仅受基础 CD 冲突检测。
   * 共用轨道（同 trackGroup）的所有成员必须都声明 placement，
   * 且成员间的 validIntervals 必须两两互斥、并集覆盖全时间轴。
   */
  placement?: import('@/utils/placement/types').Placement
  /**
   * 一次 cast 对资源池的影响。compute 层的合成规则：
   *   - 本字段未声明，或声明了但不含 delta<0（纯产出）→ 合成单充能池 __cd__:${id} 强制 cooldown
   *   - 含 delta<0（有显式消费者）→ 跳过合成，cooldown 字段沦为信息性
   */
  resourceEffects?: import('./resource').ResourceEffect[]
}

/**
 * 技能的有效轨道归属。未声明 trackGroup 时自成一组，返回自身 id。
 */
export function effectiveTrackGroup(action: MitigationAction): number {
  return action.trackGroup ?? action.id
}

/**
 * 两个 action 是否属于同一渲染轨道。
 */
export function sameTrack(a: MitigationAction, b: MitigationAction): boolean {
  return effectiveTrackGroup(a) === effectiveTrackGroup(b)
}
