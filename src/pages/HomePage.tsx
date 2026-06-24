/**
 * 主页
 */

import { useState, useCallback, useEffect, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, CircleHelp, Info } from 'lucide-react'
import { IndexedDBDocStore } from '@/collab/storage/IndexedDBDocStore'
import type { LocalDocMeta } from '@/collab/types'
import ConfirmDialog from '@/components/ConfirmDialog'
import { toast } from 'sonner'
import { APP_NAME } from '@/lib/constants'
import TimelineCard from '@/components/TimelineCard'
import AuthButton from '@/components/AuthButton'
import ThemeToggle from '@/components/ThemeToggle'
import LanguageToggle from '@/components/LanguageToggle'
import { useAuth } from '@/hooks/useAuth'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMyTimelines, deleteSharedTimeline } from '@/api/timelineShareApi'
import { track } from '@/utils/analytics'
import { useChangelogToast } from '@/hooks/useChangelogToast'
import { mergeTimelineList, type HomeTimelineItem } from './homeTimelineList'

const CreateTimelineDialog = lazy(() => import('@/components/CreateTimelineDialog'))
const ImportFFLogsDialog = lazy(() => import('@/components/ImportFFLogsDialog'))
const Top100Section = lazy(() => import('@/components/Top100Section'))
const AboutDialog = lazy(() => import('@/components/AboutDialog'))

export default function HomePage() {
  useChangelogToast()
  const { t } = useTranslation(['home', 'common'])
  const navigate = useNavigate()

  const { isLoggedIn } = useAuth()
  const queryClient = useQueryClient()
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showAboutDialog, setShowAboutDialog] = useState(false)
  const [showAboutTip, setShowAboutTip] = useState(
    () => !localStorage.getItem('about-tip-dismissed')
  )
  const [pendingDelete, setPendingDelete] = useState<HomeTimelineItem | null>(null)

  const [metas, setMetas] = useState<LocalDocMeta[]>([])

  const loadMetas = useCallback(async () => {
    const store = new IndexedDBDocStore()
    await store.open()
    setMetas(await store.getAllMeta())
  }, [])

  useEffect(() => {
    void loadMetas() // eslint-disable-line react-hooks/set-state-in-effect
  }, [loadMetas])

  const { data: myTimelines } = useQuery({
    queryKey: ['myTimelines'],
    queryFn: fetchMyTimelines,
    enabled: isLoggedIn,
    staleTime: 60_000,
  })

  const timelineList = useMemo(
    () => mergeTimelineList(metas, myTimelines ?? []),
    [metas, myTimelines]
  )

  const handleCreateNew = () => {
    track('timeline-create-start')
    setShowCreateDialog(true)
  }

  const handleImportFromFFLogs = () => {
    track('fflogs-import-start')
    setShowImportDialog(true)
  }

  const handleDeleteRequest = (item: HomeTimelineItem) => setPendingDelete(item)

  const handleDeleteConfirm = async () => {
    const item = pendingDelete
    if (!item) return
    try {
      if (item.kind === 'published') {
        await deleteSharedTimeline(item.id)
        await queryClient.invalidateQueries({ queryKey: ['myTimelines'] })
      }
      // 三种 kind 都要删本地记录（published 取消发布后亦删本地缓存）
      const store = new IndexedDBDocStore()
      await store.open()
      await store.deleteDoc(item.id)
      await loadMetas()
      toast.success(
        item.kind === 'published'
          ? '已取消发布'
          : item.kind === 'visited'
            ? '已从列表移除'
            : '时间轴已删除'
      )
      setPendingDelete(null)
    } catch (err) {
      toast.error(
        t('common:operationFailed', {
          message: err instanceof Error ? err.message : t('common:unknownError'),
        })
      )
    }
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
              <p className="hidden sm:block text-sm text-muted-foreground">{t('home:subtitle')}</p>
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
              <span className="hidden sm:inline">{t('home:help')}</span>
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
              <span className="hidden sm:inline">{t('home:about')}</span>
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
            <LanguageToggle />
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

        {/* 统一时间轴列表 */}
        {timelineList.length > 0 && (
          <section className="mb-12">
            <h2 className="text-xl font-semibold mb-4">我的时间轴</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {timelineList.map(item => (
                <TimelineCard
                  key={item.id}
                  timeline={{
                    id: item.id,
                    name: item.name,
                    kind: item.kind,
                    encounterId: String(item.encounterId),
                    createdAt: item.createdAt,
                    lastViewedAt: item.sortAt,
                    composition: item.composition,
                  }}
                  onClick={() => {
                    track('timeline-open', { source: item.kind })
                    navigate(`/timeline/${item.id}`)
                  }}
                  onDelete={e => {
                    e.stopPropagation()
                    handleDeleteRequest(item)
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
            onCreated={loadMetas}
          />
        )}
        {showImportDialog && (
          <ImportFFLogsDialog
            open={showImportDialog}
            onClose={() => setShowImportDialog(false)}
            onImported={loadMetas}
          />
        )}
      </Suspense>

      {/* 统一删除/移除确认 */}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={open => !open && setPendingDelete(null)}
        title={
          pendingDelete?.kind === 'published'
            ? '取消发布'
            : pendingDelete?.kind === 'visited'
              ? '从列表移除'
              : '删除时间轴'
        }
        description={
          pendingDelete?.kind === 'published'
            ? '取消发布后，获得链接的人将无法再访问该时间轴。确定要取消发布吗？'
            : pendingDelete?.kind === 'visited'
              ? '仅从你的本地列表移除该时间轴的记录，不影响原时间轴。'
              : '确定要删除这个时间轴吗？'
        }
        variant="destructive"
        onConfirm={handleDeleteConfirm}
      />
    </div>
  )
}
