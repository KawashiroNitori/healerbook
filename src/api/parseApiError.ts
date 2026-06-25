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

/** 稳定 errorCode → import 命名空间已有翻译键的映射（Worker 无 i18next 运行时，故用 code 接缝） */
const ERROR_CODE_I18N: Record<string, string> = {
  'fflogs.noFights': 'import:importFflogs.noFightsInReport',
  'fflogs.fightNotFound': 'import:importFflogs.fightNotFound',
  'fflogs.apiFailed': 'import:importFflogs.apiFailed',
}

type TFunc = (key: string, options?: Record<string, unknown>) => string

/**
 * 解析 API 错误：优先用 Worker 返回的稳定 `code` 映射到本地化文案，
 * 无 code（或 code 未登记）时回退 `parseApiError` 的后端 error 文本。
 */
export function resolveApiError(body: unknown, status: number, t: TFunc): string {
  if (typeof body === 'object' && body !== null) {
    const b = body as { code?: unknown; fightId?: unknown }
    if (typeof b.code === 'string') {
      const key = ERROR_CODE_I18N[b.code]
      if (key) {
        return t(key, typeof b.fightId === 'number' ? { fightId: b.fightId } : undefined)
      }
    }
  }
  return parseApiError(body, status)
}
