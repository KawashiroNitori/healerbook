import { useId } from 'react'
import { getIconUrl } from '@/utils/iconUtils'
import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { cooldownView } from './widgetView'

// 圆外（四角）恒暗的 CSS 遮罩；圆内冷却扇形用 SVG 精确绘制。
const OUTSIDE_CIRCLE_MASK = 'radial-gradient(circle closest-side, transparent 98%, #000 100%)'
const DIM = 'rgba(0,0,0,0.6)'

const CX = 20
const CY = 20
const R = 20

/** 顺时针自顶部起，角度 deg 对应圆周上的点。 */
function pointAt(deg: number): [number, number] {
  const t = (deg * Math.PI) / 180
  return [CX + R * Math.sin(t), CY - R * Math.cos(t)]
}

/** 扇形路径：从 fromDeg 顺时针扫到 toDeg（顶点在圆心）。 */
function sectorPath(fromDeg: number, toDeg: number): string {
  const [sx, sy] = pointAt(fromDeg)
  const [ex, ey] = pointAt(toDeg)
  const largeArc = toDeg - fromDeg > 180 ? 1 : 0
  return `M ${CX} ${CY} L ${sx} ${sy} A ${R} ${R} 0 ${largeArc} 1 ${ex} ${ey} Z`
}

export default function CooldownWidget({ widget }: { widget: ResourceWidget }) {
  const v = cooldownView(widget)
  const rawId = useId().replace(/:/g, '')
  const glowId = `cdglow-${rawId}`
  const clipId = `cdclip-${rawId}`

  // 已恢复角度（亮扇形）。夹到 [0.5, 359.5] 避免 0/360 退化路径。
  const a = Math.min(Math.max((1 - v.sweepFraction) * 360, 0.5), 359.5)
  const brightPath = sectorPath(0, a)
  const remainingPath = sectorPath(a, 360)

  return (
    <div
      className="relative h-10 w-10 overflow-hidden rounded-md bg-muted shadow-md ring-1 ring-black/20"
      title={widget.name}
    >
      {widget.icon && (
        <img
          src={getIconUrl(widget.icon)}
          alt={widget.name}
          className="h-full w-full object-cover"
          onError={e => (e.currentTarget.style.display = 'none')}
        />
      )}
      {v.showMask && (
        <>
          {/* 圆形区域外（四角）恒暗 */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: DIM,
              WebkitMaskImage: OUTSIDE_CIRCLE_MASK,
              maskImage: OUTSIDE_CIRCLE_MASK,
            }}
          />
          {/* 圆内：剩余扇形暗 + 亮扇形三边内发光 */}
          <svg
            viewBox="0 0 40 40"
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden
          >
            <defs>
              <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="1.1" />
              </filter>
              <clipPath id={clipId}>
                <path d={brightPath} />
              </clipPath>
            </defs>
            {/* 剩余时段压暗 */}
            <path d={remainingPath} fill={DIM} />
            {/* 亮扇形三边（两直边 + 弧边）内发光：描边模糊后裁到扇形内 */}
            <g clipPath={`url(#${clipId})`}>
              <path
                d={brightPath}
                fill="none"
                stroke="rgba(224,245,255,0.95)"
                strokeWidth="2.4"
                strokeLinejoin="round"
                filter={`url(#${glowId})`}
              />
            </g>
          </svg>
        </>
      )}
      {v.countdownLabel !== null && (
        <span className="absolute inset-0 flex items-center justify-center text-base font-bold text-white tabular-nums [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]">
          {v.countdownLabel}
        </span>
      )}
      {v.stackBadge != null && (
        <span
          className={`absolute bottom-0 right-1 text-base font-extrabold leading-none tabular-nums ${
            v.stackBadge > 0 ? 'text-white' : 'text-red-500'
          }`}
          style={{
            // >0：白字棕色描边+外发光；0：红字黑色外发光
            textShadow:
              v.stackBadge > 0
                ? '-1px -1px 0 #5c3a17, 0 -1px 0 #5c3a17, 1px -1px 0 #5c3a17, 1px 0 0 #5c3a17, 1px 1px 0 #5c3a17, 0 1px 0 #5c3a17, -1px 1px 0 #5c3a17, -1px 0 0 #5c3a17, 0 0 4px #5c3a17'
                : '0 0 2px #000, 0 0 3px #000, 0 0 5px #000',
          }}
        >
          {v.stackBadge}
        </span>
      )}
    </div>
  )
}
