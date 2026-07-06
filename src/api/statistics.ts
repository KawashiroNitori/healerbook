/**
 * 副本统计数据 API 客户端
 */

import type { EncounterStatistics } from '@/types/mitigation'
import { apiClient } from './apiClient'
import { unwrapApiError } from './unwrapApiError'

/**
 * 获取指定副本的统计数据
 * @param encounterId 副本 ID
 * @returns 统计数据；404 返回 null（表示该副本暂未收录），其他错误抛出
 */
export async function getEncounterStatistics(
  encounterId: number
): Promise<EncounterStatistics | null> {
  return unwrapApiError<EncounterStatistics | null>(
    () => apiClient.get(`statistics/${encounterId}`).json<EncounterStatistics>(),
    { onStatus: { 404: () => null }, rethrowOriginal: true }
  )
}
