/**
 * 自家站点来源域名白名单。CORS 与 OAuth 回调（redirect_uri 推导）共用。
 *
 * 基础域，匹配 apex 及其任意子域；只接受 https 来源。
 */
export const ALLOWED_BASE_DOMAINS = ['xivhealer.cn', 'xivhealer.com']

/**
 * 校验 origin 是否属于自家站点。
 *
 * 要求 https，且 hostname 命中白名单（apex 或子域，大小写不敏感）。
 */
export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return ALLOWED_BASE_DOMAINS.some(base => host === base || host.endsWith(`.${base}`))
}
