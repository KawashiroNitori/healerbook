/**
 * 战斗资源悬浮窗的 hover 瞬时态：当前悬停时刻 + 光标坐标。
 * 仅 UI 瞬时态，不持久化、不进 timeline 数据。
 */

import { create } from 'zustand'

interface ResourceHoverState {
  time: number | null
  cursor: { x: number; y: number } | null
  setHover: (time: number, cursor: { x: number; y: number }) => void
  clearHover: () => void
}

export const useResourceHoverStore = create<ResourceHoverState>(set => ({
  time: null,
  cursor: null,
  setHover: (time, cursor) => set({ time, cursor }),
  clearHover: () => set({ time: null, cursor: null }),
}))
