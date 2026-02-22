/**
 * 状态注册表
 * 提供状态元数据的查询接口
 */

import { keigenns } from '../../3rdparty/ff14-overlay-vue/src/resources/keigenn'
import type { MitigationStatusMetadata } from '@/types/status'

/**
 * 状态 ID 到元数据的映射
 */
const statusMap = new Map<number, MitigationStatusMetadata>()

/**
 * 初始化状态注册表
 */
function initializeStatusRegistry() {
  if (statusMap.size > 0) return // 已初始化

  for (const status of keigenns) {
    statusMap.set(status.id, status as MitigationStatusMetadata)
  }
}

/**
 * 根据状态 ID 获取状态元数据
 * @param statusId 状态 ID
 * @returns 状态元数据，如果不存在则返回 undefined
 */
export function getStatusById(statusId: number): MitigationStatusMetadata | undefined {
  initializeStatusRegistry()
  return statusMap.get(statusId)
}

/**
 * 获取所有友方状态
 * @returns 友方状态列表
 */
export function getAllFriendlyStatuses(): MitigationStatusMetadata[] {
  initializeStatusRegistry()
  return Array.from(statusMap.values()).filter((status) => status.isFriendly)
}

/**
 * 获取所有敌方状态
 * @returns 敌方状态列表
 */
export function getAllEnemyStatuses(): MitigationStatusMetadata[] {
  initializeStatusRegistry()
  return Array.from(statusMap.values()).filter((status) => !status.isFriendly)
}

/**
 * 检查状态是否存在
 * @param statusId 状态 ID
 * @returns 是否存在
 */
export function hasStatus(statusId: number): boolean {
  initializeStatusRegistry()
  return statusMap.has(statusId)
}
