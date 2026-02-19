/**
 * 减伤计算器单元测试
 */

import { describe, it, expect } from 'vitest'
import { MitigationCalculator } from './mitigationCalculator'
import type { MitigationEffect, MitigationAction } from '@/types/mitigation'
import type { MitigationAssignment } from '@/types/timeline'

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
      },
      {
        id: 'assign2',
        actionId: 2001,
        damageEventId: 'event1',
        time: 15,
        job: 'SCH',
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

      const result = calculator.validateCooldown(assignments, actions)

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

      const result = calculator.validateCooldown(assignments, actions)

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

      const result = calculator.canUseActionAt(1001, 10, assignments, actions)

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

      const result = calculator.canUseActionAt(1001, 130, assignments, actions)

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

      const result = calculator.canUseActionAt(1001, 60, assignments, actions)

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

      const nextTime = calculator.getNextAvailableTime(1001, 10, assignments, actions)

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

      const nextTime = calculator.getNextAvailableTime(1001, 50, assignments, actions)

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

      const nextTime = calculator.getNextAvailableTime(1001, 130, assignments, actions)

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
      const result1 = calculator.calculate(3000, effects, 'physical', true)
      expect(result1.finalDamage).toBe(0) // 3000 - 5000 = 0
      expect(result1.appliedEffects[0].remainingBarrierAfter).toBe(2000) // 5000 - 3000 = 2000

      // 第二次伤害：3000（使用相同的 effects）
      const result2 = calculator.calculate(3000, effects, 'physical', true)
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
      const result1 = calculator.calculate(6000, effects, 'physical', true)
      expect(result1.finalDamage).toBe(1000) // 6000 - 5000 = 1000
      expect(result1.appliedEffects[0].remainingBarrierAfter).toBe(0)

      // 第二次伤害：3000（盾值已耗尽）
      const result2 = calculator.calculate(3000, effects, 'physical', true)
      expect(result2.finalDamage).toBe(3000) // 无盾值，全额伤害
    })

    it('不消耗盾值时应保持剩余量不变', () => {
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

      // 预览模式：不消耗盾值
      const result1 = calculator.calculate(3000, effects, 'physical', false)
      expect(result1.finalDamage).toBe(0)
      expect(result1.appliedEffects[0].remainingBarrierAfter).toBe(5000) // 未消耗

      // 再次预览
      const result2 = calculator.calculate(3000, effects, 'physical', false)
      expect(result2.finalDamage).toBe(0)
      expect(result2.appliedEffects[0].remainingBarrierAfter).toBe(5000) // 仍未消耗
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

    it('三个互斥技能只保留最后生效的', () => {
      const calculator = new MitigationCalculator(actions)

      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          actionId: 7405, // 行吟，10秒
          damageEventId: 'event1',
          time: 10,
          job: 'BRD',
        },
        {
          id: 'assign2',
          actionId: 16889, // 策动，15秒
          damageEventId: 'event1',
          time: 15,
          job: 'MCH',
        },
        {
          id: 'assign3',
          actionId: 16012, // 防守之桑巴，20秒
          damageEventId: 'event1',
          time: 20,
          job: 'DNC',
        },
      ]

      // 在 22 秒时，三个技能都在持续时间内
      // 但只保留最后生效的防守之桑巴
      const effects = calculator.getActiveEffects(22, assignments, actions)

      expect(effects.length).toBe(1)
      expect(effects[0].actionId).toBe(16012) // 只保留防守之桑巴
    })
  })
})
