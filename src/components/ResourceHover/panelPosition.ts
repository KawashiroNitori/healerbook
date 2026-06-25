/** 跟随光标的浮层定位：默认右下偏移，近右/下边界翻转，最终 clamp 到视口内。 */

const OFFSET = 16

export function clampPanelPosition(
  cursor: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number } {
  let left = cursor.x + OFFSET
  if (left + size.width > viewport.width) left = cursor.x - OFFSET - size.width
  let top = cursor.y + OFFSET
  if (top + size.height > viewport.height) top = cursor.y - OFFSET - size.height
  return { left: Math.max(0, left), top: Math.max(0, top) }
}
