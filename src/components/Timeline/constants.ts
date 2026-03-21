/**
 * 时间轴组件共享常量
 */

/** 时间轴起点（秒），允许展示战斗开始前的 prepull 阶段 */
export const TIMELINE_START_TIME = -30

// 时间刻度网格线样式（实线）
export const GRID_LINE_STYLE = {
  stroke: '#d1d5db',
  strokeWidth: 1,
  dash: undefined, // 实线
}

// 伤害事件时间指示线样式
export const DAMAGE_TIME_LINE_STYLE = {
  stroke: '#ef4444',
  strokeWidth: 1,
  opacity: 0.2,
}
