import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/authStore'

const AUTH_CALLBACK_URL = '/api/auth/callback'

export default function CallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setTokens } = useAuthStore()
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    handledRef.current = true

    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const savedState = sessionStorage.getItem('oauth_state')

    // 验证 state 防 CSRF
    if (!state || state !== savedState) {
      toast.error('授权失败：state 不匹配')
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
      toast.error('授权失败：缺少 code 参数')
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
          let message = `HTTP ${res.status}`
          try {
            const err = (await res.json()) as { error?: string }
            if (err.error) message = err.error
          } catch {
            // response was not JSON, use status code message
          }
          throw new Error(message)
        }
        return res.json() as Promise<{
          access_token: string
          refresh_token: string
          name: string
        }>
      })
      .then(({ access_token, refresh_token, name }) => {
        setTokens(access_token, refresh_token, name)
        navigate(returnTo, { replace: true })
      })
      .catch((err: unknown) => {
        toast.error(`登录失败：${err instanceof Error ? err.message : '未知错误'}`)
        navigate(returnTo, { replace: true })
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">正在完成登录...</p>
    </div>
  )
}
