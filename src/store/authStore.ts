import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  username: string | null
  setTokens: (accessToken: string, refreshToken: string, username: string) => void
  clearTokens: () => void
}

// Security note: tokens are stored in localStorage per design decision.
// This accepts XSS risk in exchange for simplicity (no HttpOnly cookie backend needed).
// See docs/superpowers/specs/2026-03-23-fflogs-oauth-design.md
export const useAuthStore = create<AuthState>()(
  persist(
    set => ({
      accessToken: null,
      refreshToken: null,
      username: null,
      setTokens: (accessToken, refreshToken, username) =>
        set({ accessToken, refreshToken, username }),
      clearTokens: () => set({ accessToken: null, refreshToken: null, username: null }),
    }),
    {
      name: 'healerbook-auth',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
