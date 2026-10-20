/**
 * 时间轴阶段纯逻辑。
 *
 * 阶段只是时间标记：本模块不读写 store、不依赖 React / Konva，Worker 与前端共用。
 * 颜色、顺序都不存储，统一由「按 time 排序后的位置」推导。
 */

import type { RawPhase, TimelinePhase } from '@/types/timeline'
import { TIMELINE_START_TIME } from '@/constants/timeline'

/** 7 色循环：灰、绿、蓝、紫、橙、粉、金 */
export const PHASE_COLORS = [
  '#6b7280',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#f97316',
  '#ec4899',
  '#ca8a04',
] as const

/** 相邻阶段的最小间隔（秒）；导入去重也用此阈值 */
export const PHASE_MIN_GAP = 1

/** 跳转后阶段起点距视口左缘的偏移（px），也是「当前所在阶段」的判定点 */
export const PHASE_VIEW_OFFSET_PX = 40

const SHORT_LABEL_MAX_CHARS = 6

const round1 = (t: number) => Math.round(t * 10) / 10

export function sortPhases(phases: readonly TimelinePhase[]): TimelinePhase[] {
  return [...phases].sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function phaseColor(sortedIndex: number): string {
  return PHASE_COLORS[sortedIndex % PHASE_COLORS.length]
}

/** 缩略图 / 窄工具栏用的短标签：有冒号取冒号前，否则取前 6 个字符 */
export function shortPhaseLabel(name: string): string {
  const idx = name.search(/[:：]/)
  if (idx > 0) return name.slice(0, idx).trim()
  const chars = Array.from(name)
  return chars.length > SHORT_LABEL_MAX_CHARS
    ? chars.slice(0, SHORT_LABEL_MAX_CHARS).join('') + '…'
    : name
}

/** 开始时间 ≤ time 的最后一个阶段下标；早于第一个阶段（或无阶段）返回 -1 */
export function currentPhaseIndex(sorted: readonly TimelinePhase[], time: number): number {
  let result = -1
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].time <= time) result = i
    else break
  }
  return result
}

/**
 * 把阶段时间钳到相邻阶段之间（至少相隔 PHASE_MIN_GAP），下限 TIMELINE_START_TIME。
 * 移动已有阶段时相邻阶段取它**原位置**的前后两个（不能越过相邻阶段）；
 * phaseId 为 null（或不存在）表示「新增」，按插入位置找相邻阶段。无合法位置返回 null。
 */
export function clampPhaseTime(
  sorted: readonly TimelinePhase[],
  phaseId: string | null,
  time: number
): { time: number; clamped: boolean } | null {
  const idx = phaseId === null ? -1 : sorted.findIndex(p => p.id === phaseId)
  const insertAt = idx >= 0 ? idx : sorted.filter(p => p.time <= time).length
  const prev = sorted[insertAt - 1] as TimelinePhase | undefined
  const next = sorted[idx >= 0 ? idx + 1 : insertAt] as TimelinePhase | undefined
  const lower = prev ? prev.time + PHASE_MIN_GAP : TIMELINE_START_TIME
  const upper = next ? next.time - PHASE_MIN_GAP : Infinity
  // 两侧相邻阶段间距不足 2 × PHASE_MIN_GAP：无合法位置，由调用方提示
  if (lower > upper) return null
  const clampedTime = round1(Math.min(upper, Math.max(lower, time)))
  return { time: clampedTime, clamped: clampedTime !== round1(time) }
}

/** 新增阶段的默认名：P{插入后的序号} */
export function defaultPhaseName(sorted: readonly TimelinePhase[], time: number): string {
  return `P${sorted.filter(p => p.time < time).length + 1}`
}

/**
 * 导入数据规整：先把早于时间轴起点的钳到起点，再按时间排序，
 * 相邻差 < PHASE_MIN_GAP 的只留后一个（同一时刻多个 transition 时，较晚出现的才是实际生效的阶段）。
 */
export function normalizeRawPhases(raw: readonly RawPhase[]): RawPhase[] {
  const sorted = raw
    .map(p => ({ ...p, time: Math.max(TIMELINE_START_TIME, p.time) }))
    // Array.prototype.sort 稳定：同时刻保持 FFLogs 给出的先后
    .sort((a, b) => a.time - b.time)
  const out: RawPhase[] = []
  for (const p of sorted) {
    const last = out[out.length - 1]
    if (last && p.time - last.time < PHASE_MIN_GAP) out[out.length - 1] = p
    else out.push(p)
  }
  return out
}

/** 开区间重叠判定（端点相接不算重叠），用于标尺刻度遮挡 */
export function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1]
}
