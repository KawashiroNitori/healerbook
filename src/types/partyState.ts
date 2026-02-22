/**
 * 小队状态类型定义
 */

import type { Job } from './mitigation'
import type { MitigationStatus } from './status'

/**
 * 小队状态
 */
export interface PartyState {
  /** 玩家列表 */
  players: PlayerState[]
  /** 虚拟敌方 */
  enemy: EnemyState
  /** 当前时间戳（秒） */
  timestamp: number
}

/**
 * 玩家状态
 */
export interface PlayerState {
  /** 玩家 ID（对应 FFLogsActor.id） */
  id: number
  /** 职业 */
  job: Job
  /** 当前 HP */
  currentHP: number
  /** 最大 HP */
  maxHP: number
  /** 状态列表 */
  statuses: MitigationStatus[]
}

/**
 * 敌方状态（虚拟敌方，用于存储目标减伤状态）
 */
export interface EnemyState {
  /** 目标减伤状态列表 */
  statuses: MitigationStatus[]
}
