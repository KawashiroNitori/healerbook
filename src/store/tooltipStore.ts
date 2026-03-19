/**
 * 悬浮提示窗状态管理
 */

import { create } from 'zustand'
import type { MitigationAction } from '@/types/mitigation'

export type TooltipPlacement = 'r' | 'l' | 'b' | 't'

const DEFAULT_PLACEMENT: TooltipPlacement[] = ['r', 'l', 'b', 't']

interface TooltipState {
  action: MitigationAction | null
  anchorRect: DOMRect | null
  placementPriority: TooltipPlacement[]
  noTransition: boolean
  hideTimeoutId: ReturnType<typeof setTimeout> | null
  showTooltip: (
    action: MitigationAction,
    anchorRect: DOMRect,
    placementPriority?: TooltipPlacement[]
  ) => void
  toggleTooltip: (
    action: MitigationAction,
    anchorRect: DOMRect,
    placementPriority?: TooltipPlacement[]
  ) => void
  hideTooltip: () => void
  clearTooltip: () => void
}

export const useTooltipStore = create<TooltipState>((set, get) => ({
  action: null,
  anchorRect: null,
  placementPriority: DEFAULT_PLACEMENT,
  noTransition: false,
  hideTimeoutId: null,
  showTooltip: (action, anchorRect, placementPriority = DEFAULT_PLACEMENT) => {
    const { hideTimeoutId } = get()
    if (hideTimeoutId) {
      clearTimeout(hideTimeoutId)
    }
    set({ action, anchorRect, placementPriority, noTransition: false, hideTimeoutId: null })
  },
  toggleTooltip: (action, anchorRect, placementPriority = DEFAULT_PLACEMENT) => {
    const { action: currentAction, hideTimeoutId } = get()
    if (hideTimeoutId) {
      clearTimeout(hideTimeoutId)
    }
    // 如果点击的是同一个技能，关闭；否则显示新的
    if (currentAction?.id === action.id) {
      set({ action: null, anchorRect: null, noTransition: false, hideTimeoutId: null })
    } else {
      set({ action, anchorRect, placementPriority, noTransition: false, hideTimeoutId: null })
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
    set({ action: null, anchorRect: null, noTransition: true, hideTimeoutId: null })
  },
}))
