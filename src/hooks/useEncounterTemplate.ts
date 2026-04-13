/**
 * useEncounterTemplate — 获取指定副本的预填充伤害事件模板
 *
 * 缓存策略：staleTime 1 小时（后端数据由每日 cron 生成，变化频率低）
 */

import { useQuery } from '@tanstack/react-query'
import { fetchEncounterTemplate } from '@/api/encounterTemplate'

export function useEncounterTemplate(encounterId: number) {
  return useQuery({
    queryKey: ['encounter-template', encounterId],
    queryFn: () => fetchEncounterTemplate(encounterId),
    staleTime: 1000 * 60 * 60,
    enabled: encounterId > 0,
  })
}
