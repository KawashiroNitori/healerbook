import { describe, it, expect } from 'vitest'
import { mulberry32 } from './prng'

describe('mulberry32', () => {
  it('同 seed 同序列（可复现）', () => {
    const a = mulberry32(42),
      b = mulberry32(42)
    const seqA = [a(), a(), a()],
      seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })
  it('输出落在 [0,1)', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 100; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
