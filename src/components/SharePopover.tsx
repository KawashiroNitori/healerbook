/**
 * 共享 Popover 组件
 * 三种状态：未登录 / 已登录未发布 / 已登录已发布（作者）
 */

import { useState } from 'react'
import { Copy, Check, Loader2, Globe, Upload, CloudUpload, Lock, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/authStore'
import type { Timeline } from '@/types/timeline'
import { publishTimeline, updateTimeline, type ConflictError } from '@/api/timelineShareApi'
import { track } from '@/utils/analytics'

interface SharePopoverProps {
  timeline: Timeline
  /** 当前视图模式，用于生成带对应 view 参数的分享链接 */
  viewMode: 'timeline' | 'table'
  onPublished: (newId: string, publishedAt: number, version: number) => void
  onUpdated: (updatedAt: number, version: number) => void
  onConflict: (conflict: ConflictError) => void
}

const SHARE_BASE_URL = window.location.origin

export default function SharePopover({
  timeline,
  viewMode,
  onPublished,
  onUpdated,
  onConflict,
}: SharePopoverProps) {
  const { isLoggedIn, login } = useAuth()
  const accessToken = useAuthStore(s => s.accessToken)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const isShared = !!timeline.isShared
  const hasChanges = isShared && !!timeline.hasLocalChanges
  const shareUrl = isShared
    ? `${SHARE_BASE_URL}/timeline/${timeline.id}${viewMode === 'table' ? '?view=table' : ''}`
    : ''

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
      track('timeline-publish', { encounterId: timeline.encounter?.id })
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
        track('timeline-update', { encounterId: timeline.encounter?.id })
        toast.success('已保存更新')
      }
    } catch (err) {
      toast.error(`保存失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认发布时间轴</AlertDialogTitle>
            <AlertDialogDescription>
              发布后，互联网上获得链接的人都能够访问该时间轴。仅你可以编辑和更新内容。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handlePublish}>确认发布</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1 font-normal whitespace-nowrap"
          >
            {isShared ? <Globe className="w-4 h-4" /> : <CloudUpload className="w-4 h-4" />}
            <span className="hidden lg:inline">共享</span>
            {hasChanges && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
              </span>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-80" align="end">
          <div className="space-y-3">
            <div>
              <h4 className="font-medium text-sm">共享时间轴</h4>
              <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                {!isLoggedIn ? (
                  <>
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span>需要登录才能共享时间轴</span>
                  </>
                ) : isShared ? (
                  <>
                    <Globe className="w-3.5 h-3.5 shrink-0" />
                    <span>时间轴已发布，获得链接的人可阅读</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span>时间轴未共享，仅本设备可查看</span>
                  </>
                )}
              </div>
            </div>
            {!isLoggedIn ? (
              // 状态 1：未登录
              <div className="space-y-3">
                <Button className="w-full" onClick={login}>
                  登录 FFLogs
                </Button>
              </div>
            ) : !isShared ? (
              // 状态 2：已登录，未发布
              <div className="space-y-3">
                <Button
                  variant="default"
                  className="w-full"
                  onClick={() => setConfirmOpen(true)}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  发布
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
                <Button
                  className="w-full"
                  onClick={handleSaveUpdate}
                  disabled={loading || !hasChanges}
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  发布更新
                </Button>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
