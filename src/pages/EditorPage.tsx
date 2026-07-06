/**
 * 编辑器 / 查看页面(统一路由 /timeline/:id)
 *
 * PageMode 只跟踪加载状态；角色由 timelineStore.sessionRole 决定。
 *   loading       — 模式推导中
 *   ready         — 已就绪（local / author / editor / viewer 均用此态）
 *   not_found     — 本地无 + 服务端 404
 *   network_error — 服务端请求失败(非 404)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { House } from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { setSyncScrollProgress } from '@/utils/syncScrollProgress'
import { fetchSharedTimeline } from '@/api/timelineShareApi'
import type { ShareRoleInfo } from '@/types/apiContracts'
import { createLocalTimeline } from '@/collab/createLocalTimeline'
import { IndexedDBDocStore } from '@/collab/storage/IndexedDBDocStore'
import { generateId } from '@/utils/id'
import { useEncounterStatistics } from '@/hooks/useEncounterStatistics'
import { useDamageCalculation } from '@/hooks/useDamageCalculation'
import { useEditLock } from '@/hooks/useEditLock'
import { DamageCalculationContext } from '@/contexts/DamageCalculationContext'
import EditorToolbar from '@/components/EditorToolbar'
import PropertyPanel from '@/components/PropertyPanel'
import TimelineCanvas from '@/components/Timeline'
import TimelineTableView from '@/components/TimelineTable'
import ResourceHoverPanel from '@/components/ResourceHover/ResourceHoverPanel'
import ErrorBoundary from '@/components/ErrorBoundary'
import EditableTitle from '@/components/EditableTitle'
import EditableDescription from '@/components/EditableDescription'
import FullScreenLoader from '@/components/FullScreenLoader'
import { Button } from '@/components/ui/button'
import { APP_NAME } from '@/lib/constants'
import ThemeToggle from '@/components/ThemeToggle'
import PresenceAvatars from '@/components/PresenceAvatars'
import { track } from '@/utils/analytics'
import { decideOpen, type ServerOutcome } from './editorOpenDecision'
import type { LocalDocMeta } from '@/collab/types'
import type { Timeline } from '@/types/timeline'

type PageMode = 'loading' | 'ready' | 'not_found' | 'network_error'

function buildVisitedMeta(id: string, snapshot: Timeline): LocalDocMeta {
  return {
    docId: id,
    name: snapshot.name,
    encounterId: snapshot.encounter?.id ?? 0,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt || Math.floor(Date.now() / 1000),
    composition: snapshot.composition ?? null,
    kind: 'visited',
    lastViewedAt: Math.floor(Date.now() / 1000),
  }
}

export default function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const viewMode: 'timeline' | 'table' = searchParams.get('view') === 'table' ? 'table' : 'timeline'
  const handleViewModeChange = (mode: 'timeline' | 'table') => {
    const next = new URLSearchParams(searchParams)
    if (mode === 'table') next.set('view', 'table')
    else next.delete('view')
    setSearchParams(next, { replace: true })
  }

  const timeline = useTimelineStore(s => s.timeline)
  const updateTimelineName = useTimelineStore(s => s.updateTimelineName)
  const updateTimelineDescription = useTimelineStore(s => s.updateTimelineDescription)
  const openTimeline = useTimelineStore(s => s.openTimeline)
  const setViewerSnapshot = useTimelineStore(s => s.setViewerSnapshot)
  const reset = useTimelineStore(s => s.reset)

  const [mode, setMode] = useState<PageMode>('loading')
  const [authorName, setAuthorName] = useState<string>('')
  const [shareRole, setShareRole] = useState<ShareRoleInfo>({
    role: 'viewer',
    isAuthor: false,
    allowEditRequests: false,
    hasPendingRequest: false,
  })
  // ── 模式推导 + 加载 ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) {
      setMode('not_found') // eslint-disable-line react-hooks/set-state-in-effect
      return
    }
    let ignore = false
    setMode('loading')
    setAuthorName('')
    ;(async () => {
      try {
        const store = new IndexedDBDocStore()
        await store.open()
        const meta = await store.getMeta(id)
        if (ignore) return

        // 查服务端（本地纯 local 时跳过）
        let server: ServerOutcome | null = null
        let serverRes: Awaited<ReturnType<typeof fetchSharedTimeline>> | null = null
        if (!meta || meta.kind !== 'local') {
          try {
            serverRes = await fetchSharedTimeline(id)
            server = { type: 'ok', isAuthor: serverRes.isAuthor, role: serverRes.role }
          } catch (err) {
            if (err instanceof Error && err.message === 'NOT_FOUND') {
              server = { type: 'notfound' }
            } else {
              const localDoc = await store.loadDoc(id)
              server = { type: 'neterror', hasLocalDoc: localDoc !== null }
            }
          }
          if (ignore) return
        }

        const decision = decideOpen(meta ? meta.kind : null, server)

        if (decision.kind === 'rekey-local') {
          const localId = generateId()
          await store.rekey(id, localId)
          const moved = await store.getMeta(localId)
          if (moved) await store.putMeta({ ...moved, kind: 'local' })
          if (ignore) return
          toast.info('该时间轴已被作者取消发布，已转为本地时间轴')
          navigate(`/timeline/${localId}`, { replace: true })
          return
        }
        if (decision.kind === 'not-found') {
          if (meta) await store.deleteDoc(id)
          if (!ignore) setMode('not_found')
          return
        }
        if (decision.kind === 'network-error') {
          if (!ignore) setMode('network_error')
          return
        }
        if (decision.kind === 'viewer') {
          const snap = serverRes?.snapshot
          if (!snap) {
            if (!ignore) setMode('network_error')
            return
          }
          await store.putMeta(buildVisitedMeta(id, snap))
          if (ignore) return
          setViewerSnapshot(snap)
          setAuthorName(serverRes!.authorName)
          setShareRole({
            role: 'viewer',
            isAuthor: false,
            allowEditRequests: serverRes!.allowEditRequests,
            hasPendingRequest: serverRes!.hasPendingRequest,
          })
          setMode('ready')
          track('timeline-view-shared', { timelineId: id })
          return
        }

        // local / author / editor → openTimeline;editor/author 透传 KV snapshot 做首屏兜底渲染
        await openTimeline(id, {
          role: decision.kind,
          snapshot: serverRes?.snapshot,
        })
        await store.touchLastViewed(id)
        if (ignore) return
        if (serverRes) {
          useTimelineStore.setState({ pendingRequestCount: serverRes.pendingRequestCount })
          setAuthorName(serverRes.authorName)
          setShareRole({
            role: serverRes.role,
            isAuthor: serverRes.isAuthor,
            allowEditRequests: serverRes.allowEditRequests,
            hasPendingRequest: serverRes.hasPendingRequest,
          })
        }
        setMode('ready')
      } catch (err) {
        if (ignore) return
        setMode(err instanceof Error && err.message === 'NOT_FOUND' ? 'not_found' : 'network_error')
      }
    })()

    return () => {
      ignore = true
    }
  }, [id, openTimeline, setViewerSnapshot, navigate])

  // 卸载 / 切 id 时重置 store(断开 WS、销毁引擎)
  useEffect(() => {
    return () => {
      useUIStore.setState({ manualLock: false })
      reset()
    }
  }, [id, reset])

  // 发布成功回调:同 id 原地升级 author;id 变更则 navigate 重挂
  const handlePublished = useCallback(
    (newId: string) => {
      if (newId === id) {
        setMode('ready')
        // 发布者即作者:同步共享角色,否则共享按钮停留在初始 viewer 态
        setShareRole({
          role: 'editor',
          isAuthor: true,
          allowEditRequests: false,
          hasPendingRequest: false,
        })
      } else {
        const query = viewMode === 'table' ? '?view=table' : ''
        navigate(`/timeline/${newId}${query}`, { replace: true })
      }
    },
    [id, navigate, viewMode]
  )

  // ── 在本地创建副本(viewer 模式) ─────────────────────────────────────────
  const handleCreateCopy = async () => {
    if (!timeline) return
    try {
      const newId = await createLocalTimeline({
        name: `${timeline.name}(副本)`,
        description: timeline.description,
        encounter: timeline.encounter,
        fflogsSource: timeline.fflogsSource,
        gameZoneId: timeline.gameZoneId,
        syncEvents: timeline.syncEvents,
        isReplayMode: timeline.isReplayMode,
        composition: timeline.composition,
        damageEvents: timeline.damageEvents,
        castEvents: timeline.castEvents,
        annotations: timeline.annotations ?? [],
        statData: timeline.statData,
        createdAt: Math.floor(Date.now() / 1000),
      })
      track('timeline-create-copy', { encounterId: timeline.encounter?.id })
      navigate(`/timeline/${newId}`)
    } catch (err) {
      toast.error('创建副本失败:' + (err instanceof Error ? err.message : '未知错误'))
    }
  }

  const [canvasContainer, setCanvasContainer] = useState<HTMLDivElement | null>(null)
  const canvasContainerRef = useCallback((node: HTMLDivElement | null) => {
    setCanvasContainer(node)
  }, [])
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })

  useEncounterStatistics(timeline?.encounter?.id)
  const selectedCastEventId = useTimelineStore(s => s.selectedCastEventId)
  const draggingId = useUIStore(s => s.draggingId)
  const extraExcludeIds = useMemo(
    () => [selectedCastEventId, draggingId].filter((x): x is string => !!x),
    [selectedCastEventId, draggingId]
  )
  const calculationResults = useDamageCalculation(timeline, { extraExcludeIds })
  const sessionRole = useTimelineStore(s => s.sessionRole)
  const editLock = useEditLock()

  useEffect(() => {
    return () => {
      setSyncScrollProgress(0)
    }
  }, [])

  useEffect(() => {
    const preventZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault()
    }
    const preventGesture = (e: Event) => e.preventDefault()
    document.addEventListener('wheel', preventZoom, { passive: false })
    document.addEventListener('gesturestart', preventGesture)
    document.addEventListener('gesturechange', preventGesture)
    return () => {
      document.removeEventListener('wheel', preventZoom)
      document.removeEventListener('gesturestart', preventGesture)
      document.removeEventListener('gesturechange', preventGesture)
    }
  }, [])

  useEffect(() => {
    if (!canvasContainer) return
    let resizeTimeout: number | null = null
    const updateSize = () => {
      const newWidth = canvasContainer.clientWidth
      const newHeight = canvasContainer.clientHeight
      setCanvasSize(prev =>
        prev.width === newWidth && prev.height === newHeight
          ? prev
          : { width: newWidth, height: newHeight }
      )
    }
    const debouncedUpdateSize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = window.setTimeout(updateSize, 100)
    }
    updateSize()
    window.addEventListener('resize', debouncedUpdateSize)
    const resizeObserver = new ResizeObserver(debouncedUpdateSize)
    resizeObserver.observe(canvasContainer)
    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      window.removeEventListener('resize', debouncedUpdateSize)
      resizeObserver.disconnect()
    }
  }, [canvasContainer])

  if (mode === 'loading') return <FullScreenLoader />

  if (mode === 'not_found') {
    return (
      <div className="flex min-h-screen items-center justify-center flex-col gap-4">
        <p className="text-muted-foreground">时间轴不存在或已删除</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          <House className="w-4 h-4 mr-2" />
          返回首页
        </Button>
      </div>
    )
  }

  if (mode === 'network_error') {
    return (
      <div className="flex min-h-screen items-center justify-center flex-col gap-4">
        <p className="text-muted-foreground">加载失败,请检查网络连接</p>
        <Button onClick={() => window.location.reload()}>重试</Button>
        <Button variant="outline" onClick={() => navigate('/')}>
          <House className="w-4 h-4 mr-2" />
          返回首页
        </Button>
      </div>
    )
  }

  const isViewMode = sessionRole === 'viewer'

  return (
    <div
      className="editor-page flex flex-col bg-background overflow-hidden"
      style={{ height: '100dvh' }}
    >
      <title>{timeline?.name ? `${timeline.name} - ${APP_NAME}` : APP_NAME}</title>

      <header className="border-b flex-shrink-0">
        <div className="px-4 py-3 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 hover:bg-accent rounded-md transition-colors"
          >
            <House className="w-5 h-5" />
          </button>

          <div>
            <div className="flex items-center gap-2">
              <EditableTitle
                value={timeline?.name || '时间轴编辑器'}
                onChange={updateTimelineName}
                className="text-lg font-bold"
                readOnly={!editLock.can('metadata')}
              />
              {isViewMode && authorName && (
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                  By {authorName}
                </span>
              )}
            </div>
            <EditableDescription
              value={timeline?.description || ''}
              onChange={updateTimelineDescription}
              readOnly={!editLock.can('metadata')}
            />
          </div>

          <div className="ml-auto flex items-center gap-3">
            <PresenceAvatars />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <DamageCalculationContext.Provider value={calculationResults}>
        <EditorToolbar
          onCreateCopy={handleCreateCopy}
          onPublished={handlePublished}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          shareRole={shareRole}
        />

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <div ref={canvasContainerRef} className="h-full">
              {timeline ? (
                <ErrorBoundary>
                  {viewMode === 'table' ? (
                    <TimelineTableView />
                  ) : (
                    <TimelineCanvas width={canvasSize.width} height={canvasSize.height} />
                  )}
                </ErrorBoundary>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-muted-foreground">加载中...</p>
                </div>
              )}
            </div>
          </div>
        </div>
        <PropertyPanel />
        <ResourceHoverPanel />
      </DamageCalculationContext.Provider>
    </div>
  )
}
