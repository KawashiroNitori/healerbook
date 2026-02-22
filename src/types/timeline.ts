/**
 * 时间轴类型定义
 */

import type { Job } from './mitigation'

export type { Job } from './mitigation'

/**
 * 最大队员数量
 */
export const MAX_PARTY_SIZE = 8

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
  /** 小队阵容 */
  composition: Composition
  /** 阶段列表 */
  phases: Phase[]
  /** 伤害事件列表（扁平化，便于访问） */
  damageEvents: DamageEvent[]
  /** 技能使用事件列表 */
  castEvents: CastEvent[]
  /** 状态事件列表（编辑模式由 executor 生成，回放模式从 FFLogs 导入） */
  statusEvents: StatusEvent[]
  /** 是否为回放模式 */
  isReplayMode?: boolean
  /** 减伤分配列表（已废弃，使用 castEvents 代替） */
  mitigationAssignments?: MitigationAssignment[]
  /** 减伤规划（已废弃，保留用于向后兼容） */
  mitigationPlan?: MitigationPlan
  /** 回放模式的原始状态事件（已废弃，使用 statusEvents 代替） */
  replayStateEvents?: ReplayStateEvent[]
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
  /** 攻击类型 */
  type: 'aoe' | 'tankbuster' | 'raidwide'
  /** 伤害类型 */
  damageType: 'physical' | 'magical' | 'special'
  /** 目标玩家 ID（可选，用于单体伤害） */
  targetPlayerId?: number
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
 * 小队阵容
 */
export interface Composition {
  /** 玩家列表 */
  players: Array<{
    id: number
    job: Job
    name: string
  }>
}

/**
 * 减伤规划
 */
export interface MitigationPlan {
  /** 减伤分配列表 */
  assignments: MitigationAssignment[]
}

/**
 * 技能使用事件
 */
export interface CastEvent {
  /** 事件 ID */
  id: string
  /** 技能 ID */
  actionId: number
  /** 使用时间（毫秒） */
  timestamp: number
  /** 使用者玩家 ID */
  playerId: number
  /** 使用者职业 */
  job: Job
  /** 目标玩家 ID（可选，用于单体技能） */
  targetPlayerId?: number
}

/**
 * 减伤分配（已废弃，使用 CastEvent 代替）
 * @deprecated
 */
export interface MitigationAssignment {
  /** 分配 ID */
  id: string
  /** 技能 ID */
  actionId: number
  /** 对应的伤害事件 ID */
  damageEventId: string
  /** 使用时间（秒） */
  time: number
  /** 使用者职业 */
  job: Job
  /** 使用者玩家 ID */
  playerId: number
  /** 目标玩家 ID（可选，用于单体技能） */
  targetPlayerId?: number
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

/**
 * 状态事件（编辑模式由 executor 生成，回放模式从 FFLogs 导入）
 */
export interface StatusEvent {
  /** 状态 ID */
  statusId: number
  /** 开始时间（毫秒） */
  startTime: number
  /** 结束时间（毫秒） */
  endTime: number
  /** 来源玩家 ID */
  sourcePlayerId?: number
  /** 目标玩家 ID */
  targetPlayerId?: number
  /** 目标实例 */
  targetInstance?: number
}

/**
 * 回放模式状态事件（从 FFLogs 导入）
 * @deprecated 使用 StatusEvent 代替
 */
export interface ReplayStateEvent {
  /** 事件类型 */
  type: 'applybuff' | 'removebuff' | 'applydebuff' | 'removedebuff'
  /** 时间戳（相对战斗开始，毫秒） */
  timestamp: number
  /** 状态 ID */
  abilityGameID: number
  /** 来源玩家 ID */
  sourceID?: number
  /** 目标玩家 ID */
  targetID?: number
  /** 目标类型 */
  targetInstance?: number
}
