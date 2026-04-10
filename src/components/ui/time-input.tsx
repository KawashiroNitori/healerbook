/**
 * TimeInput — mm:ss.f 分段时间输入
 *
 * 外观对齐 shadcn Input；内部由三个 role="spinbutton" 的段组成，
 * 支持方向键步进、数字覆盖堆叠、Shift 加速、mm 段按 `-` 切换正负、粘贴识别。
 *
 * 外部 API 使用"秒"作为单位（可含一位小数、可负），内部以整数 tenths 运算，避免浮点误差。
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  formatTenths,
  reduceTimeInput,
  secondsToTenths,
  tenthsToSeconds,
  type Segment,
  type TimeInputConfig,
  type TimeInputState,
} from './time-input-utils'

export interface TimeInputProps {
  /** 秒，可含一位小数、可负 */
  value: number
  /** 值变更回调（秒） */
  onChange: (value: number) => void
  /** 最小秒值，默认无限制（组件内部用 Number.NEGATIVE_INFINITY 换算） */
  min?: number
  /** 最大秒值，默认 99:59.9 = 5999 秒 + 0.9 */
  max?: number
  disabled?: boolean
  size?: 'sm' | 'default'
  autoFocus?: boolean
  className?: string
  'aria-label'?: string
}

const DEFAULT_MAX_TENTHS = 99 * 600 + 59 * 10 + 9

function TimeInput({
  value,
  onChange,
  min,
  max,
  disabled = false,
  size = 'default',
  autoFocus = false,
  className,
  'aria-label': ariaLabel,
}: TimeInputProps) {
  const cfg: TimeInputConfig = React.useMemo(
    () => ({
      min: min === undefined ? -DEFAULT_MAX_TENTHS : secondsToTenths(min),
      max: max === undefined ? DEFAULT_MAX_TENTHS : secondsToTenths(max),
    }),
    [min, max]
  )

  const [state, setState] = React.useState<TimeInputState>(() => ({
    tenths: secondsToTenths(value),
    segment: 'mm',
    pending: '',
  }))

  // 外部 value 变更时同步内部状态（忽略由自身 emit 触发的回流）
  const lastEmittedRef = React.useRef<number>(secondsToTenths(value))
  React.useEffect(() => {
    const external = secondsToTenths(value)
    if (external !== lastEmittedRef.current) {
      lastEmittedRef.current = external
      setState(s => ({ ...s, tenths: external, pending: '' }))
    }
  }, [value])

  // 内部状态变更时 emit
  React.useEffect(() => {
    if (state.tenths !== lastEmittedRef.current) {
      lastEmittedRef.current = state.tenths
      onChange(tenthsToSeconds(state.tenths))
    }
    // 只在 tenths 变更时 emit；onChange 不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tenths])

  const formatted = formatTenths(state.tenths)
  const segmentRefs = {
    mm: React.useRef<HTMLSpanElement>(null),
    ss: React.useRef<HTMLSpanElement>(null),
    f: React.useRef<HTMLSpanElement>(null),
  }

  // autoFocus：初次挂载时聚焦 mm 段
  const didAutoFocusRef = React.useRef(false)
  React.useEffect(() => {
    if (autoFocus && !didAutoFocusRef.current) {
      didAutoFocusRef.current = true
      segmentRefs.mm.current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus])

  // 当 segment 变更时自动转移 DOM 焦点
  const prevSegmentRef = React.useRef<Segment>(state.segment)
  React.useEffect(() => {
    if (prevSegmentRef.current !== state.segment) {
      prevSegmentRef.current = state.segment
      segmentRefs[state.segment].current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.segment])

  const dispatch = React.useCallback(
    (action: Parameters<typeof reduceTimeInput>[1]) => {
      setState(s => reduceTimeInput(s, action, cfg))
    },
    [cfg]
  )

  const handleKeyDown = (segment: Segment) => (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (disabled) return

    // 数字键
    if (/^\d$/.test(e.key)) {
      e.preventDefault()
      dispatch({ type: 'digit', digit: e.key })
      return
    }

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        dispatch({ type: 'arrow', dir: 'up', shift: e.shiftKey })
        return
      case 'ArrowDown':
        e.preventDefault()
        dispatch({ type: 'arrow', dir: 'down', shift: e.shiftKey })
        return
      case 'ArrowLeft':
        e.preventDefault()
        dispatch({ type: 'moveSegment', dir: 'left' })
        return
      case 'ArrowRight':
        e.preventDefault()
        dispatch({ type: 'moveSegment', dir: 'right' })
        return
      case ':':
      case '.':
        e.preventDefault()
        dispatch({ type: 'moveSegment', dir: 'right' })
        return
      case '-':
        if (segment === 'mm') {
          e.preventDefault()
          dispatch({ type: 'negate' })
        }
        return
      case 'Backspace':
      case 'Delete':
        e.preventDefault()
        dispatch({ type: 'backspace' })
        return
      // Tab/Enter 等落出组件，交给浏览器默认行为
    }
  }

  const handleFocus = (segment: Segment) => () => {
    if (state.segment !== segment) {
      dispatch({ type: 'focusSegment', segment })
    }
  }

  const handleBlur = () => {
    dispatch({ type: 'commit' })
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLSpanElement>) => {
    if (disabled) return
    e.preventDefault()
    const text = e.clipboardData.getData('text')
    dispatch({ type: 'paste', text })
  }

  // 段内显示：pending 非空时显示 pending 左补零；否则显示 formatted
  const displaySegment = (segment: Segment): string => {
    if (state.segment === segment && state.pending !== '') {
      const width = segment === 'f' ? 1 : 2
      return state.pending.padStart(width, '0')
    }
    return formatted[segment]
  }

  const segmentClass = cn(
    'rounded px-0.5 outline-none',
    'focus:bg-blue-500 focus:text-white dark:focus:bg-blue-600',
    disabled && 'cursor-not-allowed'
  )

  const sizeClass = size === 'sm' ? 'px-2.5 py-1.5 text-sm' : 'px-3 py-2 text-sm'

  const mmAriaMax = cfg.max >= 0 ? Math.floor(cfg.max / 600) : 0
  const mmAriaMin = cfg.min < 0 ? -Math.floor(Math.abs(cfg.min) / 600) : Math.floor(cfg.min / 600)

  const currentMinutes = Math.floor(Math.abs(state.tenths) / 600) * (state.tenths < 0 ? -1 : 1)
  const currentSeconds = Math.floor((Math.abs(state.tenths) % 600) / 10)
  const currentFracs = Math.abs(state.tenths) % 10

  return (
    <div
      className={cn(
        'flex w-full items-center rounded-md border border-border bg-background text-foreground',
        'focus-within:outline-none focus-within:ring-1 focus-within:ring-ring',
        'tabular-nums select-none',
        sizeClass,
        disabled && 'cursor-not-allowed bg-muted opacity-70',
        className
      )}
      aria-label={ariaLabel ?? '时间'}
    >
      {/* 符号位：负数时显示，正数不占位 */}
      {formatted.sign === '-' && <span aria-hidden>-</span>}

      <span
        ref={segmentRefs.mm}
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label="分钟"
        aria-valuenow={currentMinutes}
        aria-valuemin={mmAriaMin}
        aria-valuemax={mmAriaMax}
        aria-valuetext={`${currentMinutes} 分`}
        className={segmentClass}
        onKeyDown={handleKeyDown('mm')}
        onFocus={handleFocus('mm')}
        onBlur={handleBlur}
        onPaste={handlePaste}
      >
        {displaySegment('mm')}
      </span>
      <span aria-hidden>:</span>
      <span
        ref={segmentRefs.ss}
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label="秒"
        aria-valuenow={currentSeconds}
        aria-valuemin={0}
        aria-valuemax={59}
        aria-valuetext={`${currentSeconds} 秒`}
        className={segmentClass}
        onKeyDown={handleKeyDown('ss')}
        onFocus={handleFocus('ss')}
        onBlur={handleBlur}
        onPaste={handlePaste}
      >
        {displaySegment('ss')}
      </span>
      <span aria-hidden>.</span>
      <span
        ref={segmentRefs.f}
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label="十分之一秒"
        aria-valuenow={currentFracs}
        aria-valuemin={0}
        aria-valuemax={9}
        aria-valuetext={`${currentFracs} 十分之一秒`}
        className={segmentClass}
        onKeyDown={handleKeyDown('f')}
        onFocus={handleFocus('f')}
        onBlur={handleBlur}
        onPaste={handlePaste}
      >
        {displaySegment('f')}
      </span>
    </div>
  )
}

export { TimeInput }
