import { useLayoutEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import JobIcon from '@/components/JobIcon'
import { getJobName } from '@/data/jobs'
import { formatTimeWithDecimal } from '@/utils/formatters'
import { useResourceHoverStore } from '@/store/resourceHoverStore'
import { useUIStore } from '@/store/uiStore'
import { useFilteredTimelineView } from '@/hooks/useFilteredTimelineView'
import { useResourceHoverData } from '@/hooks/useResourceHoverData'
import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { clampPanelPosition } from './panelPosition'
import BossCastBar from './BossCastBar'
import CooldownWidget from './CooldownWidget'
import ProgressBarWidget from './ProgressBarWidget'
import LightsWidget from './LightsWidget'
import LightsWithBarWidget from './LightsWithBarWidget'

function renderWidget(w: ResourceWidget) {
  switch (w.style) {
    case 'cooldown':
      return <CooldownWidget widget={w} />
    case 'progressBar':
      return <ProgressBarWidget widget={w} />
    case 'lights':
      return <LightsWidget widget={w} />
    case 'lightsWithBar':
      return <LightsWithBarWidget widget={w} />
    default:
      return null
  }
}

export default function ResourceHoverPanel() {
  const time = useResourceHoverStore(s => s.time)
  const cursor = useResourceHoverStore(s => s.cursor)
  const showResourceHover = useUIStore(s => s.showResourceHover)
  const { filteredDamageEvents } = useFilteredTimelineView()
  const { getSnapshotAt } = useResourceHoverData()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  const members = time != null ? getSnapshotAt(time) : []

  // 当前时刻正在读条的伤害事件（castStartTime/castEndTime 成对存在才视为有读条）；
  // 用过滤后的事件集，被 FilterPreset 过滤掉的事件不显示读条
  const castingEvents =
    time != null
      ? filteredDamageEvents.filter(
          e =>
            e.castStartTime != null &&
            e.castEndTime != null &&
            time >= e.castStartTime &&
            time <= e.castEndTime
        )
      : []

  useLayoutEffect(() => {
    if (time == null || !cursor || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setPos(
      clampPanelPosition(
        cursor,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    )
  }, [time, cursor, members.length, castingEvents.length])

  if (!showResourceHover || time == null || !cursor || members.length === 0) return null

  return (
    <div
      ref={ref}
      className="fixed z-50 pointer-events-none w-fit rounded-lg border border-[hsl(var(--border)/0.4)] bg-[hsl(var(--popover)/0.4)] shadow-xl p-4 text-popover-foreground backdrop-blur-2xl"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-sm font-bold">资源预览</span>
        <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
          <Clock className="h-3 w-3" />
          {formatTimeWithDecimal(time)}
        </span>
      </div>
      {castingEvents.map(e => (
        <div key={e.id} className="mb-2">
          <BossCastBar
            name={e.name}
            fraction={
              (time - e.castStartTime!) / Math.max(e.castEndTime! - e.castStartTime!, 0.001)
            }
          />
        </div>
      ))}
      <div className="flex flex-col gap-2.5">
        {members.map(m => (
          // gap-2：菱形指示灯旋转后向上视觉外扩约 2.5px，行距过小会显得贴在一起
          <div key={m.playerId} className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <JobIcon job={m.job} size="sm" />
              <span className="text-xs font-semibold">{getJobName(m.job)}</span>
            </div>
            {m.pools.map(p => (
              <div key={p.resourceId} className="flex items-center gap-1.5">
                <span className="w-16 shrink-0 text-[10px] text-muted-foreground">{p.name}</span>
                {renderWidget(p)}
              </div>
            ))}
            {m.cooldowns.length > 0 && (
              <div
                className="grid w-fit gap-1.5"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(m.cooldowns.length, 8)}, auto)`,
                }}
              >
                {m.cooldowns.map(c => (
                  <span key={c.actionId ?? c.resourceId}>{renderWidget(c)}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
