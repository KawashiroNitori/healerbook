/**
 * 编辑器 / 查看页面（统一路由 /timeline/:id）
 *
 * 三种模式由数据状态自动推导：
 *   local  — localStorage 有且 isShared=false：纯本地编辑，未发布
 *   author — localStorage 有且 isShared=true，或从 API 恢复（isAuthor=true）：作者查看/编辑
 *   view   — localStorage 无，API 返回 isAuthor=false：只读查看他人时间轴
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { House, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { customAlphabet } from 'nanoid'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { getTimeline, saveTimeline } from '@/utils/timelineStorage'
import { fetchSharedTimeline } from '@/api/timelineShareApi'
import { useEncounterStatistics } from '@/hooks/useEncounterStatistics'
import { useDamageCalculation } from '@/hooks/useDamageCalculation'
import { DamageCalculationContext } from '@/contexts/DamageCalculationContext'
import EditorToolbar from '@/components/EditorToolbar'
import PropertyPanel from '@/components/PropertyPanel'
import TimelineCanvas from '@/components/Timeline'
import ErrorBoundary from '@/components/ErrorBoundary'
import EditableTitle from '@/components/EditableTitle'
import EditableDescription from '@/components/EditableDescription'
import { Button } from '@/components/ui/button'
import { APP_NAME } from '@/lib/constants'
import type { Timeline } from '@/types/timeline'

type PageMode = 'local' | 'author' | 'view' | 'loading' | 'not_found' | 'network_error'

const generateId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21
)

export default function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const accessToken = useAuthStore(s => s.accessToken)
  const { timeline, setTimeline, updateTimelineName, updateTimelineDescription } =
    useTimelineStore()

  // 同步读 localStorage，id 变化时重新取，其余渲染复用缓存
  const localTimeline = useMemo(() => (id ? getTimeline(id) : null), [id])

  // 仅在本地无记录时才请求 API
  const {
    data: apiData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['shared-timeline', id, accessToken],
    queryFn: () => fetchSharedTimeline(id!, accessToken),
    enabled: !!id && localTimeline === null,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

  // 从 query 状态派生页面模式，无需额外 useState
  const mode: PageMode = (() => {
    if (!id) return 'not_found'
    if (localTimeline) return localTimeline.isShared ? 'author' : 'local'
    if (isLoading || (!apiData && !error)) return 'loading'
    if (error)
      return error instanceof Error && error.message === 'NOT_FOUND' ? 'not_found' : 'network_error'
    if (apiData) return apiData.isAuthor ? 'author' : 'view'
    return 'loading'
  })()

  // callback ref：DOM attach 时触发 state 更新，确保 ResizeObserver 在加载完成后正确初始化
  const [canvasContainer, setCanvasContainer] = useState<HTMLDivElement | null>(null)
  const canvasContainerRef = useCallback((node: HTMLDivElement | null) => {
    setCanvasContainer(node)
  }, [])
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })

  useEncounterStatistics(timeline?.encounter?.id)
  const calculationResults = useDamageCalculation(timeline)

  // ── 副作用：将加载结果同步到 store ───────────────────────────────────────
  useEffect(() => {
    if (localTimeline) {
      setTimeline(localTimeline)
      return () => setTimeline(null)
    }

    if (!apiData) return

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { isAuthor, authorName: _a, publishedAt: _p, version: _v, ...rest } = apiData

    if (isAuthor) {
      const restored: Timeline = {
        ...rest,
        statusEvents: [],
        isShared: true,
        hasLocalChanges: false,
        serverVersion: apiData.version,
      }
      saveTimeline(restored)
      setTimeline(restored)
      toast.success('已从服务器恢复此时间轴')
    } else {
      const viewTimeline: Timeline = {
        ...rest,
        statusEvents: [],
        isShared: false,
        hasLocalChanges: false,
      }
      setTimeline(viewTimeline)
      useUIStore.setState({ isReadOnly: true })
    }

    return () => {
      useUIStore.setState({ isReadOnly: false })
      setTimeline(null)
    }
  }, [localTimeline, apiData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 禁止浏览器原生缩放 ─────────────────────────────────────────────────────
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

  // ── 监听容器尺寸变化 ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasContainer) return

    let resizeTimeout: number | null = null

    const updateSize = () => {
      const newWidth = canvasContainer.clientWidth
      const newHeight = canvasContainer.clientHeight
      setCanvasSize(prev => {
        if (prev.width === newWidth && prev.height === newHeight) return prev
        return { width: newWidth, height: newHeight }
      })
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

  // ── 在本地创建副本（view 模式） ───────────────────────────────────────────
  const handleCreateCopy = () => {
    if (!apiData) return
    const newId = generateId()
    const now = Math.floor(Date.now() / 1000)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { isAuthor: _, authorName: _a, publishedAt: _p, version: _v, ...rest } = apiData
    const copy: Timeline = {
      ...rest,
      id: newId,
      name: `${apiData.name}（副本）`,
      statusEvents: [],
      isShared: false,
      hasLocalChanges: false,
      createdAt: now,
      updatedAt: now,
    }
    saveTimeline(copy)
    navigate(`/timeline/${newId}`)
  }

  // ── 加载 / 错误屏 ─────────────────────────────────────────────────────────
  if (mode === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

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
        <p className="text-muted-foreground">加载失败，请检查网络连接</p>
        <Button onClick={() => window.location.reload()}>重试</Button>
        <Button variant="outline" onClick={() => navigate('/')}>
          <House className="w-4 h-4 mr-2" />
          返回首页
        </Button>
      </div>
    )
  }

  const isViewMode = mode === 'view'

  return (
    <div
      className="editor-page flex flex-col bg-background overflow-hidden"
      style={{ height: '100dvh' }}
    >
      <title>{timeline?.name ? `${timeline.name} - ${APP_NAME}` : APP_NAME}</title>

      {/* Header */}
      <header className="border-b flex-shrink-0">
        <div className="px-4 py-3 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 hover:bg-accent rounded-md transition-colors"
          >
            <House className="w-5 h-5" />
          </button>

          {isViewMode ? (
            // 只读头部：静态标题 + 作者名
            <div>
              <h1 className="text-lg font-bold">{apiData?.name}</h1>
              {apiData?.authorName && (
                <p className="text-sm text-muted-foreground">by {apiData.authorName}</p>
              )}
            </div>
          ) : (
            // 编辑头部：可编辑标题 + 描述
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
        </div>
      </header>

      <EditorToolbar onCreateCopy={isViewMode ? handleCreateCopy : undefined} />

      {/* Main Content */}
      <DamageCalculationContext.Provider value={calculationResults}>
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <div ref={canvasContainerRef} className="h-full">
              {timeline ? (
                <ErrorBoundary>
                  <TimelineCanvas width={canvasSize.width} height={canvasSize.height} />
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
