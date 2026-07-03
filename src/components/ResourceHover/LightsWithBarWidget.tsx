import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'
import { lightsView } from './widgetView'
import LightPips from './LightPips'
import { tintStyle } from './resourceTint'
import MetalBar from './MetalBar'

export default function LightsWithBarWidget({ widget }: { widget: ResourceWidget }) {
  const { total, lit } = lightsView(widget)
  const progress = widget.nextChargeProgress ?? (widget.amount >= widget.max ? 1 : 0)
  // 还原游戏内仪表盘布局：指示灯一排在上、整体右移一段，菱形下尖角
  // （rotate-45 视觉外扩约 2.5px）轻微叠压进度条顶缘，z-10 保证压在条上方。
  return (
    <div className="flex flex-col items-start" title={widget.name} style={tintStyle(widget.tint)}>
      <div className="relative z-10 pl-1.5">
        <LightPips total={total} lit={lit} tint={widget.tint} />
      </div>
      <MetalBar fraction={progress} className="w-32" />
    </div>
  )
}
