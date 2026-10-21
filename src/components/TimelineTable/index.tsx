// src/components/TimelineTable/index.tsx
/**
 * 表格视图主组件
 *
 * 数据流：
 * - useTimelineStore → timeline（伤害事件、备注、castEvents）
 * - ACTIONS（构造 actionsById Map）
 * - useSkillTracks() → 列顺序
 * - useDamageCalculationResults() → 编辑/回放模式的伤害数值
 * - useUIStore → showOriginalDamage / showActualDamage
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useTimelineStore } from '@/store/timelineStore'
import { useResolvedActions } from '@/hooks/useResolvedActions'
import { useUIStore } from '@/store/uiStore'
import { useResourceHoverStore } from '@/store/resourceHoverStore'
import { useSkillTracks } from '@/hooks/useSkillTracks'
import { useFilteredTimelineView } from '@/hooks/useFilteredTimelineView'
import { useFilterStore } from '@/store/filterStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import {
  useCastEffectiveEnd,
  useDamageCalculationResults,
  useRemovalTimelinesByExcludeId,
  useResolvedVariantByCastId,
  useStatusTimelineByPlayer,
} from '@/contexts/DamageCalculationContext'
import { createPlacementEngine } from '@/utils/placement/engine'
import type { PlacementEngine } from '@/types/placement'
import {
  computeCastMarkerCells,
  computeCdCellsByEvent,
  computeLitCellsByEvent,
  computeShadowCellsByEvent,
} from '@/utils/tableCellHitTest'
import { generateObjectId } from '@/utils/shortId'
import { mergeAndSortRows } from '@/utils/tableRows'
import { getSyncScrollProgress, setSyncScrollProgress } from '@/utils/syncScrollProgress'
import { effectiveTrackGroup } from '@/types/mitigation'
import type { SkillTrack } from '@/utils/skillTracks'
import type { DamageEvent } from '@/types/timeline'
import TableHeader from './TableHeader'
import TableDataRow from './TableDataRow'
import AnnotationRow from './AnnotationRow'
import PhaseRow from './PhaseRow'
import PhaseDeleteConfirm, { type PhaseDeleteRequest } from '../PhaseDeleteConfirm'
import { movePhaseTo, removePhase, renamePhase } from '../phaseActions'
import { phaseColor } from '@/utils/timelinePhases'
import AddDamageRow from './AddDamageRow'
import AddEventDialog from '../AddEventDialog'
import AnnotationPopover from '../Timeline/AnnotationPopover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { deleteKeyLabel } from '@/utils/platform'
import {
  HEADER_HEIGHT,
  TIME_COL_WIDTH,
  CAST_START_COL_WIDTH,
  NAME_COL_WIDTH,
  ORIGINAL_DAMAGE_COL_WIDTH,
  ACTUAL_DAMAGE_COL_WIDTH,
  SKILL_COL_WIDTH,
} from './constants'

/** 表格点击放置技能时，cast 锚定时刻相对伤害发生时刻的提前量（秒） */
const CAST_ANCHOR_LEAD = 0.1

export default function TimelineTableView() {
  const { t } = useTranslation(['editor', 'common'])
  const timeline = useTimelineStore(s => s.timeline)
  const selectEvent = useTimelineStore(s => s.selectEvent)
  const addCastEvent = useTimelineStore(s => s.addCastEvent)
  const removeCastEvent = useTimelineStore(s => s.removeCastEvent)
  const addAnnotation = useTimelineStore(s => s.addAnnotation)
  const updateAnnotation = useTimelineStore(s => s.updateAnnotation)
  const removeAnnotation = useTimelineStore(s => s.removeAnnotation)
  // 表格视图与 Canvas 视图共享同一放置引擎语义，必须按等级 resolve——否则低等级下
  // CD / 持续时间与 Timeline/index.tsx 的画布视图不一致。
  const { actionMap: actionsById } = useResolvedActions()
  const showOriginalDamage = useUIStore(s => s.showOriginalDamage)
  const showActualDamage = useUIStore(s => s.showActualDamage)
  const showCastStartTime = useUIStore(s => s.showCastStartTime)
  const skillTracks = useSkillTracks()
  const calculationResults = useDamageCalculationResults()
  const removalTimelinesByExcludeId = useRemovalTimelinesByExcludeId()
  const statusTimelineByPlayer = useStatusTimelineByPlayer()
  const castEffectiveEnd = useCastEffectiveEnd()
  const resolvedVariantByCastId = useResolvedVariantByCastId()
  const isReadOnly = useEditorReadOnly()
  const { filteredDamageEvents, filteredCastEvents } = useFilteredTimelineView()

  // 和画布视图共享主路径 status timeline 构造 PlacementEngine——双击/右键/表格单元格添加都要走
  // variant 选择，避免 buff 期点"意气轩昂"列实际加进去的是 37013（带红框）。
  const engine: PlacementEngine | null = useMemo(() => {
    if (!timeline) return null
    return createPlacementEngine({
      castEvents: timeline.castEvents,
      actions: actionsById,
      statusTimelineByPlayer,
      removalTimelinesByExcludeId,
      resolvedVariantByCastId,
    })
  }, [
    timeline,
    actionsById,
    statusTimelineByPlayer,
    removalTimelinesByExcludeId,
    resolvedVariantByCastId,
  ])

  const litCellsByEvent = useMemo(() => {
    if (!timeline) return new Map<string, Set<string>>()
    return computeLitCellsByEvent(
      filteredDamageEvents,
      filteredCastEvents,
      actionsById,
      castEffectiveEnd,
      resolvedVariantByCastId
    )
  }, [
    timeline,
    filteredDamageEvents,
    filteredCastEvents,
    actionsById,
    castEffectiveEnd,
    resolvedVariantByCastId,
  ])

  const markerCellsByEvent = useMemo(() => {
    if (!timeline) return new Map<string, Map<string, number>>()
    return computeCastMarkerCells(
      filteredDamageEvents,
      filteredCastEvents,
      actionsById,
      resolvedVariantByCastId
    )
  }, [timeline, filteredDamageEvents, filteredCastEvents, actionsById, resolvedVariantByCastId])

  const cdCellsByEvent = useMemo(() => {
    if (!timeline || !engine) return new Map<string, Set<string>>()
    return computeCdCellsByEvent(
      filteredDamageEvents,
      filteredCastEvents,
      actionsById,
      engine.cdBarEndFor,
      castEffectiveEnd,
      resolvedVariantByCastId
    )
  }, [
    timeline,
    engine,
    filteredDamageEvents,
    filteredCastEvents,
    actionsById,
    castEffectiveEnd,
    resolvedVariantByCastId,
  ])

  const shadowCellsByEvent = useMemo(() => {
    if (!timeline || !engine || isReadOnly) return new Map<string, Set<string>>()
    const eng = engine
    const shadowIntervalsForTrack = (track: SkillTrack) => {
      const parent = actionsById.get(track.actionId)
      if (!parent) return []
      // cd<=3 且无 placement：纯 CD 冲突窗口对 GCD 级技能是噪音，不画
      if (parent.cooldown <= 3 && !parent.placement) return []
      const groupId = effectiveTrackGroup(parent)
      // cd<=3 有 placement：只画 placement 非法区；否则完整 track 阴影（含前向 CD 提示）
      return parent.cooldown <= 3
        ? eng.computePlacementShadow(groupId, track.playerId)
        : eng.computeTrackShadow(groupId, track.playerId)
    }
    return computeShadowCellsByEvent(filteredDamageEvents, skillTracks, shadowIntervalsForTrack)
  }, [timeline, engine, isReadOnly, filteredDamageEvents, skillTracks, actionsById])

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
            return effectiveTrackGroup(ca) === groupId
          })
          .sort((a, b) => b.timestamp - a.timestamp)[0]
        if (matching) removeCastEvent(matching.id)
        return
      }

      // 新增：仅做「该时刻是否存在合法变体」的存在性校验（buff 期 37013 列是否可放）；
      // 具体变体交给 simulate 运行时推导，此处写入父 id（groupId），变体不持久化。
      if (engine) {
        const member = engine.pickUniqueMember(groupId, track.playerId, event.time)
        if (!member) {
          const unmetMsg = engine.getResourceUnmetMessageAt(parent, track.playerId, event.time)
          toast.error(t('timelineTable.cannotAddAction'), {
            description: unmetMsg ?? t('timelineTable.conditionNotMet'),
          })
          return
        }
      }

      // CD 冲突 / 资源耗尽 已由 pickUniqueMember 内部 canPlaceCastEvent 闭环过滤
      // （legal = placement ∩ resourceLegalIntervals）；此处不再重复 overlap 窗口检查——
      // 旧 overlap 按 action.cooldown 硬窗口互斥，与多充能（慰藉/献奉）语义冲突。
      //
      // 锚定时刻略提前于伤害发生时刻 CAST_ANCHOR_LEAD：cast 与伤害同刻时，simulator
      // 在同一时间点的事件排序可能让状态附加晚于伤害结算，导致减伤不生效。提前 0.1s
      // 保证状态在伤害落地前已挂上。绿格/marker 仍归到点击的这一行（相邻伤害事件间隔
      // 远大于 0.1s）。
      addCastEvent({
        id: generateObjectId(),
        actionId: groupId,
        timestamp: event.time - CAST_ANCHOR_LEAD,
        playerId: track.playerId,
      })
    },
    [isReadOnly, timeline, actionsById, addCastEvent, removeCastEvent, engine, t]
  )

  const rows = useMemo(() => {
    if (!timeline) return []
    const nonCast = (timeline.annotations ?? []).filter(a => a.anchor.type !== 'cast')
    return mergeAndSortRows(filteredDamageEvents, nonCast, timeline.phases ?? [])
  }, [filteredDamageEvents, timeline])

  // ─── 阶段 ───────────────────────────────────────────────
  const [editingPhase, setEditingPhase] = useState<{
    id: string
    field: 'name' | 'time'
  } | null>(null)
  const [phaseDeleteRequest, setPhaseDeleteRequest] = useState<PhaseDeleteRequest | null>(null)
  // 阶段行右键菜单（改名、改时间、删除）
  const [rowMenu, setRowMenu] = useState<{
    x: number
    y: number
    phaseId: string
    anchor: DOMRect
  } | null>(null)

  // cast 锚定备注：castId → 该 cast 的备注（一个 cast 至多一条；历史多余数据取首条）
  const castAnnotationByCastId = useMemo(() => {
    const m = new Map<string, { id: string; text: string }>()
    for (const a of timeline?.annotations ?? []) {
      if (a.anchor.type !== 'cast') continue
      if (!m.has(a.anchor.castId)) m.set(a.anchor.castId, { id: a.id, text: a.text })
    }
    return m
  }, [timeline])

  // 右键 cast marker 的上下文菜单（与时间轴 castEvent 菜单一致）
  const [castMenu, setCastMenu] = useState<{
    x: number
    y: number
    castEventId: string
    castTime: number
  } | null>(null)
  // cast 备注文本录入（复用画布的 AnnotationPopover，edit 模式）。
  // annotationId 有值 = 编辑既有备注（原地更新）；为 null = 新增。
  const [editingCast, setEditingCast] = useState<{
    castEventId: string
    castTime: number
    annotationId: string | null
    initialText: string
    screenX: number
    screenY: number
  } | null>(null)

  const handleCastContextMenu = useCallback(
    (castEventId: string, castTime: number, clientX: number, clientY: number) => {
      if (isReadOnly) return
      setCastMenu({ x: clientX, y: clientY, castEventId, castTime })
    },
    [isReadOnly]
  )

  // "添加伤害事件"行的对话框开关；默认时间取最后一个伤害事件的 time，空表格则 0
  const [showAddDialog, setShowAddDialog] = useState(false)
  const lastDamageTime = useMemo(() => {
    if (!timeline || timeline.damageEvents.length === 0) return 0
    let max = timeline.damageEvents[0].time
    for (const ev of timeline.damageEvents) {
      if (ev.time > max) max = ev.time
    }
    return max
  }, [timeline])

  // 跟踪外层滚动容器的尺寸：用于右侧阴影显隐和备注内容宽度
  const wrapperRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const [showRightShadow, setShowRightShadow] = useState(false)
  const [wrapperWidth, setWrapperWidth] = useState(0)
  // 表头实际高度：技能列头（职业图标 + 技能图标）会把行撑得比 HEADER_HEIGHT 高，
  // 阶段行吸顶位置必须用实测值，否则顶部会被表头盖住一截
  const [headerHeight, setHeaderHeight] = useState(HEADER_HEIGHT)

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    const table = tableRef.current
    if (!wrapper || !table) return
    const check = () => {
      setShowRightShadow(table.offsetWidth < wrapper.clientWidth)
      setWrapperWidth(wrapper.clientWidth)
      setHeaderHeight(table.tHead?.offsetHeight ?? HEADER_HEIGHT)
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
        // 拖动平移时隐藏资源预览悬浮窗（并阻止单元格 mousemove 重新触发）
        useResourceHoverStore.getState().setDragging(true)
      }
      wrapper.scrollLeft = sl - dx
      wrapper.scrollTop = st - dy
      e.preventDefault()
    }

    const onUp = () => {
      if (!dragging) return
      dragging = false
      useResourceHoverStore.getState().setDragging(false)
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

  /**
   * 带时间的行及其「未吸顶时」的顶边位置（相对表格顶部）。
   * 吸顶的阶段行 offsetTop 会反映吸附后的位置，因此改用表头高 + 前序行高累加。
   */
  const measureRowLayout = useCallback(() => {
    const table = tableRef.current
    const tbody = table?.tBodies[0]
    if (!table || !tbody) return null
    const rowsWithTime: HTMLTableRowElement[] = []
    const tops: number[] = []
    const headerHeight = table.tHead?.offsetHeight ?? HEADER_HEIGHT
    let y = headerHeight
    for (const r of tbody.rows) {
      if (r.dataset.rowTime !== undefined) {
        rowsWithTime.push(r)
        tops.push(y)
      }
      y += r.offsetHeight
    }
    return { rows: rowsWithTime, tops, headerHeight }
  }, [])

  // 阅读位置：表头下方第一条可见行的时间，供工具栏判定当前阶段
  const anchorRafRef = useRef<number | null>(null)
  const reportViewAnchor = useCallback(() => {
    if (anchorRafRef.current !== null) return
    anchorRafRef.current = requestAnimationFrame(() => {
      anchorRafRef.current = null
      const wrapper = wrapperRef.current
      const layout = measureRowLayout()
      if (!wrapper || !layout) return
      const { rows: trs, tops, headerHeight: headerH } = layout
      if (trs.length === 0) {
        useTimelineStore.getState().setViewAnchorTime(null)
        return
      }
      // 二分：第一条底边越过表头下缘的行
      const line = wrapper.scrollTop + headerH
      let lo = 0
      let hi = trs.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (tops[mid] + trs[mid].offsetHeight > line) hi = mid
        else lo = mid + 1
      }
      useTimelineStore.getState().setViewAnchorTime(Number(trs[lo].dataset.rowTime))
    })
  }, [measureRowLayout])
  useEffect(() => {
    reportViewAnchor()
  }, [rows, reportViewAnchor])
  useEffect(
    () => () => {
      // 必须复位：StrictMode 下会卸载后再挂载同一实例，残留的帧 id 会让 reportViewAnchor 永远提前返回
      if (anchorRafRef.current !== null) cancelAnimationFrame(anchorRafRef.current)
      anchorRafRef.current = null
      useTimelineStore.getState().setViewAnchorTime(null)
    },
    []
  )

  // 响应阶段跳转请求：该阶段行贴住表头
  const scrollToTimeRequest = useTimelineStore(s => s.scrollToTimeRequest)
  const handledScrollSeqRef = useRef(scrollToTimeRequest?.seq ?? 0)
  useEffect(() => {
    if (!scrollToTimeRequest || scrollToTimeRequest.seq <= handledScrollSeqRef.current) return
    handledScrollSeqRef.current = scrollToTimeRequest.seq
    const wrapper = wrapperRef.current
    const layout = measureRowLayout()
    if (!wrapper || !layout) return
    // 同一时刻阶段行排最前，取第一条时间 ≥ 目标的行即为该阶段行
    const idx = layout.rows.findIndex(r => Number(r.dataset.rowTime) >= scrollToTimeRequest.time)
    if (idx >= 0) {
      // 让目标行贴住表头下缘（用表头实际高度）
      wrapper.scrollTo({ top: layout.tops[idx] - layout.headerHeight, behavior: 'smooth' })
    }
  }, [scrollToTimeRequest, measureRowLayout])

  // 滚动时写入共享进度，供时间轴视图读取
  const handleScroll = () => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const maxScroll = wrapper.scrollHeight - wrapper.clientHeight
    const progress = maxScroll > 0 ? Math.min(1, Math.max(0, wrapper.scrollTop / maxScroll)) : 0
    setSyncScrollProgress(progress)
    reportViewAnchor()
  }

  // 切换过滤器时把垂直滚动复位到最上：过滤后行集合可能变化，
  // 保持原 scrollTop 容易让用户落在不可解释的位置
  const activeFilterId = useFilterStore(s => s.activeFilterId)
  const initialFilterRef = useRef(true)
  useEffect(() => {
    if (initialFilterRef.current) {
      initialFilterRef.current = false
      return
    }
    const wrapper = wrapperRef.current
    if (!wrapper) return
    wrapper.scrollTop = 0
  }, [activeFilterId])

  if (!timeline) return null

  // AnnotationRow 的 colSpan = 除时间列以外的所有列数
  const restColSpan =
    1 /* 事件名 */ + (showOriginalDamage ? 1 : 0) + (showActualDamage ? 1 : 0) + skillTracks.length

  // 表格各列显式宽度之和，用于限定备注行 sticky div 的最大宽度
  const tableWidth =
    (showCastStartTime ? CAST_START_COL_WIDTH : 0) +
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
      // 表格内除 cast marker 单元格外一律禁用原生右键菜单（marker 格自身 stopPropagation
      // 后弹出自定义菜单，不会冒泡到此）
      onContextMenu={e => e.preventDefault()}
      className="h-full w-full overflow-auto bg-neutral-200 dark:bg-neutral-900"
    >
      <div className="relative inline-block align-top bg-background">
        {/* 表头下方的线性渐变阴影：sticky 固定在表头实际下缘处，宽度贴合表格 */}
        <div
          aria-hidden
          className="pointer-events-none sticky left-0 z-[15] w-full"
          style={{
            top: headerHeight,
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
            showCastStartTime={showCastStartTime}
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
                  cdCells={cdCellsByEvent.get(row.id) ?? new Set()}
                  shadowCells={shadowCellsByEvent.get(row.id) ?? new Set()}
                  markerCells={markerCellsByEvent.get(row.id) ?? new Map()}
                  castAnnotationByCastId={castAnnotationByCastId}
                  actionsById={actionsById}
                  calculationResult={calculationResults.get(row.id)}
                  showOriginalDamage={showOriginalDamage}
                  showActualDamage={showActualDamage}
                  showCastStartTime={showCastStartTime}
                  onSelect={selectEvent}
                  onCellToggle={handleCellToggle}
                  isReadOnly={isReadOnly}
                  onCastContextMenu={handleCastContextMenu}
                />
              ) : row.kind === 'phase' ? (
                <PhaseRow
                  key={`p-${row.id}`}
                  phase={row.phase}
                  color={phaseColor(row.colorIndex)}
                  restColSpan={restColSpan}
                  wrapperWidth={wrapperWidth}
                  tableWidth={tableWidth}
                  showCastStartTime={showCastStartTime}
                  stickyTop={headerHeight}
                  isReadOnly={isReadOnly}
                  editing={editingPhase?.id === row.id ? editingPhase.field : null}
                  onStartEdit={field => setEditingPhase({ id: row.id, field })}
                  onEndEdit={() => setEditingPhase(null)}
                  onRename={name => renamePhase(row.id, name)}
                  onChangeTime={time => movePhaseTo(row.id, time)}
                  onDelete={anchor =>
                    setPhaseDeleteRequest({ phaseId: row.id, phaseName: row.phase.name, anchor })
                  }
                  onContextMenu={(x, y) => {
                    if (isReadOnly) return
                    setRowMenu({
                      x,
                      y,
                      phaseId: row.id,
                      anchor: new DOMRect(x, y, 1, 1),
                    })
                  }}
                />
              ) : (
                <AnnotationRow
                  key={`a-${row.id}`}
                  annotation={row.annotation}
                  restColSpan={restColSpan}
                  wrapperWidth={wrapperWidth}
                  tableWidth={tableWidth}
                  showCastStartTime={showCastStartTime}
                />
              )
            )}
            {!isReadOnly && (
              <AddDamageRow
                totalColSpan={1 + restColSpan + (showCastStartTime ? 1 : 0)}
                wrapperWidth={wrapperWidth}
                tableWidth={tableWidth}
                onClick={() => setShowAddDialog(true)}
              />
            )}
          </tbody>
        </table>
        {/* 表格底部 sticky 阴影：与顶部对称。长表格滚动时粘在视口底，短表格时
            自然落在末行下方做收尾。marginTop: -16 与末行重叠 */}
        <div
          aria-hidden
          className="pointer-events-none sticky left-0 z-[15] w-full"
          style={{
            bottom: 0,
            height: 16,
            marginTop: -16,
            background: 'linear-gradient(to top, rgba(0,0,0,0.18), rgba(0,0,0,0))',
          }}
        />
      </div>
      {showAddDialog && (
        <AddEventDialog open onClose={() => setShowAddDialog(false)} defaultTime={lastDamageTime} />
      )}

      {/* 右键 cast marker 菜单：与时间轴 castEvent 菜单一致（给技能添加备注 / 删除） */}
      {castMenu && !isReadOnly && (
        <DropdownMenu open onOpenChange={open => !open && setCastMenu(null)}>
          <DropdownMenuTrigger asChild>
            <div
              className="fixed pointer-events-none"
              style={{ left: castMenu.x, top: castMenu.y, width: 1, height: 1 }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="min-w-[120px] text-[11px]">
            {/* 一个 cast 只允许一条备注：已有则改为编辑（原地更新），无则新增 */}
            <DropdownMenuItem
              onClick={() => {
                const existing = castAnnotationByCastId.get(castMenu.castEventId)
                setEditingCast({
                  castEventId: castMenu.castEventId,
                  castTime: castMenu.castTime,
                  annotationId: existing?.id ?? null,
                  initialText: existing?.text ?? '',
                  screenX: castMenu.x,
                  screenY: castMenu.y,
                })
                setCastMenu(null)
              }}
            >
              {castAnnotationByCastId.has(castMenu.castEventId)
                ? t('editor:contextMenu.editAnnotation')
                : t('editor:contextMenu.addCastAnnotation')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                removeCastEvent(castMenu.castEventId)
                setCastMenu(null)
              }}
            >
              {t('editor:contextMenu.delete')}
              <DropdownMenuShortcut>{deleteKeyLabel}</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* 阶段行右键菜单：改名 / 改时间 / 删除 */}
      {rowMenu && !isReadOnly && (
        <DropdownMenu open onOpenChange={open => !open && setRowMenu(null)}>
          <DropdownMenuTrigger asChild>
            <div
              className="fixed pointer-events-none"
              style={{ left: rowMenu.x, top: rowMenu.y, width: 1, height: 1 }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="min-w-[140px] text-[11px]">
            <DropdownMenuItem
              onClick={() => setEditingPhase({ id: rowMenu.phaseId, field: 'name' })}
            >
              {t('editor:phase.rename')}
              <DropdownMenuShortcut>{t('editor:phase.renameShortcutTable')}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setEditingPhase({ id: rowMenu.phaseId, field: 'time' })}
            >
              {t('editor:phase.editTime')}
              <DropdownMenuShortcut>{t('editor:phase.editTimeShortcut')}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                const phase = timeline.phases?.find(p => p.id === rowMenu.phaseId)
                if (phase) {
                  setPhaseDeleteRequest({
                    phaseId: phase.id,
                    phaseName: phase.name,
                    anchor: rowMenu.anchor,
                  })
                }
              }}
            >
              {t('editor:phase.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <PhaseDeleteConfirm
        request={phaseDeleteRequest}
        onConfirm={removePhase}
        onClose={() => setPhaseDeleteRequest(null)}
      />

      {/* cast 备注文本录入（复用画布 AnnotationPopover） */}
      {editingCast && (
        <AnnotationPopover
          mode="edit"
          text={editingCast.initialText}
          screenX={editingCast.screenX}
          screenY={editingCast.screenY}
          onConfirm={text => {
            if (editingCast.annotationId) {
              updateAnnotation(editingCast.annotationId, { text })
            } else {
              addAnnotation({
                id: generateObjectId(),
                text,
                time: editingCast.castTime,
                anchor: { type: 'cast', castId: editingCast.castEventId },
              })
            }
          }}
          // 仅编辑既有备注时给出删除入口
          onDelete={
            editingCast.annotationId ? () => removeAnnotation(editingCast.annotationId!) : undefined
          }
          onClose={() => setEditingCast(null)}
        />
      )}
    </div>
  )
}
