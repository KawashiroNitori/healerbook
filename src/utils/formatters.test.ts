import { describe, it, expect } from 'vitest'
import { formatTimeWithDecimal, formatDamageValue, splitDeciseconds } from './formatters'

describe('formatTimeWithDecimal', () => {
  it('常规格式 mm:ss.f，秒数补零到两位整数', () => {
    expect(formatTimeWithDecimal(0)).toBe('0:00.0')
    expect(formatTimeWithDecimal(5.5)).toBe('0:05.5')
    expect(formatTimeWithDecimal(70.1)).toBe('1:10.1')
    expect(formatTimeWithDecimal(125.4)).toBe('2:05.4')
  })

  it('负数带负号', () => {
    expect(formatTimeWithDecimal(-5.5)).toBe('-0:05.5')
  })

  // #6 回归：补零判断与 toFixed 进位在边界不一致，导致出现 "010"
  it('秒数进位边界 [9.95, 10) 不再出现 010', () => {
    expect(formatTimeWithDecimal(9.97)).toBe('0:10.0')
    expect(formatTimeWithDecimal(9.95)).toBe('0:10.0')
    expect(formatTimeWithDecimal(9.94)).toBe('0:09.9')
  })

  // 分钟进位边界 [59.95, 60) 不再出现 "0:60.0"
  it('分钟进位边界正确滚动', () => {
    expect(formatTimeWithDecimal(59.97)).toBe('1:00.0')
    expect(formatTimeWithDecimal(59.94)).toBe('0:59.9')
    expect(formatTimeWithDecimal(119.97)).toBe('2:00.0')
  })
})

describe('splitDeciseconds', () => {
  it('整体四舍五入后拆分，避免进位撕裂', () => {
    expect(splitDeciseconds(9.97)).toEqual({ minutes: 0, seconds: 10, tenths: 0 })
    expect(splitDeciseconds(59.97)).toEqual({ minutes: 1, seconds: 0, tenths: 0 })
    expect(splitDeciseconds(59.94)).toEqual({ minutes: 0, seconds: 59, tenths: 9 })
    expect(splitDeciseconds(125.45)).toEqual({ minutes: 2, seconds: 5, tenths: 5 })
    expect(splitDeciseconds(0)).toEqual({ minutes: 0, seconds: 0, tenths: 0 })
  })
})

describe('formatDamageValue', () => {
  it('≥10000 缩略为 x.xw，否则千分位', () => {
    expect(formatDamageValue(9999)).toBe((9999).toLocaleString())
    expect(formatDamageValue(12345)).toBe('1.2w')
    expect(formatDamageValue(10000)).toBe('1.0w')
  })
})
