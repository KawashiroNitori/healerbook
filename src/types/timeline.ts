/**
 * 时间轴类型定义
 */

import type { Job, MitigationSkill } from './mitigation'

/**
 * 时间轴
 */
export interface Timeline {
  /** 时间轴 ID */
  id: string
  /** 时间轴名称 */
  name: string
  /** 副本信息 */
  encounter: Encounter
  /** 队伍阵容 */
  composition: Composition
  /** 阶段列表 */
  phases: Phase[]
  /** 减伤规划 */
  mitigationPlan: MitigationPlan
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}

/**
 * 副本
 */
export interface Encounter {
  /** 副本 ID */
  id: number
  /** 副本名称 */
  name: string
  /** 副本显示名称 */
  displayName: string
  /** 区域名称 */
  zone: string
  /** 难度 */
  difficulty: 'savage' | 'ultimate' | 'extreme'
  /** 伤害事件列表 */
  damageEvents: DamageEvent[]
}

/**
 * 伤害事件
 */
export interface DamageEvent {
  /** 事件 ID */
  id: string
  /** 技能名称 */
  name: string
  /** 相对于阶段开始的时间（秒） */
  time: number
  /** 原始伤害 */
  damage: number
  /** 伤害类型 */
  type: 'aoe' | 'tankbuster' | 'raidwide'
  /** 所属阶段 ID */
  phaseId: string
}

/**
 * 阶段
 */
export interface Phase {
  /** 阶段 ID */
  id: string
  /** 阶段名称 */
  name: string
  /** 开始时间（绝对时间或相对时间，秒） */
  startTime: number
  /** 标志性技能作为时间基准（可选） */
  baselineSkill?: string
}

/**
 * 队伍阵容
 */
export interface Composition {
  /** 坦克职业列表 */
  tanks: Job[]
  /** 治疗职业列表 */
  healers: Job[]
  /** DPS 职业列表 */
  dps: Job[]
}

/**
 * 减伤规划
 */
export interface MitigationPlan {
  /** 减伤分配列表 */
  assignments: MitigationAssignment[]
}

/**
 * 减伤分配
 */
export interface MitigationAssignment {
  /** 分配 ID */
  id: string
  /** 技能 ID */
  skillId: string
  /** 对应的伤害事件 ID */
  damageEventId: string
  /** 使用时间（秒） */
  time: number
  /** 使用者职业 */
  job: Job
}

/**
 * 时间轴导出格式（JSON）
 */
export interface TimelineExport {
  /** 版本号 */
  version: string
  /** 时间轴数据 */
  timeline: Timeline
  /** 导出时间 */
  exportedAt: string
}

/**
 * 时间轴摘要（用于列表显示）
 */
export interface TimelineSummary {
  /** 时间轴 ID */
  id: string
  /** 时间轴名称 */
  name: string
  /** 副本名称 */
  encounterName: string
  /** 更新时间 */
  updatedAt: string
  /** 减伤分配数量 */
  assignmentCount: number
}
