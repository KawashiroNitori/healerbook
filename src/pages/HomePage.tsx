/**
 * 主页
 */

import { useState, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Upload } from 'lucide-react'
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
import { useAuth } from '@/hooks/useAuth'
import { Globe } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMyTimelines, deleteSharedTimeline } from '@/api/timelineShareApi'
import { track } from '@/utils/analytics'

const CreateTimelineDialog = lazy(() => import('@/components/CreateTimelineDialog'))
const ImportFFLogsDialog = lazy(() => import('@/components/ImportFFLogsDialog'))
const Top100Section = lazy(() => import('@/components/Top100Section'))

export default function HomePage() {
  const navigate = useNavigate()
  const { isLoggedIn } = useAuth()
  const queryClient = useQueryClient()
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
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
          <div>
            <h1 className="text-2xl font-bold">{APP_NAME}</h1>
            <p className="text-sm text-muted-foreground">FF14 减伤规划工具</p>
          </div>
          <AuthButton />
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <button
            onClick={handleCreateNew}
            className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg hover:border-primary hover:bg-accent transition-colors"
          >
            <Plus className="w-12 h-12 mb-2 text-muted-foreground" />
            <span className="font-medium">新建时间轴</span>
            <span className="text-sm text-muted-foreground">从空白开始</span>
          </button>

          <button
            onClick={handleImportFromFFLogs}
            className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg hover:border-primary hover:bg-accent transition-colors"
          >
            <Upload className="w-12 h-12 mb-2 text-muted-foreground" />
            <span className="font-medium">从 FFLogs 导入</span>
            <span className="text-sm text-muted-foreground">导入战斗记录</span>
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
