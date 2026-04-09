// src/components/TimelineTable/TableDataRow.tsx
/**
 * 表格视图的伤害事件行
 *
 * 负责：
 * - 渲染时间、事件名、原始伤害、实际伤害四个粘性左侧列
 * - 遍历 skillTracks 渲染每个技能列，查 litCells 决定是否亮起
 * - 对编辑 / 回放、AoE / 死刑四种情况处理伤害数值来源
 */

import { formatTimeWithDecimal, formatDamageValue } from '@/utils/formatters'
import { getIconUrl } from '@/utils/iconUtils'
import { cellKey } from '@/utils/castWindow'
import type { DamageEvent, Timeline } from '@/types/timeline'
import type { SkillTrack } from '@/utils/skillTracks'
import type { CalculationResult } from '@/utils/mitigationCalculator'
import {
  TIME_COL_WIDTH,
  NAME_COL_WIDTH,
  ORIGINAL_DAMAGE_COL_WIDTH,
  ACTUAL_DAMAGE_COL_WIDTH,
  SKILL_COL_WIDTH,
  ROW_HEIGHT,
} from './constants'

interface TableDataRowProps {
  event: DamageEvent
  timeline: Timeline
  skillTracks: SkillTrack[]
  litCells: Set<string>
  /** 标记为 cast 起点的单元格——即该伤害事件是 cast 之后的第一个 */
  markerCells: Set<string>
  calculationResult: CalculationResult | undefined
  showOriginalDamage: boolean
  showActualDamage: boolean
  /** 点击事件名时回调，传入事件 id（用于触发 PropertyPanel 打开） */
  onSelect: (eventId: string) => void
  /** 点击技能单元格切换放置状态 */
  onCellToggle: (track: SkillTrack, event: DamageEvent, isLit: boolean) => void
  /** 只读模式下禁止切换 */
  isReadOnly: boolean
}

const EMPTY = '—'

function formatDamage(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return EMPTY
  return formatDamageValue(n)
}

/**
 * 提取死刑行的目标坦克伤害详情（仅回放模式下可用）
 */
function getTankbusterDetail(event: DamageEvent) {
  if (!event.playerDamageDetails || event.playerDamageDetails.length === 0) return undefined
  if (event.targetPlayerId !== undefined) {
    return event.playerDamageDetails.find(d => d.playerId === event.targetPlayerId)
  }
  return event.playerDamageDetails[0]
}

function resolveDamageNumbers(
  event: DamageEvent,
  timeline: Timeline,
  calculationResult: CalculationResult | undefined
): { original: number | undefined; actual: number | undefined } {
  const isReplay = !!timeline.isReplayMode
  const isTankbuster = event.type === 'tankbuster'

  if (isTankbuster) {
    if (isReplay) {
      const detail = getTankbusterDetail(event)
      return { original: detail?.unmitigatedDamage, actual: detail?.finalDamage }
    }
    // 编辑模式：calculator 跳过死刑
    return { original: event.damage, actual: undefined }
  }

  // AoE：两种模式都走 calculationResult
  return {
    original: calculationResult?.originalDamage,
    actual: calculationResult?.finalDamage,
  }
}

export default function TableDataRow({
  event,
  timeline,
  skillTracks,
  litCells,
  markerCells,
  calculationResult,
  showOriginalDamage,
  showActualDamage,
  onSelect,
  onCellToggle,
  isReadOnly,
}: TableDataRowProps) {
  const { original, actual } = resolveDamageNumbers(event, timeline, calculationResult)

  // 与时间轴视图一致的配色与警示逻辑（见 Timeline/DamageEventCard.tsx）
  const damageTypeColorClass: Record<string, string> = {
    physical: 'text-red-500',
    magical: 'text-blue-800 dark:text-blue-400',
    darkness: 'text-fuchsia-600',
  }
  const nameColorClass = damageTypeColorClass[event.damageType || 'physical'] || 'text-red-500'

  // 回放模式下的 overkill（排除"复生"状态 810）
  const hasOverkill =
    event.playerDamageDetails?.some(
      d => (d.overkill ?? 0) > 0 && !d.statuses.some(s => s.statusId === 810)
    ) ?? false

  // 编辑模式警示（仅在 calculationResult 有 referenceMaxHP 时才可用）
  const refHP = calculationResult?.referenceMaxHP
  const finalDamage = calculationResult?.finalDamage ?? 0
  const isLethal = !hasOverkill && refHP != null && finalDamage >= refHP
  const isDangerous = !hasOverkill && !isLethal && refHP != null && finalDamage >= refHP * 0.9

  // 计算粘性左偏移
  let leftOffset = 0
  const timeLeft = leftOffset
  leftOffset += TIME_COL_WIDTH
  const nameLeft = leftOffset
  leftOffset += NAME_COL_WIDTH
  const origLeft = leftOffset
  if (showOriginalDamage) leftOffset += ORIGINAL_DAMAGE_COL_WIDTH
  const actualLeft = leftOffset
  if (showActualDamage) leftOffset += ACTUAL_DAMAGE_COL_WIDTH

  const stickyCell = 'sticky bg-background border-r border-b text-xs'
  // 粘性列必须使用不透明 hover 色，避免横向滚动时后面的技能列透过来
  const stickyHoverClass = 'group-hover:bg-muted'
  // 非粘性技能列可以用半透明 hover 色
  const hoverClass = 'group-hover:bg-muted/50'

  return (
    <tr className="group" style={{ height: ROW_HEIGHT }}>
      <td
        className={`${stickyCell} ${stickyHoverClass} z-10 px-2 text-right tabular-nums`}
        style={{ width: TIME_COL_WIDTH, minWidth: TIME_COL_WIDTH, left: timeLeft }}
      >
        {formatTimeWithDecimal(event.time)}
      </td>
      <td
        className={`${stickyCell} ${stickyHoverClass} z-10 px-2`}
        style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH, left: nameLeft }}
        title={event.name}
      >
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onSelect(event.id)
          }}
          className="flex items-center gap-1 w-full text-left cursor-pointer"
        >
          {hasOverkill && <span className="shrink-0">💀</span>}
          {isLethal && <span className="shrink-0 text-red-600 font-bold">⚠</span>}
          {isDangerous && <span className="shrink-0 text-amber-500 font-bold">⚠</span>}
          <span className={`truncate font-semibold hover:underline ${nameColorClass}`}>
            {event.name}
          </span>
        </button>
      </td>
      {showOriginalDamage && (
        <td
          className={`${stickyCell} ${stickyHoverClass} z-10 px-2 text-right tabular-nums`}
          style={{
            width: ORIGINAL_DAMAGE_COL_WIDTH,
            minWidth: ORIGINAL_DAMAGE_COL_WIDTH,
            left: origLeft,
          }}
        >
          {formatDamage(original)}
        </td>
      )}
      {showActualDamage && (
        <td
          className={`${stickyCell} ${stickyHoverClass} z-10 px-2 text-right tabular-nums`}
          style={{
            width: ACTUAL_DAMAGE_COL_WIDTH,
            minWidth: ACTUAL_DAMAGE_COL_WIDTH,
            left: actualLeft,
          }}
        >
          {formatDamage(actual)}
        </td>
      )}
      {skillTracks.map((track, index) => {
        const isNewPlayer = index === 0 || skillTracks[index - 1].playerId !== track.playerId
        const key = cellKey(track.playerId, track.actionId)
        const isLit = litCells.has(key)
        const isMarker = markerCells.has(key)
        const baseBg = index % 2 === 0 ? 'bg-background' : 'bg-muted/20'
        return (
          <td
            key={`c-${track.playerId}-${track.actionId}`}
            className={`relative border-b ${baseBg} ${hoverClass} ${
              isNewPlayer ? 'border-l-2 border-l-foreground/20' : 'border-l'
            } ${isReadOnly ? '' : 'cursor-pointer'}`}
            style={{ width: SKILL_COL_WIDTH, minWidth: SKILL_COL_WIDTH }}
            onClick={e => {
              if (isReadOnly) return
              e.stopPropagation()
              onCellToggle(track, event, isMarker)
            }}
          >
            {isLit && <div className="absolute inset-0 bg-emerald-500/30" />}
            {isMarker && (
              <img
                src={getIconUrl(track.actionIcon)}
                alt={track.actionName}
                className="pointer-events-none absolute top-1/2 left-1/2 w-6 h-6 -translate-x-1/2 -translate-y-1/2 rounded-sm shadow-md"
                onError={e => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            )}
          </td>
        )
      })}
    </tr>
  )
}
