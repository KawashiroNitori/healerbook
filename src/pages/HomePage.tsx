/**
 * 主页
 */

import { useState, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, CircleHelp, Info } from 'lucide-react'
import {
  getAllTimelineMetadata,
  deleteTimeline,
  type TimelineMetadata,
} from '@/utils/timelineStorage'
import ConfirmDialog from '@/components/ConfirmDialog'
import { toast } from 'sonner'
import { APP_NAME } from '@/lib/constants'
import TimelineCard from '@/components/TimelineCard'
import AuthButton from '@/components/AuthButton'
import ThemeToggle from '@/components/ThemeToggle'
import { useAuth } from '@/hooks/useAuth'
import { Globe } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMyTimelines, deleteSharedTimeline } from '@/api/timelineShareApi'
import { track } from '@/utils/analytics'
import { useChangelogToast } from '@/hooks/useChangelogToast'

const CreateTimelineDialog = lazy(() => import('@/components/CreateTimelineDialog'))
const ImportFFLogsDialog = lazy(() => import('@/components/ImportFFLogsDialog'))
const Top100Section = lazy(() => import('@/components/Top100Section'))
const AboutDialog = lazy(() => import('@/components/AboutDialog'))

export default function HomePage() {
  useChangelogToast()
  const navigate = useNavigate()
  const { isLoggedIn } = useAuth()
  const queryClient = useQueryClient()
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showAboutDialog, setShowAboutDialog] = useState(false)
  const [showAboutTip, setShowAboutTip] = useState(
    () => !localStorage.getItem('about-tip-dismissed')
  )
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [timelineToDelete, setTimelineToDelete] = useState<string | null>(null)
  const [deletePublishedConfirmOpen, setDeletePublishedConfirmOpen] = useState(false)
  const [publishedTimelineToDelete, setPublishedTimelineToDelete] = useState<string | null>(null)

  const [timelines, setTimelines] = useState<TimelineMetadata[]>(() =>
    getAllTimelineMetadata().sort((a, b) => b.updatedAt - a.updatedAt)
  )

  const { data: myTimelines } = useQuery({
    queryKey: ['myTimelines'],
    queryFn: fetchMyTimelines,
    enabled: isLoggedIn,
  })

  const loadTimelines = () => {
    setTimelines(getAllTimelineMetadata().sort((a, b) => b.updatedAt - a.updatedAt))
  }

  const handleCreateNew = () => {
    track('timeline-create-start')
    setShowCreateDialog(true)
  }

  const handleImportFromFFLogs = () => {
    track('fflogs-import-start')
    setShowImportDialog(true)
  }

  const handleDeleteTimeline = (id: string) => {
    setTimelineToDelete(id)
    setDeleteConfirmOpen(true)
  }

  return (
    <div className="min-h-screen bg-background">
      <title>{APP_NAME}</title>
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/icon.png" alt="Healerbook" className="w-10 h-10" />
            <div>
              <h1 className="text-2xl font-bold">{APP_NAME}</h1>
              <p className="hidden sm:block text-sm text-muted-foreground">FF14 减伤规划工具</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/docs/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => track('help-click')}
            >
              <CircleHelp className="w-4 h-4" />
              <span className="hidden sm:inline">帮助</span>
            </a>
            <button
              onClick={() => {
                if (showAboutTip) {
                  localStorage.setItem('about-tip-dismissed', '1')
                  setShowAboutTip(false)
                }
                track('about-click')
                setShowAboutDialog(true)
              }}
              className="relative inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Info className="w-4 h-4" />
              <span className="hidden sm:inline">关于</span>
              {showAboutTip && (
                <div className="absolute top-full right-0 mt-2 w-48 rounded-md border border-foreground/20 bg-popover p-3 text-xs text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95">
                  <div className="absolute -top-1.5 right-4 h-3 w-3 rotate-45 border-l border-t border-foreground/20 bg-popover" />
                  <p className="text-left">
                    我建了一个 QQ 群，欢迎加入反馈意见、关注新功能更新
                    <del className="text-muted-foreground">催更</del>、以及交流各自的减伤轴~
                  </p>
                </div>
              )}
            </button>
            <div className="w-px h-4 bg-border" />
            <a
              href="https://github.com/KawashiroNitori/healerbook"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
              <span className="hidden sm:inline font-mono text-xs">{__COMMIT_HASH__}</span>
            </a>
            <ThemeToggle />
            <AuthButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <button
            onClick={handleImportFromFFLogs}
            className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg hover:border-primary hover:bg-accent transition-colors"
          >
            <Download className="w-12 h-12 mb-2 text-muted-foreground" />
            <span className="font-medium">从 FFLogs 导入</span>
            <span className="text-sm text-muted-foreground">导入战斗记录</span>
          </button>

          <button
            onClick={handleCreateNew}
            className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg hover:border-primary hover:bg-accent transition-colors"
          >
            <Plus className="w-12 h-12 mb-2 text-muted-foreground" />
            <span className="font-medium">新建时间轴</span>
            <span className="text-sm text-muted-foreground">从空白开始</span>
          </button>
        </div>

        {/* Local Timelines */}
        {timelines.length > 0 && (
          <section className="mb-12">
            <h2 className="text-xl font-semibold mb-4">本地时间轴</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {timelines.map(timeline => (
                <TimelineCard
                  key={timeline.id}
                  timeline={timeline}
                  onClick={() => {
                    track('timeline-open', { source: 'local' })
                    navigate(`/timeline/${timeline.id}`)
                  }}
                  onDelete={e => {
                    e.stopPropagation()
                    handleDeleteTimeline(timeline.id)
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* 已发布的时间轴 */}
        {isLoggedIn && myTimelines && myTimelines.length > 0 && (
          <section className="mb-12">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Globe className="w-5 h-5" />
              已发布
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {myTimelines.map(timeline => (
                <TimelineCard
                  key={timeline.id}
                  timeline={{
                    id: timeline.id,
                    name: timeline.name,
                    encounterId: '',
                    createdAt: timeline.publishedAt,
                    updatedAt: timeline.updatedAt,
                    composition: timeline.composition,
                  }}
                  onClick={() => {
                    track('timeline-open', { source: 'published' })
                    navigate(`/timeline/${timeline.id}`)
                  }}
                  onDelete={e => {
                    e.stopPropagation()
                    setPublishedTimelineToDelete(timeline.id)
                    setDeletePublishedConfirmOpen(true)
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* TOP100 参考方案 */}
        <Suspense fallback={null}>
          <Top100Section />
        </Suspense>
      </main>

      {/* Dialogs */}
      <Suspense fallback={null}>
        {showAboutDialog && (
          <AboutDialog open={showAboutDialog} onOpenChange={setShowAboutDialog} />
        )}
        {showCreateDialog && (
          <CreateTimelineDialog
            open={showCreateDialog}
            onClose={() => setShowCreateDialog(false)}
            onCreated={loadTimelines}
          />
        )}
        {showImportDialog && (
          <ImportFFLogsDialog
            open={showImportDialog}
            onClose={() => setShowImportDialog(false)}
            onImported={loadTimelines}
          />
        )}
      </Suspense>

      {/* 删除本地时间轴确认 */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="删除时间轴"
        description="确定要删除这个时间轴吗？"
        variant="destructive"
        onConfirm={() => {
          if (timelineToDelete) {
            deleteTimeline(timelineToDelete)
            loadTimelines()
            setTimelineToDelete(null)
            toast.success('时间轴已删除')
          }
          setDeleteConfirmOpen(false)
        }}
      />

      {/* 取消发布确认 */}
      <ConfirmDialog
        open={deletePublishedConfirmOpen}
        onOpenChange={setDeletePublishedConfirmOpen}
        title="取消发布"
        description="取消发布后，获得链接的人将无法再访问该时间轴。确定要取消发布吗？"
        variant="destructive"
        onConfirm={async () => {
          if (publishedTimelineToDelete) {
            try {
              await deleteSharedTimeline(publishedTimelineToDelete)
              await queryClient.invalidateQueries({ queryKey: ['myTimelines'] })
              toast.success('已取消发布')
            } catch (err) {
              toast.error(`删除失败：${err instanceof Error ? err.message : '未知错误'}`)
            }
            setPublishedTimelineToDelete(null)
          }
          setDeletePublishedConfirmOpen(false)
        }}
      />
    </div>
  )
}
