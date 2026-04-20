/**
 * 状态类型定义
 */

import type {
  Keigenn,
  PerformanceType as ExternalPerformanceType,
} from '../../3rdparty/ff14-overlay-vue/src/types/keigennRecord2'

/**
 * 减伤表现：在 3rd party 的 physics/magic/darkness 基础上新增 heal / maxHP
 * (1 = 无影响；< 1 减伤；此处复用同一套乘算口径)
 */
export type PerformanceType = ExternalPerformanceType & {
  /** 治疗增益倍率，缺省视为 1 */
  heal: number
  /** 最大 HP 倍率（> 1 增益；例如 1.1 = +10% HP），缺省视为 1 */
  maxHP: number
}

/**
 * 减伤状态元数据（在 Keigenn 基础上扩展本地字段）
 *
 * fullIcon 与 3rd party 的 keigenns 数组声明一致，做成可选
 */
export interface MitigationStatusMetadata extends Omit<Keigenn, 'performance' | 'fullIcon'> {
  performance: PerformanceType
  fullIcon?: string
  /** 是否仅对坦克生效 */
  isTankOnly: boolean
}

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
  /** 初始盾值（用于多层盾重置，仅盾值类型状态） */
  initialBarrier?: number
  /** 层数（默认为 1） */
  stack?: number
  /** 来源技能 ID */
  sourceActionId?: number
  /** 来源玩家 ID（对应 FFLogsActor.id） */
  sourcePlayerId?: number
}
