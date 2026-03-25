/**
 * 统一 API 客户端（ky）
 *
 * beforeRequest hook 自动从 authStore 读取 accessToken 并附加到请求头，
 * 无需在每个调用处手动传递 token。
 */

import ky from 'ky'
import { useAuthStore } from '@/store/authStore'

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
  },
})
