import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { lightsView } from './widgetView'
import LightPips from './LightPips'

export default function LightsWidget({ widget }: { widget: ResourceWidget }) {
  const { total, lit } = lightsView(widget)
  return (
    <div title={widget.name}>
      <LightPips total={total} lit={lit} tint={widget.tint} />
    </div>
  )
}
