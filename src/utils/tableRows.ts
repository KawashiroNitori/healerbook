/**
 * 表格视图的行数据类型与排序
 */

import type { DamageEvent, Annotation } from '@/types/timeline'

export type TableRow =
  | { kind: 'damage'; id: string; time: number; event: DamageEvent }
  | { kind: 'annotation'; id: string; time: number; annotation: Annotation }

/**
 * 合并伤害事件和注释为统一行列表，按 time 升序。
 * 相同 time 时注释行排在伤害事件之前。组内保持输入顺序（稳定排序）。
 */
export function mergeAndSortRows(
  damageEvents: DamageEvent[],
  annotations: Annotation[]
): TableRow[] {
  const rows: TableRow[] = []
  for (const annotation of annotations) {
    rows.push({ kind: 'annotation', id: annotation.id, time: annotation.time, annotation })
  }
  for (const event of damageEvents) {
    rows.push({ kind: 'damage', id: event.id, time: event.time, event })
  }
  // 稳定排序：先按 time，time 相同时 annotation (0) < damage (1)
  rows.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time
    const order = (r: TableRow) => (r.kind === 'annotation' ? 0 : 1)
    return order(a) - order(b)
  })
  return rows
}
