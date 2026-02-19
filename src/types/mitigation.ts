/**
 * 减伤技能类型定义
 */

/**
 * 减伤类型
 * - target_percentage: 目标百分比减伤（降低 boss 造成的伤害）
 * - non_target_percentage: 非目标百分比减伤（降低玩家受到的伤害）
 * - barrier: 盾值减伤（临时生命值）
 */
export type MitigationType = 'target_percentage' | 'non_target_percentage' | 'barrier'

/**
 * FF14 职业
 */
export type Job =
  // 治疗
  | 'WHM' // 白魔法师
  | 'SCH' // 学者
  | 'AST' // 占星术士
  | 'SGE' // 贤者
  // 坦克
  | 'PLD' // 骑士
  | 'WAR' // 战士
  | 'DRK' // 暗黑骑士
  | 'GNB' // 绝枪战士
  // 近战 DPS
  | 'DRG' // 龙骑士
  | 'MNK' // 武僧
  | 'NIN' // 忍者
  | 'SAM' // 武士
  | 'RPR' // 钐镰客
  | 'VPR' // 蝰蛇剑士
  // 远程物理 DPS
  | 'BRD' // 吟游诗人
  | 'MCH' // 机工士
  | 'DNC' // 舞者
  // 远程魔法 DPS
  | 'BLM' // 黑魔法师
  | 'SMN' // 召唤师
  | 'RDM' // 赤魔法师
  | 'PCT' // 绘灵法师

/**
 * 减伤技能
 */
export interface MitigationAction {
  /** 技能 ID */
  id: number
  /** 技能名称（中文） */
  name: string
  /** 技能描述 */
  description?: string
  /** 技能图标 URL */
  icon: string
  /** 技能高清图标 URL */
  iconHD?: string
  /** 可使用的职业 */
  job: Job
  /** 减伤类型 */
  type: MitigationType
  /** 物理减伤百分比（0-100） */
  physicReduce: number
  /** 魔法减伤百分比（0-100） */
  magicReduce: number
  /** 盾值 */
  barrier: number
  /** 持续时间（秒） */
  duration: number
  /** 冷却时间（秒） */
  cooldown: number
  /** 是否可重叠（同一职业的同一技能是否允许在时间轴上重叠） */
  canOverlap?: boolean
}

/**
 * 减伤效果（运行时）
 */
export interface MitigationEffect {
  /** 减伤类型 */
  type: MitigationType
  /** 物理减伤值 */
  physicReduce: number
  /** 魔法减伤值 */
  magicReduce: number
  /** 盾值（初始值） */
  barrier: number
  /** 作用前的剩余盾值 */
  remainingBarrierBefore?: number
  /** 作用后的剩余盾值 */
  remainingBarrierAfter?: number
  /** 开始时间 */
  startTime: number
  /** 结束时间 */
  endTime: number
  /** 关联的技能 ID */
  actionId: number
  /** 使用者职业 */
  job: Job
  /** 关联的分配 ID（用于跟踪盾值消耗） */
  assignmentId?: string
}
