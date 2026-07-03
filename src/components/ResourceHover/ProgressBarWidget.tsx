import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { barView } from './widgetView'
import { tintStyle } from './resourceTint'
import MetalBar from './MetalBar'

export default function ProgressBarWidget({ widget }: { widget: ResourceWidget }) {
  const { fraction, label } = barView(widget)
  return (
    <div className="flex items-center gap-1.5" title={widget.name} style={tintStyle(widget.tint)}>
      <MetalBar fraction={fraction} className="w-24" />
      <span className="text-[10px] tabular-nums text-muted-foreground">{label}</span>
    </div>
  )
}
