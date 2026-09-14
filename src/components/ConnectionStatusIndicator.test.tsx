// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

interface MockState {
  sessionRole: 'local' | 'author' | 'editor' | 'viewer'
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'failed'
  nextRetryAt: number | null
  reconnectNow: () => void
}

let mockState: MockState
vi.mock('@/store/timelineStore', () => ({
  useTimelineStore: (sel: (s: MockState) => unknown) => sel(mockState),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { TooltipProvider } from '@/components/ui/tooltip'
import ConnectionStatusIndicator from './ConnectionStatusIndicator'

/** App 层挂有全局 TooltipProvider,测试里同样包一层 */
const renderIndicator = () =>
  render(
    <TooltipProvider>
      <ConnectionStatusIndicator />
    </TooltipProvider>
  )

describe('ConnectionStatusIndicator', () => {
  beforeEach(() => {
    mockState = {
      sessionRole: 'editor',
      connectionStatus: 'connected',
      nextRetryAt: null,
      reconnectNow: vi.fn(),
    }
  })

  it('连接正常时不渲染', () => {
    const { container } = renderIndicator()
    expect(container.innerHTML).toBe('')
  })

  it('本地时间轴不渲染', () => {
    mockState.sessionRole = 'local'
    mockState.connectionStatus = 'disconnected'
    const { container } = renderIndicator()
    expect(container.innerHTML).toBe('')
  })

  it('业务原因终态断开（disconnected）不渲染', () => {
    mockState.connectionStatus = 'disconnected'
    const { container } = renderIndicator()
    expect(container.innerHTML).toBe('')
  })

  it('viewer 不渲染', () => {
    mockState.sessionRole = 'viewer'
    mockState.connectionStatus = 'failed'
    mockState.nextRetryAt = Date.now() + 5000
    const { container } = renderIndicator()
    expect(container.innerHTML).toBe('')
  })

  it('连接中显示提示', () => {
    mockState.sessionRole = 'author'
    mockState.connectionStatus = 'connecting'
    renderIndicator()
    expect(screen.getByText('editor:connection.connecting')).toBeTruthy()
  })

  it('连接失败显示提示，点击立即重连', () => {
    mockState.connectionStatus = 'failed'
    mockState.nextRetryAt = Date.now() + 5000
    renderIndicator()
    fireEvent.click(screen.getByText('editor:connection.failed'))
    expect(mockState.reconnectNow).toHaveBeenCalledTimes(1)
  })
})
