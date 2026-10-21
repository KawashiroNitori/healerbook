/**
 * 时间标尺上的阶段名。
 *
 * - 未选中：竖线右侧无底色的彩色粗体文字；悬停淡底色 + 左右拖动光标 + 延迟提示。
 * - 选中：该色实底标签，内含名称、开始时间、改名与删除按钮。
 * - 可编辑时整块可横向拖动（松开时才提交，一次拖动一步撤销），双击改名，右键更多。
 *
 * 标签几何由 phaseLabelLayout 统一计算，标尺据此隐藏被挡住的刻度。
 */

import { useEffect, useRef, useState } from 'react'
import { Group, Path, Rect, Text } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { formatTimeWithDecimal } from '@/utils/formatters'
import { phaseColorAlpha, phaseTextColor } from '@/utils/timelinePhases'
import type { PhaseMarker } from './PhaseBands'
import { PHASE_LABEL, type PhaseLabelBox } from './phaseLabelLayout'
import { useUIStore } from '@/store/uiStore'

const {
  FONT_SIZE,
  NAME_OFFSET,
  CHIP_OFFSET,
  CHIP_PAD_LEFT,
  CHIP_GAP,
  ICON_BOX,
  ICON_PAD_RIGHT,
  Y: LABEL_Y,
  HEIGHT: LABEL_HEIGHT,
} = PHASE_LABEL
const HINT_DELAY_MS = 450

/** lucide 的铅笔 / 垃圾桶路径（24×24 视窗，缩放到 12px） */
const PENCIL_PATH = 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'
const TRASH_PATH = 'M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6'

export interface PhaseHint {
  text: string
  /** 快捷键标签，以 Kbd 显示在文案后 */
  shortcut?: string
  /** 视口坐标（clientX / clientY） */
  x: number
  y: number
}

interface PhaseLabelsProps {
  phases: PhaseMarker[]
  /** 标签几何（含选中态），由 computePhaseLabelBoxes 产出 */
  boxes: Map<string, PhaseLabelBox>
  zoomLevel: number
  /** 正在改名的阶段：隐藏其标签，由 HTML 输入框覆盖 */
  editingPhaseId: string | null
  isReadOnly: boolean
  fontFamily: string
  hints: {
    idle: string
    selected: string
    rename: string
    remove: string
    removeShortcut: string
  }
  onSelect: (id: string) => void
  /** 拖动中：返回钳制后的时间，标签吸附到该位置 */
  onDragMove: (id: string, rawTime: number) => number
  onDragEnd: (id: string, rawTime: number) => void
  onRename: (id: string) => void
  onDelete: (id: string, anchor: DOMRect) => void
  onContextMenu: (id: string, clientX: number, clientY: number) => void
  onHint: (hint: PhaseHint | null) => void
}

/** Konva 节点 → 视口矩形 */
function clientRectOf(node: Konva.Node): DOMRect {
  const stage = node.getStage()
  const box = node.getClientRect()
  const origin = stage?.container().getBoundingClientRect()
  return new DOMRect((origin?.left ?? 0) + box.x, (origin?.top ?? 0) + box.y, box.width, box.height)
}

export default function PhaseLabels({
  phases,
  boxes,
  zoomLevel,
  editingPhaseId,
  isReadOnly,
  fontFamily,
  hints,
  onSelect,
  onDragMove,
  onDragEnd,
  onRename,
  onDelete,
  onContextMenu,
  onHint,
}: PhaseLabelsProps) {
  const isDark = useUIStore(s => s.theme === 'dark')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hoveredIcon, setHoveredIcon] = useState<'rename' | 'delete' | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draggingRef = useRef(false)

  const clearHint = () => {
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = null
    onHint(null)
  }
  // 卸载时清理延迟提示
  useEffect(
    () => () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    },
    []
  )

  const scheduleHint = (node: Konva.Node, text: string, shortcut?: string) => {
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => {
      if (draggingRef.current) return
      const r = clientRectOf(node)
      onHint({ text, shortcut, x: r.left, y: r.bottom + 4 })
    }, HINT_DELAY_MS)
  }

  const setCursor = (e: KonvaEventObject<MouseEvent>, cursor: string) => {
    const container = e.target.getStage()?.container()
    if (container) container.style.cursor = cursor
  }

  const editable = !isReadOnly

  return (
    <>
      {phases.map(p => {
        if (p.id === editingPhaseId) return null
        const box = boxes.get(p.id)
        if (!box) return null
        const x = p.time * zoomLevel
        // 浅色背景用加深色保证对比度；深色背景直接用原色
        const textColor = isDark ? p.color : phaseTextColor(p.color)
        const isHovered = hoveredId === p.id
        const iconsLeft = box.left - x + box.width - ICON_PAD_RIGHT - ICON_BOX * 2

        return (
          <Group
            key={p.id}
            name="phaseLabel"
            x={x}
            y={0}
            draggable={editable}
            dragDistance={3}
            // 只允许横向拖动；标尺所在 Layer 不做纵向偏移，绝对 y 恒为 0
            dragBoundFunc={pos => ({ x: pos.x, y: 0 })}
            onMouseEnter={e => {
              setHoveredId(p.id)
              if (editable) {
                setCursor(e, 'ew-resize')
                scheduleHint(e.currentTarget, box.selected ? hints.selected : hints.idle)
              }
            }}
            onMouseLeave={e => {
              setHoveredId(null)
              setHoveredIcon(null)
              setCursor(e, '')
              clearHint()
            }}
            onClick={e => {
              if (e.evt.button !== 0) return
              e.cancelBubble = true
              onSelect(p.id)
            }}
            onTap={() => onSelect(p.id)}
            onDblClick={e => {
              e.cancelBubble = true
              if (editable) onRename(p.id)
            }}
            onContextMenu={e => {
              e.evt.preventDefault()
              e.cancelBubble = true
              clearHint()
              onContextMenu(p.id, e.evt.clientX, e.evt.clientY)
            }}
            onDragStart={() => {
              draggingRef.current = true
              clearHint()
            }}
            onDragMove={e => {
              const node = e.target
              const clamped = onDragMove(p.id, node.x() / zoomLevel)
              node.x(clamped * zoomLevel)
            }}
            onDragEnd={e => {
              draggingRef.current = false
              onDragEnd(p.id, e.target.x() / zoomLevel)
            }}
          >
            {box.selected ? (
              <>
                <Rect
                  x={CHIP_OFFSET}
                  y={LABEL_Y}
                  width={box.width}
                  height={LABEL_HEIGHT}
                  fill={p.color}
                  cornerRadius={4}
                  perfectDrawEnabled={false}
                  shadowEnabled={false}
                />
                <Text
                  x={CHIP_OFFSET + CHIP_PAD_LEFT}
                  y={LABEL_Y + 4}
                  text={p.name}
                  fontSize={FONT_SIZE}
                  fontStyle="bold"
                  fontFamily={fontFamily}
                  fill="#ffffff"
                  listening={false}
                  perfectDrawEnabled={false}
                />
                <Text
                  x={CHIP_OFFSET + CHIP_PAD_LEFT + box.nameWidth + CHIP_GAP}
                  y={LABEL_Y + 4}
                  text={formatTimeWithDecimal(p.time)}
                  fontSize={FONT_SIZE}
                  fontFamily={fontFamily}
                  fill="#ffffff"
                  opacity={0.8}
                  listening={false}
                  perfectDrawEnabled={false}
                />
                {editable &&
                  (['rename', 'delete'] as const).map((kind, i) => (
                    <Group
                      key={kind}
                      x={iconsLeft + i * ICON_BOX}
                      y={LABEL_Y + 2}
                      onMouseEnter={e => {
                        setHoveredIcon(kind)
                        setCursor(e, 'pointer')
                        if (kind === 'rename') scheduleHint(e.currentTarget, hints.rename)
                        else scheduleHint(e.currentTarget, hints.remove, hints.removeShortcut)
                      }}
                      onMouseLeave={e => {
                        setHoveredIcon(null)
                        setCursor(e, 'ew-resize')
                        scheduleHint(e.currentTarget.getParent()!, hints.selected)
                      }}
                      onClick={e => {
                        e.cancelBubble = true
                        clearHint()
                        if (kind === 'rename') onRename(p.id)
                        else onDelete(p.id, clientRectOf(e.currentTarget))
                      }}
                      onDblClick={e => {
                        e.cancelBubble = true
                      }}
                    >
                      <Rect
                        width={ICON_BOX}
                        height={16}
                        cornerRadius={3}
                        fill={
                          isHovered && hoveredIcon === kind
                            ? 'rgba(255, 255, 255, 0.28)'
                            : 'rgba(255, 255, 255, 0)'
                        }
                        perfectDrawEnabled={false}
                      />
                      <Path
                        x={3}
                        y={2}
                        scaleX={0.5}
                        scaleY={0.5}
                        data={kind === 'rename' ? PENCIL_PATH : TRASH_PATH}
                        stroke="#ffffff"
                        strokeWidth={2.4}
                        lineCap="round"
                        lineJoin="round"
                        opacity={isHovered && hoveredIcon === kind ? 1 : 0.85}
                        listening={false}
                        perfectDrawEnabled={false}
                      />
                    </Group>
                  ))}
              </>
            ) : (
              <>
                <Rect
                  x={NAME_OFFSET - 2}
                  y={LABEL_Y}
                  width={box.width}
                  height={LABEL_HEIGHT}
                  cornerRadius={4}
                  fill={editable && isHovered ? phaseColorAlpha(p.color, 0.14) : 'rgba(0, 0, 0, 0)'}
                  perfectDrawEnabled={false}
                  shadowEnabled={false}
                />
                <Text
                  x={NAME_OFFSET}
                  y={LABEL_Y + 4}
                  text={p.name}
                  fontSize={FONT_SIZE}
                  fontStyle="bold"
                  fontFamily={fontFamily}
                  fill={textColor}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              </>
            )}
          </Group>
        )
      })}
    </>
  )
}
