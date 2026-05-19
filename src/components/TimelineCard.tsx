/**
 * 时间轴卡片组件
 */

import { Trash2, HardDrive, Globe } from 'lucide-react'
import JobIcon from './JobIcon'
import type { Composition } from '@/types/timeline'
import { sortJobsByOrder } from '@/data/jobs'

interface TimelineCardItem {
  id: string
  name: string
  encounterId: string
  createdAt: number
  lastViewedAt: number
  composition?: Composition | null
  kind: 'local' | 'published' | 'visited'
}

interface TimelineCardProps {
  timeline: TimelineCardItem
  onClick: () => void
  onDelete?: (e: React.MouseEvent) => void
}

export default function TimelineCard({ timeline, onClick, onDelete }: TimelineCardProps) {
  const composition = timeline.composition

  // 按职业顺序排序
  const sortedJobs = composition?.players
    ? sortJobsByOrder(composition.players, p => p.job).map(p => p.job)
    : []

  const deleteLabel =
    timeline.kind === 'local'
      ? '删除'
      : timeline.kind === 'published'
        ? '取消发布并删除'
        : '从列表移除'

  return (
    <div
      className="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer group"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {timeline.kind === 'local' && (
            <HardDrive className="w-4 h-4 shrink-0 text-muted-foreground" aria-label="本地" />
          )}
          {timeline.kind === 'published' && (
            <Globe className="w-4 h-4 shrink-0 text-muted-foreground" aria-label="已发布" />
          )}
          <h3 className="font-medium group-hover:text-primary line-clamp-1" title={timeline.name}>
            {timeline.name}
          </h3>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            title={deleteLabel}
            aria-label={deleteLabel}
            className="p-1 shrink-0 hover:bg-destructive/10 hover:text-destructive rounded transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 职业阵容 */}
      {sortedJobs.length > 0 ? (
        <div className="flex items-center gap-1 mb-2">
          {sortedJobs.map((job, index) => (
            <JobIcon key={`${job}-${index}`} job={job} size="sm" />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground mb-2">无阵容信息</p>
      )}

      <p className="text-xs text-muted-foreground">
        最后查看{' '}
        {new Date(timeline.lastViewedAt * 1000).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
    </div>
  )
}
