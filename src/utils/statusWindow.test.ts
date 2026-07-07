import { describe, it, expect } from 'vitest'
import { isStatusActiveAt } from './statusWindow'

const s = { startTime: 10, endTime: 20 }

describe('isStatusActiveAt', () => {
  it('closed：endTime 那一刻仍 active', () => {
    expect(isStatusActiveAt(s, 10, 'closed')).toBe(true)
    expect(isStatusActiveAt(s, 20, 'closed')).toBe(true)
    expect(isStatusActiveAt(s, 9.999, 'closed')).toBe(false)
    expect(isStatusActiveAt(s, 20.001, 'closed')).toBe(false)
  })
  it('excludeEnd：endTime 那一刻已失效', () => {
    expect(isStatusActiveAt(s, 10, 'excludeEnd')).toBe(true)
    expect(isStatusActiveAt(s, 20, 'excludeEnd')).toBe(false)
    expect(isStatusActiveAt(s, 19.999, 'excludeEnd')).toBe(true)
  })
})
