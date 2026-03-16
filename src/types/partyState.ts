/**
 * 小队状态类型定义（编辑模式专用）
 */

import type { Job } from './mitigation'
import type { MitigationStatus } from './status'

/**
 * 小队状态（编辑模式）
 * 所有状态统一存放在 player.statuses 中，不再区分友方/敌方
 */
export interface PartyState {
  /** 单个代表玩家 */
  player: PlayerState
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
  /** 所有状态列表（包含友方 Buff 和原敌方 Debuff） */
  statuses: MitigationStatus[]
}
