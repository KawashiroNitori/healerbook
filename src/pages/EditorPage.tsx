/**
 * 编辑器页面
 * source='local'  — 从 localStorage 加载（编辑模式）
 * source='api'    — 从服务器加载（作者：编辑；非作者：只读）
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { House, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { customAlphabet } from 'nanoid'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { getTimeline, saveTimeline } from '@/utils/timelineStorage'
import { fetchSharedTimeline, type PublicSharedTimeline } from '@/api/timelineShareApi'
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

const generateId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21
)

interface EditorPageProps {
  source?: 'local' | 'api'
}

export default function EditorPage({ source = 'local' }: EditorPageProps) {
  // /editor/:timelineId  or  /timeline/:id
  const params = useParams<{ timelineId?: string; id?: string }>()
  const entityId = params.timelineId || params.id

  const navigate = useNavigate()
  const accessToken = useAuthStore(s => s.accessToken)
  const { timeline, setTimeline, updateTimelineName, updateTimelineDescription } =
    useTimelineStore()
  // callback ref：DOM attach/detach 时触发 state 更新，保证 ResizeObserver 能正确初始化
  const [canvasContainer, setCanvasContainer] = useState<HTMLDivElement | null>(null)
  const canvasContainerRef = useCallback((node: HTMLDivElement | null) => {
    setCanvasContainer(node)
  }, [])
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })

  // API source 专用状态
  const [loading, setLoading] = useState(source === 'api')
  const [error, setError] = useState<'not_found' | 'network' | null>(null)
  const [sharedData, setSharedData] = useState<PublicSharedTimeline | null>(null)
  const [isAuthor, setIsAuthor] = useState(false)

  useEncounterStatistics(timeline?.encounter?.id)
  const calculationResults = useDamageCalculation(timeline)

  // ── 数据加载 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!entityId) return

    if (source === 'local') {
      const loadedTimeline = getTimeline(entityId)
      if (loadedTimeline) {
        setTimeline(loadedTimeline)
      } else {
        toast.error('时间轴不存在')
        navigate('/')
      }
      return () => {
        setTimeline(null)
      }
    }

    // source === 'api'
    setLoading(true)
    setError(null)

    const load = async () => {
      try {
        const data = await fetchSharedTimeline(entityId, accessToken)
        setSharedData(data)

        if (data.isAuthor) {
          setIsAuthor(true)
          // 作者：优先使用本地版本
          const local = getTimeline(entityId)
          if (local) {
            setTimeline(local)
          } else {
            // 从服务器恢复到本地
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { isAuthor: _, authorName: _a, publishedAt: _p, version: _v, ...rest } = data
            const restored: Timeline = {
              ...rest,
              statusEvents: [],
              isShared: true,
              hasLocalChanges: false,
              serverVersion: data.version,
            }
            saveTimeline(restored)
            setTimeline(restored)
            toast.success('已从服务器恢复此时间轴')
          }
          useUIStore.setState({ isReadOnly: false })
        } else {
          // 非作者：只读查看
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { isAuthor: _, authorName: _a, publishedAt: _p, version: _v, ...rest } = data
          const viewTimeline: Timeline = {
            ...rest,
            statusEvents: [],
            isShared: false,
            hasLocalChanges: false,
          }
          setTimeline(viewTimeline)
          useUIStore.setState({ isReadOnly: true })
          document.title = `${data.name} - ${APP_NAME}`
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'NOT_FOUND') {
          setError('not_found')
        } else {
          setError('network')
        }
      } finally {
        setLoading(false)
      }
    }

    load()

    return () => {
      useUIStore.setState({ isReadOnly: false })
      setTimeline(null)
    }
  }, [entityId, source, accessToken]) // eslint-disable-line react-hooks/exhaustive-deps

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
  // 依赖 canvasContainer state：DOM attach 后 effect 重跑，确保 source='api' 加载完成后也能正确测量
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

  // ── 在本地创建副本（非作者） ───────────────────────────────────────────────
  const handleCreateCopy = () => {
    if (!sharedData) return
    const newId = generateId()
    const now = Math.floor(Date.now() / 1000)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { isAuthor: _, authorName: _a, publishedAt: _p, version: _v, ...rest } = sharedData
    const copy: Timeline = {
      ...rest,
      id: newId,
      name: `${sharedData.name}（副本）`,
      statusEvents: [],
      isShared: false,
      hasLocalChanges: false,
      createdAt: now,
      updatedAt: now,
    }
    saveTimeline(copy)
    navigate(`/editor/${newId}`)
  }

  // ── 加载 / 错误屏 (API source) ────────────────────────────────────────────
  if (source === 'api' && loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (source === 'api' && error === 'not_found') {
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

  if (source === 'api' && error === 'network') {
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

  // ── 判断当前是否为只读（非作者查看） ──────────────────────────────────────
  const isViewMode = source === 'api' && !isAuthor

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
              <h1 className="text-lg font-bold">{sharedData?.name}</h1>
              {sharedData?.authorName && (
                <p className="text-sm text-muted-foreground">by {sharedData.authorName}</p>
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

          <div className="flex-1" />

          {/* 在本地创建副本（仅只读模式） */}
          {isViewMode && (
            <Button variant="outline" size="sm" onClick={handleCreateCopy}>
              在本地创建副本
            </Button>
          )}
        </div>
      </header>

      <EditorToolbar />

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
