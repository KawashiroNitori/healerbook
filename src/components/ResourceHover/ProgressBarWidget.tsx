import { Progress } from '@/components/ui/progress'
import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { barView } from './widgetView'

export default function ProgressBarWidget({ widget }: { widget: ResourceWidget }) {
  const { fraction, label } = barView(widget)
  return (
    <div className="flex items-center gap-1.5" title={widget.name}>
      <Progress
        value={fraction * 100}
        className="h-2 w-24 border border-amber-400/60 bg-black/50"
        indicatorClassName="bg-gradient-to-r from-amber-200 via-amber-400 to-amber-500"
      />
      <span className="text-[10px] tabular-nums text-muted-foreground">{label}</span>
    </div>
  )
}
