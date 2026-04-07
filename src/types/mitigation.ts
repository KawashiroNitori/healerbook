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
  /** 技能统计数据条目声明（有此字段 → 出现在数值设置模态框） */
  statDataEntries?: StatDataEntry[]
}
