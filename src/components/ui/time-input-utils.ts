/**
 * TimeInput 内部工具函数
 *
 * 组件内部状态使用整数 tenths（十分之一秒），避免浮点误差。
 * 对外 value 单位为秒（number）。
 */

/** 将秒（可含一位小数）转为 tenths 整数 */
export function secondsToTenths(seconds: number): number {
  return Math.round(seconds * 10)
}

/** 将 tenths 整数转为秒（一位小数精度，无浮点尾巴） */
export function tenthsToSeconds(tenths: number): number {
  return Math.round(tenths) / 10
}

export interface FormattedTime {
  /** '' 或 '-' */
  sign: '' | '-'
  /** 2 位分钟字符串 */
  mm: string
  /** 2 位秒字符串 */
  ss: string
  /** 1 位十分之一秒字符串 */
  f: string
}

/** 将 tenths 整数格式化为分段字符串 */
export function formatTenths(tenths: number): FormattedTime {
  const negative = tenths < 0
  const abs = Math.abs(tenths)
  const min = Math.floor(abs / 600)
  const sec = Math.floor((abs % 600) / 10)
  const frac = abs % 10
  return {
    sign: negative ? '-' : '',
    mm: String(min).padStart(2, '0'),
    ss: String(sec).padStart(2, '0'),
    f: String(frac),
  }
}

/**
 * 解析"完整时间字符串"为 tenths。
 *
 * 支持格式：
 * - `mm:ss.f` / `m:ss.f` / `mm:ss` / `m:ss`
 * - 纯秒数，如 `83.4` / `45`
 * - 可选前导 `-` 表示负数
 * - 允许首尾空白
 *
 * 非法输入返回 null。
 */
export function parseTimeString(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '') return null

  const negative = trimmed.startsWith('-')
  const body = negative ? trimmed.slice(1) : trimmed

  // mm:ss(.f) 格式
  const colonMatch = /^(\d+):(\d{1,2})(?:\.(\d))?$/.exec(body)
  if (colonMatch) {
    const mm = parseInt(colonMatch[1], 10)
    const ss = parseInt(colonMatch[2], 10)
    const f = colonMatch[3] ? parseInt(colonMatch[3], 10) : 0
    if (ss >= 60) return null
    const tenths = mm * 600 + ss * 10 + f
    return negative ? -tenths : tenths
  }

  // 纯秒数（整数或一位小数）
  const numMatch = /^(\d+)(?:\.(\d))?$/.exec(body)
  if (numMatch) {
    const whole = parseInt(numMatch[1], 10)
    const f = numMatch[2] ? parseInt(numMatch[2], 10) : 0
    const tenths = whole * 10 + f
    return negative ? -tenths : tenths
  }

  return null
}

// ============================================================================
// 状态机
// ============================================================================

export type Segment = 'mm' | 'ss' | 'f'

export interface TimeInputState {
  /** 当前值（十分之一秒，整数，可负） */
  tenths: number
  /** 当前聚焦段 */
  segment: Segment
  /** 数字键连续输入缓冲；切段/blur/非数字动作会被 commit 清空 */
  pending: string
}

export interface TimeInputConfig {
  /** 最小值（tenths） */
  min: number
  /** 最大值（tenths） */
  max: number
}

export type TimeInputAction =
  | { type: 'arrow'; dir: 'up' | 'down'; shift: boolean }
  | { type: 'digit'; digit: string }
  | { type: 'negate' }
  | { type: 'focusSegment'; segment: Segment }
  | { type: 'moveSegment'; dir: 'left' | 'right' }
  | { type: 'backspace' }
  | { type: 'paste'; text: string }
  | { type: 'commit' }

const SEGMENT_ORDER: Segment[] = ['mm', 'ss', 'f']
const SEGMENT_WIDTH: Record<Segment, number> = { mm: 2, ss: 2, f: 1 }
const SEGMENT_MAX: Record<Segment, number> = { mm: 99, ss: 59, f: 9 }

function clamp(n: number, cfg: TimeInputConfig): number {
  if (n < cfg.min) return cfg.min
  if (n > cfg.max) return cfg.max
  return n
}

/** 箭头键步进量（tenths） */
function arrowStep(segment: Segment, shift: boolean): number {
  if (segment === 'mm') return shift ? 6000 : 600
  if (segment === 'ss') return shift ? 100 : 10
  return shift ? 5 : 1
}

/**
 * 将 pending 字符串 commit 到 tenths：替换指定段的值，保留其他段和符号。
 */
function commitPending(tenths: number, segment: Segment, pending: string): number {
  if (pending === '') return tenths
  const value = parseInt(pending, 10)
  return writeSegment(tenths, segment, value)
}

/**
 * 将 segment 的值替换为 value（符号保留），返回新 tenths。
 */
function writeSegment(tenths: number, segment: Segment, value: number): number {
  const negative = tenths < 0
  const abs = Math.abs(tenths)
  let mm = Math.floor(abs / 600)
  let ss = Math.floor((abs % 600) / 10)
  let f = abs % 10
  if (segment === 'mm') mm = value
  else if (segment === 'ss') ss = value
  else f = value
  const newAbs = mm * 600 + ss * 10 + f
  return negative ? -newAbs : newAbs
}

/** 下一段；已是最后段返回同段 */
function nextSegment(s: Segment): Segment {
  const idx = SEGMENT_ORDER.indexOf(s)
  return SEGMENT_ORDER[Math.min(idx + 1, SEGMENT_ORDER.length - 1)]
}

function prevSegment(s: Segment): Segment {
  const idx = SEGMENT_ORDER.indexOf(s)
  return SEGMENT_ORDER[Math.max(idx - 1, 0)]
}

/**
 * 在处理非数字动作前把 pending flush 掉。
 */
function flushPending(state: TimeInputState): TimeInputState {
  if (state.pending === '') return state
  return {
    ...state,
    tenths: commitPending(state.tenths, state.segment, state.pending),
    pending: '',
  }
}

export function reduceTimeInput(
  state: TimeInputState,
  action: TimeInputAction,
  cfg: TimeInputConfig
): TimeInputState {
  switch (action.type) {
    case 'arrow': {
      const flushed = flushPending(state)
      const delta = arrowStep(flushed.segment, action.shift) * (action.dir === 'up' ? 1 : -1)
      return { ...flushed, tenths: clamp(flushed.tenths + delta, cfg) }
    }

    case 'digit': {
      if (!/^\d$/.test(action.digit)) return state
      const width = SEGMENT_WIDTH[state.segment]
      const segMax = SEGMENT_MAX[state.segment]
      const newPending = state.pending + action.digit
      const asNum = parseInt(newPending, 10)

      // 超过段最大值：按"重新开始"处理 — pending 置为当前数字
      if (asNum > segMax) {
        // 当前输入就是新开始的第一位
        const restart = action.digit
        // 对于 f 段（宽度 1），立即 commit 并跳段
        if (width === 1) {
          const restartNum = parseInt(restart, 10)
          const newTenths = clamp(writeSegment(state.tenths, state.segment, restartNum), cfg)
          return { ...state, tenths: newTenths, pending: '', segment: nextSegment(state.segment) }
        }
        return { ...state, pending: restart }
      }

      // 满位：commit + 跳下一段
      if (newPending.length >= width) {
        const newTenths = clamp(writeSegment(state.tenths, state.segment, asNum), cfg)
        return { ...state, tenths: newTenths, pending: '', segment: nextSegment(state.segment) }
      }

      // 未满位但下一位的任何取值都会超 max：提前 commit + 跳段
      // 例如 ss 段输入 "6"，下一位 0-9 都让 60-69 > 59
      if (asNum * 10 > segMax) {
        const newTenths = clamp(writeSegment(state.tenths, state.segment, asNum), cfg)
        return { ...state, tenths: newTenths, pending: '', segment: nextSegment(state.segment) }
      }

      return { ...state, pending: newPending }
    }

    case 'negate': {
      const flushed = flushPending(state)
      if (flushed.tenths === 0) return flushed
      return { ...flushed, tenths: clamp(-flushed.tenths, cfg) }
    }

    case 'focusSegment': {
      const flushed = flushPending(state)
      return { ...flushed, segment: action.segment }
    }

    case 'moveSegment': {
      const flushed = flushPending(state)
      const segment =
        action.dir === 'right' ? nextSegment(flushed.segment) : prevSegment(flushed.segment)
      return { ...flushed, segment }
    }

    case 'backspace': {
      if (state.pending !== '') {
        return { ...state, pending: '' }
      }
      return { ...state, tenths: clamp(writeSegment(state.tenths, state.segment, 0), cfg) }
    }

    case 'paste': {
      const parsed = parseTimeString(action.text)
      if (parsed === null) return state
      return { ...state, tenths: clamp(parsed, cfg), pending: '' }
    }

    case 'commit': {
      return flushPending(state)
    }
  }
}
