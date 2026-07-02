import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './uiStore'

describe('uiStore - canvasTool', () => {
  beforeEach(() => useUIStore.setState({ canvasTool: 'pan' }))

  it('默认是 pan', () => {
    expect(useUIStore.getState().canvasTool).toBe('pan')
  })

  it('setCanvasTool 切换到 select', () => {
    useUIStore.getState().setCanvasTool('select')
    expect(useUIStore.getState().canvasTool).toBe('select')
  })
})

describe('uiStore learned 字段', () => {
  beforeEach(() => {
    useUIStore.setState({ iconLearned: 'cafemaker', apiLearned: 'xivcdn' })
  })

  it('默认 learned 源', () => {
    expect(useUIStore.getState().iconLearned).toBe('cafemaker')
    expect(useUIStore.getState().apiLearned).toBe('xivcdn')
  })
  it('setIconLearned 更新', () => {
    useUIStore.getState().setIconLearned('rpglogs')
    expect(useUIStore.getState().iconLearned).toBe('rpglogs')
  })
  it('setApiLearned 更新', () => {
    useUIStore.getState().setApiLearned('xivapi')
    expect(useUIStore.getState().apiLearned).toBe('xivapi')
  })
})
