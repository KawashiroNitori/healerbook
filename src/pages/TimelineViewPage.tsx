/**
 * 只读时间轴查看页
 * 路由：/timeline/:id
 */

import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { House, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { getTimeline, saveTimeline } from '@/utils/timelineStorage'
import { fetchSharedTimeline, type PublicSharedTimeline } from '@/api/timelineShareApi'
import { useAuthStore } from '@/store/authStore'
import { useEncounterStatistics } from '@/hooks/useEncounterStatistics'
import { useDamageCalculation } from '@/hooks/useDamageCalculation'
import { DamageCalculationContext } from '@/contexts/DamageCalculationContext'
import TimelineCanvas from '@/components/Timeline'
import ErrorBoundary from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { APP_NAME } from '@/lib/constants'
import { customAlphabet } from 'nanoid'
import type { Timeline } from '@/types/timeline'

const generateId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21
)

export default function TimelineViewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const accessToken = useAuthStore(s => s.accessToken)
  const { timeline, setTimeline } = useTimelineStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'not_found' | 'network' | null>(null)
  const [sharedData, setSharedData] = useState<PublicSharedTimeline | null>(null)
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })

  useEncounterStatistics(timeline?.encounter?.id)
  const calculationResults = useDamageCalculation(timeline)

  useEffect(() => {
    if (!id) return

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchSharedTimeline(id, accessToken)
        setSharedData(data)

        if (data.isAuthor) {
          // 作者：如果本地有，直接跳转；否则从服务器恢复再跳转
          const local = getTimeline(id)
          if (local) {
            navigate(`/editor/${id}`, { replace: true })
            return
          }
          // 从服务器恢复（剥离 isAuthor，该字段不持久化到 localStorage）
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { isAuthor: _isAuthor, ...dataWithoutIsAuthor } = data
          const restoredTimeline: Timeline = {
            ...dataWithoutIsAuthor,
            statusEvents: [],
            isShared: true,
            hasLocalChanges: false,
            serverVersion: data.version,
          }
          saveTimeline(restoredTimeline)
          toast.success('已从服务器恢复此时间轴')
          navigate(`/editor/${id}`, { replace: true })
        } else {
          // 只读查看：设置 timeline 到 store 用于渲染，并启用只读模式
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { isAuthor: _isAuthor, ...dataWithoutIsAuthor } = data
          const viewTimeline: Timeline = {
            ...dataWithoutIsAuthor,
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
  }, [id, accessToken]) // eslint-disable-line react-hooks/exhaustive-deps

  // 监听容器尺寸变化
  useEffect(() => {
    let resizeTimeout: number | null = null

    const updateSize = () => {
      if (canvasContainerRef.current) {
        const newWidth = canvasContainerRef.current.clientWidth
        const newHeight = canvasContainerRef.current.clientHeight

        setCanvasSize(prev => {
          if (prev.width === newWidth && prev.height === newHeight) {
            return prev
          }
          return { width: newWidth, height: newHeight }
        })
      }
    }

    const debouncedUpdateSize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
      resizeTimeout = window.setTimeout(updateSize, 100)
    }

    updateSize()

    window.addEventListener('resize', debouncedUpdateSize)

    const resizeObserver = new ResizeObserver(debouncedUpdateSize)
    if (canvasContainerRef.current) {
      resizeObserver.observe(canvasContainerRef.current)
    }

    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
      window.removeEventListener('resize', debouncedUpdateSize)
      resizeObserver.disconnect()
    }
  }, [])

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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error === 'not_found') {
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

  if (error === 'network') {
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

  // 只读渲染（非作者）
  return (
    <div className="flex flex-col bg-background overflow-hidden" style={{ height: '100dvh' }}>
      <title>{sharedData?.name ? `${sharedData.name} - ${APP_NAME}` : APP_NAME}</title>
      {/* 顶部导航栏 */}
      <header className="border-b flex-shrink-0">
        <div className="px-4 py-3 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 hover:bg-accent rounded-md transition-colors"
          >
            <House className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-bold">{sharedData?.name}</h1>
            {sharedData?.authorName && (
              <p className="text-sm text-muted-foreground">by {sharedData.authorName}</p>
            )}
          </div>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={handleCreateCopy}>
            在本地创建副本
          </Button>
        </div>
      </header>

      {/* 时间轴画布（只读） */}
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
      </DamageCalculationContext.Provider>
    </div>
  )
}
