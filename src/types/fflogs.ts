/**
 * FFLogs API 数据类型定义
 */

import type { Job } from './mitigation'

/**
 * FFLogs v1 战斗报告响应
 */
export interface FFLogsV1Report {
  /** 语言 */
  lang?: string
  /** 战斗列表 */
  fights: FFLogsV1Fight[]
  /** 报告标题 */
  title?: string
  /** 报告所有者 */
  owner?: string
  /** 开始时间 */
  start?: number
  /** 结束时间 */
  end?: number
  /** 友方单位（玩家） */
  friendlies?: FFLogsV1Actor[]
  /** 敌对单位 */
  enemies?: FFLogsV1Actor[]
}

/**
 * FFLogs v1 Actor（玩家或 NPC）
 */
export interface FFLogsV1Actor {
  /** Actor ID */
  id: number
  /** GUID */
  guid: number
  /** 名称 */
  name: string
  /** 类型（职业名或 NPC/Boss） */
  type: string
  /** 服务器 */
  server?: string
  /** 图标 */
  icon?: string
  /** 参与的战斗 */
  fights?: Array<{
    id: number
    instances?: number
    groups?: number
  }>
}

/**
 * FFLogs v1 战斗
 */
export interface FFLogsV1Fight {
  /** 战斗 ID */
  id: number
  /** Boss ID */
  boss: number
  /** 开始时间（相对于报告开始，毫秒） */
  start_time: number
  /** 结束时间（相对于报告开始，毫秒） */
  end_time: number
  /** 战斗名称 */
  name: string
  /** 区域 ID */
  zoneID: number
  /** 区域名称 */
  zoneName: string
  /** 区域计数器 */
  zoneCounter?: number
  /** 队伍人数 */
  size?: number
  /** 难度 */
  difficulty?: number
  /** 是否击杀 */
  kill?: boolean
  /** 部分进度 */
  partial?: number
  /** 是否进行中 */
  inProgress?: boolean
  /** 标准阵容 */
  standardComposition?: boolean
  /** 是否有回响 */
  hasEcho?: boolean
  /** 战斗时间（毫秒） */
  combatTime?: number
  /** Boss 百分比 */
  bossPercentage?: number
  /** 战斗百分比 */
  fightPercentage?: number
}

/**
 * FFLogs 战斗报告（兼容类型）
 */
export interface FFLogsReport {
  /** 报告代码 */
  code?: string
  /** 报告标题 */
  title?: string
  /** 语言 */
  lang?: string
  /** 开始时间（Unix 时间戳，毫秒） */
  startTime?: number
  /** 结束时间（Unix 时间戳，毫秒） */
  endTime?: number
  /** 战斗列表 */
  fights: FFLogsFight[]
  /** 友方单位（玩家） */
  friendlies?: FFLogsV1Actor[]
  /** 敌对单位 */
  enemies?: FFLogsV1Actor[]
}

/**
 * FFLogs 战斗（兼容类型）
 */
export interface FFLogsFight {
  /** 战斗 ID */
  id: number
  /** 战斗名称 */
  name: string
  /** 难度 */
  difficulty?: number
  /** 是否击杀 */
  kill?: boolean
  /** 开始时间（相对于报告开始，毫秒） */
  startTime: number
  /** 结束时间（相对于报告开始，毫秒） */
  endTime: number
  /** 副本 ID */
  encounterID?: number
}

/**
 * FFLogs 事件
 */
export interface FFLogsEvent {
  /** 事件类型 */
  type: string
  /** 时间戳（相对于战斗开始，毫秒） */
  timestamp: number
  /** 源 Actor */
  sourceID?: number
  /** 目标 Actor */
  targetID?: number
  /** 技能 ID */
  abilityGameID?: number
  /** 伤害值 */
  amount?: number
  /** 是否暴击 */
  hitType?: number
}

/**
 * FFLogs 伤害承受事件
 */
export interface FFLogsDamageTakenEvent extends FFLogsEvent {
  type: 'damage'
  /** 伤害值 */
  amount: number
  /** 未减伤伤害 */
  unmitigatedAmount?: number
  /** 吸收的伤害（盾） */
  absorbed?: number
}

/**
 * FFLogs Actor（玩家或 NPC）
 */
export interface FFLogsActor {
  /** Actor ID */
  id: number
  /** 名称 */
  name: string
  /** 类型 */
  type: string
  /** 职业（玩家） */
  job?: Job
  /** 服务器 */
  server?: string
}

/**
 * FFLogs 小队阵容
 */
export interface FFLogsComposition {
  /** 玩家列表 */
  players: FFLogsPlayer[]
}

/**
 * FFLogs 玩家
 */
export interface FFLogsPlayer {
  /** 玩家 ID */
  id: number
  /** 玩家名称 */
  name: string
  /** 职业 */
  job: Job
  /** 服务器 */
  server: string
  /** 角色类型 */
  role: 'tank' | 'healer' | 'dps'
}

/**
 * FFLogs TOP100 排名数据
 */
export interface FFLogsRanking {
  /** 报告代码 */
  reportCode: string
  /** 战斗 ID */
  fightID: number
  /** 开始时间 */
  startTime: number
  /** 持续时间（毫秒） */
  duration: number
  /** 小队阵容 */
  composition: FFLogsComposition
  /** 治疗合计伤害 */
  totalHealerDamage: number
}

/**
 * FFLogs GraphQL 查询响应
 */
export interface FFLogsGraphQLResponse<T = any> {
  /** 数据 */
  data?: T
  /** 错误 */
  errors?: Array<{
    message: string
    locations?: Array<{
      line: number
      column: number
    }>
    path?: string[]
  }>
}
