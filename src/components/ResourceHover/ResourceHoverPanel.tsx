import { useLayoutEffect, useRef, useState } from 'react'
import JobIcon from '@/components/JobIcon'
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
      className="fixed z-50 pointer-events-none rounded-md border bg-popover/95 shadow-lg p-2 text-popover-foreground backdrop-blur-sm"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="mb-1 text-[11px] font-semibold tabular-nums text-muted-foreground">
        T{formatTimeWithDecimal(time)}
      </div>
      <div className="flex flex-col gap-1.5">
        {members.map(m => (
          <div key={m.playerId} className="flex items-center gap-2">
            <JobIcon job={m.job} size="sm" />
            {m.pools.map(p => (
              <span key={p.resourceId}>{renderWidget(p)}</span>
            ))}
            {m.cooldowns.length > 0 && (
              <span className="flex flex-wrap items-center gap-0.5 pl-1 border-l border-border/60">
                {m.cooldowns.map(c => (
                  <span key={c.resourceId}>{renderWidget(c)}</span>
                ))}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
