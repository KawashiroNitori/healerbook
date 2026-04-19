/**
 * UI 状态管理
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIState {
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
  /** 伤害事件轨道是否折叠 */
  isDamageTrackCollapsed: boolean
  /** 是否显示实际伤害 */
  showActualDamage: boolean
  /** 是否显示原始伤害 */
  showOriginalDamage: boolean

  // Actions
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
  /** 切换伤害事件轨道折叠 */
  toggleDamageTrackCollapsed: () => void
  /** 切换显示实际伤害 */
  toggleShowActualDamage: () => void
  /** 切换显示原始伤害 */
  toggleShowOriginalDamage: () => void
}

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem('theme', theme)
}

function getInitialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const initialTheme = getInitialTheme()
applyTheme(initialTheme)

export const useUIStore = create<UIState>()(
  persist(
    set => ({
      showGrid: true,
      showTimeRuler: true,
      showCooldownIndicators: true,
      theme: initialTheme,
      isReadOnly: false,
      isDamageTrackCollapsed: false,
      showActualDamage: true,
      showOriginalDamage: false,

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

      setTheme: theme => {
        applyTheme(theme)
        set({ theme })
      },

      toggleReadOnly: () =>
        set(state => ({
          isReadOnly: !state.isReadOnly,
        })),

      toggleDamageTrackCollapsed: () =>
        set(state => ({
          isDamageTrackCollapsed: !state.isDamageTrackCollapsed,
        })),

      toggleShowActualDamage: () =>
        set(state => ({
          showActualDamage: !state.showActualDamage,
        })),

      toggleShowOriginalDamage: () =>
        set(state => ({
          showOriginalDamage: !state.showOriginalDamage,
        })),
    }),
    {
      name: 'ui-store',
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      partialize: ({ theme, ...rest }) => rest,
    }
  )
)
