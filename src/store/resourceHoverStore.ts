/**
 * 战斗资源悬浮窗的 hover 瞬时态：当前悬停时刻 + 光标坐标。
 * 仅 UI 瞬时态，不持久化、不进 timeline 数据。
 */

import { create } from 'zustand'

interface ResourceHoverState {
  time: number | null
  cursor: { x: number; y: number } | null
  /** 是否正在拖动时间轴/表格；拖动期间不显示悬浮窗，setHover 被忽略 */
  dragging: boolean
  setHover: (time: number, cursor: { x: number; y: number }) => void
  clearHover: () => void
  setDragging: (dragging: boolean) => void
}

export const useResourceHoverStore = create<ResourceHoverState>(set => ({
  time: null,
  cursor: null,
  dragging: false,
  // 拖动期间忽略 hover 上报，避免悬浮窗跟随拖动闪现
  setHover: (time, cursor) => set(s => (s.dragging ? s : { time, cursor })),
  clearHover: () => set({ time: null, cursor: null }),
  // 进入拖动时顺带清空当前 hover，退出拖动仅复位标志（下次 mousemove 自然重建）
  setDragging: dragging => set(dragging ? { dragging, time: null, cursor: null } : { dragging }),
}))
