import { describe, it, expect, beforeEach } from 'vitest'
import { nextShortId, resetIdCounter } from './shortId'

describe('shortId', () => {
  beforeEach(() => {
    resetIdCounter()
  })

  it('nextShortId 连续调用返回递增唯一 id', () => {
    const ids = [nextShortId(), nextShortId(), nextShortId()]
    expect(ids).toEqual(['e0', 'e1', 'e2'])
    expect(new Set(ids).size).toBe(3)
  })

  it('resetIdCounter 将计数器清零', () => {
    nextShortId()
    nextShortId()
    resetIdCounter()
    expect(nextShortId()).toBe('e0')
  })
})
