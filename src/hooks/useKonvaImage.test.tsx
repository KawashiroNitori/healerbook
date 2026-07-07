// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUIStore } from '@/store/uiStore'
import { useKonvaImage } from './useKonvaImage'

// 可控 Image：记录 src 赋值，手动触发 onload/onerror
class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private _src = ''
  static instances: FakeImage[] = []
  constructor() {
    FakeImage.instances.push(this)
  }
  set src(v: string) {
    this._src = v
  }
  get src() {
    return this._src
  }
}

beforeEach(() => {
  FakeImage.instances = []
  useUIStore.setState({ iconLearned: 'cafemaker' })
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image)
})
afterEach(() => vi.unstubAllGlobals())

describe('useKonvaImage 回退', () => {
  it('首源 error 后换到下一源；下一源 load 成功写回 learned', () => {
    const { result } = renderHook(() => useKonvaImage('/i/003000/003253.png'))
    const img = FakeImage.instances[0]
    expect(img.src).toBe('https://cafemaker.wakingsands.com/i/003000/003253.png')

    act(() => img.onerror?.())
    expect(img.src).toBe(
      'https://v2.xivapi.com/api/asset?path=ui/icon/003000/003253.tex&format=png'
    )

    act(() => img.onload?.())
    expect(result.current).toBe(img as unknown as HTMLImageElement)
    expect(useUIStore.getState().iconLearned).toBe('xivapi-asset')
  })

  it('全部源 error → image 为 null', () => {
    const { result } = renderHook(() => useKonvaImage('/i/003000/003253.png'))
    const img = FakeImage.instances[0]
    act(() => img.onerror?.()) // → xivapi-asset
    act(() => img.onerror?.()) // → rpglogs
    act(() => img.onerror?.()) // 全试尽
    expect(result.current).toBeNull()
  })
})
