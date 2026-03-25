/**
 * 分享 Popover 组件
 * 三种状态：未登录 / 已登录未发布 / 已登录已发布（作者）
 */

import { useState } from 'react'
import { Copy, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/authStore'
import type { Timeline } from '@/types/timeline'
import { publishTimeline, updateTimeline, type ConflictError } from '@/api/timelineShareApi'

interface SharePopoverProps {
  timeline: Timeline
  onPublished: (newId: string, publishedAt: number, version: number) => void
  onUpdated: (updatedAt: number, version: number) => void
  onConflict: (conflict: ConflictError) => void
}

const SHARE_BASE_URL = window.location.origin

export default function SharePopover({
  timeline,
  onPublished,
  onUpdated,
  onConflict,
}: SharePopoverProps) {
  const { isLoggedIn, login } = useAuth()
  const accessToken = useAuthStore(s => s.accessToken)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const isShared = !!timeline.isShared
  const hasChanges = isShared && !!timeline.hasLocalChanges
  const shareUrl = isShared ? `${SHARE_BASE_URL}/timeline/${timeline.id}` : ''

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('复制失败，请手动复制链接')
    }
  }

  const handlePublish = async () => {
    if (!accessToken) return
    setLoading(true)
    try {
      const result = await publishTimeline(timeline)
      onPublished(result.id, result.publishedAt, result.version)
      toast.success('发布成功')
    } catch (err) {
      toast.error(`发布失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveUpdate = async () => {
    if (!accessToken || !isShared) return
    setLoading(true)
    try {
      const result = await updateTimeline(timeline.id, timeline, timeline.serverVersion)
      if ('type' in result && result.type === 'conflict') {
        onConflict(result)
      } else if ('updatedAt' in result) {
        onUpdated(result.updatedAt, result.version)
        toast.success('已保存更新')
      }
    } catch (err) {
      toast.error(`保存失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          分享
          {hasChanges && <span className="text-orange-500">●</span>}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80" align="end">
        {!isLoggedIn ? (
          // 状态 1：未登录
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">需要登录才能分享时间轴</p>
            <Button className="w-full" onClick={login}>
              登录 FFLogs
            </Button>
          </div>
        ) : !isShared ? (
          // 状态 2：已登录，未发布
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              发布后任何人可通过链接查看，仅你可以编辑和更新
            </p>
            <Button className="w-full" onClick={handlePublish} disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              发布分享
            </Button>
          </div>
        ) : (
          // 状态 3：已登录，已发布（作者）
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                className="flex-1 px-2 py-1 text-xs border rounded bg-muted font-mono truncate"
              />
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            {hasChanges && <p className="text-xs text-orange-600">● 有未发布的本地修改</p>}
            <Button className="w-full" onClick={handleSaveUpdate} disabled={loading || !hasChanges}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              保存更新
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
