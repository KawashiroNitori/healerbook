/**
 * 伤害计算 Hook V2（基于状态）
 * 使用新的状态系统计算减伤效果
 */

import { useMemo } from 'react'
import { MitigationCalculatorV2, type CalculationResult } from '@/utils/mitigationCalculator.v2'
import type { Timeline } from '@/types/timeline'
import { useTimelineStore } from '@/store/timelineStore'

/**
 * 计算时间轴上所有伤害事件的减伤结果
 * 使用 PartyState 和状态系统
 */
export function useDamageCalculationV2(timeline: Timeline | null): Map<string, CalculationResult> {
  const getPartyStateAtTime = useTimelineStore((state) => state.getPartyStateAtTime)

  return useMemo(() => {
    const results = new Map<string, CalculationResult>()

    if (!timeline) return results

    // 创建计算器实例
    const calculator = new MitigationCalculatorV2()

    // 按时间排序伤害事件
    const sortedEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)

    // 按顺序计算每个事件的结果
    for (const event of sortedEvents) {
      // 获取事件发生时的小队状态
      const partyState = getPartyStateAtTime(event.time)
      if (!partyState) {
        // 如果没有状态，返回原始伤害
        results.set(event.id, {
          originalDamage: event.damage,
          finalDamage: event.damage,
          mitigationPercentage: 0,
          appliedStatuses: [],
          updatedPartyState: partyState!,
        })
        continue
      }

      // 计算减伤
      const result = calculator.calculate(
        event.damage,
        partyState,
        event.time,
        event.damageType || 'physical',
        event.targetPlayerId
      )

      results.set(event.id, result)
    }

    return results
  }, [timeline, getPartyStateAtTime])
}
