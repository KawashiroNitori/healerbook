/**
 * 统一 API 客户端（ky）
 *
 * beforeRequest hook 自动从 authStore 读取 accessToken 并附加到请求头，
 * 无需在每个调用处手动传递 token。
 *
 * afterResponse hook 检测 401 响应，自动使用 refreshToken 续期后重试请求。
 */

import ky, { type AfterResponseHook } from 'ky'
import { useAuthStore } from '@/store/authStore'

let isRefreshing = false
let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken, setTokens, clearTokens, username, userId } = useAuthStore.getState()
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
}

const handleUnauthorized: AfterResponseHook = async (request, _options, response) => {
  if (response.status !== 401) return response

  // 避免并发多个续期请求
  if (!isRefreshing) {
    isRefreshing = true
    refreshPromise = refreshAccessToken().finally(() => {
      isRefreshing = false
      refreshPromise = null
    })
  }

  const newToken = await refreshPromise
  if (!newToken) return response

  // 用新 token 重试原始请求
  request.headers.set('Authorization', `Bearer ${newToken}`)
  return fetch(request)
}

export const apiClient = ky.create({
  prefixUrl: '/api',
  hooks: {
    beforeRequest: [
      request => {
        const token = useAuthStore.getState().accessToken
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`)
        }
      },
    ],
    afterResponse: [handleUnauthorized],
  },
})
