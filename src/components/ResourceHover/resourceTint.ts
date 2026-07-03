/**
 * 资源池色调：把单个主色（任意 CSS 颜色，hex / hsl 均可）展开成一组 `--rt-*` CSS 变量，
 * 提亮 / 压暗 / 发光全部用 color-mix 自动推导——调色只需改主色一个值。
 *
 * 用法：把 tintStyle(tint) 挂到承载 widget 的元素 style 上，子元素用 var(--rt-*) 引用派生色。
 * 消费这些变量的样式：指示灯（LightPips）亮态宝石、进度条（MetalBar）填充渐变。
 * 金属包边本身是中性色常量（不随 tint 变化），分别定义在 LightPips / MetalBar 内。
 */

import type { CSSProperties } from 'react'

/** 未声明 tint 的资源回退主色（sky 蓝，兼容原指示灯观感） */
export const DEFAULT_RESOURCE_TINT = '#38bdf8'

/** 从主色派生的 CSS 变量集合。key 用自定义属性，需断言为 CSSProperties。
 *  tint 省略 / undefined 时回退 DEFAULT_RESOURCE_TINT。 */
export function tintStyle(tint: string = DEFAULT_RESOURCE_TINT): CSSProperties {
  const t = 'var(--rt-tint)'
  return {
    '--rt-tint': tint,
    // 指示灯亮态宝石：左上强提亮 → 右下饱和主色的渐变 + 主色外发光
    '--rt-pip-from': `color-mix(in srgb, ${t} 40%, white)`,
    '--rt-pip-to': `color-mix(in srgb, ${t} 92%, black)`,
    '--rt-pip-glow': `color-mix(in srgb, ${t} 85%, transparent)`,
    // 进度条填充：纵向玻璃高光（上亮下暗）叠加在 横向 压暗 → 主色 → 提亮 三段渐变上（左暗右亮）
    '--rt-bar-fill':
      'linear-gradient(to bottom, rgba(255,255,255,0.4), rgba(255,255,255,0.1) 45%, rgba(0,0,0,0.18) 55%, rgba(0,0,0,0) 100%), ' +
      `linear-gradient(to right, color-mix(in srgb, ${t} 72%, black), ${t}, color-mix(in srgb, ${t} 55%, white))`,
  } as CSSProperties
}
