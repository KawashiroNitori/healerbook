/**
 * 减伤计算器单元测试
 */

import { describe, it, expect } from 'vitest'
import { MitigationCalculator } from './mitigationCalculator'
import type { MitigationEffect, MitigationAction } from '@/types/mitigation'
import type { MitigationAssignment } from '@/types/timeline'
import type { CooldownValidationResult, CooldownError, CalculationResult, DamageType } from './mitigationCalculator'

/**
 * 测试辅助函数：验证技能使用是否违反 CD 限制
 */
function validateCooldown(
  calculator: MitigationCalculator,
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
 * 测试辅助函数：计算多个时间点的伤害
 */
function calculateMultiple(
  calculator: MitigationCalculator,
  damageEvents: Array<{ time: number; damage: number; damageType?: DamageType }>,
  assignments: MitigationAssignment[],
  actions: MitigationAction[]
): Array<CalculationResult & { time: number }> {
  return damageEvents.map(event => {
    const effects = calculator.getActiveEffects(event.time, assignments, actions)
    const result = calculator.calculate(event.damage, effects, event.damageType || 'physical')
    return {
      ...result,
      time: event.time,
    }
  })
}

/**
 * 测试辅助函数：检查技能是否可以在指定时间使用
 */
function canUseActionAt(
  calculator: MitigationCalculator,
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
 * 测试辅助函数：获取技能下次可用时间
 */
function getNextAvailableTime(
  calculator: MitigationCalculator,
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


describe('MitigationCalculator', () => {
  const mockActions: MitigationAction[] = []
  const calculator = new MitigationCalculator(mockActions)

  describe('calculate', () => {
    it('应该正确计算单个百分比减伤', () => {
      const effects: MitigationEffect[] = [
        {
          physicReduce: 10,
          magicReduce: 10,
          barrier: 0,
          startTime: 0,
          endTime: 20,
          actionId: 1001,
          job: 'WHM',
        },
      ]

      const result = calculator.calculate(10000, effects, 'physical')

      expect(result.originalDamage).toBe(10000)
      expect(result.finalDamage).toBe(9000) // 10000 * (1 - 0.1) = 9000
      expect(result.mitigationPercentage).toBe(10)
      expect(result.appliedEffects).toHaveLength(1)
    })

    it('应该正确计算多个百分比减伤（乘算）', () => {
      const effects: MitigationEffect[] = [
        {
          physicReduce: 10,
          magicReduce: 10,
          barrier: 0,
          startTime: 0,
          endTime: 20,
          actionId: 1001,
          job: 'WHM',
        },
        {
          physicReduce: 5,
          magicReduce: 5,
          barrier: 0,
          startTime: 0,
          endTime: 20,
          actionId: 2001,
          job: 'SCH',
        },
      ]

      const result = calculator.calculate(10000, effects, 'physical')

      // 10000 * (1 - 0.1) * (1 - 0.05) = 8550
      expect(result.finalDamage).toBe(8550)
      expect(result.mitigationPercentage).toBeCloseTo(14.5)
    })

    it('应该正确计算盾值减伤', () => {
      const effects: MitigationEffect[] = [
        {
          physicReduce: 0,
          magicReduce: 0,
          barrier: 1000,
          startTime: 0,
          endTime: 30,
          actionId: 2001,
          job: 'SCH',
        },
      ]

      const result = calculator.calculate(10000, effects, 'physical')

      expect(result.finalDamage).toBe(9000) // 10000 - 1000 = 9000
      expect(result.mitigationPercentage).toBe(10)
    })

    it('应该正确计算百分比减伤和盾值减伤的组合', () => {
      const effects: MitigationEffect[] = [
        {
          physicReduce: 10,
          magicReduce: 10,
          barrier: 0,
          startTime: 0,
          endTime: 20,
          actionId: 1001,
          job: 'WHM',
        },
        {
          physicReduce: 0,
          magicReduce: 0,
          barrier: 1000,
          startTime: 0,
          endTime: 30,
          actionId: 2001,
          job: 'SCH',
        },
      ]

      const result = calculator.calculate(10000, effects, 'physical')

      // 10000 * (1 - 0.1) - 1000 = 8000
      expect(result.finalDamage).toBe(8000)
      expect(result.mitigationPercentage).toBe(20)
    })

    it('盾值超过伤害时，最终伤害应为 0', () => {
      const effects: MitigationEffect[] = [
        {
          physicReduce: 0,
          magicReduce: 0,
          barrier: 15000,
          startTime: 0,
          endTime: 30,
          actionId: 2001,
          job: 'SCH',
        },
      ]

      const result = calculator.calculate(10000, effects, 'physical')

      expect(result.finalDamage).toBe(0)
      expect(result.mitigationPercentage).toBe(100)
    })

    it('特殊类型伤害不受百分比减伤影响', () => {
      const effects: MitigationEffect[] = [
        {
          physicReduce: 10,
          magicReduce: 10,
          barrier: 0,
          startTime: 0,
          endTime: 20,
          actionId: 1001,
          job: 'WHM',
        },
      ]

      const result = calculator.calculate(10000, effects, 'special')

      // 特殊伤害不受百分比减伤影响
      expect(result.finalDamage).toBe(10000)
      expect(result.mitigationPercentage).toBe(0)
    })

    it('特殊类型伤害受盾值减伤影响', () => {
      const effects: MitigationEffect[] = [
        {
          physicReduce: 0,
          magicReduce: 0,
          barrier: 1000,
          startTime: 0,
          endTime: 30,
          actionId: 2001,
          job: 'SCH',
        },
      ]

      const result = calculator.calculate(10000, effects, 'special')

      // 盾值对特殊伤害有效
      expect(result.finalDamage).toBe(9000)
      expect(result.mitigationPercentage).toBe(10)
    })

    it('物理和魔法减伤应该分别计算', () => {
      const effects: MitigationEffect[] = [
        {
          physicReduce: 10,
          magicReduce: 5,
          barrier: 0,
          startTime: 0,
          endTime: 20,
          actionId: 1001,
          job: 'WHM',
        },
      ]

      const physicalResult = calculator.calculate(10000, effects, 'physical')
      const magicalResult = calculator.calculate(10000, effects, 'magical')

      expect(physicalResult.finalDamage).toBe(9000) // 10000 * (1 - 0.1)
      expect(magicalResult.finalDamage).toBe(9500) // 10000 * (1 - 0.05)
    })
  })

  describe('getActiveEffects', () => {
    const actions: MitigationAction[] = [
      {
        id: 1001,
        name: '节制',
        icon: '/icon.png',
        iconHD: '/icon_hd.png',
        jobs: ['WHM'],
        physicReduce: 10,
        magicReduce: 10,
        barrier: 0,
        duration: 20,
        cooldown: 120,
      },
      {
        id: 2001,
        name: '鼓舞',
        icon: '/icon.png',
        iconHD: '/icon_hd.png',
        jobs: ['SCH'],
        physicReduce: 0,
        magicReduce: 0,
        barrier: 500,
        duration: 30,
        cooldown: 2.5,
      },
    ]

    const assignments: MitigationAssignment[] = [
      {
        id: 'assign1',
        actionId: 1001,
        damageEventId: 'event1',
        time: 10,
        job: 'WHM',
        playerId: 1,
      },
      {
        id: 'assign2',
        actionId: 2001,
        damageEventId: 'event1',
        time: 15,
        job: 'SCH',
        playerId: 2,
      },
    ]

    it('应该返回指定时间点生效的技能', () => {
      // 时间点 20: action1 (10-30) 生效, action2 (15-45) 生效
      const effects = calculator.getActiveEffects(20, assignments, actions)

      expect(effects).toHaveLength(2)
      expect(effects[0].actionId).toBe(1001)
      expect(effects[1].actionId).toBe(2001)
    })

    it('技能未生效时应返回空数组', () => {
      // 时间点 5: 所有技能都未生效
      const effects = calculator.getActiveEffects(5, assignments, actions)

      expect(effects).toHaveLength(0)
    })

    it('技能过期后不应返回', () => {
      // 时间点 50: 所有技能都已过期
      const effects = calculator.getActiveEffects(50, assignments, actions)

      expect(effects).toHaveLength(0)
    })

    it('技能在伤害事件之前使用时应该生效', () => {
      // 技能在时间 5 使用，持续 20 秒 (5-25)
      // 伤害事件在时间 15 发生
      // 技能应该对伤害事件生效
      const earlyAssignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          actionId: 1001,
          damageEventId: 'event1',
          time: 5,
          job: 'WHM',
          playerId: 1,
        },
      ]

      const effects = calculator.getActiveEffects(15, earlyAssignments, actions)

      expect(effects).toHaveLength(1)
      expect(effects[0].actionId).toBe(1001)
      expect(effects[0].startTime).toBe(5)
      expect(effects[0].endTime).toBe(25)
    })
  })

  describe('validateCooldown', () => {
    const actions: MitigationAction[] = [
      {
        id: 1001,
        name: '节制',
        icon: '/icon.png',
        iconHD: '/icon_hd.png',
        jobs: ['WHM'],
        physicReduce: 10,
        magicReduce: 10,
        barrier: 0,
        duration: 20,
        cooldown: 120,
      },
    ]

    it('CD 充足时应验证通过', () => {
      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          actionId: 1001,
          damageEventId: 'event1',
          time: 0,
          job: 'WHM',
        },
        {
          id: 'assign2',
          actionId: 1001,
          damageEventId: 'event2',
          time: 130,
          job: 'WHM',
        },
      ]

      const result = validateCooldown(calculator, assignments, actions)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('CD 不足时应验证失败', () => {
      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          actionId: 1001,
          damageEventId: 'event1',
          time: 0,
          job: 'WHM',
        },
        {
          id: 'assign2',
          actionId: 1001,
          damageEventId: 'event2',
          time: 60,
          job: 'WHM',
        },
      ]

      const result = validateCooldown(calculator, assignments, actions)

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].actionId).toBe(1001)
    })
  })

  describe('canUseActionAt', () => {
    const actions: MitigationAction[] = [
      {
        id: 1001,
        name: '节制',
        icon: '/icon.png',
        iconHD: '/icon_hd.png',
        jobs: ['WHM'],
        physicReduce: 10,
        magicReduce: 10,
        barrier: 0,
        duration: 20,
        cooldown: 120,
      },
    ]

    it('首次使用时应该可用', () => {
      const assignments: MitigationAssignment[] = []

      const result = canUseActionAt(calculator, 1001, 10, assignments, actions)

      expect(result.canUse).toBe(true)
    })

    it('CD 就绪后应该可用', () => {
      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          actionId: 1001,
          damageEventId: 'event1',
          time: 0,
          job: 'WHM',
        },
      ]

      const result = canUseActionAt(calculator, 1001, 130, assignments, actions)

      expect(result.canUse).toBe(true)
    })

    it('CD 未就绪时不应该可用', () => {
      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          actionId: 1001,
          damageEventId: 'event1',
          time: 0,
          job: 'WHM',
        },
      ]

      const result = canUseActionAt(calculator, 1001, 60, assignments, actions)

      expect(result.canUse).toBe(false)
      expect(result.reason).toContain('CD 未就绪')
    })
  })

  describe('getNextAvailableTime', () => {
    const actions: MitigationAction[] = [
      {
        id: 1001,
        name: '节制',
        icon: '/icon.png',
        iconHD: '/icon_hd.png',
        jobs: ['WHM'],
        physicReduce: 10,
        magicReduce: 10,
        barrier: 0,
        duration: 20,
        cooldown: 120,
      },
    ]

    it('首次使用时应返回当前时间', () => {
      const assignments: MitigationAssignment[] = []

      const nextTime = getNextAvailableTime(calculator, 1001, 10, assignments, actions)

      expect(nextTime).toBe(10)
    })

    it('应该返回 CD 结束后的时间', () => {
      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          actionId: 1001,
          damageEventId: 'event1',
          time: 0,
          job: 'WHM',
        },
      ]

      const nextTime = getNextAvailableTime(calculator, 1001, 50, assignments, actions)

      expect(nextTime).toBe(120) // 0 + 120
    })

    it('CD 已就绪时应返回当前时间', () => {
      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          actionId: 1001,
          damageEventId: 'event1',
          time: 0,
          job: 'WHM',
        },
      ]

      const nextTime = getNextAvailableTime(calculator, 1001, 130, assignments, actions)

      expect(nextTime).toBe(130)
    })
  })

  describe('盾值消耗', () => {
    const actions: MitigationAction[] = [
      {
        id: 2001,
        name: '野战治疗阵',
        icon: '/icon.png',
        jobs: ['SCH'],
        physicReduce: 0,
        magicReduce: 0,
        barrier: 5000,
        duration: 15,
        cooldown: 120,
      },
    ]

    it('盾值应该在第一次伤害后被消耗', () => {
      const calculator = new MitigationCalculator(actions)
      calculator.resetBarrierState()

      const effects: MitigationEffect[] = [
        {
          physicReduce: 0,
          magicReduce: 0,
          barrier: 5000,
          startTime: 0,
          endTime: 15,
          actionId: 2001,
          job: 'SCH',
          assignmentId: 'assign1',
        },
      ]

      // 第一次伤害：3000
      const result1 = calculator.calculate(3000, effects, 'physical')
      expect(result1.finalDamage).toBe(0) // 3000 - 5000 = 0
      expect(result1.appliedEffects[0].remainingBarrierAfter).toBe(2000) // 5000 - 3000 = 2000

      // 第二次伤害：3000（使用相同的 effects）
      const result2 = calculator.calculate(3000, effects, 'physical')
      expect(result2.finalDamage).toBe(1000) // 3000 - 2000 = 1000
      expect(result2.appliedEffects[0].remainingBarrierAfter).toBe(0) // 2000 - 2000 = 0
    })

    it('盾值耗尽后不应再减伤', () => {
      const calculator = new MitigationCalculator(actions)
      calculator.resetBarrierState()

      const effects: MitigationEffect[] = [
        {
          physicReduce: 0,
          magicReduce: 0,
          barrier: 5000,
          startTime: 0,
          endTime: 15,
          actionId: 2001,
          job: 'SCH',
          assignmentId: 'assign1',
        },
      ]

      // 第一次伤害：6000（耗尽盾值）
      const result1 = calculator.calculate(6000, effects, 'physical')
      expect(result1.finalDamage).toBe(1000) // 6000 - 5000 = 1000
      expect(result1.appliedEffects[0].remainingBarrierAfter).toBe(0)

      // 第二次伤害：3000（盾值已耗尽）
      const result2 = calculator.calculate(3000, effects, 'physical')
      expect(result2.finalDamage).toBe(3000) // 无盾值，全额伤害
    })
  })

  describe('互斥技能测试', () => {
    const actions: MitigationAction[] = [
      {
        id: 7405,
        name: '行吟',
        icon: '/icon.png',
        jobs: ['BRD'],
        uniqueGroup: [16889, 16012], // 与策动、防守之桑巴互斥
        physicReduce: 15,
        magicReduce: 15,
        barrier: 0,
        duration: 15,
        cooldown: 90,
      },
      {
        id: 16889,
        name: '策动',
        icon: '/icon.png',
        jobs: ['MCH'],
        uniqueGroup: [7405, 16012], // 与行吟、防守之桑巴互斥
        physicReduce: 15,
        magicReduce: 15,
        barrier: 0,
        duration: 15,
        cooldown: 90,
      },
      {
        id: 16012,
        name: '防守之桑巴',
        icon: '/icon.png',
        jobs: ['DNC'],
        uniqueGroup: [7405, 16889], // 与行吟、策动互斥
        physicReduce: 15,
        magicReduce: 15,
        barrier: 0,
        duration: 15,
        cooldown: 90,
      },
    ]

    it('后生效的互斥技能应覆盖先生效的', () => {
      const calculator = new MitigationCalculator(actions)

      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          actionId: 7405, // 行吟，10秒生效
          damageEventId: 'event1',
          time: 10,
          job: 'BRD',
        },
        {
          id: 'assign2',
          actionId: 16889, // 策动，15秒生效（更晚）
          damageEventId: 'event1',
          time: 15,
          job: 'MCH',
        },
      ]

      // 在 20 秒时，两个技能都在持续时间内（行吟 10-25s，策动 15-30s）
      // 但策动更晚生效，应该覆盖行吟
      const effects = calculator.getActiveEffects(20, assignments, actions)

      expect(effects.length).toBe(1)
      expect(effects[0].actionId).toBe(16889) // 只保留策动
    })

    it('不互斥的技能应该同时生效', () => {
      const calculator = new MitigationCalculator(actions)

      const nonMutualActions: MitigationAction[] = [
        ...actions,
        {
          id: 16160,
          name: '光之心',
          icon: '/icon.png',
          jobs: ['GNB'],
          // 没有 uniqueGroup，不与任何技能互斥
          physicReduce: 5,
          magicReduce: 10,
          barrier: 0,
          duration: 15,
          cooldown: 90,
        },
      ]

      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          actionId: 7405, // 行吟
          damageEventId: 'event1',
          time: 10,
          job: 'BRD',
        },
        {
          id: 'assign2',
          actionId: 16160, // 光之心（不互斥）
          damageEventId: 'event1',
          time: 12,
          job: 'GNB',
        },
      ]

      const effects = calculator.getActiveEffects(15, assignments, nonMutualActions)

      expect(effects.length).toBe(2) // 两个技能都生效
      expect(effects.map(e => e.actionId).sort()).toEqual([7405, 16160].sort())
    })

    it('同一技能的多次使用应该互斥', () => {
      const calculator = new MitigationCalculator(actions)

      const sameActionTwice: MitigationAction[] = [
        {
          id: 24310,
          name: '整体论',
          icon: '/icon.png',
          jobs: ['SGE'],
          uniqueGroup: [24310], // 与自己互斥
          physicReduce: 10,
          magicReduce: 10,
          barrier: 17300,
          duration: 20,
          cooldown: 120,
        },
      ]

      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          actionId: 24310, // 整体论1，5秒生效
          damageEventId: 'event1',
          time: 5,
          job: 'SGE',
        },
        {
          id: 'assign2',
          actionId: 24310, // 整体论2，8秒生效（更晚）
          damageEventId: 'event1',
          time: 8,
          job: 'SGE',
        },
      ]

      // 在 9 秒时，两个整体论都在持续时间内（5-25s 和 8-28s）
      // 但整体论2更晚生效，应该覆盖整体论1
      const effects = calculator.getActiveEffects(9, assignments, sameActionTwice)

      expect(effects.length).toBe(1)
      expect(effects[0].assignmentId).toBe('assign2') // 只保留整体论2
    })
  })
})
