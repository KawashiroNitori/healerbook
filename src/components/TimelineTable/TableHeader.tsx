/**
 * 表格视图列头
 *
 * 布局：
 * - 粘性顶部（sticky top: 0）
 * - 前 2-4 列也粘性左侧
 * - 技能列头显示职业图标 + 技能图标，hover/click 触发 tooltip
 */

import JobIcon from '../JobIcon'
import { getIconUrl } from '@/utils/iconUtils'
import { useTooltipStore } from '@/store/tooltipStore'
import type { SkillTrack } from '@/utils/skillTracks'
import type { MitigationAction } from '@/types/mitigation'
import {
  TIME_COL_WIDTH,
  NAME_COL_WIDTH,
  ORIGINAL_DAMAGE_COL_WIDTH,
  ACTUAL_DAMAGE_COL_WIDTH,
  SKILL_COL_WIDTH,
  HEADER_HEIGHT,
} from './constants'

interface TableHeaderProps {
  skillTracks: SkillTrack[]
  actionsById: Map<number, MitigationAction>
  showOriginalDamage: boolean
  showActualDamage: boolean
}

export default function TableHeader({
  skillTracks,
  actionsById,
  showOriginalDamage,
  showActualDamage,
}: TableHeaderProps) {
  const { showTooltip, toggleTooltip, hideTooltip } = useTooltipStore()

  // 计算粘性左侧列的累积 left 值
  let leftOffset = 0
  const timeLeft = leftOffset
  leftOffset += TIME_COL_WIDTH
  const nameLeft = leftOffset
  leftOffset += NAME_COL_WIDTH
  const origLeft = leftOffset
  if (showOriginalDamage) leftOffset += ORIGINAL_DAMAGE_COL_WIDTH
  const actualLeft = leftOffset
  if (showActualDamage) leftOffset += ACTUAL_DAMAGE_COL_WIDTH

  // 左上角的固定列必须使用不透明背景，否则横向滚动时会透出后面的技能列头
  // 表头底部阴影由外层 TimelineTableView 的 sticky 渐变层统一实现
  const stickyCellClass =
    'sticky bg-background border-r text-xs font-semibold text-muted-foreground'

  return (
    <thead>
      <tr style={{ height: HEADER_HEIGHT }}>
        <th
          className={`${stickyCellClass} top-0 z-30 text-right px-2`}
          style={{ width: TIME_COL_WIDTH, minWidth: TIME_COL_WIDTH, left: timeLeft }}
        >
          时间
        </th>
        <th
          className={`${stickyCellClass} top-0 z-30 text-left px-2`}
          style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH, left: nameLeft }}
        >
          伤害事件
        </th>
        {showOriginalDamage && (
          <th
            className={`${stickyCellClass} top-0 z-30 text-right px-2`}
            style={{
              width: ORIGINAL_DAMAGE_COL_WIDTH,
              minWidth: ORIGINAL_DAMAGE_COL_WIDTH,
              left: origLeft,
            }}
          >
            原始伤害
          </th>
        )}
        {showActualDamage && (
          <th
            className={`${stickyCellClass} top-0 z-30 text-right px-2`}
            style={{
              width: ACTUAL_DAMAGE_COL_WIDTH,
              minWidth: ACTUAL_DAMAGE_COL_WIDTH,
              left: actualLeft,
            }}
          >
            实际伤害
          </th>
        )}
        {skillTracks.map((track, index) => {
          const action = actionsById.get(track.actionId)
          const isNewPlayer = index === 0 || skillTracks[index - 1].playerId !== track.playerId
          const bgColor = index % 2 === 0 ? 'bg-background/60' : 'bg-muted/40'
          return (
            <th
              key={`h-${track.playerId}-${track.actionId}`}
              className={`sticky top-0 z-20 backdrop-blur-md text-center ${bgColor} ${
                isNewPlayer ? 'border-l-2 border-l-foreground/20' : 'border-l'
              }`}
              style={{ width: SKILL_COL_WIDTH, minWidth: SKILL_COL_WIDTH }}
            >
              <div className="flex flex-col items-center gap-0.5 py-1">
                <div className="opacity-60">
                  <JobIcon job={track.job} size="sm" />
                </div>
                <img
                  src={getIconUrl(track.actionIcon)}
                  alt={track.actionName}
                  className="w-6 h-6 rounded cursor-pointer"
                  onError={e => {
                    e.currentTarget.style.display = 'none'
                  }}
                  onMouseEnter={e => {
                    if (action) showTooltip(action, e.currentTarget.getBoundingClientRect())
                  }}
                  onMouseLeave={hideTooltip}
                  onClick={e => {
                    if (action) toggleTooltip(action, e.currentTarget.getBoundingClientRect())
                  }}
                />
              </div>
            </th>
          )
        })}
      </tr>
    </thead>
  )
}
