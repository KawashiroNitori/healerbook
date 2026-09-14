import { describe, it, expect } from 'vitest'
import { retrySecondsLeft } from './connectionRetry'

describe('retrySecondsLeft', () => {
  it('向上取整剩余秒数', () => {
    expect(retrySecondsLeft(10_000, 5_500)).toBe(5)
    expect(retrySecondsLeft(10_000, 9_001)).toBe(1)
  })

  it('已到点但尚未切换状态时至少为 1', () => {
    expect(retrySecondsLeft(10_000, 10_000)).toBe(1)
    expect(retrySecondsLeft(10_000, 12_000)).toBe(1)
  })
})
