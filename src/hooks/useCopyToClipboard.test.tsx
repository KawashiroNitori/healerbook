// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCopyToClipboard } from './useCopyToClipboard'

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })
  afterEach(() => vi.useRealTimers())

  it('复制成功置 copied，resetDelayMs 后回弹', async () => {
    const onCopied = vi.fn()
    const { result } = renderHook(() => useCopyToClipboard({ onCopied }))
    await act(() => result.current.copy('hello'))
    expect(result.current.copied).toBe(true)
    expect(onCopied).toHaveBeenCalledOnce()
    act(() => void vi.advanceTimersByTime(2000))
    expect(result.current.copied).toBe(false)
  })

  it('复制失败调用 onError 且 copied 保持 false', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    const onError = vi.fn()
    const { result } = renderHook(() => useCopyToClipboard({ onError }))
    await act(() => result.current.copy('x'))
    expect(result.current.copied).toBe(false)
    expect(onError).toHaveBeenCalledOnce()
  })
})
