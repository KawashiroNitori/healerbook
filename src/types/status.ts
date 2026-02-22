/**
 * 状态类型定义
 */

import type { Keigenn } from '../../3rdparty/ff14-overlay-vue/src/types/keigennRecord2'

/**
 * 减伤状态元数据（直接引用 keigenn.ts）
 */
export type MitigationStatusMetadata = Keigenn

/**
 * 减伤状态实例（运行时）
 */
export interface MitigationStatus {
  /** 运行时生成的唯一 ID */
  instanceId: string
  /** 状态 ID（对应 Keigenn.id） */
  statusId: number
  /** 开始时间（秒） */
  startTime: number
  /** 结束时间（秒） */
  endTime: number
  /** 剩余盾值（仅盾值类型状态） */
  remainingBarrier?: number
  /** 来源技能 ID */
  sourceActionId?: number
  /** 来源玩家 ID（对应 FFLogsActor.id） */
  sourcePlayerId?: number
}
