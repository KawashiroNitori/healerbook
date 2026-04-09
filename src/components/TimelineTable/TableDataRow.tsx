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
  calculationResult: CalculationResult | undefined
  showOriginalDamage: boolean
  showActualDamage: boolean
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
  calculationResult,
  showOriginalDamage,
  showActualDamage,
}: TableDataRowProps) {
  const { original, actual } = resolveDamageNumbers(event, timeline, calculationResult)

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
        className={`${stickyCell} ${stickyHoverClass} z-10 px-2 truncate`}
        style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH, left: nameLeft }}
        title={event.name}
      >
        {event.name}
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
        const isLit = litCells.has(cellKey(track.playerId, track.actionId))
        const baseBg = index % 2 === 0 ? 'bg-background' : 'bg-muted/20'
        return (
          <td
            key={`c-${track.playerId}-${track.actionId}`}
            className={`relative border-b ${baseBg} ${hoverClass} ${
              isNewPlayer ? 'border-l-2 border-l-foreground/20' : 'border-l'
            }`}
            style={{ width: SKILL_COL_WIDTH, minWidth: SKILL_COL_WIDTH }}
          >
            {isLit && <div className="absolute inset-0 bg-emerald-500/30" />}
          </td>
        )
      })}
    </tr>
  )
}
