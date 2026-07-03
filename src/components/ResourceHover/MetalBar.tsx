import { Progress } from '@/components/ui/progress'

/** 香槟金斜面包边：上亮下暗模拟受光金属，外圈再压一道深色描边。 */
const RIM_GRADIENT = 'linear-gradient(to bottom, #f6eed6 0%, #c9ba8e 45%, #6b5d40 100%)'
const RIM_SHADOW = '0 0 0 1px rgba(20,14,8,0.7), 0 1px 2px rgba(0,0,0,0.45)'

/** 金属包边进度条（FF14 仪表盘风格）：
 *  外层金属圆环 + 内层深棕轨道（带内阴影），填充用 --rt-bar-fill（tint 渐变 + 玻璃高光）。
 *  需要挂在带 tintStyle(tint) 的祖先元素内。宽度由 className 指定（作用于外框）。 */
export default function MetalBar({
  fraction,
  className,
}: {
  fraction: number
  className?: string
}) {
  return (
    <div
      className={`rounded-full p-px ${className ?? ''}`}
      style={{ background: RIM_GRADIENT, boxShadow: RIM_SHADOW }}
    >
      <Progress
        value={fraction * 100}
        className="h-1.5 w-full bg-[#241a12] shadow-[inset_0_1px_2px_rgba(0,0,0,0.85)]"
        indicatorClassName="bg-[image:var(--rt-bar-fill)]"
      />
    </div>
  )
}
