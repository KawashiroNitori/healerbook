import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAuthStore } from './authStore'

// Silence Zustand persist middleware warnings about localStorage being unavailable in Node test env
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.getState().clearTokens()
  })

  it('初始状态为未登录', () => {
    const { accessToken, refreshToken, username, userId } = useAuthStore.getState()
    expect(accessToken).toBeNull()
    expect(refreshToken).toBeNull()
    expect(username).toBeNull()
    expect(userId).toBeNull()
  })

  it('setTokens 存储 token、用户名和 userId', () => {
    useAuthStore.getState().setTokens('access-jwt', 'refresh-jwt', 'TestUser', 'user-123')
    const { accessToken, refreshToken, username, userId } = useAuthStore.getState()
    expect(accessToken).toBe('access-jwt')
    expect(refreshToken).toBe('refresh-jwt')
    expect(username).toBe('TestUser')
    expect(userId).toBe('user-123')
  })

  it('clearTokens 清除所有状态（含 userId）', () => {
    useAuthStore.getState().setTokens('access-jwt', 'refresh-jwt', 'TestUser', 'user-123')
    useAuthStore.getState().clearTokens()
    const { accessToken, refreshToken, username, userId } = useAuthStore.getState()
    expect(accessToken).toBeNull()
    expect(refreshToken).toBeNull()
    expect(username).toBeNull()
    expect(userId).toBeNull()
  })
})
