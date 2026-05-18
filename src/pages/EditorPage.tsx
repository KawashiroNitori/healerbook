/**
 * 编辑器 / 查看页面(统一路由 /timeline/:id)
 *
 * 六种状态:
 *   local         — 本地 IndexedDB 有且未发布:纯本地编辑
 *   editor        — 已发布且当前用户在编辑者白名单:实时协同编辑
 *   viewer        — 已发布、他人时间轴:只读查看(服务端 snapshot)
 *   loading       — 模式推导中
 *   not_found     — 本地无 + 服务端 404
 *   network_error — 服务端请求失败(非 404)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { House } from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { setSyncScrollProgress } from '@/utils/syncScrollProgress'
import { fetchSharedTimeline } from '@/api/timelineShareApi'
import { createLocalTimeline } from '@/collab/createLocalTimeline'
import { IndexedDBDocStore } from '@/collab/storage/IndexedDBDocStore'
import { generateId } from '@/utils/id'
import { useEncounterStatistics } from '@/hooks/useEncounterStatistics'
import { useDamageCalculation } from '@/hooks/useDamageCalculation'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { DamageCalculationContext } from '@/contexts/DamageCalculationContext'
import { createPlacementEngine } from '@/utils/placement/engine'
import EditorToolbar from '@/components/EditorToolbar'
import PropertyPanel from '@/components/PropertyPanel'
import TimelineCanvas from '@/components/Timeline'
import TimelineTableView from '@/components/TimelineTable'
import ErrorBoundary from '@/components/ErrorBoundary'
import EditableTitle from '@/components/EditableTitle'
import EditableDescription from '@/components/EditableDescription'
import FullScreenLoader from '@/components/FullScreenLoader'
import { Button } from '@/components/ui/button'
import { APP_NAME } from '@/lib/constants'
import ThemeToggle from '@/components/ThemeToggle'
import PresenceAvatars from '@/components/PresenceAvatars'
import { track } from '@/utils/analytics'

type PageMode = 'local' | 'editor' | 'viewer' | 'loading' | 'not_found' | 'network_error'

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

  const mitigationActions = useMitigationStore(s => s.actions)
  const loadMitigationActions = useMitigationStore(s => s.loadActions)

  const [mode, setMode] = useState<PageMode>('loading')
  const [authorName, setAuthorName] = useState<string>('')
  const [shareRole, setShareRole] = useState<{
    role: 'editor' | 'viewer'
    isAuthor: boolean
    allowEditRequests: boolean
    hasPendingRequest: boolean
  }>({ role: 'viewer', isAuthor: false, allowEditRequests: false, hasPendingRequest: false })
  useEffect(() => {
    if (mitigationActions.length === 0) loadMitigationActions()
  }, [mitigationActions.length, loadMitigationActions])

  // ── 模式推导 + 加载 ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) {
      setMode('not_found') // eslint-disable-line react-hooks/set-state-in-effect
      return
    }
    let ignore = false
    setMode('loading')
    setAuthorName('')
    useUIStore.setState({ manualLock: false })
    ;(async () => {
      try {
        const store = new IndexedDBDocStore()
        await store.open()
        const meta = await store.getMeta(id)
        if (ignore) return

        if (meta) {
          if (meta.published) {
            // 本地标记为已发布:与服务端对账。作者可能已取消发布,
            // 此时服务端无此行,需把本地副本回退为纯本地时间轴。
            let serverRes: Awaited<ReturnType<typeof fetchSharedTimeline>> | null = null
            let unpublished = false
            try {
              serverRes = await fetchSharedTimeline(id)
            } catch (err) {
              // 仅 404 是「已取消发布」的确定信号;网络等其他错误
              // 不退化,仍按 editor 打开以保留离线编辑能力
              unpublished = err instanceof Error && err.message === 'NOT_FOUND'
            }
            if (ignore) return
            if (unpublished) {
              // 回退为纯本地:换一个全新本地 id,与原云端 id 彻底脱钩,
              // 避免多份同 id 副本及重新发布时的归属冲突
              const localId = generateId()
              await store.rekey(id, localId)
              const movedMeta = await store.getMeta(localId)
              if (movedMeta) await store.putMeta({ ...movedMeta, published: false })
              if (ignore) return
              toast.info('该时间轴已被作者取消发布,已转为本地时间轴')
              navigate(`/timeline/${localId}`, { replace: true })
              return
            }
            await openTimeline(id, { published: true })
            if (ignore) return
            setMode('editor')
            // 取角色信息(用于共享 popover);使用已拿到的响应,失败时默认作者
            if (serverRes) {
              setShareRole({
                role: serverRes.role,
                isAuthor: serverRes.isAuthor,
                allowEditRequests: serverRes.allowEditRequests,
                hasPendingRequest: serverRes.hasPendingRequest,
              })
              // 播种共享按钮角标计数;后续新申请由 WS 实时刷新
              useTimelineStore.setState({ pendingRequestCount: serverRes.pendingRequestCount })
            } else {
              setShareRole({
                role: 'editor',
                isAuthor: true,
                allowEditRequests: false,
                hasPendingRequest: false,
              })
            }
            return
          } else {
            await openTimeline(id)
            if (!ignore) setMode('local')
          }
          return
        }

        const res = await fetchSharedTimeline(id)
        if (ignore) return
        setAuthorName(res.authorName)
        setShareRole({
          role: res.role,
          isAuthor: res.isAuthor,
          allowEditRequests: res.allowEditRequests,
          hasPendingRequest: res.hasPendingRequest,
        })
        if (res.role === 'editor') {
          await openTimeline(id, { published: true })
          if (ignore) return
          // openTimeline 已把计数清 0,在其后播种
          useTimelineStore.setState({ pendingRequestCount: res.pendingRequestCount })
          setMode('editor')
        } else {
          if (ignore) return
          setViewerSnapshot(res.snapshot!)
          useUIStore.setState({ manualLock: true })
          setMode('viewer')
          track('timeline-view-shared', { timelineId: id })
        }
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

  // 发布成功回调:同 id 原地升级 editor;id 变更则 navigate 重挂
  const handlePublished = useCallback(
    (newId: string) => {
      if (newId === id) {
        setMode('editor')
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
  const isReadOnly = useEditorReadOnly()

  useEffect(() => {
    if (!timeline || isReadOnly) return
    const engine = createPlacementEngine({
      castEvents: timeline.castEvents,
      actions: new Map(mitigationActions.map(a => [a.id, a])),
      statusTimelineByPlayer: calculationResults.statusTimelineByPlayer,
    })
    const actionById = new Map(mitigationActions.map(a => [a.id, a]))
    const { updateCastEvent } = useTimelineStore.getState()
    for (const ce of timeline.castEvents) {
      const ca = actionById.get(ce.actionId)
      if (!ca) continue
      const groupId = ca.trackGroup ?? ca.id
      let memberCount = 0
      for (const a of mitigationActions) {
        if ((a.trackGroup ?? a.id) === groupId) memberCount++
        if (memberCount >= 2) break
      }
      if (memberCount < 2) continue
      if (engine.canPlaceCastEvent(ca, ce.playerId, ce.timestamp, ce.id).ok) continue
      const member = engine.pickUniqueMember(groupId, ce.playerId, ce.timestamp, ce.id)
      if (member && member.id !== ce.actionId) {
        updateCastEvent(ce.id, { actionId: member.id })
      }
    }
  }, [calculationResults.statusTimelineByPlayer, timeline, mitigationActions, isReadOnly])

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

  const isViewMode = mode === 'viewer'

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

          {isViewMode ? (
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold">{timeline?.name}</h1>
                {authorName && (
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                    By {authorName}
                  </span>
                )}
              </div>
              <EditableDescription
                value={timeline?.description || ''}
                onChange={() => {}}
                readOnly
              />
            </div>
          ) : (
            <div>
              <EditableTitle
                value={timeline?.name || '时间轴编辑器'}
                onChange={updateTimelineName}
                className="text-lg font-bold"
              />
              <EditableDescription
                value={timeline?.description || ''}
                onChange={updateTimelineDescription}
              />
            </div>
          )}

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
          forceReadOnly={isViewMode}
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
      </DamageCalculationContext.Provider>
    </div>
  )
}
