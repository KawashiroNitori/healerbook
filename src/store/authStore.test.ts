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
    const { accessToken, refreshToken, username } = useAuthStore.getState()
    expect(accessToken).toBeNull()
    expect(refreshToken).toBeNull()
    expect(username).toBeNull()
  })

  it('setTokens 存储 token 和用户名', () => {
    useAuthStore.getState().setTokens('access-jwt', 'refresh-jwt', 'TestUser')
    const { accessToken, refreshToken, username } = useAuthStore.getState()
    expect(accessToken).toBe('access-jwt')
    expect(refreshToken).toBe('refresh-jwt')
    expect(username).toBe('TestUser')
  })

  it('clearTokens 清除所有状态', () => {
    useAuthStore.getState().setTokens('access-jwt', 'refresh-jwt', 'TestUser')
    useAuthStore.getState().clearTokens()
    const { accessToken, refreshToken, username } = useAuthStore.getState()
    expect(accessToken).toBeNull()
    expect(refreshToken).toBeNull()
    expect(username).toBeNull()
  })
})
