import { Progress } from '@/components/ui/progress'
import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { lightsView } from './widgetView'
import LightPips from './LightPips'

export default function LightsWithBarWidget({ widget }: { widget: ResourceWidget }) {
  const { total, lit } = lightsView(widget)
  const progress = widget.nextChargeProgress ?? (widget.amount >= widget.max ? 1 : 0)
  return (
    <div className="flex items-center gap-2" title={widget.name}>
      <LightPips total={total} lit={lit} />
      <Progress
        value={progress * 100}
        className="h-2 w-16 border border-amber-400/60 bg-black/50"
        indicatorClassName="bg-gradient-to-r from-amber-200 via-amber-400 to-amber-500"
      />
    </div>
  )
}
