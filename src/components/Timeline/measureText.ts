/**
 * Canvas 文本宽度测量（带缓存），用于在渲染前算出 Konva 文本占位。
 * jsdom 等无 2D context 的环境退化为按字符数估算。
 */

let ctx: CanvasRenderingContext2D | null | undefined
const cache = new Map<string, number>()

export function measureTextWidth(text: string, font: string): number {
  const key = `${font}|${text}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  if (ctx === undefined) {
    ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  }
  let width: number
  if (ctx) {
    ctx.font = font
    width = ctx.measureText(text).width
  } else {
    const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '12')
    width = Array.from(text).length * size * 0.6
  }
  if (cache.size > 2000) cache.clear()
  cache.set(key, width)
  return width
}
