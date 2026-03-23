import { createContext, useContext, type ReactNode } from 'react'
import { useAuthStore } from '@/store/authStore'
import { toast } from 'sonner'
import { nanoid } from 'nanoid'

const FFLOGS_OAUTH_CLIENT_ID = import.meta.env.VITE_FFLOGS_OAUTH_CLIENT_ID as string
const FFLOGS_AUTH_URL = 'https://www.fflogs.com/oauth/authorize'
const REDIRECT_URI = `${window.location.origin}/callback`

interface AuthContextValue {
  username: string | null
  isLoggedIn: boolean
  login: () => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { username, accessToken, clearTokens } = useAuthStore()

  function login() {
    const state = nanoid()
    sessionStorage.setItem('oauth_state', state)

    const params = new URLSearchParams({
      client_id: FFLOGS_OAUTH_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'view:user-profile',
      state,
    })

    window.location.href = `${FFLOGS_AUTH_URL}?${params.toString()}`
  }

  function logout() {
    clearTokens()
    toast.success('已退出登录')
  }

  const value: AuthContextValue = {
    username,
    isLoggedIn: !!accessToken,
    login,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
