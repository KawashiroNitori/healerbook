/**
 * 统一 API 客户端（ky）
 *
 * beforeRequest hook：通过 authStore.getValidToken() 获取有效 token（含自动续期）并注入请求头。
 * afterResponse hook：兜底处理意外 401（如时钟偏差导致本地判断未过期但服务端已拒绝）。
 */

import ky, { type AfterResponseHook } from 'ky'
import { useAuthStore } from '@/store/authStore'

const handleUnauthorized: AfterResponseHook = async (request, _options, response) => {
  if (response.status !== 401) return response

  // 兜底：服务端拒绝时强制续期并重试
  const newToken = await useAuthStore.getState().getValidToken()
  if (!newToken) return response

  request.headers.set('Authorization', `Bearer ${newToken}`)
  return fetch(request)
}

export const apiClient = ky.create({
  prefixUrl: '/api',
  hooks: {
    beforeRequest: [
      async request => {
        const token = await useAuthStore.getState().getValidToken()
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`)
        }
      },
    ],
    afterResponse: [handleUnauthorized],
  },
})
