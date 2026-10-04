// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { useChangelogToast } from './useChangelogToast'

const mocks = vi.hoisted(() => ({ toast: vi.fn(), dismiss: vi.fn(), track: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(mocks.toast, { dismiss: mocks.dismiss }) }))
vi.mock('@/utils/analytics', () => ({ track: mocks.track }))

const release = { id: 'new-release', date: '2026-10-05', html: '<p>等级功能更新</p>' }
const fetchMock = vi.fn()
const key = 'last_seen_release_id'

function toastOptions() {
  return mocks.toast.mock.calls[0][1] as {
    description: ReactNode
    onDismiss: () => void
    duration: number
    closeButton: boolean
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => release })
  vi.stubGlobal('fetch', fetchMock)
  mocks.toast.mockReturnValue('toast-id')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useChangelogToast', () => {
  it('首次访问静默记录版本，重复访问不提示', async () => {
    const first = renderHook(() => useChangelogToast())
    await waitFor(() => expect(localStorage.getItem(key)).toBe(release.id))
    first.unmount()
    renderHook(() => useChangelogToast())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/latest-release.json', { cache: 'no-store' })
  })

  it('新版本在 StrictMode 下只提示一次，关闭后不再提示', async () => {
    localStorage.setItem(key, 'old-release')
    const first = renderHook(() => useChangelogToast(), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    })
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(localStorage.getItem(key)).toBe('old-release')
    expect(toastOptions()).toMatchObject({ duration: Infinity, closeButton: true })
    toastOptions().onDismiss()
    expect(localStorage.getItem(key)).toBe(release.id)
    first.unmount()
    renderHook(() => useChangelogToast())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(mocks.toast).toHaveBeenCalledOnce()
  })

  it.each([undefined, '/docs/howto/timeline-level'])(
    '详情跳转使用对应文档地址：%s',
    async viewUrl => {
      localStorage.setItem(key, 'old-release')
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...release, viewUrl }) })
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      renderHook(() => useChangelogToast())
      await waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce())
      render(<>{toastOptions().description}</>)
      expect(screen.getByText('等级功能更新')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
      expect(open).toHaveBeenCalledWith(viewUrl ?? '/docs/changelog', '_blank')
      expect(localStorage.getItem(key)).toBe(release.id)
      expect(mocks.dismiss).toHaveBeenCalledWith('toast-id')
    }
  )

  it.each(['network', 'http', 'empty'])(
    '请求失败或内容为空时不提示、不覆盖已读版本：%s',
    async reason => {
      localStorage.setItem(key, 'old-release')
      if (reason === 'network') fetchMock.mockRejectedValue(new Error('offline'))
      else if (reason === 'http') fetchMock.mockResolvedValue({ ok: false })
      else fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...release, html: '' }) })
      await act(async () => {
        renderHook(() => useChangelogToast())
      })
      expect(mocks.toast).not.toHaveBeenCalled()
      expect(localStorage.getItem(key)).toBe('old-release')
    }
  )
})
