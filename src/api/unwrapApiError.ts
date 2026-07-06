import { HTTPError } from 'ky'

interface UnwrapOptions<T> {
  /** 状态码 → 返回替代值（不抛错），如 401 时返回空列表 */
  onStatus?: Record<number, () => T>
  /** 定制 HTTPError 转出的 message；默认沿用 err.message（apiClient beforeError 已解析为可读文案） */
  mapMessage?: (err: HTTPError) => string
  /** true 时把未被 onStatus 消化的 HTTPError 原样 rethrow，而不是转 new Error */
  rethrowOriginal?: boolean
}

/**
 * 统一处理 ky 请求错误：非 HTTPError（网络/超时）一律原样 rethrow；
 * HTTPError 按 onStatus → rethrowOriginal → mapMessage/err.message 的顺序处理。
 * 抛出普通 Error 是刻意为之：调用方（组件/toast）只消费 message，不需要 response 细节。
 */
export async function unwrapApiError<T>(
  fn: () => Promise<T>,
  options?: UnwrapOptions<T>
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (!(err instanceof HTTPError)) throw err
    const handler = options?.onStatus?.[err.response.status]
    if (handler) return handler()
    if (options?.rethrowOriginal) throw err
    throw new Error(options?.mapMessage ? options.mapMessage(err) : err.message)
  }
}
