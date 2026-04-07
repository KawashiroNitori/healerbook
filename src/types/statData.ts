/**
 * 时间轴内部统计数据
 */

/**
 * 统计数据条目类型
 * - shield: 盾量
 * - critShield: 暴击盾量
 * - heal: 治疗量
 * - critHeal: 暴击治疗量
 */
export type StatDataEntryType = 'shield' | 'critShield' | 'heal' | 'critHeal'

/**
 * 技能统计数据条目声明
 * 标识一个技能需要从 statData 中读取哪些字段
 */
export interface StatDataEntry {
  /** 数据类型 */
  type: StatDataEntryType
  /** 对应 Record 中的 key（shield 用 statusId，heal/critHeal 用 actionId） */
  key: number
  /** 可选显示标签（如展开战术的"鼓舞"） */
  label?: string
}

/**
 * 时间轴内部统计数据
 * 存储在 Timeline.statData 中，所有运行时计算只读此数据
 */
export interface TimelineStatData {
  /** 全局安全血量（非坦最低 HP） */
  referenceMaxHP: number
  /** 盾量：statusId → 中位盾值 */
  shieldByAbility: Record<number, number>
  /** 暴击盾量：statusId → 暴击盾值 */
  critShieldByAbility: Record<number, number>
  /** 治疗量：actionId → 中位治疗量 */
  healByAbility: Record<number, number>
  /** 暴击治疗量：actionId → 暴击治疗量 */
  critHealByAbility: Record<number, number>
}
