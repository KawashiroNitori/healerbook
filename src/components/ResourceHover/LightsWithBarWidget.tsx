import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { lightsView } from './widgetView'

export default function LightsWithBarWidget({ widget }: { widget: ResourceWidget }) {
  const { total, lit } = lightsView(widget)
  const progress = widget.nextChargeProgress ?? (widget.amount >= widget.max ? 1 : 0)
  return (
    <div className="flex flex-col gap-0.5" title={widget.name}>
      <div className="flex items-center gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`w-2.5 h-2.5 rounded-full border ${
              i < lit
                ? 'bg-amber-400 border-amber-500'
                : 'bg-transparent border-muted-foreground/40'
            }`}
          />
        ))}
      </div>
      <div className="h-1 w-full rounded bg-muted overflow-hidden">
        <div className="h-full bg-sky-400" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  )
}
