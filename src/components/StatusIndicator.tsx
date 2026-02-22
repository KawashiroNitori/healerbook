/**
 * 状态指示器组件
 * 显示指定时间点生效的所有状态
 */

import { useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { getStatusById } from '@/utils/statusRegistry'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

interface StatusIndicatorProps {
  time: number
  className?: string
}

export default function StatusIndicator({ time, className }: StatusIndicatorProps) {
  const getPartyStateAtTime = useTimelineStore((state) => state.getPartyStateAtTime)
  const timeline = useTimelineStore((state) => state.timeline)

  const activeStatuses = useMemo(() => {
    if (!timeline) return []

    const partyState = getPartyStateAtTime(time)
    if (!partyState) return []

    const statuses: Array<{
      id: string
      name: string
      type: 'friendly' | 'enemy'
      source: string
    }> = []

    // 收集友方状态
    for (const player of partyState.players) {
      for (const status of player.statuses) {
        const meta = getStatusById(status.statusId)
        if (!meta) continue

        statuses.push({
          id: status.instanceId,
          name: meta.name,
          type: 'friendly',
          source: player.job,
        })
      }
    }

    // 收集敌方状态
    for (const status of partyState.enemy.statuses) {
      const meta = getStatusById(status.statusId)
      if (!meta) continue

      statuses.push({
        id: status.instanceId,
        name: meta.name,
        type: 'enemy',
        source: 'Boss',
      })
    }

    return statuses
  }, [timeline, time, getPartyStateAtTime])

  if (activeStatuses.length === 0) {
    return (
      <div className={className}>
        <p className="text-sm text-muted-foreground">当前无生效状态</p>
      </div>
    )
  }

  return (
    <ScrollArea className={className}>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">生效状态 ({activeStatuses.length})</h3>
        <div className="flex flex-wrap gap-2">
          {activeStatuses.map((status) => (
            <Badge
              key={status.id}
              variant={status.type === 'friendly' ? 'default' : 'destructive'}
              className="text-xs"
            >
              {status.name}
              <span className="ml-1 text-xs opacity-70">({status.source})</span>
            </Badge>
          ))}
        </div>
      </div>
    </ScrollArea>
  )
}
