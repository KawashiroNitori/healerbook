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
import { resolveStatData } from '@/utils/statDataUtils'
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

    const TICK_INTERVAL = 3

    function advanceToTime(state: PartyState, prev: number, cur: number): PartyState {
      let next = state

      // 1) 全局 3s tick：对 prev < t <= cur 且 t % 3 === 0 的每个 t，触发活跃状态的 onTick
      const firstTick = Math.floor(prev / TICK_INTERVAL) * TICK_INTERVAL + TICK_INTERVAL
      for (let t = firstTick; t <= cur; t += TICK_INTERVAL) {
        // 对同一个 tick 点，内层 for-of 以这一 tick 开始时刻的 statuses 快照为迭代对象：
        //   ✓ onTick 返回的新 state 会立即影响该 tick 后续 status 读到的 ctx.partyState
        //   ✗ 但新添加的状态不会在同一 tick 立即被遍历到——它们要等下一 tick 才参与
        // 避免了"tick 内自触发"，也让每个 tick 点的 executor 调用次数可预测。
        for (const status of next.statuses) {
          if (status.startTime > t || status.endTime < t) continue
          const meta = getStatusById(status.statusId)
          if (!meta?.executor?.onTick) continue
          const result = meta.executor.onTick({
            status,
            tickTime: t,
            partyState: next,
          })
          if (result) next = result
        }
      }

      // 2) 到期清理：endTime < cur 的状态触发 onExpire 后被过滤
      for (const status of next.statuses) {
        if (status.endTime >= cur) continue
        const meta = getStatusById(status.statusId)
        if (!meta?.executor?.onExpire) continue
        const result = meta.executor.onExpire({
          status,
          expireTime: cur,
          partyState: next,
        })
        if (result) next = result
      }
      return {
        ...next,
        statuses: next.statuses.filter(s => s.endTime >= cur),
      }
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

    // 合并用户覆盖值 + statistics + 默认值
    const resolved = resolveStatData(timeline.statData, statistics, timeline.composition)
    const referenceMaxHP = resolved.referenceMaxHP!
    const tankReferenceMaxHP = resolved.tankReferenceMaxHP!
    const sortedDamageEvents = [...timeline.damageEvents].sort((a, b) => a.time - b.time)
    const sortedCastEvents = [...(timeline.castEvents || [])].sort(
      (a, b) => a.timestamp - b.timestamp
    )

    let currentState: PartyState = {
      statuses: [...partyState.statuses],
      timestamp: partyState.timestamp,
    }

    let lastAdvanceTime = 0
    let castIdx = 0

    for (const event of sortedDamageEvents) {
      const filterTime = event.snapshotTime ?? event.time

      // 应用所有在此伤害事件之前的技能
      while (
        castIdx < sortedCastEvents.length &&
        sortedCastEvents[castIdx].timestamp <= event.time
      ) {
        const castEvent = sortedCastEvents[castIdx]
        const action = MITIGATION_DATA.actions.find(a => a.id === castEvent.actionId)
        if (action) {
          // 传给 executor 前推进时间（触发 onTick / onExpire 并清理已过期状态）
          // 保留 DOT 快照兼容：推进到 cast 时间点和快照时间点的较早者，
          // 避免在 cast 时刻已过期但快照时刻仍需保留的 DOT 状态被提前清理
          const castAdvanceTarget = Math.min(castEvent.timestamp, filterTime)
          currentState = advanceToTime(currentState, lastAdvanceTime, castAdvanceTarget)
          lastAdvanceTime = castAdvanceTarget
          const ctx: ActionExecutionContext = {
            actionId: castEvent.actionId,
            useTime: castEvent.timestamp,
            partyState: currentState,
            sourcePlayerId: castEvent.playerId,
            statistics: resolved,
          }
          if (action.executor) currentState = action.executor(ctx)
        }
        castIdx++
      }

      // 传给 calculate 前推进时间（触发 onTick / onExpire 并清理已过期状态）
      currentState = advanceToTime(currentState, lastAdvanceTime, filterTime)
      lastAdvanceTime = filterTime

      const result = calculator.calculate(event, currentState)

      const eventReferenceMaxHP =
        event.type === 'tankbuster' || event.type === 'auto' ? tankReferenceMaxHP : referenceMaxHP

      results.set(event.id, { ...result, referenceMaxHP: eventReferenceMaxHP })
      // updatedPartyState 一定存在（编辑模式下 calculate 总会返回它）
      if (result.updatedPartyState) {
        currentState = result.updatedPartyState
      }
    }

    return results
  }, [timeline, partyState, statistics])
}
