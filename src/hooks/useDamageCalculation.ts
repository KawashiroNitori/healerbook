/**
 * 伤害计算 Hook V2（基于状态）
 * 使用新的状态系统计算减伤效果
 */

import { useMemo } from 'react'
import { MitigationCalculator, type CalculationResult } from '@/utils/mitigationCalculator'
import type { Timeline } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'
import type { ActionExecutionContext } from '@/types/mitigation'
import { useTimelineStore } from '@/store/timelineStore'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { calculatePercentile } from '@/utils/stats'

/**
 * 计算时间轴上所有伤害事件的减伤结果
 *
 * 编辑模式：单次时间轴扫描，使用 calculate()
 * 回放模式：直接从 PlayerDamageDetail.statuses 计算
 */
export function useDamageCalculation(timeline: Timeline | null): Map<string, CalculationResult> {
  const partyState = useTimelineStore(state => state.partyState)

  return useMemo(() => {
    const results = new Map<string, CalculationResult>()

    if (!timeline) return results

    const calculator = new MitigationCalculator()

    if (timeline.isReplayMode) {
      // 回放模式：直接使用 PlayerDamageDetail.statuses
      for (const event of timeline.damageEvents) {
        // 死刑不参与团减计算
        if (event.type === 'tankbuster') continue

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
          const medianFinalDamage = calculatePercentile(playerResults.map(r => r.finalDamage))
          const maxDamage = Math.max(...playerResults.map(r => r.originalDamage))

          results.set(event.id, {
            originalDamage: event.damage,
            finalDamage: medianFinalDamage,
            maxDamage,
            mitigationPercentage: medianMitigation,
            appliedStatuses: [],
          })
        }
      }

      return results
    }

    // 编辑模式：使用 PartyState，单次时间轴扫描
    if (!partyState) return results

    const referenceMaxHP = timeline.statData?.referenceMaxHP ?? 100000
    const sortedDamageEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)
    const sortedCastEvents = [...(timeline.castEvents || [])].sort(
      (a, b) => a.timestamp - b.timestamp
    )

    let currentState: PartyState = {
      players: [...partyState.players],
      statuses: [],
      timestamp: 0,
    }

    let castIdx = 0

    for (const event of sortedDamageEvents) {
      // 应用所有在此伤害事件之前的技能
      while (
        castIdx < sortedCastEvents.length &&
        sortedCastEvents[castIdx].timestamp <= event.time
      ) {
        const castEvent = sortedCastEvents[castIdx]
        const action = MITIGATION_DATA.actions.find(a => a.id === castEvent.actionId)
        if (action) {
          // 传给 executor 前清理已过期的状态
          currentState = {
            ...currentState,
            statuses: currentState.statuses.filter(s => s.endTime >= castEvent.timestamp),
          }
          const ctx: ActionExecutionContext = {
            actionId: castEvent.actionId,
            useTime: castEvent.timestamp,
            partyState: currentState,
            sourcePlayerId: castEvent.playerId,
            statistics: timeline.statData ?? undefined,
          }
          if (action.executor) currentState = action.executor(ctx)
        }
        castIdx++
      }

      // 传给 calculate 前清理已过期的状态
      currentState = {
        ...currentState,
        statuses: currentState.statuses.filter(s => s.endTime >= event.time),
      }

      // 死刑不参与团减计算，但状态步进仍需正常执行
      if (event.type === 'tankbuster') continue

      const result = calculator.calculate(
        event.damage,
        currentState,
        event.time,
        event.damageType || 'physical'
      )

      results.set(event.id, { ...result, referenceMaxHP })
      // updatedPartyState 一定存在（编辑模式下 calculate 总会返回它）
      if (result.updatedPartyState) {
        currentState = result.updatedPartyState
      }
    }

    return results
  }, [timeline, partyState])
}
