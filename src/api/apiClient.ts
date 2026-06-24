/**
 * 统一 API 客户端（ky）
 *
 * beforeRequest hook：通过 authStore.getValidToken() 获取有效 token（含自动续期）并注入请求头。
 * afterResponse hook：兜底处理意外 401（如时钟偏差导致本地判断未过期但服务端已拒绝）。
 * beforeError hook：把后端错误响应预解析挂到 error.message 与 error.parsedBody，统一前端 catch 处理。
 */

import ky, {
  type AfterResponseHook,
  type BeforeErrorHook,
  type BeforeRequestHook,
  HTTPError,
} from 'ky'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { parseApiError } from './parseApiError'

export type ParsedHTTPError = HTTPError & { parsedBody?: unknown }

const handleUnauthorized: AfterResponseHook = async (request, _options, response) => {
  if (response.status !== 401) return response

  const newToken = await useAuthStore.getState().getValidToken()
  if (!newToken) return response

  request.headers.set('Authorization', `Bearer ${newToken}`)
  return fetch(request)
}

/** 用站内选定 locale 覆盖浏览器默认 Accept-Language，供后端按用户真实选择取数 */
export const attachAcceptLanguage: BeforeRequestHook = request => {
  request.headers.set('Accept-Language', useUIStore.getState().locale)
}

const attachParsedError: BeforeErrorHook = async error => {
  const body = await error.response
    .clone()
    .json()
    .catch(() => null)
  ;(error as ParsedHTTPError).parsedBody = body
  error.message = parseApiError(body, error.response.status)
  return error
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
      attachAcceptLanguage,
    ],
    afterResponse: [handleUnauthorized],
    beforeError: [attachParsedError],
  },
})
