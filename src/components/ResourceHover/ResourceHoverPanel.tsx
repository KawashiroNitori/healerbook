import { useLayoutEffect, useRef, useState } from 'react'
import JobIcon from '@/components/JobIcon'
import { getJobName } from '@/data/jobs'
import { formatTimeWithDecimal } from '@/utils/formatters'
import { useResourceHoverStore } from '@/store/resourceHoverStore'
import { useResourceHoverData } from '@/hooks/useResourceHoverData'
import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { clampPanelPosition } from './panelPosition'
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
  const { getSnapshotAt } = useResourceHoverData()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  const members = time != null ? getSnapshotAt(time) : []

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
  }, [time, cursor, members.length])

  if (time == null || !cursor || members.length === 0) return null

  return (
    <div
      ref={ref}
      className="fixed z-50 pointer-events-none max-w-[280px] rounded-lg border border-[hsl(var(--border)/0.4)] bg-[hsl(var(--popover)/0.4)] shadow-xl p-2.5 text-popover-foreground backdrop-blur-2xl"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="mb-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
        T{formatTimeWithDecimal(time)}
      </div>
      <div className="flex flex-col gap-2.5">
        {members.map(m => (
          <div key={m.playerId} className="flex flex-col gap-1">
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
              <div className="flex flex-wrap items-center gap-1.5">
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
