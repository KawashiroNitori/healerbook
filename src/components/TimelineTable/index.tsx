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

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useUIStore } from '@/store/uiStore'
import { useSkillTracks } from '@/hooks/useSkillTracks'
import { useFilteredTimelineView } from '@/hooks/useFilteredTimelineView'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import {
  useDamageCalculationResults,
  useDamageCalculationSimulate,
} from '@/contexts/DamageCalculationContext'
import { createPlacementEngine } from '@/utils/placement/engine'
import type { PlacementEngine } from '@/utils/placement/types'
import { computeCastMarkerCells, computeLitCellsByEvent } from '@/utils/castWindow'
import { mergeAndSortRows } from '@/utils/tableRows'
import { getSyncScrollProgress, setSyncScrollProgress } from '@/utils/syncScrollProgress'
import type { SkillTrack } from '@/utils/skillTracks'
import type { DamageEvent } from '@/types/timeline'
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
  const addCastEvent = useTimelineStore(s => s.addCastEvent)
  const removeCastEvent = useTimelineStore(s => s.removeCastEvent)
  const actions = useMitigationStore(s => s.actions)
  const showOriginalDamage = useUIStore(s => s.showOriginalDamage)
  const showActualDamage = useUIStore(s => s.showActualDamage)
  const skillTracks = useSkillTracks()
  const calculationResults = useDamageCalculationResults()
  const simulate = useDamageCalculationSimulate()
  const isReadOnly = useEditorReadOnly()
  const { filteredDamageEvents, filteredCastEvents } = useFilteredTimelineView()

  const actionsById = useMemo(() => {
    const map = new Map<number, (typeof actions)[number]>()
    for (const a of actions) map.set(a.id, a)
    return map
  }, [actions])

  // 和画布视图共享 simulate callback 构造 PlacementEngine——双击/右键/表格单元格添加都要走
  // variant 选择，避免 buff 期点"意气轩昂"列实际加进去的是 37013（带红框）。
  const engine: PlacementEngine | null = useMemo(() => {
    if (!timeline || !simulate) return null
    return createPlacementEngine({
      castEvents: timeline.castEvents,
      actions: actionsById,
      simulate,
    })
  }, [timeline, simulate, actionsById])

  const litCellsByEvent = useMemo(() => {
    if (!timeline) return new Map<string, Set<string>>()
    return computeLitCellsByEvent(filteredDamageEvents, filteredCastEvents, actionsById)
  }, [timeline, filteredDamageEvents, filteredCastEvents, actionsById])

  const markerCellsByEvent = useMemo(() => {
    if (!timeline) return new Map<string, Map<string, number>>()
    return computeCastMarkerCells(filteredDamageEvents, filteredCastEvents, actionsById)
  }, [timeline, filteredDamageEvents, filteredCastEvents, actionsById])

  // 单元格点击：在该行事件时刻放置/移除对应技能
  // - 带图标的单元格（marker，即 cast 起点）→ 移除对应 cast
  // - 淡绿色/空白单元格 → 尝试放置（冷却冲突时 toast 拒绝）
  const handleCellToggle = useCallback(
    (track: SkillTrack, event: DamageEvent, isMarker: boolean) => {
      if (isReadOnly || !timeline) return
      const parent = actionsById.get(track.actionId)
      if (!parent) return
      const groupId = parent.trackGroup ?? parent.id

      if (isMarker) {
        // 移除：marker 单元格落在 cast 起始刻，找同 playerId 同 trackGroup（涵盖变体
        // 如 37016 挂在 37013 列上）里 timestamp ≤ event.time 最近的一条。
        const matching = timeline.castEvents
          .filter(ce => {
            if (ce.playerId !== track.playerId) return false
            if (ce.timestamp > event.time) return false
            const ca = actionsById.get(ce.actionId)
            if (!ca) return false
            return (ca.trackGroup ?? ca.id) === groupId
          })
          .sort((a, b) => b.timestamp - a.timestamp)[0]
        if (matching) removeCastEvent(matching.id)
        return
      }

      // 新增：先由 engine 选当前时刻唯一合法变体（buff 期 37013 列自动变 37016）；
      // 未接入 engine / 单成员组时退化为传入的 track.actionId。
      let resolvedActionId = track.actionId
      if (engine) {
        const member = engine.pickUniqueMember(groupId, track.playerId, event.time)
        if (!member) {
          const unmetMsg = engine.getResourceUnmetMessageAt(parent, track.playerId, event.time)
          toast.error('无法添加技能', { description: unmetMsg ?? '此时刻不满足发动条件' })
          return
        }
        resolvedActionId = member.id
      }

      // CD 冲突 / 资源耗尽 已由 pickUniqueMember 内部 canPlaceCastEvent 闭环过滤
      // （legal = placement ∩ resourceLegalIntervals）；此处不再重复 overlap 窗口检查——
      // 旧 overlap 按 action.cooldown 硬窗口互斥，与多充能（慰藉/献奉）语义冲突。
      addCastEvent({
        id: `cast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        actionId: resolvedActionId,
        timestamp: event.time,
        playerId: track.playerId,
      })
    },
    [isReadOnly, timeline, actionsById, addCastEvent, removeCastEvent, engine]
  )

  const rows = useMemo(() => {
    if (!timeline) return []
    return mergeAndSortRows(filteredDamageEvents, timeline.annotations ?? [])
  }, [filteredDamageEvents, timeline])

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

  // 按住左键拖动平移表格（类似 Figma/draw.io）
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    let dragging = false
    let moved = false
    let sx = 0
    let sy = 0
    let sl = 0
    let st = 0
    const THRESHOLD = 4

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      dragging = true
      moved = false
      sx = e.clientX
      sy = e.clientY
      sl = wrapper.scrollLeft
      st = wrapper.scrollTop
    }

    const onMove = (e: MouseEvent) => {
      if (!dragging) return
      const dx = e.clientX - sx
      const dy = e.clientY - sy
      if (!moved) {
        if (Math.hypot(dx, dy) < THRESHOLD) return
        moved = true
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }
      wrapper.scrollLeft = sl - dx
      wrapper.scrollTop = st - dy
      e.preventDefault()
    }

    const onUp = () => {
      if (!dragging) return
      dragging = false
      if (moved) {
        moved = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        // 拖动结束紧接着浏览器会触发一次 click，需要拦截掉以免触发 selectEvent(null) 或单元格切换
        const block = (ev: MouseEvent) => {
          ev.stopPropagation()
          ev.preventDefault()
          wrapper.removeEventListener('click', block, true)
        }
        wrapper.addEventListener('click', block, true)
        setTimeout(() => wrapper.removeEventListener('click', block, true), 0)
      }
    }

    wrapper.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)

    return () => {
      wrapper.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // 挂载时按共享滚动进度还原纵向滚动位置
  const hasInitializedSyncRef = useRef(false)
  useLayoutEffect(() => {
    if (hasInitializedSyncRef.current) return
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const maxScroll = wrapper.scrollHeight - wrapper.clientHeight
    if (maxScroll <= 0) return // 内容还没渲染，等下一轮
    hasInitializedSyncRef.current = true
    const progress = getSyncScrollProgress()
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
    setSyncScrollProgress(progress)
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
                  markerCells={markerCellsByEvent.get(row.id) ?? new Map<string, number>()}
                  actionsById={actionsById}
                  calculationResult={calculationResults.get(row.id)}
                  showOriginalDamage={showOriginalDamage}
                  showActualDamage={showActualDamage}
                  onSelect={selectEvent}
                  onCellToggle={handleCellToggle}
                  isReadOnly={isReadOnly}
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
