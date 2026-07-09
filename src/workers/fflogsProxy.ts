/**
 * FFLogs 请求代理改写
 *
 * 把 https://<sub>.fflogs.com/<path> 改写成 <proxyBase>/<sub>/<path>，并注入门禁 header。
 * proxyBase 未配置时一律原样直连（本地开发 / 现有测试不受影响，也是线上一键回退开关）。
 */

/** 把 fflogs 上游 URL 改写为经代理的 URL；未配置 proxyBase 或非 fflogs 域名则原样返回 */
export function rewriteFFLogsUrl(url: string, proxyBase?: string): string {
  if (!proxyBase) return url
  const u = new URL(url)
  if (!u.hostname.endsWith('.fflogs.com')) return url
  const sub = u.hostname.split('.')[0] // 'www' | 'cn'
  return `${proxyBase.replace(/\/$/, '')}/${sub}${u.pathname}${u.search}`
}

/** 经代理发起 FFLogs 请求：改写 URL + 注入 X-Proxy-Secret（仅在 base 与 secret 同时配置时） */
export function fflogsFetch(
  url: string,
  init: RequestInit,
  opts: { proxyBase?: string; proxySecret?: string }
): Promise<Response> {
  const target = rewriteFFLogsUrl(url, opts.proxyBase)
  const headers = new Headers(init.headers)
  if (opts.proxyBase && opts.proxySecret) {
    headers.set('X-Proxy-Secret', opts.proxySecret)
  }
  return fetch(target, { ...init, headers })
}
