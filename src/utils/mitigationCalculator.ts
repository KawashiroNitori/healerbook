/**
 * 减伤计算引擎
 * 实现核心减伤计算逻辑
 */

import type {
  MitigationType,
  MitigationEffect,
  MitigationSkill,
} from '@/types/mitigation'
import type { MitigationAssignment } from '@/types/timeline'

/**
 * 计算结果
 */
export interface CalculationResult {
  /** 原始伤害 */
  originalDamage: number
  /** 最终伤害 */
  finalDamage: number
  /** 减伤百分比 */
  mitigationPercentage: number
  /** 应用的减伤效果 */
  appliedEffects: MitigationEffect[]
}

/**
 * CD 验证结果
 */
export interface CooldownValidationResult {
  /** 是否有效 */
  valid: boolean
  /** 错误列表 */
  errors: CooldownError[]
}

/**
 * CD 错误
 */
export interface CooldownError {
  /** 技能 ID */
  skillId: string
  /** 技能名称 */
  skillName: string
  /** 冲突的分配 ID 列表 */
  conflictingAssignments: string[]
  /** 错误消息 */
  message: string
}

/**
 * 减伤计算器
 */
export class MitigationCalculator {
  /**
   * 计算减伤后的最终伤害
   * 公式: 最终伤害 = 原始伤害 × (1-减伤1%) × (1-减伤2%) × ... - 盾值
   */
  calculate(originalDamage: number, effects: MitigationEffect[]): CalculationResult {
    let damage = originalDamage
    const appliedEffects: MitigationEffect[] = []

    // 1. 应用所有百分比减伤（乘算）
    const percentageEffects = effects.filter(
      e => e.type === 'target_percentage' || e.type === 'non_target_percentage'
    )

    for (const effect of percentageEffects) {
      damage *= 1 - effect.value / 100
      appliedEffects.push(effect)
    }

    // 2. 应用盾值减伤（减算）
    const shieldEffects = effects.filter(e => e.type === 'shield')
    const totalShield = shieldEffects.reduce((sum, e) => sum + e.value, 0)
    damage = Math.max(0, damage - totalShield)

    appliedEffects.push(...shieldEffects)

    const finalDamage = Math.round(damage)
    const mitigationPercentage =
      originalDamage > 0 ? ((originalDamage - finalDamage) / originalDamage) * 100 : 0

    return {
      originalDamage,
      finalDamage,
      mitigationPercentage,
      appliedEffects,
    }
  }

  /**
   * 获取指定时间点生效的减伤效果
   */
  getActiveEffects(
    time: number,
    assignments: MitigationAssignment[],
    skills: MitigationSkill[]
  ): MitigationEffect[] {
    const effects: MitigationEffect[] = []

    for (const assignment of assignments) {
      const skill = skills.find(s => s.id === assignment.skillId)
      if (!skill) continue

      const startTime = assignment.time
      const endTime = startTime + skill.duration

      // 检查时间点是否在技能持续时间内
      if (time >= startTime && time <= endTime) {
        effects.push({
          type: skill.type,
          value: skill.value,
          startTime,
          endTime,
          skillId: skill.id,
          job: assignment.job,
        })
      }
    }

    return effects
  }

  /**
   * 验证技能使用是否违反 CD 限制
   */
  validateCooldown(
    assignments: MitigationAssignment[],
    skills: MitigationSkill[]
  ): CooldownValidationResult {
    const errors: CooldownError[] = []

    // 按技能分组
    const assignmentsBySkill = new Map<string, MitigationAssignment[]>()
    for (const assignment of assignments) {
      const list = assignmentsBySkill.get(assignment.skillId) || []
      list.push(assignment)
      assignmentsBySkill.set(assignment.skillId, list)
    }

    // 检查每个技能的 CD
    for (const [skillId, skillAssignments] of assignmentsBySkill) {
      const skill = skills.find(s => s.id === skillId)
      if (!skill) continue

      // 按时间排序
      const sorted = [...skillAssignments].sort((a, b) => a.time - b.time)

      // 检查相邻使用之间的时间间隔
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]
        const curr = sorted[i]
        const timeDiff = curr.time - prev.time

        if (timeDiff < skill.cooldown) {
          errors.push({
            skillId: skill.id,
            skillName: skill.name,
            conflictingAssignments: [prev.id, curr.id],
            message: `${skill.name} CD 冲突: ${prev.time}s 和 ${curr.time}s 之间只有 ${timeDiff}s，需要 ${skill.cooldown}s CD`,
          })
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * 计算多个时间点的伤害
   */
  calculateMultiple(
    damageEvents: Array<{ time: number; damage: number }>,
    assignments: MitigationAssignment[],
    skills: MitigationSkill[]
  ): Array<CalculationResult & { time: number }> {
    return damageEvents.map(event => {
      const effects = this.getActiveEffects(event.time, assignments, skills)
      const result = this.calculate(event.damage, effects)
      return {
        ...result,
        time: event.time,
      }
    })
  }

  /**
   * 检查技能是否可以在指定时间使用
   */
  canUseSkillAt(
    skillId: string,
    time: number,
    assignments: MitigationAssignment[],
    skills: MitigationSkill[]
  ): { canUse: boolean; reason?: string } {
    const skill = skills.find(s => s.id === skillId)
    if (!skill) {
      return { canUse: false, reason: '技能不存在' }
    }

    // 查找该技能的所有使用记录
    const skillAssignments = assignments
      .filter(a => a.skillId === skillId)
      .sort((a, b) => a.time - b.time)

    // 检查是否有 CD 冲突
    for (const assignment of skillAssignments) {
      const timeDiff = Math.abs(time - assignment.time)
      if (timeDiff < skill.cooldown && timeDiff > 0) {
        return {
          canUse: false,
          reason: `CD 未就绪，需要等待 ${skill.cooldown - timeDiff}s`,
        }
      }
    }

    return { canUse: true }
  }

  /**
   * 获取技能下次可用时间
   */
  getNextAvailableTime(
    skillId: string,
    currentTime: number,
    assignments: MitigationAssignment[],
    skills: MitigationSkill[]
  ): number {
    const skill = skills.find(s => s.id === skillId)
    if (!skill) return currentTime

    // 查找该技能在当前时间之前的最后一次使用
    const lastUse = assignments
      .filter(a => a.skillId === skillId && a.time <= currentTime)
      .sort((a, b) => b.time - a.time)[0]

    if (!lastUse) {
      return currentTime // 从未使用过，立即可用
    }

    const nextAvailable = lastUse.time + skill.cooldown
    return Math.max(currentTime, nextAvailable)
  }
}

/**
 * 创建减伤计算器实例
 */
export function createMitigationCalculator(): MitigationCalculator {
  return new MitigationCalculator()
}
