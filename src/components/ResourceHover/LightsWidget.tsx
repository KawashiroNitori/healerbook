import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { lightsView } from './widgetView'

export default function LightsWidget({ widget }: { widget: ResourceWidget }) {
  const { total, lit } = lightsView(widget)
  return (
    <div className="flex items-center gap-1" title={widget.name}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`w-2.5 h-2.5 rounded-full border ${
            i < lit ? 'bg-amber-400 border-amber-500' : 'bg-transparent border-muted-foreground/40'
          }`}
        />
      ))}
    </div>
  )
}
