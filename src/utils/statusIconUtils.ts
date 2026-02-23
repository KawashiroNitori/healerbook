/**
 * 状态图标工具函数
 * 用于获取状态图标的 URL
 */

import { statusData, completeIcon } from '@/../3rdparty/ff14-overlay-vue/src/resources/logic/status'

/**
 * 根据状态 ID 获取图标 URL
 * @param statusId 状态 ID
 * @returns 图标 URL，如果状态不存在则返回 undefined
 */
export function getStatusIconUrl(statusId: number): string | undefined {
  const statusInfo = statusData[statusId]
  if (!statusInfo) return undefined

  const iconId = statusInfo[1] // 图标 ID
  const iconPath = completeIcon(iconId)

  // 使用 xivapi 的图标 URL
  return `https://xivapi.com/i/${iconPath}.png`
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
