/**
 * 状态注册表
 * 提供状态元数据的查询接口
 */

import { keigenns } from '../../3rdparty/ff14-overlay-vue/src/resources/keigenn'
import { STATUS_EXTRAS } from '@/data/statusExtras'
import type { MitigationStatusMetadata } from '@/types/status'

/**
 * 状态 ID 到元数据的映射
 */
const statusMap = new Map<number, MitigationStatusMetadata>()

/**
 * 初始化状态注册表
 *
 * 合并规则：3rd party Keigenn 数据 + STATUS_EXTRAS 覆盖 + 默认值
 *   - performance.heal 缺省为 1（无影响）
 *   - performance.maxHP 缺省为 1（无影响）
 *   - isTankOnly 缺省为 false
 */
function initializeStatusRegistry() {
  if (statusMap.size > 0) return // 已初始化

  for (const status of keigenns) {
    const extras = STATUS_EXTRAS[status.id]
    const merged: MitigationStatusMetadata = {
      ...status,
      performance: {
        ...status.performance,
        heal: extras?.heal ?? 1,
        maxHP: extras?.maxHP ?? 1,
      },
      isTankOnly: extras?.isTankOnly ?? false,
    }
    statusMap.set(status.id, merged)
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
  return Array.from(statusMap.values()).filter(status => status.isFriendly)
}

/**
 * 获取所有敌方状态
 * @returns 敌方状态列表
 */
export function getAllEnemyStatuses(): MitigationStatusMetadata[] {
  initializeStatusRegistry()
  return Array.from(statusMap.values()).filter(status => !status.isFriendly)
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

/**
 * 获取所有盾值状态（type: 'absorbed'）
 * @returns 盾值状态列表
 */
export function getAllShieldStatuses(): MitigationStatusMetadata[] {
  initializeStatusRegistry()
  return Array.from(statusMap.values()).filter(status => status.type === 'absorbed')
}

/**
 * 获取所有盾值状态的 ID 列表
 * @returns 盾值状态 ID 数组
 */
export function getAllShieldStatusIds(): number[] {
  return getAllShieldStatuses().map(status => status.id)
}
