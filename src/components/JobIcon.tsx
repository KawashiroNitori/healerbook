/**
 * 职业图标组件
 * 使用 xivapi/classjob-icons 字体库显示职业图标
 */

import { getJobIconClass } from '@/data/jobs'
import type { Job } from '@/types/timeline'
import { cn } from '@/lib/utils'

interface JobIconProps {
  /** 职业代码 */
  job: Job
  /** 自定义类名 */
  className?: string
  /** 图标大小 */
  size?: 'sm' | 'md' | 'lg'
}

/**
 * 职业图标组件
 *
 * @example
 * ```tsx
 * <JobIcon job="PLD" size="md" />
 * <JobIcon job="WHM" size="sm" className="opacity-60" />
 * ```
 */
export default function JobIcon({
  job,
  className,
  size = 'md'
}: JobIconProps) {
  const iconClass = getJobIconClass(job)

  const sizeClasses = {
    sm: 'text-sm w-4 h-4',
    md: 'text-base w-5 h-5',
    lg: 'text-lg w-6 h-6',
  }

  return (
    <i
      className={cn('job-icon', iconClass, sizeClasses[size], className)}
      aria-label={job}
    />
  )
}
