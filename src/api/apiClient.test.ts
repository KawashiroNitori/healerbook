import { describe, it, expect, vi } from 'vitest'

vi.mock('@/store/uiStore', () => ({
  useUIStore: { getState: () => ({ locale: 'en' }) },
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: { getState: () => ({ getValidToken: async () => null }) },
}))

import { attachAcceptLanguage } from './apiClient'

describe('attachAcceptLanguage', () => {
  it('sets Accept-Language to the current store locale', () => {
    const request = new Request('https://example.com')
    attachAcceptLanguage(request, {} as never)
    expect(request.headers.get('Accept-Language')).toBe('en')
  })
})
