import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { barView } from './widgetView'

export default function ProgressBarWidget({ widget }: { widget: ResourceWidget }) {
  const { fraction, label } = barView(widget)
  return (
    <div className="flex items-center gap-1" title={widget.name}>
      <div className="h-2 w-16 rounded bg-muted overflow-hidden">
        <div className="h-full bg-sky-400" style={{ width: `${fraction * 100}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">{label}</span>
    </div>
  )
}
