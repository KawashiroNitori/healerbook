/**
 * Encounter Template API 客户端
 *
 * 返回副本的预填充伤害事件列表，用于新建空白时间轴时填充初始 damageEvents。
 * 后端无数据时返回 { events: [], updatedAt: null }，前端无需特殊处理。
 */

import { apiClient } from './apiClient'
import type { DamageEvent } from '@/types/timeline'

export interface EncounterTemplateResponse {
  events: DamageEvent[]
  updatedAt: string | null
}

export async function fetchEncounterTemplate(
  encounterId: number
): Promise<EncounterTemplateResponse> {
  return apiClient.get(`encounter-templates/${encounterId}`).json<EncounterTemplateResponse>()
}
