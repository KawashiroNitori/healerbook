/**
 * 应用常量配置
 */

/**
 * 图标资源 Base URL
 * 直接使用外部 CDN，不使用代理
 * 注意：Canvas 将无法导出包含这些图片的内容（tainted canvas）
 */
export const ICON_BASE_URL = 'https://cafemaker.wakingsands.com'
export const FFLOGS_ICON_BASE_URL = 'https://assets.rpglogs.cn/img/ff/abilities/'

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

  if (iconPath.startsWith('/i/')) {
    return `${ICON_BASE_URL}${iconPath}`
  } else {
    return `${FFLOGS_ICON_BASE_URL}${iconPath}`
  }
}
