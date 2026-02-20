/**
 * 伤害计算 Hook
 * 统一管理时间轴上所有伤害事件的减伤计算
 */

import { useMemo } from 'react'
import { MitigationCalculator, type CalculationResult } from '@/utils/mitigationCalculator'
import type { Timeline } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

/**
 * 计算时间轴上所有伤害事件的减伤结果
 * 按时间顺序处理，正确消耗盾值
 */
export function useDamageCalculation(
  timeline: Timeline | null,
  actions: MitigationAction[]
): Map<string, CalculationResult> {
  return useMemo(() => {
    const results = new Map<string, CalculationResult>()

    if (!timeline) return results

    // 创建计算器实例
    const calculator = new MitigationCalculator(actions)
    calculator.resetBarrierState()

    // 按时间排序伤害事件
    const sortedEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)

    // 按顺序计算每个事件的结果
    for (const event of sortedEvents) {
      const activeEffects = calculator.getActiveEffects(
        event.time,
        timeline.mitigationAssignments,
        actions
      )
      const result = calculator.calculate(
        event.damage,
        activeEffects,
        event.damageType || 'physical'
      )
      results.set(event.id, result)
    }

    return results
  }, [timeline, actions])
}
