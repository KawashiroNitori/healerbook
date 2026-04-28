/**
 * 状态注册表
 * 提供状态元数据的查询接口
 */

import { keigenns } from '../../3rdparty/ff14-overlay-vue/src/resources/keigenn'
import type { Keigenn } from '../../3rdparty/ff14-overlay-vue/src/types/keigennRecord2'
import { STATUS_EXTRAS, type StatusExtras } from '@/data/statusExtras'
import type { MitigationStatusMetadata } from '@/types/status'

/** 第三方 keigenns 数组的元素形状（fullIcon 可选） */
type KeigennInput = Omit<Keigenn, 'fullIcon'> & { fullIcon?: string }

/**
 * 由 keigenn 列表 + extras 表构建状态注册表
 *
 * 合并规则：
 *   - 迭代 `keigennList` ∪ `extrasMap` 的 statusId 并集
 *   - extras 的同名 base 字段（name / type / isFriendly / performance / fullIcon）
 *     覆盖 keigenn；缺省时回落到 keigenn 值
 *   - 只在 extras 中的 id 必须自带 name / isFriendly，否则 throw；
 *     `type` 可缺省（视为不参与 % 减伤、不算盾的 executor-only 状态）；
 *     `performance` 缺省视为 `{ physics: 1, magic: 1, darkness: 1 }`
 *   - performance.heal / maxHP 缺省为 1，isTankOnly 缺省为 false
 *
 * 纯函数；无副作用；用于真实初始化与单元测试两个场景。
 */
export function buildStatusRegistry(
  keigennList: readonly KeigennInput[],
  extrasMap: Record<number, StatusExtras>
): Map<number, MitigationStatusMetadata> {
  const result = new Map<number, MitigationStatusMetadata>()

  const keigennById = new Map<number, KeigennInput>()
  for (const k of keigennList) keigennById.set(k.id, k)

  const allIds = new Set<number>([...keigennById.keys(), ...Object.keys(extrasMap).map(Number)])

  for (const id of allIds) {
    const keigenn = keigennById.get(id)
    const extras = extrasMap[id]

    const name = extras?.name ?? keigenn?.name
    const type = extras?.type ?? keigenn?.type
    const isFriendly = extras?.isFriendly ?? keigenn?.isFriendly
    const basePerformance = extras?.performance ??
      keigenn?.performance ?? { physics: 1, magic: 1, darkness: 1 }
    const fullIcon = extras?.fullIcon ?? keigenn?.fullIcon

    if (name === undefined || isFriendly === undefined) {
      const missing = [
        name === undefined ? 'name' : null,
        isFriendly === undefined ? 'isFriendly' : null,
      ]
        .filter(Boolean)
        .join(' / ')
      throw new Error(`STATUS_EXTRAS[${id}] 在第三方 keigenns 中不存在，必须在本地补全 ${missing}`)
    }

    result.set(id, {
      id,
      name,
      type,
      isFriendly,
      fullIcon,
      performance: {
        ...basePerformance,
        heal: extras?.heal ?? 1,
        selfHeal: extras?.selfHeal ?? 1,
        maxHP: extras?.maxHP ?? 1,
      },
      isTankOnly: extras?.isTankOnly ?? false,
      executor: extras?.executor,
      category: extras?.category,
    })
  }

  return result
}

/**
 * 状态 ID 到元数据的映射（模块级单例，懒加载）
 */
const statusMap = new Map<number, MitigationStatusMetadata>()

function initializeStatusRegistry() {
  if (statusMap.size > 0) return
  const built = buildStatusRegistry(keigenns, STATUS_EXTRAS)
  for (const [id, meta] of built) statusMap.set(id, meta)
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
