/**
 * 副本统计数据 API 客户端
 */

import { HTTPError } from 'ky'
import type { EncounterStatistics } from '@/types/mitigation'
import { apiClient } from './apiClient'

/**
 * 获取指定副本的统计数据
 * @param encounterId 副本 ID
 * @returns 统计数据；404 返回 null（表示该副本暂未收录），其他错误抛出
 */
export async function getEncounterStatistics(
  encounterId: number
): Promise<EncounterStatistics | null> {
  try {
    return await apiClient.get(`statistics/${encounterId}`).json<EncounterStatistics>()
  } catch (err) {
    if (err instanceof HTTPError && err.response.status === 404) {
      return null
    }
    throw err
  }
}
