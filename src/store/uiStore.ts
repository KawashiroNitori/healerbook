/**
 * UI 状态管理
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import i18n, { getInitialLocale } from '@/i18n'
import type { AppLanguage } from '@/types/i18n'

interface UIState {
  /** 是否显示网格 */
  showGrid: boolean
  /** 是否显示时间标尺 */
  showTimeRuler: boolean
  /** 是否显示 CD 指示器 */
  showCooldownIndicators: boolean
  /** 主题模式 */
  theme: 'light' | 'dark'
  /** 当前界面语言 */
  locale: AppLanguage
  /** 用户手动锁定编辑 */
  manualLock: boolean
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
  /** 当前正在拖拽的 castEvent.id；非拖拽态为 null。
   *  ephemeral 状态，从 persist 排除。 */
  draggingId: string | null
  /** 画布工具模式：pan=拖动平移（默认），select=矩形框选 */
  canvasTool: 'pan' | 'select'

  // Actions
  /** 切换网格显示 */
  toggleGrid: () => void
  /** 切换时间标尺显示 */
  toggleTimeRuler: () => void
  /** 切换 CD 指示器显示 */
  toggleCooldownIndicators: () => void
  /** 设置主题 */
  setTheme: (theme: 'light' | 'dark') => void
  /** 设置界面语言 */
  setLocale: (locale: AppLanguage) => void
  /** 切换手动锁定 */
  toggleManualLock: () => void
  /** 切换伤害事件轨道折叠 */
  toggleDamageTrackCollapsed: () => void
  /** 切换显示实际伤害 */
  toggleShowActualDamage: () => void
  /** 切换显示原始伤害 */
  toggleShowOriginalDamage: () => void
  /** 切换 HP 模拟显示 */
  toggleEnableHpSimulation: () => void
  /** 设置当前拖拽的 castEvent.id；停止拖拽传 null */
  setDraggingId: (id: string | null) => void
  /** 设置画布工具模式 */
  setCanvasTool: (tool: 'pan' | 'select') => void
}

function applyTheme(theme: 'light' | 'dark') {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('theme', theme)
  }
}

function getInitialTheme(): 'light' | 'dark' {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('theme')
    if (stored === 'light' || stored === 'dark') return stored
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

const initialTheme = getInitialTheme()
applyTheme(initialTheme)

function applyLocale(locale: AppLanguage) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('locale', locale)
  }
  void i18n.changeLanguage(locale)
}

const initialLocale = getInitialLocale()

export const useUIStore = create<UIState>()(
  persist(
    set => ({
      showGrid: true,
      showTimeRuler: true,
      showCooldownIndicators: true,
      theme: initialTheme,
      locale: initialLocale,
      manualLock: false,
      isDamageTrackCollapsed: false,
      showActualDamage: true,
      showOriginalDamage: false,
      enableHpSimulation: true,
      draggingId: null,
      canvasTool: 'pan',

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

      setLocale: locale => {
        applyLocale(locale)
        set({ locale })
      },

      toggleManualLock: () =>
        set(state => ({
          manualLock: !state.manualLock,
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

      setDraggingId: id => set({ draggingId: id }),

      setCanvasTool: tool => set({ canvasTool: tool }),
    }),
    {
      name: 'ui-store',
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      partialize: ({ theme, locale, draggingId, manualLock, ...rest }) => rest,
    }
  )
)
