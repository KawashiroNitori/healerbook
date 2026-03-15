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
 * 单次时间轴顺序扫描：将 castEvents 和 damageEvents 按时间合并处理，
 * 维护递增的 PartyState，复杂度 O((N+M)log(N+M))，避免对每个伤害事件
 * 单独重放所有 castEvents（原来的 O(N×M)）。
 */
export function useDamageCalculationV2(timeline: Timeline | null): Map<string, CalculationResult> {
  const partyState = useTimelineStore(state => state.partyState)

  return useMemo(() => {
    const results = new Map<string, CalculationResult>()

    if (!timeline || !partyState) return results

    // 编辑模式：单次扫描
    if (!timeline.isReplayMode) {
      const calculator = new MitigationCalculator()

      // 按时间排序伤害事件
      const sortedDamageEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)

      // 按时间排序技能使用事件
      const sortedCastEvents = [...(timeline.castEvents || [])].sort(
        (a, b) => a.timestamp - b.timestamp
      )

      // 从空状态开始（不带已有状态，纯净重放）
      let currentState: PartyState = {
        players: partyState.players.map(p => ({ ...p, statuses: [] })),
        enemy: { statuses: [] },
        timestamp: 0,
      }

      let castIdx = 0

      for (const event of sortedDamageEvents) {
        // 将时间线上位于此伤害事件之前的所有技能全部应用
        while (
          castIdx < sortedCastEvents.length &&
          sortedCastEvents[castIdx].timestamp <= event.time
        ) {
          const castEvent = sortedCastEvents[castIdx]
          const action = MITIGATION_DATA.actions.find(a => a.id === castEvent.actionId)
          if (action) {
            const context: ActionExecutionContext = {
              actionId: castEvent.actionId,
              useTime: castEvent.timestamp,
              partyState: currentState,
              sourcePlayerId: castEvent.playerId,
            }
            currentState = action.executor(context)
          }
          castIdx++
        }

        // 过滤掉在此时刻已过期的状态，得到当前时刻的 PartyState
        const stateAtTime: PartyState = {
          ...currentState,
          players: currentState.players.map(p => ({
            ...p,
            statuses: p.statuses.filter(s => s.endTime >= event.time),
          })),
          enemy: {
            statuses: currentState.enemy.statuses.filter(s => s.endTime >= event.time),
          },
          timestamp: event.time,
        }

        const result = calculator.calculate(
          event.damage,
          stateAtTime,
          event.time,
          event.damageType || 'physical',
          event.targetPlayerId
        )

        results.set(event.id, result)
      }

      return results
    }

    // 回放模式：保留原有逻辑（通过 store 获取）
    const { getPartyStateAtTime } = useTimelineStore.getState()
    const calculator = new MitigationCalculator()
    const sortedEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)

    for (const event of sortedEvents) {
      const state = getPartyStateAtTime(event.time, event.packetId)
      if (!state) {
        results.set(event.id, {
          originalDamage: event.damage,
          finalDamage: event.damage,
          mitigationPercentage: 0,
          appliedStatuses: [],
          updatedPartyState: state!,
        })
        continue
      }

      const result = calculator.calculate(
        event.damage,
        state,
        event.time,
        event.damageType || 'physical',
        event.targetPlayerId
      )
      results.set(event.id, result)
    }

    return results
  }, [timeline, partyState])
}
