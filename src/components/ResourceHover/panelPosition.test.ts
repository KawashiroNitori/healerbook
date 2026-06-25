import { describe, it, expect } from 'vitest'
import { clampPanelPosition } from './panelPosition'

const size = { width: 200, height: 100 }
const vp = { width: 1000, height: 800 }

describe('clampPanelPosition', () => {
  it('默认偏移光标右下 +16/+16', () => {
    expect(clampPanelPosition({ x: 100, y: 100 }, size, vp)).toEqual({ left: 116, top: 116 })
  })
  it('近右边界翻转到光标左侧', () => {
    expect(clampPanelPosition({ x: 950, y: 100 }, size, vp).left).toBe(950 - 16 - 200)
  })
  it('近下边界翻转到光标上方', () => {
    expect(clampPanelPosition({ x: 100, y: 760 }, size, vp).top).toBe(760 - 16 - 100)
  })
  it('翻转后仍不越上/左边界（clamp 到 0）', () => {
    expect(clampPanelPosition({ x: 5, y: 5 }, { width: 200, height: 100 }, vp)).toEqual({
      left: 21,
      top: 21,
    })
    expect(clampPanelPosition({ x: 10, y: 10 }, { width: 2000, height: 2000 }, vp)).toEqual({
      left: 0,
      top: 0,
    })
  })
})
