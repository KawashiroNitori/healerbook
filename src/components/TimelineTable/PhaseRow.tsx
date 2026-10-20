/**
 * 表格视图的阶段分隔行
 *
 * - 吸顶：当前阶段行 sticky 在表头下方，滚到下一阶段时被新的阶段行顶替。
 * - 背景从时间列开始由该色渐变到透明，铺到表格最右；阶段名像备注行一样 sticky 在可视区左侧。
 * - 可编辑时：单击时间直接输入、双击名称改名、行尾改名 / 删除按钮、右键更多。
 */

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Trash2 } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { formatTimeWithDecimal } from '@/utils/formatters'
import { parseTimeString } from '@/components/ui/time-input-utils'
import { phaseColorAlpha, phaseTextColor } from '@/utils/timelinePhases'
import type { TimelinePhase } from '@/types/timeline'
import PhaseNameInput from '../PhaseNameInput'
import { TIME_COL_WIDTH, CAST_START_COL_WIDTH, PHASE_ROW_HEIGHT } from './constants'

interface PhaseRowProps {
  phase: TimelinePhase
  color: string
  /** 除时间列外的剩余列数（用于 colSpan） */
  restColSpan: number
  /** 外层滚动容器可视宽度 */
  wrapperWidth: number
  /** 表格总宽度 */
  tableWidth: number
  showCastStartTime: boolean
  /** 吸顶位置：表头的实际高度（技能列头可能把表头撑得比 HEADER_HEIGHT 高） */
  stickyTop: number
  isReadOnly: boolean
  /** 当前正在编辑的字段 */
  editing: 'name' | 'time' | null
  onStartEdit: (field: 'name' | 'time') => void
  onEndEdit: () => void
  onRename: (name: string) => void
  onChangeTime: (time: number) => void
  onDelete: (anchor: DOMRect) => void
  onContextMenu: (clientX: number, clientY: number) => void
}

/** 时间直接输入框：Enter / 失焦确认，Esc 取消；无法解析视为取消 */
function PhaseTimeInput({
  initial,
  color,
  onCommit,
  onCancel,
}: {
  initial: number
  color: string
  onCommit: (time: number) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const settledRef = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (commit: boolean) => {
    if (settledRef.current) return
    settledRef.current = true
    const tenths = commit ? parseTimeString(ref.current?.value ?? '') : null
    if (tenths === null) onCancel()
    else onCommit(tenths / 10)
  }
  return (
    <input
      ref={ref}
      defaultValue={formatTimeWithDecimal(initial)}
      className="w-full rounded border-[1.5px] bg-background px-1 py-px text-right text-xs font-semibold tabular-nums text-foreground outline-none"
      style={{ borderColor: color }}
      autoComplete="off"
      data-1p-ignore
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    />
  )
}

export default function PhaseRow({
  phase,
  color,
  restColSpan,
  wrapperWidth,
  tableWidth,
  showCastStartTime,
  stickyTop,
  isReadOnly,
  editing,
  onStartEdit,
  onEndEdit,
  onRename,
  onChangeTime,
  onDelete,
  onContextMenu,
}: PhaseRowProps) {
  const { t } = useTranslation('editor')
  const isDark = useUIStore(s => s.theme === 'dark')
  const textColor = isDark ? color : phaseTextColor(color)
  const borderColor = phaseColorAlpha(color, 0.3)
  const leadingBorder = `3px solid ${color}`

  const timeLeft = showCastStartTime ? CAST_START_COL_WIDTH : 0
  const leadingWidth = timeLeft + TIME_COL_WIDTH
  const nameWidth = Math.max(0, Math.min(tableWidth, wrapperWidth) - leadingWidth)

  // 吸顶单元格需要实底，避免下方内容透出
  const solid = 'hsl(var(--background))'
  const cellStyle = {
    position: 'sticky' as const,
    top: stickyTop,
    height: PHASE_ROW_HEIGHT,
    padding: 0,
    borderBottom: `1px solid ${borderColor}`,
  }
  // 覆盖上一行的下边线，使阶段行上边缘也呈该色浅色
  const topEdge = (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -top-px h-px"
      style={{ background: borderColor }}
    />
  )

  return (
    <tr
      className="group/phase"
      data-row-time={phase.time}
      data-phase-id={phase.id}
      onContextMenu={e => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(e.clientX, e.clientY)
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* 阶段行的左边缘（色条 + 渐变起点）始终落在最左一列：显示咏唱开始列时从它开始 */}
      {showCastStartTime && (
        <td
          className="z-[13]"
          style={{
            ...cellStyle,
            left: 0,
            width: CAST_START_COL_WIDTH,
            minWidth: CAST_START_COL_WIDTH,
            borderLeft: leadingBorder,
            background: `linear-gradient(to right, ${phaseColorAlpha(color, 0.22)}, ${phaseColorAlpha(color, 0.19)}), ${solid}`,
          }}
        >
          {topEdge}
        </td>
      )}
      <td
        className="z-[13] text-right text-xs font-semibold tabular-nums"
        style={{
          ...cellStyle,
          left: timeLeft,
          width: TIME_COL_WIDTH,
          minWidth: TIME_COL_WIDTH,
          color: textColor,
          borderLeft: showCastStartTime ? undefined : leadingBorder,
          background: `linear-gradient(to right, ${phaseColorAlpha(color, showCastStartTime ? 0.19 : 0.22)}, ${phaseColorAlpha(color, 0.16)}), ${solid}`,
        }}
      >
        {topEdge}
        {editing === 'time' ? (
          <div className="px-1">
            <PhaseTimeInput
              initial={phase.time}
              color={color}
              onCommit={time => {
                onChangeTime(time)
                onEndEdit()
              }}
              onCancel={onEndEdit}
            />
          </div>
        ) : (
          <button
            type="button"
            disabled={isReadOnly}
            title={isReadOnly ? undefined : t('phase.hoverHintTableTime')}
            className="h-full w-full px-2 text-right enabled:cursor-text enabled:hover:underline enabled:hover:decoration-dashed enabled:hover:[box-shadow:inset_0_0_0_1.5px_var(--phase-hover)]"
            style={{ '--phase-hover': phaseColorAlpha(color, 0.55) } as React.CSSProperties}
            onClick={() => onStartEdit('time')}
          >
            {formatTimeWithDecimal(phase.time)}
          </button>
        )}
      </td>
      <td
        colSpan={restColSpan}
        className="z-[12]"
        style={{
          ...cellStyle,
          background: `linear-gradient(to right, ${phaseColorAlpha(color, 0.16)}, ${phaseColorAlpha(color, 0)}), ${solid}`,
        }}
      >
        {topEdge}
        <div
          className="sticky flex h-full items-center gap-1 px-2.5 text-xs font-semibold"
          style={{ left: leadingWidth, width: nameWidth, maxWidth: nameWidth, color: textColor }}
        >
          {editing === 'name' ? (
            <PhaseNameInput
              initialName={phase.name}
              color={color}
              className="w-[180px]"
              onCommit={name => {
                onRename(name)
                onEndEdit()
              }}
              onCancel={onEndEdit}
            />
          ) : (
            <>
              <span
                className={`truncate rounded px-1 ${isReadOnly ? '' : 'cursor-text hover:bg-[var(--phase-hover)]'}`}
                style={{ '--phase-hover': phaseColorAlpha(color, 0.14) } as React.CSSProperties}
                title={isReadOnly ? undefined : t('phase.hoverHintTableName')}
                onDoubleClick={() => !isReadOnly && onStartEdit('name')}
              >
                {phase.name}
              </span>
              {!isReadOnly && (
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/phase:opacity-100">
                  <button
                    type="button"
                    title={t('phase.renameTooltip')}
                    className="rounded p-0.5 hover:bg-foreground/10"
                    onClick={() => onStartEdit('name')}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    title={t('phase.delete')}
                    className="rounded p-0.5 text-destructive hover:bg-destructive/10"
                    onClick={e => onDelete(e.currentTarget.getBoundingClientRect())}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  )
}
