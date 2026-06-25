import { describe, it, expect, beforeEach } from 'vitest'
import { useResourceHoverStore } from './resourceHoverStore'

describe('resourceHoverStore', () => {
  beforeEach(() => useResourceHoverStore.getState().clearHover())

  it('初始为空', () => {
    expect(useResourceHoverStore.getState().time).toBeNull()
    expect(useResourceHoverStore.getState().cursor).toBeNull()
  })

  it('setHover 写入 time + cursor', () => {
    useResourceHoverStore.getState().setHover(42.5, { x: 100, y: 200 })
    expect(useResourceHoverStore.getState().time).toBe(42.5)
    expect(useResourceHoverStore.getState().cursor).toEqual({ x: 100, y: 200 })
  })

  it('clearHover 复位', () => {
    useResourceHoverStore.getState().setHover(1, { x: 1, y: 1 })
    useResourceHoverStore.getState().clearHover()
    expect(useResourceHoverStore.getState().time).toBeNull()
    expect(useResourceHoverStore.getState().cursor).toBeNull()
  })
})
