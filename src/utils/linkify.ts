/**
 * 将纯文本拆分为普通文本段与链接段，供只读展示时渲染超链接。
 *
 * 仅识别 http(s) 协议的 URL，避免把 `javascript:` 等协议渲染成可点击链接。
 * URL 遇到空白或全角标点即结束；末尾的半角标点（如句号、逗号、未配对的右括号）
 * 视为句子标点而非 URL 的一部分。
 */

export type LinkifySegment = { type: 'text'; text: string } | { type: 'link'; text: string }

const URL_PATTERN = /https?:\/\/[^\s<>"'，。！？；：、（）【】《》「」『』]+/gi
const TRAILING_PUNCTUATION = /[.,;:!?'"*_~]+$/

/** 去掉 URL 末尾不属于链接的标点，右括号仅在未配对时去掉 */
function trimUrl(raw: string): string {
  let url = raw
  for (;;) {
    const before = url
    url = url.replace(TRAILING_PUNCTUATION, '')
    for (const [open, close] of [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ] as const) {
      if (url.endsWith(close) && url.split(close).length - 1 > url.split(open).length - 1) {
        url = url.slice(0, -1)
      }
    }
    if (url === before) return url
  }
}

export function linkify(text: string): LinkifySegment[] {
  const segments: LinkifySegment[] = []
  let cursor = 0

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index
    const url = trimUrl(match[0])
    // 仅剩协议头（如 "https://"）不算链接
    if (/^https?:\/\/$/i.test(url)) continue

    if (start > cursor) segments.push({ type: 'text', text: text.slice(cursor, start) })
    segments.push({ type: 'link', text: url })
    cursor = start + url.length
  }

  if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) })
  return segments
}
