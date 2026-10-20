/**
 * 时间轴组件共享常量
 */

import { useUIStore } from '@/store/uiStore'

// 定义在无依赖模块中，供 Worker / 纯函数引用；此处转出以保持现有引用不变
export { TIMELINE_START_TIME } from '@/constants/timeline'

/** Canvas 主题色定义 */
interface CanvasColors {
  // 背景
  trackBgEven: string
  trackBgOdd: string
  damageTrackBg: string
  timeRulerBg: string
  cardBg: string
  cardBgTankbuster: string
  minimapBg: string
  placeholderBg: string
  timeLabelBg: string

  // 文字
  textPrimary: string
  textSecondary: string
  textDark: string

  // 线条
  gridLine: string
  gridLineLight: string
  separator: string
  zeroLine: string
  minimapGrid: string
  minimapSeparator: string
  idleLine: string

  // HP 曲线
  hpCurveStroke: string
  hpCurveFill: string
  hpCurveBaseline: string

  // 交互
  crosshairStroke: string
  crosshairTrackHighlight: string
  cooldownStripe: string

  // 视口指示器
  viewportStroke: string
  viewportFill: string

  // 条纹线宽
  cooldownStripeWidth: number
}

const lightColors: CanvasColors = {
  trackBgEven: '#fafafa',
  trackBgOdd: '#ffffff',
  damageTrackBg: '#e5e7eb',
  timeRulerBg: '#f3f4f6',
  cardBg: '#ffffff',
  cardBgTankbuster: '#f9fafb',
  minimapBg: '#ffffff',
  placeholderBg: '#e5e7eb',
  timeLabelBg: '#ffffff',

  textPrimary: '#6b7280',
  textSecondary: '#9ca3af',
  textDark: '#18181b',

  gridLine: '#d1d5db',
  gridLineLight: '#f3f4f6',
  separator: '#e5e7eb',
  zeroLine: '#9ca3af',
  minimapGrid: '#e4e4e7',
  minimapSeparator: '#d4d4d8',
  idleLine: '#d1d5db',

  hpCurveStroke: '#16a34a',
  hpCurveFill: 'rgba(34, 197, 94, 0.12)',
  hpCurveBaseline: '#cbd5e1',

  crosshairStroke: '#9ca3af',
  crosshairTrackHighlight: 'rgba(59, 130, 246, 0.08)',
  cooldownStripe: 'rgba(120, 120, 120, 0.22)',

  viewportStroke: '#2563eb',
  viewportFill: 'rgba(37, 99, 235, 0.08)',

  cooldownStripeWidth: 2,
}

const darkColors: CanvasColors = {
  trackBgEven: 'rgb(10, 10, 10)',
  trackBgOdd: 'rgba(38, 38, 38, 0.2)',
  damageTrackBg: 'rgb(30, 30, 30)',
  timeRulerBg: 'rgb(22, 22, 22)',
  cardBg: 'rgb(42, 42, 42)',
  cardBgTankbuster: 'rgb(36, 36, 36)',
  minimapBg: 'rgb(14, 14, 14)',
  placeholderBg: 'rgb(50, 50, 50)',
  timeLabelBg: 'rgb(14, 14, 14)',

  textPrimary: '#d1d5db',
  textSecondary: '#9ca3af',
  textDark: '#f4f4f5',

  gridLine: '#374151',
  gridLineLight: '#1f2937',
  separator: 'rgb(38, 38, 38)',
  zeroLine: '#6b7280',
  minimapGrid: '#3f3f46',
  minimapSeparator: '#52525b',
  idleLine: '#4b5563',

  hpCurveStroke: '#22c55e',
  hpCurveFill: 'rgba(34, 197, 94, 0.18)',
  hpCurveBaseline: '#475569',

  crosshairStroke: '#6b7280',
  crosshairTrackHighlight: 'rgba(59, 130, 246, 0.15)',
  cooldownStripe: 'rgba(160, 160, 160, 0.25)',

  cooldownStripeWidth: 1,

  viewportStroke: '#3b82f6',
  viewportFill: 'rgba(59, 130, 246, 0.12)',
}

/** 获取当前主题的 Canvas 颜色（非 hook，用于 Canvas 2D 绑定） */
export function getCanvasColors(): CanvasColors {
  return useUIStore.getState().theme === 'dark' ? darkColors : lightColors
}

/** 获取当前主题的 Canvas 颜色（React hook） */
export function useCanvasColors(): CanvasColors {
  const theme = useUIStore(s => s.theme)
  return theme === 'dark' ? darkColors : lightColors
}

// 伤害事件时间指示线样式（主题无关的强调色）
export const DAMAGE_TIME_LINE_STYLE = {
  stroke: '#ef4444',
  strokeWidth: 1,
  opacity: 0.2,
}

/** HP 曲线轨道高度（px） */
export const HP_CURVE_HEIGHT = 60

/**
 * 十字准线 / 时间指示线的初始 points。
 *
 * 这些线由鼠标事件处理器以 imperative 方式直接操控（`.points()` / `.visible()`），
 * React 侧必须传一个**稳定引用**——否则组件每次重渲染时 react-konva 都会拿新的数组
 * 字面量当作 `points` 变化、回写覆盖掉 imperative 设好的位置，导致竖线闪动 / 跳到 x=0。
 * 初始值本身无意义：首帧 `visible=false`，且处理器在显示前总会先设好真实 points。
 */
export const CROSSHAIR_LINE_POINTS: number[] = [0, 0, 0, 0]

/** 伤害事件卡片最小宽度（px）。无读条 / 读条极短时兜底，保证文字可读。 */
export const MIN_CARD_WIDTH = 150
