/**
 * 图标 URL 工具（兼容旧签名，内部走 provider 链）
 */
import { buildIconUrl } from '@/api/providers/iconProvider'

/**
 * 拼接图标 URL：归一输入 → 用当前 iconLearned 首选源拼 URL。
 * @param iconPath 图标路径 / 数字 id / 完整旧 URL
 */
export function getIconUrl(iconPath: string): string {
  return buildIconUrl(iconPath)
}
