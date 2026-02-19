/**
 * 减伤计算引擎
 * 实现核心减伤计算逻辑
 */

import type {
  MitigationEffect,
  MitigationAction,
} from '@/types/mitigation'
import type { MitigationAssignment } from '@/types/timeline'

/**
 * 伤害类型
 */
export type DamageType = 'physical' | 'magical' | 'special'

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
  actionId: number
  /** 技能名称 */
  actionName: string
  /** 冲突的分配 ID 列表 */
  conflictingAssignments: string[]
  /** 错误消息 */
  message: string
}

/**
 * 减伤计算器
 */
export class MitigationCalculator {
  /** 盾值状态跟踪（assignmentId -> 剩余盾值） */
  private barrierState: Map<string, number> = new Map()

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_actions: MitigationAction[]) {
    // actions 参数保留用于未来扩展
  }

  /**
   * 重置盾值状态
   */
  resetBarrierState() {
    this.barrierState.clear()
  }

  /**
   * 计算减伤后的最终伤害
   * 公式: 最终伤害 = 原始伤害 × (1-减伤1%) × (1-减伤2%) × ... - 盾值
   *
   * @param originalDamage 原始伤害
   * @param effects 减伤效果列表
   * @param damageType 伤害类型（物理/魔法/特殊）
   * @param consumeBarrier 是否消耗盾值（默认 true）
   */
  calculate(
    originalDamage: number,
    effects: MitigationEffect[],
    damageType: DamageType = 'physical',
    consumeBarrier: boolean = true
  ): CalculationResult {
    let damage = originalDamage
    const appliedEffects: MitigationEffect[] = []
    const addedEffectIds = new Set<string>() // 跟踪已添加的效果

    // 1. 应用所有百分比减伤（乘算）
    // 注意：百分比减伤对特殊类型伤害无效
    if (damageType !== 'special') {
      const percentageEffects = effects.filter(
        e => e.physicReduce > 0 || e.magicReduce > 0
      )

      for (const effect of percentageEffects) {
        // 根据伤害类型选择对应的减伤值
        const reduceValue = damageType === 'physical' ? effect.physicReduce : effect.magicReduce

        if (reduceValue > 0) {
          damage *= 1 - reduceValue / 100

          // 标记为已添加
          if (effect.assignmentId) {
            addedEffectIds.add(effect.assignmentId)
          }
          appliedEffects.push(effect)
        }
      }
    }

    // 2. 应用盾值减伤（减算）
    // 盾值对所有类型伤害都有效
    const barrierEffects = effects.filter(e => e.barrier > 0)

    let remainingDamage = damage
    for (const effect of barrierEffects) {
      if (remainingDamage <= 0) break

      // 获取或初始化盾值剩余量
      const assignmentId = effect.assignmentId
      if (!assignmentId) {
        // 如果没有 assignmentId，使用原始盾值（向后兼容）
        const barrierToUse = Math.min(effect.barrier, remainingDamage)
        remainingDamage -= barrierToUse
        appliedEffects.push(effect)
        continue
      }

      // 从状态中获取剩余盾值，如果不存在则初始化
      if (!this.barrierState.has(assignmentId)) {
        this.barrierState.set(assignmentId, effect.barrier)
      }

      const remainingBarrier = this.barrierState.get(assignmentId)!

      if (remainingBarrier > 0) {
        // 计算本次消耗的盾值
        const barrierToConsume = Math.min(remainingBarrier, remainingDamage)

        if (consumeBarrier) {
          // 更新剩余盾值，确保不会变成负数
          const newBarrierValue = Math.max(0, remainingBarrier - barrierToConsume)
          this.barrierState.set(assignmentId, newBarrierValue)
        }

        remainingDamage -= barrierToConsume

        // 如果这个效果已经在百分比减伤阶段添加过了，更新它的盾值信息
        if (assignmentId && addedEffectIds.has(assignmentId)) {
          const existingEffect = appliedEffects.find(e => e.assignmentId === assignmentId)
          if (existingEffect) {
            existingEffect.remainingBarrierBefore = remainingBarrier
            existingEffect.remainingBarrierAfter = consumeBarrier
              ? Math.max(0, remainingBarrier - barrierToConsume)
              : remainingBarrier
          }
        } else {
          // 否则添加新的效果
          appliedEffects.push({
            ...effect,
            remainingBarrierBefore: remainingBarrier,
            remainingBarrierAfter: consumeBarrier
              ? Math.max(0, remainingBarrier - barrierToConsume)
              : remainingBarrier
          })
        }
      }
    }

    damage = Math.max(0, remainingDamage)

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
    actions: MitigationAction[]
  ): MitigationEffect[] {
    const effects: MitigationEffect[] = []

    for (const assignment of assignments) {
      const action = actions.find(s => s.id === assignment.actionId)
      if (!action) continue

      const startTime = assignment.time
      const endTime = startTime + action.duration

      // 检查时间点是否在技能持续时间内
      if (time >= startTime && time <= endTime) {
        // 获取当前的剩余盾值（如果有的话）
        const currentBarrier = this.barrierState.has(assignment.id)
          ? this.barrierState.get(assignment.id)!
          : action.barrier

        effects.push({
          id: action.id,
          physicReduce: action.physicReduce,
          magicReduce: action.magicReduce,
          barrier: action.barrier,
          remainingBarrierBefore: Math.max(0, currentBarrier),
          startTime,
          endTime,
          actionId: action.id,
          job: assignment.job,
          assignmentId: assignment.id,
        })
      }
    }

    // 处理互斥组：同组技能只保留最后生效的
    return this.filterUniqueGroupEffects(effects, actions)
  }

  /**
   * 过滤互斥组效果
   * 同一互斥组中，只保留最后生效的效果
   */
  private filterUniqueGroupEffects(
    effects: MitigationEffect[],
    actions: MitigationAction[]
  ): MitigationEffect[] {
    // 如果没有效果，直接返回
    if (effects.length === 0) {
      return effects
    }

    // 构建互斥关系映射：技能 ID -> 与其互斥的技能 ID 集合
    const mutuallyExclusiveMap = new Map<number, Set<number>>()
    actions.forEach(action => {
      if (action.uniqueGroup && action.uniqueGroup.length > 0) {
        mutuallyExclusiveMap.set(action.id, new Set(action.uniqueGroup))
      }
    })

    // 如果没有互斥关系，直接返回
    if (mutuallyExclusiveMap.size === 0) {
      return effects
    }

    // 按开始时间排序（从早到晚）
    const sortedEffects = [...effects].sort((a, b) => a.startTime - b.startTime)

    // 过滤互斥效果：对于每个效果，检查是否有更晚生效的互斥技能
    const filteredEffects: MitigationEffect[] = []

    for (const effect of sortedEffects) {
      const mutuallyExclusiveIds = mutuallyExclusiveMap.get(effect.actionId)

      // 如果该技能没有互斥关系，直接保留
      if (!mutuallyExclusiveIds) {
        filteredEffects.push(effect)
        continue
      }

      // 检查是否有更晚生效的互斥技能
      const hasLaterMutuallyExclusive = sortedEffects.some(otherEffect => {
        // 必须是不同的效果
        if (otherEffect.assignmentId === effect.assignmentId) return false

        // 必须是互斥的技能
        if (!mutuallyExclusiveIds.has(otherEffect.actionId)) return false

        // 必须更晚生效
        return otherEffect.startTime > effect.startTime
      })

      // 如果没有更晚的互斥技能，保留该效果
      if (!hasLaterMutuallyExclusive) {
        filteredEffects.push(effect)
      }
    }

    return filteredEffects
  }

  /**
   * 验证技能使用是否违反 CD 限制
   */
  validateCooldown(
    assignments: MitigationAssignment[],
    actions: MitigationAction[]
  ): CooldownValidationResult {
    const errors: CooldownError[] = []

    // 按技能分组
    const assignmentsByAction = new Map<number, MitigationAssignment[]>()
    for (const assignment of assignments) {
      const list = assignmentsByAction.get(assignment.actionId) || []
      list.push(assignment)
      assignmentsByAction.set(assignment.actionId, list)
    }

    // 检查每个技能的 CD
    for (const [actionId, actionAssignments] of assignmentsByAction) {
      const action = actions.find(s => s.id === actionId)
      if (!action) continue

      // 按时间排序
      const sorted = [...actionAssignments].sort((a, b) => a.time - b.time)

      // 检查相邻使用之间的时间间隔
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]
        const curr = sorted[i]
        const timeDiff = curr.time - prev.time

        if (timeDiff < action.cooldown) {
          errors.push({
            actionId: action.id,
            actionName: action.name,
            conflictingAssignments: [prev.id, curr.id],
            message: `${action.name} CD 冲突: ${prev.time}s 和 ${curr.time}s 之间只有 ${timeDiff}s，需要 ${action.cooldown}s CD`,
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
    damageEvents: Array<{ time: number; damage: number; damageType?: DamageType }>,
    assignments: MitigationAssignment[],
    actions: MitigationAction[]
  ): Array<CalculationResult & { time: number }> {
    return damageEvents.map(event => {
      const effects = this.getActiveEffects(event.time, assignments, actions)
      const result = this.calculate(event.damage, effects, event.damageType || 'physical')
      return {
        ...result,
        time: event.time,
      }
    })
  }

  /**
   * 检查技能是否可以在指定时间使用
   */
  canUseActionAt(
    actionId: number,
    time: number,
    assignments: MitigationAssignment[],
    actions: MitigationAction[]
  ): { canUse: boolean; reason?: string } {
    const action = actions.find(s => s.id === actionId)
    if (!action) {
      return { canUse: false, reason: '技能不存在' }
    }

    // 查找该技能的所有使用记录
    const actionAssignments = assignments
      .filter(a => a.actionId === actionId)
      .sort((a, b) => a.time - b.time)

    // 检查是否有 CD 冲突
    for (const assignment of actionAssignments) {
      const timeDiff = Math.abs(time - assignment.time)
      if (timeDiff < action.cooldown && timeDiff > 0) {
        return {
          canUse: false,
          reason: `CD 未就绪，需要等待 ${action.cooldown - timeDiff}s`,
        }
      }
    }

    return { canUse: true }
  }

  /**
   * 获取技能下次可用时间
   */
  getNextAvailableTime(
    actionId: number,
    currentTime: number,
    assignments: MitigationAssignment[],
    actions: MitigationAction[]
  ): number {
    const action = actions.find(s => s.id === actionId)
    if (!action) return currentTime

    // 查找该技能在当前时间之前的最后一次使用
    const lastUse = assignments
      .filter(a => a.actionId === actionId && a.time <= currentTime)
      .sort((a, b) => b.time - a.time)[0]

    if (!lastUse) {
      return currentTime // 从未使用过，立即可用
    }

    const nextAvailable = lastUse.time + action.cooldown
    return Math.max(currentTime, nextAvailable)
  }
}

/**
 * 创建减伤计算器实例
 */
export function createMitigationCalculator(actions: MitigationAction[]): MitigationCalculator {
  return new MitigationCalculator(actions)
}
