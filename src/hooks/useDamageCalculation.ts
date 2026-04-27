/**
 * 伤害计算 Hook V2（基于状态）
 * 使用新的状态系统计算减伤效果
 */

import { useMemo } from 'react'
import { MitigationCalculator, type CalculationResult } from '@/utils/mitigationCalculator'
import type { CastEvent, Timeline } from '@/types/timeline'
import type { StatusInterval } from '@/types/status'
import type { HealSnapshot } from '@/types/healSnapshot'
import { useTimelineStore } from '@/store/timelineStore'
import { calculatePercentile } from '@/utils/stats'
import { resolveStatData } from '@/utils/statDataUtils'
import { getJobRole } from '@/data/jobs'

export type StatusTimelineByPlayer = Map<number, Map<number, StatusInterval[]>>

export interface DamageCalculationResult {
  results: Map<string, CalculationResult>
  statusTimelineByPlayer: StatusTimelineByPlayer
  /** castEvent.id → 该 cast 附着 instance 的实际收束时刻最大值（绿条末端用） */
  castEffectiveEndByCastEventId: Map<string, number>
  /** 治疗 snapshot（一次性 cast + HoT tick）按 time 升序 */
  healSnapshots: HealSnapshot[]
  /**
   * 与主路径共享 input（initialState/damageEvents/statistics/tankPlayerIds/baseRefMaxHP）的
   * simulate 回调。PlacementEngine 在处理 excludeCastEventId 时用它以过滤后的 castEvents 重放。
   * partyState 未就绪或回放模式下为 null。
   */
  simulate: ((castEvents: CastEvent[]) => { statusTimelineByPlayer: StatusTimelineByPlayer }) | null
}

/**
 * 计算时间轴上所有伤害事件的减伤结果
 *
 * 编辑模式：单次时间轴扫描，使用 calculator.simulate()
 * 回放模式：直接从 PlayerDamageDetail.statuses 计算
 */
export function useDamageCalculation(timeline: Timeline | null): DamageCalculationResult {
  const partyState = useTimelineStore(state => state.partyState)
  const statistics = useTimelineStore(state => state.statistics)

  return useMemo(() => {
    const results = new Map<string, CalculationResult>()
    const empty: DamageCalculationResult = {
      results,
      statusTimelineByPlayer: new Map(),
      castEffectiveEndByCastEventId: new Map(),
      healSnapshots: [],
      simulate: null,
    }

    if (!timeline) return empty

    const calculator = new MitigationCalculator()

    if (timeline.isReplayMode) {
      for (const event of timeline.damageEvents) {
        if (!event.playerDamageDetails || event.playerDamageDetails.length === 0) {
          continue
        }

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

      return empty
    }

    if (!partyState) {
      for (const event of timeline.damageEvents) {
        results.set(event.id, {
          originalDamage: event.damage,
          finalDamage: event.damage,
          maxDamage: event.damage,
          mitigationPercentage: 0,
          appliedStatuses: [],
        })
      }
      return empty
    }

    const resolved = resolveStatData(timeline.statData, statistics, timeline.composition)
    const tankPlayerIds = timeline.composition.players
      .filter(p => getJobRole(p.job) === 'tank')
      .map(p => p.id)

    const sharedInput = {
      damageEvents: timeline.damageEvents,
      initialState: partyState,
      statistics: resolved,
      tankPlayerIds,
      baseReferenceMaxHPForTank: resolved.tankReferenceMaxHP!,
      baseReferenceMaxHPForAoe: resolved.referenceMaxHP!,
    }

    const full = calculator.simulate({
      ...sharedInput,
      castEvents: timeline.castEvents || [],
    })
    for (const [id, result] of full.damageResults) results.set(id, result)

    const simulate = (castEvents: CastEvent[]) => {
      const out = calculator.simulate({ ...sharedInput, castEvents })
      return { statusTimelineByPlayer: out.statusTimelineByPlayer }
    }

    return {
      results,
      statusTimelineByPlayer: full.statusTimelineByPlayer,
      castEffectiveEndByCastEventId: full.castEffectiveEndByCastEventId,
      healSnapshots: full.healSnapshots,
      simulate,
    }
  }, [timeline, partyState, statistics])
}
