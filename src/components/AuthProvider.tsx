import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/store/authStore'
import { toast } from 'sonner'
import { nanoid } from 'nanoid'
import { AuthContext, type AuthContextValue } from '@/contexts/AuthContext'
import { track } from '@/utils/analytics'

const FFLOGS_OAUTH_CLIENT_ID = import.meta.env.VITE_FFLOGS_CLIENT_ID as string
const FFLOGS_AUTH_URL = 'https://www.fflogs.com/oauth/authorize'

export function AuthProvider({ children }: { children: ReactNode }) {
  const { username, accessToken, clearTokens } = useAuthStore()
  const { t } = useTranslation(['common'])

  function login() {
    if (!FFLOGS_OAUTH_CLIENT_ID) {
      toast.error(t('auth.clientIdMissing'))
      return
    }
    const redirectUri = `${window.location.origin}/callback`
    const returnTo = window.location.pathname + window.location.search
    const state = btoa(JSON.stringify({ nonce: nanoid(), returnTo }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
    sessionStorage.setItem('oauth_state', state)

    const params = new URLSearchParams({
      client_id: FFLOGS_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    })

    track('login-start')
    window.location.href = `${FFLOGS_AUTH_URL}?${params.toString()}`
  }

  function logout() {
    clearTokens()
    toast.success(t('auth.loggedOut'))
  }

  const value: AuthContextValue = {
    username,
    isLoggedIn: !!accessToken,
    login,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
