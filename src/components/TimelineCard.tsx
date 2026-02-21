/**
 * 时间轴卡片组件
 */

import { Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import type { TimelineMetadata } from '@/utils/timelineStorage'

interface TimelineCardProps {
  timeline: TimelineMetadata
  onClick: () => void
  onDelete: (e: React.MouseEvent) => void
}

export default function TimelineCard({ timeline, onClick, onDelete }: TimelineCardProps) {
  return (
    <div
      className="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer group"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-medium group-hover:text-primary">{timeline.name}</h3>
        <button
          onClick={onDelete}
          className="p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <p className="text-sm text-muted-foreground mb-2">
        副本: {timeline.encounterId}
      </p>
      <p className="text-xs text-muted-foreground">
        更新于 {format(new Date(timeline.updatedAt), 'yyyy-MM-dd HH:mm')}
      </p>
    </div>
  )
}
