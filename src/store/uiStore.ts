/**
 * UI 状态管理
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_ICON_PROVIDER,
  DEFAULT_API_PROVIDER,
  type IconProviderId,
  type ApiProviderId,
} from '@/api/providers/registry'
import i18n, { getInitialLocale, ensureLocaleLoaded } from '@/i18n'
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
  /** 表格视图是否显示「咏唱开始时间」列 */
  showCastStartTime: boolean
  /**
   * 是否启用 HP 模拟（累积扣血 + 治疗补回）。
   * 关闭时三视图（PropertyPanel / 卡片 / 表格）回退到孤立 finalDamage vs maxHP 视角，
   * 但 calculator 仍然算 HP 池演化，便于未来"主时间轴 HP 曲线 overlay" 按需消费。
   */
  enableHpSimulation: boolean
  /** 是否展示资源预览悬浮窗（时间轴/表格 hover 时的战斗资源面板） */
  showResourceHover: boolean
  /** 当前正在拖拽的 castEvent.id；非拖拽态为 null。
   *  ephemeral 状态，从 persist 排除。 */
  draggingId: string | null
  /** 画布工具模式：pan=拖动平移（默认），select=矩形框选 */
  canvasTool: 'pan' | 'select'
  /** 图标源自学习首选（失败驱动，无 UI 选择） */
  iconLearned: IconProviderId
  /** API 源自学习首选（失败驱动，无 UI 选择） */
  apiLearned: ApiProviderId

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
  /** 切换显示「咏唱开始时间」列 */
  toggleShowCastStartTime: () => void
  /** 切换 HP 模拟显示 */
  toggleEnableHpSimulation: () => void
  /** 切换资源预览悬浮窗显示 */
  toggleShowResourceHover: () => void
  /** 设置当前拖拽的 castEvent.id；停止拖拽传 null */
  setDraggingId: (id: string | null) => void
  /** 设置画布工具模式 */
  setCanvasTool: (tool: 'pan' | 'select') => void
  /** 写回图标自学习首选 */
  setIconLearned: (id: IconProviderId) => void
  /** 写回 API 自学习首选 */
  setApiLearned: (id: ApiProviderId) => void
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
  // 非默认语言的 catalog 是按需加载的，切换前先确保已注入，否则会短暂回退中文
  void ensureLocaleLoaded(locale).then(() => i18n.changeLanguage(locale))
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
      showCastStartTime: false,
      enableHpSimulation: true,
      showResourceHover: true,
      draggingId: null,
      canvasTool: 'pan',
      iconLearned: DEFAULT_ICON_PROVIDER,
      apiLearned: DEFAULT_API_PROVIDER,

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

      toggleShowCastStartTime: () =>
        set(state => ({
          showCastStartTime: !state.showCastStartTime,
        })),

      toggleEnableHpSimulation: () =>
        set(state => ({
          enableHpSimulation: !state.enableHpSimulation,
        })),

      toggleShowResourceHover: () =>
        set(state => ({
          showResourceHover: !state.showResourceHover,
        })),

      setDraggingId: id => set({ draggingId: id }),

      setCanvasTool: tool => set({ canvasTool: tool }),

      setIconLearned: id => set({ iconLearned: id }),

      setApiLearned: id => set({ apiLearned: id }),
    }),
    {
      name: 'ui-store',
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      partialize: ({ theme, locale, draggingId, manualLock, ...rest }) => rest,
    }
  )
)
