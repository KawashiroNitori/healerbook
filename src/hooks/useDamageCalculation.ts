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
import { getStatusById } from '@/utils/statusRegistry'

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
          // 防御性检查：确保 statuses 存在且是数组
          if (!detail.statuses || !Array.isArray(detail.statuses)) {
            continue
          }

          // 计算百分比减伤
          let multiplier = 1.0
          for (const snapshot of detail.statuses) {
            const statusMeta = getStatusById(snapshot.statusId)
            if (!statusMeta || statusMeta.type !== 'multiplier') continue

            // 根据伤害类型获取减伤倍率
            const damageType = event.damageType || 'physical'
            let damageMultiplier = 1.0
            if (damageType === 'physical') {
              damageMultiplier = 1 - statusMeta.performance.physics
            } else if (damageType === 'magical') {
              damageMultiplier = 1 - statusMeta.performance.magic
            } else {
              damageMultiplier = 1 - statusMeta.performance.darkness
            }

            multiplier *= damageMultiplier
          }

          let damage = detail.unmitigatedDamage * multiplier

          // 计算盾值减伤
          const shieldSnapshots = detail.statuses.filter(s => s.absorb && s.absorb > 0)
          for (const snapshot of shieldSnapshots) {
            const absorbed = Math.min(damage, snapshot.absorb!)
            damage -= absorbed
            if (damage <= 0) break
          }

          const finalDamage = Math.max(0, Math.round(damage))
          const mitigationPercentage =
            detail.unmitigatedDamage > 0
              ? ((detail.unmitigatedDamage - finalDamage) / detail.unmitigatedDamage) * 100
              : 0

          playerResults.push({
            originalDamage: detail.unmitigatedDamage,
            finalDamage,
            mitigationPercentage,
          })
        }

        // 使用平均减伤率作为事件的整体减伤结果
        if (playerResults.length > 0) {
          const avgMitigation =
            playerResults.reduce((sum, r) => sum + r.mitigationPercentage, 0) / playerResults.length
          const avgFinalDamage =
            playerResults.reduce((sum, r) => sum + r.finalDamage, 0) / playerResults.length

          results.set(event.id, {
            originalDamage: event.damage,
            finalDamage: Math.round(avgFinalDamage),
            mitigationPercentage: Math.round(avgMitigation * 10) / 10,
            appliedStatuses: [],
          })
        }
      }

      return results
    }

    // 编辑模式：使用 PartyState，单次时间轴扫描
    if (!partyState) return results

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
            statistics: statistics ?? undefined,
          }
          currentState = action.executor(ctx)
        }
        castIdx++
      }

      // 传给 calculate 前清理已过期的状态
      currentState = {
        ...currentState,
        statuses: currentState.statuses.filter(s => s.endTime >= event.time),
      }

      const result = calculator.calculate(
        event.damage,
        currentState,
        event.time,
        event.damageType || 'physical'
      )

      results.set(event.id, result)
      // updatedPartyState 一定存在（编辑模式下 calculate 总会返回它）
      if (result.updatedPartyState) {
        currentState = result.updatedPartyState
      }
    }

    return results
  }, [timeline, partyState, statistics])
}
