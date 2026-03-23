import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  username: string | null
  setTokens: (accessToken: string, refreshToken: string, username: string) => void
  clearTokens: () => void
}

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
    }
  )
)
