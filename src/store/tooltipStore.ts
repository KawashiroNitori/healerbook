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
  showTimeoutId: ReturnType<typeof setTimeout> | null
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

const SHOW_DELAY = 300

export const useTooltipStore = create<TooltipState>((set, get) => ({
  action: null,
  anchorRect: null,
  placementPriority: DEFAULT_PLACEMENT,
  noTransition: false,
  showTimeoutId: null,
  hideTimeoutId: null,
  showTooltip: (action, anchorRect, placementPriority = DEFAULT_PLACEMENT) => {
    const { hideTimeoutId, showTimeoutId } = get()
    if (hideTimeoutId) clearTimeout(hideTimeoutId)
    if (showTimeoutId) clearTimeout(showTimeoutId)
    const timeoutId = setTimeout(() => {
      set({ action, anchorRect, placementPriority, noTransition: false, showTimeoutId: null })
    }, SHOW_DELAY)
    set({ hideTimeoutId: null, showTimeoutId: timeoutId })
  },
  toggleTooltip: (action, anchorRect, placementPriority = DEFAULT_PLACEMENT) => {
    const { action: currentAction, hideTimeoutId, showTimeoutId } = get()
    if (hideTimeoutId) clearTimeout(hideTimeoutId)
    if (showTimeoutId) clearTimeout(showTimeoutId)
    // 如果点击的是同一个技能，关闭；否则显示新的
    if (currentAction?.id === action.id) {
      set({
        action: null,
        anchorRect: null,
        noTransition: false,
        hideTimeoutId: null,
        showTimeoutId: null,
      })
    } else {
      set({
        action,
        anchorRect,
        placementPriority,
        noTransition: false,
        hideTimeoutId: null,
        showTimeoutId: null,
      })
    }
  },
  hideTooltip: () => {
    const { hideTimeoutId, showTimeoutId } = get()
    if (showTimeoutId) clearTimeout(showTimeoutId)
    if (hideTimeoutId) clearTimeout(hideTimeoutId)
    const timeoutId = setTimeout(() => {
      set({ action: null, anchorRect: null, hideTimeoutId: null })
    }, 100)
    set({ hideTimeoutId: timeoutId, showTimeoutId: null })
  },
  clearTooltip: () => {
    const { hideTimeoutId, showTimeoutId } = get()
    if (showTimeoutId) clearTimeout(showTimeoutId)
    if (hideTimeoutId) clearTimeout(hideTimeoutId)
    set({
      action: null,
      anchorRect: null,
      noTransition: true,
      hideTimeoutId: null,
      showTimeoutId: null,
    })
  },
}))
