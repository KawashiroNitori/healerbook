import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/authStore'
import { track } from '@/utils/analytics'
import { parseApiError } from '@/api/parseApiError'

const AUTH_CALLBACK_URL = '/api/auth/callback'

export default function CallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useTranslation(['common'])
  const setTokens = useAuthStore(s => s.setTokens)
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    handledRef.current = true

    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const savedState = sessionStorage.getItem('oauth_state')

    // 验证 state 防 CSRF
    if (!state || state !== savedState) {
      toast.error(t('callback.stateMismatch'))
      navigate('/', { replace: true })
      return
    }

    sessionStorage.removeItem('oauth_state')

    let returnTo = '/'
    try {
      const padded =
        state.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((state.length + 3) % 4)
      const parsed = JSON.parse(atob(padded)) as { returnTo?: string }
      if (parsed.returnTo?.startsWith('/')) {
        returnTo = parsed.returnTo
      }
    } catch {
      // state 解析失败，回退到首页
    }

    if (!code) {
      toast.error(t('callback.missingCode'))
      navigate(returnTo, { replace: true })
      return
    }

    fetch(AUTH_CALLBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then(async res => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as unknown
          throw new Error(parseApiError(body, res.status))
        }
        return res.json() as Promise<{
          access_token: string
          refresh_token: string
          name: string
          user_id: string
        }>
      })
      .then(({ access_token, refresh_token, name, user_id }) => {
        setTokens(access_token, refresh_token, name, user_id)
        track('login-success')
        navigate(returnTo, { replace: true })
      })
      .catch((err: unknown) => {
        toast.error(
          t('callback.loginFailed', {
            message: err instanceof Error ? err.message : t('unknownError'),
          })
        )
        navigate(returnTo, { replace: true })
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">{t('callback.completing')}</p>
    </div>
  )
}
