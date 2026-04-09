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

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
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

  // 仅当表格窄于容器（即右侧有空白）时才显示线性阴影
  const wrapperRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const [showRightShadow, setShowRightShadow] = useState(false)

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    const table = tableRef.current
    if (!wrapper || !table) return
    const check = () => {
      setShowRightShadow(table.offsetWidth < wrapper.clientWidth)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(wrapper)
    ro.observe(table)
    return () => ro.disconnect()
  }, [skillTracks.length, showOriginalDamage, showActualDamage, timeline])

  if (!timeline) return null

  // AnnotationRow 的 colSpan = 除时间列以外的所有列数
  const restColSpan =
    1 /* 事件名 */ + (showOriginalDamage ? 1 : 0) + (showActualDamage ? 1 : 0) + skillTracks.length

  return (
    <div ref={wrapperRef} className="h-full w-full overflow-auto bg-muted/40">
      <div className="relative inline-block align-top">
        {/* 紧贴表格右缘的线性阴影：水平方向从深色渐隐到透明，仅在表格窄于容器时显示 */}
        {showRightShadow && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 left-full w-4"
            style={{
              background: 'linear-gradient(to right, rgba(0,0,0,0.18), rgba(0,0,0,0))',
            }}
          />
        )}
        <table ref={tableRef} className="border-separate text-xs" style={{ borderSpacing: 0 }}>
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
    </div>
  )
}
