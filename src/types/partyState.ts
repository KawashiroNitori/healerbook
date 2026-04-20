/**
 * 小队状态类型定义（编辑模式专用）
 */

import type { MitigationStatus } from './status'

/**
 * 小队状态（编辑模式）
 * 所有状态统一存放在 PartyState.statuses 中，不再区分友方/敌方
 */
export interface PartyState {
  /** 所有状态列表（包含友方 Buff 和原敌方 Debuff） */
  statuses: MitigationStatus[]
  /** 当前时间戳（秒） */
  timestamp: number
}
