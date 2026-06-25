import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTimelineStore } from '@/store/timelineStore'
import { workerClient } from '@/hooks/useDamageCalculation'
import { OptimizeCancelledError } from '@/web-workers/calculator/client'
import { resolveStatData } from '@/utils/statDataUtils'
import type { OptimizeWireInput } from '@/web-workers/calculator/types'
import type { OptimizeProgress } from '@/utils/autoMitigation'
import type { Timeline } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'
import type { EncounterStatistics } from '@/types/mitigation'

/**
 * 纯函数：组装 worker 用的 OptimizeWireInput（不含 actions —— worker 内自建）。
 *
 * `resolveStatData` 始终返回有值的 referenceMaxHP / tankReferenceMaxHP
 * （最低兜底 100000），故无需 undefined 保护。
 */
export function buildOptimizeWireInput(
  timeline: Timeline,
  partyState: PartyState,
  statistics: EncounterStatistics | null
): OptimizeWireInput {
  const resolved = resolveStatData(timeline.statData, statistics, timeline.composition)
  return {
    damageEvents: timeline.damageEvents,
    lockedCastEvents: timeline.castEvents ?? [],
    composition: timeline.composition,
    initialState: partyState,
    statistics: resolved,
    baseReferenceMaxHPForAoe: resolved.referenceMaxHP!,
    baseReferenceMaxHPForTank: resolved.tankReferenceMaxHP!,
    options: { timeBudgetMs: 2000, seed: 1 },
  }
}

export interface UseAutoMitigate {
  isOptimizing: boolean
  /** 实时进度（仅运行中非空）。 */
  progress: OptimizeProgress | null
  run: () => Promise<void>
  /** 取消进行中的优化（terminate worker）。 */
  cancel: () => void
}

export function useAutoMitigate(): UseAutoMitigate {
  const [isOptimizing, setOptimizing] = useState(false)
  const [progress, setProgress] = useState<OptimizeProgress | null>(null)
  const cancelledRef = useRef(false)

  const cancel = useCallback(() => {
    cancelledRef.current = true
    workerClient.cancelOptimize()
  }, [])

  const run = useCallback(async () => {
    // 读取当前 timeline（store 派生字段 yDocProjection ?? snapshot）
    const state = useTimelineStore.getState()
    const timeline = state.timeline
    const partyState = state.partyState
    const statistics = state.statistics

    if (!timeline || !partyState) return

    if (timeline.damageEvents.length === 0) {
      toast.info('当前时间轴没有伤害事件，无法自动规划减伤')
      return
    }

    const wire = buildOptimizeWireInput(timeline, partyState, statistics)

    cancelledRef.current = false
    setProgress(null)
    setOptimizing(true)
    try {
      const out = await workerClient.optimize(wire, setProgress)

      if (out.addedCastEvents.length === 0) {
        toast.info('未找到可进一步降低伤害的方案')
        return
      }

      // strip id — addCastEventsBatch 会重新生成
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      state.addCastEventsBatch(out.addedCastEvents.map(({ id: _, ...rest }) => rest))
      toast.success(`已自动放置 ${out.summary.castsAdded} 个减伤`)
    } catch (e) {
      // 用户取消：静默（不弹 toast）；仅真实失败才提示
      if (!(e instanceof OptimizeCancelledError) && !cancelledRef.current) {
        toast.error('自动减伤失败：' + (e instanceof Error ? e.message : '未知错误'))
      }
    } finally {
      setOptimizing(false)
      setProgress(null)
    }
  }, [])

  return { isOptimizing, progress, run, cancel }
}
