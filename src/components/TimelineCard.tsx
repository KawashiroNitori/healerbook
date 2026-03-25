/**
 * 时间轴卡片组件
 */

import { Trash2 } from 'lucide-react'
import JobIcon from './JobIcon'
import { getTimeline, type TimelineMetadata } from '@/utils/timelineStorage'
import { sortJobsByOrder } from '@/data/jobs'

interface TimelineCardProps {
  timeline: TimelineMetadata
  onClick: () => void
  onDelete: (e: React.MouseEvent) => void
}

export default function TimelineCard({ timeline, onClick, onDelete }: TimelineCardProps) {
  // 读取完整时间轴以获取阵容信息
  const fullTimeline = getTimeline(timeline.id)
  const composition = fullTimeline?.composition

  // 按职业顺序排序
  const sortedJobs = composition?.players
    ? sortJobsByOrder(composition.players, p => p.job).map(p => p.job)
    : []

  return (
    <div
      className="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer group"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-medium group-hover:text-primary">{timeline.name}</h3>
          {timeline.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{timeline.description}</p>
          )}
        </div>
        <button
          onClick={onDelete}
          className="p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* FFLogs 来源标签 */}
      {fullTimeline?.fflogsSource && (
        <div className="flex items-center gap-1 mb-1">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
            FFLogs
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            {fullTimeline.fflogsSource.reportCode}#{fullTimeline.fflogsSource.fightId}
          </span>
        </div>
      )}

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
        更新于{' '}
        {new Date(timeline.updatedAt).toLocaleString('zh-CN', {
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
