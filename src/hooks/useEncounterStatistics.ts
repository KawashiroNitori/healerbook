/**
 * 副本统计数据 Hook
 */

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getEncounterStatistics } from '@/api/statistics'
import { useTimelineStore } from '@/store/timelineStore'

export function useEncounterStatistics(encounterId: number | undefined) {
  const setStatistics = useTimelineStore(state => state.setStatistics)

  const query = useQuery({
    queryKey: ['encounterStatistics', encounterId],
    queryFn: () => getEncounterStatistics(encounterId!),
    enabled: encounterId != null,
    staleTime: 1000 * 60 * 60 * 12, // 12 小时
  })

  useEffect(() => {
    setStatistics(query.data ?? null)
  }, [query.data, setStatistics])

  return query
}
