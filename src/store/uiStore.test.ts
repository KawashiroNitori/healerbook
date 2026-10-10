import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore, mergePersistedUIState } from './uiStore'

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
    useUIStore.setState({ iconLearned: 'xivcdn', apiLearned: 'xivcdn' })
  })

  it('默认 learned 源', () => {
    expect(useUIStore.getState().iconLearned).toBe('xivcdn')
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

describe('uiStore persist merge', () => {
  const merge = mergePersistedUIState

  it('已下线的 iconLearned（cafemaker）回退为默认源，其余字段照常恢复', () => {
    const merged = merge({ iconLearned: 'cafemaker', showGrid: false }, useUIStore.getState())
    expect(merged.iconLearned).toBe('xivcdn')
    expect(merged.showGrid).toBe(false)
  })

  it('有效的 iconLearned 保留', () => {
    const merged = merge({ iconLearned: 'rpglogs' }, useUIStore.getState())
    expect(merged.iconLearned).toBe('rpglogs')
  })
})
