/**
 * 伤害计算 Hook V2（基于状态）
 * 使用新的状态系统计算减伤效果
 */

import { useMemo } from 'react'
import { MitigationCalculator, type CalculationResult } from '@/utils/mitigationCalculator'
import type { Timeline } from '@/types/timeline'
import { useTimelineStore } from '@/store/timelineStore'
import { calculatePercentile } from '@/utils/stats'
import { resolveStatData } from '@/utils/statDataUtils'
import { getJobRole } from '@/data/jobs'

/**
 * 计算时间轴上所有伤害事件的减伤结果
 *
 * 编辑模式：单次时间轴扫描，使用 calculate()
 * 回放模式：直接从 PlayerDamageDetail.statuses 计算
 */
export function useDamageCalculation(timeline: Timeline | null): Map<string, CalculationResult> {
  const partyState = useTimelineStore(state => state.partyState)
  const statistics = useTimelineStore(state => state.statistics)

  return useMemo(() => {
    const results = new Map<string, CalculationResult>()

    if (!timeline) return results

    const calculator = new MitigationCalculator()

    if (timeline.isReplayMode) {
      // 回放模式：直接使用 PlayerDamageDetail.statuses
      for (const event of timeline.damageEvents) {
        if (!event.playerDamageDetails || event.playerDamageDetails.length === 0) {
          continue
        }

        // 计算每个玩家的减伤结果
        const playerResults: Array<{
          originalDamage: number
          finalDamage: number
          mitigationPercentage: number
        }> = []

        for (const detail of event.playerDamageDetails) {
          if (!detail.statuses || !Array.isArray(detail.statuses)) {
            continue
          }

          const mitigationPercentage =
            detail.unmitigatedDamage > 0
              ? ((detail.unmitigatedDamage - detail.finalDamage) / detail.unmitigatedDamage) * 100
              : 0

          playerResults.push({
            originalDamage: detail.unmitigatedDamage,
            finalDamage: detail.finalDamage,
            mitigationPercentage,
          })
        }

        // 使用中位数作为事件的整体减伤结果
        if (playerResults.length > 0) {
          const medianMitigation = calculatePercentile(
            playerResults.map(r => r.mitigationPercentage)
          )
          const maxFinalDamage = Math.max(...playerResults.map(r => r.finalDamage))
          const maxDamage = Math.max(...playerResults.map(r => r.originalDamage))

          results.set(event.id, {
            originalDamage: event.damage,
            finalDamage: maxFinalDamage,
            maxDamage,
            mitigationPercentage: medianMitigation,
            appliedStatuses: [],
          })
        }
      }

      return results
    }

    // 编辑模式：使用 PartyState，单次时间轴扫描
    if (!partyState) {
      // 无小队时产出 trivial 结果：不做减伤计算，但仍把原始伤害暴露给 UI
      // 覆盖场景：预填充的空白时间轴还未设置阵容，但 damageEvents 已经存在
      for (const event of timeline.damageEvents) {
        results.set(event.id, {
          originalDamage: event.damage,
          finalDamage: event.damage,
          maxDamage: event.damage,
          mitigationPercentage: 0,
          appliedStatuses: [],
        })
      }
      return results
    }

    const resolved = resolveStatData(timeline.statData, statistics, timeline.composition)
    const tankPlayerIds = timeline.composition.players
      .filter(p => getJobRole(p.job) === 'tank')
      .map(p => p.id)

    const { damageResults } = calculator.simulate({
      castEvents: timeline.castEvents || [],
      damageEvents: timeline.damageEvents,
      initialState: partyState,
      statistics: resolved,
      tankPlayerIds,
      baseReferenceMaxHPForTank: resolved.tankReferenceMaxHP!,
      baseReferenceMaxHPForAoe: resolved.referenceMaxHP!,
    })
    for (const [id, result] of damageResults) results.set(id, result)
    return results
  }, [timeline, partyState, statistics])
}
