/**
 * 副本统计数据 API 客户端
 */

import type { EncounterStatistics } from '@/types/mitigation'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

/**
 * 获取指定副本的统计数据
 * @param encounterId 副本 ID
 * @returns 统计数据，若不存在则返回 null
 */
export async function getEncounterStatistics(
  encounterId: number
): Promise<EncounterStatistics | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/statistics/${encounterId}`)
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}
