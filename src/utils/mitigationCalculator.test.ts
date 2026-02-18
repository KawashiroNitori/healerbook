/**
 * 减伤计算器单元测试
 */

import { describe, it, expect } from 'vitest'
import { MitigationCalculator } from './mitigationCalculator'
import type { MitigationEffect, MitigationSkill } from '@/types/mitigation'
import type { MitigationAssignment } from '@/types/timeline'

describe('MitigationCalculator', () => {
  const calculator = new MitigationCalculator()

  describe('calculate', () => {
    it('应该正确计算单个百分比减伤', () => {
      const effects: MitigationEffect[] = [
        {
          type: 'non_target_percentage',
          value: 10,
          startTime: 0,
          endTime: 20,
          skillId: 'test_skill',
          job: 'WHM',
        },
      ]

      const result = calculator.calculate(10000, effects)

      expect(result.originalDamage).toBe(10000)
      expect(result.finalDamage).toBe(9000) // 10000 * (1 - 0.1) = 9000
      expect(result.mitigationPercentage).toBe(10)
      expect(result.appliedEffects).toHaveLength(1)
    })

    it('应该正确计算多个百分比减伤（乘算）', () => {
      const effects: MitigationEffect[] = [
        {
          type: 'target_percentage',
          value: 10,
          startTime: 0,
          endTime: 20,
          skillId: 'skill1',
          job: 'WHM',
        },
        {
          type: 'non_target_percentage',
          value: 5,
          startTime: 0,
          endTime: 20,
          skillId: 'skill2',
          job: 'SCH',
        },
      ]

      const result = calculator.calculate(10000, effects)

      // 10000 * (1 - 0.1) * (1 - 0.05) = 8550
      expect(result.finalDamage).toBe(8550)
      expect(result.mitigationPercentage).toBeCloseTo(14.5)
    })

    it('应该正确计算盾值减伤', () => {
      const effects: MitigationEffect[] = [
        {
          type: 'shield',
          value: 1000,
          startTime: 0,
          endTime: 30,
          skillId: 'shield_skill',
          job: 'SCH',
        },
      ]

      const result = calculator.calculate(10000, effects)

      expect(result.finalDamage).toBe(9000) // 10000 - 1000 = 9000
      expect(result.mitigationPercentage).toBe(10)
    })

    it('应该正确计算百分比减伤和盾值减伤的组合', () => {
      const effects: MitigationEffect[] = [
        {
          type: 'non_target_percentage',
          value: 10,
          startTime: 0,
          endTime: 20,
          skillId: 'skill1',
          job: 'WHM',
        },
        {
          type: 'shield',
          value: 1000,
          startTime: 0,
          endTime: 30,
          skillId: 'skill2',
          job: 'SCH',
        },
      ]

      const result = calculator.calculate(10000, effects)

      // 10000 * (1 - 0.1) - 1000 = 8000
      expect(result.finalDamage).toBe(8000)
      expect(result.mitigationPercentage).toBe(20)
    })

    it('盾值超过伤害时，最终伤害应为 0', () => {
      const effects: MitigationEffect[] = [
        {
          type: 'shield',
          value: 15000,
          startTime: 0,
          endTime: 30,
          skillId: 'big_shield',
          job: 'SCH',
        },
      ]

      const result = calculator.calculate(10000, effects)

      expect(result.finalDamage).toBe(0)
      expect(result.mitigationPercentage).toBe(100)
    })
  })

  describe('getActiveEffects', () => {
    const skills: MitigationSkill[] = [
      {
        id: 'skill1',
        name: '节制',
        nameEn: 'Temperance',
        icon: '/icon.png',
        job: 'WHM',
        type: 'non_target_percentage',
        value: 10,
        duration: 20,
        cooldown: 120,
        description: '测试技能',
        isPartyWide: true,
      },
      {
        id: 'skill2',
        name: '鼓舞',
        nameEn: 'Adloquium',
        icon: '/icon.png',
        job: 'SCH',
        type: 'shield',
        value: 500,
        duration: 30,
        cooldown: 2.5,
        description: '测试技能',
        isPartyWide: false,
      },
    ]

    const assignments: MitigationAssignment[] = [
      {
        id: 'assign1',
        skillId: 'skill1',
        damageEventId: 'event1',
        time: 10,
        job: 'WHM',
      },
      {
        id: 'assign2',
        skillId: 'skill2',
        damageEventId: 'event1',
        time: 15,
        job: 'SCH',
      },
    ]

    it('应该返回指定时间点生效的技能', () => {
      // 时间点 20: skill1 (10-30) 生效, skill2 (15-45) 生效
      const effects = calculator.getActiveEffects(20, assignments, skills)

      expect(effects).toHaveLength(2)
      expect(effects[0].skillId).toBe('skill1')
      expect(effects[1].skillId).toBe('skill2')
    })

    it('技能未生效时应返回空数组', () => {
      // 时间点 5: 所有技能都未生效
      const effects = calculator.getActiveEffects(5, assignments, skills)

      expect(effects).toHaveLength(0)
    })

    it('技能过期后不应返回', () => {
      // 时间点 50: 所有技能都已过期
      const effects = calculator.getActiveEffects(50, assignments, skills)

      expect(effects).toHaveLength(0)
    })
  })

  describe('validateCooldown', () => {
    const skills: MitigationSkill[] = [
      {
        id: 'skill1',
        name: '节制',
        nameEn: 'Temperance',
        icon: '/icon.png',
        job: 'WHM',
        type: 'non_target_percentage',
        value: 10,
        duration: 20,
        cooldown: 120,
        description: '测试技能',
        isPartyWide: true,
      },
    ]

    it('CD 充足时应验证通过', () => {
      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          skillId: 'skill1',
          damageEventId: 'event1',
          time: 0,
          job: 'WHM',
        },
        {
          id: 'assign2',
          skillId: 'skill1',
          damageEventId: 'event2',
          time: 130,
          job: 'WHM',
        },
      ]

      const result = calculator.validateCooldown(assignments, skills)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('CD 不足时应验证失败', () => {
      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          skillId: 'skill1',
          damageEventId: 'event1',
          time: 0,
          job: 'WHM',
        },
        {
          id: 'assign2',
          skillId: 'skill1',
          damageEventId: 'event2',
          time: 50,
          job: 'WHM',
        },
      ]

      const result = calculator.validateCooldown(assignments, skills)

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].skillId).toBe('skill1')
      expect(result.errors[0].conflictingAssignments).toEqual(['assign1', 'assign2'])
    })
  })

  describe('canUseSkillAt', () => {
    const skills: MitigationSkill[] = [
      {
        id: 'skill1',
        name: '节制',
        nameEn: 'Temperance',
        icon: '/icon.png',
        job: 'WHM',
        type: 'non_target_percentage',
        value: 10,
        duration: 20,
        cooldown: 120,
        description: '测试技能',
        isPartyWide: true,
      },
    ]

    it('首次使用时应该可用', () => {
      const assignments: MitigationAssignment[] = []

      const result = calculator.canUseSkillAt('skill1', 10, assignments, skills)

      expect(result.canUse).toBe(true)
    })

    it('CD 就绪后应该可用', () => {
      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          skillId: 'skill1',
          damageEventId: 'event1',
          time: 0,
          job: 'WHM',
        },
      ]

      const result = calculator.canUseSkillAt('skill1', 130, assignments, skills)

      expect(result.canUse).toBe(true)
    })

    it('CD 未就绪时不应该可用', () => {
      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          skillId: 'skill1',
          damageEventId: 'event1',
          time: 0,
          job: 'WHM',
        },
      ]

      const result = calculator.canUseSkillAt('skill1', 50, assignments, skills)

      expect(result.canUse).toBe(false)
      expect(result.reason).toContain('CD 未就绪')
    })
  })

  describe('getNextAvailableTime', () => {
    const skills: MitigationSkill[] = [
      {
        id: 'skill1',
        name: '节制',
        nameEn: 'Temperance',
        icon: '/icon.png',
        job: 'WHM',
        type: 'non_target_percentage',
        value: 10,
        duration: 20,
        cooldown: 120,
        description: '测试技能',
        isPartyWide: true,
      },
    ]

    it('首次使用时应返回当前时间', () => {
      const assignments: MitigationAssignment[] = []

      const nextTime = calculator.getNextAvailableTime('skill1', 10, assignments, skills)

      expect(nextTime).toBe(10)
    })

    it('应该返回 CD 结束后的时间', () => {
      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          skillId: 'skill1',
          damageEventId: 'event1',
          time: 0,
          job: 'WHM',
        },
      ]

      const nextTime = calculator.getNextAvailableTime('skill1', 50, assignments, skills)

      expect(nextTime).toBe(120) // 0 + 120
    })

    it('CD 已就绪时应返回当前时间', () => {
      const assignments: MitigationAssignment[] = [
        {
          id: 'assign1',
          skillId: 'skill1',
          damageEventId: 'event1',
          time: 0,
          job: 'WHM',
        },
      ]

      const nextTime = calculator.getNextAvailableTime('skill1', 130, assignments, skills)

      expect(nextTime).toBe(130)
    })
  })
})
