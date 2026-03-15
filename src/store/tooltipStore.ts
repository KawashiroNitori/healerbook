/**
 * 悬浮提示窗状态管理
 */

import { create } from 'zustand'
import type { MitigationAction } from '@/types/mitigation'

interface TooltipState {
  action: MitigationAction | null
  anchorRect: DOMRect | null
  hideTimeoutId: ReturnType<typeof setTimeout> | null
  showTooltip: (action: MitigationAction, anchorRect: DOMRect) => void
  toggleTooltip: (action: MitigationAction, anchorRect: DOMRect) => void
  hideTooltip: () => void
  clearTooltip: () => void
}

export const useTooltipStore = create<TooltipState>((set, get) => ({
  action: null,
  anchorRect: null,
  hideTimeoutId: null,
  showTooltip: (action, anchorRect) => {
    const { hideTimeoutId } = get()
    if (hideTimeoutId) {
      clearTimeout(hideTimeoutId)
    }
    set({ action, anchorRect, hideTimeoutId: null })
  },
  toggleTooltip: (action, anchorRect) => {
    const { action: currentAction, hideTimeoutId } = get()
    if (hideTimeoutId) {
      clearTimeout(hideTimeoutId)
    }
    // 如果点击的是同一个技能，关闭；否则显示新的
    if (currentAction?.id === action.id) {
      set({ action: null, anchorRect: null, hideTimeoutId: null })
    } else {
      set({ action, anchorRect, hideTimeoutId: null })
    }
  },
  hideTooltip: () => {
    const { hideTimeoutId } = get()
    if (hideTimeoutId) {
      clearTimeout(hideTimeoutId)
    }
    const timeoutId = setTimeout(() => {
      set({ action: null, anchorRect: null, hideTimeoutId: null })
    }, 100)
    set({ hideTimeoutId: timeoutId })
  },
  clearTooltip: () => {
    const { hideTimeoutId } = get()
    if (hideTimeoutId) {
      clearTimeout(hideTimeoutId)
    }
    set({ action: null, anchorRect: null, hideTimeoutId: null })
  },
}))
