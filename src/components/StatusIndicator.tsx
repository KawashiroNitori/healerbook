/**
 * 状态指示器组件
 * 显示指定时间点生效的所有状态
 */

import { useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

interface StatusIndicatorProps {
  // time: number // TODO: 重新设计后启用
  className?: string
}

export default function StatusIndicator({ className }: StatusIndicatorProps) {
  const timeline = useTimelineStore(state => state.timeline)

  const activeStatuses = useMemo(() => {
    if (!timeline) return []

    // 注意：新架构中没有 getPartyStateAtTime，StatusIndicator 组件暂时禁用
    // TODO: 需要重新设计这个组件的数据获取方式
    return [] as Array<{
      id: string
      name: string
      type: 'friendly' | 'enemy'
      source: string
    }>
  }, [timeline])

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
          {activeStatuses.map(status => (
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
