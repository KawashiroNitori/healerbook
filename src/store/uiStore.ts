/**
 * UI 状态管理
 */

import { create } from 'zustand'

interface UIState {
  /** 侧边栏是否展开 */
  isSidebarOpen: boolean
  /** 技能面板是否展开 */
  isSkillPanelOpen: boolean
  /** 属性面板是否展开 */
  isPropertyPanelOpen: boolean
  /** 当前激活的面板 */
  activePanel: 'skills' | 'properties' | null
  /** 是否显示网格 */
  showGrid: boolean
  /** 是否显示时间标尺 */
  showTimeRuler: boolean
  /** 是否显示 CD 指示器 */
  showCooldownIndicators: boolean
  /** 主题模式 */
  theme: 'light' | 'dark'
  /** 是否为只读模式 */
  isReadOnly: boolean
  /** 隐藏的玩家 ID 集合 */
  hiddenPlayerIds: Set<number>

  // Actions
  /** 切换侧边栏 */
  toggleSidebar: () => void
  /** 切换技能面板 */
  toggleSkillPanel: () => void
  /** 切换属性面板 */
  togglePropertyPanel: () => void
  /** 设置激活面板 */
  setActivePanel: (panel: 'skills' | 'properties' | null) => void
  /** 切换网格显示 */
  toggleGrid: () => void
  /** 切换时间标尺显示 */
  toggleTimeRuler: () => void
  /** 切换 CD 指示器显示 */
  toggleCooldownIndicators: () => void
  /** 设置主题 */
  setTheme: (theme: 'light' | 'dark') => void
  /** 切换只读模式 */
  toggleReadOnly: () => void
  /** 切换玩家轨道可见性 */
  togglePlayerVisibility: (playerId: number) => void
  /** 隐藏除指定玩家外的所有玩家（独奏模式），若已是独奏则全部显示 */
  isolatePlayer: (playerId: number, allPlayerIds: number[]) => void
}

export const useUIStore = create<UIState>(set => ({
  isSidebarOpen: true,
  isSkillPanelOpen: true,
  isPropertyPanelOpen: true,
  activePanel: null,
  showGrid: true,
  showTimeRuler: true,
  showCooldownIndicators: true,
  theme: 'light',
  isReadOnly: false,
  hiddenPlayerIds: new Set<number>(),

  toggleSidebar: () =>
    set(state => ({
      isSidebarOpen: !state.isSidebarOpen,
    })),

  toggleSkillPanel: () =>
    set(state => ({
      isSkillPanelOpen: !state.isSkillPanelOpen,
      activePanel: !state.isSkillPanelOpen ? 'skills' : null,
    })),

  togglePropertyPanel: () =>
    set(state => ({
      isPropertyPanelOpen: !state.isPropertyPanelOpen,
      activePanel: !state.isPropertyPanelOpen ? 'properties' : null,
    })),

  setActivePanel: panel =>
    set({
      activePanel: panel,
      isSkillPanelOpen: panel === 'skills' ? true : false,
      isPropertyPanelOpen: panel === 'properties' ? true : false,
    }),

  toggleGrid: () =>
    set(state => ({
      showGrid: !state.showGrid,
    })),

  toggleTimeRuler: () =>
    set(state => ({
      showTimeRuler: !state.showTimeRuler,
    })),

  toggleCooldownIndicators: () =>
    set(state => ({
      showCooldownIndicators: !state.showCooldownIndicators,
    })),

  setTheme: theme =>
    set({
      theme,
    }),

  toggleReadOnly: () =>
    set(state => ({
      isReadOnly: !state.isReadOnly,
    })),

  togglePlayerVisibility: (playerId: number) =>
    set(state => {
      const next = new Set(state.hiddenPlayerIds)
      if (next.has(playerId)) {
        next.delete(playerId)
      } else {
        next.add(playerId)
      }
      return { hiddenPlayerIds: next }
    }),

  isolatePlayer: (playerId: number, allPlayerIds: number[]) =>
    set(state => {
      const others = allPlayerIds.filter(id => id !== playerId)
      const alreadyIsolated =
        others.every(id => state.hiddenPlayerIds.has(id)) && !state.hiddenPlayerIds.has(playerId)
      if (alreadyIsolated) {
        return { hiddenPlayerIds: new Set<number>() }
      }
      return { hiddenPlayerIds: new Set(others) }
    }),
}))
