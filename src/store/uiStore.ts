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
  /**
   * 是否启用 HP 模拟（累积扣血 + 治疗补回）。
   * 关闭时三视图（PropertyPanel / 卡片 / 表格）回退到孤立 finalDamage vs maxHP 视角，
   * 但 calculator 仍然算 HP 池演化，便于未来"主时间轴 HP 曲线 overlay" 按需消费。
   */
  enableHpSimulation: boolean

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
  /** 切换 HP 模拟显示 */
  toggleEnableHpSimulation: () => void
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
      enableHpSimulation: true,

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

      toggleEnableHpSimulation: () =>
        set(state => ({
          enableHpSimulation: !state.enableHpSimulation,
        })),
    }),
    {
      name: 'ui-store',
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      partialize: ({ theme, ...rest }) => rest,
    }
  )
)
