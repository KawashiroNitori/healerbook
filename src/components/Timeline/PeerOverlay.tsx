/**
 * 协作者感知叠加层 —— 渲染他人选中高亮与悬停光标线。
 *
 * 两个导出：
 *   PeerOverlayFixed — 放入固定 Stage 的 overlay Layer（伤害事件高亮 + 光标线）
 *   PeerOverlayMain  — 放入主 Stage 的 overlay Layer（cast 事件高亮 + 光标线）
 *
 * 坐标系：两个 Layer 均已通过 x={-scrollLeft} / y={-scrollTop} 处理滚动偏移，
 * 因此子节点使用画布原始坐标（时间 × zoomLevel，不需要减去滚动量）。
 */

import { Fragment, useMemo } from 'react'
import { Label, Line, Rect, Tag, Text } from 'react-konva'
import { useSmoothedPeers } from './useSmoothedPeers'
import type { PeerState } from '@/collab/awarenessTypes'
import type { Annotation, DamageEvent, CastEvent } from '@/types/timeline'
import { buildTrackIndexMap, trackKey, type SkillTrack } from '@/utils/skillTracks'
import type { MitigationAction } from '@/types/mitigation'
import { effectiveTrackGroup } from '@/types/mitigation'
import { computeDamageCardGeometry } from './cardGeometry'

/** 协作者名字标签:彩色底色 + 白色字体。x/y 为标签左上角。 */
function PeerNameTag({ x, y, name, color }: { x: number; y: number; name: string; color: string }) {
  return (
    <Label x={x} y={y} listening={false}>
      <Tag fill={color} cornerRadius={2} perfectDrawEnabled={false} />
      <Text
        text={name}
        fontSize={10}
        fontFamily="Arial, sans-serif"
        fill="#ffffff"
        padding={2}
        listening={false}
        perfectDrawEnabled={false}
      />
    </Label>
  )
}

/** 名字标签近似高度(fontSize 10 + 上下 padding 2),用于多标签纵向错开 */
const NAME_TAG_HEIGHT = 15

/**
 * 群组拖动 delta：抓手 ghost 当前时间 − 抓手原始时间。
 * 随动对象在「各自原始时间 + delta」处画 ghost，复用已平滑的 dragging.time。
 * 抓手或其原始时间查不到则返回 null（调用方据此跳过群组 ghost）。
 */
function groupDragDelta(
  dragging: PeerState['dragging'],
  lookupOriginalTime: (id: string, kind: 'damage' | 'cast' | 'annotation') => number | undefined
): number | null {
  if (!dragging) return null
  const orig = lookupOriginalTime(dragging.id, dragging.kind)
  if (orig == null) return null
  return dragging.time - orig
}

// ─────────────────────────────────────────────
// 固定区域 overlay（伤害事件高亮 + 光标线）
// ─────────────────────────────────────────────

interface PeerOverlayFixedProps {
  zoomLevel: number
  /** filteredDamageEvents，与 DamageEventTrack 保持一致 */
  damageEvents: DamageEvent[]
  /** DamageEventTrack 计算出的 eventId → 行号映射 */
  damageEventRowMap: Map<string, number>
  /** timeRulerHeight */
  yOffset: number
  /** LANE_ROW_HEIGHT (36) */
  rowHeight: number
  /** 固定区域总高度（用于光标线纵向跨度） */
  fixedAreaHeight: number
  /** DamageEventTrack 渲染的伤害轨道高度（trackHeight），用于 annotation ghost y 计算 */
  damageTrackHeight: number
  /** 伤害轨道 annotations，用于 annotation ghost 查找 */
  annotations: Annotation[]
  /** 全量 castEvents：仅用于「抓手是 cast」时反查其原始时间以求群组 delta（不渲染 cast） */
  castEvents: CastEvent[]
}

export function PeerOverlayFixed({
  zoomLevel,
  damageEvents,
  damageEventRowMap,
  yOffset,
  rowHeight,
  fixedAreaHeight,
  damageTrackHeight,
  annotations,
  castEvents,
}: PeerOverlayFixedProps) {
  // 在 overlay 内部调用而非父组件下发：使每帧 setState 只重渲本 overlay，不波及主画布
  const peers = useSmoothedPeers(zoomLevel)
  // 构建 eventId → DamageEvent 快速查找
  const damageEventById = useMemo(() => {
    const map = new Map<string, DamageEvent>()
    for (const ev of damageEvents) {
      map.set(ev.id, ev)
    }
    return map
  }, [damageEvents])

  // 构建 annotationId → Annotation 快速查找（仅伤害轨道备注）
  const annotationById = useMemo(() => {
    const map = new Map<string, Annotation>()
    for (const a of annotations) {
      map.set(a.id, a)
    }
    return map
  }, [annotations])

  // castEventId → timestamp：仅用于抓手是 cast 时反查原始时间求 delta
  const castTimestampById = useMemo(() => {
    const map = new Map<string, number>()
    for (const ce of castEvents) map.set(ce.id, ce.timestamp)
    return map
  }, [castEvents])

  if (peers.length === 0) return null

  // 同一个 damage event 可能被多个 peer 选中 → 记录每个 event 已渲染的 label 数量
  const labelCountByEventId = new Map<string, number>()

  const nodes: React.ReactNode[] = []

  for (const peer of peers) {
    // ── 伤害事件选中高亮 ──
    for (const eventId of peer.selection.eventIds) {
      const ev = damageEventById.get(eventId)
      const row = damageEventRowMap.get(eventId)
      if (ev != null && row != null) {
        const CARD_H = 30
        const geom = computeDamageCardGeometry(ev, zoomLevel)
        const cardX = ev.time * zoomLevel + geom.leftLocal
        const cardY = yOffset + row * rowHeight + (rowHeight - CARD_H) / 2

        // 拖动自己选中的伤害事件时,初始位置选框不重复画昵称(昵称跟随实时 ghost)
        const draggingThis = peer.dragging?.kind === 'damage' && peer.dragging.id === eventId

        let nameTag: React.ReactNode = null
        if (!draggingThis) {
          const labelIdx = labelCountByEventId.get(eventId) ?? 0
          labelCountByEventId.set(eventId, labelIdx + 1)
          nameTag = (
            <PeerNameTag
              x={cardX}
              y={cardY - NAME_TAG_HEIGHT - labelIdx * NAME_TAG_HEIGHT}
              name={peer.user.name}
              color={peer.user.color}
            />
          )
        }

        nodes.push(
          <Fragment key={`peer-dmg-${peer.clientId}-${eventId}`}>
            <Rect
              x={cardX}
              y={cardY}
              width={geom.width}
              height={CARD_H}
              stroke={peer.user.color}
              strokeWidth={2}
              fill="transparent"
              listening={false}
              perfectDrawEnabled={false}
            />
            {nameTag}
          </Fragment>
        )
      }
    }

    // ── 伤害事件拖动 ghost ──
    if (peer.dragging?.kind === 'damage') {
      const { id: dragId, time: dragTime } = peer.dragging
      const ev = damageEventById.get(dragId)
      const row = damageEventRowMap.get(dragId)
      if (ev != null && row != null) {
        const CARD_H = 30
        const geom = computeDamageCardGeometry(ev, zoomLevel)
        const ghostX = dragTime * zoomLevel + geom.leftLocal
        const ghostY = yOffset + row * rowHeight + (rowHeight - CARD_H) / 2
        nodes.push(
          <Fragment key={`peer-ghost-dmg-${peer.clientId}`}>
            <Rect
              x={ghostX}
              y={ghostY}
              width={geom.width}
              height={CARD_H}
              fill={peer.user.color}
              opacity={0.55}
              stroke={peer.user.color}
              strokeWidth={1}
              cornerRadius={4}
              listening={false}
              perfectDrawEnabled={false}
            />
            <PeerNameTag
              x={ghostX + 4}
              y={ghostY + CARD_H - NAME_TAG_HEIGHT - 1}
              name={peer.user.name}
              color={peer.user.color}
            />
          </Fragment>
        )
      }
    }

    // ── 备注拖动 ghost（伤害轨道） ──
    if (peer.dragging?.kind === 'annotation') {
      const { id: dragId, time: dragTime } = peer.dragging
      const annotation = annotationById.get(dragId)
      // 只处理 damageTrack 锚定的备注（skillTrack 备注由 PeerOverlayMain 负责）
      if (annotation?.anchor.type === 'damageTrack') {
        const ICON_SIZE = 22
        const ghostX = dragTime * zoomLevel - ICON_SIZE / 2
        const ghostY = yOffset + damageTrackHeight - 20 - ICON_SIZE / 2
        nodes.push(
          <Fragment key={`peer-ghost-annotation-fixed-${peer.clientId}`}>
            <Rect
              x={ghostX}
              y={ghostY}
              width={ICON_SIZE}
              height={ICON_SIZE}
              fill={peer.user.color}
              opacity={0.55}
              stroke={peer.user.color}
              strokeWidth={1}
              cornerRadius={3}
              listening={false}
              perfectDrawEnabled={false}
            />
            <PeerNameTag
              x={ghostX + 2}
              y={ghostY + ICON_SIZE + 2}
              name={peer.user.name}
              color={peer.user.color}
            />
          </Fragment>
        )
      }
    }

    // ── 群组拖动随动 ghost（伤害 + 伤害轨道备注，不画昵称） ──
    // delta 由抓手 dragging（已平滑）派生；随动对象在 各自原始时间 + delta 处画 ghost。
    const delta = groupDragDelta(peer.dragging, (id, kind) =>
      kind === 'damage'
        ? damageEventById.get(id)?.time
        : kind === 'cast'
          ? castTimestampById.get(id)
          : annotationById.get(id)?.time
    )
    if (delta != null) {
      // 随动伤害事件
      for (const eventId of peer.dragGroup.eventIds) {
        const ev = damageEventById.get(eventId)
        const row = damageEventRowMap.get(eventId)
        if (ev == null || row == null) continue
        const CARD_H = 30
        const geom = computeDamageCardGeometry(ev, zoomLevel)
        const ghostX = (ev.time + delta) * zoomLevel + geom.leftLocal
        const ghostY = yOffset + row * rowHeight + (rowHeight - CARD_H) / 2
        nodes.push(
          <Rect
            key={`${peer.clientId}-group-dmg-${eventId}`}
            x={ghostX}
            y={ghostY}
            width={geom.width}
            height={CARD_H}
            fill={peer.user.color}
            opacity={0.55}
            stroke={peer.user.color}
            strokeWidth={1}
            cornerRadius={4}
            listening={false}
            perfectDrawEnabled={false}
          />
        )
      }
      // 随动伤害轨道备注
      for (const annId of peer.dragGroup.annotationIds) {
        const annotation = annotationById.get(annId)
        if (annotation?.anchor.type !== 'damageTrack') continue
        const ICON_SIZE = 22
        const ghostX = (annotation.time + delta) * zoomLevel - ICON_SIZE / 2
        const ghostY = yOffset + damageTrackHeight - 20 - ICON_SIZE / 2
        nodes.push(
          <Rect
            key={`${peer.clientId}-group-ann-${annId}`}
            x={ghostX}
            y={ghostY}
            width={ICON_SIZE}
            height={ICON_SIZE}
            fill={peer.user.color}
            opacity={0.55}
            stroke={peer.user.color}
            strokeWidth={1}
            cornerRadius={3}
            listening={false}
            perfectDrawEnabled={false}
          />
        )
      }
    }

    // ── 悬停光标线 ──
    if (peer.cursorTime != null) {
      const cx = peer.cursorTime * zoomLevel
      nodes.push(
        <Fragment key={`peer-cursor-fixed-${peer.clientId}`}>
          <Line
            points={[cx, 0, cx, fixedAreaHeight]}
            stroke={peer.user.color}
            strokeWidth={1}
            dash={[4, 3]}
            opacity={0.75}
            listening={false}
            perfectDrawEnabled={false}
          />
          <PeerNameTag x={cx + 3} y={4} name={peer.user.name} color={peer.user.color} />
        </Fragment>
      )
    }
  }

  return <>{nodes}</>
}

// ─────────────────────────────────────────────
// 主 Stage overlay（cast 事件高亮 + 光标线）
// ─────────────────────────────────────────────

interface PeerOverlayMainProps {
  zoomLevel: number
  /** 全量 castEvents,与 SkillTracksCanvas 渲染保持一致(勿传 filtered 子集) */
  castEvents: CastEvent[]
  skillTracks: SkillTrack[]
  /** 用于 castEvent.actionId → trackGroup 查找 */
  actionMap: Map<number, MitigationAction>
  /** skillTrackHeight (40) */
  trackHeight: number
  /** 主区域内容总高度（光标线纵向跨度） */
  skillTracksHeight: number
  /** 技能轨道 annotations，用于 annotation ghost 查找 */
  annotations: Annotation[]
  /** 全量 damageEvents：仅用于「抓手是 damage」时反查其原始时间以求群组 delta（不渲染 damage） */
  damageEvents: DamageEvent[]
}

export function PeerOverlayMain({
  zoomLevel,
  castEvents,
  skillTracks,
  actionMap,
  trackHeight,
  skillTracksHeight,
  annotations,
  damageEvents,
}: PeerOverlayMainProps) {
  // 在 overlay 内部调用而非父组件下发：使每帧 setState 只重渲本 overlay，不波及主画布
  const peers = useSmoothedPeers(zoomLevel)
  // castEventId → CastEvent 快速查找
  const castEventById = useMemo(() => {
    const map = new Map<string, CastEvent>()
    for (const ce of castEvents) {
      map.set(ce.id, ce)
    }
    return map
  }, [castEvents])

  // 构建 annotationId → Annotation 快速查找（仅技能轨道备注）
  const annotationById = useMemo(() => {
    const map = new Map<string, Annotation>()
    for (const a of annotations) {
      map.set(a.id, a)
    }
    return map
  }, [annotations])

  // damageEventId → time：仅用于抓手是 damage 时反查原始时间求 delta
  const damageTimeById = useMemo(() => {
    const map = new Map<string, number>()
    for (const ev of damageEvents) map.set(ev.id, ev.time)
    return map
  }, [damageEvents])

  // (playerId, actionId) → skillTracks 下标 查找表
  const trackIndexMap = useMemo(() => buildTrackIndexMap(skillTracks), [skillTracks])

  // castEventId → trackIndex：通过 playerId + effectiveTrackGroup 匹配
  const castEventTrackIndex = useMemo(() => {
    const trackIndex = new Map<string, number>()
    for (const ce of castEvents) {
      const action = actionMap.get(ce.actionId)
      if (!action) continue
      const groupId = effectiveTrackGroup(action)
      const idx = trackIndexMap.get(trackKey(ce.playerId, groupId)) ?? -1
      if (idx !== -1) {
        trackIndex.set(ce.id, idx)
      }
    }
    return trackIndex
  }, [castEvents, actionMap, trackIndexMap])

  if (peers.length === 0) return null

  // 同一 cast 被多个 peer 选中时错开 label
  const labelCountByCastId = new Map<string, number>()

  const nodes: React.ReactNode[] = []

  for (const peer of peers) {
    // ── cast 事件选中高亮 ──
    for (const castEventId of peer.selection.castEventIds) {
      const ce = castEventById.get(castEventId)
      const trackIdx = castEventTrackIndex.get(castEventId)
      if (ce != null && trackIdx != null) {
        // cast icon 30×30:X 是左边缘(对齐生效时刻,见 CastEventIcon 的 Group x=timestamp*zoom),
        // Y 纵向居中于轨道
        const ICON_SIZE = 30
        const iconX = ce.timestamp * zoomLevel
        const iconY = trackIdx * trackHeight + trackHeight / 2 - ICON_SIZE / 2

        // 拖动自己选中的 cast 时,初始位置选框不重复画昵称(昵称跟随实时 ghost)
        const draggingThis = peer.dragging?.kind === 'cast' && peer.dragging.id === castEventId

        let nameTag: React.ReactNode = null
        if (!draggingThis) {
          const labelIdx = labelCountByCastId.get(castEventId) ?? 0
          labelCountByCastId.set(castEventId, labelIdx + 1)
          nameTag = (
            <PeerNameTag
              x={iconX}
              y={iconY - NAME_TAG_HEIGHT - labelIdx * NAME_TAG_HEIGHT}
              name={peer.user.name}
              color={peer.user.color}
            />
          )
        }

        nodes.push(
          <Fragment key={`peer-cast-${peer.clientId}-${castEventId}`}>
            <Rect
              x={iconX}
              y={iconY}
              width={ICON_SIZE}
              height={ICON_SIZE}
              stroke={peer.user.color}
              strokeWidth={2}
              fill="transparent"
              listening={false}
              perfectDrawEnabled={false}
            />
            {nameTag}
          </Fragment>
        )
      }
    }

    // ── cast 事件拖动 ghost ──
    if (peer.dragging?.kind === 'cast') {
      const { id: dragId, time: dragTime, playerId } = peer.dragging
      // 通过 playerId 找轨道索引：任意匹配该 playerId 的轨道均可用作目标行
      // 优先用原 castEvent 的轨道（保持垂直位置锁定语义）
      const ce = castEventById.get(dragId)
      const origTrackIdx = ce != null ? castEventTrackIndex.get(dragId) : undefined
      // 若原 cast 不在映射中（可能已切换变体），fallback 到 playerId 首个轨道
      const fallbackTrackIdx =
        playerId != null ? skillTracks.findIndex(t => t.playerId === playerId) : undefined
      const trackIdx = origTrackIdx ?? fallbackTrackIdx
      if (trackIdx != null && trackIdx !== -1) {
        // cast icon 左边缘对齐生效时刻,纵向居中于轨道
        const ICON_SIZE = 30
        const ghostX = dragTime * zoomLevel
        const ghostY = trackIdx * trackHeight + trackHeight / 2 - ICON_SIZE / 2
        nodes.push(
          <Fragment key={`peer-ghost-cast-${peer.clientId}`}>
            <Rect
              x={ghostX}
              y={ghostY}
              width={ICON_SIZE}
              height={ICON_SIZE}
              fill={peer.user.color}
              opacity={0.55}
              stroke={peer.user.color}
              strokeWidth={1}
              cornerRadius={4}
              listening={false}
              perfectDrawEnabled={false}
            />
            <PeerNameTag
              x={ghostX + 2}
              y={ghostY + ICON_SIZE + 2}
              name={peer.user.name}
              color={peer.user.color}
            />
          </Fragment>
        )
      }
    }

    // ── 备注拖动 ghost（技能轨道） ──
    if (peer.dragging?.kind === 'annotation') {
      const { id: dragId, time: dragTime } = peer.dragging
      const annotation = annotationById.get(dragId)
      // 只处理 skillTrack 锚定的备注（damageTrack 备注由 PeerOverlayFixed 负责）
      if (annotation?.anchor.type === 'skillTrack') {
        const anchor = annotation.anchor
        const trackIndex = trackIndexMap.get(trackKey(anchor.playerId, anchor.actionId)) ?? -1
        if (trackIndex !== -1) {
          const ICON_SIZE = 22
          const ghostCenterY = trackIndex * trackHeight + trackHeight / 2
          const ghostX = dragTime * zoomLevel - ICON_SIZE / 2
          const ghostY = ghostCenterY - ICON_SIZE / 2
          nodes.push(
            <Fragment key={`peer-ghost-annotation-main-${peer.clientId}`}>
              <Rect
                x={ghostX}
                y={ghostY}
                width={ICON_SIZE}
                height={ICON_SIZE}
                fill={peer.user.color}
                opacity={0.55}
                stroke={peer.user.color}
                strokeWidth={1}
                cornerRadius={3}
                listening={false}
                perfectDrawEnabled={false}
              />
              <PeerNameTag
                x={ghostX + 2}
                y={ghostY + ICON_SIZE + 2}
                name={peer.user.name}
                color={peer.user.color}
              />
            </Fragment>
          )
        }
      }
    }

    // ── 群组拖动随动 ghost（cast + 技能轨道备注，不画昵称） ──
    const delta = groupDragDelta(peer.dragging, (id, kind) =>
      kind === 'cast'
        ? castEventById.get(id)?.timestamp
        : kind === 'damage'
          ? damageTimeById.get(id)
          : annotationById.get(id)?.time
    )
    if (delta != null) {
      // 随动 cast
      for (const castEventId of peer.dragGroup.castEventIds) {
        const ce = castEventById.get(castEventId)
        const trackIdx = castEventTrackIndex.get(castEventId)
        if (ce == null || trackIdx == null) continue
        const ICON_SIZE = 30
        const ghostX = (ce.timestamp + delta) * zoomLevel
        const ghostY = trackIdx * trackHeight + trackHeight / 2 - ICON_SIZE / 2
        nodes.push(
          <Rect
            key={`${peer.clientId}-group-cast-${castEventId}`}
            x={ghostX}
            y={ghostY}
            width={ICON_SIZE}
            height={ICON_SIZE}
            fill={peer.user.color}
            opacity={0.55}
            stroke={peer.user.color}
            strokeWidth={1}
            cornerRadius={4}
            listening={false}
            perfectDrawEnabled={false}
          />
        )
      }
      // 随动技能轨道备注
      for (const annId of peer.dragGroup.annotationIds) {
        const annotation = annotationById.get(annId)
        if (annotation?.anchor.type !== 'skillTrack') continue
        const anchor = annotation.anchor
        const trackIndex = trackIndexMap.get(trackKey(anchor.playerId, anchor.actionId)) ?? -1
        if (trackIndex === -1) continue
        const ICON_SIZE = 22
        const ghostCenterY = trackIndex * trackHeight + trackHeight / 2
        const ghostX = (annotation.time + delta) * zoomLevel - ICON_SIZE / 2
        const ghostY = ghostCenterY - ICON_SIZE / 2
        nodes.push(
          <Rect
            key={`${peer.clientId}-group-ann-${annId}`}
            x={ghostX}
            y={ghostY}
            width={ICON_SIZE}
            height={ICON_SIZE}
            fill={peer.user.color}
            opacity={0.55}
            stroke={peer.user.color}
            strokeWidth={1}
            cornerRadius={3}
            listening={false}
            perfectDrawEnabled={false}
          />
        )
      }
    }

    // ── 悬停光标线（名字标签只在固定区时间标尺处画，见 PeerOverlayFixed；此处只画竖线） ──
    if (peer.cursorTime != null) {
      const cx = peer.cursorTime * zoomLevel
      nodes.push(
        <Line
          key={`peer-cursor-main-${peer.clientId}`}
          points={[cx, 0, cx, skillTracksHeight]}
          stroke={peer.user.color}
          strokeWidth={1}
          dash={[4, 3]}
          opacity={0.75}
          listening={false}
          perfectDrawEnabled={false}
        />
      )
    }
  }

  return <>{nodes}</>
}
