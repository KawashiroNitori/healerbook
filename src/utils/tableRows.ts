/**
 * 表格视图的行数据类型与排序
 */

import type { DamageEvent, Annotation, TimelinePhase } from '@/types/timeline'
import { sortPhases } from './timelinePhases'

export type TableRow =
  | { kind: 'damage'; id: string; time: number; event: DamageEvent }
  | { kind: 'annotation'; id: string; time: number; annotation: Annotation }
  | { kind: 'phase'; id: string; time: number; phase: TimelinePhase; colorIndex: number }

const KIND_ORDER: Record<TableRow['kind'], number> = { phase: 0, annotation: 1, damage: 2 }

/**
 * 合并阶段、伤害事件和备注为统一行列表，按 time 升序。
 * 相同 time 时：阶段行 < 备注行 < 伤害事件。组内保持输入顺序（稳定排序）。
 * 阶段行的 colorIndex 为按时间排序后的位置（与时间轴配色一致）。
 */
export function mergeAndSortRows(
  damageEvents: DamageEvent[],
  annotations: Annotation[],
  phases: TimelinePhase[] = []
): TableRow[] {
  const rows: TableRow[] = []
  sortPhases(phases).forEach((phase, colorIndex) => {
    rows.push({ kind: 'phase', id: phase.id, time: phase.time, phase, colorIndex })
  })
  for (const annotation of annotations) {
    rows.push({ kind: 'annotation', id: annotation.id, time: annotation.time, annotation })
  }
  for (const event of damageEvents) {
    rows.push({ kind: 'damage', id: event.id, time: event.time, event })
  }
  rows.sort((a, b) => a.time - b.time || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
  return rows
}
