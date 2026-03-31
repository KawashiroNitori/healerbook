/**
 * 时间轴类型定义
 */

import type { Job } from '@/data/jobs'

export type { Job } from '@/data/jobs'

/**
 * 最大队员数量
 */
export const MAX_PARTY_SIZE = 8

/**
 * 伤害类型
 */
export type DamageType = 'physical' | 'magical' | 'darkness'

/**
 * 时间轴
 */
export interface Timeline {
  /** 时间轴 ID */
  id: string
  /** 时间轴名称 */
  name: string
  /** 时间轴说明（可选） */
  description?: string
  /** FFLogs 导入来源（仅从 FFLogs 导入的时间轴存在） */
  fflogsSource?: {
    reportCode: string
    fightId: number
  }
  /** 副本信息 */
  encounter: Encounter
  /** 小队阵容 */
  composition: Composition
  /** 伤害事件列表 */
  damageEvents: DamageEvent[]
  /** 技能使用事件列表 */
  castEvents: CastEvent[]
  /** 状态事件列表（编辑模式专用） */
  statusEvents: StatusEvent[]
  /** 是否为回放模式 */
  isReplayMode?: boolean
  /** 是否已发布到服务器 */
  isShared?: boolean
  /** 发布后是否有本地未发布的修改 */
  hasLocalChanges?: boolean
  /** 最后一次与服务器同步的版本号 */
  serverVersion?: number
  /** 创建时间（Unix timestamp，秒） */
  createdAt: number
  /** 更新时间（Unix timestamp，秒），由客户端时钟写入 */
  updatedAt: number
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
 * 护盾信息
 */
export interface ShieldInfo {
  /** 护盾状态 ID */
  statusId: number
  /** 护盾抵消量 */
  amount: number
}

/**
 * 状态快照（用于伤害事件的状态记录）
 */
export interface StatusSnapshot {
  /** 状态 ID */
  statusId: number
  /** 目标玩家 ID */
  targetPlayerId?: number
  /** 盾值（仅盾值类型状态） */
  absorb?: number
}

/**
 * 单个玩家的伤害详情
 */
export interface PlayerDamageDetail {
  /** 时间戳（毫秒） */
  timestamp: number
  /** 伤害包 ID */
  packetId: number
  /** 攻击者 ID */
  sourceId: number
  /** 玩家 ID */
  playerId: number
  /** 玩家职业 */
  job: Job
  /** 伤害技能 ID */
  abilityId: number
  /** 技能名称 */
  skillName: string
  /** 原始伤害 */
  unmitigatedDamage: number
  /** 最终伤害 */
  finalDamage: number
  /** 溢出伤害（超出目标剩余 HP 的部分） */
  overkill?: number
  /** 伤害倍率 */
  multiplier?: number
  /** 生效的状态快照列表（包括百分比减伤和盾值） */
  statuses: StatusSnapshot[]
  /** 当前生命值（伤害后） */
  hitPoints?: number
  /** 最大生命值 */
  maxHitPoints?: number
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
  /** 原始伤害（非坦克玩家平均值，如果只有坦克则为所有玩家平均值） */
  damage: number
  /** 攻击类型 */
  type: 'aoe' | 'tankbuster'
  /** 伤害类型 */
  damageType: DamageType
  /** 目标玩家 ID（可选，用于单体伤害） */
  targetPlayerId?: number
  /** 每个玩家的伤害详情 */
  playerDamageDetails?: PlayerDamageDetail[]
  /** 伤害包 ID（回放模式，用于关联状态快照） */
  packetId?: number
}

/**
 * 小队阵容
 */
export interface Composition {
  /** 玩家列表 */
  players: Array<{
    id: number
    job: Job
  }>
}

/**
 * 技能使用事件
 */
export interface CastEvent {
  /** 事件 ID */
  id: string
  /** 技能 ID */
  actionId: number
  /** 使用时间（秒） */
  timestamp: number
  /** 使用者玩家 ID */
  playerId: number
  /** 使用者职业 */
  job: Job
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
  /** 开始时间（秒） */
  startTime: number
  /** 结束时间（秒） */
  endTime: number
  /** 来源玩家 ID */
  sourcePlayerId?: number
  /** 目标玩家 ID */
  targetPlayerId?: number
  /** 目标实例 */
  targetInstance?: number
  /** 盾值（仅盾值类型状态，从 FFLogs absorb 字段获取） */
  absorb?: number
  /** 伤害包 ID（回放模式，用于关联同一次技能对不同玩家的伤害） */
  packetId?: number
}
