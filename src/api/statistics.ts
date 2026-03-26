/**
 * 副本统计数据 API 客户端
 */

import type { EncounterStatistics } from '@/types/mitigation'
import { apiClient } from './apiClient'

/**
 * 获取指定副本的统计数据
 * @param encounterId 副本 ID
 * @returns 统计数据，若不存在则返回 null
 */
export async function getEncounterStatistics(
  encounterId: number
): Promise<EncounterStatistics | null> {
  try {
    return await apiClient.get(`statistics/${encounterId}`).json<EncounterStatistics>()
  } catch {
    return null
  }
}
