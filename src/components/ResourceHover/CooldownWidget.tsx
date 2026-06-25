import { getIconUrl } from '@/utils/iconUtils'
import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { cooldownView } from './widgetView'

export default function CooldownWidget({ widget }: { widget: ResourceWidget }) {
  const v = cooldownView(widget)
  return (
    <div className="relative w-8 h-8 rounded-sm overflow-hidden bg-muted" title={widget.name}>
      {widget.icon && (
        <img
          src={getIconUrl(widget.icon)}
          alt={widget.name}
          className="w-full h-full object-cover"
          onError={e => (e.currentTarget.style.display = 'none')}
        />
      )}
      {v.showMask && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `conic-gradient(rgba(0,0,0,0.6) ${v.sweepFraction * 360}deg, transparent 0deg)`,
          }}
        />
      )}
      {v.countdownLabel && (
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
          {v.countdownLabel}
        </span>
      )}
      {v.stackBadge != null && (
        <span className="absolute bottom-0 right-0 px-0.5 text-[10px] font-bold leading-none text-white bg-black/70 rounded-tl-sm tabular-nums">
          {v.stackBadge}
        </span>
      )}
    </div>
  )
}
