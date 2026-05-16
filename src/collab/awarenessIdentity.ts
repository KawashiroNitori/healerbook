/**
 * Awareness 身份:协作者颜色与昵称。
 * 颜色由 userId 确定性哈希到固定调色板 —— 同一用户每次每设备恒定同色,无需协商。
 */

/**
 * 协作者调色板。14 个高区分度色,刻意避开自身选中态的蓝 #3b82f6 / 绿 #10b981。
 */
export const COLOR_PALETTE: readonly string[] = [
  '#a855f7', // purple
  '#ec4899', // pink
  '#f43f5e', // rose
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#84cc16', // lime
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#0ea5e9', // sky
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#d946ef', // fuchsia
]

/** 简单确定性字符串哈希(FNV-1a 变体),返回非负整数 */
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 由 userId 定一个稳定颜色 */
export function colorForUser(userId: string): string {
  return COLOR_PALETTE[hashString(userId) % COLOR_PALETTE.length]
}

/** 协作者昵称:用 FFLogs 账号名;为空时兜底为「用户」+ userId 末 4 位 */
export function displayName(username: string | null | undefined, userId: string): string {
  const name = (username ?? '').trim()
  if (name) return name
  return `用户${userId.slice(-4)}`
}
