/**
 * 把各种 icon 输入归一成 iconId（number）。
 * 支持：'/i/HHHHHH/FFFFFF.png'、'ui/icon/HHHHHH/FFFFFF.tex'（含 _hrN 高清后缀）、
 * FFLogs 'HHHHHH-FFFFFF.png'、纯数字。无法解析 → 0。
 */
export function normalizeIcon(input: string | number): number {
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0
  let s: string
  // asset URL 把 icon 藏在 path= 查询参数里，优先取它
  const pathMatch = input.match(/[?&]path=([^&]+)/)
  if (pathMatch) {
    s = decodeURIComponent(pathMatch[1])
  } else {
    s = input.split('?')[0]
  }
  // 去掉 _hrN 高清后缀（会引入尾部数字）
  s = s.replace(/_hr\d+/gi, '')
  const groups = s.match(/\d+/g)
  if (!groups || groups.length === 0) return 0
  return Number.parseInt(groups[groups.length - 1], 10)
}
