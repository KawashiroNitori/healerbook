/**
 * 把 API 错误响应统一格式化为可读字符串。
 *
 * 兼容两种 shape：
 *  - 手写 { error: string }（Worker 大部分 4xx/5xx）
 *  - @hono/valibot-validator 默认 { success: false, issues: [...] }（400 校验失败）
 */
export function parseApiError(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const b = body as { error?: unknown; issues?: unknown }
    if (typeof b.error === 'string') return b.error
    if (Array.isArray(b.issues) && b.issues.length > 0) {
      return (b.issues as Array<{ path?: Array<{ key: unknown }>; message?: string }>)
        .slice(0, 3)
        .map(i => {
          const p = i.path?.map(seg => String(seg.key)).join('.') ?? ''
          return p ? `${p}: ${i.message}` : (i.message ?? '校验失败')
        })
        .join('; ')
    }
  }
  return `HTTP ${status}`
}
