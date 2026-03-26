import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { decodeJwt } from 'jose'

// 提前多少秒视为"即将过期"，触发主动续期
const EXPIRY_BUFFER_SECONDS = 30

// 并发续期保护
let isRefreshing = false
let refreshPromise: Promise<string | null> | null = null

function isTokenExpired(token: string): boolean {
  try {
    const { exp } = decodeJwt(token)
    if (exp === undefined) return true
    return Date.now() / 1000 >= exp - EXPIRY_BUFFER_SECONDS
  } catch {
    return true
  }
}

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  username: string | null
  userId: string | null
  setTokens: (accessToken: string, refreshToken: string, username: string, userId: string) => void
  clearTokens: () => void
  /** 返回当前有效的 accessToken，必要时自动续期。无 token 或续期失败返回 null。 */
  getValidToken: () => Promise<string | null>
}

// Security note: tokens are stored in localStorage per design decision.
// This accepts XSS risk in exchange for simplicity (no HttpOnly cookie backend needed).
// See docs/superpowers/specs/2026-03-23-fflogs-oauth-design.md
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      username: null,
      userId: null,

      setTokens: (accessToken, refreshToken, username, userId) =>
        set({ accessToken, refreshToken, username, userId }),

      clearTokens: () =>
        set({ accessToken: null, refreshToken: null, username: null, userId: null }),

      getValidToken: async () => {
        const { accessToken, refreshToken, setTokens, clearTokens, username, userId } = get()

        if (!accessToken) return null

        // token 仍有效，直接返回
        if (!isTokenExpired(accessToken)) return accessToken

        // token 已过期或即将过期，触发续期（并发保护）
        if (!isRefreshing) {
          isRefreshing = true
          refreshPromise = (async () => {
            if (!refreshToken) return null
            try {
              const response = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: refreshToken }),
              })
              if (!response.ok) {
                clearTokens()
                return null
              }
              const data = (await response.json()) as { access_token: string }
              setTokens(data.access_token, refreshToken, username ?? '', userId ?? '')
              return data.access_token
            } catch {
              clearTokens()
              return null
            }
          })().finally(() => {
            isRefreshing = false
            refreshPromise = null
          })
        }

        return refreshPromise!
      },
    }),
    {
      name: 'healerbook-auth',
      storage: createJSONStorage(() => localStorage),
      // getValidToken 是函数，不持久化
      partialize: state => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        username: state.username,
        userId: state.userId,
      }),
    }
  )
)
