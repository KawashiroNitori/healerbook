/**
 * API 链：直连 + 顺序回退 + 失败驱动自学习。
 * 源已实测返回 access-control-allow-origin: *，无需代理。
 */
import { API_PROVIDERS, type ApiProviderId } from './registry'
import { useUIStore } from '@/store/uiStore'

const TIMEOUT_MS = 6000

export interface ApiResult<T> {
  data: T
  provider: ApiProviderId
}

export async function requestWithFallback<T>(
  path: string,
  preferred: ApiProviderId = useUIStore.getState().apiLearned
): Promise<ApiResult<T>> {
  const ordered = [
    ...API_PROVIDERS.filter(p => p.id === preferred),
    ...API_PROVIDERS.filter(p => p.id !== preferred),
  ]
  for (const p of ordered) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(p.base + path, { signal: controller.signal, cache: 'force-cache' })
      if (!res.ok) continue
      const data = (await res.json()) as T
      return { data, provider: p.id }
    } catch {
      // 超时 / 网络错误 → 试下一源
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`All API providers failed for ${path}`)
}

export function onApiSuccess(provider: ApiProviderId): void {
  const store = useUIStore.getState()
  if (store.apiLearned !== provider) store.setApiLearned(provider)
}
