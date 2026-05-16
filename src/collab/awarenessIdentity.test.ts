import { describe, it, expect } from 'vitest'
import { COLOR_PALETTE, colorForUser, displayName } from './awarenessIdentity'

describe('awarenessIdentity', () => {
  it('palette has enough distinct colors and excludes self-selection blue/green', () => {
    expect(COLOR_PALETTE.length).toBeGreaterThanOrEqual(12)
    expect(new Set(COLOR_PALETTE).size).toBe(COLOR_PALETTE.length)
    // 自身选中态用 #3b82f6(蓝)/ #10b981(绿),peer 调色板须避开
    expect(COLOR_PALETTE).not.toContain('#3b82f6')
    expect(COLOR_PALETTE).not.toContain('#10b981')
  })

  it('colorForUser is deterministic and within the palette', () => {
    const c = colorForUser('user-abc')
    expect(COLOR_PALETTE).toContain(c)
    expect(colorForUser('user-abc')).toBe(c)
  })

  it('colorForUser spreads different ids across the palette', () => {
    const colors = new Set(Array.from({ length: 40 }, (_, i) => colorForUser(`u${i}`)))
    expect(colors.size).toBeGreaterThan(5)
  })

  it('displayName uses username when present', () => {
    expect(displayName('Aldgoat', 'uid-1')).toBe('Aldgoat')
  })

  it('displayName falls back to 用户 + last 4 of userId when username empty', () => {
    expect(displayName('', 'abcdef123456')).toBe('用户3456')
    expect(displayName(null, 'abcdef123456')).toBe('用户3456')
  })
})
