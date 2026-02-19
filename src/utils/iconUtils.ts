/**
 * 应用常量配置
 */

/**
 * 图标资源 Base URL
 * 开发环境使用代理，生产环境使用实际 URL
 */
export const ICON_BASE_URL =
  import.meta.env.DEV ? '/api/icons' : 'https://cafemaker.wakingsands.com'

/**
 * 拼接图标 URL
 * @param iconPath 图标路径
 * @returns 完整的图标 URL
 */
export function getIconUrl(iconPath: string): string {
  if (!iconPath) return ''

  // 如果已经是完整 URL，直接返回
  if (iconPath.startsWith('http://') || iconPath.startsWith('https://')) {
    return iconPath
  }

  // 确保路径以 / 开头
  const path = iconPath.startsWith('/') ? iconPath : `/${iconPath}`

  return `${ICON_BASE_URL}${path}`
}

/**
 * 拼接高清图标 URL
 * @param iconHDPath 高清图标路径
 * @returns 完整的高清图标 URL
 */
export function getIconHDUrl(iconHDPath: string): string {
  return getIconUrl(iconHDPath)
}
