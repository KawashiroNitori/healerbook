/**
 * 全局悬浮提示窗覆盖层
 */

import { useTooltipStore } from '@/store/tooltipStore'
import ActionTooltip from './ActionTooltip'

export default function TooltipOverlay() {
  const { action, anchorRect, showTooltip, hideTooltip } = useTooltipStore()

  return (
    <ActionTooltip
      action={action}
      anchorRect={anchorRect}
      onMouseEnter={() => {
        // 只在延迟隐藏期间（action 还存在）才取消隐藏
        const state = useTooltipStore.getState()
        if (state.hideTimeoutId !== null && state.action && state.anchorRect) {
          showTooltip(state.action, state.anchorRect)
        }
      }}
      onMouseLeave={hideTooltip}
    />
  )
}
