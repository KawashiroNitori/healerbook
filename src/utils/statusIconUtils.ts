/**
 * 状态图标工具函数
 * 用于获取状态图标的 URL
 */

import { statusData } from '@/../3rdparty/ff14-overlay-vue/src/resources/logic/status'
import { buildIconUrl } from '@/api/providers/iconProvider'

/**
 * 根据状态 ID 获取图标 URL
 * @param statusId 状态 ID
 * @returns 图标 URL，如果状态不存在则返回 undefined
 */
export function getStatusIconUrl(statusId: number): string | undefined {
  const statusInfo = statusData[statusId]
  if (!statusInfo) return undefined
  return buildIconUrl(statusInfo[1]) // statusInfo[1] = 图标 ID
}

/**
 * 根据状态 ID 获取状态名称
 * @param statusId 状态 ID
 * @returns 状态名称，如果状态不存在则返回 undefined
 */
export function getStatusName(statusId: number): string | undefined {
  const statusInfo = statusData[statusId]
  if (!statusInfo) return undefined

  return statusInfo[0] // 状态名称
}
