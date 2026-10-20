/**
 * 工具栏最右端的阶段跳转入口。
 *
 * - 入口显示「当前所在阶段」（由当前视图写入的阅读位置判定），文字随工具栏宽度分三档。
 * - 下拉：列出全部阶段，选择即跳转；悬停项时右侧时间被改名 / 删除按钮顶替；
 *   底部「在当前位置添加阶段」。只读时只能看和跳转。
 * - 无阶段时：可编辑显示虚线「＋ 阶段」，点击直接添加；只读显示「无阶段」。
 */

import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatTimeMinSec } from '@/utils/formatters'
import {
  currentPhaseIndex,
  phaseColor,
  phaseColorAlpha,
  phaseTextColor,
  shortPhaseLabel,
  sortPhases,
} from '@/utils/timelinePhases'
import PhaseNameInput from './PhaseNameInput'
import PhaseDeleteConfirm, { type PhaseDeleteRequest } from './PhaseDeleteConfirm'
import { addPhaseAt, removePhase, renamePhase } from './phaseActions'

/** 入口文字三档的工具栏宽度阈值（px） */
const FULL_LABEL_MIN_WIDTH = 900
const SHORT_WITH_TIME_MIN_WIDTH = 520
/** 无阶段 / 开场前的中性色 */
const NEUTRAL_COLOR = '#9ca3af'

interface PhaseNavigatorProps {
  /** 工具栏总宽度，决定入口文字档位 */
  width: number
}

export default function PhaseNavigator({ width }: PhaseNavigatorProps) {
  const { t } = useTranslation('editor')
  const phases = useTimelineStore(s => s.timeline?.phases)
  const anchorTime = useTimelineStore(s => s.viewAnchorTime)
  const requestScrollToTime = useTimelineStore(s => s.requestScrollToTime)
  const isReadOnly = useEditorReadOnly()
  const isDark = useUIStore(s => s.theme === 'dark')

  const [open, setOpen] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteRequest, setDeleteRequest] = useState<PhaseDeleteRequest | null>(null)
  // 点在项内的改名 / 删除按钮上时，阻止该项的 onSelect（跳转并收起菜单）
  const actionClickRef = useRef(false)

  const sorted = useMemo(() => sortPhases(phases ?? []), [phases])
  const curIdx = currentPhaseIndex(sorted, anchorTime ?? -Infinity)
  const current = curIdx >= 0 ? sorted[curIdx] : null
  const curColor = current ? phaseColor(curIdx) : NEUTRAL_COLOR
  const textColorOf = (color: string) => (isDark ? color : phaseTextColor(color))
  const addTime = Math.round((anchorTime ?? 0) * 10) / 10

  const handleAdd = () => {
    const phase = addPhaseAt(addTime)
    if (!phase) return
    // 新增后在下拉里直接进入改名
    setOpen(true)
    setEditingId(phase.id)
  }

  if (sorted.length === 0) {
    if (isReadOnly) {
      return (
        <span className="text-xs text-muted-foreground whitespace-nowrap">{t('phase.none')}</span>
      )
    }
    return (
      <button
        type="button"
        onClick={handleAdd}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground whitespace-nowrap"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('phase.add')}
      </button>
    )
  }

  const entryLabel = current
    ? width >= FULL_LABEL_MIN_WIDTH
      ? current.name
      : shortPhaseLabel(current.name)
    : t('phase.beforeFirst')
  const showTime = current && width >= SHORT_WITH_TIME_MIN_WIDTH

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={next => {
          setOpen(next)
          if (!next) {
            setEditingId(null)
            setHoveredId(null)
          }
        }}
        modal={false}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={t('phase.jumpTo')}
            className="inline-flex h-7 max-w-[320px] items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium whitespace-nowrap"
            style={{
              borderColor: phaseColorAlpha(curColor, 0.55),
              backgroundColor: phaseColorAlpha(curColor, 0.06),
              color: textColorOf(curColor),
            }}
          >
            <span className="truncate">{entryLabel}</span>
            {showTime && (
              <span className="tabular-nums opacity-70">{formatTimeMinSec(current.time)}</span>
            )}
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64 text-xs"
          onCloseAutoFocus={e => e.preventDefault()}
          // 删除确认框是独立浮层：在其中操作不应收起菜单
          onInteractOutside={e => {
            if ((e.target as Element | null)?.closest?.('[data-phase-delete-confirm]')) {
              e.preventDefault()
            }
          }}
        >
          {sorted.map((p, i) => {
            const color = phaseColor(i)
            const isCurrent = i === curIdx
            const dot = (
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
            )
            // 改名中的行不用菜单项：菜单项悬停会抢焦点，导致输入框失焦提前提交
            if (editingId === p.id) {
              return (
                <div key={p.id} className="flex items-center justify-between gap-2 px-2 py-1">
                  <span className="flex min-w-0 items-center gap-2">
                    {dot}
                    <PhaseNameInput
                      initialName={p.name}
                      color={color}
                      className="w-[150px]"
                      onCommit={name => {
                        renamePhase(p.id, name)
                        setEditingId(null)
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatTimeMinSec(p.time)}
                  </span>
                </div>
              )
            }
            const showActions = !isReadOnly && hoveredId === p.id
            return (
              <DropdownMenuItem
                key={p.id}
                onMouseEnter={() => setHoveredId(p.id)}
                onMouseLeave={() => setHoveredId(h => (h === p.id ? null : h))}
                onSelect={e => {
                  if (actionClickRef.current) {
                    actionClickRef.current = false
                    e.preventDefault()
                    return
                  }
                  requestScrollToTime(p.time)
                }}
                className="flex items-center justify-between gap-2"
                style={
                  isCurrent
                    ? { backgroundColor: phaseColorAlpha(color, 0.12), color: textColorOf(color) }
                    : undefined
                }
              >
                <span className="flex min-w-0 items-center gap-2">
                  {dot}
                  <span className="truncate">{p.name}</span>
                </span>
                {/* 固定宽度：悬停时时间被按钮顶替而不跳动 */}
                <span className="flex w-12 shrink-0 justify-end">
                  {showActions ? (
                    <span className="flex items-center gap-0.5">
                      <button
                        type="button"
                        title={t('phase.rename')}
                        className="rounded p-0.5 hover:bg-foreground/10"
                        onPointerDown={() => (actionClickRef.current = true)}
                        onClick={() => setEditingId(p.id)}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title={t('phase.delete')}
                        className="rounded p-0.5 text-destructive hover:bg-destructive/10"
                        onPointerDown={() => (actionClickRef.current = true)}
                        onClick={e =>
                          setDeleteRequest({
                            phaseId: p.id,
                            phaseName: p.name,
                            anchor: e.currentTarget.getBoundingClientRect(),
                          })
                        }
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ) : (
                    <span className="tabular-nums text-muted-foreground">
                      {formatTimeMinSec(p.time)}
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
            )
          })}
          {!isReadOnly && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="flex items-center justify-between gap-2"
                onSelect={e => {
                  e.preventDefault()
                  handleAdd()
                }}
              >
                <span className="flex items-center gap-2">
                  <Plus className="h-3.5 w-3.5" />
                  {t('phase.addAtCurrent')}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatTimeMinSec(addTime)}
                </span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <PhaseDeleteConfirm
        request={deleteRequest}
        onConfirm={removePhase}
        onClose={() => setDeleteRequest(null)}
      />
    </>
  )
}
