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
import { computeCastMarkerCells, computeLitCellsByEvent } from '@/utils/castWindow'
import { mergeAndSortRows } from '@/utils/tableRows'
import TableHeader from './TableHeader'
import TableDataRow from './TableDataRow'
import AnnotationRow from './AnnotationRow'
import {
  HEADER_HEIGHT,
  TIME_COL_WIDTH,
  NAME_COL_WIDTH,
  ORIGINAL_DAMAGE_COL_WIDTH,
  ACTUAL_DAMAGE_COL_WIDTH,
  SKILL_COL_WIDTH,
} from './constants'

export default function TimelineTableView() {
  const timeline = useTimelineStore(s => s.timeline)
  const selectEvent = useTimelineStore(s => s.selectEvent)
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

  const markerCellsByEvent = useMemo(() => {
    if (!timeline) return new Map<string, Set<string>>()
    return computeCastMarkerCells(timeline.damageEvents, timeline.castEvents)
  }, [timeline])

  const rows = useMemo(() => {
    if (!timeline) return []
    return mergeAndSortRows(timeline.damageEvents, timeline.annotations ?? [])
  }, [timeline])

  // 跟踪外层滚动容器的尺寸：用于右侧阴影显隐和注释内容宽度
  const wrapperRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const [showRightShadow, setShowRightShadow] = useState(false)
  const [wrapperWidth, setWrapperWidth] = useState(0)

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    const table = tableRef.current
    if (!wrapper || !table) return
    const check = () => {
      setShowRightShadow(table.offsetWidth < wrapper.clientWidth)
      setWrapperWidth(wrapper.clientWidth)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(wrapper)
    ro.observe(table)
    return () => ro.disconnect()
  }, [skillTracks.length, showOriginalDamage, showActualDamage, timeline])

  // 挂载时按共享滚动进度还原纵向滚动位置
  const hasInitializedSyncRef = useRef(false)
  useLayoutEffect(() => {
    if (hasInitializedSyncRef.current) return
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const maxScroll = wrapper.scrollHeight - wrapper.clientHeight
    if (maxScroll <= 0) return // 内容还没渲染，等下一轮
    hasInitializedSyncRef.current = true
    const progress = useTimelineStore.getState().syncScrollProgress
    if (progress > 0) {
      wrapper.scrollTop = progress * maxScroll
    }
  }, [rows, wrapperWidth])

  // 滚动时写入共享进度，供时间轴视图读取
  const handleScroll = () => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const maxScroll = wrapper.scrollHeight - wrapper.clientHeight
    const progress = maxScroll > 0 ? Math.min(1, Math.max(0, wrapper.scrollTop / maxScroll)) : 0
    useTimelineStore.getState().setSyncScrollProgress(progress)
  }

  if (!timeline) return null

  // AnnotationRow 的 colSpan = 除时间列以外的所有列数
  const restColSpan =
    1 /* 事件名 */ + (showOriginalDamage ? 1 : 0) + (showActualDamage ? 1 : 0) + skillTracks.length

  // 表格各列显式宽度之和，用于限定注释行 sticky div 的最大宽度
  const tableWidth =
    TIME_COL_WIDTH +
    NAME_COL_WIDTH +
    (showOriginalDamage ? ORIGINAL_DAMAGE_COL_WIDTH : 0) +
    (showActualDamage ? ACTUAL_DAMAGE_COL_WIDTH : 0) +
    skillTracks.length * SKILL_COL_WIDTH

  return (
    <div
      ref={wrapperRef}
      onScroll={handleScroll}
      onClick={() => selectEvent(null)}
      className="h-full w-full overflow-auto bg-neutral-200 dark:bg-neutral-900"
    >
      <div className="relative inline-block align-top bg-background">
        {/* 表头下方的线性渐变阴影：sticky 固定在视口顶部 HEADER_HEIGHT 处，宽度贴合表格 */}
        <div
          aria-hidden
          className="pointer-events-none sticky left-0 z-[15] w-full"
          style={{
            top: HEADER_HEIGHT,
            height: 16,
            marginBottom: -16,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.18), rgba(0,0,0,0))',
          }}
        />
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
                  markerCells={markerCellsByEvent.get(row.id) ?? new Set()}
                  calculationResult={calculationResults.get(row.id)}
                  showOriginalDamage={showOriginalDamage}
                  showActualDamage={showActualDamage}
                  onSelect={selectEvent}
                />
              ) : (
                <AnnotationRow
                  key={`a-${row.id}`}
                  annotation={row.annotation}
                  restColSpan={restColSpan}
                  wrapperWidth={wrapperWidth}
                  tableWidth={tableWidth}
                />
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
