/**
 * 减伤技能类型定义
 */

/**
 * 减伤类型
 * - target_percentage: 目标百分比减伤（降低 boss 造成的伤害）
 * - non_target_percentage: 非目标百分比减伤（降低玩家受到的伤害）
 * - shield: 盾值减伤（临时生命值）
 */
export type MitigationType = 'target_percentage' | 'non_target_percentage' | 'shield'

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
export interface MitigationSkill {
  /** 技能 ID */
  id: string
  /** 技能名称（中文） */
  name: string
  /** 技能名称（英文） */
  nameEn: string
  /** 技能图标 URL */
  icon: string
  /** 可使用的职业 */
  job: Job
  /** 减伤类型 */
  type: MitigationType
  /** 减伤值（百分比或盾值） */
  value: number
  /** 持续时间（秒） */
  duration: number
  /** 冷却时间（秒） */
  cooldown: number
  /** 技能描述 */
  description: string
  /** 是否为团队减伤 */
  isPartyWide: boolean
}

/**
 * 减伤效果（运行时）
 */
export interface MitigationEffect {
  /** 减伤类型 */
  type: MitigationType
  /** 减伤值 */
  value: number
  /** 开始时间 */
  startTime: number
  /** 结束时间 */
  endTime: number
  /** 关联的技能 ID */
  skillId: string
  /** 使用者职业 */
  job: Job
}
