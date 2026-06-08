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
  /** 模板来源战斗的时长（毫秒），即当前进度最长那次；无模板时为 null */
  templateSourceDurationMs: number | null
  /** 模板来源战斗是否为击杀；为 true 时前端显示"已更新完成"而非时长进度条 */
  kill: boolean
}

export async function fetchEncounterTemplate(
  encounterId: number
): Promise<EncounterTemplateResponse> {
  return apiClient.get(`encounter-templates/${encounterId}`).json<EncounterTemplateResponse>()
}
