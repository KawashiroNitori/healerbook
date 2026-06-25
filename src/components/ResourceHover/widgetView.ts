/** widget 纯视图模型：把 ResourceWidget 派生为各样式的渲染参数（无 JSX，便于单测）。 */

import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'

export function cooldownView(w: ResourceWidget): {
  showMask: boolean
  sweepFraction: number
  countdownLabel: string | null
  stackBadge: number | null
} {
  const onCooldown = w.amount < w.max && w.countdownSec != null
  return {
    showMask: onCooldown,
    // sweep = 剩余比例 = 1 - 下一充能进度
    sweepFraction: onCooldown ? 1 - (w.nextChargeProgress ?? 0) : 0,
    countdownLabel: onCooldown ? String(Math.ceil(w.countdownSec!)) : null,
    stackBadge: w.max > 1 ? w.amount : null,
  }
}

export function lightsView(w: ResourceWidget): { total: number; lit: number } {
  return { total: w.max, lit: w.amount }
}

export function barView(w: ResourceWidget): { fraction: number; label: string } {
  return { fraction: w.max > 0 ? w.amount / w.max : 0, label: `${w.amount}/${w.max}` }
}
