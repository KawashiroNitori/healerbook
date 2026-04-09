// src/components/TimelineTable/index.tsx
/**
 * 表格视图主组件
 *
 * 数据流：
 * - useTimelineStore → timeline（伤害事件、注释、castEvents）
 * - useMitigationStore → actions（构造 actionsById Map）
 * - useSkillTracks() → 列顺序
 * - useDamageCalculationResults() → 编辑/回放模式的伤害数值
 * - useUIStore → showOriginalDamage / showActualDamage
 */

import { useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useUIStore } from '@/store/uiStore'
import { useSkillTracks } from '@/hooks/useSkillTracks'
import { useDamageCalculationResults } from '@/contexts/DamageCalculationContext'
import { computeLitCellsByEvent } from '@/utils/castWindow'
import { mergeAndSortRows } from '@/utils/tableRows'
import TableHeader from './TableHeader'
import TableDataRow from './TableDataRow'
import AnnotationRow from './AnnotationRow'

export default function TimelineTableView() {
  const timeline = useTimelineStore(s => s.timeline)
  const actions = useMitigationStore(s => s.actions)
  const showOriginalDamage = useUIStore(s => s.showOriginalDamage)
  const showActualDamage = useUIStore(s => s.showActualDamage)
  const skillTracks = useSkillTracks()
  const calculationResults = useDamageCalculationResults()

  const actionsById = useMemo(() => {
    const map = new Map<number, (typeof actions)[number]>()
    for (const a of actions) map.set(a.id, a)
    return map
  }, [actions])

  const litCellsByEvent = useMemo(() => {
    if (!timeline) return new Map<string, Set<string>>()
    return computeLitCellsByEvent(timeline.damageEvents, timeline.castEvents, actionsById)
  }, [timeline, actionsById])

  const rows = useMemo(() => {
    if (!timeline) return []
    return mergeAndSortRows(timeline.damageEvents, timeline.annotations ?? [])
  }, [timeline])

  if (!timeline) return null

  // AnnotationRow 的 colSpan = 除时间列以外的所有列数
  const restColSpan =
    1 /* 事件名 */ + (showOriginalDamage ? 1 : 0) + (showActualDamage ? 1 : 0) + skillTracks.length

  return (
    <div className="h-full w-full overflow-auto">
      <table className="border-separate text-xs" style={{ borderSpacing: 0 }}>
        <TableHeader
          skillTracks={skillTracks}
          actionsById={actionsById}
          showOriginalDamage={showOriginalDamage}
          showActualDamage={showActualDamage}
        />
        <tbody>
          {rows.map(row =>
            row.kind === 'damage' ? (
              <TableDataRow
                key={`d-${row.id}`}
                event={row.event}
                timeline={timeline}
                skillTracks={skillTracks}
                litCells={litCellsByEvent.get(row.id) ?? new Set()}
                calculationResult={calculationResults.get(row.id)}
                showOriginalDamage={showOriginalDamage}
                showActualDamage={showActualDamage}
              />
            ) : (
              <AnnotationRow
                key={`a-${row.id}`}
                annotation={row.annotation}
                restColSpan={restColSpan}
              />
            )
          )}
        </tbody>
      </table>
    </div>
  )
}
