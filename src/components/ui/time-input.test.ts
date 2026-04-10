/**
 * TimeInput 组件纯函数测试
 *
 * 组件内部使用 tenths（十分之一秒，整数）作为状态单位，
 * 对外 value 使用 seconds（number，可带 .1 小数）。
 */

import { describe, it, expect } from 'vitest'
import {
  secondsToTenths,
  tenthsToSeconds,
  formatTenths,
  parseTimeString,
  reduceTimeInput,
  type TimeInputState,
  type TimeInputAction,
} from './time-input-utils'

const initialState = (tenths: number, segment: 'mm' | 'ss' | 'f' = 'mm'): TimeInputState => ({
  tenths,
  segment,
  pending: '',
})

const config = { min: -10000, max: 99 * 600 + 59 * 10 + 9 }
const tightMinConfig = { min: -300, max: 99 * 600 + 59 * 10 + 9 }

const apply = (state: TimeInputState, ...actions: TimeInputAction[]): TimeInputState =>
  actions.reduce((s, a) => reduceTimeInput(s, a, config), state)

describe('secondsToTenths / tenthsToSeconds', () => {
  it('正数: 5.3s 往返', () => {
    expect(secondsToTenths(5.3)).toBe(53)
    expect(tenthsToSeconds(53)).toBe(5.3)
  })

  it('负数: -12.7s 往返', () => {
    expect(secondsToTenths(-12.7)).toBe(-127)
    expect(tenthsToSeconds(-127)).toBe(-12.7)
  })

  it('浮点误差: 0.1 + 0.2 不产生 3', () => {
    expect(secondsToTenths(0.1 + 0.2)).toBe(3)
  })

  it('tenthsToSeconds 输出一位小数精度（无浮点尾巴）', () => {
    expect(tenthsToSeconds(1)).toBe(0.1)
    expect(tenthsToSeconds(10)).toBe(1)
    expect(tenthsToSeconds(303)).toBe(30.3)
  })
})

describe('formatTenths', () => {
  it('0 → [空]00:00.0（正数左侧留 1ch 空 slot）', () => {
    expect(formatTenths(0)).toEqual({ sign: '', mm: '00', ss: '00', f: '0' })
  })

  it('63.2s → 01:03.2', () => {
    expect(formatTenths(632)).toEqual({ sign: '', mm: '01', ss: '03', f: '2' })
  })

  it('负数 -30.0s → -00:30.0', () => {
    expect(formatTenths(-300)).toEqual({ sign: '-', mm: '00', ss: '30', f: '0' })
  })

  it('负数 -1:30.5 → -01:30.5', () => {
    expect(formatTenths(-905)).toEqual({ sign: '-', mm: '01', ss: '30', f: '5' })
  })

  it('99:59.9 双位分钟上限', () => {
    expect(formatTenths(99 * 600 + 59 * 10 + 9)).toEqual({
      sign: '',
      mm: '99',
      ss: '59',
      f: '9',
    })
  })
})

describe('parseTimeString (粘贴识别)', () => {
  it('mm:ss.f 格式 "01:23.4"', () => {
    expect(parseTimeString('01:23.4')).toBe(834)
  })

  it('m:ss.f 简写 "5:03.2"', () => {
    expect(parseTimeString('5:03.2')).toBe(5 * 600 + 32)
  })

  it('mm:ss 无小数 "01:23"', () => {
    expect(parseTimeString('01:23')).toBe(830)
  })

  it('纯秒数 "83.4" → 834 tenths', () => {
    expect(parseTimeString('83.4')).toBe(834)
  })

  it('纯整数 "45" → 45 tenths（视作"填当前段"语义需由调用方处理，这里先回退为秒 → 450）', () => {
    // 这里的约定：parseTimeString 只处理"完整时间字符串"语义。
    // 纯整数视作秒数。段级覆盖由 reducer 的数字键处理，不走这里。
    expect(parseTimeString('45')).toBe(450)
  })

  it('负数 "-01:23.4"', () => {
    expect(parseTimeString('-01:23.4')).toBe(-834)
  })

  it('含空白 "  01:23.4  "', () => {
    expect(parseTimeString('  01:23.4  ')).toBe(834)
  })

  it('非法字符串返回 null', () => {
    expect(parseTimeString('abc')).toBeNull()
    expect(parseTimeString('')).toBeNull()
    expect(parseTimeString('12:ab')).toBeNull()
  })
})

describe('reduceTimeInput — 箭头键步进（数值语义）', () => {
  it('mm 段 ↑: +60s', () => {
    const next = apply(initialState(500, 'mm'), { type: 'arrow', dir: 'up', shift: false })
    expect(next.tenths).toBe(1100)
  })

  it('mm 段 ↓: -60s', () => {
    const next = apply(initialState(700, 'mm'), { type: 'arrow', dir: 'down', shift: false })
    expect(next.tenths).toBe(100)
  })

  it('ss 段 ↑: +1s', () => {
    const next = apply(initialState(50, 'ss'), { type: 'arrow', dir: 'up', shift: false })
    expect(next.tenths).toBe(60)
  })

  it('ss 段 ↓: -1s', () => {
    const next = apply(initialState(50, 'ss'), { type: 'arrow', dir: 'down', shift: false })
    expect(next.tenths).toBe(40)
  })

  it('f 段 ↑: +0.1s', () => {
    const next = apply(initialState(50, 'f'), { type: 'arrow', dir: 'up', shift: false })
    expect(next.tenths).toBe(51)
  })

  it('f 段 ↓: -0.1s', () => {
    const next = apply(initialState(50, 'f'), { type: 'arrow', dir: 'down', shift: false })
    expect(next.tenths).toBe(49)
  })

  it('Shift 加速: mm ±10 分钟', () => {
    const up = apply(initialState(0, 'mm'), { type: 'arrow', dir: 'up', shift: true })
    expect(up.tenths).toBe(6000)
    const down = apply(initialState(7000, 'mm'), { type: 'arrow', dir: 'down', shift: true })
    expect(down.tenths).toBe(1000)
  })

  it('Shift 加速: ss ±10 秒', () => {
    const next = apply(initialState(0, 'ss'), { type: 'arrow', dir: 'up', shift: true })
    expect(next.tenths).toBe(100)
  })

  it('Shift 加速: f ±0.5 秒', () => {
    const up = apply(initialState(0, 'f'), { type: 'arrow', dir: 'up', shift: true })
    expect(up.tenths).toBe(5)
    const down = apply(initialState(10, 'f'), { type: 'arrow', dir: 'down', shift: true })
    expect(down.tenths).toBe(5)
  })

  it('进位: 00:59.0 按 ss ↑ → 01:00.0', () => {
    const next = apply(initialState(590, 'ss'), { type: 'arrow', dir: 'up', shift: false })
    expect(next.tenths).toBe(600)
  })

  it('借位: 01:00.0 按 ss ↓ → 00:59.0', () => {
    const next = apply(initialState(600, 'ss'), { type: 'arrow', dir: 'down', shift: false })
    expect(next.tenths).toBe(590)
  })

  it('负数区 ss ↓ 时间更早: -00:30.0 → -00:31.0', () => {
    const next = apply(initialState(-300, 'ss'), { type: 'arrow', dir: 'down', shift: false })
    expect(next.tenths).toBe(-310)
  })

  it('越过零点: 00:00.5 按 ss ↓ → -00:00.5', () => {
    const next = apply(initialState(5, 'ss'), { type: 'arrow', dir: 'down', shift: false })
    expect(next.tenths).toBe(-5)
  })

  it('min 静默截断: 已到 min 再 ↓ 不变', () => {
    const state = initialState(-300, 'ss')
    const next = reduceTimeInput(
      state,
      { type: 'arrow', dir: 'down', shift: false },
      tightMinConfig
    )
    expect(next.tenths).toBe(-300)
  })

  it('max 静默截断', () => {
    const next = apply(initialState(config.max, 'f'), { type: 'arrow', dir: 'up', shift: false })
    expect(next.tenths).toBe(config.max)
  })
})

describe('reduceTimeInput — 数字键覆盖堆叠', () => {
  it('mm 段首次按 5: pending="5", 显示端会呈 "05"', () => {
    const next = apply(initialState(0, 'mm'), { type: 'digit', digit: '5' })
    expect(next.pending).toBe('5')
    expect(next.segment).toBe('mm') // 未满位不跳段
  })

  it('mm 段 "5" 后按 3: pending="53", 满位自动跳到 ss', () => {
    const next = apply(
      initialState(0, 'mm'),
      { type: 'digit', digit: '5' },
      { type: 'digit', digit: '3' }
    )
    expect(next.segment).toBe('ss')
    expect(next.pending).toBe('')
    // tenths = 53 * 600 = 31800
    expect(next.tenths).toBe(31800)
  })

  it('ss 段输入 "6": 下一位必超 59，立即 commit 并跳段', () => {
    const next = apply(initialState(0, 'ss'), { type: 'digit', digit: '6' })
    expect(next.segment).toBe('f')
    expect(next.pending).toBe('')
    expect(next.tenths).toBe(60) // ss=6
  })

  it('ss 段输入 "5": 等第二位', () => {
    const next = apply(initialState(0, 'ss'), { type: 'digit', digit: '5' })
    expect(next.segment).toBe('ss')
    expect(next.pending).toBe('5')
  })

  it('ss 段 "5" 后 "3": 53 秒，跳 f', () => {
    const next = apply(
      initialState(0, 'ss'),
      { type: 'digit', digit: '5' },
      { type: 'digit', digit: '3' }
    )
    expect(next.segment).toBe('f')
    expect(next.tenths).toBe(530)
  })

  it('f 段输入 "7": 立即 commit，停留在 f 段（已是最后一段）', () => {
    const next = apply(initialState(0, 'f'), { type: 'digit', digit: '7' })
    expect(next.segment).toBe('f')
    expect(next.pending).toBe('')
    expect(next.tenths).toBe(7)
  })

  it('负数保持: -01:23.4 mm 段输入 "05" 变 -00:23.4 → 实际是 -5:23.4（符号不变）', () => {
    // -01:23.4 = -834
    const next = apply(
      initialState(-834, 'mm'),
      { type: 'digit', digit: '0' },
      { type: 'digit', digit: '5' }
    )
    // mm=05, ss=23, f=4; 符号保留
    expect(next.tenths).toBe(-(5 * 600 + 234))
  })
})

describe('reduceTimeInput — 符号 toggle', () => {
  it('mm 段 negate: 正 → 负', () => {
    const next = apply(initialState(300, 'mm'), { type: 'negate' })
    expect(next.tenths).toBe(-300)
    expect(next.segment).toBe('mm')
  })

  it('mm 段 negate: 负 → 正', () => {
    const next = apply(initialState(-300, 'mm'), { type: 'negate' })
    expect(next.tenths).toBe(300)
  })

  it('零值 negate 保持零', () => {
    const next = apply(initialState(0, 'mm'), { type: 'negate' })
    expect(next.tenths).toBe(0)
  })

  it('toggle 后若超出 min（如 min=0）则 clamp', () => {
    const state = initialState(300, 'mm')
    const result = reduceTimeInput(state, { type: 'negate' }, { min: 0, max: 99999 })
    expect(result.tenths).toBe(0)
  })
})

describe('reduceTimeInput — 段间移动', () => {
  it('→: mm → ss', () => {
    const next = apply(initialState(0, 'mm'), { type: 'moveSegment', dir: 'right' })
    expect(next.segment).toBe('ss')
  })

  it('→: ss → f', () => {
    const next = apply(initialState(0, 'ss'), { type: 'moveSegment', dir: 'right' })
    expect(next.segment).toBe('f')
  })

  it('→ 在 f 段停留', () => {
    const next = apply(initialState(0, 'f'), { type: 'moveSegment', dir: 'right' })
    expect(next.segment).toBe('f')
  })

  it('←: f → ss', () => {
    const next = apply(initialState(0, 'f'), { type: 'moveSegment', dir: 'left' })
    expect(next.segment).toBe('ss')
  })

  it('←: ss → mm', () => {
    const next = apply(initialState(0, 'ss'), { type: 'moveSegment', dir: 'left' })
    expect(next.segment).toBe('mm')
  })

  it('← 在 mm 段停留', () => {
    const next = apply(initialState(0, 'mm'), { type: 'moveSegment', dir: 'left' })
    expect(next.segment).toBe('mm')
  })

  it('切段时 commit 未完成的 pending: mm 段输入"5" 后 →', () => {
    const next = apply(
      initialState(0, 'mm'),
      { type: 'digit', digit: '5' },
      { type: 'moveSegment', dir: 'right' }
    )
    expect(next.segment).toBe('ss')
    expect(next.pending).toBe('')
    expect(next.tenths).toBe(5 * 600) // mm=5
  })
})

describe('reduceTimeInput — Backspace', () => {
  it('mm 段 Backspace 清空 mm 为 0，保留 ss/f，保持 focus', () => {
    // 01:23.4
    const next = apply(initialState(834, 'mm'), { type: 'backspace' })
    expect(next.tenths).toBe(234) // mm=0, ss=23, f=4
    expect(next.segment).toBe('mm')
    expect(next.pending).toBe('')
  })

  it('ss 段 Backspace 清空 ss', () => {
    const next = apply(initialState(834, 'ss'), { type: 'backspace' })
    expect(next.tenths).toBe(604) // mm=1, ss=0, f=4
  })

  it('f 段 Backspace 清空 f', () => {
    const next = apply(initialState(834, 'f'), { type: 'backspace' })
    expect(next.tenths).toBe(830) // mm=1, ss=23, f=0
  })

  it('Backspace 清除 pending 但不改变 tenths（若 pending 存在）', () => {
    const next = apply(initialState(0, 'mm'), { type: 'digit', digit: '5' }, { type: 'backspace' })
    expect(next.pending).toBe('')
    expect(next.tenths).toBe(0)
  })
})

describe('reduceTimeInput — paste', () => {
  it('粘贴 "01:23.4" 覆盖整个值', () => {
    const next = apply(initialState(0, 'mm'), { type: 'paste', text: '01:23.4' })
    expect(next.tenths).toBe(834)
    expect(next.pending).toBe('')
  })

  it('粘贴非法内容保持原状', () => {
    const next = apply(initialState(500, 'ss'), { type: 'paste', text: 'garbage' })
    expect(next.tenths).toBe(500)
  })

  it('粘贴超界: clamp 到 max', () => {
    const next = apply(initialState(0, 'mm'), { type: 'paste', text: '999:59.9' })
    expect(next.tenths).toBe(config.max)
  })
})

describe('reduceTimeInput — commit (blur)', () => {
  it('blur 时 pending 非空会 commit', () => {
    const next = apply(initialState(0, 'mm'), { type: 'digit', digit: '7' }, { type: 'commit' })
    expect(next.pending).toBe('')
    expect(next.tenths).toBe(7 * 600)
  })
})

describe('reduceTimeInput — focusSegment 切段 commit 行为', () => {
  it('focusSegment 切走时 commit pending', () => {
    const next = apply(
      initialState(0, 'mm'),
      { type: 'digit', digit: '7' },
      { type: 'focusSegment', segment: 'f' }
    )
    expect(next.segment).toBe('f')
    expect(next.pending).toBe('')
    expect(next.tenths).toBe(7 * 600)
  })
})
