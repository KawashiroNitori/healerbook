/**
 * 伤害计算 Hook V2（基于状态，worker 异步）
 *
 * 编辑模式：通过 CalculatorWorkerClient 异步跑 simulate，stale-while-revalidate
 * 回放模式：直接从 PlayerDamageDetail.statuses 同步计算
 */

import { useEffect, useMemo, useState } from 'react'
import type { CalculationResult } from '@/utils/mitigationCalculator'
import type { Timeline } from '@/types/timeline'
import type { StatusInterval } from '@/types/status'
import type { HealSnapshot } from '@/types/healSnapshot'
import type { HpTimelinePoint } from '@/types/hpTimeline'
import { useTimelineStore } from '@/store/timelineStore'
import { calculatePercentile } from '@/utils/stats'
import { resolveStatData } from '@/utils/statDataUtils'
import { getJobRole } from '@/data/jobs'
import { CalculatorWorkerClient } from '@/web-workers/calculator/client'
import CalculatorWorker from '@/web-workers/calculator/index?worker'

export type StatusTimelineByPlayer = Map<number, Map<number, StatusInterval[]>>

export interface DamageCalculationResult {
  results: Map<string, CalculationResult>
  statusTimelineByPlayer: StatusTimelineByPlayer
  castEffectiveEndByCastEventId: Map<string, number>
  healSnapshots: HealSnapshot[]
  hpTimeline: HpTimelinePoint[]
  /** 预算好的"假装某 cast 不存在"的 status timeline 表，供 PlacementEngine 同步查表 */
  removalTimelinesByExcludeId: Map<string, StatusTimelineByPlayer>
  /** worker 路径下首次 simulate 在飞行时为 true；用于 UI 可选淡化态 */
  isPending: boolean
}

const EMPTY_RESULT: DamageCalculationResult = {
  results: new Map(),
  statusTimelineByPlayer: new Map(),
  castEffectiveEndByCastEventId: new Map(),
  healSnapshots: [],
  hpTimeline: [],
  removalTimelinesByExcludeId: new Map(),
  isPending: false,
}

/**
 * Worker client 单例。导出供测试注入替换。
 */
export let workerClient = new CalculatorWorkerClient(() => new CalculatorWorker())

/** 测试用：注入 mock client */
export function __setWorkerClientForTesting(client: CalculatorWorkerClient) {
  workerClient = client
}

export interface UseDamageCalculationOptions {
  /** 额外按 excludeId 派生的 timeline 集合；通常是 [selectedCastEventId, draggingId] */
  extraExcludeIds?: string[]
}

export function useDamageCalculation(
  timeline: Timeline | null,
  options: UseDamageCalculationOptions = {}
): DamageCalculationResult {
  const partyState = useTimelineStore(state => state.partyState)
  const statistics = useTimelineStore(state => state.statistics)
  const { extraExcludeIds = [] } = options

  // 字符串化作 effect dep key——内容是真依赖；数组身份每帧都新，依赖字符串比较自然稳定。
  // useMemo 在此为冗余（每帧重算），直接同步计算更简洁。
  const extraExcludeIdsKey = [...new Set(extraExcludeIds)].sort().join(',')

  // 是否走 worker 异步路径：回放 / 无 timeline / 无 partyState 都是同步派生路径
  const useWorker = !!timeline && !timeline.isReplayMode && !!partyState

  const [workerState, setWorkerState] = useState<DamageCalculationResult>(EMPTY_RESULT)

  useEffect(() => {
    if (!useWorker || !timeline || !partyState) return

    const resolved = resolveStatData(timeline.statData, statistics, timeline.composition)
    const tankPlayerIds = timeline.composition.players
      .filter(p => getJobRole(p.job) === 'tank')
      .map(p => p.id)

    const input = {
      castEvents: timeline.castEvents || [],
      damageEvents: timeline.damageEvents,
      initialState: partyState,
      statistics: resolved,
      tankPlayerIds,
      baseReferenceMaxHPForTank: resolved.tankReferenceMaxHP!,
      baseReferenceMaxHPForAoe: resolved.referenceMaxHP!,
    }

    const ids = extraExcludeIdsKey.split(',').filter(Boolean)
    let cancelled = false
    // pending flag 走 microtask 设置——避开 react-hooks/set-state-in-effect 的同步限制，
    // 同时也不打断当前 commit；下一帧前 React 一定会处理这个 setState。
    queueMicrotask(() => {
      if (cancelled) return
      setWorkerState(s => (s.isPending ? s : { ...s, isPending: true }))
    })

    workerClient
      .simulate(input, ids)
      .then(bundle => {
        if (cancelled) return
        setWorkerState({
          results: bundle.main.damageResults,
          statusTimelineByPlayer: bundle.main.statusTimelineByPlayer,
          castEffectiveEndByCastEventId: bundle.main.castEffectiveEndByCastEventId,
          healSnapshots: bundle.main.healSnapshots,
          hpTimeline: bundle.main.hpTimeline,
          removalTimelinesByExcludeId: bundle.removalTimelinesByExcludeId,
          isPending: false,
        })
      })
      .catch(err => {
        if (cancelled) return
        console.error('[calculator-worker] simulate failed', err)
        setWorkerState(s => (s.isPending ? { ...s, isPending: false } : s))
      })

    return () => {
      cancelled = true
    }
  }, [useWorker, timeline, partyState, statistics, extraExcludeIdsKey])

  // 同步派生：回放 / 无 timeline / 无 partyState 不动 state，避免 setState-in-effect。
  // worker 路径返回 effect 维护的 workerState（stale-while-revalidate）。
  return useMemo(() => {
    if (!timeline) return EMPTY_RESULT
    if (timeline.isReplayMode) return computeReplayResult(timeline)
    if (!partyState) return buildEmptyForTimeline(timeline)
    return workerState
  }, [timeline, partyState, workerState])
}

/** 回放模式同步计算（保持原 useDamageCalculation 内部 isReplayMode 分支语义） */
function computeReplayResult(timeline: Timeline): DamageCalculationResult {
  const results = new Map<string, CalculationResult>()
  for (const event of timeline.damageEvents) {
    if (!event.playerDamageDetails || event.playerDamageDetails.length === 0) continue
    const playerResults: Array<{
      originalDamage: number
      finalDamage: number
      mitigationPercentage: number
    }> = []
    for (const detail of event.playerDamageDetails) {
      if (!detail.statuses || !Array.isArray(detail.statuses)) continue
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
      const medianMitigation = calculatePercentile(playerResults.map(r => r.mitigationPercentage))
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
  return { ...EMPTY_RESULT, results }
}

function buildEmptyForTimeline(timeline: Timeline): DamageCalculationResult {
  const results = new Map<string, CalculationResult>()
  for (const event of timeline.damageEvents) {
    results.set(event.id, {
      originalDamage: event.damage,
      finalDamage: event.damage,
      maxDamage: event.damage,
      mitigationPercentage: 0,
      appliedStatuses: [],
    })
  }
  return { ...EMPTY_RESULT, results }
}
