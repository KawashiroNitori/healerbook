/**
 * 阶段编辑操作（时间轴右键、工具栏下拉、表格三处入口共用）。
 *
 * 统一处理时间钳制、默认命名与提示，避免各入口各写一份。
 */

import { toast } from 'sonner'
import i18n from '@/i18n'
import { useTimelineStore } from '@/store/timelineStore'
import type { TimelinePhase } from '@/types/timeline'
import { generateObjectId } from '@/utils/shortId'
import { clampPhaseTime, defaultPhaseName, phaseColor, sortPhases } from '@/utils/timelinePhases'

function sortedPhases(): TimelinePhase[] {
  return sortPhases(useTimelineStore.getState().timeline?.phases ?? [])
}

/**
 * 在 time 处新增阶段并选中；默认名 P{插入后的序号}，其他阶段名不变。
 * 无合法位置时提示并返回 null。
 */
export function addPhaseAt(time: number): TimelinePhase | null {
  const sorted = sortedPhases()
  const r = clampPhaseTime(sorted, null, time)
  if (!r) {
    toast.error(i18n.t('editor:phase.noRoom'))
    return null
  }
  if (r.clamped) toast(i18n.t('editor:phase.timeClamped'))
  const phase: TimelinePhase = {
    id: generateObjectId(),
    name: defaultPhaseName(sorted, r.time),
    time: r.time,
  }
  const s = useTimelineStore.getState()
  s.addPhase(phase)
  s.selectPhase(phase.id)
  return phase
}

/** 修改阶段开始时间（越界钳制并提示）；返回最终写入的时间，无合法位置返回 null */
export function movePhaseTo(id: string, time: number): number | null {
  const sorted = sortedPhases()
  const r = clampPhaseTime(sorted, id, time)
  if (!r) {
    toast.error(i18n.t('editor:phase.noRoom'))
    return null
  }
  if (r.clamped) toast(i18n.t('editor:phase.timeClamped'))
  const current = sorted.find(p => p.id === id)
  if (current && current.time !== r.time)
    useTimelineStore.getState().updatePhase(id, { time: r.time })
  return r.time
}

export function renamePhase(id: string, name: string): void {
  useTimelineStore.getState().updatePhase(id, { name })
}

export function removePhase(id: string): void {
  useTimelineStore.getState().removePhase(id)
}

/** 阶段颜色：按排序后位置推导 */
export function colorOfPhase(id: string): string {
  const idx = sortedPhases().findIndex(p => p.id === id)
  return phaseColor(Math.max(0, idx))
}
