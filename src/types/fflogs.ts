/**
 * FFLogs API 数据类型定义
 */

import type { Job } from './mitigation'

/**
 * FFLogs 战斗报告
 */
export interface FFLogsReport {
  /** 报告代码 */
  code: string
  /** 报告标题 */
  title: string
  /** 开始时间（Unix 时间戳，毫秒） */
  startTime: number
  /** 结束时间（Unix 时间戳，毫秒） */
  endTime: number
  /** 战斗列表 */
  fights: FFLogsFight[]
}

/**
 * FFLogs 战斗
 */
export interface FFLogsFight {
  /** 战斗 ID */
  id: number
  /** 战斗名称 */
  name: string
  /** 难度 */
  difficulty?: number
  /** 是否击杀 */
  kill: boolean
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
