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

/**
 * 计算时间轴上所有伤害事件的减伤结果
 *
 * 编辑模式：单次时间轴扫描，使用 calculate()
 * 回放模式：直接从 StatusEvent[] 计算，使用 calculateFromSnapshot()
 */
export function useDamageCalculation(timeline: Timeline | null): Map<string, CalculationResult> {
  const partyState = useTimelineStore(state => state.partyState)
  const statistics = useTimelineStore(state => state.statistics)

  return useMemo(() => {
    const results = new Map<string, CalculationResult>()

    if (!timeline) return results

    const calculator = new MitigationCalculator()

    // 编辑模式：使用 PartyState，单次时间轴扫描
    if (!timeline.isReplayMode) {
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
    }

    // 回放模式：直接从 StatusEvent[] 计算，无需 PartyState
    if (!timeline.statusEvents) return results

    const sortedDamageEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)

    for (const event of sortedDamageEvents) {
      if (!event.packetId) {
        results.set(event.id, {
          originalDamage: event.damage,
          finalDamage: event.damage,
          mitigationPercentage: 0,
          appliedStatuses: [],
        })
        continue
      }

      // 取第一个受击玩家作为代表（非坦克优先，与 parseDamageEvents 逻辑一致）
      const targetPlayerId = event.playerDamageDetails?.[0]?.playerId ?? 0

      const result = calculator.calculateFromSnapshot(
        event.damage,
        timeline.statusEvents,
        event.packetId,
        event.damageType || 'physical',
        targetPlayerId
      )

      results.set(event.id, result)
    }

    return results
  }, [timeline, partyState, statistics])
}
