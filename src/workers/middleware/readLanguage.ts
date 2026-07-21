import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'
import { normalizeLocale } from '@/types/i18n'

/**
 * 把请求的 Accept-Language 归一为 AppLanguage 写入 c.var.lang。
 * 前端 apiClient 会用站内 locale 覆盖该头；缺失时回退 DEFAULT_LOCALE。
 */
export const readLanguage: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('lang', normalizeLocale(c.req.header('Accept-Language')))
  await next()
}
