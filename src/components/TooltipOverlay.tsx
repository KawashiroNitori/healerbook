import { useTooltipStore } from '@/store/tooltipStore'
import { useShallow } from 'zustand/react/shallow'
import ActionTooltip from './ActionTooltip'

export default function TooltipOverlay() {
  const { action, anchorRect, placementPriority, noTransition } = useTooltipStore(
    useShallow(s => ({
      action: s.action,
      anchorRect: s.anchorRect,
      placementPriority: s.placementPriority,
      noTransition: s.noTransition,
    }))
  )
  const showTooltip = useTooltipStore(s => s.showTooltip)
  const hideTooltip = useTooltipStore(s => s.hideTooltip)

  return (
    <ActionTooltip
      action={action}
      anchorRect={anchorRect}
      placementPriority={placementPriority}
      noTransition={noTransition}
      onMouseEnter={() => {
        // 只在延迟隐藏期间（action 还存在）才取消隐藏
        const state = useTooltipStore.getState()
        if (state.hideTimeoutId !== null && state.action && state.anchorRect) {
          showTooltip(state.action, state.anchorRect, state.placementPriority)
        }
      }}
      onMouseLeave={hideTooltip}
    />
  )
}
